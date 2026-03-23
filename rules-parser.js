/**
 * Domain Redirector — DSL Parser & Redirect Engine
 *
 * Syntax summary:
 *   ; comment
 *   !name default_value          — set default for named capture
 *   [items](/<regex>:<name>)     — match: list of host prefixes + TLD capture
 *   ->                           — separator
 *   [items].{name}               — replace: list of templates + suffix
 *
 * Items inside [...]:
 *   literal_text                 — exact match
 *   /regex                       — regex match
 *   /regex(.*?:captureName)      — regex with named capture inside
 *
 * Templates use {name} to insert captured values.
 * Rules are separated by blank lines.
 */

// ─── Utility ────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function stripComments(text) {
  return text
    .split("\n")
    .map((line) => {
      const idx = line.indexOf(";")
      return idx >= 0 ? line.slice(0, idx) : line
    })
    .join("\n")
}

// Convert DSL named captures  (content:name)  →  (?<name>content)
function convertNamedCaptures(regexStr) {
  return regexStr.replace(/\(([^)]+?):(\w+)\)/g, "(?<$2>$1)")
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

function parseRulesText(text) {
  const cleaned = stripComments(text)
  const blocks = cleaned
    .split(/\n(?:\s*\n)+/)
    .map((b) => b.trim())
    .filter((b) => b)
  const rules = []

  for (const block of blocks) {
    try {
      const rule = parseRuleBlock(block)
      if (rule) rules.push(rule)
    } catch (e) {
      console.warn(
        "[DomainRedirector] Rule parse error:",
        e.message,
        "\nBlock:",
        block,
      )
    }
  }
  return rules
}

function parseRuleBlock(block) {
  const lines = block.split("\n")
  const arrowIdx = lines.findIndex((l) => l.trim() === "->")
  if (arrowIdx < 0) return null

  const matchLines = lines.slice(0, arrowIdx)
  const replaceLines = lines.slice(arrowIdx + 1)

  // ── Extract defaults (!name value) ──
  const defaults = {}
  const patternLines = []

  for (const line of matchLines) {
    const t = line.trim()
    if (t.startsWith("!")) {
      const m = t.match(/^!(\w+)\s+(.+)$/)
      if (m) defaults[m[1]] = m[2].trim()
    } else {
      patternLines.push(line)
    }
  }

  // ── Parse match side ──
  const matchStr = patternLines.join("\n")
  const matchResult = parseMatchPattern(matchStr)
  if (!matchResult) return null

  // ── Parse replace side ──
  const replaceStr = replaceLines.join("\n").trim()
  const replaceResult = parseReplacePattern(replaceStr)
  if (!replaceResult) return null

  return {
    defaults,
    matchItems: matchResult.matchItems,
    tldPattern: matchResult.tldPattern,
    tldName: matchResult.tldName,
    replaceItems: replaceResult.items,
    replaceSuffix: replaceResult.suffix,
  }
}

function parseMatchPattern(str) {
  const listStart = str.indexOf("[")
  const listEnd = str.lastIndexOf("]")
  if (listStart < 0 || listEnd < 0) return null

  const listContent = str.slice(listStart + 1, listEnd)
  const afterList = str.slice(listEnd + 1).trim()

  const matchItems = listContent
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l)
    .map(parseMatchItem)

  // Parse TLD capture:  (/regex:name)  or  (/regex)  or  (regex:name)
  let tldPattern = ".*"
  let tldName = "_tld"

  if (afterList) {
    // Strip outer parens
    const inner = afterList
      .replace(/^\(/, "")
      .replace(/\)$/, "")
      .trim()
    // Strip leading / (regex marker)
    const regexPart = inner.startsWith("/") ? inner.slice(1) : inner
    // Split on last :word$ for the capture name
    const colonMatch = regexPart.match(/^(.*):(\w+)$/)
    if (colonMatch) {
      tldPattern = colonMatch[1] || ".*"
      tldName = colonMatch[2]
    } else {
      tldPattern = regexPart || ".*"
    }
  }

  return { matchItems, tldPattern, tldName }
}

function parseMatchItem(str) {
  if (str.startsWith("/")) {
    const regexStr = convertNamedCaptures(str.slice(1))
    return { type: "regex", pattern: regexStr, source: str }
  }
  return { type: "literal", value: str, source: str }
}

function parseReplacePattern(str) {
  str = str.trim()
  const listStart = str.indexOf("[")
  const listEnd = str.indexOf("]")

  if (listStart >= 0 && listEnd > listStart) {
    const listContent = str.slice(listStart + 1, listEnd)
    const items = listContent
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l)
    const suffix = str.slice(listEnd + 1).trim()
    return { items, suffix }
  }

  // Single item — no brackets
  return { items: [str], suffix: "" }
}

// ─── Matching & Redirect ─────────────────────────────────────────────────────

function applyRules(urlStr, rules) {
  let url
  try {
    url = new URL(urlStr)
  } catch {
    return null
  }

  const hostname = url.hostname

  for (const rule of rules) {
    const match = tryMatchRule(hostname, rule)
    if (match) {
      const item =
        rule.replaceItems[
          Math.floor(Math.random() * rule.replaceItems.length)
        ]
      const template = item + rule.replaceSuffix
      const newHostname = applyTemplate(template, match.captures)

      if (newHostname && newHostname !== hostname) {
        const newUrl = new URL(urlStr)
        newUrl.hostname = newHostname
        return newUrl.toString()
      }
    }
  }
  return null
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function tryMatchRule(hostname, rule) {
  const { matchItems, tldPattern, tldName, defaults } = rule

  for (const item of matchItems) {
    const captures = { ...defaults }

    // Build one regex for the full hostname: ^{hostPart}\.{tldPart}$
    // Using a combined regex allows the engine to backtrack through lazy quantifiers.
    const hostPart =
      item.type === "literal" ? escapeRegex(item.value) : item.pattern

    const tldPart = "(?<" + tldName + ">" + tldPattern + ")"

    let fullRe
    try {
      fullRe = new RegExp("^(?:" + hostPart + ")\\." + tldPart + "$")
    } catch (e) {
      continue
    }

    const m = hostname.match(fullRe)
    if (m) {
      if (m.groups) Object.assign(captures, m.groups)
      return { captures }
    }
  }
  return null
}

function applyTemplate(template, captures) {
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    return captures[name] !== undefined ? captures[name] : ""
  })
}

// ─── Test Helper ─────────────────────────────────────────────────────────────

/**
 * Returns rich debug info about what happened when testing a URL.
 * Used by the editor test panel.
 */
function testRules(urlStr, rules) {
  let url
  try {
    url = new URL(urlStr)
  } catch {
    return { error: "Invalid URL" }
  }

  const hostname = url.hostname
  const results = []

  for (let ri = 0; ri < rules.length; ri++) {
    const rule = rules[ri]
    const match = tryMatchRule(hostname, rule)
    if (match) {
      const allResults = rule.replaceItems.map((item) => {
        const template = item + rule.replaceSuffix
        const newHostname = applyTemplate(template, match.captures)
        const newUrl = new URL(urlStr)
        newUrl.hostname = newHostname
        return newUrl.toString()
      })
      results.push({
        ruleIndex: ri,
        captures: match.captures,
        redirects: allResults,
        chosen: allResults[0],
      })
      break // first matching rule wins
    }
  }

  return {
    url: urlStr,
    hostname,
    matched: results.length > 0,
    result: results[0] || null,
  }
}

/**
 * Domain Redirector — DSL Parser & Redirect Engine  v3
 *
 * Syntax overview:
 *
 *   REGEX DELIMITER: <pattern>   (< > never appear in URLs so no escaping needed)
 *
 * ── Match side ───────────────────────────────────────────────────────────────
 *
 *  Format A — list + explicit suffix
 *    [                           ]         suffix
 *      literal                   .com      literal .com  →  item.com
 *      <regex>                   com       literal com   →  itemcom   (no dot)
 *      <regex(.*:name)>          .(literal:name)
 *    ]                           .(<regex>:name)
 *
 *  Format B — full hostname match (no list)
 *    (literal.host:captureName)  — literal match, captures whole hostname
 *    (<regex>:captureName)       — regex match
 *    (literal)  (<regex>)        — unnamed variants
 *
 *  Format C — bare literal
 *    old.example.com
 *
 * ── Arrow ────────────────────────────────────────────────────────────────────
 *   ->                  (standalone line, or inline: host->other)
 *
 * ── Replace side ─────────────────────────────────────────────────────────────
 *   [item1\n item2].suffix   — list (random pick) + optional literal suffix
 *   single.host.{name}       — single template
 *   host.org/{path}#frag     — full URL template (path/hash present → full URL)
 *   {name}                   — inserts captured value
 *
 * ── Misc ─────────────────────────────────────────────────────────────────────
 *   ; comment    !name default    blank line = rule separator
 */

// ─── Utility ──────────────────────────────────────────────────────────────────

function stripComments(text) {
  return text
    .split("\n")
    .map((line) => {
      const idx = line.indexOf(";")
      return idx >= 0 ? line.slice(0, idx) : line
    })
    .join("\n")
}

/**
 * Convert DSL capture shorthand inside a regex string:
 *   (content:name)  →  (?<name>content)
 * This works whether the regex came from <...> or elsewhere.
 */
function convertNamedCaptures(regexStr) {
  return regexStr.replace(/\(([^)]+?):(\w+)\)/g, "(?<$2>$1)")
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Parse a token that may be:
 *   <regex(.*:name)>   → { isRegex: true,  pattern: convertedRegex }
 *   literal            → { isRegex: false, pattern: escapedLiteral }
 */
function parsePatternToken(token) {
  token = token.trim()
  if (token.startsWith("<") && token.endsWith(">")) {
    const inner = token.slice(1, -1)
    return { isRegex: true, pattern: convertNamedCaptures(inner) }
  }
  return { isRegex: false, pattern: escapeRegex(token) }
}

// ─── Top-level ────────────────────────────────────────────────────────────────

function parseRulesText(text) {
  const cleaned = stripComments(text)
  const blocks = []
  let currentBlock = ""
  let depth = 0
  let newlineCount = 0
  let onRightSide = false
  // Track line numbers: currentLineNum increments on each \n; blockStartLine records
  // the line of the first non-whitespace char of the current block.
  let currentLineNum = 0
  let blockStartLine = -1

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i]

    if (char === "[" || char === "(") depth++
    else if (char === "]" || char === ")") depth--

    // Record start line of this block on first real char
    if (
      blockStartLine === -1 &&
      char !== "\n" &&
      char.trim() !== ""
    ) {
      blockStartLine = currentLineNum
    }

    currentBlock += char

    if (char === "\n") {
      newlineCount++
      currentLineNum++
    } else if (char.trim() !== "") {
      newlineCount = 0
    }

    // Split only if we see a newline AND we are at the top level after the arrow
    if (
      depth === 0 &&
      onRightSide &&
      newlineCount > 0 &&
      !currentBlock.trim().endsWith("->")
    ) {
      const trimmed = currentBlock.trim()
      if (trimmed)
        blocks.push({ text: trimmed, startLine: blockStartLine })
      onRightSide = false
      currentBlock = ""
      newlineCount = 0
      blockStartLine = -1
    }
    if (depth === 0 && char == "-" && cleaned[i + 1] == ">") {
      onRightSide = true
    }
  }

  const finalTrimmed = currentBlock.trim()
  if (finalTrimmed)
    blocks.push({ text: finalTrimmed, startLine: blockStartLine })

  const rules = []
  for (const { text: blockText, startLine } of blocks) {
    try {
      const rule = parseRuleBlock(blockText)
      if (rule) {
        rule.startLine = startLine
        rules.push(rule)
      }
    } catch (e) {
      console.warn(
        "[DomainRedirector] Rule parse error:",
        e.message,
        "\nBlock:",
        blockText,
      )
    }
  }
  return rules
}

// ─── Block Parser ─────────────────────────────────────────────────────────────

function parseRuleBlock(block) {
  const lines = block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l)

  // Extract !default lines
  const defaults = {}
  const contentLines = []
  for (const line of lines) {
    if (line.startsWith("!")) {
      const m = line.match(/^!(\w+)\s+(.+)$/)
      if (m) defaults[m[1]] = m[2].trim()
    } else {
      contentLines.push(line)
    }
  }

  const content = contentLines.join("\n")

  // Find "->" — prefer standalone line, then inline (outside brackets)
  let matchStr, replaceStr
  const standaloneIdx = contentLines.findIndex((l) => l === "->")

  if (standaloneIdx >= 0) {
    matchStr = contentLines.slice(0, standaloneIdx).join("\n").trim()
    replaceStr = contentLines
      .slice(standaloneIdx + 1)
      .join("\n")
      .trim()
  } else {
    const arrowPos = findArrowOutsideBrackets(content)
    if (arrowPos < 0) return null
    matchStr = content.slice(0, arrowPos).trim()
    replaceStr = content.slice(arrowPos + 2).trim()
  }

  if (!matchStr || !replaceStr) return null

  const matchResult = parseMatchPattern(matchStr)
  const replaceResult = parseReplacePattern(replaceStr)
  if (!matchResult || !replaceResult) return null

  return { defaults, ...matchResult, ...replaceResult }
}

function findArrowOutsideBrackets(str) {
  let depth = 0
  for (let i = 0; i < str.length - 1; i++) {
    const c = str[i]
    if (c === "[" || c === "(") depth++
    else if (c === "]" || c === ")") depth--
    else if (depth === 0 && c === "-" && str[i + 1] === ">") return i
  }
  return -1
}

// ─── Match Pattern ────────────────────────────────────────────────────────────

function parseMatchPattern(str) {
  str = str.trim()
  if (str.startsWith("[")) return parseListPattern(str)
  if (str.startsWith("(")) return parseFullHostnamePattern(str)
  if (str && !str.includes("\n"))
    return { matchMode: "bare", bareLiteral: str }
  return null
}

// ── Format A: list ────────────────────────────────────────────────────────────

function parseListPattern(str) {
  const listStart = str.indexOf("[")
  const listEnd = str.lastIndexOf("]")
  if (listStart < 0 || listEnd < 0) return null

  const listContent = str.slice(listStart + 1, listEnd)
  const afterList = str.slice(listEnd + 1).trim() // everything after ]

  const matchItems = listContent
    .split(/\s+/)
    .map((l) => l.trim())
    .filter((l) => l)
    .map(parseListItem)

  // Parse the suffix after ]
  const suffix = parseSuffix(afterList)

  return { matchMode: "list", matchItems, suffix }
}

/**
 * Parse the text that comes after ] in a list pattern.
 *
 * Possible forms:
 *   (empty)              → no suffix
 *   .com                 → literal '.com'
 *   com                  → literal 'com'  (no dot — matches itemcom)
 *   .(<regex>:name)      → dot + regex capture named 'name'
 *   .(literal:name)      → dot + literal capture named 'name'
 *   .(<regex>)           → dot + unnamed regex
 *   .(literal)           → dot + unnamed literal
 *   (<regex>:name)       → no dot + regex capture  (unusual but valid)
 */
function parseSuffix(str) {
  str = str.trim()
  if (!str) return { type: "none" }

  let hasDot = false
  let rest = str

  if (str.startsWith(".")) {
    hasDot = true
    rest = str.slice(1) // strip the dot
  }

  if (rest.startsWith("(")) {
    // Paren capture group: (pattern:name) or (<regex>:name)
    const inner = rest.replace(/^\(/, "").replace(/\).*$/, "").trim()
    const gtIdx = inner.indexOf(">")

    let patternRaw, captureName

    if (inner.startsWith("<") && gtIdx >= 0) {
      // regex token  <pattern>:name  or  <pattern>
      const regexContent = inner.slice(1, gtIdx)
      const afterGt = inner.slice(gtIdx + 1).trim()
      const cm = afterGt.match(/^:(\w+)$/)
      patternRaw = convertNamedCaptures(regexContent)
      captureName = cm ? cm[1] : null
    } else {
      // literal token  literal:name  or  literal
      const cm = inner.match(/^(.*):(\w+)$/)
      if (cm) {
        patternRaw = escapeRegex(cm[1])
        captureName = cm[2]
      } else {
        patternRaw = escapeRegex(inner)
        captureName = null
      }
    }

    return {
      type: "capture",
      hasDot,
      pattern: patternRaw,
      captureName,
    }
  }

  // Plain literal (with or without leading dot already stripped into hasDot)
  // Re-attach dot for the literal so it matches correctly
  return { type: "literal", text: hasDot ? "." + rest : rest }
}

function parseListItem(str) {
  if (str.startsWith("<") && str.endsWith(">")) {
    const inner = str.slice(1, -1)
    return {
      type: "regex",
      pattern: convertNamedCaptures(inner),
      source: str,
    }
  }
  return { type: "literal", value: str, source: str }
}

// ── Format B: full-hostname capture ───────────────────────────────────────────

function parseFullHostnamePattern(str) {
  // (literal:name)  (<regex>:name)  (literal)  (<regex>)
  const inner = str.replace(/^\(/, "").replace(/\).*$/, "").trim()
  const gtIdx = inner.indexOf(">")

  let pattern, captureName

  if (inner.startsWith("<") && gtIdx >= 0) {
    const regexContent = inner.slice(1, gtIdx)
    const afterGt = inner.slice(gtIdx + 1).trim()
    const cm = afterGt.match(/^:(\w+)$/)
    pattern = convertNamedCaptures(regexContent)
    captureName = cm ? cm[1] : null
  } else {
    const cm = inner.match(/^(.*):(\w+)$/)
    if (cm) {
      pattern = escapeRegex(cm[1])
      captureName = cm[2]
    } else {
      pattern = escapeRegex(inner)
      captureName = null
    }
  }

  return {
    matchMode: "full-hostname",
    fullPattern: pattern,
    captureName,
  }
}

// ─── Replace Pattern ──────────────────────────────────────────────────────────

function parseReplacePattern(str) {
  str = str.trim()
  const listStart = str.indexOf("[")
  const listEnd = str.indexOf("]")

  if (listStart >= 0 && listEnd > listStart) {
    const items = str
      .slice(listStart + 1, listEnd)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l)
    const suffix = str.slice(listEnd + 1).trim()
    return { replaceItems: items, replaceSuffix: suffix }
  }
  return { replaceItems: [str], replaceSuffix: "" }
}

// ─── Matching ─────────────────────────────────────────────────────────────────

function tryMatchRule(hostname, rule) {
  const defaults = rule.defaults || {}

  // ── bare literal ──────────────────────────────────────────────────────────
  if (rule.matchMode === "bare") {
    return hostname === rule.bareLiteral ?
        { captures: { ...defaults } }
      : null
  }

  // ── full-hostname ─────────────────────────────────────────────────────────
  if (rule.matchMode === "full-hostname") {
    const captures = { ...defaults }
    const capPart =
      rule.captureName ?
        "(?<" + rule.captureName + ">" + rule.fullPattern + ")"
      : "(?:" + rule.fullPattern + ")"
    let re
    try {
      re = new RegExp("^" + capPart + "$")
    } catch {
      return null
    }
    const m = hostname.match(re)
    if (!m) return null
    if (m.groups) Object.assign(captures, m.groups)
    return { captures }
  }

  // ── list ──────────────────────────────────────────────────────────────────
  const { matchItems, suffix } = rule

  // Build suffix regex once (same for all items)
  let suffixRe = ""
  let suffixCapName = null

  if (suffix.type === "literal") {
    suffixRe = escapeRegex(suffix.text)
  } else if (suffix.type === "capture") {
    if (suffix.hasDot) suffixRe += "\\."
    suffixCapName = suffix.captureName
    suffixRe +=
      suffixCapName ?
        "(?<" + suffixCapName + ">" + suffix.pattern + ")"
      : "(?:" + suffix.pattern + ")"
  }
  // type === 'none' → suffixRe stays ''

  for (const item of matchItems) {
    const captures = { ...defaults }
    const hostPart =
      item.type === "literal" ? escapeRegex(item.value) : item.pattern

    let fullRe
    try {
      fullRe = new RegExp("^(?:" + hostPart + ")" + suffixRe + "$")
    } catch {
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

// ─── Template & URL Construction ──────────────────────────────────────────────

function applyTemplate(template, captures) {
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    captures[name] !== undefined ? captures[name] : "",
  )
}

function buildRedirectUrl(sourceUrl, resolved) {
  if (!resolved) return null
  try {
    if (
      resolved.includes("/") ||
      resolved.includes("#") ||
      resolved.includes("?")
    ) {
      return new URL(sourceUrl.protocol + "//" + resolved).toString()
    }
    const u = new URL(sourceUrl.toString())
    u.hostname = resolved
    return u.toString()
  } catch {
    return null
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

function applyRules(urlStr, rules) {
  let url
  try {
    url = new URL(urlStr)
  } catch {
    return null
  }

  for (const rule of rules) {
    const match = tryMatchRule(url.hostname, rule)
    if (match) {
      const item =
        rule.replaceItems[
          Math.floor(Math.random() * rule.replaceItems.length)
        ]
      const resolved = applyTemplate(
        item + rule.replaceSuffix,
        match.captures,
      )
      const redirect = buildRedirectUrl(url, resolved)
      if (redirect && redirect !== urlStr) return redirect
    }
  }
  return null
}

function testRules(urlStr, rules) {
  let url
  try {
    url = new URL(urlStr)
  } catch {
    return { error: "Invalid URL" }
  }

  const hostname = url.hostname
  for (let ri = 0; ri < rules.length; ri++) {
    const rule = rules[ri]
    const match = tryMatchRule(hostname, rule)
    if (match) {
      const allResults = rule.replaceItems.map((item) => {
        const resolved = applyTemplate(
          item + rule.replaceSuffix,
          match.captures,
        )
        return buildRedirectUrl(url, resolved) || resolved
      })
      return {
        url: urlStr,
        hostname,
        matched: true,
        result: {
          ruleIndex: ri,
          captures: match.captures,
          redirects: allResults,
          chosen: allResults[0],
        },
      }
    }
  }
  return { url: urlStr, hostname, matched: false, result: null }
}

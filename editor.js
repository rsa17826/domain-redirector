// editor.js — Domain Redirector rules editor

// ═══════════════════════════════════════════════════════════════════════
//  CodeMirror Mode: domredir
//  Syntax: <regex>  ()  []  .suffix  !default  -> {var}  ; comment
// ═══════════════════════════════════════════════════════════════════════

CodeMirror.defineMode("domredir", function () {
  const CTX = {
    TOP: "top", // between rules / match side
    DEFAULT_BANG: "default-bang", // just consumed !
    // DEFAULT_NAME: "default-name", // reading the capture name after !
    DEFAULT_VAL: "default-val", // reading the default value
    MATCH_LIST: "match-list", // inside [ ]
    REGEX_ITEM: "regex-item", // inside < > within match list
    SUFFIX: "suffix", // after ] on match side
    SUFFIX_PAREN: "suffix-paren", // inside ( ) after ]
    FULL_PAREN: "full-paren", // top-level ( ) full-hostname match
    INNER_REGEX: "inner-regex", // inside < > within paren/suffix
  }

  return {
    startState() {
      return {
        ctx: CTX.TOP,
        afterArrow: false,
        angleDepth: 0,
        parenDepth: 0,
      }
    },
    copyState(s) {
      return { ...s }
    },

    token(stream, state) {
      if (stream.eatSpace()) return null

      // ── Comments ──────────────────────────────────────────────────────
      if (stream.peek() === ";") {
        stream.skipToEnd()
        return "domredir-comment"
      }

      // ── Arrow -> ──────────────────────────────────────────────────────
      // Must check BEFORE stream.next() so we match the full "->" together.
      // eatWhile stops at "-" when followed by ">" so we always arrive here
      // with the stream positioned at "-".
      if (stream.match("->")) {
        // Stay in CTX.TOP — afterArrow flag routes replace-side coloring.
        // (Using a separate CTX.ARROW caused the switch to fall through to null.)
        return "domredir-arrow"
      }

      const ch = stream.next()

      // ── ! default bang ────────────────────────────────────────────────
      // Split into three tokens: "!" · "name" · "value"
      if (ch === "!") {
        state.ctx = CTX.DEFAULT_BANG
        return "domredir-default-bang" // just the "!" character
      }
      if (state.ctx === CTX.DEFAULT_BANG) {
        stream.eatWhile(/\w/) // eat the capture name
        state.ctx = CTX.DEFAULT_VAL
        return "domredir-default-name"
      }
      if (state.ctx === CTX.DEFAULT_VAL) {
        stream.skipToEnd()
        state.ctx = CTX.TOP
        return "domredir-default-value"
      }

      // ── [ open bracket ────────────────────────────────────────────────
      if (ch === "[") {
        state.ctx = CTX.MATCH_LIST
        return "domredir-bracket"
      }

      // ── ] close bracket ───────────────────────────────────────────────
      if (ch === "]") {
        if (state.ctx === CTX.MATCH_LIST) state.ctx = CTX.SUFFIX
        // else if (state.ctx === CTX.REPLACE_LIST) state.ctx = CTX.TOP
        return "domredir-bracket"
      }

      // ── < open angle — start of regex ────────────────────────────────
      if (ch === "<") {
        state.angleDepth++
        if (state.ctx === CTX.MATCH_LIST) state.ctx = CTX.REGEX_ITEM
        else if (
          state.ctx === CTX.SUFFIX_PAREN ||
          state.ctx === CTX.FULL_PAREN
        )
          state.ctx = CTX.INNER_REGEX
        return "domredir-angle"
      }

      // ── > close angle — end of regex ─────────────────────────────────
      // Guard: only act as angle-close if we are actually inside a regex.
      // Without this, a stray ">" (e.g. from "eatWhile eating com->" badly)
      // would corrupt context. Now fixed via eatWhile lookahead too, but
      // the guard is defense-in-depth.
      if (ch === ">" && state.angleDepth > 0) {
        state.angleDepth--
        if (state.ctx === CTX.REGEX_ITEM) state.ctx = CTX.MATCH_LIST
        else if (state.ctx === CTX.INNER_REGEX)
          state.ctx =
            state.parenDepth > 0 ? CTX.SUFFIX_PAREN : CTX.SUFFIX
        return "domredir-angle"
      }

      // ── ( open paren ──────────────────────────────────────────────────
      if (ch === "(") {
        state.parenDepth++
        if (state.ctx === CTX.SUFFIX) state.ctx = CTX.SUFFIX_PAREN
        else if (state.ctx === CTX.TOP) state.ctx = CTX.FULL_PAREN
        return "domredir-paren"
      }

      // ── ) close paren ─────────────────────────────────────────────────
      if (ch === ")") {
        state.parenDepth = Math.max(0, state.parenDepth - 1)
        if (state.parenDepth === 0) state.ctx = CTX.TOP
        return "domredir-paren"
      }

      // ── : colon — capture name inside angle/paren ────────────────────
      if (
        ch === ":" &&
        (state.ctx === CTX.SUFFIX_PAREN ||
          state.ctx === CTX.FULL_PAREN ||
          state.ctx === CTX.REGEX_ITEM ||
          state.ctx === CTX.INNER_REGEX)
      ) {
        stream.eatWhile(/\w/)
        return "domredir-capture-name"
      }

      // ── { template variable ───────────────────────────────────────────
      if (ch === "{") {
        stream.eatWhile(/\w/)
        if (stream.peek() === "}") stream.next()
        return "domredir-tvar"
      }

      // ── . dot ─────────────────────────────────────────────────────────
      // On replace side (afterArrow) dots are part of the hostname template
      // so colour them the same as replace-literal (orange).
      // On match side suffix they get a muted colour to visually separate.
      if (ch === ".") {
        if (state.ctx === CTX.SUFFIX || state.ctx === CTX.TOP)
          return "domredir-replace-literal"
        // return "domredir-dot"
      }

      // ── Content by context ────────────────────────────────────────────
      // IMPORTANT: also stop before "->" to prevent eating the "-" of the arrow
      // and leaving a stray ">" that would corrupt state.
      stream.eatWhile((c) => {
        if (/[;{}\[\]()<>.:\n]/.test(c)) return false
        // stop at the start of "->" so the next token() call can match it whole
        if (c === "-" && stream.string[stream.pos + 1] === ">")
          return false
        return true
      })

      switch (state.ctx) {
        case CTX.MATCH_LIST:
          return "domredir-literal"
        case CTX.REGEX_ITEM:
          return "domredir-regex"
        case CTX.INNER_REGEX:
          return "domredir-regex"
        case CTX.SUFFIX_PAREN:
          return "domredir-regex"
        case CTX.FULL_PAREN:
          return "domredir-literal"
        case CTX.SUFFIX:
          return "domredir-tld"
        case CTX.TOP:
          return "domredir-literal"
        default:
          return null
      }
    },

    lineComment: ";",
  }
})

CodeMirror.defineMIME("text/x-domredir", "domredir")

// ═══════════════════════════════════════════════════════════════════════
//  Default example rules
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_RULES = `; ─────────────────────────────────────────────
; Domain Redirector — Example Rules
; ─────────────────────────────────────────────
;
; REGEX SYNTAX:  <pattern>
;   < > delimit regex (they never appear in URLs, no escaping needed)
;   Named captures inside regex:  <aa(.*:myname)>
;   Named captures in parens:     .(com:tld)  or  .(<.*>:tld)
;
; RULE FORMATS:
;   [list].(<tld-regex>:name)  ->  [list].{name}
;   [list].com                 ->  ...   literal TLD (dot explicit)
;   [list]com                  ->  ...   no-dot suffix (zcom, xcom …)
;   (host.com:capname)         ->  ...   full hostname capture
;   (<regex>:capname)          ->  ...   full hostname regex capture
;   old.com -> new.org         bare literal redirect
;   old.com->new.org           compact inline
;   !name default              set default for a named capture
; ─────────────────────────────────────────────

; Redirect old-site.* and legacy.* → new-site.*  (any TLD)
[
  old-site
  legacy
].(<.*>:tld)
->
new-site.{tld}


; Regex item: api-v1.com, api-v2.org, …  →  v1.api.com, v2.api.org
[
  <api-(.*:ver)>
].(<.*>:tld)
->
{ver}.api.{tld}


; Default capture + multiple targets (randomly chosen)
!env prod
[
  app
  <app-(.*:env)>
].(<.*>:tld)
->
[
  app-{env}-1
  app-{env}-2
].{tld}


; Literal TLD (no capture needed)  z.com x.com c.com → s.org
[
  z
  x
  c
].com
->
[
  s
].org


; Full-hostname literal capture → URL template
(basdsite.com:url)
->
blocked.org/{url}#blocked


; Full-hostname regex capture
(<legacy-.*>:host)
->
archive.example.com/{host}


; Bare literal redirect
badsite.com
->
goodsite.org


; Compact inline
old.example.com->new.example.com
`

// ═══════════════════════════════════════════════════════════════════════
//  Editor Initialization
// ═══════════════════════════════════════════════════════════════════════

let editor
let currentRules = []
let enabled = true
let dirty = false

function initEditor() {
  editor = CodeMirror.fromTextArea(
    document.getElementById("codeEditor"),
    {
      mode: "domredir",
      theme: "dracula",
      lineNumbers: true,
      matchBrackets: true,
      indentWithTabs: false,
      tabSize: 2,
      indentUnit: 2,
      lineWrapping: false,
      autofocus: true,
      foldGutter: true,
      gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"],
      extraKeys: {
        "Ctrl-S": saveRules,
        "Cmd-S": saveRules,
        "Ctrl-/": "toggleComment",
        "Cmd-/": "toggleComment",
        Tab: (cm) => cm.execCommand("indentMore"),
        "Shift-Tab": (cm) => cm.execCommand("indentLess"),
      },
      styleActiveLine: true,
    },
  )

  editor.on("change", () => {
    dirty = true
    updateSaveBtn(false)
    scheduleValidate()
  })

  editor.on("cursorActivity", updateCursor)

  chrome.storage.sync.get(
    { rulesText: DEFAULT_RULES, enabled: true },
    (data) => {
      editor.setValue(data.rulesText || DEFAULT_RULES)
      enabled = data.enabled
      dirty = false
      validateRules()
      updateToggleBtn()
      updateStatusBadge()
    },
  )

  // Check for ?testUrl param
  const params = new URLSearchParams(location.search)
  const testUrl = params.get("testUrl")
  if (testUrl) {
    document.getElementById("testUrlInput").value = testUrl
    setTimeout(runTest, 600)
  }
}

// ── Validation ────────────────────────────────────────────────────────

let validateTimer
function scheduleValidate() {
  clearTimeout(validateTimer)
  validateTimer = setTimeout(validateRules, 350)
}

function validateRules() {
  const errorsPanel = document.getElementById("errorsPanel")
  errorsPanel.innerHTML = ""
  try {
    currentRules = parseRulesText(editor.getValue())
    document.getElementById("sb-rules").textContent =
      currentRules.length +
      " rule" +
      (currentRules.length !== 1 ? "s" : "")
  } catch (e) {
    const el = document.createElement("div")
    el.className = "error-item"
    el.textContent = "⚠ " + e.message
    errorsPanel.appendChild(el)
    currentRules = []
  }
}

// ── Save ──────────────────────────────────────────────────────────────

function saveRules() {
  validateRules()
  chrome.storage.sync.set({ rulesText: editor.getValue() }, () => {
    dirty = false
    updateSaveBtn(true)
    setTimeout(() => updateSaveBtn(false), 1500)
  })
}

function updateSaveBtn(saved) {
  const btn = document.getElementById("saveBtn")
  if (saved) {
    btn.textContent = "✓ Saved"
    btn.className = "btn btn-saved"
  } else {
    btn.innerHTML =
      dirty ? "💾 Save* <kbd>⌘S</kbd>" : "💾 Save <kbd>⌘S</kbd>"
    btn.className = "btn btn-primary"
  }
}

document
  .getElementById("saveBtn")
  .addEventListener("click", saveRules)

// ── Toggle ────────────────────────────────────────────────────────────

function updateToggleBtn() {
  document.getElementById("toggleBtnIcon").textContent =
    enabled ? "⏸" : "▶"
  document.getElementById("toggleBtnText").textContent =
    enabled ? "Pause" : "Resume"
}

function updateStatusBadge() {
  const badge = document.getElementById("statusBadge")
  const text = document.getElementById("statusBadgeText")
  badge.className = "badge " + (enabled ? "ok" : "err")
  text.textContent = enabled ? "Active" : "Paused"
}

document.getElementById("toggleBtn").addEventListener("click", () => {
  enabled = !enabled
  chrome.storage.sync.set({ enabled }, () => {
    updateToggleBtn()
    updateStatusBadge()
  })
})

// ── Cursor ────────────────────────────────────────────────────────────

function updateCursor() {
  const pos = editor.getCursor()
  document.getElementById("sb-cursor").textContent = `Ln ${
    pos.line + 1
  }, Col ${pos.ch + 1}`
}

// ═══════════════════════════════════════════════════════════════════════
//  Test Panel
// ═══════════════════════════════════════════════════════════════════════

const testInput = document.getElementById("testUrlInput")
const testResult = document.getElementById("testResult")

document
  .getElementById("testRunBtn")
  .addEventListener("click", runTest)
testInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runTest()
})

function runTest() {
  let urlStr = testInput.value.trim()
  if (!urlStr) {
    testResult.innerHTML = ""
    return
  }
  if (!urlStr.includes("://")) urlStr = "http://" + urlStr

  validateRules()
  renderTestResult(testRules(urlStr, currentRules))
}

function renderTestResult(result) {
  if (result.error) {
    testResult.innerHTML = `<div class="test-match-box">
      <div class="test-match-row">
        <span class="test-match-value no-match">⚠ ${esc(
          result.error,
        )}</span>
      </div></div>`
    return
  }

  if (!result.matched) {
    testResult.innerHTML = `<div class="test-match-box">
      <div class="test-match-row">
        <span class="test-match-label">INPUT</span>
        <span class="test-match-value">${esc(result.hostname)}</span>
      </div>
      <div class="test-match-row">
        <span class="test-match-value no-match">✗ No rule matched</span>
      </div></div>`
    return
  }

  const r = result.result
  const caps = Object.entries(r.captures || {}).filter(
    ([k]) => !k.startsWith("_"),
  )

  const capturesHtml =
    caps.length > 0 ?
      `
    <div class="test-captures">
      <div class="test-capture-title">Captures</div>
      <div class="test-capture-list">
        ${caps
          .map(
            ([k, v]) => `<span class="capture-chip">
          <span class="cap-name">${esc(k)}</span>
          <span class="cap-eq">=</span>
          <span class="cap-val">${esc(v)}</span>
        </span>`,
          )
          .join("")}
      </div>
    </div>`
    : ""

  const altHtml =
    r.redirects && r.redirects.length > 1 ?
      `
    <div class="test-alt-list">
      <div class="test-alt-title">All targets (random pick)</div>
      ${r.redirects
        .map((u) => `<div class="test-alt-item">→ ${esc(u)}</div>`)
        .join("")}
    </div>`
    : ""

  testResult.innerHTML = `<div class="test-match-box">
    <div class="test-match-row">
      <span class="test-match-label">INPUT</span>
      <span class="test-match-value">${esc(result.url)}</span>
    </div>
    <div class="test-match-row">
      <span class="test-match-label">RULE</span>
      <span class="test-match-value rule-idx">#${
        r.ruleIndex + 1
      }</span>
    </div>
    <div class="test-match-row">
      <span class="test-match-label">OUTPUT</span>
      <span class="test-match-value redirect">${esc(
        r.chosen || "—",
      )}</span>
    </div>
    ${capturesHtml}${altHtml}
  </div>`
}

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

// ═══════════════════════════════════════════════════════════════════════
//  CSS token colors (injected so theme applies to our tokens)
// ═══════════════════════════════════════════════════════════════════════

const TOKEN_CSS = `
.cm-s-dracula .cm-domredir-comment          { color: #5c6370; font-style: italic; }

/* !name default  — three distinct tokens */
.cm-s-dracula .cm-domredir-default-bang     { color: #ff7b72; font-weight: bold; }  /* !   red     */
.cm-s-dracula .cm-domredir-default-name     { color: #e3b341; font-weight: bold; }  /* env yellow  */
.cm-s-dracula .cm-domredir-default-value    { color: #79c0ff; }                      /* prod blue   */

/* ->  arrow */
.cm-s-dracula .cm-domredir-arrow            { color: #ff7b72; font-weight: bold; }

/* brackets, parens, angle */
.cm-s-dracula .cm-domredir-bracket          { color: #79c0ff; font-weight: bold; }
.cm-s-dracula .cm-domredir-paren            { color: #79c0ff; font-weight: bold; }
.cm-s-dracula .cm-domredir-angle            { color: #3fb950; font-weight: bold; }

/* match-side items */
.cm-s-dracula .cm-domredir-literal          { color: #ffa657; }   /* orange — hostnames  */
.cm-s-dracula .cm-domredir-regex            { color: #a5d6ff; }   /* light blue — regex  */
.cm-s-dracula .cm-domredir-tld              { color: #e3b341; }   /* yellow — TLD suffix */
.cm-s-dracula .cm-domredir-dot              { color: #636e7b; }   /* dim — separators    */

/* captures */
.cm-s-dracula .cm-domredir-capture-name     { color: #7ee787; font-weight: bold; }  /* green */

/* {var} template */
.cm-s-dracula .cm-domredir-tvar             { color: #bc8cff; font-weight: bold; }  /* purple */

/* replace-side: orange, same as match literals, dots included */
.cm-s-dracula .cm-domredir-replace-literal  { color: #ffa657; }
`

const styleEl = document.createElement("style")
styleEl.textContent = TOKEN_CSS
document.head.appendChild(styleEl)

// ═══════════════════════════════════════════════════════════════════════
//  Boot — wait for CDN CodeMirror
// ═══════════════════════════════════════════════════════════════════════

function waitForCodeMirror(cb, attempts = 0) {
  if (typeof CodeMirror !== "undefined") {
    cb()
  } else if (attempts < 60) {
    setTimeout(() => waitForCodeMirror(cb, attempts + 1), 100)
  } else {
    // Fallback: plain textarea
    const ta = document.getElementById("codeEditor")
    ta.style.cssText =
      "width:100%;height:100%;background:#0d1117;color:#e6edf3;font-family:monospace;font-size:13px;border:none;padding:12px;resize:none;outline:none;"
    editor = {
      getValue: () => ta.value,
      setValue: (v) => {
        ta.value = v
      },
    }
    ta.addEventListener("input", scheduleValidate)
    chrome.storage.sync.get({ rulesText: DEFAULT_RULES }, (d) => {
      ta.value = d.rulesText || DEFAULT_RULES
      validateRules()
    })
  }
}

waitForCodeMirror(initEditor)
// ─── Fold Helper for ; region / ; endregion ─────────────────────────────────
function stripComments(text) {
  return text
    .split("\n")
    .map((line) => {
      const idx = line.indexOf(";")
      return idx >= 0 ? line.slice(0, idx) : line
    })
    .join("\n")
}
var lastDetectedEnd = -1
CodeMirror.registerHelper("fold", "domredir", function (cm, start) {
  if (lastDetectedEnd == start.line) {
    lastDetectedEnd = -1
    return
  }
  const lineText = cm.getLine(start.line)
  const trimmed = lineText.trim()

  // 1. EXIT: Don't start on empty, comments, or lines that already have the arrow
  if (
    !trimmed ||
    trimmed.startsWith(";") ||
    lineText.includes("->")
  ) {
    return undefined
  }

  // 2. EXIT: Only start if the line looks like a Match Side (starts with [, (, <, or Alphanumeric)
  if (!/^[\[\(\<a-zA-Z0-9]/.test(trimmed)) return undefined

  const lastLine = cm.lastLine()
  let depth = 0
  let foundArrowOnSubsequentLine = false
  let endLine = -1

  for (let i = start.line; i <= lastLine; i++) {
    const line = cm.getLine(i)

    // Process characters for depth and arrow detection
    asd: for (let j = 0; j < line.length; j++) {
      const char = line[j]
      if (char === "[" || char === "(") depth++
      else if (char === "]" || char === ")") depth--

      // Look for -> at the top level on any line AFTER the start line
      if (depth === 0 && char === "-" && line[j + 1] === ">") {
        if (i > start.line) foundArrowOnSubsequentLine = true
        else {
          break asd
        }
      }
    }

    // 3. Block End Logic: Depth 0 + Found Arrow + Double Newline (or EOF)
    if (
      depth === 0 &&
      foundArrowOnSubsequentLine
    ) {
      endLine = i
      break
    }

    // 4. Safety: If we hit another potential rule start before finding an arrow, kill this fold
    if (
      i > start.line &&
      depth === 0 &&
      line.trim() !== "" &&
      !foundArrowOnSubsequentLine
    ) {
      break
    }
  }

  // 5. Final return
  if (foundArrowOnSubsequentLine && endLine > start.line) {
    lastDetectedEnd = endLine
    return {
      from: CodeMirror.Pos(start.line, lineText.length),
      to: CodeMirror.Pos(endLine, cm.getLine(endLine).length),
    }
  }

  return undefined
})

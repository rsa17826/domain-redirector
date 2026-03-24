// editor.js — Domain Redirector rules editor

// ═══════════════════════════════════════════════════════════════════════
//  CodeMirror Mode: domredir
//  Syntax: <regex>  ()  []  .suffix  !default  -> {var}  ; comment
// ═══════════════════════════════════════════════════════════════════════

CodeMirror.defineMode("domredir", function () {
  // Contexts for the state machine
  const CTX = {
    TOP: "top", // between rules / before match
    DEFAULT_NAME: "default-name", // after ! until end of name
    DEFAULT_VAL: "default-val", // rest of !name <value> line
    MATCH_LIST: "match-list", // inside [ ]  on match side
    REGEX_ITEM: "regex-item", // inside < >  within match list
    SUFFIX: "suffix", // after ] (tld suffix)
    SUFFIX_PAREN: "suffix-paren", // inside ( ) after ]
    FULL_PAREN: "full-paren", // top-level ( ) full-hostname match
    INNER_REGEX: "inner-regex", // inside < > in a paren or suffix
    ARROW: "arrow", // the -> token
    REPLACE_LIST: "replace-list", // inside [ ] on replace side
    REPLACE_SINGLE: "replace-single", // single-item replace
  }

  return {
    startState() {
      return {
        ctx: CTX.TOP,
        afterArrow: false,
        angleDepth: 0, // depth inside < >
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
      if (stream.match("->")) {
        state.ctx = CTX.ARROW
        state.afterArrow = true
        return "domredir-arrow"
      }

      const ch = stream.next()

      // ── !default declaration ──────────────────────────────────────────
      if (ch === "!" && !state.afterArrow) {
        stream.eatWhile(/\w/) // eat the name
        // rest of line = value (handled on next token call)
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
        state.ctx = state.afterArrow
          ? CTX.REPLACE_LIST
          : CTX.MATCH_LIST
        return "domredir-bracket"
      }

      // ── ] close bracket ───────────────────────────────────────────────
      if (ch === "]") {
        if (state.ctx === CTX.MATCH_LIST) state.ctx = CTX.SUFFIX
        else if (state.ctx === CTX.REPLACE_LIST) state.ctx = CTX.TOP
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
      if (ch === ">") {
        state.angleDepth--
        if (state.ctx === CTX.REGEX_ITEM) state.ctx = CTX.MATCH_LIST
        else if (state.ctx === CTX.INNER_REGEX) {
          // Back to the paren context
          state.ctx =
            state.parenDepth > 0 ? CTX.SUFFIX_PAREN : CTX.SUFFIX
        }
        return "domredir-angle"
      }

      // ── ( open paren ──────────────────────────────────────────────────
      if (ch === "(") {
        state.parenDepth++
        if (
          state.ctx === CTX.SUFFIX ||
          (state.ctx === CTX.TOP && !state.afterArrow)
        )
          state.ctx =
            state.ctx === CTX.SUFFIX
              ? CTX.SUFFIX_PAREN
              : CTX.FULL_PAREN
        return "domredir-paren"
      }

      // ── ) close paren ─────────────────────────────────────────────────
      if (ch === ")") {
        state.parenDepth--
        if (state.parenDepth <= 0) {
          state.parenDepth = 0
          state.ctx = CTX.TOP
        }
        return "domredir-paren"
      }

      // ── : colon — capture name separator inside parens ───────────────
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

      // ── . dot (in suffix position) ────────────────────────────────────
      if (
        ch === "." &&
        (state.ctx === CTX.SUFFIX ||
          state.ctx === CTX.REPLACE_SINGLE ||
          state.ctx === CTX.TOP)
      ) {
        return "domredir-dot"
      }

      // ── Content by context ────────────────────────────────────────────
      stream.eatWhile((c) => !/[;{}\[\]()<>.:\n]/.test(c))

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
        case CTX.REPLACE_LIST:
          return "domredir-replace-literal"
        case CTX.REPLACE_SINGLE:
          return "domredir-replace-literal"
        case CTX.TOP:
          return state.afterArrow
            ? "domredir-replace-literal"
            : "domredir-literal"
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
      extraKeys: {
        "Ctrl-S": saveRules,
        "Cmd-S": saveRules,
        "Ctrl-/": "toggleComment",
        "Cmd-/": "toggleComment",
        Tab: (cm) => cm.execCommand("indentMore"),
        "Shift-Tab": (cm) => cm.execCommand("indentLess"),
      },
      styleActiveLine: true,
    }
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
    }
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
    btn.innerHTML = dirty
      ? "💾 Save* <kbd>⌘S</kbd>"
      : "💾 Save <kbd>⌘S</kbd>"
    btn.className = "btn btn-primary"
  }
}

document
  .getElementById("saveBtn")
  .addEventListener("click", saveRules)

// ── Toggle ────────────────────────────────────────────────────────────

function updateToggleBtn() {
  document.getElementById("toggleBtnIcon").textContent = enabled
    ? "⏸"
    : "▶"
  document.getElementById("toggleBtnText").textContent = enabled
    ? "Pause"
    : "Resume"
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
          result.error
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
    ([k]) => !k.startsWith("_")
  )

  const capturesHtml =
    caps.length > 0
      ? `
    <div class="test-captures">
      <div class="test-capture-title">Captures</div>
      <div class="test-capture-list">
        ${caps
          .map(
            ([k, v]) => `<span class="capture-chip">
          <span class="cap-name">${esc(k)}</span>
          <span class="cap-eq">=</span>
          <span class="cap-val">${esc(v)}</span>
        </span>`
          )
          .join("")}
      </div>
    </div>`
      : ""

  const altHtml =
    r.redirects && r.redirects.length > 1
      ? `
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
        r.chosen || "—"
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
.cm-s-dracula .cm-domredir-comment        { color: #6a737d; font-style: italic; }
.cm-s-dracula .cm-domredir-default-name   { color: #ff7b72; font-weight: bold; }
.cm-s-dracula .cm-domredir-default-value  { color: #a5d6ff; }
.cm-s-dracula .cm-domredir-arrow          { color: #ff7b72; font-weight: bold; font-size: 15px; }
.cm-s-dracula .cm-domredir-bracket        { color: #79c0ff; font-weight: bold; }
.cm-s-dracula .cm-domredir-paren          { color: #a5d6ff; font-weight: bold; }
.cm-s-dracula .cm-domredir-angle          { color: #3fb950; font-weight: bold; }
.cm-s-dracula .cm-domredir-regex          { color: #a5d6ff; }
.cm-s-dracula .cm-domredir-literal        { color: #ffa657; }
.cm-s-dracula .cm-domredir-capture-name   { color: #7ee787; font-weight: bold; }
.cm-s-dracula .cm-domredir-tvar           { color: #bc8cff; font-weight: bold; }
.cm-s-dracula .cm-domredir-dot            { color: #8b949e; }
.cm-s-dracula .cm-domredir-tld            { color: #e3b341; }
.cm-s-dracula .cm-domredir-replace-literal{ color: #ffa657; }
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

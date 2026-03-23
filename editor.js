// editor.js — Domain Redirector rules editor

// ═══════════════════════════════════════════════════════════════════════
//  CodeMirror Mode: domredir
// ═══════════════════════════════════════════════════════════════════════

CodeMirror.defineMode('domredir', function () {
  /**
   * State machine contexts:
   *   'top'             — between rules
   *   'defaults'        — inside rule preamble (!name val lines)
   *   'match-list'      — inside [...] on match side
   *   'match-after'     — after ] on match side, expecting (tld)
   *   'match-paren'     — inside (...) on match side
   *   'arrow'           — saw ->
   *   'replace-list'    — inside [...] on replace side
   *   'replace-after'   — after ] on replace side (suffix)
   *   'inline-replace'  — single-item replace (no brackets)
   */
  return {
    startState() {
      return {
        ctx: 'top',       // current context
        parenDepth: 0,    // depth inside ()
        afterArrow: false,
        lineStart: true,
        inDefault: false, // parsing default value (after !name)
      };
    },

    copyState(s) {
      return { ...s };
    },

    token(stream, state) {
      // ── Whitespace ──────────────────────────────────────────────────
      if (stream.eatSpace()) {
        state.lineStart = false;
        return null;
      }

      const sol = stream.sol() || state.lineStart;
      state.lineStart = false;

      // ── Comments ─────────────────────────────────────────────────────
      if (stream.peek() === ';') {
        stream.skipToEnd();
        return 'domredir-comment';
      }

      // ── Arrow -> ──────────────────────────────────────────────────────
      if (stream.match('->')) {
        state.ctx = 'arrow';
        state.afterArrow = true;
        return 'domredir-arrow';
      }

      const ch = stream.next();

      // ── Default declaration: !name [value...] ─────────────────────────
      if (ch === '!' && (state.ctx === 'top' || state.ctx === 'defaults')) {
        state.ctx = 'defaults';
        // Eat the name
        stream.eatWhile(/\w/);
        state.inDefault = true;
        return 'domredir-default-name';
      }

      if (state.inDefault) {
        // Rest of line is the default value
        stream.skipToEnd();
        state.inDefault = false;
        return 'domredir-default-value';
      }

      // ── Open bracket [ ────────────────────────────────────────────────
      if (ch === '[') {
        if (!state.afterArrow) {
          state.ctx = 'match-list';
        } else {
          state.ctx = 'replace-list';
        }
        return 'domredir-bracket';
      }

      // ── Close bracket ] ───────────────────────────────────────────────
      if (ch === ']') {
        if (state.ctx === 'match-list') state.ctx = 'match-after';
        else if (state.ctx === 'replace-list') state.ctx = 'replace-after';
        return 'domredir-bracket';
      }

      // ── Open paren ( ─────────────────────────────────────────────────
      if (ch === '(') {
        state.parenDepth++;
        if (state.ctx === 'match-after') state.ctx = 'match-paren';
        return 'domredir-paren';
      }

      // ── Close paren ) ─────────────────────────────────────────────────
      if (ch === ')') {
        state.parenDepth--;
        if (state.parenDepth === 0) {
          if (state.ctx === 'match-paren') state.ctx = 'top';
          else if (state.ctx === 'match-list') {
            // paren inside match list item
          }
        }
        return 'domredir-paren';
      }

      // ── Template variable {name} ──────────────────────────────────────
      if (ch === '{') {
        stream.eatWhile(/\w/);
        if (stream.peek() === '}') stream.next();
        return 'domredir-tvar-name';
      }

      // ── Named capture colon :name ─────────────────────────────────────
      if (ch === ':' && state.parenDepth > 0) {
        stream.eatWhile(/\w/);
        return 'domredir-capture-name';
      }

      // ── Dot separator ─────────────────────────────────────────────────
      if (ch === '.' && (state.ctx === 'replace-after' || state.ctx === 'inline-replace' ||
                          state.ctx === 'top' || state.ctx === 'replace-list')) {
        return 'domredir-dot';
      }

      // ── Forward slash — start of regex ────────────────────────────────
      if (ch === '/') {
        // Regex content follows until end of logical token
        // In match-list: reads until EOL or ; (whole line is the regex)
        if (state.ctx === 'match-list' || state.ctx === 'match-paren' ||
            state.ctx === 'match-after') {
          // We already consumed /, now read the rest as regex content
          // But we need to handle :name captures inside
          // We'll read char-by-char and stop at :word) or EOL
          // Simpler: read to EOL and let internal tokenizer handle next tokens
          // Actually just read up to next ; or EOL
          let regexContent = '';
          while (!stream.eol() && stream.peek() !== ';') {
            const nc = stream.peek();
            if (nc === ':' && state.parenDepth > 0) break;
            if (nc === ')' && state.parenDepth > 0) break;
            regexContent += stream.next();
          }
          return 'domredir-regex';
        }
        return null;
      }

      // ── Content by context ────────────────────────────────────────────

      // Eat until a special char
      stream.eatWhile(c => !/[;{}\[\]()\n:./]/.test(c));

      if (state.ctx === 'match-list') return 'domredir-literal';
      if (state.ctx === 'match-paren') return 'domredir-regex';
      if (state.ctx === 'match-after') return 'domredir-regex';
      if (state.ctx === 'replace-list') return 'domredir-replace-literal';
      if (state.ctx === 'replace-after') return 'domredir-replace-literal';
      if (state.ctx === 'inline-replace') return 'domredir-replace-literal';
      if (state.ctx === 'defaults') return 'domredir-default-value';

      return null;
    },

    lineComment: ';',
    blockCommentStart: null,
    blockCommentEnd: null,
  };
});

// Register MIME type
CodeMirror.defineMIME('text/x-domredir', 'domredir');

// ═══════════════════════════════════════════════════════════════════════
//  Editor Initialization
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_RULES = `; ──────────────────────────────────────────────
; Domain Redirector — Example Rules
; ──────────────────────────────────────────────
; Syntax:
;   [match list](/<tld-regex>:<name>)  ->  [replace list].<name>
;   !name default    — default value for capture
;   /regex           — regex pattern in list
;   {name}           — insert captured value

; Simple: redirect old-site.* → new-site.*
[
  old-site
  legacy-app
](/.*:tld)
->
new-site.{tld}


; Regex match with capture
; api-v1.example.com → v1.api.example.com
[
  /api-(.*:ver)
](/.*:tld)
->
{ver}.api.{tld}


; Multiple targets (chosen randomly) + default capture
!env prod
[
  app
  /app-(.*:env)
](/.*:tld)
->
[
  app-{env}-1
  app-{env}-2
].{tld}
`;

let editor;
let currentRules = [];
let enabled = true;
let dirty = false;

function initEditor() {
  editor = CodeMirror.fromTextArea(document.getElementById('codeEditor'), {
    mode: 'domredir',
    theme: 'dracula',
    lineNumbers: true,
    matchBrackets: true,
    autoCloseBrackets: false,
    indentWithTabs: false,
    tabSize: 2,
    indentUnit: 2,
    lineWrapping: false,
    autofocus: true,
    extraKeys: {
      'Ctrl-S': saveRules,
      'Cmd-S': saveRules,
      'Ctrl-/': 'toggleComment',
      'Cmd-/': 'toggleComment',
      Tab: cm => cm.execCommand('indentMore'),
      'Shift-Tab': cm => cm.execCommand('indentLess'),
    },
    styleActiveLine: true,
    rulers: [{ column: 80, color: '#21262d' }],
  });

  editor.on('change', () => {
    dirty = true;
    updateSaveBtn(false);
    scheduleValidate();
  });

  editor.on('cursorActivity', updateCursor);

  // Load saved rules
  chrome.storage.sync.get({ rulesText: DEFAULT_RULES, enabled: true }, data => {
    editor.setValue(data.rulesText || DEFAULT_RULES);
    enabled = data.enabled;
    dirty = false;
    validateRules();
    updateToggleBtn();
    updateStatusBadge();
  });

  // Check for ?testUrl param
  const params = new URLSearchParams(location.search);
  const testUrl = params.get('testUrl');
  if (testUrl) {
    document.getElementById('testUrlInput').value = testUrl;
    setTimeout(runTest, 800); // wait for editor to load
  }
}

// ── Validation ─────────────────────────────────────────────────────────

let validateTimer;
function scheduleValidate() {
  clearTimeout(validateTimer);
  validateTimer = setTimeout(validateRules, 400);
}

function validateRules() {
  const text = editor.getValue();
  const errorsPanel = document.getElementById('errorsPanel');
  errorsPanel.innerHTML = '';

  try {
    currentRules = parseRulesText(text);
    document.getElementById('sb-rules').textContent =
      currentRules.length + ' rule' + (currentRules.length !== 1 ? 's' : '');
  } catch (e) {
    const el = document.createElement('div');
    el.className = 'error-item';
    el.textContent = '⚠ ' + e.message;
    errorsPanel.appendChild(el);
    currentRules = [];
  }
}

// ── Save ───────────────────────────────────────────────────────────────

function saveRules() {
  const text = editor.getValue();
  validateRules();
  chrome.storage.sync.set({ rulesText: text }, () => {
    dirty = false;
    updateSaveBtn(true);
    setTimeout(() => updateSaveBtn(false), 1500);
  });
}

function updateSaveBtn(saved) {
  const btn = document.getElementById('saveBtn');
  if (saved) {
    btn.textContent = '✓ Saved';
    btn.className = 'btn btn-saved';
  } else {
    btn.innerHTML = dirty
      ? '💾 Save* <kbd>⌘S</kbd>'
      : '💾 Save <kbd>⌘S</kbd>';
    btn.className = 'btn btn-primary';
  }
}

document.getElementById('saveBtn').addEventListener('click', saveRules);

// ── Toggle ─────────────────────────────────────────────────────────────

function updateToggleBtn() {
  const icon = document.getElementById('toggleBtnIcon');
  const text = document.getElementById('toggleBtnText');
  icon.textContent = enabled ? '⏸' : '▶';
  text.textContent = enabled ? 'Pause' : 'Resume';
}

function updateStatusBadge() {
  const badge = document.getElementById('statusBadge');
  const text = document.getElementById('statusBadgeText');
  badge.className = 'badge ' + (enabled ? 'ok' : 'err');
  text.textContent = enabled ? 'Active' : 'Paused';
}

document.getElementById('toggleBtn').addEventListener('click', () => {
  enabled = !enabled;
  chrome.storage.sync.set({ enabled }, () => {
    updateToggleBtn();
    updateStatusBadge();
  });
});

// ── Cursor status ──────────────────────────────────────────────────────

function updateCursor() {
  const pos = editor.getCursor();
  document.getElementById('sb-cursor').textContent =
    `Ln ${pos.line + 1}, Col ${pos.ch + 1}`;
}

// ═══════════════════════════════════════════════════════════════════════
//  Test Panel
// ═══════════════════════════════════════════════════════════════════════

const testInput = document.getElementById('testUrlInput');
const testResult = document.getElementById('testResult');

document.getElementById('testRunBtn').addEventListener('click', runTest);
testInput.addEventListener('keydown', e => { if (e.key === 'Enter') runTest(); });

function runTest() {
  const urlStr = testInput.value.trim();
  if (!urlStr) { testResult.innerHTML = ''; return; }

  // Ensure we have latest rules
  validateRules();

  const result = testRules(urlStr, currentRules);
  renderTestResult(result);
}

function renderTestResult(result) {
  if (result.error) {
    testResult.innerHTML = `<div class="test-match-box">
      <div class="test-match-row">
        <span class="test-match-value no-match">⚠ ${escapeHtml(result.error)}</span>
      </div>
    </div>`;
    return;
  }

  if (!result.matched) {
    testResult.innerHTML = `<div class="test-match-box">
      <div class="test-match-row">
        <span class="test-match-label">INPUT</span>
        <span class="test-match-value">${escapeHtml(result.hostname)}</span>
      </div>
      <div class="test-match-row">
        <span class="test-match-value no-match">✗ No rule matched</span>
      </div>
    </div>`;
    return;
  }

  const r = result.result;
  const captureEntries = Object.entries(r.captures || {})
    .filter(([k]) => !k.startsWith('_'));

  const capturesHtml = captureEntries.length > 0 ? `
    <div class="test-captures">
      <div class="test-capture-title">Captures</div>
      <div class="test-capture-list">
        ${captureEntries.map(([k, v]) => `
          <span class="capture-chip">
            <span class="cap-name">${escapeHtml(k)}</span>
            <span class="cap-eq">=</span>
            <span class="cap-val">${escapeHtml(v)}</span>
          </span>
        `).join('')}
      </div>
    </div>
  ` : '';

  const altList = r.redirects && r.redirects.length > 1 ? `
    <div class="test-alt-list">
      <div class="test-alt-title">All targets (random pick)</div>
      ${r.redirects.map(u => `<div class="test-alt-item">→ ${escapeHtml(u)}</div>`).join('')}
    </div>
  ` : '';

  testResult.innerHTML = `<div class="test-match-box">
    <div class="test-match-row">
      <span class="test-match-label">INPUT</span>
      <span class="test-match-value">${escapeHtml(result.url)}</span>
    </div>
    <div class="test-match-row">
      <span class="test-match-label">RULE</span>
      <span class="test-match-value rule-idx">#${r.ruleIndex + 1}</span>
    </div>
    <div class="test-match-row">
      <span class="test-match-label">OUTPUT</span>
      <span class="test-match-value redirect">${escapeHtml(r.chosen || '—')}</span>
    </div>
    ${capturesHtml}
    ${altList}
  </div>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════════════════════════
//  Boot
// ═══════════════════════════════════════════════════════════════════════

// Wait for CodeMirror to be available (loaded from CDN)
function waitForCodeMirror(cb, attempts = 0) {
  if (typeof CodeMirror !== 'undefined') {
    cb();
  } else if (attempts < 50) {
    setTimeout(() => waitForCodeMirror(cb, attempts + 1), 100);
  } else {
    console.error('[DomainRedirector] CodeMirror failed to load from CDN.');
    // Fallback: use plain textarea
    const ta = document.getElementById('codeEditor');
    ta.style.cssText = `
      width:100%; height:100%; background:#0d1117; color:#e6edf3;
      font-family:monospace; font-size:13px; border:none; padding:12px;
      resize:none; outline:none;
    `;
    ta.value = DEFAULT_RULES;
    ta.addEventListener('input', scheduleValidate);
    editor = { getValue: () => ta.value, setValue: v => { ta.value = v; } };
    chrome.storage.sync.get({ rulesText: DEFAULT_RULES }, d => {
      ta.value = d.rulesText || DEFAULT_RULES;
      validateRules();
    });
  }
}

waitForCodeMirror(initEditor);

// background.js — Domain Redirector service worker
importScripts('rules-parser.js');

let _cachedRules = null;
let _cachedText = null;
let _enabled = true;
let _redirecting = new Set(); // tab IDs currently being redirected (prevent loops)

// ── Cache management ─────────────────────────────────────────────────────────

async function getState() {
  const data = await chrome.storage.sync.get({ rulesText: '', enabled: true });
  _enabled = data.enabled;

  if (data.rulesText !== _cachedText) {
    _cachedText = data.rulesText;
    try {
      _cachedRules = parseRulesText(data.rulesText);
    } catch (e) {
      console.error('[DomainRedirector] Parse error:', e);
      _cachedRules = [];
    }
  }
  return { rules: _cachedRules || [], enabled: _enabled };
}

chrome.storage.onChanged.addListener(() => {
  _cachedRules = null;
  _cachedText = null;
});

// ── Navigation listener ───────────────────────────────────────────────────────

chrome.webNavigation.onBeforeNavigate.addListener(async details => {
  // Only intercept top-level navigations
  if (details.frameId !== 0) return;

  // Prevent redirect loops
  if (_redirecting.has(details.tabId)) {
    _redirecting.delete(details.tabId);
    return;
  }

  const { rules, enabled } = await getState();
  if (!enabled || !rules.length) return;

  let redirect;
  try {
    redirect = applyRules(details.url, rules);
  } catch (e) {
    console.error('[DomainRedirector] Error applying rules:', e);
    return;
  }

  if (redirect && redirect !== details.url) {
    console.log(`[DomainRedirector] ${details.url} → ${redirect}`);
    _redirecting.add(details.tabId);
    chrome.tabs.update(details.tabId, { url: redirect });
  }
});

// Clean up redirecting set when tab navigates away
chrome.webNavigation.onCommitted.addListener(details => {
  if (details.frameId === 0) {
    _redirecting.delete(details.tabId);
  }
});

// ── Message handler (for popup/editor) ───────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'testUrl') {
    getState().then(({ rules }) => {
      sendResponse(testRules(msg.url, rules));
    });
    return true; // async response
  }

  if (msg.type === 'getState') {
    getState().then(({ rules, enabled }) => {
      sendResponse({ enabled, ruleCount: rules.length });
    });
    return true;
  }

  if (msg.type === 'setEnabled') {
    chrome.storage.sync.set({ enabled: msg.value }, () => {
      _enabled = msg.value;
      sendResponse({ ok: true });
    });
    return true;
  }
});

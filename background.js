// background.js — Domain Redirector service worker
importScripts("rules-parser.js")

let _cachedRules = null
let _cachedText = null
let _enabled = true
let _blockingMode = false // true = webRequest blocking, false = webNavigation fallback
let _redirecting = new Set() // tab IDs in-flight (non-blocking mode only)

// ── State / cache ─────────────────────────────────────────────────────────────

async function getState() {
  const data = await chrome.storage.sync.get({
    rulesText: "",
    enabled: true,
  })
  _enabled = data.enabled

  if (data.rulesText !== _cachedText) {
    _cachedText = data.rulesText
    try {
      _cachedRules = parseRulesText(data.rulesText)
    } catch (e) {
      console.error("[DomainRedirector] Parse error:", e)
      _cachedRules = []
    }
  }
  return { rules: _cachedRules || [], enabled: _enabled }
}

chrome.storage.onChanged.addListener(() => {
  _cachedRules = null
  _cachedText = null
  // Re-prime cache immediately so next nav is instant
  getState()
})

// ── Blocking webRequest handler (policy-installed only) ───────────────────────
//
// Chrome MV3 grants webRequestBlocking only to extensions force-installed via
// enterprise policy (GPO / Chrome Browser Cloud Management / etc.).
// For all other installs the addListener call throws synchronously — we catch
// that and fall back to webNavigation below.
//
// When blocking IS available this is strictly better:
//   • Redirect happens before a single byte of the original page loads
//   • No visible flash / tab-URL flicker
//   • No loop-prevention bookkeeping needed

function handleBlockingRequest(details) {
  // main_frame only — skip sub-resources (images, XHR, …)
  if (details.type !== "main_frame") return {}
  if (!_enabled || !_cachedRules || !_cachedRules.length) return {}

  // Use synchronous cached rules — do NOT await getState() here;
  // the blocking handler must return synchronously.
  let redirect
  try {
    redirect = applyRules(details.url, _cachedRules)
  } catch (e) {
    console.error("[DomainRedirector] Error in blocking handler:", e)
    return {}
  }

  if (redirect && redirect !== details.url) {
    console.log(`[DomainRedirector] ⚡ ${details.url} → ${redirect}`)
    return { redirectUrl: redirect }
  }
  return {}
}

function trySetupBlockingWebRequest() {
  if (!chrome.webRequest || !chrome.webRequest.onBeforeRequest) {
    return false
  }
  // doesnt detect correctly
  try {
    // The browser will throw here if "blocking" isn't allowed
    console.log(
      chrome.webRequest.onBeforeRequest.addListener(
        handleBlockingRequest,
        { urls: ["<all_urls>"] },
        ["blocking"],
      ),
    )
    // Only set to true if the call above didn't trigger the catch block
    _blockingMode = true
    console.log("[DomainRedirector] Blocking mode active")
    return true
  } catch (e) {
    // If we are here, 'blocking' failed.
    // Ensure we explicitly reset the flag.
    _blockingMode = false
    console.log(
      "[DomainRedirector] webRequestBlocking unavailable, falling back.",
    )
    return false
  }
}
// ── Non-blocking webNavigation fallback ───────────────────────────────────────
//
// Works for all installs. Uses tabs.update() which causes a brief URL flash
// and requires loop-prevention (the _redirecting Set).

function setupWebNavigationFallback() {
  chrome.webNavigation.onBeforeNavigate.addListener(
    async (details) => {
      if (details.frameId !== 0) return

      // Prevent redirect loops: if we redirected this tab, skip once
      if (_redirecting.has(details.tabId)) {
        _redirecting.delete(details.tabId)
        return
      }

      // Kick off a cache refresh in the background but don't wait —
      // we use whatever is already cached so we don't hold up the nav.
      getState()
      if (!_enabled || !_cachedRules || !_cachedRules.length) return

      let redirect
      try {
        redirect = applyRules(details.url, _cachedRules)
      } catch (e) {
        console.error("[DomainRedirector] Error applying rules:", e)
        return
      }

      if (redirect && redirect !== details.url) {
        console.log(
          `[DomainRedirector] ↪ ${details.url} → ${redirect}`,
        )
        _redirecting.add(details.tabId)
        chrome.tabs.update(details.tabId, { url: redirect })
      }
    },
  )

  // Clean up redirecting set once the navigation commits
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId === 0) _redirecting.delete(details.tabId)
  })
}

// ── Boot ──────────────────────────────────────────────────────────────────────

;(async () => {
  // Prime the rule cache immediately on service-worker start
  await getState()

  // Try blocking first; set up fallback if it's not available
  if (!trySetupBlockingWebRequest()) {
    setupWebNavigationFallback()
  }
})()

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "getState") {
    getState().then(({ rules, enabled }) => {
      sendResponse({
        enabled,
        ruleCount: rules.length,
        blockingMode: _blockingMode,
      })
    })
    return true
  }

  if (msg.type === "setEnabled") {
    chrome.storage.sync.set({ enabled: msg.value }, () => {
      _enabled = msg.value
      sendResponse({ ok: true })
    })
    return true
  }

  if (msg.type === "testUrl") {
    getState().then(({ rules }) => {
      sendResponse(testRules(msg.url, rules))
    })
    return true
  }
})

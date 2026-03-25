// background.js — Domain Redirector service worker
importScripts("rules-parser.js")

let _cachedRules = null
let _cachedText = null
let _enabled = true
let _redirecting = new Set() // tab IDs currently being redirected (prevent loops)

// ── Cache management ─────────────────────────────────────────────────────────

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
  console.log(_cachedRules)
  convertRulesToDNR(_cachedRules)
  return { rules: _cachedRules || [], enabled: _enabled }
}

chrome.storage.onChanged.addListener(() => {
  _cachedRules = null
  _cachedText = null
})

async function convertRulesToDNR(userRules) {
  console.trace("convertRulesToDNR")
  const dnrRules = []

  userRules.forEach((rule, index) => {
    // 1. Handle Randomness: Pick one target from the list
    // In MV3 DNR, we must pick one fixed target per rule update.
    const randomIndex = Math.floor(
      Math.random() * rule.replaceItems.length,
    )
    const target = rule.replaceItems[randomIndex]

    let regexPattern = ""

    // 2. Build the Matcher
    if (rule.matchMode === "bare") {
      const escaped = rule.bareLiteral.replace(/\./g, "\\.")
      // Matches http://dev-attend/path or http://dev-attend:8080/path
      regexPattern = `^https?://${escaped}(?::\\d+)?(/.*)?$`
    } else if (rule.matchMode === "list") {
      const listPattern = rule.matchItems
        .map((i) => i.value)
        .join("|")

      // Use .pattern if .text is undefined
      const suffixStr = rule.suffix.text || rule.suffix.pattern || ""
      const escapedSuffix = suffixStr.replace(/\./g, "\\.")

      regexPattern = `^https?://(${listPattern})${escapedSuffix}(?::\\d+)?(/.*)?$`
      subIndex = "\\2"
    }

    if (regexPattern) {
      dnrRules.push({
        id: index + 1,
        priority: 1,
        action: {
          type: "redirect",
          redirect: {
            // Use \2 if it was a list match (group 1 is prefix, group 2 is path)
            // Use \1 if it was a bare match (group 1 is path)
            regexSubstitution: `http://${target}${rule.matchMode === "list" ? "\\2" : "\\1"}`,
          },
        },
        condition: {
          regexFilter: regexPattern,
          resourceTypes: [
            "main_frame",
            "sub_frame",
            "stylesheet",
            "script",
            "image",
            "xmlhttprequest",
          ],
        },
      })
    }
  })
  const oldRules =
    await chrome.declarativeNetRequest.getDynamicRules()
  const oldRuleIds = oldRules.map((r) => r.id)
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldRuleIds,
    addRules: dnrRules,
  })

  if (chrome.runtime.lastError) {
    console.error("DNR Rule Error:", chrome.runtime.lastError.message)
  } else {
    console.log("Rules applied successfully!")
  }
  return dnrRules
}

// ── Navigation listener ───────────────────────────────────────────────────────

// chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
//   // Only intercept top-level navigations
//   if (details.frameId !== 0) return

//   // Prevent redirect loops
//   if (_redirecting.has(details.tabId)) {
//     _redirecting.delete(details.tabId)
//     return
//   }

//   const { rules, enabled } = await getState()
//   if (!enabled || !rules.length) return

//   let redirect
//   try {
//     redirect = applyRules(details.url, rules)
//   } catch (e) {
//     console.error("[DomainRedirector] Error applying rules:", e)
//     return
//   }

//   if (redirect && redirect !== details.url) {
//     console.log(`[DomainRedirector] ${details.url} → ${redirect}`)
//     _redirecting.add(details.tabId)
//     chrome.tabs.update(details.tabId, { url: redirect })
//   }
// })

// Clean up redirecting set when tab navigates away
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) {
    convertRulesToDNR(_cachedRules)
    // _redirecting.delete(details.tabId)
  }
})

// ── Message handler (for popup/editor) ───────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "testUrl") {
    getState().then(({ rules }) => {
      sendResponse(testRules(msg.url, rules))
    })
    return true // async response
  }

  if (msg.type === "getState") {
    getState().then(({ rules, enabled }) => {
      sendResponse({ enabled, ruleCount: rules.length })
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
})

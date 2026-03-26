// popup.js

const toggle = document.getElementById("enableToggle")
const statusText = document.getElementById("statusText")
const ruleCountEl = document.getElementById("ruleCount")
const matchCountEl = document.getElementById("matchCount")

// ── Mode banner ───────────────────────────────────────────────────────────────

function applyMode(blockingMode) {
  const banner = document.getElementById("modeBanner")
  const label = document.getElementById("modeLabel")
  const desc = document.getElementById("modeDesc")

  if (blockingMode) {
    banner.className = "mode-banner blocking"
    label.textContent = "Blocking"
    desc.textContent = "Redirects before page loads"
  } else {
    banner.className = "mode-banner standard"
    label.textContent = "Standard"
    // Brief tooltip-style explanation of why blocking is not active
    desc.textContent = "Requires enterprise policy"
  }
}

// ── Toggle state ──────────────────────────────────────────────────────────────

function updateStatus(enabled) {
  statusText.textContent = enabled ? "Active" : "Paused"
  statusText.className = "toggle-status " + (enabled ? "on" : "off")
  toggle.checked = enabled
}

// ── Load state from background ────────────────────────────────────────────────

chrome.runtime.sendMessage({ type: "getState" }, (resp) => {
  if (!resp) return

  // Suppress toggle animation on first paint
  document.body.classList.add("no-transition")
  updateStatus(resp.enabled)
  applyMode(resp.blockingMode&&0)
  ruleCountEl.textContent = resp.ruleCount
  requestAnimationFrame(() =>
    requestAnimationFrame(() =>
      document.body.classList.remove("no-transition"),
    ),
  )
})

// Today's redirect count (stored locally by background)
chrome.storage.local.get(
  { dailyRedirects: {}, lastDay: "" },
  (data) => {
    const today = new Date().toISOString().slice(0, 10)
    matchCountEl.textContent =
      data.lastDay === today ? data.dailyRedirects[today] || 0 : 0
  },
)

// ── Toggle ────────────────────────────────────────────────────────────────────

toggle.addEventListener("change", () => {
  chrome.runtime.sendMessage(
    { type: "setEnabled", value: toggle.checked },
    () => {
      updateStatus(toggle.checked)
    },
  )
})

// ── Buttons ───────────────────────────────────────────────────────────────────

document
  .getElementById("openEditor")
  .addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("editor.html") })
    window.close()
  })

document.getElementById("testUrl").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return
    chrome.tabs.create({
      url:
        chrome.runtime.getURL("editor.html") +
        "?testUrl=" +
        encodeURIComponent(tabs[0].url),
    })
    window.close()
  })
})

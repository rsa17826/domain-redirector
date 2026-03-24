// popup.js

const toggle = document.getElementById("enableToggle")
const statusText = document.getElementById("statusText")
const ruleCountEl = document.getElementById("ruleCount")
const matchCountEl = document.getElementById("matchCount")

function updateStatus(enabled) {
  statusText.textContent = enabled ? "Active" : "Paused"
  statusText.className = "toggle-status " + (enabled ? "on" : "off")
  toggle.checked = enabled
}

// Load state
chrome.runtime.sendMessage({ type: "getState" }, (resp) => {
  if (resp) {
    updateStatus(resp.enabled)
    ruleCountEl.textContent = resp.ruleCount
  }
})

// Load redirect count from today
chrome.storage.local.get(
  { dailyRedirects: {}, lastDay: "" },
  (data) => {
    const today = new Date().toISOString().slice(0, 10)
    const count =
      data.lastDay === today ? data.dailyRedirects[today] || 0 : 0
    matchCountEl.textContent = count
  }
)

// Toggle
toggle.addEventListener("change", () => {
  chrome.runtime.sendMessage(
    { type: "setEnabled", value: toggle.checked },
    () => {
      updateStatus(toggle.checked)
    }
  )
})

// Open editor
document
  .getElementById("openEditor")
  .addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("editor.html") })
    window.close()
  })

// Test current URL
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

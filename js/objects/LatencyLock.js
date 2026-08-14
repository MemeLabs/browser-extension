// AngelThump Latency Lock: per-tab controller status cache, folded in from
// the standalone angelthump-latency-lock-firefox extension's background.js.
(() => {
  "use strict";

  const STATUS_PREFIX = "angelThumpLatencyLockStatus:";
  const statusByTab = new Map();

  function storageKey(tabId) {
    return `${STATUS_PREFIX}${tabId}`;
  }

  function statusScore(value) {
    if (!value) return -1;
    let score = Number(value.receivedAt) || 0;
    if (value.bridgeOnline) score += 1e12;
    if (value.detected) score += 2e12;
    return score;
  }

  async function persistStatus(tabId, value) {
    statusByTab.set(tabId, value);
    await chrome.storage.local.set({ [storageKey(tabId)]: value });
  }

  async function getStatus(tabId) {
    const memory = statusByTab.get(tabId);
    if (memory) return memory;
    const stored = await chrome.storage.local.get(storageKey(tabId));
    const value = stored[storageKey(tabId)] || null;
    if (value) statusByTab.set(tabId, value);
    return value;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") return undefined;

    if (message.type === "atll-frame-status") {
      const tabId = sender.tab && sender.tab.id;
      if (!Number.isInteger(tabId)) return undefined;

      const incoming = {
        ...(message.status || {}),
        bridgeOnline: true,
        tabId,
        frameId: sender.frameId,
        frameUrl: message.frameUrl || sender.url || "",
        receivedAt: Date.now(),
      };

      void (async () => {
        const current = await getStatus(tabId);
        const currentFresh = current && Date.now() - Number(current.receivedAt) < 5000;
        const incomingWins =
          !currentFresh ||
          incoming.detected ||
          !current.detected ||
          statusScore(incoming) >= statusScore(current);
        if (incomingWins) await persistStatus(tabId, incoming);
      })();
      return undefined;
    }

    if (message.type === "atll-bridge-online") {
      const tabId = sender.tab && sender.tab.id;
      if (!Number.isInteger(tabId)) return undefined;

      const heartbeat = {
        bridgeOnline: true,
        injected: true,
        detected: Boolean(message.detected),
        lastReason: message.detected
          ? "Bridge online; controller status pending"
          : "Bridge online; waiting for video element",
        timestamp: Date.now(),
        receivedAt: Date.now(),
        tabId,
        frameId: sender.frameId,
        frameUrl: message.frameUrl || sender.url || "",
      };

      void (async () => {
        const current = await getStatus(tabId);
        if (!current || !current.detected || Date.now() - Number(current.receivedAt) > 5000) {
          await persistStatus(tabId, heartbeat);
        }
      })();
      return undefined;
    }

    if (message.type === "atll-get-tab-status") {
      const tabId = Number(message.tabId);
      void getStatus(tabId).then((value) => sendResponse({ ok: true, status: value }));
      return true;
    }

    if (message.type === "atll-clear-tab-status") {
      const tabId = Number(message.tabId);
      statusByTab.delete(tabId);
      void chrome.storage.local.remove(storageKey(tabId)).then(() => sendResponse({ ok: true }));
      return true;
    }

    return undefined;
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    statusByTab.delete(tabId);
    void chrome.storage.local.remove(storageKey(tabId));
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== "loading") return;
    statusByTab.delete(tabId);
    void chrome.storage.local.remove(storageKey(tabId));
  });
})();

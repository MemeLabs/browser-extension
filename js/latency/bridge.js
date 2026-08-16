(() => {
  "use strict";

  if (globalThis.__angelThumpLatencyLockBridge) {
    globalThis.__angelThumpLatencyLockBridge.publishConfig?.();
    return;
  }

  const BRIDGE_SOURCE = "angelthump-buffer-stabilizer-bridge";
  const PAGE_SOURCE = "angelthump-buffer-stabilizer-page";
  const DEFAULTS = Object.freeze({
    enabled: true,
    targetSeconds: 18,
    rebuildNonce: 0,
  });

  function normalizeTarget(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULTS.targetSeconds;
    return Math.round(Math.min(60, Math.max(9, numeric)) * 2) / 2;
  }

  async function publishConfig() {
    try {
      const stored = await chrome.storage.sync.get(DEFAULTS);
      window.postMessage(
        {
          source: BRIDGE_SOURCE,
          type: "config",
          config: {
            enabled: stored.enabled !== false,
            targetSeconds: normalizeTarget(stored.targetSeconds),
            rebuildNonce: Number(stored.rebuildNonce) || 0,
          },
        },
        "*",
      );
    } catch (error) {
      console.error("[AngelThump Latency Lock] Could not publish settings.", error);
    }
  }

  function sendRuntimeMessage(payload) {
    try {
      const result = chrome.runtime.sendMessage(payload);
      if (result && typeof result.catch === "function") result.catch(() => {});
    } catch (_error) {
      // The extension was reloaded while this page was still open.
    }
  }

  function reportBridgeOnline() {
    sendRuntimeMessage({
      type: "atll-bridge-online",
      frameUrl: location.href,
      detected: Boolean(document.querySelector("video")),
      timestamp: Date.now(),
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== PAGE_SOURCE) return;

    if (event.data.type === "request-config") {
      void publishConfig();
      return;
    }

    if (event.data.type === "status" && event.data.status) {
      sendRuntimeMessage({
        type: "atll-frame-status",
        frameUrl: location.href,
        status: event.data.status,
      });
    }

    if (event.data.type === "stall-notify") {
      sendRuntimeMessage({
        type: "atll-stall",
        frameUrl: location.href,
        reason: event.data.reason,
      });
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return undefined;
    if (message.type === "atll-ping") {
      void publishConfig();
      window.postMessage({ source: BRIDGE_SOURCE, type: "request-status" }, "*");
      sendResponse({
        ok: true,
        bridgeVersion: "2.3.3",
        frameUrl: location.href,
        hasVideo: Boolean(document.querySelector("video")),
      });
      return undefined;
    }
    return undefined;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;
    if (!changes.enabled && !changes.targetSeconds && !changes.rebuildNonce) return;
    void publishConfig();
  });

  globalThis.__angelThumpLatencyLockBridge = { publishConfig };
  reportBridgeOnline();
  void publishConfig();
  window.setInterval(reportBridgeOnline, 3000);
})();

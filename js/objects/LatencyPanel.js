// AngelThump Latency Lock settings panel, folded in from the standalone
// angelthump-latency-lock-firefox extension's popup.js, adapted to live
// inside the Strims Live popup behind a gear button instead of its own popup.
var LatencyPanel = function() {
  'use strict';

  var DEFAULTS = { enabled: true, targetSeconds: 18, rebuildNonce: 0 };
  var TARGET_MIN_SECONDS = 9;
  var TARGET_MAX_SECONDS = 60;
  var TARGET_STEP_SECONDS = 0.5;
  var TELEMETRY_FRESH_MS = 6000;
  var TARGET_SAVE_DEBOUNCE_MS = 250;

  var el = {
    enabled: document.getElementById('llEnabled'),
    targetSeconds: document.getElementById('llTargetSeconds'),
    targetRange: document.getElementById('llTargetRange'),
    reconnect: document.getElementById('llReconnect'),
    rebuild: document.getElementById('llRebuild'),
    status: document.getElementById('llStatus'),
    state: document.getElementById('llState'),
    attachedTab: document.getElementById('llAttachedTab'),
    effectiveTarget: document.getElementById('llEffectiveTarget'),
    actualLatency: document.getElementById('llActualLatency'),
    forwardBuffer: document.getElementById('llForwardBuffer'),
    preventedJumps: document.getElementById('llPreventedJumps'),
    recoveryCount: document.getElementById('llRecoveryCount')
  };

  var targetTab = null;
  var attachInFlight = false;
  var targetSaveTimer = null;
  var pollTimer = null;
  var initialized = false;

  // Matches both a direct angelthump.com tab and a strims.gg tab embedding
  // the AngelThump player in a nested iframe (all_frames content scripts
  // attach to that iframe regardless of the top-level tab's own URL).
  function isRelevantUrl(url) {
    try {
      var parsed = new URL(url);
      return parsed.protocol === 'https:' &&
        (parsed.hostname === 'angelthump.com' ||
          parsed.hostname.endsWith('.angelthump.com') ||
          parsed.hostname === 'strims.gg' ||
          parsed.hostname.endsWith('.strims.gg'));
    } catch (_error) {
      return false;
    }
  }

  function findTargetTab() {
    return chrome.tabs.query({ currentWindow: true }).then(function(tabs) {
      var active = tabs.find(function(tab) { return tab.active && isRelevantUrl(tab.url); });
      return active || tabs.find(function(tab) { return isRelevantUrl(tab.url); }) || null;
    });
  }

  function getTabStatus(tabId) {
    return chrome.runtime.sendMessage({ type: 'atll-get-tab-status', tabId: tabId })
      .then(function(response) { return response && response.status ? response.status : null; });
  }

  function injectController(tabId) {
    return chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      files: ['js/latency/bridge.js'],
      world: 'ISOLATED',
      injectImmediately: true
    }).then(function() {
      return chrome.scripting.executeScript({
        target: { tabId: tabId, allFrames: true },
        files: ['js/latency/page.js'],
        world: 'MAIN',
        injectImmediately: true
      });
    });
  }

  function clearMetrics() {
    el.effectiveTarget.textContent = '—';
    el.actualLatency.textContent = '—';
    el.forwardBuffer.textContent = '—';
  }

  function shorten(url) {
    try {
      var parsed = new URL(url);
      return parsed.hostname + parsed.pathname;
    } catch (_error) {
      return url;
    }
  }

  function formatSeconds(value) {
    return Number.isFinite(Number(value)) ? Number(value).toFixed(1) + ' s' : '—';
  }

  function renderTelemetry(value) {
    var fresh = value && Date.now() - Number(value.receivedAt) < TELEMETRY_FRESH_MS;
    if (!fresh) {
      el.state.textContent = 'No heartbeat after injection';
      el.status.textContent = 'Click Reconnect. If this remains, reload the stream tab once.';
      clearMetrics();
      return;
    }

    if (!value.detected) {
      el.state.textContent = value.bridgeOnline
        ? 'Bridge connected; waiting for video element'
        : 'Controller script connected; waiting for player';
      el.status.textContent = value.frameUrl ? 'Connected frame: ' + shorten(value.frameUrl) : 'Bridge connected.';
      clearMetrics();
      el.preventedJumps.textContent = String(value.preventedJumps || 0);
      el.recoveryCount.textContent = String(value.recoveryCount || 0);
      return;
    }

    var mode = value.hlsDetected ? 'HLS + video' : 'video controller';
    el.state.textContent = value.holding
      ? (value.lastReason || 'Building reserve')
      : (value.lastReason || 'Active') + ' · ' + mode;
    el.effectiveTarget.textContent = formatSeconds(
      Number.isFinite(Number(value.effectiveTargetSeconds)) ? value.effectiveTargetSeconds : value.targetSeconds
    );
    el.actualLatency.textContent = formatSeconds(value.actualLatency);
    el.forwardBuffer.textContent = formatSeconds(value.forwardBuffer);
    el.preventedJumps.textContent = String(value.preventedJumps || 0);
    el.recoveryCount.textContent = String(value.recoveryCount || 0);
    el.status.textContent = value.frameUrl ? 'Controller frame: ' + shorten(value.frameUrl) : 'Controller active.';
  }

  function ensureAttached(force) {
    if (attachInFlight) return Promise.resolve();
    attachInFlight = true;
    el.reconnect.disabled = true;

    return findTargetTab().then(function(tab) {
      targetTab = tab;
      if (!targetTab || !Number.isInteger(targetTab.id)) {
        el.attachedTab.textContent = 'none';
        el.state.textContent = 'No AngelThump tab found';
        el.status.textContent = 'Open an angelthump.com stream (directly or via strims.gg) in this Chrome window.';
        clearMetrics();
        return null;
      }

      el.attachedTab.textContent = new URL(targetTab.url).pathname || '/';
      return getTabStatus(targetTab.id).then(function(telemetry) {
        var fresh = telemetry && Date.now() - Number(telemetry.receivedAt) < TELEMETRY_FRESH_MS;
        if (force || !fresh) {
          el.state.textContent = 'Injecting controller into the stream tab…';
          el.status.textContent = 'Attaching to tab ' + targetTab.id + '.';
          return chrome.runtime.sendMessage({ type: 'atll-clear-tab-status', tabId: targetTab.id })
            .then(function() { return injectController(targetTab.id); })
            .then(function() { return new Promise(function(resolve) { setTimeout(resolve, 500); }); })
            .then(function() { return getTabStatus(targetTab.id); });
        }
        return telemetry;
      });
    }).then(function(telemetry) {
      if (telemetry !== undefined) renderTelemetry(telemetry);
    }).catch(function(error) {
      el.state.textContent = 'Controller injection failed';
      el.status.textContent = (error && error.message) ? error.message : String(error);
      clearMetrics();
    }).then(function() {
      attachInFlight = false;
      el.reconnect.disabled = false;
    });
  }

  function normalizeTarget(value) {
    var numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULTS.targetSeconds;
    var clamped = Math.min(TARGET_MAX_SECONDS, Math.max(TARGET_MIN_SECONDS, numeric));
    return Math.round(clamped / TARGET_STEP_SECONDS) * TARGET_STEP_SECONDS;
  }

  function formatTarget(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function setTargetControls(value) {
    var normalized = normalizeTarget(value);
    var formatted = formatTarget(normalized);
    el.targetSeconds.value = formatted;
    el.targetRange.value = formatted;
    return normalized;
  }

  function updateDisabledState() {
    var disabled = !el.enabled.checked;
    el.targetSeconds.disabled = disabled;
    el.targetRange.disabled = disabled;
    el.rebuild.disabled = disabled;
  }

  function loadSettings() {
    return chrome.storage.sync.get(DEFAULTS).then(function(settings) {
      el.enabled.checked = settings.enabled !== false;
      setTargetControls(settings.targetSeconds);
      updateDisabledState();
    });
  }

  function saveSettings() {
    var normalizedTarget = setTargetControls(el.targetSeconds.value);
    var settings = { enabled: el.enabled.checked, targetSeconds: normalizedTarget };
    return chrome.storage.sync.set(settings).then(function() {
      updateDisabledState();
      el.status.textContent = settings.enabled
        ? 'Lock configured for ' + formatTarget(settings.targetSeconds) + ' seconds.'
        : 'Latency lock disabled.';
      return ensureAttached(false);
    });
  }

  function scheduleTargetSave() {
    if (targetSaveTimer !== null) clearTimeout(targetSaveTimer);
    targetSaveTimer = setTimeout(function() {
      targetSaveTimer = null;
      saveSettings();
    }, TARGET_SAVE_DEBOUNCE_MS);
  }

  function rebuildReserve() {
    el.rebuild.disabled = true;
    chrome.storage.sync.set({ rebuildNonce: Date.now() }).then(function() {
      el.status.textContent = 'Reserve rebuild requested.';
      setTimeout(function() { el.rebuild.disabled = !el.enabled.checked; }, 800);
    });
  }

  el.enabled.addEventListener('change', function() { saveSettings(); });
  el.targetRange.addEventListener('input', function() {
    el.targetSeconds.value = formatTarget(normalizeTarget(el.targetRange.value));
    scheduleTargetSave();
  });
  el.targetRange.addEventListener('change', function() { saveSettings(); });
  el.targetSeconds.addEventListener('input', function() {
    var numeric = Number(el.targetSeconds.value);
    if (Number.isFinite(numeric) && numeric >= TARGET_MIN_SECONDS && numeric <= TARGET_MAX_SECONDS) {
      el.targetRange.value = formatTarget(normalizeTarget(numeric));
      scheduleTargetSave();
    }
  });
  el.targetSeconds.addEventListener('change', function() { saveSettings(); });
  el.reconnect.addEventListener('click', function() { ensureAttached(true); });
  el.rebuild.addEventListener('click', function() { rebuildReserve(); });

  this.startPolling = function() {
    if (pollTimer) return;
    pollTimer = setInterval(function() {
      if (!targetTab || !Number.isInteger(targetTab.id) || attachInFlight) return;
      getTabStatus(targetTab.id).then(renderTelemetry).catch(function() {});
    }, 1000);
  };

  this.stopPolling = function() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  };

  this.open = function() {
    if (!initialized) {
      initialized = true;
      loadSettings().then(function() { return ensureAttached(false); });
    }
    this.startPolling();
  };
};

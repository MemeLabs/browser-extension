// Pure decision logic for the AngelThump latency-lock stall/error recovery
// ladder, extracted out of page.js so it can be unit tested without a DOM.
// No dependency on window/video/hls -- everything here takes plain numbers
// in and returns plain numbers/booleans out. See docs/latency-lock-recovery.md
// for the reasoning (axioms) behind each of these.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.AngelThumpRecoveryLogic = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const FATAL_ERROR_RESTART_MIN_DELAY_MS = 2000;
  const FATAL_ERROR_RESTART_MAX_DELAY_MS = 8000;
  const LOW_TOLERANCE_RATIO = 0.5;
  // A soft HLS restart / CDN retry takes roughly 2-3s in practice. Never call a
  // reserve "good enough" with less runway than this above that, even at low
  // configured targets with short segment durations.
  const RECOVERY_MARGIN_SECONDS = 5;

  function getLowTolerance(targetSeconds) {
    return targetSeconds * LOW_TOLERANCE_RATIO;
  }

  // Doubles the quiet-restart delay on every fatal network error, capped at
  // FATAL_ERROR_RESTART_MAX_DELAY_MS. Axiom: a host that's unreachable for a
  // while (DNS failure, CDN outage) should still get retried regularly forever
  // -- never spammed, and never abandoned.
  function nextQuietRestartDelay(currentDelayMs) {
    return Math.min(currentDelayMs * 2, FATAL_ERROR_RESTART_MAX_DELAY_MS);
  }

  // How much actually-downloaded forward buffer we want/need before treating a
  // reserve as built. targetDuration is the HLS playlist's segment target
  // duration in seconds.
  function getAdaptiveReserveRequirements(targetSeconds, targetDuration) {
    const requiredForwardBuffer = Math.min(
      Math.max(3, targetSeconds - 1),
      Math.max(7.5, targetDuration * 2),
    );
    const minimumForwardBuffer = Math.min(
      requiredForwardBuffer,
      Math.max(RECOVERY_MARGIN_SECONDS, targetDuration * 1.25),
    );
    return { requiredForwardBuffer, minimumForwardBuffer };
  }

  // Axiom: being positioned at the target latency (distance behind the live
  // edge) is not the same as having that much video actually downloaded ahead
  // of the play head. Both must hold before skipping a reserve build --
  // otherwise a thin real buffer (e.g. right after a seek/restart) gets waved
  // through as "fine" and starves within a second or two of any hiccup instead
  // of surviving the full target window.
  function isReserveReady(latency, forwardBuffer, targetSeconds, targetDuration) {
    if (!Number.isFinite(latency)) return false;
    const atTargetLatency = latency >= targetSeconds - getLowTolerance(targetSeconds);
    if (!atTargetLatency) return false;
    const requirements = getAdaptiveReserveRequirements(targetSeconds, targetDuration);
    return forwardBuffer >= requirements.minimumForwardBuffer;
  }

  // Always true: the reload rate-limit history is a telemetry/logging signal
  // only, never a reason to stop trying. A stuck DNS/socket-layer failure only
  // clears via a full navigation (the same thing a manual refresh does) --
  // refusing to reload once a budget is exceeded would leave the viewer stuck
  // indefinitely with no further escalation path short of a manual refresh.
  // Kept as a named function (rather than dropping the check entirely) so the
  // call site still reads as a deliberate policy decision, and so a future
  // change away from "always reload" has one tested place to make it instead
  // of silently reintroducing a hard stop.
  function reloadBudgetIsAdvisoryOnly() {
    return true;
  }

  return {
    FATAL_ERROR_RESTART_MIN_DELAY_MS,
    FATAL_ERROR_RESTART_MAX_DELAY_MS,
    LOW_TOLERANCE_RATIO,
    RECOVERY_MARGIN_SECONDS,
    getLowTolerance,
    nextQuietRestartDelay,
    getAdaptiveReserveRequirements,
    isReserveReady,
    reloadBudgetIsAdvisoryOnly,
  };
});

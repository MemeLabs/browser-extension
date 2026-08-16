"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const RecoveryLogic = require("../js/latency/recovery-logic.js");

// --- nextQuietRestartDelay: 2s -> 4s -> 8s -> capped at 8s -----------------

test("nextQuietRestartDelay backs off 2s -> 4s -> 8s then holds at the cap", () => {
  let delay = RecoveryLogic.FATAL_ERROR_RESTART_MIN_DELAY_MS;
  assert.equal(delay, 2000);

  delay = RecoveryLogic.nextQuietRestartDelay(delay);
  assert.equal(delay, 4000);

  delay = RecoveryLogic.nextQuietRestartDelay(delay);
  assert.equal(delay, 8000);

  // Axiom: never exceeds FATAL_ERROR_RESTART_MAX_DELAY_MS, however many
  // consecutive errors occur -- a long DNS outage must not stop retrying.
  delay = RecoveryLogic.nextQuietRestartDelay(delay);
  assert.equal(delay, 8000);
  delay = RecoveryLogic.nextQuietRestartDelay(delay);
  assert.equal(delay, 8000);
});

// --- getAdaptiveReserveRequirements -----------------------------------------

test("getAdaptiveReserveRequirements never asks for less than RECOVERY_MARGIN_SECONDS of runway", () => {
  // A very short segment duration (e.g. 1s) must not shrink the minimum floor
  // below the time a soft HLS restart / CDN retry actually takes.
  const requirements = RecoveryLogic.getAdaptiveReserveRequirements(18, 1);
  assert.ok(requirements.minimumForwardBuffer >= RecoveryLogic.RECOVERY_MARGIN_SECONDS);
});

test("getAdaptiveReserveRequirements caps requiredForwardBuffer relative to target, not unbounded", () => {
  // A very large target shouldn't demand an unbounded buffer -- capped by
  // (target - 1) vs a playlist-duration-derived ceiling, whichever is smaller.
  const requirements = RecoveryLogic.getAdaptiveReserveRequirements(60, 2);
  assert.ok(requirements.requiredForwardBuffer <= 59);
  assert.ok(requirements.requiredForwardBuffer >= 3);
});

test("getAdaptiveReserveRequirements minimumForwardBuffer never exceeds requiredForwardBuffer", () => {
  for (const target of [3, 9, 18, 30, 60]) {
    for (const targetDuration of [1, 2, 4, 8]) {
      const requirements = RecoveryLogic.getAdaptiveReserveRequirements(target, targetDuration);
      assert.ok(
        requirements.minimumForwardBuffer <= requirements.requiredForwardBuffer,
        `minimum (${requirements.minimumForwardBuffer}) exceeded required ` +
          `(${requirements.requiredForwardBuffer}) at target=${target}, targetDuration=${targetDuration}`,
      );
    }
  }
});

// --- isReserveReady ----------------------------------------------------------
// This is the fix for the bug where the player stalled within ~2s of a network
// cutoff despite a configured ~15-18s target: latency alone (position behind
// the live edge) was treated as proof of a real buffered reserve.

test("isReserveReady is false when latency is unknown", () => {
  assert.equal(RecoveryLogic.isReserveReady(null, 20, 18, 2), false);
  assert.equal(RecoveryLogic.isReserveReady(NaN, 20, 18, 2), false);
  assert.equal(RecoveryLogic.isReserveReady(undefined, 20, 18, 2), false);
});

test("isReserveReady is false when at target latency but forwardBuffer is thin", () => {
  // Exactly the bug scenario: playhead correctly sitting ~18s behind live edge,
  // but only ~2s of that gap has actually been downloaded (e.g. right after a
  // seek or hls.startLoad() restart).
  const targetSeconds = 18;
  const atTargetLatency = targetSeconds; // latency == target, well past the low-tolerance band
  assert.equal(RecoveryLogic.isReserveReady(atTargetLatency, 2, targetSeconds, 2), false);
});

test("isReserveReady is false when forwardBuffer is fine but latency hasn't reached target", () => {
  const targetSeconds = 18;
  assert.equal(RecoveryLogic.isReserveReady(1, 30, targetSeconds, 2), false);
});

test("isReserveReady is true once both latency and forwardBuffer meet their floors", () => {
  const targetSeconds = 18;
  const targetDuration = 2;
  const requirements = RecoveryLogic.getAdaptiveReserveRequirements(targetSeconds, targetDuration);
  assert.equal(
    RecoveryLogic.isReserveReady(
      targetSeconds,
      requirements.minimumForwardBuffer,
      targetSeconds,
      targetDuration,
    ),
    true,
  );
});

test("isReserveReady respects the low-tolerance band, not just exact target latency", () => {
  const targetSeconds = 18;
  const targetDuration = 2;
  const requirements = RecoveryLogic.getAdaptiveReserveRequirements(targetSeconds, targetDuration);
  const lowTolerance = RecoveryLogic.getLowTolerance(targetSeconds);

  // Just inside the tolerance band (latency slightly below target) should
  // still count as "at target latency".
  const justInside = targetSeconds - lowTolerance + 0.01;
  assert.equal(
    RecoveryLogic.isReserveReady(justInside, requirements.minimumForwardBuffer, targetSeconds, targetDuration),
    true,
  );

  // Just outside the band should not.
  const justOutside = targetSeconds - lowTolerance - 0.01;
  assert.equal(
    RecoveryLogic.isReserveReady(justOutside, requirements.minimumForwardBuffer, targetSeconds, targetDuration),
    false,
  );
});

// --- reloadBudgetIsAdvisoryOnly ------------------------------------------------
// Axiom: the reload rate-limit history is telemetry only, never a reason to
// stop trying. If this test ever needs to change, that's a deliberate policy
// change (see docs/latency-lock-recovery.md), not an accident.

test("reloadBudgetIsAdvisoryOnly is always true regardless of how far over budget", () => {
  assert.equal(RecoveryLogic.reloadBudgetIsAdvisoryOnly(), true);
});

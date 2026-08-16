(() => {
  "use strict";

  if (window.__angelThumpLatencyLockPageController) {
    window.__angelThumpLatencyLockPageController.requestStatus?.();
    return;
  }


  const PAGE_SOURCE = "angelthump-buffer-stabilizer-page";
  const BRIDGE_SOURCE = "angelthump-buffer-stabilizer-bridge";
  const LOG_PREFIX = "[AngelThump Latency Lock]";
  const VERSION = "2.3.5";

  // Pure recovery decision logic lives in recovery-logic.js (loaded before this
  // script, same MAIN world) so it can be unit tested without a DOM. See
  // docs/latency-lock-recovery.md.
  const RecoveryLogic = window.AngelThumpRecoveryLogic;

  const DEFAULT_CONFIG = Object.freeze({
    enabled: true,
    targetSeconds: 18,
    rebuildNonce: 0,
  });

  const CONTROL_INTERVAL_MS = 150;
  const DISCOVERY_INTERVAL_MS = 750;
  const STATUS_INTERVAL_MS = 1000;
  // The buffer is a shock absorber: latency drifting within this band around
  // the target is expected and left alone so it can silently refill/drain as
  // delivery jitter comes and goes. Corrections only kick in once that band
  // is left (or the safety net in handlePlaybackStarvation fires). Both
  // sides scale with the configured target so a bigger requested buffer gets
  // proportionally more room to absorb jitter, instead of a fixed-second
  // band that's way too tight at a small target and way too loose at a large
  // one.
  const HIGH_TOLERANCE_RATIO = 1.0;
  const JUMP_THRESHOLD_SECONDS = 1.25;
  const MAX_RESERVE_BUILD_SECONDS = 55;
  const STARVED_BUFFER_SECONDS = 0.35;
  const SOFT_RECOVERY_DELAY_MS = 2500;
  const FRAME_RECOVERY_DELAY_MS = 10000;
  const FRAME_RELOAD_WINDOW_MS = 5 * 60 * 1000;
  const MAX_FRAME_RELOADS_PER_WINDOW = 3;
  const FRAME_RELOAD_HISTORY_KEY = "angelThumpLatencyLockFrameReloads";
  const MEDIA_EDGE_PROGRESS_SECONDS = 0.2;
  const RESERVE_BUFFER_GROWTH_SECONDS = 0.25;
  const RESERVE_STALL_MIN_MS = 6000;
  const FATAL_ERROR_WINDOW_MS = 8000;
  const TARGET_TRACKING_INTERVAL_SECONDS = 1.0;
  const SEEK_MARGIN_SECONDS = 0.2;

  const STALL_NOTIFICATION_THROTTLE_MS = 60000;
  let lastStallNotificationAt = 0;

  let config = null;
  let observer = null;
  let discoveryTimer = null;
  let statusTimer = null;
  let scanQueued = false;
  let lastStatusSentAt = 0;

  const videos = new Set();
  const videoState = new WeakMap();
  const hlsInstances = new Set();
  const hlsState = new WeakMap();

  function normalizeConfig(value) {
    const target = Number(value && value.targetSeconds);
    const rebuildNonce = Number(value && value.rebuildNonce);
    return {
      enabled: !value || value.enabled !== false,
      targetSeconds: Number.isFinite(target)
        ? Math.round(Math.min(60, Math.max(9, target)) * 2) / 2
        : DEFAULT_CONFIG.targetSeconds,
      rebuildNonce: Number.isFinite(rebuildNonce) ? rebuildNonce : 0,
    };
  }

  function isHlsInstance(value) {
    return Boolean(
      value &&
        typeof value === "object" &&
        value.config &&
        typeof value.startLoad === "function" &&
        typeof value.attachMedia === "function" &&
        ("latency" in value || "liveSyncPosition" in value),
    );
  }

  function getReactFiber(node) {
    for (const key of Object.getOwnPropertyNames(node)) {
      if (
        key.startsWith("__reactFiber$") ||
        key.startsWith("__reactInternalInstance$") ||
        key.startsWith("__reactContainer$")
      ) {
        const value = node[key];
        return value && value.current ? value.current : value;
      }
    }
    return null;
  }

  function findHlsInValue(value, depth = 0, seen = new Set()) {
    if (isHlsInstance(value)) return value;
    if (!value || typeof value !== "object" || depth > 2 || seen.has(value)) return null;
    seen.add(value);

    const keys = Array.isArray(value)
      ? value.keys()
      : Object.keys(value).slice(0, 40);

    for (const key of keys) {
      let candidate;
      try {
        candidate = value[key];
      } catch (_error) {
        continue;
      }
      if (isHlsInstance(candidate)) return candidate;
      const nested = findHlsInValue(candidate, depth + 1, seen);
      if (nested) return nested;
    }
    return null;
  }

  function findHlsInFiber(fiber) {
    let current = fiber;
    let remaining = 200;

    while (current && remaining-- > 0) {
      const props = current.memoizedProps || current.pendingProps;
      const inProps = findHlsInValue(props);
      if (inProps) return inProps;

      let hook = current.memoizedState;
      let hookCount = 0;
      while (hook && hookCount++ < 30) {
        const inHook = findHlsInValue(hook.memoizedState);
        if (inHook) return inHook;
        hook = hook.next;
      }

      current = current.return;
    }
    return null;
  }

  function discover() {
    scanQueued = false;
    if (!document.documentElement) return;

    for (const video of document.querySelectorAll("video")) {
      registerVideo(video);
    }

    // hls.js access is an enhancement. The direct video controller remains
    // fully active when React internals or bundle layout hide the Hls instance.
    const candidates = document.querySelectorAll("video, button, [role='button'], div");
    for (const node of candidates) {
      const fiber = getReactFiber(node);
      if (!fiber) continue;
      const hls = findHlsInFiber(fiber);
      if (hls) registerHls(hls);
    }

    for (const video of [...videos]) {
      if (!video.isConnected) {
        destroyVideo(video);
        videos.delete(video);
      }
    }
  }

  function registerVideo(video) {
    if (videos.has(video)) return videoState.get(video);

    const state = {
      video,
      hls: null,
      listeners: [],
      timer: null,
      applied: false,
      holding: false,
      holdAnchor: null,
      holdStartedAt: 0,
      resumeAfterHold: false,
      internalSeekUntil: 0,
      previousTime: Number(video.currentTime) || 0,
      previousWallTime: performance.now(),
      lastSafeTime: null,
      lastRebuildNonce: null,
      lastTargetSeconds: null,
      effectiveTargetSeconds: null,
      targetConstraintReason: null,
      reserveBestForwardBuffer: 0,
      reserveBestBufferedSpan: 0,
      reserveLastGrowthAt: 0,
      preventedJumps: 0,
      forcedCorrections: 0,
      recoveryCount: 0,
      recoveryStage: 0,
      starvedSince: null,
      lastWaitingAt: null,
      lastMediaEdge: null,
      lastMediaProgressAt: performance.now(),
      frameReloadTimer: null,
      lastFatalManifestErrorAt: null,
      fatalNetworkErrorCount: 0,
      fatalNetworkErrorWindowStart: 0,
      lastJump: null,
      lastReason: "video detected; waiting for media",
      everPlayed: !video.paused,
    };

    videos.add(video);
    videoState.set(video, state);

    addVideoListener(state, "seeking", () => {
      window.setTimeout(() => controlTick(state), 0);
    });
    addVideoListener(state, "waiting", () => {
      state.lastWaitingAt = performance.now();
      window.setTimeout(() => controlTick(state), 0);
    });
    addVideoListener(state, "stalled", () => {
      state.lastWaitingAt = performance.now();
      window.setTimeout(() => controlTick(state), 0);
    });
    addVideoListener(state, "progress", () => observeMediaProgress(state));
    addVideoListener(state, "durationchange", () => observeMediaProgress(state));
    addVideoListener(state, "loadedmetadata", () => observeMediaProgress(state));
    addVideoListener(state, "playing", () => {
      state.everPlayed = true;
      if (state.holding) {
        state.resumeAfterHold = true;
        window.setTimeout(() => {
          if (state.holding && !video.paused) video.pause();
        }, 0);
      } else {
        state.lastReason = "latency locked";
      }
    });

    state.timer = window.setInterval(() => controlTick(state), CONTROL_INTERVAL_MS);
    if (config) applyVideoConfig(state);

    console.info(LOG_PREFIX, "Video element detected; direct latency controller active.");
    return state;
  }

  function addVideoListener(state, type, listener) {
    state.video.addEventListener(type, listener);
    state.listeners.push(() => state.video.removeEventListener(type, listener));
  }

  function destroyVideo(video) {
    const state = videoState.get(video);
    if (!state) return;
    if (state.timer !== null) window.clearInterval(state.timer);
    if (state.frameReloadTimer !== null) window.clearTimeout(state.frameReloadTimer);
    for (const remove of state.listeners.splice(0)) remove();
    if (state.holding) endReserveBuild(state, false);
  }

  function registerHls(hls) {
    if (hlsInstances.has(hls)) {
      associateHlsWithMedia(hls);
      return;
    }

    const original = {
      lowLatencyMode: hls.lowLatencyMode,
      configLowLatencyMode: hls.config.lowLatencyMode,
      liveSyncDuration: hls.config.liveSyncDuration,
      liveSyncDurationCount: hls.config.liveSyncDurationCount,
      liveSyncOnStallIncrease: hls.config.liveSyncOnStallIncrease,
      liveMaxLatencyDuration: hls.config.liveMaxLatencyDuration,
      liveMaxLatencyDurationCount: hls.config.liveMaxLatencyDurationCount,
      maxLiveSyncPlaybackRate: hls.config.maxLiveSyncPlaybackRate,
      liveSyncMode: hls.config.liveSyncMode,
      maxBufferLength: hls.config.maxBufferLength,
      maxMaxBufferLength: hls.config.maxMaxBufferLength,
      backBufferLength: hls.config.backBufferLength,
    };

    hlsInstances.add(hls);
    hlsState.set(hls, {
      original,
      applied: false,
      lastTarget: null,
      listeners: [],
      registeredAt: performance.now(),
      lastLevelEdge: null,
      lastLevelAdvancedAt: performance.now(),
      lastError: null,
    });
    registerHlsListeners(hls);
    associateHlsWithMedia(hls);
    if (config && config.enabled) enforceHlsConfig(hls);

    console.info(LOG_PREFIX, "AngelThump hls.js instance detected; HLS tuning active.");
  }

  function associateHlsWithMedia(hls) {
    const media = hls.media;
    if (!(media instanceof HTMLMediaElement)) return;
    const state = registerVideo(media);
    if (!state) return;

    const current = getActiveHls(state);
    if (!current || current === hls || hlsFreshness(hls) >= hlsFreshness(current)) {
      state.hls = hls;
    }
  }

  function registerHlsListeners(hls) {
    const state = hlsState.get(hls);
    if (!state || state.listeners.length || typeof hls.on !== "function") return;

    const constructor = hls.constructor || {};
    const events = constructor.Events || {};
    const errorTypes = constructor.ErrorTypes || {};
    let lastQuietRestartAt = 0;
    let quietRestartDelay = RecoveryLogic.FATAL_ERROR_RESTART_MIN_DELAY_MS;

    const levelUpdatedEvent = events.LEVEL_UPDATED || "hlsLevelUpdated";
    const fragBufferedEvent = events.FRAG_BUFFERED || "hlsFragBuffered";
    const errorEvent = events.ERROR || "hlsError";

    const onLevelUpdated = (_event, data) => {
      const details = data && data.details;
      const edge = Number(details && details.edge);
      if (
        Number.isFinite(edge) &&
        (!Number.isFinite(state.lastLevelEdge) ||
          edge > state.lastLevelEdge + MEDIA_EDGE_PROGRESS_SECONDS ||
          Boolean(details && details.advanced))
      ) {
        state.lastLevelEdge = edge;
        state.lastLevelAdvancedAt = performance.now();
        const media = hls.media;
        if (media instanceof HTMLMediaElement) {
          const video = videoState.get(media);
          if (video) markStreamProgress(video);
        }
      }
    };

    const onFragBuffered = () => {
      const media = hls.media;
      if (!(media instanceof HTMLMediaElement)) return;
      const video = videoState.get(media);
      if (video) markStreamProgress(video);
    };

    const onError = (_event, data) => {
      state.lastError = data || null;
      const fatal = Boolean(data && data.fatal);
      const type = data && data.type;
      const details = data && data.details;
      const networkError =
        type === "networkError" ||
        type === errorTypes.NETWORK_ERROR;

      // Any fatal network-layer failure (manifest, level, or fragment load errors,
      // including CORS-blocked CDN edge hosts) means hls.js gave up loading the
      // current playlist/level on its own. We don't reload immediately -- the
      // video keeps playing off whatever is still buffered. We just mark the
      // playlist stale so handlePlaybackStarvation's existing buffer-aware
      // recovery ladder (soft HLS restart, then frame reload only once playback
      // actually starves) kicks in instead of hls.js retrying the same broken
      // host forever with no visible recovery.
      if (!fatal || !networkError) return;
      const media = hls.media;
      if (!(media instanceof HTMLMediaElement)) return;
      const video = videoState.get(media);
      if (!video) return;

      video.lastFatalManifestErrorAt = performance.now();
      video.lastWaitingAt = performance.now();
      video.lastReason = `fatal ${details || "network"} error; recovery pending`;
      console.warn(
        LOG_PREFIX,
        `Fatal HLS network error (${details || "unknown"}) at ${data && data.url}; ` +
          `forwardBuffer ${formatOne(getForwardBuffer(video.video))}s, will recover once buffer starves.`,
      );

      const now = performance.now();
      if (now - video.fatalNetworkErrorWindowStart > FATAL_ERROR_WINDOW_MS) {
        video.fatalNetworkErrorWindowStart = now;
        video.fatalNetworkErrorCount = 0;
        quietRestartDelay = RecoveryLogic.FATAL_ERROR_RESTART_MIN_DELAY_MS;
      }
      video.fatalNetworkErrorCount += 1;

      // Quietly nudge hls.js to retry loading without touching playback or the
      // paused/holding state. Backs off 2s -> 4s -> 8s (capped) so a host that's
      // unreachable for a while (e.g. DNS failure) still gets retried regularly
      // instead of either spamming retries or, at the other extreme, going
      // quiet for minutes.
      if (now - lastQuietRestartAt > quietRestartDelay) {
        lastQuietRestartAt = now;
        quietRestartDelay = RecoveryLogic.nextQuietRestartDelay(quietRestartDelay);
        try {
          hls.startLoad(video.holding ? video.video.currentTime : -1);
        } catch (_error) {
          // Ignore a destroyed/replaced Hls instance.
        }
      }
    };

    hls.on(levelUpdatedEvent, onLevelUpdated);
    hls.on(fragBufferedEvent, onFragBuffered);
    hls.on(errorEvent, onError);
    state.listeners.push(
      () => hls.off?.(levelUpdatedEvent, onLevelUpdated),
      () => hls.off?.(fragBufferedEvent, onFragBuffered),
      () => hls.off?.(errorEvent, onError),
    );
  }

  function hlsFreshness(hls) {
    const details = hls && hls.latestLevelDetails;
    const advancedDateTime = details ? Number(details.advancedDateTime) : NaN;
    if (Number.isFinite(advancedDateTime)) return advancedDateTime;
    const state = hlsState.get(hls);
    return state ? state.registeredAt : 0;
  }

  function getActiveHls(state) {
    const hls = state && state.hls;
    if (!hls) return null;

    let media = null;
    try {
      media = hls.media;
    } catch (_error) {
      media = null;
    }

    if (media !== state.video || !hls.config) {
      state.hls = null;
      return null;
    }
    return hls;
  }

  function clearTargetConstraint(state) {
    state.effectiveTargetSeconds = null;
    state.targetConstraintReason = null;
  }

  function getControlTarget(state) {
    const requested = config ? config.targetSeconds : DEFAULT_CONFIG.targetSeconds;
    const constrained = state ? state.effectiveTargetSeconds : null;
    return Number.isFinite(constrained)
      ? Math.min(requested, Math.max(1, constrained))
      : requested;
  }

  function getLowTolerance(targetSeconds) {
    return RecoveryLogic.getLowTolerance(targetSeconds);
  }

  function getHighTolerance(targetSeconds) {
    return targetSeconds * HIGH_TOLERANCE_RATIO;
  }

  function getAdaptiveReserveRequirements(state, target) {
    const targetDuration = getPlaylistTargetDuration(state);
    const requirements = RecoveryLogic.getAdaptiveReserveRequirements(target, targetDuration);
    return {
      targetDuration,
      requiredForwardBuffer: requirements.requiredForwardBuffer,
      minimumForwardBuffer: requirements.minimumForwardBuffer,
      stalledGrowthMs: Math.max(RESERVE_STALL_MIN_MS, targetDuration * 2500),
    };
  }

  function enforceHlsConfig(hls) {
    if (!config || !config.enabled || !hls || !hls.config) return;
    const state = hlsState.get(hls);
    const media = hls.media;
    const mediaState = media instanceof HTMLMediaElement ? videoState.get(media) : null;
    const target = mediaState ? getControlTarget(mediaState) : config.targetSeconds;
    const requestedBuffer = Math.max(30, target + 18);

    try {
      hls.lowLatencyMode = false;
    } catch (_error) {
      // The config assignment below is sufficient on builds without a setter.
    }
    hls.config.lowLatencyMode = false;
    hls.config.liveSyncDuration = target;
    hls.config.liveSyncDurationCount = undefined;
    hls.config.liveSyncOnStallIncrease = 0;
    hls.config.liveMaxLatencyDuration = target + 120;
    hls.config.liveMaxLatencyDurationCount = Number.POSITIVE_INFINITY;
    hls.config.maxLiveSyncPlaybackRate = 1;
    hls.config.liveSyncMode = "buffered";
    hls.config.maxBufferLength = Math.max(Number(hls.config.maxBufferLength) || 0, requestedBuffer);
    hls.config.maxMaxBufferLength = Math.max(
      Number(hls.config.maxMaxBufferLength) || 0,
      requestedBuffer + 60,
    );

    const backBuffer = Number(hls.config.backBufferLength);
    if (Number.isFinite(backBuffer)) {
      hls.config.backBufferLength = Math.max(backBuffer, target + 30);
    }

    if (state && state.lastTarget !== target) {
      state.lastTarget = target;
      state.applied = true;
      try {
        hls.targetLatency = target;
      } catch (_error) {
        // Some builds expose targetLatency as a getter only. The config is still applied.
      }
    }

    if (typeof hls.resumeBuffering === "function") {
      try {
        hls.resumeBuffering();
      } catch (_error) {
        // Ignore destroyed/replaced instances.
      }
    }
  }

  function restoreHlsConfig(hls) {
    const state = hlsState.get(hls);
    if (!state || !state.applied || !hls.config) return;
    const original = state.original;

    hls.config.lowLatencyMode = original.configLowLatencyMode;
    hls.config.liveSyncDuration = original.liveSyncDuration;
    hls.config.liveSyncDurationCount = original.liveSyncDurationCount;
    hls.config.liveSyncOnStallIncrease = original.liveSyncOnStallIncrease;
    hls.config.liveMaxLatencyDuration = original.liveMaxLatencyDuration;
    hls.config.liveMaxLatencyDurationCount = original.liveMaxLatencyDurationCount;
    hls.config.maxLiveSyncPlaybackRate = original.maxLiveSyncPlaybackRate;
    hls.config.liveSyncMode = original.liveSyncMode;
    hls.config.maxBufferLength = original.maxBufferLength;
    hls.config.maxMaxBufferLength = original.maxMaxBufferLength;
    hls.config.backBufferLength = original.backBufferLength;
    try {
      hls.lowLatencyMode = original.lowLatencyMode;
    } catch (_error) {
      // No writable setter in this build.
    }

    state.applied = false;
    state.lastTarget = null;
  }

  function applyVideoConfig(state) {
    if (!config) return;

    if (!config.enabled) {
      if (state.holding) endReserveBuild(state, false);
      state.applied = false;
      state.lastReason = "disabled";
      return;
    }

    const firstApply = !state.applied;
    const rebuildRequested = state.lastRebuildNonce !== config.rebuildNonce;
    const previousTarget = state.lastTargetSeconds;
    const targetChanged =
      Number.isFinite(previousTarget) && previousTarget !== config.targetSeconds;
    state.applied = true;
    state.lastRebuildNonce = config.rebuildNonce;
    state.lastTargetSeconds = config.targetSeconds;

    if (firstApply || rebuildRequested || targetChanged) {
      clearTargetConstraint(state);
    }

    if (state.hls) enforceHlsConfig(state.hls);

    if (firstApply || rebuildRequested) {
      state.lastReason = firstApply ? "preparing initial reserve" : "rebuild requested";
      beginReserveBuild(state, state.lastReason);
    } else if (targetChanged) {
      retargetVideo(state);
    }
  }

  function retargetVideo(state) {
    const video = state.video;
    const targetSeconds = getControlTarget(state);
    if (video.readyState === HTMLMediaElement.HAVE_NOTHING) {
      state.lastReason = `delay changed to ${formatOne(targetSeconds)}s; waiting for stream data`;
      return;
    }

    const edge = estimateLiveEdge(state);
    const latency = Number.isFinite(edge) ? edge - video.currentTime : null;
    if (!Number.isFinite(latency)) {
      state.lastReason = `delay changed to ${formatOne(targetSeconds)}s; waiting for live-edge timing`;
      return;
    }

    if (latency < targetSeconds - 0.25) {
      beginReserveBuild(state, `building ${formatOne(targetSeconds)}s reserve`);
      return;
    }

    const resolved = resolveTargetPosition(state, targetSeconds, true);
    if (resolved && Math.abs(resolved.position - video.currentTime) > 0.15) {
      performInternalSeek(state, resolved.position);
      state.forcedCorrections += 1;
      state.lastSafeTime = resolved.position;
      state.lastReason = resolved.constrained
        ? `stream window limits locked delay to ${formatOne(getControlTarget(state))}s`
        : `adjusted locked delay to ${formatOne(targetSeconds)}s`;
      return;
    }

    state.lastSafeTime = video.currentTime;
    state.lastReason = `locked delay set to ${formatOne(targetSeconds)}s`;
  }

  function controlTick(state) {
    if (!state.video.isConnected) return;
    if (!config) return;

    if (!config.enabled) {
      if (state.holding) endReserveBuild(state, false);
      state.lastReason = "disabled";
      publishPrimaryStatus();
      return;
    }

    if (!state.applied) applyVideoConfig(state);
    const activeHls = getActiveHls(state);
    if (activeHls) enforceHlsConfig(activeHls);

    const video = state.video;
    if (video.readyState === HTMLMediaElement.HAVE_NOTHING) {
      state.lastReason = "video detected; waiting for stream data";
      rememberPosition(state);
      publishPrimaryStatus();
      return;
    }

    observeMediaProgress(state);
    const liveEdge = estimateLiveEdge(state);
    const latency = Number.isFinite(liveEdge) ? liveEdge - video.currentTime : null;
    const forwardBuffer = getForwardBuffer(video);
    const targetSeconds = getControlTarget(state);

    detectAndUndoForwardJump(state, latency, targetSeconds);

    if (handlePlaybackStarvation(state, forwardBuffer)) {
      rememberPosition(state);
      publishPrimaryStatus();
      return;
    }

    if (state.holding) {
      continueReserveBuild(state);
      rememberPosition(state);
      publishPrimaryStatus();
      return;
    }

    if (!Number.isFinite(latency)) {
      state.lastReason = "waiting for live-edge timing";
      rememberPosition(state);
      publishPrimaryStatus();
      return;
    }

    if (latency < targetSeconds - getLowTolerance(targetSeconds)) {
      correctTooClose(state, "player moved too close to live", targetSeconds);
    } else if (latency > targetSeconds + getHighTolerance(targetSeconds)) {
      const resolved = resolveTargetPosition(state, targetSeconds, true);
      if (resolved) {
        performInternalSeek(state, resolved.position);
        state.forcedCorrections += 1;
        state.lastSafeTime = resolved.position;
        state.lastReason = resolved.constrained
          ? `stream window limits locked delay to ${formatOne(getControlTarget(state))}s`
          : "trimmed excess delay to target";
      }
    } else {
      state.lastSafeTime = video.currentTime;
      if (Number.isFinite(state.effectiveTargetSeconds)) {
        state.lastReason = `latency locked at ${formatOne(targetSeconds)}s (stream-window limit)`;
      } else {
        state.lastReason = getActiveHls(state)
          ? "latency locked (HLS + video)"
          : "latency locked (video controller)";
      }
    }

    rememberPosition(state);
    publishPrimaryStatus();
  }

  function detectAndUndoForwardJump(state, currentLatency, targetSeconds) {
    const video = state.video;
    if (performance.now() < state.internalSeekUntil) return;
    if (!Number.isFinite(state.previousTime)) return;

    const elapsed = Math.max(0, (performance.now() - state.previousWallTime) / 1000);
    const expectedAdvance = video.paused ? 0 : elapsed * Math.max(0, Number(video.playbackRate) || 1);
    const expectedTime = state.previousTime + expectedAdvance;
    const jump = video.currentTime - expectedTime;

    if (
      jump <= JUMP_THRESHOLD_SECONDS ||
      !Number.isFinite(currentLatency) ||
      currentLatency >= targetSeconds - getLowTolerance(targetSeconds)
    ) {
      return;
    }

    const from = video.currentTime;
    let target = null;

    if (state.holding && Number.isFinite(state.holdAnchor)) {
      target = findBufferedTarget(video, state.holdAnchor, 0.05);
    }
    if (!Number.isFinite(target) && Number.isFinite(state.lastSafeTime)) {
      target = findBufferedTarget(video, state.lastSafeTime, 0.05);
    }
    if (!Number.isFinite(target)) {
      const edge = estimateLiveEdge(state);
      const resolved = resolveTargetPosition(state, targetSeconds, true);
      target = resolved ? resolved.position : null;
    }

    if (Number.isFinite(target)) {
      performInternalSeek(state, target);
      state.preventedJumps += 1;
      state.lastJump = { from, to: target, at: Date.now(), latency: currentLatency };
      state.lastReason = "blocked automatic forward resync";
      console.warn(
        LOG_PREFIX,
        `Forward jump undone: from ${formatOne(from)}s to ${formatOne(target)}s ` +
          `(jump ${formatOne(jump)}s, latency ${formatOne(currentLatency)}s, forwardBuffer ${formatOne(getForwardBuffer(video))}s).`,
      );
    } else {
      console.warn(
        LOG_PREFIX,
        `Forward jump detected but could not be undone: from ${formatOne(from)}s ` +
          `(jump ${formatOne(jump)}s, latency ${formatOne(currentLatency)}s, ` +
          `buffered ranges ${describeRanges(video.buffered)}, seekable ranges ${describeRanges(video.seekable)}).`,
      );
    }
  }

  function correctTooClose(state, reason, targetSeconds = getControlTarget(state)) {
    const resolved = resolveTargetPosition(state, targetSeconds, true);

    if (resolved) {
      const from = state.video.currentTime;
      performInternalSeek(state, resolved.position);
      state.forcedCorrections += 1;
      state.lastSafeTime = resolved.position;
      state.lastJump = { from, to: resolved.position, at: Date.now() };
      state.lastReason = resolved.constrained
        ? `stream window limits locked delay to ${formatOne(getControlTarget(state))}s`
        : reason;
      if (resolved.source !== "buffered") restartLoadingAt(state, resolved.position);
      return;
    }

    console.warn(
      LOG_PREFIX,
      `correctTooClose could not find a safe position (reason: ${reason}); ` +
        `falling back to a full reserve rebuild. forwardBuffer was ${formatOne(getForwardBuffer(state.video))}s, ` +
        `buffered ranges ${describeRanges(state.video.buffered)}, seekable ranges ${describeRanges(state.video.seekable)}.`,
    );
    beginReserveBuild(state, reason);
  }

  function observeMediaProgress(state) {
    const edge = getPlayableMediaEnd(state.video);
    if (!Number.isFinite(edge)) return;

    if (
      !Number.isFinite(state.lastMediaEdge) ||
      edge > state.lastMediaEdge + MEDIA_EDGE_PROGRESS_SECONDS ||
      edge < state.lastMediaEdge - 5
    ) {
      state.lastMediaEdge = edge;
      markStreamProgress(state);
    }
  }

  function markStreamProgress(state) {
    state.lastMediaProgressAt = performance.now();
    state.starvedSince = null;
    state.recoveryStage = 0;
    state.lastFatalManifestErrorAt = null;
    if (state.frameReloadTimer !== null) {
      window.clearTimeout(state.frameReloadTimer);
      state.frameReloadTimer = null;
    }
  }

  function handlePlaybackStarvation(state, forwardBuffer) {
    const video = state.video;
    const now = performance.now();
    const recentlyWaiting =
      Number.isFinite(state.lastWaitingAt) && now - state.lastWaitingAt < 3000;
    const playbackExpected = state.holding || !video.paused || state.resumeAfterHold;
    const mediaStarved =
      forwardBuffer <= STARVED_BUFFER_SECONDS &&
      (video.readyState <= HTMLMediaElement.HAVE_CURRENT_DATA || video.ended || recentlyWaiting);

    if (!playbackExpected || !mediaStarved) {
      state.starvedSince = null;
      state.recoveryStage = 0;
      return false;
    }

    if (!Number.isFinite(state.starvedSince)) state.starvedSince = now;
    const elapsed = now - state.starvedSince;
    const hls = getActiveHls(state);
    const playlistAge = getPlaylistAge(state);
    const targetDuration = getPlaylistTargetDuration(state);
    const stalePlaylistThreshold = Math.max(8, targetDuration * 3);
    const manifestFailedRecently =
      Number.isFinite(state.lastFatalManifestErrorAt) &&
      now - state.lastFatalManifestErrorAt < 30000;
    const playlistStale =
      manifestFailedRecently ||
      (Number.isFinite(playlistAge) && playlistAge >= stalePlaylistThreshold);

    if (hls && state.recoveryStage < 1 && elapsed >= SOFT_RECOVERY_DELAY_MS) {
      try {
        hls.resumeBuffering?.();
        hls.startLoad(state.holding ? video.currentTime : -1);
        state.recoveryStage = 1;
        state.recoveryCount += 1;
        state.lastReason = "stream starved; restarted HLS loading";
        console.warn(LOG_PREFIX, "Playback starved; restarted HLS loading.");
      } catch (error) {
        console.warn(LOG_PREFIX, "HLS loading restart failed.", error);
      }
      return true;
    }

    if (
      elapsed >= FRAME_RECOVERY_DELAY_MS &&
      (playlistStale || !hls || now - state.lastMediaProgressAt >= FRAME_RECOVERY_DELAY_MS)
    ) {
      schedulePlayerFrameReload(state, playlistStale ? "playlist stopped advancing" : "stream remained starved");
      return true;
    }

    const ageText = Number.isFinite(playlistAge) ? `, playlist age ${formatOne(playlistAge)}s` : "";
    state.lastReason = `stream stalled; recovering (${formatOne(forwardBuffer)}s buffered${ageText})`;
    return true;
  }

  function schedulePlayerFrameReload(state, reason) {
    if (state.frameReloadTimer !== null) return;
    if (location.hostname !== "player.angelthump.com") {
      state.lastReason = `${reason}; reload the stream tab`;
      return;
    }

    // A full navigation is what actually recovers from a stuck DNS/socket-layer
    // failure (the same thing a manual page refresh does) -- unlike the quiet
    // hls.startLoad() retries above, which just repeat the same failing request
    // inside the same broken network context. So this keeps reloading on a
    // steady cadence (paced naturally by FRAME_RECOVERY_DELAY_MS, roughly every
    // ~10s) rather than giving up after a handful of attempts and leaving the
    // viewer stuck for minutes with no way to recover short of a manual refresh.
    // The budget check below never blocks the reload (reloadBudgetIsAdvisoryOnly
    // is always true) -- it only decides whether to log that the budget was
    // exceeded. The reload itself always proceeds; see the function's comment
    // in recovery-logic.js for why.
    const history = readFrameReloadHistory();
    if (history.length >= MAX_FRAME_RELOADS_PER_WINDOW && RecoveryLogic.reloadBudgetIsAdvisoryOnly()) {
      console.warn(
        LOG_PREFIX,
        `Reload budget (${MAX_FRAME_RELOADS_PER_WINDOW} per ${FRAME_RELOAD_WINDOW_MS / 1000}s) ` +
          `exceeded but stream is still stalled; reloading anyway.`,
      );
    }

    const now = Date.now();
    if (now - lastStallNotificationAt > STALL_NOTIFICATION_THROTTLE_MS) {
      lastStallNotificationAt = now;
      window.postMessage({ source: PAGE_SOURCE, type: "stall-notify", reason }, "*");
    }

    state.lastReason = `${reason}; reloading player frame`;
    state.recoveryStage = 2;
    state.recoveryCount += 1;
    state.frameReloadTimer = window.setTimeout(() => {
      state.frameReloadTimer = null;
      if (!isStillStarved(state)) {
        markStreamProgress(state);
        return;
      }
      const updatedHistory = readFrameReloadHistory();
      updatedHistory.push(Date.now());
      sessionStorage.setItem(FRAME_RELOAD_HISTORY_KEY, JSON.stringify(updatedHistory));
      console.warn(LOG_PREFIX, `Reloading player frame: ${reason}.`);
      location.reload();
    }, 750);
  }

  function readFrameReloadHistory() {
    const cutoff = Date.now() - FRAME_RELOAD_WINDOW_MS;
    try {
      const parsed = JSON.parse(sessionStorage.getItem(FRAME_RELOAD_HISTORY_KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.map(Number).filter((value) => Number.isFinite(value) && value >= cutoff);
    } catch (_error) {
      return [];
    }
  }

  function isStillStarved(state) {
    const video = state.video;
    if (!video.isConnected) return false;
    const forwardBuffer = getForwardBuffer(video);
    return (
      forwardBuffer <= STARVED_BUFFER_SECONDS &&
      (video.readyState <= HTMLMediaElement.HAVE_CURRENT_DATA ||
        video.ended ||
        (Number.isFinite(state.lastWaitingAt) &&
          performance.now() - state.lastWaitingAt < 5000))
    );
  }

  function getPlaylistAge(state) {
    const hls = getActiveHls(state);
    const details = hls && hls.latestLevelDetails;
    const age = details ? Number(details.age) : NaN;
    return Number.isFinite(age) ? age : null;
  }

  function getPlaylistTargetDuration(state) {
    const hls = getActiveHls(state);
    const details = hls && hls.latestLevelDetails;
    const targetDuration = Number(details && (details.targetduration || details.levelTargetDuration));
    return Number.isFinite(targetDuration) && targetDuration > 0 ? targetDuration : 3;
  }

  function beginReserveBuild(state, reason) {
    if (!config || !config.enabled || state.holding) return;
    const video = state.video;
    if (video.readyState === HTMLMediaElement.HAVE_NOTHING) {
      state.lastReason = "waiting for stream data before building reserve";
      return;
    }

    const targetSeconds = getControlTarget(state);
    const edge = estimateLiveEdge(state);
    const latency = Number.isFinite(edge) ? edge - video.currentTime : null;
    // Sitting at the target latency only means the playhead is positioned
    // correctly relative to the live edge -- it says nothing about how much of
    // that gap is actually downloaded and sitting in the buffer. isReserveReady
    // requires both, so a thin real buffer (e.g. right after a seek/restart,
    // before the CDN has handed over more segments) doesn't get waved through
    // as "fine" and starve within a second or two of any real network hiccup
    // instead of surviving the full target window.
    const reserveReady = RecoveryLogic.isReserveReady(
      latency,
      getForwardBuffer(video),
      targetSeconds,
      getPlaylistTargetDuration(state),
    );
    if (reserveReady) {
      state.lastSafeTime = video.currentTime;
      state.lastReason = "reserve already available";
      return;
    }

    const now = performance.now();
    state.holding = true;
    state.holdAnchor = video.currentTime;
    state.holdStartedAt = now;
    state.resumeAfterHold = !video.paused && !video.ended;
    state.reserveBestForwardBuffer = getForwardBuffer(video);
    state.reserveBestBufferedSpan = getBufferedSpan(video);
    state.reserveLastGrowthAt = now;
    state.lastReason = reason;

    const activeHls = getActiveHls(state);
    if (activeHls && typeof activeHls.resumeBuffering === "function") {
      try {
        activeHls.resumeBuffering();
      } catch (_error) {
        // Ignore a replaced Hls instance.
      }
    }

    if (!video.paused) video.pause();
    console.warn(
      LOG_PREFIX,
      `Holding playback to build a real ${targetSeconds}s reserve (reason: ${reason}). ` +
        `forwardBuffer dropping from ${formatOne(state.reserveBestForwardBuffer)}s, ` +
        `anchor ${formatOne(state.holdAnchor)}s, ` +
        `buffered ranges ${describeRanges(video.buffered)}.`,
    );
  }

  function continueReserveBuild(state) {
    const video = state.video;
    const now = performance.now();
    let targetSeconds = getControlTarget(state);
    let anchor = state.holdAnchor;

    if (Number.isFinite(anchor) && Math.abs(video.currentTime - anchor) > 0.35) {
      const restored = findBufferedTarget(video, anchor, 0.05);
      if (Number.isFinite(restored)) {
        const from = video.currentTime;
        performInternalSeek(state, restored);
        state.preventedJumps += 1;
        state.lastJump = { from, to: restored, at: Date.now() };
        state.lastReason = "blocked forward jump while building reserve";
      } else {
        const resolved = resolveTargetPosition(state, targetSeconds, true);
        if (resolved) {
          state.holdAnchor = resolved.position;
          performInternalSeek(state, resolved.position);
          if (resolved.source !== "buffered") restartLoadingAt(state, resolved.position);
          state.lastReason = resolved.constrained
            ? `stream window limits locked delay to ${formatOne(getControlTarget(state))}s`
            : "reserve anchor moved to the active stream window";
        }
      }
    }

    if (!video.paused) {
      state.resumeAfterHold = true;
      video.pause();
    }

    let edge = estimateLiveEdge(state);
    let latency = Number.isFinite(edge) ? edge - video.currentTime : null;

    // Once the requested delay exists, move the paused playhead along with the
    // live edge instead of letting the delay grow without bound. This keeps
    // the target position inside the active HLS window while the safety buffer
    // finishes filling.
    if (
      Number.isFinite(latency) &&
      latency > targetSeconds + TARGET_TRACKING_INTERVAL_SECONDS
    ) {
      const resolved = resolveTargetPosition(state, targetSeconds, true);
      if (resolved) {
        if (Math.abs(resolved.position - video.currentTime) > 0.15) {
          performInternalSeek(state, resolved.position);
          state.holdAnchor = resolved.position;
          if (resolved.source !== "buffered") restartLoadingAt(state, resolved.position);
        }
        targetSeconds = getControlTarget(state);
        edge = estimateLiveEdge(state);
        latency = Number.isFinite(edge) ? edge - video.currentTime : null;
      }
    }

    const forwardBuffer = getForwardBuffer(video);
    const bufferedSpan = getBufferedSpan(video);
    if (
      forwardBuffer > state.reserveBestForwardBuffer + RESERVE_BUFFER_GROWTH_SECONDS ||
      bufferedSpan > state.reserveBestBufferedSpan + RESERVE_BUFFER_GROWTH_SECONDS
    ) {
      state.reserveBestForwardBuffer = Math.max(state.reserveBestForwardBuffer, forwardBuffer);
      state.reserveBestBufferedSpan = Math.max(state.reserveBestBufferedSpan, bufferedSpan);
      state.reserveLastGrowthAt = now;
    }

    const requirements = getAdaptiveReserveRequirements(state, targetSeconds);
    const targetReached =
      Number.isFinite(latency) && latency >= targetSeconds - 0.25;
    const fullSafetyReady =
      forwardBuffer >= requirements.requiredForwardBuffer - 0.35;
    const bufferGrowthStalled =
      now - state.reserveLastGrowthAt >= requirements.stalledGrowthMs;
    const minimumSafetyReady =
      forwardBuffer >= requirements.minimumForwardBuffer - 0.35;
    const timedOut = now - state.holdStartedAt > MAX_RESERVE_BUILD_SECONDS * 1000;

    if (targetReached && fullSafetyReady) {
      finishReserveBuild(state, "reserve built; latency locked");
      return;
    }

    if (targetReached && bufferGrowthStalled && minimumSafetyReady) {
      finishReserveBuild(
        state,
        `reserve growth stopped at ${formatOne(forwardBuffer)}s; using available safety buffer`,
      );
      return;
    }

    if (timedOut) {
      finishReserveBuild(state, "reserve build timed out; using available safety buffer");
      console.warn(LOG_PREFIX, "Reserve build timed out before the preferred safety buffer was available.");
      return;
    }

    state.lastReason = `building reserve (${formatOne(latency)}s latency, ${formatOne(forwardBuffer)}s buffered; need ${formatOne(requirements.requiredForwardBuffer)}s)`;
  }

  function finishReserveBuild(state, reason) {
    const targetSeconds = getControlTarget(state);
    const resolved = resolveTargetPosition(state, targetSeconds, true);
    if (resolved) {
      if (Math.abs(resolved.position - state.video.currentTime) > 0.15) {
        performInternalSeek(state, resolved.position);
      }
      state.holdAnchor = resolved.position;
      state.lastSafeTime = resolved.position;
      if (resolved.source !== "buffered" || getForwardBuffer(state.video) < 1) {
        restartLoadingAt(state, resolved.position);
      }
    }

    endReserveBuild(state, true);
    if (Number.isFinite(state.effectiveTargetSeconds)) {
      state.lastReason = `stream window limits locked delay to ${formatOne(getControlTarget(state))}s`;
    } else {
      state.lastReason = reason;
    }
  }

  function endReserveBuild(state, resume) {
    if (!state.holding) return;
    const shouldResume = resume && state.resumeAfterHold;
    state.holding = false;
    state.holdAnchor = null;
    state.resumeAfterHold = false;

    if (shouldResume && state.video.paused) {
      void state.video.play().catch(() => {
        state.lastReason = "click play to resume after reserve build";
      });
    }
  }

  function performInternalSeek(state, target) {
    if (!Number.isFinite(target)) return;
    state.internalSeekUntil = performance.now() + 700;
    state.video.currentTime = target;
    state.previousTime = target;
    state.previousWallTime = performance.now();
  }

  function restartLoadingAt(state, target) {
    const hls = getActiveHls(state);
    if (!hls) return;
    try {
      hls.resumeBuffering?.();
      hls.startLoad(target);
    } catch (_error) {
      // Ignore a destroyed or replaced Hls instance.
    }
  }

  function resolveTargetPosition(state, requestedTargetSeconds, allowClamp) {
    const edge = estimateLiveEdge(state);
    if (!Number.isFinite(edge)) return null;
    const desired = edge - requestedTargetSeconds;

    const buffered = findRangeTarget(
      state.video.buffered,
      desired,
      SEEK_MARGIN_SECONDS,
      false,
    );
    if (buffered) {
      if (buffered.exact && requestedTargetSeconds >= config.targetSeconds - 0.25) {
        clearTargetConstraint(state);
      }
      return {
        position: buffered.position,
        source: "buffered",
        constrained: false,
        effectiveTargetSeconds: edge - buffered.position,
      };
    }

    const seekable = findRangeTarget(
      state.video.seekable,
      desired,
      SEEK_MARGIN_SECONDS,
      false,
    );
    if (seekable) {
      if (seekable.exact && requestedTargetSeconds >= config.targetSeconds - 0.25) {
        clearTargetConstraint(state);
      }
      return {
        position: seekable.position,
        source: "seekable",
        constrained: false,
        effectiveTargetSeconds: edge - seekable.position,
      };
    }

    if (!allowClamp) return null;

    const clampedSeekable = findRangeTarget(
      state.video.seekable,
      desired,
      SEEK_MARGIN_SECONDS,
      true,
    );
    const clampedBuffered = clampedSeekable
      ? null
      : findRangeTarget(state.video.buffered, desired, SEEK_MARGIN_SECONDS, true);
    const clamped = clampedSeekable || clampedBuffered;
    if (!clamped) return null;
    const source = clampedSeekable ? "seekable" : "buffered";

    const effectiveTargetSeconds = Math.max(1, edge - clamped.position);
    const constrained = effectiveTargetSeconds < requestedTargetSeconds - 0.25;
    if (constrained) {
      state.effectiveTargetSeconds = effectiveTargetSeconds;
      state.targetConstraintReason = "active stream window";
      const hls = getActiveHls(state);
      if (hls) enforceHlsConfig(hls);
    }

    return {
      position: clamped.position,
      source,
      constrained,
      effectiveTargetSeconds,
    };
  }

  function estimateLiveEdge(state) {
    const hls = getActiveHls(state);
    const playableEnd = getPlayableMediaEnd(state.video);
    if (Number.isFinite(playableEnd)) return playableEnd;

    const details = hls && hls.latestLevelDetails;
    const playlistEdge = Number(details && details.edge);
    if (Number.isFinite(playlistEdge)) return playlistEdge;

    const syncPosition = hls ? Number(hls.liveSyncPosition) : NaN;
    const targetLatency = hls ? Number(hls.targetLatency) : NaN;
    if (Number.isFinite(syncPosition)) {
      return syncPosition + (Number.isFinite(targetLatency) ? targetLatency : config.targetSeconds);
    }
    return null;
  }

  function getPlayableMediaEnd(video) {
    const seekableEnd = getLastRangeEnd(video.seekable);
    if (Number.isFinite(seekableEnd)) return seekableEnd;
    const bufferedEnd = getLastRangeEnd(video.buffered);
    return Number.isFinite(bufferedEnd) ? bufferedEnd : null;
  }

  function getLastRangeEnd(ranges) {
    if (!ranges || ranges.length === 0) return null;
    try {
      const end = ranges.end(ranges.length - 1);
      return Number.isFinite(end) ? end : null;
    } catch (_error) {
      return null;
    }
  }

  function findRangeTarget(ranges, desired, margin, allowClamp) {
    if (!ranges || ranges.length === 0 || !Number.isFinite(desired)) return null;

    let nearest = null;
    for (let index = 0; index < ranges.length; index += 1) {
      let start;
      let end;
      try {
        start = ranges.start(index);
        end = ranges.end(index);
      } catch (_error) {
        continue;
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;

      const safeStart = Math.min(end, start + margin);
      const safeEnd = Math.max(start, end - margin);
      if (desired >= start - 0.75 && desired <= end + 0.75) {
        return {
          position: Math.min(safeEnd, Math.max(safeStart, desired)),
          exact: desired >= safeStart && desired <= safeEnd,
        };
      }

      if (!allowClamp) continue;
      const candidate = desired < safeStart ? safeStart : safeEnd;
      const distance = Math.abs(candidate - desired);
      if (!nearest || distance < nearest.distance) {
        nearest = { position: candidate, distance, exact: false };
      }
    }
    return nearest;
  }

  function findBufferedTarget(video, desired, margin) {
    const result = findRangeTarget(video.buffered, desired, margin, false);
    return result ? result.position : null;
  }

  function getEarliestBufferedTime(video, margin) {
    if (!video.buffered || video.buffered.length === 0) return null;
    try {
      return Math.min(video.buffered.end(0), video.buffered.start(0) + margin);
    } catch (_error) {
      return null;
    }
  }

  function getForwardBuffer(video) {
    if (!video.buffered) return 0;
    const current = video.currentTime;
    for (let index = 0; index < video.buffered.length; index += 1) {
      const start = video.buffered.start(index);
      const end = video.buffered.end(index);
      if (current >= start - 0.1 && current <= end + 0.1) {
        return Math.max(0, end - current);
      }
    }
    return 0;
  }

  function getBufferedSpan(video) {
    if (!video.buffered || video.buffered.length === 0) return 0;
    try {
      return Math.max(0, video.buffered.end(video.buffered.length - 1) - video.buffered.start(0));
    } catch (_error) {
      return 0;
    }
  }

  function rememberPosition(state) {
    state.previousTime = state.video.currentTime;
    state.previousWallTime = performance.now();
  }

  function selectPrimaryState() {
    let selected = null;
    let selectedScore = -1;
    for (const video of videos) {
      if (!video.isConnected) continue;
      const state = videoState.get(video);
      if (!state) continue;
      const area = Math.max(1, Number(video.clientWidth) * Number(video.clientHeight));
      const score = area + (video.readyState > 0 ? 1_000_000_000 : 0);
      if (score > selectedScore) {
        selected = state;
        selectedScore = score;
      }
    }
    return selected;
  }

  function publishPrimaryStatus(force = false) {
    const now = performance.now();
    if (!force && now - lastStatusSentAt < STATUS_INTERVAL_MS) return;
    lastStatusSentAt = now;

    const state = selectPrimaryState();
    if (!state) {
      postStatus({
        injected: true,
        detected: false,
        enabled: Boolean(config && config.enabled),
        targetSeconds: config ? config.targetSeconds : null,
        lastReason: "extension injected; waiting for video element",
        timestamp: Date.now(),
      });
      return;
    }

    const edge = estimateLiveEdge(state);
    const actualLatency = Number.isFinite(edge) ? edge - state.video.currentTime : null;
    postStatus({
      injected: true,
      detected: true,
      version: VERSION,
      enabled: Boolean(config && config.enabled),
      targetSeconds: config ? config.targetSeconds : null,
      effectiveTargetSeconds: round1(getControlTarget(state)),
      targetConstrained: Number.isFinite(state.effectiveTargetSeconds),
      targetConstraintReason: state.targetConstraintReason,
      actualLatency: round1(actualLatency),
      forwardBuffer: round1(getForwardBuffer(state.video)),
      bufferedSpan: round1(getBufferedSpan(state.video)),
      hlsDetected: Boolean(getActiveHls(state)),
      holding: state.holding,
      preventedJumps: state.preventedJumps,
      forcedCorrections: state.forcedCorrections,
      recoveryCount: state.recoveryCount,
      playlistAge: round1(getPlaylistAge(state)),
      lastReason: state.lastReason,
      lastJump: state.lastJump,
      timestamp: Date.now(),
    });
  }

  function postStatus(status) {
    window.postMessage({ source: PAGE_SOURCE, type: "status", status }, "*");
  }

  function round1(value) {
    return Number.isFinite(Number(value)) ? Math.round(Number(value) * 10) / 10 : null;
  }

  function formatOne(value) {
    return Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "?";
  }

  function describeRanges(ranges) {
    if (!ranges || ranges.length === 0) return "none";
    const parts = [];
    for (let index = 0; index < ranges.length; index += 1) {
      try {
        parts.push(`[${formatOne(ranges.start(index))}-${formatOne(ranges.end(index))}]`);
      } catch (_error) {
        parts.push("[?]");
      }
    }
    return parts.join(" ");
  }

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    queueMicrotask(discover);
  }

  function startDiscovery() {
    if (!document.documentElement || observer) return;
    observer = new MutationObserver(queueScan);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    discoveryTimer = window.setInterval(discover, DISCOVERY_INTERVAL_MS);
    statusTimer = window.setInterval(() => publishPrimaryStatus(), STATUS_INTERVAL_MS);
    discover();
    publishPrimaryStatus(true);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== BRIDGE_SOURCE) return;
    if (event.data.type === "request-status") {
      publishPrimaryStatus(true);
      return;
    }
    if (event.data.type !== "config") return;

    config = normalizeConfig(event.data.config);
    for (const state of [...videos].map((video) => videoState.get(video)).filter(Boolean)) {
      applyVideoConfig(state);
    }
    for (const hls of hlsInstances) {
      if (config.enabled) enforceHlsConfig(hls);
      else restoreHlsConfig(hls);
    }
    queueScan();
    publishPrimaryStatus(true);
  });

  if (document.documentElement) {
    startDiscovery();
  } else {
    new MutationObserver((_, bootstrapObserver) => {
      if (!document.documentElement) return;
      bootstrapObserver.disconnect();
      startDiscovery();
    }).observe(document, { childList: true });
  }

  window.addEventListener("pagehide", () => {
    if (observer) observer.disconnect();
    if (discoveryTimer !== null) window.clearInterval(discoveryTimer);
    if (statusTimer !== null) window.clearInterval(statusTimer);
    for (const video of videos) destroyVideo(video);
  });

  window.__angelThumpLatencyLockPageController = {
    version: VERSION,
    requestStatus: () => publishPrimaryStatus(true),
  };

  window.postMessage({ source: PAGE_SOURCE, type: "request-config" }, "*");

  window.setTimeout(() => {
    if (config) return;
    config = { ...DEFAULT_CONFIG };
    for (const state of [...videos].map((video) => videoState.get(video)).filter(Boolean)) {
      applyVideoConfig(state);
    }
    queueScan();
    publishPrimaryStatus(true);
  }, 1000);
})();

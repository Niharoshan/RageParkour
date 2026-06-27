// =====================================================
//  ANALYTICS MODULE
//  Provider-agnostic event tracker. Buffers events and
//  flushes them to whichever provider is configured —
//  CrazyGames SDK (if present), Google Analytics / GA4
//  (if window.gtag exists), and/or a custom HTTP endpoint.
//
//  Nothing else in the game needs to know HOW events are
//  delivered — call Analytics.track(name, props) anywhere
//  and this module routes it. To add a new provider later,
//  edit ANALYTICS_CONFIG.endpoint / add a branch in _send().
//  No other file needs to change.
// =====================================================
const ANALYTICS_CONFIG = {
  // Set to a URL to also POST events to your own backend (optional).
  endpoint: null,
  // Batch size / flush interval for the optional HTTP endpoint.
  batchSize: 20,
  flushIntervalMs: 15000,
  // Master switch — flip to false to disable all tracking instantly
  // (e.g. for a GDPR "do not track" preference).
  enabled: true,
  debug: false // set true during development to console.log every event
};

const Analytics = (() => {
  let _queue = [];
  let _sessionId = null;
  let _sessionStart = 0;
  let _lastLevelStartTs = 0;
  let _currentLevel = null;
  let _flushTimer = null;

  function _uid() {
    return 'sid_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }

  function init() {
    _sessionId = _uid();
    _sessionStart = Date.now();
    track('session_start', {});
    if (ANALYTICS_CONFIG.endpoint) {
      _flushTimer = setInterval(_flush, ANALYTICS_CONFIG.flushIntervalMs);
    }
    // Drop-off tracking: fires whenever the tab is hidden/closed,
    // capturing exactly where the player was when they left.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        track('drop_off', { level: _currentLevel, sessionMs: Date.now() - _sessionStart });
        _flush(true);
      }
    });
    window.addEventListener('beforeunload', () => {
      track('session_end', { sessionMs: Date.now() - _sessionStart });
      _flush(true);
    });
  }

  function track(name, props) {
    if (!ANALYTICS_CONFIG.enabled) return;
    const event = {
      name,
      props: props || {},
      ts: Date.now(),
      sessionId: _sessionId
    };
    if (ANALYTICS_CONFIG.debug) console.log('[Analytics]', name, props);

    // Route to CrazyGames SDK analytics-adjacent calls where applicable.
    // (CrazyGames itself does not expose a generic custom-event API, but
    //  game.gameplayStart/Stop and happyTime are already wired via CG —
    //  this module is for everything else: GA4, custom backend, etc.)
    if (window.gtag) {
      try { window.gtag('event', name, props || {}); } catch (e) {}
    }
    if (ANALYTICS_CONFIG.endpoint) {
      _queue.push(event);
      if (_queue.length >= ANALYTICS_CONFIG.batchSize) _flush();
    }
  }

  function _flush(sync) {
    if (!ANALYTICS_CONFIG.endpoint || _queue.length === 0) return;
    const batch = _queue.splice(0, _queue.length);
    const payload = JSON.stringify({ events: batch });
    try {
      if (sync && navigator.sendBeacon) {
        navigator.sendBeacon(ANALYTICS_CONFIG.endpoint, payload);
      } else {
        fetch(ANALYTICS_CONFIG.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        }).catch(() => {});
      }
    } catch (e) {}
  }

  // ---- Convenience wrappers for every metric requested in the spec ----
  function gameStart() { track('game_start', {}); }
  function levelStart(idx, name) {
    _currentLevel = idx;
    _lastLevelStartTs = Date.now();
    track('level_start', { level: idx, name });
  }
  function levelComplete(idx, timeMs, deaths) {
    track('level_complete', { level: idx, timeMs, deaths });
  }
  function levelAbandon(idx) {
    if (_lastLevelStartTs) {
      track('level_abandon', { level: idx, timeSpentMs: Date.now() - _lastLevelStartTs });
    }
  }
  function death(idx, totalDeaths) { track('death', { level: idx, totalDeaths }); }
  function retry(idx) { track('retry', { level: idx }); }
  function adView(type) { track('ad_view', { type }); } // type: 'midgame' | 'rewarded' | 'banner'
  function adRewardedAccepted(accepted) { track('ad_rewarded_result', { accepted }); }
  function coinsEarned(amount, source) { track('coins_earned', { amount, source }); }
  function coinsSpent(amount, on) { track('coins_spent', { amount, on }); }
  function skinUsage(skinId, skinName) { track('skin_equip', { skinId, skinName }); }
  function secretFound(idx) { track('secret_found', { level: idx }); }
  function achievementComplete(id) { track('achievement_complete', { id }); }
  function tutorialComplete() { track('tutorial_complete', {}); }

  return {
    init, track,
    gameStart, levelStart, levelComplete, levelAbandon, death, retry,
    adView, adRewardedAccepted, coinsEarned, coinsSpent, skinUsage,
    secretFound, achievementComplete, tutorialComplete,
    getSessionId: () => _sessionId
  };
})();
// Top-level `const` does not create a `window.Analytics` property, but other
// modules guard optional calls with `if(window.Analytics)` — expose it explicitly
// so Analytics can still be removed cleanly by deleting this file.
window.Analytics = Analytics;

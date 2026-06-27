// =====================================================
//  CRAZYGAMES SDK v3 — WRAPPER
//  Handles: init, environment detection, ads, user,
//           data module, leaderboards, game events.
//  All game code calls methods on window.CG — the
//  wrapper gracefully no-ops when SDK is unavailable.
// =====================================================
const CG = (() => {
  let _sdk = null;
  let _ready = false;
  let _env = 'localhost'; // 'crazygames' | 'preview' | 'localhost' | 'disabled'
  let _user = null;
  let _adActive = false;
  let _muted = false;
  let _onAdEnd = null;
  let _cgData = null;
  let _rewardedResolve = null;
  // Death counter for midgame ad pacing
  let _deathsSinceAd = 0;
  const DEATHS_BETWEEN_ADS = 10;

  // DOM refs
  const adOverlay = document.getElementById('ad-overlay');
  const cgUser = document.getElementById('cg-user');
  const cgAvatar = document.getElementById('cg-avatar');
  const cgUsername = document.getElementById('cg-username');
  const bannerWrap = document.getElementById('cg-banner');
  const bannerInner = document.getElementById('cg-banner-inner');
  const loadingScreen = document.getElementById('cg-loading');
  const loadingBar = document.getElementById('cg-loading-bar');

  function _showAdOverlay() {
    adOverlay.classList.add('visible');
    _adActive = true;
  }
  function _hideAdOverlay() {
    adOverlay.classList.remove('visible');
    _adActive = false;
    if (_onAdEnd) { const cb = _onAdEnd; _onAdEnd = null; cb(); }
  }
  function _isOnCrazyGames() {
    return _env === 'crazygames' || _env === 'preview';
  }

  // ── Init ────────────────────────────────────────────
  async function init() {
    // Detect environment from URL
    const host = window.location.hostname;
    if (host.includes('crazygames.com')) _env = 'crazygames';
    else if (host.includes('1uqnm6.crazygames.com') || host.includes('preview')) _env = 'preview';
    else if (host === 'localhost' || host === '127.0.0.1') _env = 'localhost';
    else _env = 'disabled';

    try {
      if (window.CrazyGames && window.CrazyGames.SDK) {
        _sdk = window.CrazyGames.SDK;
        await _sdk.init();
        _ready = true;
        // Set up user listener
        _sdk.user.addAuthListener(_handleUserChange);
        // Try initial user
        try { const u = await _sdk.user.getUser(); _handleUserChange(null, u); } catch(e){}
        // Set up data module if on CG
        if (_isOnCrazyGames()) {
          try {
            _cgData = _sdk.data;
          } catch(e) { _cgData = null; }
        }
        // Init banner ad
        _initBanner();
      }
    } catch(e) {
      console.warn('[CG SDK] init failed, running without SDK:', e.message);
      _ready = false;
    }
    return _ready;
  }

  function _handleUserChange(error, user) {
    if (error || !user) { cgUser.classList.remove('visible'); _user = null; return; }
    _user = user;
    cgUsername.textContent = user.username || 'Guest';
    if (user.profilePictureUrl) { cgAvatar.src = user.profilePictureUrl; cgAvatar.style.display=''; }
    else cgAvatar.style.display = 'none';
    cgUser.classList.add('visible');
  }

  function _initBanner() {
    if (!_sdk || !_isOnCrazyGames()) return;
    try {
      _sdk.banner.requestBanner({ id: 'cg-banner-inner', width: 728, height: 90 });
      bannerWrap.classList.add('visible');
    } catch(e) {}
  }

  // ── Loading Events ───────────────────────────────────
  function loadingStart() {
    if (_sdk && _ready) try { _sdk.game.loadingStart(); } catch(e) {}
  }
  function loadingStop() {
    if (_sdk && _ready) try { _sdk.game.loadingStop(); } catch(e) {}
    // Dismiss loading screen
    loadingBar.style.width = '100%';
    setTimeout(() => { loadingScreen.classList.add('hidden'); setTimeout(() => { loadingScreen.style.display='none'; }, 520); }, 300);
  }
  function setLoadingProgress(pct) {
    loadingBar.style.width = Math.min(100, pct) + '%';
  }

  // ── Gameplay Events ──────────────────────────────────
  function gameplayStart() {
    if (_sdk && _ready) try { _sdk.game.gameplayStart(); } catch(e) {}
  }
  function gameplayStop() {
    if (_sdk && _ready) try { _sdk.game.gameplayStop(); } catch(e) {}
  }
  function happyTime() {
    if (_sdk && _ready) try { _sdk.game.happyTime(1); } catch(e) {}
  }

  // ── Ads ─────────────────────────────────────────────
  // Returns a promise that resolves when the ad ends (or immediately if ads unavailable)
  function showMidgameAd(audioMgr) {
    return new Promise((resolve) => {
      if (!_sdk || !_ready || !_isOnCrazyGames()) { resolve(); return; }
      try {
        gameplayStop();
        if (audioMgr) audioMgr.muteForAd();
        _showAdOverlay();
        if (window.Analytics) Analytics.adView('midgame');
        _sdk.ad.requestAd('midgame', {
          adStarted: () => {},
          adFinished: () => {
            _hideAdOverlay();
            if (audioMgr) audioMgr.unmuteAfterAd();
            gameplayStart();
            resolve();
          },
          adError: (e) => {
            _hideAdOverlay();
            if (audioMgr) audioMgr.unmuteAfterAd();
            gameplayStart();
            resolve();
          }
        });
      } catch(e) { _hideAdOverlay(); resolve(); }
    });
  }

  function showRewardedAd(audioMgr) {
    return new Promise((resolve) => {
      if (!_sdk || !_ready || !_isOnCrazyGames()) { resolve({rewarded: false}); return; }
      try {
        gameplayStop();
        if (audioMgr) audioMgr.muteForAd();
        _showAdOverlay();
        if (window.Analytics) Analytics.adView('rewarded');
        _sdk.ad.requestAd('rewarded', {
          adStarted: () => {},
          adFinished: () => {
            _hideAdOverlay();
            if (audioMgr) audioMgr.unmuteAfterAd();
            gameplayStart();
            if (window.Analytics) Analytics.adRewardedAccepted(true);
            resolve({rewarded: true});
          },
          adError: (e) => {
            _hideAdOverlay();
            if (audioMgr) audioMgr.unmuteAfterAd();
            gameplayStart();
            if (window.Analytics) Analytics.adRewardedAccepted(false);
            resolve({rewarded: false});
          }
        });
      } catch(e) { _hideAdOverlay(); resolve({rewarded: false}); }
    });
  }

  // Called on every death — fires midgame ad every N deaths
  async function onDeath(audioMgr) {
    _deathsSinceAd++;
    if (_deathsSinceAd >= DEATHS_BETWEEN_ADS) {
      _deathsSinceAd = 0;
      await showMidgameAd(audioMgr);
    }
  }

  // ── Data Module (save) ───────────────────────────────
  async function cgSetItem(key, value) {
    if (_cgData) try { await _cgData.setItem(key, JSON.stringify(value)); } catch(e) {}
  }
  async function cgGetItem(key) {
    if (_cgData) try { const r = await _cgData.getItem(key); return r ? JSON.parse(r) : null; } catch(e) {}
    return null;
  }

  // ── Leaderboards ────────────────────────────────────
  async function submitScore(levelIdx, timeMs) {
    if (!_sdk || !_ready || !_isOnCrazyGames()) return;
    try {
      // Best time leaderboard (lower is better — send inverted so higher = better)
      await _sdk.leaderboard.submitScoreToLeaderboard(
        'best-times-level-' + (levelIdx + 1),
        Math.round(1e9 / Math.max(1, timeMs)) // invert: faster = higher score
      );
      // Also submit to global completion count
      await _sdk.leaderboard.submitScoreToLeaderboard('total-completions', 1);
    } catch(e) {}
  }

  // ── Purchases ────────────────────────────────────────
  async function purchaseRemoveAds() {
    if (!_sdk || !_ready) return false;
    try {
      const result = await _sdk.purchasing.purchase({ productId: 'remove-ads' });
      return !!result;
    } catch(e) { return false; }
  }
  async function hasPurchased(productId) {
    if (!_sdk || !_ready) return false;
    try { return await _sdk.purchasing.hasPurchased(productId); } catch(e) { return false; }
  }

  return {
    init, setLoadingProgress, loadingStart, loadingStop,
    gameplayStart, gameplayStop, happyTime,
    showMidgameAd, showRewardedAd, onDeath,
    cgSetItem, cgGetItem, submitScore,
    purchaseRemoveAds, hasPurchased,
    isReady: () => _ready,
    isAdActive: () => _adActive,
    getUser: () => _user,
    getEnv: () => _env,
    isOnCrazyGames: _isOnCrazyGames,
  };
})();

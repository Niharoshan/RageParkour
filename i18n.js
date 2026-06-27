// =====================================================
//  I18N MODULE
//  Loads UI strings from external /lang/*.json files so
//  new languages can be added post-launch by dropping in
//  a new JSON file — zero code changes.
//
//  Usage in any other module:  t('menu.play')
//  Falls back to English (embedded below) if a fetch fails
//  (e.g. itch.io zip served from file://, or a missing key
//  in a partial translation), so the game never shows a
//  raw key or blank string.
// =====================================================
const I18N_CONFIG = {
  defaultLang: 'en',
  // Supported language codes -> file under /lang/. Add a new line here
  // (and drop the matching JSON file in /lang/) to ship a new language.
  available: {
    en: 'lang/en.json',
    es: 'lang/es.json'
  }
};

const I18N = (() => {
  // Embedded English fallback — guarantees the UI always renders
  // something readable even if /lang/en.json fails to fetch.
  const FALLBACK_EN = {
    "menu.play": "PLAY",
    "menu.levels": "LEVELS",
    "menu.skins": "SKINS",
    "menu.achievements": "ACHIEVEMENTS",
    "menu.settings": "SETTINGS",
    "menu.challenge": "CHALLENGE MODE",
    "common.back": "BACK",
    "common.restart": "RESTART",
    "common.retry": "RETRY",
    "common.next_level": "NEXT LEVEL",
    "common.equip": "Equip",
    "common.buy": "Buy",
    "common.coins": "Coins",
    "common.watch_ad_skin": "Watch Ad \u2192 Unlock Random Skin",
    "common.not_enough_coins": "Not enough coins",
    "common.equipped": "Equipped",
    "win.title": "LEVEL COMPLETE",
    "lose.title": "YOU DIED",
    "toast.skin_equipped": "Skin equipped: {name}",
    "toast.skin_unlocked": "Unlocked: {name}",
    "toast.achievement": "Achievement: {name}",
    "toast.challenge_complete": "Challenge complete! +200",
    "daily.title": "DAILY REWARD",
    "daily.claim": "CLAIM"
  };

  let _lang = I18N_CONFIG.defaultLang;
  let _strings = Object.assign({}, FALLBACK_EN);
  let _ready = false;

  function _detectLang() {
    try {
      const saved = localStorage.getItem('ragepk_lang');
      if (saved && I18N_CONFIG.available[saved]) return saved;
      const nav = (navigator.language || 'en').slice(0, 2);
      if (I18N_CONFIG.available[nav]) return nav;
    } catch (e) {}
    return I18N_CONFIG.defaultLang;
  }

  async function init(forceLang) {
    _lang = forceLang || _detectLang();
    const path = I18N_CONFIG.available[_lang] || I18N_CONFIG.available[I18N_CONFIG.defaultLang];
    try {
      const res = await fetch(path, { cache: 'no-cache' });
      if (res.ok) {
        const json = await res.json();
        // Merge over the English fallback so any missing key in a
        // partial translation still renders in English instead of blank.
        _strings = Object.assign({}, FALLBACK_EN, json);
      }
    } catch (e) {
      // file:// fetch blocked, offline, or 404 — silently keep fallback.
    }
    _ready = true;
    return _strings;
  }

  function setLang(code) {
    try { localStorage.setItem('ragepk_lang', code); } catch (e) {}
    return init(code);
  }

  function t(key, vars) {
    let s = _strings[key];
    if (s == null) s = FALLBACK_EN[key];
    if (s == null) return key; // visible-but-safe fallback for missing keys
    if (vars) {
      Object.keys(vars).forEach(k => { s = s.replace('{' + k + '}', vars[k]); });
    }
    return s;
  }

  return { init, setLang, t, getLang: () => _lang, isReady: () => _ready,
           availableLangs: () => Object.keys(I18N_CONFIG.available) };
})();
window.I18N = I18N;

// Short global alias used throughout the UI code: t('menu.play')
function t(key, vars) { return I18N.t(key, vars); }

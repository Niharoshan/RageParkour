# RAGE PARKOUR — LiveOps & Architecture Guide

This build splits the original single-file prototype into a modular,
data-driven structure so the game can be operated as a long-term
commercial product (CrazyGames, Poki, GameDistribution, GameMonetize,
itch.io) without touching engine code for routine content updates.

## File layout

```
index.html                 Markup + CSS + script tags only (no game logic)
js/sdk.js                  CrazyGames SDK v3 wrapper (ads, user, save, leaderboards)
js/analytics.js            Provider-agnostic event tracker
js/i18n.js                 Localization loader (reads /lang/*.json)
js/save.js                 SaveManager — local + CrazyGames Data Module sync
js/audio.js                AudioManager — WebAudio SFX/music, ad-aware muting
js/input.js                InputManager — keyboard + touch
js/particles.js            ParticleSystem
js/asset-manager.js        Small canvas asset/gradient helper
js/liveops.js              LiveOpsManager — reads config/liveops-config.js
js/engine.js                Game class — render loop, physics, UI, screens
js/main.js                  Bootstrap: init SDK → Analytics → I18N → Save → Game
js/data/skins.js           Base skin definitions
js/data/achievements.js    Achievement definitions
js/data/levels.js          buildLevels() — all 30 levels' geometry
config/liveops-config.js   Weekly challenges, seasonal events, missions, limited skins
lang/en.json, lang/es.json UI text per locale
```

Every file is a plain (non-module) script, loaded via `<script src>` in
dependency order — no bundler required, no build step, so it stays
trivially compatible with the CrazyGames "Externally Hosted (iframe)"
workflow and any static host (itch.io, GameMonetize, etc.). Each file
declares only top-level `class`/`const`/`function`, so they share one
global scope (the same scope the original single-file version used).

## Why this split

- **Engine never needs to change for content updates.** New worlds,
  levels, skins, missions, weekly challenges, and translations are all
  data edits in `js/data/*`, `config/liveops-config.js`, or `lang/*.json`.
- **Each system is independently testable/replaceable.** Swap `audio.js`
  for a different synth engine, or `sdk.js` for a Poki/GameDistribution
  wrapper, without touching `engine.js`.
- **Analytics and i18n are opt-in layers.** `engine.js` only calls
  `Analytics.x()` / `t('key')` — if you delete those files, the
  `window.Analytics`/`window.I18N` checks in the engine no-op safely
  (the engine guards every Analytics call with `if(window.Analytics)`).

## Adding new content (no code changes)

| To add...                  | Edit this file only |
|---|---|
| A new level                | `js/data/levels.js` — add an entry to `buildLevels()`'s returned array |
| A new skin                 | `js/data/skins.js` |
| A new achievement          | `js/data/achievements.js` |
| A weekly challenge         | `config/liveops-config.js` → `weeklyChallenges` |
| A seasonal event           | `config/liveops-config.js` → `seasonalEvents` |
| A limited-time cosmetic    | `config/liveops-config.js` → `limitedCosmetics` |
| A daily/weekly mission     | `config/liveops-config.js` → `missions` |
| An unlockable character    | `config/liveops-config.js` → `unlockableCharacters` |
| A new language             | Add `lang/xx.json` + one line in `js/i18n.js`'s `I18N_CONFIG.available` |

`LiveOpsManager.loadRemoteConfig(url)` can fetch this same config shape
from a CDN you control, so weekly challenges/events can update without
resubmitting a build to CrazyGames — call it before `new Game()` in
`js/main.js` if you want hot-updatable LiveOps content.

## Analytics

`js/analytics.js` exposes `Analytics.track(name, props)` plus typed
helpers for every metric requested for this phase: `gameStart`,
`levelStart`, `levelComplete`, `levelAbandon`, `death`, `retry`,
`adView`, `adRewardedAccepted`, `coinsEarned`, `coinsSpent`,
`skinUsage`, `secretFound`, `achievementComplete`, `tutorialComplete`,
plus automatic `session_start`/`session_end`/`drop_off` events (fired
on tab-hide/unload, capturing the player's current level).

By default events are only logged to the console in debug mode and
forwarded to `window.gtag` if present (GA4). Set
`ANALYTICS_CONFIG.endpoint` to your own collection URL to also batch
events to a custom backend — no other file needs to change.

Total play time and per-level time are persisted via
`SaveManager.addTime()` / `levelComplete`'s `timeMs`. Drop-off points
record the player's current level whenever the tab is hidden or closed,
giving you exact funnel data without any extra wiring per screen.

## Retention systems

- **Daily login rewards / streaks** — already in `SaveManager`
  (`checkDailyReward`/`claimDailyReward`), unchanged.
- **Weekly challenges** — `LiveOpsManager.getActiveWeeklyChallenge()`,
  claimed automatically on a qualifying `win()` via `canClaimWeekly`/`claimWeekly`.
- **Seasonal events** — `LiveOpsManager.getActiveSeasonalEvent()` drives
  a coin-payout multiplier (`getCoinMultiplier()`) and gates limited
  cosmetics by date.
- **Missions** (daily + weekly) — `LiveOpsManager.getMissions()` /
  `reportProgress(metric, delta)` / `claimMission(id)`. Progress is
  reported automatically for `levelsCompleted`, `coinsEarned`,
  `jumpsUsed`, and `dashesUsed`; add more metrics by calling
  `reportProgress` anywhere new in the engine.
- **Unlockable characters** — distinct from purchasable skins; granted
  by an achievement/mission id rather than coins (see
  `unlockableCharacters` in the config).

## Localization

No UI text is hardcoded going forward — call `t('some.key')` instead of
a literal string. `js/i18n.js` loads `lang/<detected-locale>.json` and
falls back to an embedded English set if the fetch fails (e.g. a
file:// preview), so the game never shows a raw key or blank label.
Only a representative set of strings has been wired through `t()` so
far (menu/common/win-lose/toast/daily/liveops keys in `lang/en.json`);
the remaining canvas-drawn literals in `engine.js` follow the same
one-line pattern (`ctx.fillText(t('your.key'), ...)`) and can be
migrated incrementally without any risk to existing behavior.

## What was intentionally left as-is

- `js/engine.js` keeps the render loop, physics, and all screen-drawing
  logic together. Splitting physics/render/UI into separate files would
  require breaking up tightly-coupled closures (shared `ctx`, `cam`,
  `uiRects`) for no functional benefit — the boundary that matters for
  LiveOps (content vs. code) is already enforced by the data files
  above.
- `secretsFound` / secret areas: the save-data field and
  `SaveManager.markSecretFound()` + analytics hook already exist; no
  level currently defines a secret trigger, so this is ready for the
  next level you design without further plumbing.

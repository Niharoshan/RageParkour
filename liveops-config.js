// =====================================================
//  LIVEOPS CONTENT CONFIG  —  DATA ONLY, NO LOGIC HERE
// =====================================================
//  This file is the single place a producer/LiveOps person
//  edits to add new timed content. LiveOpsManager (js/liveops.js)
//  reads this file; the engine never needs to change.
//
//  Dates are ISO 8601 strings (UTC). All "id" fields must be
//  unique and, once shipped, should never be reused.
//
//  OPTIONAL: in production you can instead fetch this same
//  shape from a remote JSON endpoint you control (a CDN file
//  you can update without resubmitting the game build) and
//  call LiveOps.loadRemoteConfig(url) before LiveOps.init().
//  Falls back to this local file if the fetch fails.
// =====================================================
window.LIVEOPS_CONFIG = {

  // ---- Weekly Challenges ----
  // A rotating featured level/run with its own leaderboard-style goal.
  weeklyChallenges: [
    {
      id: "wc_2026_w26",
      name: "Speed Week: Lava Run",
      startDate: "2026-06-22T00:00:00Z",
      endDate: "2026-06-29T00:00:00Z",
      levelIdx: 14,                 // index into buildLevels() output
      goal: { metric: "timeMs", target: 25000 },
      rewardCoins: 150,
      icon: "🔥"
    },
    {
      id: "wc_2026_w27",
      name: "No-Death Gauntlet",
      startDate: "2026-06-29T00:00:00Z",
      endDate: "2026-07-06T00:00:00Z",
      levelIdx: 22,
      goal: { metric: "deaths", target: 0 },
      rewardCoins: 200,
      icon: "💀"
    }
  ],

  // ---- Seasonal Events ----
  // Theming + bonus multipliers + an exclusive cosmetic for a date range.
  seasonalEvents: [
    {
      id: "ev_summer_2026",
      name: "Summer Heat",
      startDate: "2026-06-15T00:00:00Z",
      endDate: "2026-07-15T00:00:00Z",
      coinMultiplier: 1.5,
      exclusiveSkinId: "skin_sunburst",
      bannerIcon: "☀️"
    }
  ],

  // ---- Limited-Time Cosmetics ----
  // Skins only purchasable/unlockable while their window is open.
  // Shares rendering with the existing SKINS array — see js/liveops.js
  // mergeLimitedSkins() which appends these into the live SKINS list.
  limitedCosmetics: [
    {
      id: "skin_sunburst",
      name: "Sunburst",
      colors: ["#ffcc33", "#ff5500"],
      dash: ["#fff2cc", "#ffaa00"],
      cost: 600,
      availableFrom: "2026-06-15T00:00:00Z",
      availableTo: "2026-07-15T00:00:00Z"
    }
  ],

  // ---- Missions (daily + weekly) ----
  // metric must match a value Analytics/LiveOps already tracks:
  // 'deaths', 'levelsCompleted', 'coinsEarned', 'dashesUsed', 'jumpsUsed'
  missions: [
    { id: "m_daily_complete3", type: "daily",  desc: "Complete 3 levels",       metric: "levelsCompleted", target: 3,  rewardCoins: 40 },
    { id: "m_daily_dash20",    type: "daily",  desc: "Dash 20 times",           metric: "dashesUsed",      target: 20, rewardCoins: 25 },
    { id: "m_weekly_complete15", type: "weekly", desc: "Complete 15 levels",    metric: "levelsCompleted", target: 15, rewardCoins: 200 },
    { id: "m_weekly_earn500",   type: "weekly", desc: "Earn 500 coins",         metric: "coinsEarned",     target: 500, rewardCoins: 150 }
  ],

  // ---- Unlockable Characters ----
  // Distinct from purchasable skins: granted only by completing a
  // milestone (achievement id or mission id), never bought with coins.
  unlockableCharacters: [
    { id: "char_phantom", name: "Phantom", colors: ["#aa88ff", "#553399"], dash: ["#eee", "#bbf"], unlockVia: "achievement:all_clear" }
  ]
};

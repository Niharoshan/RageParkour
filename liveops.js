// =====================================================
//  LIVEOPS MANAGER
//  Turns the static data in config/liveops-config.js into
//  live state: which weekly challenge/seasonal event is
//  active right now, mission progress, streak rewards, and
//  which limited cosmetics should currently be purchasable.
//
//  Engine code (engine.js) only ever calls the small public
//  API below — it never reads LIVEOPS_CONFIG directly. That
//  means new weekly challenges, events, or missions can be
//  shipped by editing the config file (or swapping in a
//  remote JSON via loadRemoteConfig) with zero engine changes.
// =====================================================
class LiveOpsManager {
  constructor(save) {
    this.save = save;
    this.config = window.LIVEOPS_CONFIG || { weeklyChallenges: [], seasonalEvents: [], limitedCosmetics: [], missions: [], unlockableCharacters: [] };
    this._ensureSaveShape();
    this._rolloverMissionsIfNeeded();
  }

  // Allows ops to point at a CDN-hosted JSON for hot updates without
  // resubmitting the game build. Falls back to the bundled config.
  static async loadRemoteConfig(url) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.ok) window.LIVEOPS_CONFIG = await res.json();
    } catch (e) {
      // keep bundled window.LIVEOPS_CONFIG as fallback
    }
  }

  _ensureSaveShape() {
    const d = this.save.data;
    if (!d.liveops) {
      d.liveops = {
        missionProgress: {},   // { missionId: currentValue }
        missionClaims: {},     // { missionId: timestamp }
        weeklyClaims: {},      // { challengeId: timestamp }
        seasonalClaims: {},    // { eventId: timestamp }
        dailyMissionDate: null,
        weeklyMissionWeek: null
      };
      this.save.save();
    }
  }

  _isoWeek(d) {
    const date = new Date(d);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7));
    const week1 = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    return date.getUTCFullYear() + '-W' + (1 + Math.round(((date - week1) / 86400000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7));
  }

  // Daily missions reset every calendar day; weekly missions reset every ISO week.
  _rolloverMissionsIfNeeded() {
    const lo = this.save.data.liveops;
    const today = new Date().toISOString().slice(0, 10);
    const week = this._isoWeek(Date.now());
    if (lo.dailyMissionDate !== today) {
      (this.config.missions || []).filter(m => m.type === 'daily').forEach(m => { lo.missionProgress[m.id] = 0; delete lo.missionClaims[m.id]; });
      lo.dailyMissionDate = today;
      this.save.save();
    }
    if (lo.weeklyMissionWeek !== week) {
      (this.config.missions || []).filter(m => m.type === 'weekly').forEach(m => { lo.missionProgress[m.id] = 0; delete lo.missionClaims[m.id]; });
      lo.weeklyMissionWeek = week;
      this.save.save();
    }
  }

  // ---- Active timed content ----
  getActiveWeeklyChallenge() {
    const now = Date.now();
    return (this.config.weeklyChallenges || []).find(c => now >= Date.parse(c.startDate) && now < Date.parse(c.endDate)) || null;
  }
  getActiveSeasonalEvent() {
    const now = Date.now();
    return (this.config.seasonalEvents || []).find(e => now >= Date.parse(e.startDate) && now < Date.parse(e.endDate)) || null;
  }
  getCoinMultiplier() {
    const ev = this.getActiveSeasonalEvent();
    return ev ? (ev.coinMultiplier || 1) : 1;
  }
  // Merges any currently-available limited cosmetics into a skins list
  // (call once at startup: SKINS = SKINS.concat(LiveOps.getAvailableLimitedSkins())).
  getAvailableLimitedSkins() {
    const now = Date.now();
    return (this.config.limitedCosmetics || []).filter(c => now >= Date.parse(c.availableFrom) && now < Date.parse(c.availableTo));
  }

  // ---- Missions ----
  getMissions() {
    return (this.config.missions || []).map(m => ({
      ...m,
      progress: this.save.data.liveops.missionProgress[m.id] || 0,
      claimed: !!this.save.data.liveops.missionClaims[m.id]
    }));
  }
  // Call from engine whenever a tracked metric changes, e.g.
  // LiveOps.reportProgress('levelsCompleted', 1) on every win().
  reportProgress(metric, delta) {
    const lo = this.save.data.liveops;
    (this.config.missions || []).forEach(m => {
      if (m.metric !== metric) return;
      lo.missionProgress[m.id] = (lo.missionProgress[m.id] || 0) + delta;
    });
    this.save.save();
  }
  canClaimMission(id) {
    const m = (this.config.missions || []).find(x => x.id === id);
    if (!m) return false;
    const lo = this.save.data.liveops;
    return !lo.missionClaims[id] && (lo.missionProgress[id] || 0) >= m.target;
  }
  claimMission(id) {
    const m = (this.config.missions || []).find(x => x.id === id);
    if (!m || !this.canClaimMission(id)) return 0;
    this.save.data.liveops.missionClaims[id] = Date.now();
    this.save.addCoins(m.rewardCoins);
    this.save.save();
    return m.rewardCoins;
  }

  // ---- Weekly challenge claim ----
  canClaimWeekly(result) {
    const c = this.getActiveWeeklyChallenge();
    if (!c || this.save.data.liveops.weeklyClaims[c.id]) return false;
    if (c.goal.metric === 'timeMs') return result.timeMs <= c.goal.target;
    if (c.goal.metric === 'deaths') return result.deaths <= c.goal.target;
    return false;
  }
  claimWeekly() {
    const c = this.getActiveWeeklyChallenge();
    if (!c) return 0;
    this.save.data.liveops.weeklyClaims[c.id] = Date.now();
    this.save.addCoins(c.rewardCoins);
    this.save.save();
    return c.rewardCoins;
  }
}

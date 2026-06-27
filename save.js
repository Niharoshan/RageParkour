class SaveManager{
  constructor(){
    this.key="ragepk_save_v1";
    this.data=this.loadLocal();
    // Async: pull from CG data module when available
    this._cgSyncPending = false;
  }
  defaults(){
    return {
      progress:1,
      best:{},
      levelDeaths:{},
      lastSelected:null,
      stats:{deaths:0,jumps:0,dashes:0,playTime:0},
      settings:{music:true,sfx:true,vol:0.6},
      coins:0,
      achievements:{},
      // Retention features
      dailyReward:{lastClaim:0,streak:0},
      equippedSkin:0,
      unlockedSkins:[0],      // skin indices unlocked
      consecutiveDays:0,
      challengeMode:{active:false,seed:0,best:null},
      secretsFound:[],        // secret level indices visited
      noAds:false,
      // LiveOps state (missions/weekly-challenge/seasonal claims) — see js/liveops.js
      liveops:{missionProgress:{},missionClaims:{},weeklyClaims:{},seasonalClaims:{},dailyMissionDate:null,weeklyMissionWeek:null}
    };
  }
  _merge(base, incoming){
    if(!incoming) return base;
    const m = Object.assign({}, base, incoming);
    m.stats = Object.assign({}, base.stats, incoming.stats||{});
    m.settings = Object.assign({}, base.settings, incoming.settings||{});
    m.best = Object.assign({}, base.best, incoming.best||{});
    m.levelDeaths = Object.assign({}, base.levelDeaths, incoming.levelDeaths||{});
    m.achievements = Object.assign({}, base.achievements, incoming.achievements||{});
    m.challengeMode = Object.assign({}, base.challengeMode, incoming.challengeMode||{});
    m.liveops = Object.assign({}, base.liveops, incoming.liveops||{});
    return m;
  }
  loadLocal(){
    try{const r=localStorage.getItem(this.key);if(r){const d=JSON.parse(r);return this._merge(this.defaults(),d);}}catch(e){}
    return this.defaults();
  }
  async syncFromCG(){
    // Pull from CG Data Module and merge (CG wins on conflicts)
    try{
      const remote = await CG.cgGetItem(this.key);
      if(remote){
        this.data = this._merge(this.data, remote);
        this._saveLocal();
      }
    }catch(e){}
  }
  _saveLocal(){
    try{localStorage.setItem(this.key,JSON.stringify(this.data));}catch(e){}
  }
  save(){
    this._saveLocal();
    // Also push to CG data module (fire-and-forget)
    CG.cgSetItem(this.key, this.data);
  }
  unlock(n){if(n>this.data.progress){this.data.progress=n;this.save();}}
  setBest(level,t){const b=this.data.best[level];if(b==null||t<b){this.data.best[level]=t;this.save();return true;}return false;}
  addDeath(level){this.data.stats.deaths++;this.data.levelDeaths[level]=(this.data.levelDeaths[level]||0)+1;this.save();if(window.Analytics)Analytics.death(level,this.data.stats.deaths);}
  addJump(){this.data.stats.jumps++;}
  addDash(){this.data.stats.dashes++;}
  addTime(ms){this.data.stats.playTime+=ms;}
  reset(){this.data=this.defaults();this.save();}
  addCoins(n){this.data.coins=(this.data.coins||0)+n;this.save();if(window.Analytics){if(n>0)Analytics.coinsEarned(n,'gameplay');else if(n<0)Analytics.coinsSpent(-n,'purchase');}}
  unlockSkin(idx){if(!this.data.unlockedSkins.includes(idx)){this.data.unlockedSkins.push(idx);this.save();return true;}return false;}
  grantAchievement(id){if(!this.data.achievements[id]){this.data.achievements[id]=Date.now();this.save();if(window.Analytics)Analytics.achievementComplete(id);return true;}return false;}
  // Stub for future secret-area content: call this from a level's secret
  // trigger and the analytics + achievement wiring is already in place.
  markSecretFound(idx){if(!this.data.secretsFound.includes(idx)){this.data.secretsFound.push(idx);this.save();if(window.Analytics)Analytics.secretFound(idx);return true;}return false;}
  checkDailyReward(){
    const now=Date.now(),last=this.data.dailyReward.lastClaim||0;
    const dayMs=86400000,elapsed=now-last;
    if(elapsed<dayMs)return{canClaim:false,msLeft:dayMs-elapsed};
    const broke=elapsed>dayMs*2;
    const streak=broke?1:(this.data.dailyReward.streak||0)+1;
    const coins=50+Math.min(streak-1,6)*25;
    return{canClaim:true,coins,newStreak:streak};
  }
  claimDailyReward(){
    const r=this.checkDailyReward();
    if(!r.canClaim)return r;
    this.data.dailyReward.lastClaim=Date.now();
    this.data.dailyReward.streak=r.newStreak;
    this.addCoins(r.coins);
    return r;
  }
}


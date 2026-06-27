const STATE={MENU:0,LEVELSELECT:1,SETTINGS:2,STATS:3,PLAY:4,PAUSE:5,WIN:6,LOSE:7,CREDITS:8,
  DAILY:9,ACHIEVEMENTS:10,SKINS:11,CHALLENGE:12};
class Game{
  constructor(prebuiltSave){
    this.cv=document.getElementById('cv');
    this.ctx=this.cv.getContext('2d');
    this.W=960;this.H=540;
    this.save=prebuiltSave||new SaveManager();
    this.audio=new AudioManager(this.save);
    this.input=new InputManager();
    this.levels=buildLevels();
    this.assets=new AssetManager();
    this.particles=new ParticleSystem(300);
    // LiveOps: data-driven weekly challenges / seasonal events / missions.
    // Editing config/liveops-config.js adds new content; this engine code never changes.
    this.liveops=new LiveOpsManager(this.save);
    (this.liveops.getAvailableLimitedSkins()||[]).forEach(c=>{
      if(!SKINS.find(s=>s.id===c.id)) SKINS.push(Object.assign({},c,{id:SKINS.length,limited:true}));
    });
    if(window.Analytics) Analytics.gameStart();
    this.state=STATE.MENU;
    this.cam={x:0,y:0,shake:0};
    this.uiRects=[];
    this.dpr=1;
    this.last=0;
    this.transition=0;
    this.menuT=0;
    this.player=this.newPlayer();
    this.cur=null;this.curIdx=0;
    this.levelStart=0;this.levelTime=0;
    this.trailTimer=0;
    this.dashTrail=[];
    this._adPending=false;
    // Retention / Monetization state
    this._notification=null; // {msg,icon,t} for toast popups
    this._coinFloats=[];     // [{x,y,val,t}] floating coin text
    this._dailyChecked=false;
    this._prevDeaths=this.save.data.stats.deaths;
    this._sessionCoins=0;
    this._challengeTimer=0;
    this._challengeLevelIdx=0;
    this._challengeDeaths=0;
    this.bindPointer();
    this.resize();
    window.addEventListener('resize',()=>this.resize());
    window.addEventListener('orientationchange',()=>setTimeout(()=>this.resize(),200));
    window.addEventListener('focus',()=>{ if(this.audio.ctx&&this.audio.ctx.state==='suspended')this.audio.resume(); });
    window.addEventListener('contextmenu',e=>{ if(this.state===STATE.PLAY)e.preventDefault(); });
    window.addEventListener('wheel',e=>e.preventDefault(),{passive:false});
    this.input.anyKeyCb=()=>{this.audio.init();this.audio.resume();if(this.state===STATE.MENU)this.audio.startMusic();};
    this.bindTouchButtons();
    this.initLevelSelectUI();
    // Check daily reward on load (after a short delay so menu renders first)
    setTimeout(()=>this._checkDailyOnLoad(),600);
    requestAnimationFrame(t=>this.loop(t));
  }

  // ---- Notification toast ----
  notify(msg,icon,dur){this._notification={msg,icon,t:dur||2.5};}
  // ---- Floating coin text ----
  spawnCoinFloat(x,y,val){this._coinFloats.push({x,y,val,t:1.2});}
  // ---- Award coins with feedback ----
  awardCoins(n,x,y){
    this.save.addCoins(n);
    this._sessionCoins+=n;
    if(x!=null)this.spawnCoinFloat(x,y,n);
    this._checkAchievements();
  }
  // ---- Achievement check (called after events) ----
  _checkAchievements(){
    const d=this.save.data;
    const cleared=Object.keys(d.best);
    const grant=(id)=>{
      const ach=ACHIEVEMENTS.find(a=>a.id===id);
      if(!ach)return;
      if(this.save.grantAchievement(id)){
        this.notify('🏅 Achievement: '+ach.name,'🏅',3);
        if(ach.coins>0)this.save.addCoins(ach.coins);
      }
    };
    if(d.stats.deaths>=100)grant('deaths_100');
    if(d.stats.deaths>=1000)grant('deaths_1000');
    if(d.coins>=1000)grant('coins_1000');
    if(d.dailyReward.streak>=7)grant('daily_7');
    if(d.dailyReward.streak>=30)grant('daily_30');
    const ch1=cleared.filter(i=>parseInt(i)<10).length;
    const ch2=cleared.filter(i=>parseInt(i)>=10&&parseInt(i)<20).length;
    const ch3=cleared.filter(i=>parseInt(i)>=20).length;
    if(ch1>=10)grant('chapter_1');
    if(ch2>=10)grant('chapter_2');
    if(ch3>=10)grant('chapter_3');
    if(cleared.length>=30)grant('all_clear');
    if((d.unlockedSkins||[]).length>=4)grant('skin_collector');
    if((d.secretsFound||[]).length>0)grant('secret_found');
    if(d.challengeMode&&d.challengeMode.best!=null)grant('challenge_win');
  }
  // ---- Daily reward popup ----
  _checkDailyOnLoad(){
    if(this._dailyChecked)return;
    this._dailyChecked=true;
    const r=this.save.checkDailyReward();
    if(r.canClaim&&this.state===STATE.MENU){
      this.state=STATE.DAILY;
    }
  }
  // ---- Skin color helper ----
  _skinColors(){
    const s=SKINS[this.save.data.equippedSkin||0];
    return s;
  }

  newPlayer(){
    return {x:0,y:0,w:22,h:30,vx:0,vy:0,onGround:false,facing:1,
      canDouble:true,coyote:0,jumpBuf:0,dashCD:0,dashing:0,dashDir:0,
      dead:false,deadT:0,deathX:0,deathY:0,win:false,
      ridePlat:null,squash:1,animT:0, rev:false, gravScale:1};
  }
  resize(){
    const w=window.innerWidth,h=window.innerHeight;
    this.dpr=Math.min(window.devicePixelRatio||1,2);
    this.cv.width=Math.floor(w*this.dpr);
    this.cv.height=Math.floor(h*this.dpr);
    this.cssW=w;this.cssH=h;
    this.scale=h/540;
    this.W=Math.ceil(w/this.scale);
    this.H=540;
    this.offX=0;this.offY=0;
    this.checkOrient();
  }
  checkOrient(){document.getElementById('rotate').style.display=(window.innerHeight>window.innerWidth)?'flex':'none';}
  isTouch(){return ('ontouchstart' in window)||navigator.maxTouchPoints>0;}
  bindTouchButtons(){
    const map=[['bLeft','l'],['bRight','r'],['bJump','j'],['bDash','d']];
    map.forEach(([id,name])=>{
      const el=document.getElementById(id);
      const dn=e=>{e.preventDefault();this.audio.init();this.audio.resume();this.input.setTouch(name,true);};
      const up=e=>{e.preventDefault();this.input.setTouch(name,false);};
      el.addEventListener('touchstart',dn,{passive:false});
      el.addEventListener('touchend',up,{passive:false});
      el.addEventListener('touchcancel',up,{passive:false});
      el.addEventListener('mousedown',dn);
      window.addEventListener('mouseup',up);
    });
    this.touchDiv=document.getElementById('touch');
  }
  bindPointer(){
    const toVirt=(cx,cy)=>({x:(cx-this.offX)/this.scale,y:(cy-this.offY)/this.scale});
    const handle=(cx,cy)=>{
      this.audio.init();this.audio.resume();
      const p=toVirt(cx,cy);
      for(let i=this.uiRects.length-1;i>=0;i--){
        const r=this.uiRects[i];
        if(p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h){this.audio.click();r.cb();return;}
      }
    };
    this.cv.addEventListener('mousedown',e=>{handle(e.clientX,e.clientY);});
    this.cv.addEventListener('touchstart',e=>{const t=e.changedTouches[0];handle(t.clientX,t.clientY);},{passive:false});
  }
  startLevel(idx){
    if(window.Analytics){
      // Retry = restarting the same level we were just on; abandon = leaving
      // a level mid-run for a different one (e.g. via level select).
      if(this.cur!=null && this.state===STATE.PLAY){
        if(this.curIdx===idx) Analytics.retry(idx);
        else Analytics.levelAbandon(this.curIdx);
      } else if(this.cur!=null && this.curIdx===idx && (this.state===STATE.LOSE||this.state===STATE.WIN)){
        Analytics.retry(idx);
      }
    }
    this.bestNew=false;
    this.curIdx=idx;
    // Deep-clone only mutable per-run state; static geometry is shared by reference (read-only during play)
    const src=this.levels[idx];
    this.cur={
      name:src.name, start:src.start, worldW:src.worldW, worldH:src.worldH, bg:src.bg,
      platforms:src.platforms.map(p=>Object.assign({},p)),
      moving:src.moving.map(m=>Object.assign({},m)),
      hazards:src.hazards,
      checkpoints:src.checkpoints.map(c=>Object.assign({},c)),
      fakeExits:src.fakeExits.map(f=>Object.assign({},f)),
      exit:src.exit, hints:src.hints,
      revZone:src.revZone, lowGZone:src.lowGZone, highGZone:src.highGZone, dashGate:src.dashGate,
      disPlats:[], delPlats:[], cpHit:null
    };
    const p=this.player=this.newPlayer();
    this.spawn={x:this.cur.start.x,y:this.cur.start.y};
    this.activeCheckpoint=null;
    p.x=this.spawn.x;p.y=this.spawn.y;
    this.cam.x=p.x-this.W/2;this.cam.y=p.y-this.H/2;
    this.particles.clear();this.dashTrail.length=0;
    this.levelTime=0;this.levelStart=performance.now();
    this.state=STATE.PLAY;
    this.cur.cpHit=this.cur.checkpoints.map(()=>false);
    this.audio.stopMusic();
    this.updateTouchUI();
    this.cur.disPlats = this.cur.platforms.filter(p=>p.disappear);
    this.cur.delPlats = this.cur.platforms.filter(p=>p.delayed);
    this.cur.platforms.forEach(pl=>{ if(pl.disappear)pl.disTimer=0; if(pl.delayed){pl.delayTimer=0;pl.active=false;} });
    // Reset fake triggers
    this.cur.fakeExits.forEach(fe=>fe.triggered=false);
    this.cur.checkpoints.forEach(c=>{ if(c.fake) c.triggered=false; });
    // CG: report gameplay started
    CG.gameplayStart();
    if(window.Analytics) Analytics.levelStart(idx, src.name);
    // Reset per-level ad flags
    this._reviveUsed=false;
    this._doubleCoinsUsed=false;
  }
  respawn(){
    const p=this.player;
    const s=this.activeCheckpoint||this.spawn;
    p.x=s.x;p.y=s.y;p.vx=0;p.vy=0;p.dead=false;p.deadT=0;p.dashing=0;p.dashCD=0;p.canDouble=true;p.win=false;p.ridePlat=null;p.rev=false;p.gravScale=1;
    this.dashTrail.length=0;
  }
  die(){
    const p=this.player;if(p.dead)return;
    p.dead=true;p.deadT=0;p.deathX=p.x;p.deathY=p.y;
    this.save.addDeath(this.curIdx);
    if(this.save.data.challengeMode&&this.save.data.challengeMode.active)this._challengeDeaths++;
    this._checkAchievements();
    this.particles.burst(p.x+p.w/2,p.y+p.h/2,28,'#ff4455');
    this.cam.shake=14;
    this.audio.death();
    this.updateTouchUI();
    if(!this._adPending){
      this._adPending=true;
      CG.onDeath(this.audio).then(()=>{this._adPending=false;});
    }
  }
  win(){
    const p=this.player;if(p.win)return;
    p.win=true;
    this.levelTime=performance.now()-this.levelStart;
    this.save.addTime(this.levelTime);
    const newBest=this.save.setBest(this.curIdx,this.levelTime);
    this.bestNew=newBest;
    this.save.unlock(this.curIdx+2);
    // Coin rewards: base + bonus for no deaths this level
    const levelDeaths=this.save.data.levelDeaths[this.curIdx]||0;
    const baseCoins=20+this.curIdx*2; // more coins for later levels
    const noDeathBonus=levelDeaths===0?50:0;
    const speedBonus=this.levelTime<30000?25:0;
    // LiveOps: seasonal events can temporarily boost coin payouts (data-driven, no code change needed per event)
    const mult=this.liveops?this.liveops.getCoinMultiplier():1;
    const total=Math.round((baseCoins+noDeathBonus+speedBonus)*mult);
    this.awardCoins(total,this.W/2,180);
    if(levelDeaths===0)this.save.grantAchievement('no_death_1');
    if(this.levelTime<30000)this.save.grantAchievement('speed_1');
    if(this.curIdx===0){this.save.grantAchievement('first_blood');if(window.Analytics)Analytics.tutorialComplete();}
    this._checkAchievements();
    if(window.Analytics) Analytics.levelComplete(this.curIdx, this.levelTime, levelDeaths);
    if(this.liveops){
      this.liveops.reportProgress('levelsCompleted',1);
      this.liveops.reportProgress('coinsEarned',total);
      if(this.liveops.canClaimWeekly({timeMs:this.levelTime,deaths:levelDeaths})){
        const bonus=this.liveops.claimWeekly();
        this.notify('🏆 Weekly challenge complete! +'+bonus+' 🪙','🏆',4);
      }
    }
    this.particles.burst(p.x+p.w/2,p.y+p.h/2,40,'#44ff88');
    this.audio.victory();
    this.state=STATE.WIN;
    this.updateTouchUI();
    CG.gameplayStop();
    CG.submitScore(this.curIdx, this.levelTime);
    if(newBest) CG.happyTime();
    // Challenge mode: auto-advance to next level
    if(this.save.data.challengeMode&&this.save.data.challengeMode.active){
      const hasNext=(this.curIdx+1)<this.levels.length;
      if(hasNext){
        setTimeout(()=>this.startLevel(this.curIdx+1),800);
        return;
      } else {
        // Final level: save best
        const prev=this.save.data.challengeMode.best;
        if(!prev||this._challengeTimer<prev.time||(this._challengeTimer===prev.time&&this._challengeDeaths<prev.deaths)){
          this.save.data.challengeMode.best={time:this._challengeTimer,deaths:this._challengeDeaths};
          this.save.save();
        }
        this.save.data.challengeMode.active=false;this.save.save();
        this.awardCoins(200,this.W/2,220);
        this.save.grantAchievement('challenge_win');
        this._checkAchievements();
        this.notify('⚔ Challenge complete! +200 🪙','🏆',4);
      }
    }
  }
  updateTouchUI(){this.touchDiv.style.display=(this.isTouch()&&this.state===STATE.PLAY)?'block':'none';}
  // ===================== LEVEL SELECT (HTML overlay) =====================
  initLevelSelectUI(){
    this.lsOverlay=document.getElementById('ls-overlay');
    this.lsScroll=document.getElementById('ls-scroll');
    this.lsGrid=document.getElementById('ls-grid');
    this.lsSubtitle=document.getElementById('ls-subtitle');
    this._lsBuilt=false;
    document.getElementById('ls-back').addEventListener('click',()=>this.closeLevelSelect());
    // single delegated click handler — instant level load
    this.lsGrid.addEventListener('click',e=>{
      if(this._lsSuppressClick){this._lsSuppressClick=false;return;}
      const card=e.target.closest('.ls-card');
      if(!card)return;
      const idx=parseInt(card.dataset.idx,10);
      if(card.classList.contains('unlocked')||card.classList.contains('cleared')) this.selectLevel(idx);
    });
    this.bindLevelScrollDrag();
  }
  // Mouse drag-to-scroll with inertia. Touch is left to native momentum
  // scrolling (overflow-y:scroll + -webkit-overflow-scrolling:touch) so the
  // two input modes never fight each other.
  bindLevelScrollDrag(){
    const el=this.lsScroll;
    let dragging=false,startY=0,startScroll=0,lastY=0,lastT=0,vel=0,raf=null;
    const maxScroll=()=>Math.max(0,el.scrollHeight-el.clientHeight);
    const stopMomentum=()=>{if(raf){cancelAnimationFrame(raf);raf=null;}};
    const momentum=()=>{
      vel*=0.92;
      if(Math.abs(vel)<0.04){raf=null;return;}
      let ns=el.scrollTop-vel;
      if(ns<0){ns=0;vel=0;} if(ns>maxScroll()){ns=maxScroll();vel=0;}
      el.scrollTop=ns;
      raf=requestAnimationFrame(momentum);
    };
    el.addEventListener('pointerdown',e=>{
      if(e.pointerType==='touch')return; // native handles touch
      dragging=true;this._lsDragMoved=false;stopMomentum();
      startY=lastY=e.clientY;startScroll=el.scrollTop;lastT=performance.now();vel=0;
      el.classList.add('dragging');
      if(el.setPointerCapture)el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove',e=>{
      if(!dragging)return;
      const dy=e.clientY-startY;
      if(Math.abs(dy)>4)this._lsDragMoved=true;
      const now=performance.now();const dt=Math.max(1,now-lastT);
      vel=((e.clientY-lastY)/dt)*16;
      lastY=e.clientY;lastT=now;
      let ns=startScroll-dy;
      ns=Math.max(0,Math.min(maxScroll(),ns));
      el.scrollTop=ns;
      e.preventDefault();
    });
    const end=()=>{
      if(!dragging)return;
      dragging=false;el.classList.remove('dragging');
      if(this._lsDragMoved){this._lsSuppressClick=true;momentum();}
    };
    el.addEventListener('pointerup',end);
    el.addEventListener('pointercancel',end);
    el.addEventListener('pointerleave',()=>{if(dragging)end();});
  }
  escapeHtml(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
  buildLevelGrid(){
    const TOTAL=this.levels.length+6; // 6 "coming soon" placeholders — avoids 100-card DOM bloat
    const progress=this.save.data.progress;
    const lastSel=this.save.data.lastSelected;
    const targetIdx=(lastSel!=null&&lastSel<this.levels.length)?lastSel:Math.max(0,progress-1);
    this._lsTargetIdx=targetIdx;
    let html='';
    for(let i=0;i<TOTAL;i++){
      const isReal=i<this.levels.length;
      const unlocked=isReal&&(i+1)<=progress;
      const cleared=isReal&&this.save.data.best[i]!=null;
      const isCurrent=isReal&&i===targetIdx;
      let cls='ls-card';
      if(!isReal)cls+=' locked soon';
      else if(cleared)cls+=' cleared';
      else if(unlocked)cls+=' unlocked';
      else cls+=' locked';
      if(isCurrent)cls+=' current';
      let name,badge='',icon='';
      if(isReal){
        name=this.levels[i].name;
        if(cleared)badge=this.fmtTime(this.save.data.best[i]);
        else if(unlocked)badge='Deaths '+(this.save.data.levelDeaths[i]||0);
        else icon='<div class="ls-lock-icon">🔒</div>';
      }else{
        name='Coming Soon';badge='SOON';
      }
      html+='<div class="'+cls+'" data-idx="'+i+'">'+
        '<div class="ls-num">'+(i+1)+'</div>'+
        icon+
        '<div class="ls-name">'+this.escapeHtml(name)+'</div>'+
        (badge?'<div class="ls-badge">'+this.escapeHtml(badge)+'</div>':'')+
        '</div>';
    }
    this.lsGrid.innerHTML=html;
    const clearedCount=Object.keys(this.save.data.best).length;
    this.lsSubtitle.textContent=clearedCount+' / '+this.levels.length+' LEVELS CLEARED';
    this._lsBuilt=true;
  }
  refreshLevelGrid(){
    // cheap in-place status refresh (no full rebuild) used right before opening
    this.buildLevelGrid();
  }
  scrollToLevelIdx(idx,smooth){
    const card=this.lsGrid.querySelector('.ls-card[data-idx="'+idx+'"]');
    if(!card)return;
    const target=Math.max(0,card.offsetTop-this.lsScroll.clientHeight/2+card.clientHeight/2);
    if(!smooth){
      const prev=this.lsScroll.style.scrollBehavior;
      this.lsScroll.style.scrollBehavior='auto';
      this.lsScroll.scrollTop=target;
      this.lsScroll.style.scrollBehavior=prev||'';
    }else{
      this.lsScroll.scrollTo({top:target,behavior:'smooth'});
    }
  }
  openLevelSelect(){
    this.state=STATE.LEVELSELECT;
    this.refreshLevelGrid();
    this.lsOverlay.classList.add('visible');
    this.updateTouchUI();
    // jump to last-selected level (or highest unlocked) the instant the screen opens
    requestAnimationFrame(()=>this.scrollToLevelIdx(this._lsTargetIdx,false));
  }
  closeLevelSelect(){
    this.lsOverlay.classList.remove('visible');
    this._lsSuppressClick=false;
    this.state=STATE.MENU;
  }
  selectLevel(idx){
    if(idx<0||idx>=this.levels.length)return;
    this.save.data.lastSelected=idx;
    this.save.save();
    this.lsOverlay.classList.remove('visible');
    this.startLevel(idx);
  }
  loop(t){
    let dt=(t-this.last)/1000;this.last=t;
    if(dt<=0||dt>0.05)dt=0.016; // clamp: skip huge gaps (tab hidden) and invalid first frame
    this.save.addTime(dt*1000);
    this.menuT+=dt;
    if(this.state===STATE.PLAY)this.updatePlay(dt);
    this.handleGlobalKeys();
    this.particles.update(dt);
    if(this.cam.shake>0)this.cam.shake*=0.88;
    // tick notifications
    if(this._notification){this._notification.t-=dt;if(this._notification.t<=0)this._notification=null;}
    // tick coin floats
    this._coinFloats=this._coinFloats.filter(f=>{f.t-=dt;f.y-=dt*28;return f.t>0;});
    // Challenge timer
    if(this.state===STATE.PLAY&&this.save.data.challengeMode&&this.save.data.challengeMode.active){
      this._challengeTimer+=dt;
    }
    this.render();
    requestAnimationFrame(tt=>this.loop(tt));
  }
  rectsOverlap(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
  updatePlay(dt){
    const p=this.player;const lvl=this.cur;
    for(const m of lvl.moving){
      m.t+=m.speed;const tt=(Math.sin(m.t*Math.PI*2-Math.PI/2)+1)/2;
      const px=m.x0+(m.x1-m.x0)*tt;const py=m.y0+(m.y1-m.y0)*tt;
      m.dx=px-(m.cx!=null?m.cx:px);m.dy=py-(m.cy!=null?m.cy:py);
      m.cx=px;m.cy=py;
      m.rect={x:px,y:py,w:m.w,h:m.h};
    }
    if(lvl.disPlats){
      for(const pl of lvl.disPlats){
        pl.disTimer += dt;
        if(pl.disTimer > 1.4) pl.disTimer = 0;
        pl.visible = pl.disTimer < 0.8;
      }
    }
    if(lvl.delPlats){
      for(const pl of lvl.delPlats){
        const dist = Math.hypot(p.x-pl.x, p.y-pl.y);
        if(dist < 100 && !pl.active){
          pl.delayTimer += dt;
          if(pl.delayTimer > 0.5){ pl.active=true; }
        }
        if(pl.active){ pl.visible = true; } else { pl.visible = false; }
      }
    }
    if(p.dead){ p.deadT+=dt; if(p.deadT>0.9){ this.state=STATE.LOSE; this.updateTouchUI(); } this.updateCamera(dt); return; }
    p.animT+=dt;
    p.rev = false;
    if(lvl.revZone && this.rectsOverlap({x:p.x,y:p.y,w:p.w,h:p.h}, lvl.revZone)) p.rev=true;
    p.gravScale=1;
    if(lvl.lowGZone && this.rectsOverlap({x:p.x,y:p.y,w:p.w,h:p.h}, lvl.lowGZone)) p.gravScale=0.3;
    if(lvl.highGZone && this.rectsOverlap({x:p.x,y:p.y,w:p.w,h:p.h}, lvl.highGZone)) p.gravScale=2.2;
    if(lvl.dashGate && this.rectsOverlap({x:p.x,y:p.y,w:p.w,h:p.h}, lvl.dashGate)){
      if(p.dashing<=0){ this.die(); return; }
    }
    let move=0;
    const rawL = this.input.left, rawR = this.input.right;
    if(p.rev){ if(rawL)move+=1; if(rawR)move-=1; } else { if(rawL)move-=1; if(rawR)move+=1; }
    if(move!==0)p.facing=move;
    const accel=0.9,maxSpeed=5.2,airAccel=0.55,fric=0.78,airFric=0.94;
    if(p.dashing<=0){
      p.vx+=move*(p.onGround?accel:airAccel);
      if(p.vx>maxSpeed)p.vx=maxSpeed;if(p.vx<-maxSpeed)p.vx=-maxSpeed;
      if(move===0)p.vx*=p.onGround?fric:airFric;
      if(Math.abs(p.vx)<0.05)p.vx=0;
    }
    if(this.input.consumeJump())p.jumpBuf=0.12;
    if(p.jumpBuf>0)p.jumpBuf-=dt;
    if(p.coyote>0)p.coyote-=dt;
    const wantJump=p.jumpBuf>0;
    if(wantJump){
      if(p.onGround||p.coyote>0){
        p.vy=-12.5;p.onGround=false;p.coyote=0;p.jumpBuf=0;p.canDouble=true;p.squash=0.7;
        this.save.addJump();this.audio.jump();this.particles.dust(p.x+p.w/2,p.y+p.h,p.facing);if(this.liveops)this.liveops.reportProgress('jumpsUsed',1);
      }else if(p.canDouble){
        p.vy=-11;p.canDouble=false;p.jumpBuf=0;p.squash=0.7;
        this.save.addJump();this.audio.djump();if(this.liveops)this.liveops.reportProgress('jumpsUsed',1);
        this.particles.burst(p.x+p.w/2,p.y+p.h,8,'rgba(150,200,255,0.8)');
      }
    }
    if(p.dashCD>0)p.dashCD-=dt;
    if(this.input.consumeDash()&&p.dashCD<=0&&p.dashing<=0){
      p.dashing=0.18;p.dashCD=0.6;p.dashDir=p.facing||1;
      p.vx=p.dashDir*11;p.vy*=0.2;
      this.save.addDash();this.audio.dash();this.cam.shake=6;if(this.liveops)this.liveops.reportProgress('dashesUsed',1);
    }
    if(p.dashing>0){
      p.dashing-=dt;
      p.vx=p.dashDir*11*(0.6+p.dashing/0.18*0.4);
      this.trailTimer+=dt;
      if(this.trailTimer>0.02){this.trailTimer=0;this.dashTrail.push({x:p.x,y:p.y,life:0.3,max:0.3});if(this.dashTrail.length>20)this.dashTrail.shift();}
      this.particles.spawn(p.x+p.w/2,p.y+p.h/2,(Math.random()-0.5)*2,(Math.random()-0.5)*2,0.3,3,'rgba(120,220,255,0.9)',0);
    }
    for(let i=this.dashTrail.length-1;i>=0;i--){this.dashTrail[i].life-=dt;if(this.dashTrail[i].life<=0)this.dashTrail.splice(i,1);}
    const grav = (p.dashing>0?0.25:0.62)*p.gravScale;
    p.vy+=grav;if(p.vy>16)p.vy=16;
    // ---- ENVIRONMENTAL PARTICLE CLUES ----
    // Low gravity: floating dust drifts upward near zone
    if(lvl.lowGZone && Math.random()<0.18){
      const z=lvl.lowGZone;
      const px2=z.x+Math.random()*z.w;
      const py2=z.y+Math.random()*z.h;
      this.particles.spawn(px2,py2,(Math.random()-0.5)*0.4,-0.3-Math.random()*0.6,2.5+Math.random()*2,2+Math.random()*2,'rgba(160,200,255,0.35)',-0.03);
    }
    // High gravity: heavy debris falls fast near zone
    if(lvl.highGZone && Math.random()<0.14){
      const z=lvl.highGZone;
      const px2=z.x+Math.random()*z.w;
      this.particles.spawn(px2,z.y,(Math.random()-0.5)*0.8,1.2+Math.random()*2,0.6+Math.random()*0.5,2+Math.random()*3,'rgba(180,120,80,0.55)',0.9);
    }
    // Invisible platforms: briefly reveal outline when player is close
    for(const s of lvl.platforms){
      if(!s.invisible)continue;
      const dist=Math.hypot(p.x+p.w/2-(s.x+s.w/2),p.y+p.h/2-(s.y+s.h/2));
      if(!s._revTimer)s._revTimer=0;
      s._revTimer-=dt;
      if(dist<140&&Math.random()<0.004){s._revTimer=0.55;}// brief flicker
    }
    p.squash+=(1-p.squash)*0.2;
    const wasGround=p.onGround;
    p.ridePlat=null;
    p.x+=p.vx;
    this.collideAxis('x');
    p.onGround=false;
    p.y+=p.vy;
    this.collideAxis('y');
    if(p.ridePlat){p.x+=p.ridePlat.dx||0;p.y+=p.ridePlat.dy||0;}
    if(p.onGround){ if(!wasGround){this.audio.land();this.particles.dust(p.x+p.w/2,p.y+p.h,0);p.squash=0.8;} p.coyote=0.1;p.canDouble=true; }
    else if(wasGround){p.coyote=0.1;}
    if(p.onGround&&Math.abs(p.vx)>3&&Math.random()<0.3)this.particles.dust(p.x+p.w/2,p.y+p.h,Math.sign(p.vx));
    const pb={x:p.x,y:p.y,w:p.w,h:p.h};
    for(const hz of lvl.hazards){ if(this.rectsOverlap(pb,hz)){this.die();return;}}
    if(p.y>lvl.worldH+200){this.die();return;}
    // Check real checkpoints only
    lvl.checkpoints.forEach((c,i)=>{
      if(!lvl.cpHit[i] && !c.fake){
        const cr={x:c.x-14,y:c.y-20,w:28,h:50};
        if(this.rectsOverlap(pb,cr)){lvl.cpHit[i]=true;this.activeCheckpoint={x:c.x,y:c.y};this.audio.checkpoint();this.particles.burst(c.x,c.y,16,'#ffdd55');}
      }
      // Fake checkpoint trigger - activates when touched but does nothing, then reveals
      if(c.fake && !c.triggered && this.rectsOverlap(pb,{x:c.x-14,y:c.y-20,w:28,h:50})){
        c.triggered=true;
        this.particles.burst(c.x,c.y,20,'#ff4444');
        this.audio.death();
        this.die(); // Fake checkpoint kills you (trap)
      }
    });
    // Check fake exits - look exactly like real exits, trigger trap when touched
    for(const fe of lvl.fakeExits){
      if(!fe.triggered && this.rectsOverlap(pb,fe)){
        fe.triggered=true;
        this.particles.burst(fe.x+fe.w/2,fe.y+fe.h/2,30,'#ff4444');
        this.audio.death();
        this.die(); // Fake exit kills you (trap)
        return;
      }
    }
    // Real exit
    if(this.rectsOverlap(pb,lvl.exit)){this.win();return;}
    this.updateCamera(dt);
    if(this.input.keys['Escape']){this.input.keys['Escape']=false;this.state=STATE.PAUSE;this.updateTouchUI();}
  }

  handleGlobalKeys(){
    if(this.input.keys['Escape']){
      this.input.keys['Escape']=false;
      const backStates=[STATE.DAILY,STATE.ACHIEVEMENTS,STATE.SKINS,STATE.CHALLENGE,STATE.SETTINGS,STATE.STATS,STATE.CREDITS,STATE.LEVELSELECT];
      if(backStates.includes(this.state)){this.state=STATE.MENU;if(this.save.data.settings.music)this.audio.startMusic();}
    }
  }
  collideAxis(axis){
    const p=this.player;const lvl=this.cur;
    const pb={x:p.x,y:p.y,w:p.w,h:p.h};
    const solids = lvl.platforms.filter(s=>{
      // Invisible platforms ARE solid — they have no visual hint but full collision
      if(s.disappear && !s.visible) return false;
      if(s.delayed && !s.active) return false;
      return true;
    });
    for(const s of solids){
      if(this.rectsOverlap(pb,s)){
        if(axis==='x'){
          if(p.vx>0)p.x=s.x-p.w; else if(p.vx<0)p.x=s.x+s.w;
          p.vx=0;pb.x=p.x;
        }else{
          if(p.vy>0){p.y=s.y-p.h;p.vy=0;p.onGround=true;}
          else if(p.vy<0){p.y=s.y+s.h;p.vy=0;}
          pb.y=p.y;
        }
      }
    }
    for(const m of lvl.moving){
      const s=m.rect;if(!s)continue;
      if(this.rectsOverlap(pb,s)){
        if(axis==='x'){
          if(p.vx>0)p.x=s.x-p.w; else if(p.vx<0)p.x=s.x+s.w; p.vx=0;pb.x=p.x;
        }else{
          if(p.vy>0){p.y=s.y-p.h;p.vy=0;p.onGround=true;p.ridePlat=m;}
          else if(p.vy<0){p.y=s.y+s.h;p.vy=0;}
          pb.y=p.y;
        }
      }
    }
  }
  updateCamera(dt){
    const p=this.player;const lvl=this.cur;
    let tx=p.x+p.w/2-this.W/2+p.vx*8;
    let ty=p.y+p.h/2-this.H/2;
    tx=Math.max(0,Math.min(tx,lvl.worldW-this.W));
    ty=Math.max(0,Math.min(ty,lvl.worldH-this.H));
    if(lvl.worldW<this.W)tx=(lvl.worldW-this.W)/2;
    if(lvl.worldH<this.H)ty=(lvl.worldH-this.H)/2;
    this.cam.x+=(tx-this.cam.x)*Math.min(1,dt*8);
    this.cam.y+=(ty-this.cam.y)*Math.min(1,dt*8);
  }
    // ---- RENDER ----
  render(){
    const ctx=this.ctx;
    ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
    ctx.clearRect(0,0,this.cssW,this.cssH);
    ctx.save();
    ctx.scale(this.scale,this.scale);
    ctx.beginPath();ctx.rect(0,0,this.W,this.H);ctx.clip();
    ctx.textBaseline='alphabetic';
    this.uiRects.length=0;
    switch(this.state){
      case STATE.MENU:this.drawMenu(ctx);break;
      case STATE.LEVELSELECT:this.drawLevelSelect(ctx);break;
      case STATE.SETTINGS:this.drawSettings(ctx);break;
      case STATE.STATS:this.drawStats(ctx);break;
      case STATE.PLAY:this.drawPlay(ctx);break;
      case STATE.PAUSE:this.drawPlay(ctx);this.drawPause(ctx);break;
      case STATE.WIN:this.drawPlay(ctx);this.drawWin(ctx);break;
      case STATE.LOSE:this.drawPlay(ctx);this.drawLose(ctx);break;
      case STATE.CREDITS:this.drawCredits(ctx);break;
      case STATE.DAILY:this.drawDailyReward(ctx);break;
      case STATE.ACHIEVEMENTS:this.drawAchievements(ctx);break;
      case STATE.SKINS:this.drawSkins(ctx);break;
      case STATE.CHALLENGE:this.drawChallenge(ctx);break;
    }
    // Global overlays (always on top)
    this._drawNotification(ctx);
    this._drawCoinFloats(ctx);
    this._drawCoinHUD(ctx);
    ctx.restore();
  }
  button(ctx,x,y,w,h,label,cb,opts){
    opts=opts||{};
    const hot=opts.color||'#3a4b8a';
    ctx.fillStyle=opts.bg||'rgba(255,255,255,0.06)';
    this.roundRect(ctx,x,y,w,h,10);ctx.fill();
    ctx.fillStyle=hot;ctx.globalAlpha=0.25;this.roundRect(ctx,x,y,w,h,10);ctx.fill();ctx.globalAlpha=1;
    ctx.strokeStyle=opts.border||'rgba(255,255,255,0.3)';ctx.lineWidth=2;this.roundRect(ctx,x,y,w,h,10);ctx.stroke();
    ctx.fillStyle=opts.text||'#fff';ctx.font=(opts.font||'bold 22px Trebuchet MS');ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(label,x+w/2,y+h/2);
    ctx.textBaseline='alphabetic';
    if(cb)this.uiRects.push({x,y,w,h,cb});
  }
  roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
  bgGrad(ctx,c1,c2){const g=ctx.createLinearGradient(0,0,0,this.H);g.addColorStop(0,c1);g.addColorStop(1,c2);ctx.fillStyle=g;ctx.fillRect(0,0,this.W,this.H);}
  drawMenu(ctx){
    this.bgGrad(ctx,'#1a1030','#0a0a18');
    ctx.textBaseline='alphabetic';
    ctx.fillStyle='rgba(255,255,255,0.06)';
    for(let i=0;i<30;i++){const x=(i*97+this.menuT*20)%this.W;const y=(i*53+Math.sin(this.menuT+i)*20)%this.H;ctx.fillRect(x,y,2,2);}
    ctx.textAlign='center';
    const ty=100+Math.sin(this.menuT*2)*5;
    ctx.font='bold 78px Trebuchet MS';
    ctx.fillStyle='#ff3355';ctx.fillText('RAGE',this.W/2-3,ty+3);
    ctx.fillStyle='#fff';ctx.fillText('RAGE',this.W/2,ty);
    ctx.font='bold 52px Trebuchet MS';
    ctx.fillStyle='#55ddff';ctx.fillText('PARKOUR',this.W/2,ty+62);
    ctx.font='16px Trebuchet MS';ctx.fillStyle='rgba(255,255,255,0.5)';
    ctx.fillText('30 levels · 3 chapters · mixed mechanics',this.W/2,ty+95);
    // Progress summary
    const cleared=Object.keys(this.save.data.best).length;
    const pct=Math.round(cleared/this.levels.length*100);
    ctx.font='14px Trebuchet MS';ctx.fillStyle='rgba(100,220,180,0.85)';
    ctx.fillText(cleared+' / '+this.levels.length+' cleared ('+pct+'%)',this.W/2,ty+116);
    // Daily streak indicator
    const streak=this.save.data.dailyReward.streak||0;
    if(streak>0){
      ctx.font='13px Trebuchet MS';ctx.fillStyle='#ffdd55';
      ctx.fillText('🔥 '+streak+'-day streak',this.W/2,ty+134);
    }
    // Left column buttons
    const bw=200,bh=48,col1x=this.W/2-210,col2x=this.W/2+10;let by=280;
    this.button(ctx,col1x,by,bw,bh,'▶ PLAY',()=>{this.openLevelSelect();},{color:'#3aa84b'});
    this.button(ctx,col2x,by,bw,bh,'📅 DAILY',()=>{this.state=STATE.DAILY;},{color:'#cc8800'});by+=58;
    this.button(ctx,col1x,by,bw,bh,'⚔ CHALLENGE',()=>{this.state=STATE.CHALLENGE;},{color:'#884400'});
    this.button(ctx,col2x,by,bw,bh,'🎨 SKINS',()=>{this.state=STATE.SKINS;},{color:'#446688'});by+=58;
    this.button(ctx,col1x,by,bw,bh,'🏅 ACHIEVEMENTS',()=>{this.state=STATE.ACHIEVEMENTS;},{color:'#664488'});
    this.button(ctx,col2x,by,bw,bh,'⚙ SETTINGS',()=>{this.state=STATE.SETTINGS;});by+=58;
    this.button(ctx,col1x,by,bw,bh,'📊 STATS',()=>{this.state=STATE.STATS;});
    this.button(ctx,col2x,by,bw,bh,'CREDITS',()=>{this.state=STATE.CREDITS;});
    ctx.font='13px Trebuchet MS';ctx.fillStyle='rgba(255,255,255,0.35)';ctx.textAlign='center';
    ctx.fillText('Keyboard: ←→/AD move • Space/W jump (x2) • Shift dash',this.W/2,this.H-22);
    const env=CG.getEnv();
    if(env!=='disabled'){
      ctx.textAlign='right';ctx.font='11px Trebuchet MS';
      ctx.fillStyle='rgba(80,200,255,0.5)';
      ctx.fillText('CrazyGames SDK v3 • '+env,this.W-12,this.H-8);
    }
  }
  drawLevelSelect(ctx){
    // The interactive, scrollable Level Select UI now lives in the
    // #ls-overlay HTML layer (see initLevelSelectUI/openLevelSelect).
    // This just paints a matching background behind it.
    this.bgGrad(ctx,'#101830','#08080f');
  }
  drawSettings(ctx){
    this.bgGrad(ctx,'#101830','#08080f');
    const s=this.save.data.settings;
    ctx.textBaseline='alphabetic';
    ctx.textAlign='center';ctx.fillStyle='#fff';ctx.font='bold 40px Trebuchet MS';
    ctx.fillText('SETTINGS',this.W/2,90);
    const bx=this.W/2-180,bw=360,bh=54;let by=160;
    // Music button - single click
    this.button(ctx,bx,by,bw,bh,'Music: '+(s.music?'ON':'OFF'),()=>{
      s.music=!s.music;
      this.save.save();
      if(s.music){ this.audio.startMusic(); } else { this.audio.stopMusic(); }
      this.audio.click();
    },{color:s.music?'#3aa84b':'#a83a3a'});
    by+=70;
    // Sound FX button - single click
    this.button(ctx,bx,by,bw,bh,'Sound FX: '+(s.sfx?'ON':'OFF'),()=>{
      s.sfx=!s.sfx;
      this.save.save();
      this.audio.click();
    },{color:s.sfx?'#3aa84b':'#a83a3a'});
    by+=70;
    ctx.fillStyle='#fff';ctx.font='20px Trebuchet MS';ctx.textAlign='center';
    ctx.fillText('Volume: '+Math.round(s.vol*100)+'%',this.W/2,by+10);by+=30;
    const vbw=360,vbx=this.W/2-vbw/2;
    ctx.fillStyle='rgba(255,255,255,0.15)';this.roundRect(ctx,vbx,by,vbw,18,9);ctx.fill();
    ctx.fillStyle='#55ddff';this.roundRect(ctx,vbx,by,vbw*s.vol,18,9);ctx.fill();
    by+=40;
    this.button(ctx,this.W/2-130,by,120,46,'– Vol',()=>{
      s.vol=Math.max(0,Math.round((s.vol-0.1)*10)/10);
      this.audio.setVol(s.vol);
      this.save.save();
      this.audio.click();
    });
    this.button(ctx,this.W/2+10,by,120,46,'+ Vol',()=>{
      s.vol=Math.min(1,Math.round((s.vol+0.1)*10)/10);
      this.audio.setVol(s.vol);
      this.save.save();
      this.audio.click();
    });
    by+=70;
    this.button(ctx,this.W/2-180,by,360,46,'RESET ALL DATA',()=>{
      this.save.reset();
      this.audio.click();
    },{color:'#a83a3a'});
    by+=56;
    if(CG.isOnCrazyGames()){
      this.button(ctx,this.W/2-180,by,360,46,'REMOVE ADS',async()=>{
        const ok=await CG.purchaseRemoveAds();
        if(ok)this.save.data.noAds=true,this.save.save();
      },{color:'#8844cc'});
    }
    this.button(ctx,this.W/2-90,this.H-66,180,46,'BACK',()=>{
      this.state=STATE.MENU;
      if(this.save.data.settings.music) this.audio.startMusic();
    });
  }
  drawStats(ctx){
    this.bgGrad(ctx,'#101830','#08080f');
    const st=this.save.data.stats;
    ctx.textBaseline='alphabetic';
    ctx.textAlign='center';ctx.fillStyle='#fff';ctx.font='bold 40px Trebuchet MS';
    ctx.fillText('STATISTICS',this.W/2,80);
    const rows=[
      ['Total Deaths',st.deaths],
      ['Total Jumps',st.jumps],
      ['Total Dashes',st.dashes],
      ['Play Time',this.fmtTime(st.playTime)],
      ['Levels Cleared',Object.keys(this.save.data.best).length+' / '+this.levels.length],
    ];
    ctx.font='24px Trebuchet MS';
    let y=150;const bx=this.W/2-220;
    rows.forEach((r,i)=>{
      ctx.fillStyle=i%2?'rgba(255,255,255,0.04)':'rgba(255,255,255,0.08)';
      this.roundRect(ctx,bx,y-26,440,44,8);ctx.fill();
      ctx.textAlign='left';ctx.fillStyle='#bcd';ctx.fillText(r[0],bx+18,y);
      ctx.textAlign='right';ctx.fillStyle='#fff';ctx.fillText(''+r[1],bx+422,y);
      y+=52;
    });
    this.button(ctx,this.W/2-90,this.H-66,180,46,'BACK',()=>{
      this.state=STATE.MENU;
      if(this.save.data.settings.music) this.audio.startMusic();
    });
  }
  drawPlay(ctx){
    const lvl=this.cur;const cam=this.cam;
    let sx=0,sy=0;
    if(this.cam.shake>0.3){sx=(Math.random()-0.5)*this.cam.shake;sy=(Math.random()-0.5)*this.cam.shake;}
    this.bgGrad(ctx,lvl.bg,'#05050a');
    ctx.save();ctx.translate(sx,sy);
    // Sky Ruins (levels 21-30): draw floating cloud wisps in the parallax background
    if(this.curIdx>=20){
      const t=this.menuT;
      ctx.save();
      ctx.globalAlpha=0.07+0.03*Math.sin(t*0.4);
      for(let i=0;i<6;i++){
        const cx=(((i*317+t*12*(1+i*0.15))-cam.x*0.12)%(this.W+300))-150;
        const cy=(i*89)%this.H;
        const cw=180+i*40; const ch=22+i*8;
        const g=ctx.createRadialGradient(cx+cw/2,cy+ch/2,0,cx+cw/2,cy+ch/2,cw/2);
        g.addColorStop(0,'rgba(140,200,255,1)');g.addColorStop(1,'rgba(140,200,255,0)');
        ctx.fillStyle=g;ctx.fillRect(cx,cy,cw,ch);
      }
      ctx.restore();
    }
    ctx.fillStyle='rgba(255,255,255,0.08)';
    for(let i=0;i<40;i++){const x=((i*131)-(cam.x*0.3))%this.W;const xx=x<0?x+this.W:x;const y=(i*71)%this.H;ctx.fillRect(xx,y,2,2);}
    const camx=cam.x,camy=cam.y;
    // Draw platforms - invisible platforms ghost-reveal when player is close
    for(const s of lvl.platforms){
      if(s.invisible){
        if(s._revTimer>0){
          // Faint outline only — no fill, just a ghost shimmer
          const alpha=Math.min(0.35,(s._revTimer/0.55)*0.35);
          ctx.save();ctx.globalAlpha=alpha;
          ctx.strokeStyle='rgba(180,220,255,0.9)';ctx.lineWidth=1.5;
          ctx.strokeRect(s.x-camx,s.y-camy,s.w,s.h);
          ctx.restore();
        }
        continue;
      }
      if(s.disappear && !s.visible) continue;
      if(s.delayed && !s.active) continue;
      this.drawPlatform(ctx,s.x-camx,s.y-camy,s.w,s.h);
    }
    // Draw moving platforms
    for(const m of lvl.moving){if(m.rect)this.drawMoving(ctx,m.rect.x-camx,m.rect.y-camy,m.rect.w,m.rect.h);}
    // Draw hazards
    for(const hz of lvl.hazards)this.drawHazard(ctx,hz.x-camx,hz.y-camy,hz.w,hz.h);
    // Draw checkpoints - fake ones look identical (no labels)
    lvl.checkpoints.forEach((c,i)=>{
      if(c.fake && c.triggered){
        // After trigger, show it was fake
        this.drawFakeCheckpointReveal(ctx,c.x-camx,c.y-camy);
      } else {
        this.drawCheckpoint(ctx,c.x-camx,c.y-camy,lvl.cpHit[i]);
      }
    });
    // Draw fake exits - look identical to real exits (no labels)
    for(const fe of lvl.fakeExits){
      if(fe.triggered){
        // After trigger, show it was fake
        this.drawFakeDoorReveal(ctx,fe.x-camx,fe.y-camy,fe.w,fe.h);
      } else {
        // Looks exactly like a real exit
        this.drawDoor(ctx,fe.x-camx,fe.y-camy,fe.w,fe.h,true);
      }
    }
    // Draw real exit
    this.drawDoor(ctx,lvl.exit.x-camx,lvl.exit.y-camy,lvl.exit.w,lvl.exit.h,true);
    // Particles
    this.particles.draw(ctx,{x:camx,y:camy});
    // ---- ENVIRONMENTAL ZONE VISUAL CLUES ----
    this.drawZoneClues(ctx,lvl,camx,camy);
    this.drawPlayer(ctx,camx,camy);
    ctx.restore();
    this.drawHUD(ctx);
  }
  drawZoneClues(ctx,lvl,camx,camy){
    const t=this.menuT;
    // ---- LOW GRAVITY: floating motes inside zone ----
    if(lvl.lowGZone){
      const z=lvl.lowGZone;const zx=z.x-camx,zy=z.y-camy;
      // very faint blue-white shimmer at zone edges
      ctx.save();
      ctx.globalAlpha=0.08+0.04*Math.sin(t*1.2);
      const g=ctx.createLinearGradient(zx,zy,zx,zy+z.h);
      g.addColorStop(0,'rgba(180,220,255,0.0)');
      g.addColorStop(0.4,'rgba(180,220,255,1)');
      g.addColorStop(1,'rgba(180,220,255,0.0)');
      ctx.fillStyle=g;ctx.fillRect(zx,zy,z.w,z.h);
      // Floating specks — drawn every frame from fixed seeds so they drift
      ctx.globalAlpha=0.5;
      for(let i=0;i<12;i++){
        const ox=(i*73.1)%z.w;
        const oy=((i*41.7+t*(0.6+i*0.08)*32))%z.h;
        const s=1+Math.sin(t*2+i)*0.5;
        ctx.fillStyle='rgba(200,230,255,0.6)';
        ctx.fillRect(zx+ox,zy+z.h-oy,s,s);
      }
      ctx.restore();
    }
    // ---- HIGH GRAVITY: dense atmosphere, streaking debris ----
    if(lvl.highGZone){
      const z=lvl.highGZone;const zx=z.x-camx,zy=z.y-camy;
      ctx.save();
      ctx.globalAlpha=0.10+0.04*Math.sin(t*1.8);
      const g=ctx.createLinearGradient(zx,zy,zx,zy+z.h);
      g.addColorStop(0,'rgba(160,90,50,0.0)');
      g.addColorStop(0.5,'rgba(160,90,50,1)');
      g.addColorStop(1,'rgba(160,90,50,0.0)');
      ctx.fillStyle=g;ctx.fillRect(zx,zy,z.w,z.h);
      // Falling streaks
      ctx.globalAlpha=0.55;
      ctx.strokeStyle='rgba(200,140,80,0.7)';ctx.lineWidth=1;
      for(let i=0;i<10;i++){
        const ox=(i*61.3)%z.w;
        const oy=((i*29.7+t*(2.5+i*0.18)*32))%z.h;
        ctx.beginPath();ctx.moveTo(zx+ox,zy+oy);ctx.lineTo(zx+ox+(Math.random()-0.5),zy+oy+6);ctx.stroke();
      }
      ctx.restore();
    }
    // ---- DASH GATE: neon energy lines flow across the gate ----
    if(lvl.dashGate){
      const z=lvl.dashGate;const zx=z.x-camx,zy=z.y-camy;
      ctx.save();
      // Gate frame glow
      ctx.shadowColor='#55ddff';ctx.shadowBlur=14;
      ctx.strokeStyle='rgba(80,220,255,0.6)';ctx.lineWidth=2;
      ctx.strokeRect(zx,zy,z.w,z.h);
      ctx.shadowBlur=0;
      // Animated horizontal flow lines
      for(let i=0;i<5;i++){
        const frac=((i/5)+t*0.7)%1;
        const ly=zy+frac*z.h;
        const alpha=0.6*(1-Math.abs(frac-0.5)*2);
        ctx.globalAlpha=alpha;
        ctx.strokeStyle='rgba(120,240,255,0.9)';ctx.lineWidth=1.5;
        ctx.beginPath();ctx.moveTo(zx,ly);ctx.lineTo(zx+z.w,ly);ctx.stroke();
        // small arrow chevron
        ctx.beginPath();ctx.moveTo(zx+z.w*0.3,ly-3);ctx.lineTo(zx+z.w*0.5,ly);ctx.lineTo(zx+z.w*0.3,ly+3);ctx.stroke();
        ctx.beginPath();ctx.moveTo(zx+z.w*0.55,ly-3);ctx.lineTo(zx+z.w*0.75,ly);ctx.lineTo(zx+z.w*0.55,ly+3);ctx.stroke();
      }
      ctx.restore();
    }
    // ---- REVERSE ZONE: glitch bars and mirrored decoration ----
    if(lvl.revZone){
      const z=lvl.revZone;const zx=z.x-camx,zy=z.y-camy;
      ctx.save();
      // Occasional horizontal glitch bar
      if(Math.sin(t*7.3)>0.7){
        const gy=zy+Math.random()*z.h;
        ctx.globalAlpha=0.18;
        ctx.fillStyle='rgba(255,80,200,1)';
        ctx.fillRect(zx,gy,z.w,3+Math.random()*4);
      }
      // Faint chromatic border
      ctx.globalAlpha=0.12+0.06*Math.sin(t*3.1);
      const g=ctx.createLinearGradient(zx,zy,zx+z.w,zy);
      g.addColorStop(0,'rgba(255,60,180,0)');
      g.addColorStop(0.5,'rgba(255,60,180,1)');
      g.addColorStop(1,'rgba(255,60,180,0)');
      ctx.fillStyle=g;ctx.fillRect(zx,zy,z.w,z.h);
      // Mirrored arrow pair — left arrow on right edge, right arrow on left, suggesting reversal
      ctx.globalAlpha=0.45+0.15*Math.sin(t*2);
      ctx.strokeStyle='rgba(255,120,220,0.9)';ctx.lineWidth=2;
      const mx=zx+z.w/2,my=zy+z.h/2;
      // left-pointing on right side
      ctx.beginPath();ctx.moveTo(mx+20,my-6);ctx.lineTo(mx+8,my);ctx.lineTo(mx+20,my+6);ctx.stroke();
      // right-pointing on left side
      ctx.beginPath();ctx.moveTo(mx-20,my-6);ctx.lineTo(mx-8,my);ctx.lineTo(mx-20,my+6);ctx.stroke();
      ctx.restore();
    }
  }
  drawFakeCheckpointReveal(ctx,x,y){
    // Show it was fake after trigger
    ctx.strokeStyle='#ff4444';ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(x,y+20);ctx.lineTo(x,y-26);ctx.stroke();
    ctx.fillStyle='#ff4444';
    ctx.beginPath();ctx.moveTo(x,y-26);ctx.lineTo(x+22,y-18);ctx.lineTo(x,y-10);ctx.closePath();ctx.fill();
    ctx.textBaseline='alphabetic';
    ctx.fillStyle='#ff0000';ctx.font='bold 10px sans-serif';ctx.textAlign='center';
    ctx.fillText('FAKE',x,y-32);
    // Red X over it
    ctx.strokeStyle='#ff0000';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(x-10,y-30);ctx.lineTo(x+10,y-10);ctx.moveTo(x+10,y-30);ctx.lineTo(x-10,y-10);ctx.stroke();
  }
  drawFakeDoorReveal(ctx,x,y,w,h){
    // Show it was fake after trigger
    const g=ctx.createLinearGradient(0,y,0,y+h);
    g.addColorStop(0,'#ff4444');g.addColorStop(1,'#8a0a0a');
    ctx.fillStyle=g;ctx.fillRect(x,y,w,h);
    ctx.strokeStyle='#ff0000';ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);
    ctx.textBaseline='alphabetic';
    ctx.fillStyle='#fff';ctx.font='bold 12px sans-serif';ctx.textAlign='center';
    ctx.fillText('FAKE',x+w/2,y+h/2+4);
    // Red X
    ctx.strokeStyle='#ff0000';ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(x+4,y+4);ctx.lineTo(x+w-4,y+h-4);ctx.moveTo(x+w-4,y+4);ctx.lineTo(x+4,y+h-4);ctx.stroke();
  }
  drawPlatform(ctx,x,y,w,h){ if(x+w<0||x>this.W)return; const g=ctx.createLinearGradient(0,y,0,y+h);g.addColorStop(0,'#4a5a7a');g.addColorStop(0.15,'#2e3a52');g.addColorStop(1,'#1a2030');ctx.fillStyle=g;ctx.fillRect(x,y,w,h);ctx.fillStyle='rgba(140,180,230,0.8)';ctx.fillRect(x,y,w,3);ctx.strokeStyle='rgba(0,0,0,0.4)';ctx.lineWidth=1;ctx.strokeRect(x+0.5,y+0.5,w-1,h-1);}
  drawMoving(ctx,x,y,w,h){ if(x+w<0||x>this.W)return; const g=ctx.createLinearGradient(0,y,0,y+h);g.addColorStop(0,'#caa040');g.addColorStop(1,'#7a5a10');ctx.fillStyle=g;ctx.fillRect(x,y,w,h);ctx.fillStyle='rgba(255,230,140,0.9)';ctx.fillRect(x,y,w,3);ctx.strokeStyle='rgba(0,0,0,0.4)';ctx.strokeRect(x+0.5,y+0.5,w-1,h-1);}
  drawHazard(ctx,x,y,w,h){ if(x+w<0||x>this.W)return; const n=Math.max(1,Math.floor(w/12));const sw=w/n;ctx.fillStyle='#e8324a';for(let i=0;i<n;i++){ctx.beginPath();ctx.moveTo(x+i*sw,y+h);ctx.lineTo(x+i*sw+sw/2,y);ctx.lineTo(x+i*sw+sw,y+h);ctx.closePath();ctx.fill();}ctx.fillStyle='rgba(255,180,180,0.5)';for(let i=0;i<n;i++){ctx.beginPath();ctx.moveTo(x+i*sw+sw/2,y);ctx.lineTo(x+i*sw+sw*0.65,y+h*0.4);ctx.lineTo(x+i*sw+sw/2,y+h*0.4);ctx.closePath();ctx.fill();}}
  drawCheckpoint(ctx,x,y,hit){ if(x<-50||x>this.W+50)return; ctx.strokeStyle=hit?'#ffdd55':'rgba(255,255,255,0.4)';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x,y+20);ctx.lineTo(x,y-26);ctx.stroke();ctx.fillStyle=hit?'#ffdd55':'rgba(150,150,150,0.5)';const f=hit?(Math.sin(this.menuT*4)*3):0;ctx.beginPath();ctx.moveTo(x,y-26);ctx.lineTo(x+22+f,y-18);ctx.lineTo(x,y-10);ctx.closePath();ctx.fill();}
  drawDoor(ctx,x,y,w,h,real){ if(x+w<0||x>this.W)return; const pulse=0.6+0.4*Math.sin(this.menuT*3);ctx.fillStyle=real?`rgba(60,255,140,${0.3+pulse*0.3})`:'rgba(60,255,140,0.28)';ctx.fillRect(x-6,y-6,w+12,h+12);const g=ctx.createLinearGradient(0,y,0,y+h);g.addColorStop(0,'#2fff8f');g.addColorStop(1,'#0a8a4a');ctx.fillStyle=g;ctx.fillRect(x,y,w,h);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);ctx.fillStyle='#063';ctx.beginPath();ctx.arc(x+w*0.75,y+h/2,2.5,0,7);ctx.fill();}
  drawPlayer(ctx,camx,camy){ const p=this.player;if(p.win&&p.deadT>0)return;const x=p.x-camx,y=p.y-camy;if(p.dead){ctx.globalAlpha=Math.max(0,1-p.deadT/0.9);ctx.strokeStyle='#ff4455';ctx.lineWidth=4;const cx=p.deathX-camx+p.w/2,cy=p.deathY-camy+p.h/2;const s=14+p.deadT*30;ctx.beginPath();ctx.moveTo(cx-s,cy-s);ctx.lineTo(cx+s,cy+s);ctx.moveTo(cx+s,cy-s);ctx.lineTo(cx-s,cy+s);ctx.stroke();ctx.globalAlpha=1;return;}const sq=p.squash;const w=p.w/sq,h=p.h*sq;const dx=x-(w-p.w)/2,dy=y+(p.h-h);const sk=this._skinColors();if(p.dashing>0){ctx.shadowColor='#55ddff';ctx.shadowBlur=18;}const g=ctx.createLinearGradient(0,dy,0,dy+h);const isDash=p.dashing>0;const c1=isDash?(sk.dash[0]||'#aef'):sk.colors[0];const c2=isDash?(sk.dash[1]||'#5cf'):sk.colors[1];if(sk.id===7){const hue=(this.menuT*80)%360;g.addColorStop(0,`hsl(${hue},100%,70%)`);g.addColorStop(1,`hsl(${(hue+120)%360},100%,45%)`);}else{g.addColorStop(0,c1);g.addColorStop(1,c2);}ctx.fillStyle=g;this.roundRect(ctx,dx,dy,w,h,6);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#fff';const ex=dx+w/2+p.facing*4;ctx.fillRect(ex-2,dy+8,4,5);ctx.fillRect(ex+5*p.facing-2,dy+8,4,5);ctx.fillStyle='#111';ctx.fillRect(ex-1+p.facing,dy+10,2,2);}
  fmtTime(ms){const s=ms/1000;const m=Math.floor(s/60);const sec=(s-m*60);if(m>0)return m+':'+sec.toFixed(2).padStart(5,'0');return sec.toFixed(2)+'s';}
  drawHUD(ctx){
    const lvl=this.cur;
    const t=performance.now()-this.levelStart;
    ctx.textBaseline='alphabetic';
    ctx.textAlign='left';ctx.font='bold 18px Trebuchet MS';
    ctx.fillStyle='rgba(0,0,0,0.4)';this.roundRect(ctx,12,12,240,64,8);ctx.fill();
    ctx.fillStyle='#fff';ctx.fillText('Lv '+(this.curIdx+1)+': '+lvl.name.substring(0,14),22,34);
    ctx.font='15px Trebuchet MS';ctx.fillStyle='#9fe';
    ctx.fillText('Time '+this.fmtTime(t),22,56);
    ctx.fillStyle='#f99';ctx.fillText('Deaths '+(this.save.data.levelDeaths[this.curIdx]||0),130,56);
    // Progress bar (% of level cleared based on progress/total)
    const pct=Math.min(1,(this.curIdx)/(this.levels.length-1));
    const pbW=200,pbH=6,pbX=12,pbY=82;
    ctx.fillStyle='rgba(255,255,255,0.15)';this.roundRect(ctx,pbX,pbY,pbW,pbH,3);ctx.fill();
    ctx.fillStyle='#55ddff';this.roundRect(ctx,pbX,pbY,pbW*pct,pbH,3);ctx.fill();
    ctx.font='11px Trebuchet MS';ctx.fillStyle='rgba(255,255,255,0.5)';
    ctx.fillText(Math.round(pct*100)+'% complete',pbX,pbY+18);
    // Best time
    const best=this.save.data.best[this.curIdx];
    if(best){ctx.fillStyle='#ffdd55';ctx.fillText('Best '+this.fmtTime(best),pbX+100,pbY+18);}
    const p=this.player;
    ctx.textAlign='right';ctx.font='14px Trebuchet MS';
    ctx.fillStyle=p.dashCD<=0?'#5cf':'#557';
    ctx.fillText(p.dashCD<=0?'DASH READY':'DASH...',this.W-16,30);
    const pbx=this.W-54,pby=44;
    ctx.fillStyle='rgba(0,0,0,0.4)';this.roundRect(ctx,pbx,pby,42,30,6);ctx.fill();
    ctx.fillStyle='#fff';ctx.fillText('❚❚',this.W-20,pby+20);
    if(this.state===STATE.PLAY)this.uiRects.push({x:pbx,y:pby,w:42,h:30,cb:()=>{this.state=STATE.PAUSE;this.updateTouchUI();}});
    // Challenge mode timer
    if(this.save.data.challengeMode&&this.save.data.challengeMode.active){
      ctx.textAlign='center';ctx.font='bold 16px Trebuchet MS';
      ctx.fillStyle='#ffaa00';
      ctx.fillText('⚔ CHALLENGE: '+this.fmtTime(this._challengeTimer*1000)+' | Deaths: '+this._challengeDeaths,this.W/2,20);
    }
  }
  drawPause(ctx){
    ctx.fillStyle='rgba(0,0,0,0.7)';ctx.fillRect(0,0,this.W,this.H);
    ctx.textBaseline='alphabetic';
    ctx.textAlign='center';ctx.fillStyle='#fff';ctx.font='bold 46px Trebuchet MS';
    ctx.fillText('PAUSED',this.W/2,130);
    ctx.font='16px Trebuchet MS';ctx.fillStyle='#ffdd55';
    ctx.fillText('🪙 '+this.save.data.coins+' coins',this.W/2,160);
    const bw=260,bh=52,bx=this.W/2-bw/2;let by=185;
    this.button(ctx,bx,by,bw,bh,'▶ RESUME',()=>{this.state=STATE.PLAY;this.updateTouchUI();},{color:'#3aa84b'});by+=62;
    this.button(ctx,bx,by,bw,bh,'RESTART',()=>{this.startLevel(this.curIdx);},{color:'#a87a3a'});by+=62;
    this.button(ctx,bx,by,bw,bh,'LEVEL SELECT',()=>{this.openLevelSelect();if(this.save.data.settings.music)this.audio.startMusic();});by+=62;
    this.button(ctx,bx,by,bw,bh,'MAIN MENU',()=>{this.state=STATE.MENU;if(this.save.data.settings.music)this.audio.startMusic();this.updateTouchUI();});by+=62;
    if(CG.isOnCrazyGames()){
      if(!this._reviveUsed){
        this.button(ctx,bx,by,bw,bh,'💊 REVIVE (Watch Ad)',async()=>{
          const res=await CG.showRewardedAd(this.audio);
          if(res.rewarded&&!this._reviveUsed){
            this._reviveUsed=true;
            const p=this.player;p.dead=false;p.vy=0;p.vx=0;
            this.state=STATE.PLAY;this.updateTouchUI();
            this.notify('💊 Revived! Stay alive!','💊',2.5);
          }
        },{color:'#cc4488'});by+=62;
      }
      this.button(ctx,bx,by,bw,bh,'▶ SKIP LEVEL (Watch Ad)',async()=>{
        const res=await CG.showRewardedAd(this.audio);
        if(res.rewarded){this.win();}
      },{color:'#8844cc',text:'#fff'});
    }
  }

  drawLose(ctx){
    ctx.fillStyle='rgba(10,0,0,0.82)';ctx.fillRect(0,0,this.W,this.H);
    ctx.textBaseline='alphabetic';
    ctx.textAlign='center';
    const pulse=0.85+0.15*Math.sin(this.menuT*4);
    ctx.globalAlpha=pulse;
    ctx.font='bold 56px Trebuchet MS';
    ctx.fillStyle='#ff2244';
    ctx.fillText('YOU DIED',this.W/2,110);
    ctx.globalAlpha=1;
    const deaths=this.save.data.levelDeaths[this.curIdx]||0;
    ctx.font='22px Trebuchet MS';ctx.fillStyle='#f99';
    ctx.fillText('Deaths this level: '+deaths,this.W/2,152);
    ctx.font='15px Trebuchet MS';ctx.fillStyle='rgba(255,220,80,0.8)';
    ctx.fillText('🪙 Total coins: '+this.save.data.coins,this.W/2,178);
    ctx.font='14px Trebuchet MS';ctx.fillStyle='rgba(255,255,255,0.45)';
    const cp=this.activeCheckpoint;
    ctx.fillText(cp?'Respawning from checkpoint…':'Back to start…',this.W/2,200);
    const bw=260,bh=50,bx=this.W/2-bw/2;let by=228;
    this.button(ctx,bx,by,bw,bh,'▶ TRY AGAIN',()=>{this.respawn();this.state=STATE.PLAY;this.updateTouchUI();},{color:'#3aa84b'});by+=58;
    if(CG.isOnCrazyGames()&&!this._reviveUsed){
      this.button(ctx,bx,by,bw,bh,'💊 CONTINUE (Watch Ad)',async()=>{
        const res=await CG.showRewardedAd(this.audio);
        if(res.rewarded&&!this._reviveUsed){
          this._reviveUsed=true;
          this.respawn();this.state=STATE.PLAY;this.updateTouchUI();
          this.notify('💊 Continued! Good luck!','💊',2.5);
        }
      },{color:'#cc4488'});by+=58;
    }
    this.button(ctx,bx,by,bw,bh,'RESTART LEVEL',()=>{this.startLevel(this.curIdx);},{color:'#a87a3a'});by+=58;
    this.button(ctx,bx,by,bw,bh,'LEVEL SELECT',()=>{this.openLevelSelect();if(this.save.data.settings.music)this.audio.startMusic();});by+=58;
    if(CG.isOnCrazyGames()){
      this.button(ctx,bx,by,bw,bh,'▶ SKIP LEVEL (Watch Ad)',async()=>{
        const res=await CG.showRewardedAd(this.audio);
        if(res.rewarded){this.win();}
      },{color:'#8844cc',text:'#fff'});
    }
  }
  drawCredits(ctx){
    this.bgGrad(ctx,'#0a0818','#030308');
    ctx.textBaseline='alphabetic';
    ctx.textAlign='center';
    ctx.font='bold 44px Trebuchet MS';ctx.fillStyle='#fff';
    ctx.fillText('CREDITS',this.W/2,80);
    // Decorative line
    ctx.strokeStyle='rgba(80,160,255,0.4)';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(this.W/2-180,100);ctx.lineTo(this.W/2+180,100);ctx.stroke();
    const lines=[
      ['RAGE PARKOUR','#55ddff','bold 26px Trebuchet MS'],
      ['30 Levels · 3 Chapters','rgba(200,220,255,0.7)','18px Trebuchet MS'],
      ['','',''],
      ['DESIGN & PROGRAMMING','rgba(140,180,255,0.6)','14px Trebuchet MS'],
      ['Rage Parkour Dev Team','#fff','22px Trebuchet MS'],
      ['','',''],
      ['GAME ENGINE','rgba(140,180,255,0.6)','14px Trebuchet MS'],
      ['HTML5 Canvas · Web Audio API','#fff','20px Trebuchet MS'],
      ['','',''],
      ['PLATFORM','rgba(140,180,255,0.6)','14px Trebuchet MS'],
      ['CrazyGames SDK v3','#fff','20px Trebuchet MS'],
      ['','',''],
      ['SOUND','rgba(140,180,255,0.6)','14px Trebuchet MS'],
      ['Procedural Web Audio','#fff','20px Trebuchet MS'],
      ['','',''],
      ['THANK YOU FOR PLAYING!','#ffdd55','bold 20px Trebuchet MS'],
    ];
    let y=138;
    for(const [text,color,font] of lines){
      if(!text){y+=10;continue;}
      ctx.font=font;ctx.fillStyle=color;
      ctx.fillText(text,this.W/2,y);
      y+=parseInt(font)||20;
      y+=6;
    }
    this.button(ctx,this.W/2-90,this.H-66,180,46,'BACK',()=>{
      this.state=STATE.MENU;
      if(this.save.data.settings.music)this.audio.startMusic();
    });
  }

  drawWin(ctx){
    ctx.fillStyle='rgba(0,20,10,0.78)';ctx.fillRect(0,0,this.W,this.H);
    ctx.textBaseline='alphabetic';
    ctx.textAlign='center';
    ctx.fillStyle='#5fffa0';ctx.font='bold 52px Trebuchet MS';
    ctx.fillText('LEVEL COMPLETE!',this.W/2,110);
    ctx.fillStyle='#fff';ctx.font='26px Trebuchet MS';
    ctx.fillText('Time: '+this.fmtTime(this.levelTime),this.W/2,160);
    if(this.bestNew===true){ctx.fillStyle='#ffdd55';ctx.font='20px Trebuchet MS';ctx.fillText('★ NEW BEST TIME! ★',this.W/2,192);}
    else{ctx.fillStyle='#9fe';ctx.font='18px Trebuchet MS';ctx.fillText('Best: '+this.fmtTime(this.save.data.best[this.curIdx]),this.W/2,192);}
    ctx.fillStyle='#f99';ctx.font='16px Trebuchet MS';
    ctx.fillText('Deaths this level: '+(this.save.data.levelDeaths[this.curIdx]||0),this.W/2,218);
    // Coins earned this level
    const baseCoins=20+this.curIdx*2;
    const levelDeaths=this.save.data.levelDeaths[this.curIdx]||0;
    const noDeathBonus=levelDeaths===0?50:0;const speedBonus=this.levelTime<30000?25:0;
    ctx.fillStyle='#ffdd55';ctx.font='16px Trebuchet MS';
    let coinStr='🪙 Earned: '+(baseCoins+noDeathBonus+speedBonus)+' coins';
    if(noDeathBonus)coinStr+=' (+50 no-death!)';
    if(speedBonus)coinStr+=' (+25 speed!)';
    ctx.fillText(coinStr,this.W/2,242);
    const bw=260,bh=50,bx=this.W/2-bw/2;let by=268;
    const hasNext=(this.curIdx+1)<this.levels.length;
    if(hasNext){this.button(ctx,bx,by,bw,bh,'NEXT LEVEL ▶',()=>{this.startLevel(this.curIdx+1);},{color:'#3aa84b'});by+=60;}
    else{ctx.fillStyle='#ffdd55';ctx.font='bold 20px Trebuchet MS';ctx.fillText('🏆 YOU BEAT RAGE PARKOUR! ALL 30 LEVELS! 🏆',this.W/2,by+20);by+=52;}
    this.button(ctx,bx,by,bw,bh,'RETRY',()=>{this.startLevel(this.curIdx);},{color:'#a87a3a'});by+=58;
    this.button(ctx,bx,by,bw,bh,'LEVEL SELECT',()=>{this.openLevelSelect();if(this.save.data.settings.music)this.audio.startMusic();});by+=58;
    // CG: Double coins rewarded ad
    if(CG.isOnCrazyGames()&&!this._doubleCoinsUsed){
      this.button(ctx,bx,by,bw,bh,'▶ 2× COINS (Watch Ad)',async()=>{
        const res=await CG.showRewardedAd(this.audio);
        if(res.rewarded&&!this._doubleCoinsUsed){
          this._doubleCoinsUsed=true;
          const bonus=baseCoins+noDeathBonus+speedBonus;
          this.awardCoins(bonus,this.W/2,260);
          this.notify('🪙 Double coins! +'+bonus,'🪙',2.5);
        }
      },{color:'#8844cc',text:'#fff'});
    }
  }

  // ========== DAILY REWARD SCREEN ==========
  drawDailyReward(ctx){
    this.bgGrad(ctx,'#1a1008','#080a00');
    ctx.textBaseline='alphabetic';
    ctx.textAlign='center';
    ctx.fillStyle='#ffdd55';ctx.font='bold 44px Trebuchet MS';
    ctx.fillText('📅 DAILY REWARD',this.W/2,80);
    const r=this.save.checkDailyReward();
    const streak=this.save.data.dailyReward.streak||0;
    if(r.canClaim){
      ctx.fillStyle='#fff';ctx.font='22px Trebuchet MS';
      ctx.fillText('Come back every day for bigger rewards!',this.W/2,126);
      // Streak display
      ctx.font='18px Trebuchet MS';ctx.fillStyle='#ffaa44';
      ctx.fillText('🔥 Current streak: '+(streak+1)+' day'+(streak>0?'s':''),this.W/2,158);
      // Coin amount
      ctx.font='bold 52px Trebuchet MS';ctx.fillStyle='#ffee44';
      ctx.fillText('🪙 +'+r.coins,this.W/2,226);
      ctx.font='16px Trebuchet MS';ctx.fillStyle='rgba(255,255,200,0.6)';
      ctx.fillText('(+25 per streak day, max 200/day)',this.W/2,256);
      // 7-day streak boxes
      const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
      const bsz=46,gap=8,totalW=days.length*(bsz+gap)-gap;
      let sx=this.W/2-totalW/2;
      for(let i=0;i<days.length;i++){
        const earned=i<(streak%7);
        ctx.fillStyle=earned?'#ffdd55':'rgba(255,255,255,0.12)';
        this.roundRect(ctx,sx,276,bsz,bsz,6);ctx.fill();
        ctx.fillStyle=earned?'#222':'rgba(255,255,255,0.5)';
        ctx.font='11px Trebuchet MS';ctx.fillText(days[i],sx+bsz/2,296);
        ctx.font='16px Trebuchet MS';ctx.fillText(earned?'✓':'·',sx+bsz/2,314);
        sx+=bsz+gap;
      }
      this.button(ctx,this.W/2-140,340,280,54,'🎁 CLAIM REWARD',()=>{
        const result=this.save.claimDailyReward();
        this.notify('🎁 +'+result.coins+' coins! Streak: '+result.newStreak+'🔥','🎁',3);
        this._checkAchievements();
        this.state=STATE.MENU;
      },{color:'#cc8800'});
    } else {
      const h=Math.floor(r.msLeft/3600000),m=Math.floor((r.msLeft%3600000)/60000);
      ctx.fillStyle='#aaa';ctx.font='22px Trebuchet MS';
      ctx.fillText('Already claimed today!',this.W/2,150);
      ctx.fillStyle='#ffdd55';ctx.font='18px Trebuchet MS';
      ctx.fillText('Next reward in: '+h+'h '+m+'m',this.W/2,186);
      ctx.fillStyle='#f99';ctx.font='16px Trebuchet MS';
      ctx.fillText('🔥 Current streak: '+streak+' day'+(streak!==1?'s':''),this.W/2,220);
    }
    this.button(ctx,this.W/2-100,this.H-66,200,46,'← BACK',()=>{this.state=STATE.MENU;});
  }

  // ========== ACHIEVEMENTS SCREEN ==========
  drawAchievements(ctx){
    this.bgGrad(ctx,'#0d0820','#040210');
    ctx.textBaseline='alphabetic';
    ctx.textAlign='center';
    ctx.fillStyle='#cc88ff';ctx.font='bold 40px Trebuchet MS';
    ctx.fillText('🏅 ACHIEVEMENTS',this.W/2,60);
    const unlocked=Object.keys(this.save.data.achievements||{}).length;
    ctx.font='15px Trebuchet MS';ctx.fillStyle='rgba(200,180,255,0.6)';
    ctx.fillText(unlocked+' / '+ACHIEVEMENTS.length+' unlocked',this.W/2,88);
    const cols=2,cw=420,ch=58,padX=(this.W-cols*cw)/2;
    let col=0,row=0;
    for(const ach of ACHIEVEMENTS){
      const done=!!(this.save.data.achievements||{})[ach.id];
      const x=padX+col*cw,y=106+row*ch;
      ctx.fillStyle=done?'rgba(100,80,160,0.55)':'rgba(40,40,60,0.4)';
      this.roundRect(ctx,x+4,y+2,cw-8,ch-4,8);ctx.fill();
      ctx.font='22px Trebuchet MS';ctx.textAlign='left';
      ctx.fillStyle=done?'#ffdd55':'rgba(255,255,255,0.2)';
      ctx.fillText(ach.icon,x+16,y+30);
      ctx.font='bold 14px Trebuchet MS';
      ctx.fillStyle=done?'#fff':'rgba(255,255,255,0.3)';
      ctx.fillText(ach.name,x+46,y+22);
      ctx.font='12px Trebuchet MS';
      ctx.fillStyle=done?'rgba(200,200,255,0.7)':'rgba(255,255,255,0.2)';
      ctx.fillText(ach.desc,x+46,y+40);
      if(ach.coins>0){
        ctx.textAlign='right';ctx.fillStyle=done?'#ffdd55':'rgba(255,220,80,0.2)';
        ctx.font='12px Trebuchet MS';ctx.fillText('🪙+'+ach.coins,x+cw-10,y+22);
      }
      ctx.textAlign='center';
      col++;if(col>=cols){col=0;row++;}
    }
    this.button(ctx,this.W/2-100,this.H-56,200,44,'← BACK',()=>{this.state=STATE.MENU;});
  }

  // ========== SKINS SCREEN ==========
  drawSkins(ctx){
    this.bgGrad(ctx,'#0a0a20','#050510');
    ctx.textBaseline='alphabetic';
    ctx.textAlign='center';
    ctx.fillStyle='#55ddff';ctx.font='bold 40px Trebuchet MS';
    ctx.fillText('🎨 SKINS',this.W/2,56);
    ctx.font='15px Trebuchet MS';ctx.fillStyle='rgba(200,220,255,0.55)';
    ctx.fillText('🪙 Coins: '+this.save.data.coins,this.W/2,82);
    const cols=4,sw=200,sh=130,padX=(this.W-cols*sw)/2,padY=100;
    for(let i=0;i<SKINS.length;i++){
      const sk=SKINS[i];
      const col=i%cols,row=Math.floor(i/cols);
      const x=padX+col*sw,y=padY+row*sh;
      const owned=(this.save.data.unlockedSkins||[]).includes(i);
      const equipped=this.save.data.equippedSkin===i;
      ctx.fillStyle=equipped?'rgba(80,180,120,0.35)':owned?'rgba(60,60,100,0.4)':'rgba(30,30,50,0.4)';
      this.roundRect(ctx,x+4,y+4,sw-8,sh-8,10);ctx.fill();
      if(equipped){ctx.strokeStyle='#44ff88';ctx.lineWidth=2;this.roundRect(ctx,x+4,y+4,sw-8,sh-8,10);ctx.stroke();}
      // Mini character preview
      const px=x+sw/2-14,py=y+20,pw=28,ph=36;
      const g2=ctx.createLinearGradient(0,py,0,py+ph);
      if(sk.id===7){g2.addColorStop(0,`hsl(${(this.menuT*80)%360},100%,70%)`);g2.addColorStop(1,`hsl(${(this.menuT*80+120)%360},100%,45%)`);}
      else{g2.addColorStop(0,sk.colors[0]);g2.addColorStop(1,sk.colors[1]);}
      ctx.fillStyle=g2;this.roundRect(ctx,px,py,pw,ph,5);ctx.fill();
      ctx.fillStyle='#fff';ctx.fillRect(px+8,py+8,5,6);ctx.fillRect(px+15,py+8,5,6);
      ctx.fillStyle='#111';ctx.fillRect(px+9,py+10,2,2);ctx.fillRect(px+16,py+10,2,2);
      ctx.textAlign='center';
      ctx.font='bold 14px Trebuchet MS';ctx.fillStyle='#fff';
      ctx.fillText(sk.name,x+sw/2,y+70);
      if(equipped){
        ctx.font='13px Trebuchet MS';ctx.fillStyle='#44ff88';
        ctx.fillText('✓ Equipped',x+sw/2,y+90);
      } else if(owned){
        this.button(ctx,x+10,y+sh-38,sw-20,32,'Equip',()=>{
          this.save.data.equippedSkin=i;this.save.save();
          this.notify('Skin equipped: '+sk.name,'🎨',2);
          if(window.Analytics)Analytics.skinUsage(i,sk.name);
        },{color:'#336688'});
      } else {
        ctx.font='13px Trebuchet MS';ctx.fillStyle='#ffdd55';
        ctx.fillText('🪙 '+sk.cost,x+sw/2,y+88);
        if(this.save.data.coins>=sk.cost){
          this.button(ctx,x+10,y+sh-38,sw-20,32,'Buy',()=>{
            if(this.save.data.coins>=sk.cost){
              this.save.addCoins(-sk.cost);
              if(this.save.unlockSkin(i)){
                this.save.data.equippedSkin=i;this.save.save();
                this.notify('🎨 Unlocked: '+sk.name,'🎨',2.5);
                this._checkAchievements();
              }
            }
          },{color:'#886600'});
        } else {
          ctx.font='12px Trebuchet MS';ctx.fillStyle='rgba(255,100,100,0.7)';
          ctx.fillText('Not enough coins',x+sw/2,y+sh-10);
        }
      }
      // Ad: unlock random skin
      if(i===SKINS.length-1&&CG.isOnCrazyGames()&&!this._skinAdUsed){
        const adY=y+sh+10;
        this.button(ctx,padX,adY,cols*sw,40,'▶ Watch Ad → Unlock Random Skin',async()=>{
          const res=await CG.showRewardedAd(this.audio);
          if(res.rewarded&&!this._skinAdUsed){
            this._skinAdUsed=true;
            const locked=SKINS.filter((_,idx)=>!(this.save.data.unlockedSkins||[]).includes(idx));
            if(locked.length>0){
              const pick=locked[Math.floor(Math.random()*locked.length)];
              this.save.unlockSkin(pick.id);
              this.notify('🎨 Unlocked: '+pick.name+'!','🎨',3);
              this._checkAchievements();
            } else {
              this.notify('All skins already unlocked!','🎨',2);
            }
          }
        },{color:'#8844cc'});
      }
    }
    this.button(ctx,this.W/2-100,this.H-52,200,42,'← BACK',()=>{this.state=STATE.MENU;});
  }

  // ========== CHALLENGE MODE SCREEN ==========
  drawChallenge(ctx){
    this.bgGrad(ctx,'#180808','#080000');
    ctx.textBaseline='alphabetic';
    ctx.textAlign='center';
    ctx.fillStyle='#ffaa00';ctx.font='bold 42px Trebuchet MS';
    ctx.fillText('⚔ CHALLENGE MODE',this.W/2,66);
    ctx.font='17px Trebuchet MS';ctx.fillStyle='rgba(255,200,100,0.7)';
    ctx.fillText('Run all 30 levels in one go. Deaths tracked. Fastest time wins.',this.W/2,100);
    const cd=this.save.data.challengeMode||{};
    if(cd.best!=null){
      ctx.fillStyle='#ffdd55';ctx.font='20px Trebuchet MS';
      ctx.fillText('Best run: '+this.fmtTime(cd.best.time*1000)+' | Deaths: '+cd.best.deaths,this.W/2,136);
    } else {
      ctx.fillStyle='#aaa';ctx.font='16px Trebuchet MS';
      ctx.fillText('No completed runs yet.',this.W/2,136);
    }
    ctx.font='15px Trebuchet MS';ctx.fillStyle='rgba(255,200,100,0.5)';
    const rules=['• All 30 levels played in sequence','• No continues or revives','• Total time and deaths tracked','• Earn 200 coins + Achievement on first clear'];
    let ry=170;for(const r of rules){ctx.fillText(r,this.W/2,ry);ry+=26;}
    this.button(ctx,this.W/2-150,ry+20,300,54,'⚔ START CHALLENGE',()=>{
      this.save.data.challengeMode.active=true;this.save.save();
      this._challengeTimer=0;this._challengeDeaths=0;this._challengeLevelIdx=0;
      this.startLevel(0);
    },{color:'#883300'});
    this.button(ctx,this.W/2-100,this.H-66,200,46,'← BACK',()=>{this.state=STATE.MENU;});
  }

  // ========== GLOBAL OVERLAY HELPERS ==========
  _drawNotification(ctx){
    const n=this._notification;if(!n||n.t<=0)return;
    const alpha=Math.min(1,n.t/0.4)*Math.min(1,(n.t)*2);
    ctx.globalAlpha=alpha;
    ctx.textBaseline='alphabetic';
    ctx.textAlign='center';
    const tw=ctx.measureText(n.msg).width+40;
    const nx=this.W/2,ny=this.H-80;
    ctx.fillStyle='rgba(0,0,0,0.75)';
    this.roundRect(ctx,nx-tw/2,ny-28,tw,42,12);ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.2)';ctx.lineWidth=1;
    this.roundRect(ctx,nx-tw/2,ny-28,tw,42,12);ctx.stroke();
    ctx.font='bold 16px Trebuchet MS';ctx.fillStyle='#fff';
    ctx.fillText(n.msg,nx,ny);
    ctx.globalAlpha=1;
  }
  _drawCoinFloats(ctx){
    ctx.textBaseline='alphabetic';
    for(const f of this._coinFloats){
      ctx.globalAlpha=Math.min(1,f.t/0.3)*f.t;
      ctx.textAlign='center';ctx.font='bold 20px Trebuchet MS';
      ctx.fillStyle='#ffdd55';
      ctx.fillText('🪙 +'+f.val,f.x,f.y);
    }
    ctx.globalAlpha=1;
  }
  _drawCoinHUD(ctx){
    if(this.state===STATE.PLAY||this.state===STATE.PAUSE)return; // shown in HUD/pause
    ctx.textBaseline='alphabetic';
    ctx.textAlign='right';ctx.font='bold 16px Trebuchet MS';
    ctx.fillStyle='rgba(0,0,0,0.45)';
    this.roundRect(ctx,this.W-110,8,104,30,8);ctx.fill();
    ctx.fillStyle='#ffdd55';
    ctx.fillText('🪙 '+this.save.data.coins,this.W-14,28);
  }
}

class AudioManager{
  constructor(save){
    this.save=save;this.ctx=null;this.master=null;this.musicGain=null;
    this.started=false;this.musicNodes=[];this.musicTimer=null;
    this._mutedForAd=false;this._preAdVol=1;
  }
  init(){
    if(this.ctx)return;
    try{
      const AC=window.AudioContext||window.webkitAudioContext;
      this.ctx=new AC();
      this.master=this.ctx.createGain();
      this.master.gain.value=this.save.data.settings.vol;
      this.master.connect(this.ctx.destination);
      this.musicGain=this.ctx.createGain();
      this.musicGain.gain.value=0.18;
      this.musicGain.connect(this.master);
    }catch(e){}
  }
  resume(){if(this.ctx&&this.ctx.state==='suspended')this.ctx.resume();}
  setVol(v){if(this.master)this.master.gain.value=v;}
  // Mute for ad; unmuteAfterAd restores
  muteForAd(){
    if(this._mutedForAd)return;
    this._mutedForAd=true;
    this._preAdVol=this.save.data.settings.vol;
    if(this.master)this.master.gain.value=0;
    this.stopMusic();
  }
  unmuteAfterAd(){
    if(!this._mutedForAd)return;
    this._mutedForAd=false;
    if(this.master)this.master.gain.value=this._preAdVol;
    if(this.save.data.settings.music)this.startMusic();
  }
  tone(freq,dur,type,vol,slideTo,when){
    if(!this.ctx||!this.save.data.settings.sfx||this._mutedForAd)return;
    const t=when||this.ctx.currentTime;
    const o=this.ctx.createOscillator();const g=this.ctx.createGain();
    o.type=type||'square';o.frequency.setValueAtTime(freq,t);
    if(slideTo)o.frequency.exponentialRampToValueAtTime(Math.max(1,slideTo),t+dur);
    g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(vol||0.3,t+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    o.connect(g);g.connect(this.master);o.start(t);o.stop(t+dur+0.02);
  }
  noise(dur,vol,filterFreq){
    if(!this.ctx||!this.save.data.settings.sfx||this._mutedForAd)return;
    const t=this.ctx.currentTime;
    const sr=this.ctx.sampleRate;const len=Math.floor(sr*dur);
    const buf=this.ctx.createBuffer(1,len,sr);const d=buf.getChannelData(0);
    for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*(1-i/len);
    const src=this.ctx.createBufferSource();src.buffer=buf;
    const f=this.ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=filterFreq||1200;
    const g=this.ctx.createGain();g.gain.value=vol||0.3;
    src.connect(f);f.connect(g);g.connect(this.master);src.start(t);
  }
  jump(){this.tone(420,0.18,'square',0.25,760);}
  djump(){this.tone(560,0.16,'square',0.22,900);}
  dash(){this.noise(0.2,0.25,2200);this.tone(220,0.18,'sawtooth',0.18,520);}
  land(){this.noise(0.08,0.15,600);}
  death(){this.tone(300,0.5,'sawtooth',0.3,40);this.noise(0.4,0.3,800);}
  checkpoint(){this.tone(660,0.12,'sine',0.3,990);this.tone(990,0.18,'sine',0.25,1320,this.ctx?this.ctx.currentTime+0.1:0);}
  victory(){if(!this.ctx)return;const n=[523,659,784,1046];const t0=this.ctx.currentTime;n.forEach((f,i)=>this.tone(f,0.3,'triangle',0.3,null,t0+i*0.12));}
  click(){this.tone(700,0.06,'square',0.18,500);}
  startMusic(){
    if(!this.ctx||!this.save.data.settings.music||this.musicTimer||this._mutedForAd)return;
    const bass=[110,110,146,98];let step=0;
    const scale=[0,3,5,7,10,12];
    const loop=()=>{
      if(!this.save.data.settings.music||this._mutedForAd){this.stopMusic();return;}
      const t=this.ctx.currentTime;
      const b=bass[step%bass.length];
      this.tone(b,0.45,'triangle',0.06,null,t);
      if(step%2===0){const note=b*2*Math.pow(2,scale[Math.floor(Math.random()*scale.length)]/12);this.tone(note,0.25,'sine',0.04,null,t);}
      step++;
    };
    loop();this.musicTimer=setInterval(loop,450);
  }
  stopMusic(){if(this.musicTimer){clearInterval(this.musicTimer);this.musicTimer=null;}}
}

// ========== SKINS ==========

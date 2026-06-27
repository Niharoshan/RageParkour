class InputManager{
  constructor(){
    this.keys={};this.left=false;this.right=false;this.jump=false;this.jumpPressed=false;this.dash=false;this.dashPressed=false;
    this.pointerDown=false;this.pointerX=0;this.pointerY=0;this.tapCb=null;this.anyKeyCb=null;
    window.addEventListener('keydown',e=>{
      if(['ArrowLeft','ArrowRight','ArrowUp','Space','KeyA','KeyD','KeyW','ShiftLeft','ShiftRight','KeyJ','KeyK'].includes(e.code))e.preventDefault();
      if(!this.keys[e.code]){
        if(e.code==='Space'||e.code==='ArrowUp'||e.code==='KeyW'||e.code==='KeyZ')this.jumpPressed=true;
        if(e.code==='ShiftLeft'||e.code==='ShiftRight'||e.code==='KeyK'||e.code==='KeyX')this.dashPressed=true;
        if(this.anyKeyCb)this.anyKeyCb(e.code);
      }
      this.keys[e.code]=true;this.update();
    });
    window.addEventListener('keyup',e=>{this.keys[e.code]=false;this.update();});
  }
  update(){
    this.left=this.keys['ArrowLeft']||this.keys['KeyA']||this._tl;
    this.right=this.keys['ArrowRight']||this.keys['KeyD']||this._tr;
    this.jump=this.keys['Space']||this.keys['ArrowUp']||this.keys['KeyW']||this.keys['KeyZ']||this._tj;
    this.dash=this.keys['ShiftLeft']||this.keys['ShiftRight']||this.keys['KeyK']||this.keys['KeyX']||this._td;
  }
  consumeJump(){const j=this.jumpPressed;this.jumpPressed=false;return j;}
  consumeDash(){const d=this.dashPressed;this.dashPressed=false;return d;}
  setTouch(name,val){this['_t'+name]=val;if(val){if(name==='j')this.jumpPressed=true;if(name==='d')this.dashPressed=true;}this.update();}
}
// ========== PARTICLES ==========

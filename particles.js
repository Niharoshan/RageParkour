class ParticleSystem{
  constructor(max){this.max=max;this.pool=[];for(let i=0;i<max;i++)this.pool.push({a:false,x:0,y:0,vx:0,vy:0,life:0,max:1,size:2,color:'#fff',grav:0});}
  spawn(x,y,vx,vy,life,size,color,grav){
    for(let i=0;i<this.max;i++){const p=this.pool[i];if(!p.a){p.a=true;p.x=x;p.y=y;p.vx=vx;p.vy=vy;p.life=life;p.max=life;p.size=size;p.color=color;p.grav=grav||0;return;}}
  }
  burst(x,y,n,color){for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2;const s=2+Math.random()*5;this.spawn(x,y,Math.cos(a)*s,Math.sin(a)*s,0.5+Math.random()*0.5,2+Math.random()*3,color,0.3);}}
  dust(x,y,dir){for(let i=0;i<5;i++){this.spawn(x,y,(-dir*1+Math.random()*2-1),-Math.random()*2,0.4,2+Math.random()*2,'rgba(200,200,210,0.8)',0.1);}}
  update(dt){for(let i=0;i<this.max;i++){const p=this.pool[i];if(!p.a)continue;p.life-=dt;if(p.life<=0){p.a=false;continue;}p.vy+=p.grav;p.x+=p.vx;p.y+=p.vy;p.vx*=0.96;}}
  draw(ctx,cam){for(let i=0;i<this.max;i++){const p=this.pool[i];if(!p.a)continue;const al=Math.max(0,p.life/p.max);ctx.globalAlpha=al;ctx.fillStyle=p.color;ctx.fillRect(p.x-cam.x-p.size/2,p.y-cam.y-p.size/2,p.size,p.size);}ctx.globalAlpha=1;}
  clear(){for(let i=0;i<this.max;i++)this.pool[i].a=false;}
}
// ============================================================
//  LEVEL BUILDER — 10 levels with NO labels on fake objects
//  Fake exits look identical to real exits
//  Fake checkpoints look identical to real checkpoints
//  Invisible platforms have NO visual hints
// ============================================================
const TS=32;


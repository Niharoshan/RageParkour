class AssetManager{
  constructor(){this.cache={};}
  makeGradient(ctx,x0,y0,x1,y1,stops){const g=ctx.createLinearGradient(x0,y0,x1,y1);stops.forEach(s=>g.addColorStop(s[0],s[1]));return g;}
}

// ========== DUAL SAVE MANAGER ==========
// Outside CrazyGames → localStorage
// Inside CrazyGames  → CrazyGames Data Module (with localStorage as fallback)

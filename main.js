window.addEventListener('load', async () => {
  // Report loading started
  CG.loadingStart();
  CG.setLoadingProgress(10);
  // Analytics + Localization init (independent of CrazyGames SDK so they
  // also work on itch.io / GameDistribution / GameMonetize / Poki builds).
  Analytics.init();
  await I18N.init();
  CG.setLoadingProgress(25);
  // Init SDK (resolves fast even without SDK)
  await CG.init();
  CG.setLoadingProgress(60);
  // Sync save from CG data module
  const save = new SaveManager();
  await save.syncFromCG();
  CG.setLoadingProgress(90);
  // Start game
  const game = new Game(save); // pass pre-synced save
  CG.setLoadingProgress(100);
  CG.loadingStop();
  // Refocus canvas after any SDK popups
  setTimeout(()=>{ try{document.getElementById('cv').focus();}catch(e){} }, 400);
});

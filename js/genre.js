// ─── GENRE LOGIC (spawn triggers etc.) ───────────────────────────────────────
// 流派名称（index = 流派 id，按顺序排列：0/1/2/3/4，新流派继续往下）
const GENRE_NAMES    = ['Shadow Echo', 'Shadow Vortex', 'Shadow Undying', 'Causal Echo', 'Shadow Ricochet'];
const GENRE_NAMES_CN = ['回到过去', '停止的暗影', '不灭的暗影', '因果残响', '不息的暗影'];

const Genre = {
  // called every frame to handle genre-specific spawning
  update(dt, state) {
    if (state.genre === 0) {
      this._updateEcho(dt, state);
    }
    // Genre 1 is handled by VortexManager.update()
  },

  // ── Shadow Echo ────────────────────────────────────────────────────
  _echoTimer: 0,

  _updateEcho(dt, state) {
    const interval = CONFIG.ECHO.SPAWN_INTERVAL[Math.min(state.genreLv, 5)] || 20;
    this._echoTimer -= dt;
    if (this._echoTimer <= 0) {
      this._echoTimer = interval;
      ShadowCloneManager.spawn(state.player.x, state.player.y, state);
    }
  },

  init() {
    this._echoTimer = 3; // first clone soon after start
  }
};

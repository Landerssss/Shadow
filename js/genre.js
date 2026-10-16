// ─── GENRE LOGIC (spawn triggers etc.) ───────────────────────────────────────
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

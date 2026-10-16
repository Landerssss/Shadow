// ─── MAIN GAME CONTROLLER ─────────────────────────────────────────────────────
const Game = {
  canvas:  null,
  state:   null,
  input:   { keys: {} },
  running: false,
  lastTime: 0,
  animId:   null,

  // ── Boot ───────────────────────────────────────────────────────────
  boot() {
    this.canvas = document.getElementById('game-canvas');
    Renderer.init(this.canvas);

    window.addEventListener('resize', () => {
      Renderer.resize(this.canvas);
      if (this.state) {
        Player.x = CONFIG.MAP_W / 2;
        Player.y = CONFIG.MAP_H / 2;
        MapDecor.init();
      }
    });

    // Input
    window.addEventListener('keydown', e => {
      this.input.keys[e.code] = true;
      // pause with Escape
      if (e.code === 'Escape' && this.running) this._togglePause();
    });
    window.addEventListener('keyup', e => {
      delete this.input.keys[e.code];
    });

    // Show start screen
    this._showScreen('screen-start');
    this._runBgCanvas();
  },

  // ── Menu flow ──────────────────────────────────────────────────────
  showGenreSelect() {
    this._showScreen('screen-genre');
  },

  selectGenre(genre) {
    this._startGame(genre, false);
  },

  startEndless() {
    // 默认进入上一局选用的流派；若 state 还在则沿用，否则默认 0
    const lastGenre = (this.state && typeof this.state.genre === 'number') ? this.state.genre : 0;
    this._startGame(lastGenre, true);
  },

  _startGame(genre, endlessMode) {
    // Init state
    this.state = {
      genre,
      genreLv:        1,
      player:         Player,
      enemies:        EnemyManager.enemies,
      time:           0,
      gameOver:       false,
      gameWin:        false,
      paused:         false,
      pendingLevelUp: false,
      pickedOneTimeBuffs: new Set(),
      tieredBuffCounts:    { hp: 0, dmg: 0, aspd: 0, def: 0, lifesteal: 0, speed: 0 },
      servitudeActive:     false,
      freezeEnabled:       false,
      endlessMode:          !!endlessMode,
      endlessBuffMult:      endlessMode ? 5 : 1,   // 无尽模式：BUFF 加成 × 5
    };

    // Reset systems
    Player.init({ endlessBuffMult: this.state.endlessBuffMult });
    EnemyManager.init();
    BulletManager.clear();
    Particles.clear();
    ShadowCloneManager.clear();
    VortexManager.init();
    DeathShadowManager.clear();
    ShadowLink.clear();
    ShadowLink.enabled = false;
    DeathShadowManager.enabled = false;
    ShadowExplosionManager.clear();
    MapDecor.init();
    Genre.init();

    // Update HUD genre name
    const genreNames = ['Shadow Echo', 'Shadow Vortex'];
    document.getElementById('hud-genre-name').textContent = genreNames[genre];
    document.getElementById('hud-genre-lv').textContent = '1';

    // Show game
    this._showScreen(null);
    document.getElementById('hud').classList.remove('hidden');
    this.canvas.classList.add('active');

    this.running  = true;
    this.lastTime = performance.now();
    this.animId   = requestAnimationFrame(t => this._loop(t));
  },

  restart() {
    this._showScreen('screen-start');
    document.getElementById('hud').classList.add('hidden');
    this.canvas.classList.remove('active');
    this.running = false;
    if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
  },

  // ── Main Loop ──────────────────────────────────────────────────────
  _loop(timestamp) {
    if (!this.running) return;

    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05);
    this.lastTime = timestamp;
    const state = this.state;

    if (!state.paused) {
      // ── Level-up check (pause game and show cards)
      if (state.pendingLevelUp) {
        state.pendingLevelUp = false;
        state.paused = true;
        Cards.show(state, () => {
          Cards.hide();
          state.paused = false;
          this._updateHUD();
        });
      }

      if (!state.paused) {
        state.time += dt;
        this._update(dt, state);
        this._updateHUD();
      }
    }

    this._render(state);

    if (state.gameOver) {
      this._showGameOver();
      return;
    }
    if (state.gameWin) {
      this._showGameWin();
      return;
    }

    this.animId = requestAnimationFrame(t => this._loop(t));
  },

  // ── Update ─────────────────────────────────────────────────────────
  _update(dt, state) {
    const player  = state.player;
    const enemies = EnemyManager.enemies;

    // Enemy manager
    state.cam = Renderer.cam;
    EnemyManager.update(dt, player, state);
    state.enemies = EnemyManager.enemies;

    // Player
    player.update(dt, this.input, EnemyManager.getAlive(), state);

    // Bullets
    BulletManager.update(dt, EnemyManager.getAlive(), state);

    // Genre systems
    Genre.update(dt, state);

    if (state.genre === 0) {
      ShadowCloneManager.update(dt, EnemyManager.getAlive(), state);
    } else if (state.genre === 1) {
      VortexManager.update(dt, player, EnemyManager.getAlive(), state);
    }

    // Death shadows
    DeathShadowManager.update(dt, EnemyManager.getAlive(), state);
    ShadowExplosionManager.update(dt);

    // Shadow link
    const allShadowEntities = this._getAllShadowEntities(state);
    ShadowLink.update(dt, player, allShadowEntities, EnemyManager.getAlive(), state);

    // Particles & map decor
    Particles.update(dt);
    MapDecor.update(dt);
  },

  _getAllShadowEntities(state) {
    const list = [];
    if (state.genre === 0) {
      list.push(...ShadowCloneManager.getActive());
    } else if (state.genre === 1) {
      list.push(...VortexManager.getActiveVortices());
    }
    list.push(...DeathShadowManager.shadows.filter(s => s.active));
    return list;
  },

  // ── Render ─────────────────────────────────────────────────────────
  _render(state) {
    const ctx = Renderer.ctx;
    const cam = Renderer.cam;
    Renderer.clear();

    // Background
    ctx.fillStyle = '#07030f';
    ctx.fillRect(0, 0, cam.sw, cam.sh);

    Renderer.drawMap();
    MapDecor.draw(ctx, cam);

    // Vortex rifts (lightning)
    if (state.genre === 1) {
      for (const rift of VortexManager.rifts) {
        Renderer.drawRiftLaser(rift, state.time);
      }
    }

    // Shadow link lines
    if (ShadowLink.enabled) {
      const entities = this._getAllShadowEntities(state);
      Renderer.drawShadowLinks(state.player, entities);
    }

    // Death shadows
    for (const ds of DeathShadowManager.shadows) {
      if (Utils.isOnScreen(ds.x, ds.y, cam)) {
        Renderer.drawDeathShadow(ds, state.time);
      }
    }

    // Vortices & projectiles
    if (state.genre === 1) {
      for (const v of VortexManager.vortices) {
        if (Utils.isOnScreen(v.x, v.y, cam, v.radius)) {
          Renderer.drawVortex(v, state.time);
        }
      }
      // LV5: 漩涡自产闪电
      for (const l of VortexManager.lightnings) {
        Renderer.drawVortexLightning(l, state.time);
      }
      for (const p of VortexManager.projectiles) {
        if (Utils.isOnScreen(p.x, p.y, cam)) {
          Renderer.drawVortexProjectile(p, state.time);
        }
      }
    }

    // Shadow clones
    if (state.genre === 0) {
      for (const c of ShadowCloneManager.clones) {
        if (c.alive && Utils.isOnScreen(c.x, c.y, cam)) {
          Renderer.drawShadowClone(c, state.time);
        }
      }
    }

    // Bullets
    for (const b of BulletManager.bullets) {
      if (Utils.isOnScreen(b.x, b.y, cam)) {
        Renderer.drawBullet(b, state.time);
      }
    }

    // Enemies
    for (const e of EnemyManager.enemies) {
      if (e.alive && Utils.isOnScreen(e.x, e.y, cam)) {
        Renderer.drawEnemy(e, state.time, state.player);
      }
    }

    // BOSS 锁链（3 个 BOSS 之间）
    if (EnemyManager._bossChainLife > 0) {
      const aliveBosses = EnemyManager.enemies.filter(e => e.alive && e.type === 'boss');
      Renderer.drawBossChain(aliveBosses, EnemyManager._bossChainLife, 5.0);
    }

    // Player
    Renderer.drawPlayer(state.player, state.time);

    // 共享 BOSS 血条（屏幕顶部居中）
    if (EnemyManager._bossTimeSpawned) {
      Renderer.drawBossSharedHpBar(
        EnemyManager._bossSharedHp,
        EnemyManager._bossSharedMaxHp,
        state.time
      );
    }

    // Ambient particles
    Renderer.drawParticles(Particles.list);

    // Minimap
    Renderer.drawMinimap(state);

    // 暗影爆炸（最顶层，置顶所有元素之上）
    if (ShadowExplosionManager.explosions.length > 0) {
      Renderer.drawShadowExplosions(ShadowExplosionManager.explosions, cam);
    }
    Renderer.drawMinimap(state);
  },

  // ── HUD ────────────────────────────────────────────────────────────
  _updateHUD() {
    const p  = Player;
    const st = this.state;

    // Level & EXP
    document.getElementById('hud-level-num').textContent = p.level;
    const expPct = (p.exp / p.expToNext) * 100;
    document.getElementById('exp-bar').style.width = expPct + '%';
    document.getElementById('exp-text').textContent = `${p.exp} / ${p.expToNext}`;

    // Genre level
    document.getElementById('hud-genre-lv').textContent = st.genreLv;

    // BOSS 倒计时（屏幕最上方；普通 90s / 无尽每 60s；BOSS 触发后隐藏）
    const bossTimer = document.getElementById('hud-boss-timer');
    const bossWarn  = document.getElementById('hud-boss-warning');
    if (EnemyManager._bossTimeSpawned) {
      bossTimer.classList.add('hidden');
      bossWarn.classList.remove('hidden');
    } else {
      bossTimer.classList.remove('hidden');
      bossWarn.classList.add('hidden');
      const trigger = st.endlessMode
        ? ((EnemyManager._nextBossSpawnTime != null) ? EnemyManager._nextBossSpawnTime : 60)
        : 90;
      const remain = Math.max(0, Math.ceil(trigger - st.time));
      bossTimer.textContent = `BOSS还有 ${remain} 秒出现`;
    }

    // Time
    const m = Math.floor(st.time / 60).toString().padStart(2, '0');
    const s = Math.floor(st.time % 60).toString().padStart(2, '0');
    document.getElementById('hud-time').textContent = `${m}:${s}`;
  },

  // ── Game Over ──────────────────────────────────────────────────────
  _showGameOver() {
    this.running = false;
    document.getElementById('hud').classList.add('hidden');
    this.canvas.classList.remove('active');

    const st = this.state;
    const p  = Player;
    const m  = Math.floor(st.time / 60).toString().padStart(2, '0');
    const s  = Math.floor(st.time % 60).toString().padStart(2, '0');
    const genreNames = ['Shadow Echo', 'Shadow Vortex'];

    document.getElementById('gameover-stats').innerHTML = `
      <div>存活时间: <span>${m}:${s}</span></div>
      <div>达到等级: <span>${p.level}</span></div>
      <div>流派: <span>${genreNames[st.genre]} Lv.${st.genreLv}</span></div>
    `;

    this._showScreen('screen-gameover');
  },

  // ── Game Win ───────────────────────────────────────────────────────
  _showGameWin() {
    this.running = false;
    document.getElementById('hud').classList.add('hidden');
    this.canvas.classList.remove('active');

    const st = this.state;
    const p  = Player;
    const m  = Math.floor(st.time / 60).toString().padStart(2, '0');
    const s  = Math.floor(st.time % 60).toString().padStart(2, '0');
    const genreNames = ['Shadow Echo', 'Shadow Vortex'];

    document.getElementById('win-stats').innerHTML = `
      <div>通关时间: <span>${m}:${s}</span></div>
      <div>达到等级: <span>${p.level}</span></div>
      <div>流派: <span>${genreNames[st.genre]} Lv.${st.genreLv}</span></div>
      <div>击杀 BOSS: <span>${EnemyManager._defeatedBossCount || 0}</span></div>
    `;

    this._showScreen('screen-win');
  },

  // ── Pause ──────────────────────────────────────────────────────────
  _togglePause() {
    if (!this.state) return;
    this.state.paused = !this.state.paused;
  },

  // ── Screen Util ────────────────────────────────────────────────────
  _showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    if (id) document.getElementById(id).classList.add('active');
  },

  // ── BG Canvas (start screen animated particles) ───────────────────
  _runBgCanvas() {
    const canvas = document.getElementById('bg-canvas');
    const ctx    = canvas.getContext('2d');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    const pts = Array.from({ length: 60 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Utils.rand(1, 3.5),
      vx: Utils.rand(-0.3, 0.3),
      vy: Utils.rand(-0.6, -0.1),
      alpha: Utils.rand(0.1, 0.5),
      color: Math.random() < 0.5 ? '#7b2fff' : '#ff3cac',
    }));

    const loop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy;
        if (p.y < -5) { p.y = canvas.height + 5; p.x = Math.random() * canvas.width; }
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 10; ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      requestAnimationFrame(loop);
    };
    loop();
  }
};

// ── STARTUP ──────────────────────────────────────────────────────────────────
window.addEventListener('load', () => Game.boot());

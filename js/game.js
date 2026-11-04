// ─── MAIN GAME CONTROLLER ─────────────────────────────────────────────────────
const Game = {
  canvas:  null,
  state:   null,
  input:   { keys: {}, firePressed: false },
  running: false,
  lastTime: 0,
  animId:   null,
  _bgAnimId: null,   // 开始界面背景动画帧 id
  _hudEls:  null,    // HUD 元素引用缓存
  _hudLast: {},      // HUD 上次写入值（脏检查）
  _shadowEntBuf: [], // 暗影实体列表复用缓冲

  // ── Boot ───────────────────────────────────────────────────────────
  boot() {
    this.canvas = document.getElementById('game-canvas');
    Renderer.init(this.canvas);

    // HUD 元素引用缓存（避免每帧 getElementById）
    this._hudEls = {
      levelNum: document.getElementById('hud-level-num'),
      expBar:   document.getElementById('exp-bar'),
      expText:  document.getElementById('exp-text'),
      genreLv:  document.getElementById('hud-genre-lv'),
      bossTimer: document.getElementById('hud-boss-timer'),
      bossWarn:  document.getElementById('hud-boss-warning'),
      score:     document.getElementById('hud-score'),
      time:      document.getElementById('hud-time'),
    };

    // 连击计数器（pixelfx combo-counter 适配版，独立透明像素画布）
    if (typeof ComboCounterHUD !== 'undefined') ComboCounterHUD.init();

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
    // 鼠标点击：弹射流蓄能球提前发射（可选操作，非必需；每帧消费）
    window.addEventListener('mousedown', () => {
      if (this.running && this.state && !this.state.paused) this.input.firePressed = true;
    });

    // Show start screen
    this._showScreen('screen-start');
    this._runBgCanvas();
  },

  // ── Menu flow ──────────────────────────────────────────────────────
  showGenreSelect() {
    this._stopBgCanvas(); // 离开开始界面后停掉背景动画
    this._showScreen('screen-genre');
  },

  selectGenre(genre) {
    this._startGame(genre, false);
  },

  startEndless() {
    // 默认进入上一局选用的流派；若 state 还在则沿用，否则默认 0
    const lastGenre = (this.state && typeof this.state.genre === 'number') ? this.state.genre : 0;
    // 通关后继续无尽：继承本局得分（重新开始一局仍由 _startGame 归零）
    const carryScore = (this.state && typeof this.state.score === 'number') ? this.state.score : 0;
    this._startGame(lastGenre, true, carryScore);
  },

  _startGame(genre, endlessMode, initialScore) {
    this._stopBgCanvas();
    this._hudLast = {};
    // Init state
    this.state = {
      genre,
      genreLv:        1,
      score:          Math.max(0, initialScore || 0),
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
    // 灰烬投手抛投物：开局清空未结算炸弹
    LobberBombs.clear();
    Particles.clear();
    CombatFeedback.reset();
    if (typeof ComboCounterHUD !== 'undefined') ComboCounterHUD.reset();
    ShadowCloneManager.clear();
    VortexManager.init();
    DeathShadowManager.clear();
    ShadowLink.clear();
    ShadowLink.enabled = false;
    DeathShadowManager.enabled = false;
    ShadowExplosionManager.clear();
    MapDecor.init();
    Genre.init();
    // 因果残响 / 公共机制：全部重置（残响必须在游戏重置时全部销毁）
    EchoManager.clear();
    PublicBlastManager.clear();
    PublicLightningManager.clear();
    SkyThunderManager.clearSkyThunderStrikes();
    // 不灭的暗影：护壳 / 余烬 / 遗蜕 / 冲击全部重置
    UndyingManager.clear();
    // 不息的暗影：弹球 / 蓄能 / 雷霆 / 电磁场 / 磁极残核 / 去重记录全部重置
    RicochetManager.clear();
    // 暗影轨道场视觉状态重置（纯视觉层）
    OrbitField.clear();
    // 冰封冰壳视觉实例全部销毁（敌人列表已重置）
    if (typeof IceShell !== 'undefined') IceShell.clear();

    // Show game
    this._showScreen(null);
    document.getElementById('hud').classList.remove('hidden');
    this.canvas.classList.add('active');

    this.running  = true;
    this.lastTime = performance.now();
    this.animId   = requestAnimationFrame(t => this._loop(t));

    // 弹射流首次进入：一次性暗影轨道场提示（不暂停、不遮挡战斗）
    if (genre === 4) OrbitField.showTutorial();
  },

  restart() {
    this._showScreen('screen-start');
    document.getElementById('hud').classList.add('hidden');
    this.canvas.classList.remove('active');
    this.running = false;
    if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
    // 残响状态清理（重开时全部销毁）
    EchoManager.clear();
    PublicBlastManager.clear();
    PublicLightningManager.clear();
    SkyThunderManager.clearSkyThunderStrikes();
    UndyingManager.clear();
    RicochetManager.clear();
    LobberBombs.clear(); // 重开时清理未结算炸弹
    OrbitField.clear();
    if (typeof IceShell !== 'undefined') IceShell.clear();
    if (typeof ComboCounterHUD !== 'undefined') ComboCounterHUD.reset();
    this._runBgCanvas(); // 回到开始界面时恢复背景动画
  },

  // ── Main Loop ──────────────────────────────────────────────────────
  _loop(timestamp) {
    if (!this.running) return;

    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05);
    this.lastTime = timestamp;
    const state = this.state;

    // ── 击杀顿帧：真实时间计时，冻结世界 / 冷却 / 计时；UI 与输入继续 ──
    if (!state.paused) CombatFeedback.tickReal(dt);
    if (!state.paused && CombatFeedback.hitStopMs > 0) {
      this._updateHUD();
      this._render(state);
      if (state.gameOver) { this._showGameOver(); return; }
      if (state.gameWin)  { this._showGameWin();  return; }
      this.animId = requestAnimationFrame(t => this._loop(t));
      return;
    }

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
    const player = state.player;

    // Enemy manager
    state.cam = Renderer.cam;
    EnemyManager.update(dt, player, state);
    state.enemies = EnemyManager.enemies;
    // 暗影冰封视觉：跟随真实 freezeTimer 驱动 enter / hold / exit，不参与玩法结算
    if (typeof IceShell !== 'undefined') IceShell.update(dt, state.enemies);

    // 每帧只统计一次存活敌人列表（复用缓冲，替代多次 filter 分配）
    const alive = EnemyManager.getAlive();

    // Player
    player.update(dt, this.input, alive, state);

    // Bullets
    BulletManager.update(dt, alive, state);

    // 灰烬投手抛投物（统一管理：飞行 / 落点爆炸 / 焦痕衰减）
    LobberBombs.update(dt, player, state);

    // Genre systems
    Genre.update(dt, state);

    if (state.genre === 0) {
      ShadowCloneManager.update(dt, alive, state);
    } else if (state.genre === 1) {
      VortexManager.update(dt, player, alive, state);
    } else if (state.genre === 2) {
      // 不灭的暗影：护壳 / 汲取 / 余烬遗蜕 / 蚀白冲击（含回潮与裂光余波）
      UndyingManager.update(dt, state);
    } else if (state.genre === 3) {
      // 因果残响：因果节点（延迟复现 / 吸收事件 / 脉冲 / 白蚀爆裂 / 崩解）
      EchoManager.update(dt, state);
    } else if (state.genre === 4) {
      // 不息的暗影：弹球状态机 / 蓄能 / 雷霆 / 电磁场 / 磁极残核
      RicochetManager.update(dt, alive, state);
    }

    // 不息的暗影（流派 4）：暗影轨道场视觉更新（纯视觉层，跟随玩家中心）
    if (state.genre === 4) OrbitField.update(dt, state);
    // 雷霆爆炸屏幕反馈衰减（白闪 / 震屏合并后统一衰减）
    ThunderFeedback.update(dt);
    // 提前发射输入按帧消费
    this.input.firePressed = false;

    // 白蚀爆裂视觉（四阶段；空列表零开销，裂口阶段回调事件传播）
    WhiteRuptureFX.update(dt, state);

    // 公共机制：公共爆炸队列结算 + 引雷触发（所有流派可用）
    PublicBlastManager.update(dt, state);
    PublicLightningManager.update(dt, state);
    // 引雷雷区生命周期（预警 / 落雷 / 雷区 / 消散；统一 update，暂停时自然停止）
    SkyThunderManager.updateSkyThunderStrikes(dt, state);

    // Death shadows
    DeathShadowManager.update(dt, alive, state);
    ShadowExplosionManager.update(dt, state);

    // 战斗反馈（闪白衰减 / 形变 / 击退窗口 / 震屏 / 网格波 / 连击超时）
    // 连击使用游戏时间判定：暂停 / 选卡 / 顿帧时 time 不推进，计时自然冻结。
    CombatFeedback.update(dt, state.time * 1000);

    // Shadow link
    const allShadowEntities = this._getAllShadowEntities(state);
    ShadowLink.update(dt, player, allShadowEntities, alive, state);

    // Particles & map decor
    Particles.update(dt);
    MapDecor.update(dt);
  },

  _getAllShadowEntities(state) {
    const list = this._shadowEntBuf;
    list.length = 0;
    if (state.genre === 0) {
      for (const c of ShadowCloneManager.clones) if (c.alive) list.push(c);
    } else if (state.genre === 1) {
      for (const v of VortexManager.vortices) if (v.alive) list.push(v);
    } else if (state.genre === 4) {
      // 暗影连线端点 = 最近 3 个有效弹球（连线适配，不复制弹球）
      const balls = RicochetManager.linkBalls(state.player);
      for (const b of balls) list.push(b);
      return list;
    }
    for (const s of DeathShadowManager.shadows) if (s.active) list.push(s);
    return list;
  },

  // ── Render ─────────────────────────────────────────────────────────
  _render(state) {
    const ctx = Renderer.ctx;
    const cam = Renderer.cam;

    // 震屏（统一入口：引雷 / 雷霆爆炸 / 战斗反馈共享；总偏移硬上限 2px）
    const extraPx = Math.max(SkyThunderManager.shake * 4, ThunderFeedback.shake * 2);
    const sh = CombatFeedback.renderShake(extraPx);
    const shakeOn = sh > 0.001;
    if (shakeOn) {
      ctx.save();
      ctx.translate((Math.random() * 2 - 1) * sh, (Math.random() * 2 - 1) * sh);
    }

    // Background（整屏不透明填充，替代 clearRect + fillRect 双次全屏操作；多盖 8px 防震出黑边）
    ctx.fillStyle = '#07030f';
    ctx.fillRect(-8, -8, cam.sw + 16, cam.sh + 16);

    Renderer.drawMap();
    MapDecor.draw(ctx, cam);

    // 不息的暗影（流派 4）：暗影轨道场（远景引力场线 / 断裂主边界 / 次级轨道 / 中心核心；
    // 画在敌人与敌方预警之下，不遮挡战场信息）
    if (state.genre === 4) OrbitField.render(ctx, cam, state);

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

    // 引雷地面层（低亮预警断裂圈 / 俯视雷区边界 / 冷蓝裂光；画在敌人之下，不遮挡战场）
    SkyThunderManager.renderSkyThunderStrikes(ctx, cam, state, 'ground');

    // 不息的暗影（流派 4）：磁极残核 / 电磁场 / 范围特效（地面层，敌人之下）
    if (state.genre === 4) {
      Renderer.drawRicochetFx(RicochetManager.fx, cam);
      for (const f of RicochetManager.fields) {
        Renderer.drawMagneticField(f, cam, state.time);
      }
      for (const node of RicochetManager.nodes) {
        if (Utils.isOnScreen(node.x, node.y, cam, node.radius)) {
          Renderer.drawMagneticNode(node, cam, state.time);
        }
      }
    }

    // 因果残响（流派 3）：因果节点 / 区域 / 特效 / 因果连线
    if (state.genre === 3) {
      Renderer.drawEchoZones(EchoManager.zones, cam, state.time);
      Renderer.drawCausalLinks(EchoManager.causalLinks, cam, state.time);
      for (const e of EchoManager.echoes) {
        if (e.state !== 'consumed' && Utils.isOnScreen(e.x, e.y, cam)) {
          Renderer.drawEchoMarker(e, state.time);
        }
      }
      Renderer.drawEchoFx(EchoManager.fx, cam);
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

    // 敌方地面预警（冲锋通道 / 落点红圈 / 焦痕；地面层，画在敌人之下）
    Renderer.drawEnemyGroundFx(cam, state.time, EnemyManager.enemies, LobberBombs.bombs);

    // 已死亡敌人的冰壳碎片（后半层先画，前半层在敌人之后画）
    if (typeof IceShell !== 'undefined') IceShell.drawDetached(ctx, 'back', state.time);

    // 冰壳雪花后半层：只绘制标记为 back 的雪花
    Renderer.drawParticles(Particles.list, true);

    // Enemies
    for (const e of EnemyManager.enemies) {
      if (e.alive && Utils.isOnScreen(e.x, e.y, cam)) {
        Renderer.drawEnemy(e, state.time, state.player);
      }
    }

    // 已死亡敌人的冰壳碎片（前半层）
    if (typeof IceShell !== 'undefined') IceShell.drawDetached(ctx, 'front', state.time);

    // 灰烬投手炸弹（抛物线飞行中的抛投物，实体层）
    for (const b of LobberBombs.bombs) {
      if (Utils.isOnScreen(b.x, b.y, cam, 120)) {
        Renderer.drawLobberBomb(b, state.time);
      }
    }

    // BOSS 锁链（3 个 BOSS 之间）
    if (EnemyManager._bossChainLife > 0) {
      const aliveBosses = EnemyManager.getAliveBosses();
      Renderer.drawBossChain(aliveBosses, EnemyManager._bossChainLife, 5.0);
    }

    // 不灭的暗影（流派 2）：地面资源与脐带（玩家之下）
    if (state.genre === 2) {
      UndyingManager.render(ctx, cam, state, state.time, 'ground');
    }

    // Player
    Renderer.drawPlayer(state.player, state.time);

    // 不灭的暗影（流派 2）：护壳甲片与冲击特效（玩家之上）
    if (state.genre === 2) {
      UndyingManager.render(ctx, cam, state, state.time, 'shell');
      UndyingManager.render(ctx, cam, state, state.time, 'fx');
    }

    // 不息的暗影（流派 4）：弹球本体（核心视觉，玩家层之上）
    if (state.genre === 4) {
      for (const b of RicochetManager.balls) {
        if (Utils.isOnScreen(b.x, b.y, cam, b.radius)) {
          Renderer.drawRicochetBall(b, cam, state.time);
        }
      }
      // 蓄能环 / 发射方向箭头（玩家脚下；蓄能期闭合、锁定变亮）
      Renderer.drawChargeRing(state.player, RicochetManager._chg, state.time);
      // 轨道场撞击局部反馈（边界涟漪 / 裂线 / 暗影尘；玩家与弹球之上，UI 之下）
      OrbitField.renderOverlay(ctx, cam, state);
    }

    // 共享 BOSS 血条（屏幕顶部居中）
    if (EnemyManager._bossTimeSpawned) {
      Renderer.drawBossSharedHpBar(
        EnemyManager._bossSharedHp,
        EnemyManager._bossSharedMaxHp,
        state.time
      );
    }

    // Ambient particles（后半层雪花已在敌人之前绘制）
    Renderer.drawParticles(Particles.list, false);

    // 引雷空中层（细长蓝白雷电 / 分叉 / 接地电火花 / 麻痹局部电弧；不遮挡敌人、无全屏闪光）
    SkyThunderManager.renderSkyThunderStrikes(ctx, cam, state, 'air');

    // 暗影爆炸（最顶层，置顶所有元素之上）
    if (ShadowExplosionManager.explosions.length > 0) {
      Renderer.drawShadowExplosions(ShadowExplosionManager.explosions, cam);
    }
    // 白蚀爆裂（流派 3 核心视觉：预兆 / 压缩 / 爆裂 / 裂口残留）
    if (WhiteRuptureFX.effects.length > 0) {
      WhiteRuptureFX.render(ctx, cam);
    }
    // 雷霆爆炸屏幕反馈（全屏白闪 ≤0.08；画在预警细边线之下，不遮挡 BOSS 锁链 / 引雷 / 落点预警）
    if (ThunderFeedback.flash > 0.002) {
      ctx.fillStyle = 'rgba(223,248,255,' + ThunderFeedback.flash.toFixed(3) + ')';
      ctx.fillRect(0, 0, cam.sw, cam.sh);
    }
    // 敌方危险预警细边线补绘（保持可读，不把整块危险区画到所有角色上方）
    Renderer.drawEnemyWarnEdges(cam, state.time, EnemyManager.enemies, LobberBombs.bombs);
    // 震屏复位（小地图保持稳定）
    if (shakeOn) ctx.restore();
    // Minimap（绘制一次，位于最顶层）
    Renderer.drawMinimap(state);

    // 连击 HUD：用游戏时间驱动，画在独立透明画布上（不受摄像机/震屏影响）
    if (typeof ComboCounterHUD !== 'undefined') {
      ComboCounterHUD.tick(
        state.time * 1000,
        CombatFeedback.comboCount,
        CombatFeedback.comboExpiresAt,
        CombatFeedback.comboChainId
      );
    }
  },

  // ── HUD ────────────────────────────────────────────────────────────
  _updateHUD() {
    const p  = Player;
    const st = this.state;
    const els = this._hudEls;
    const last = this._hudLast;

    // Level & EXP（脏检查：值未变化不写 DOM）
    if (last.level !== p.level) {
      last.level = p.level;
      els.levelNum.textContent = p.level;
    }
    const expPct = (p.exp / p.expToNext) * 100;
    if (last.expPct !== expPct) {
      last.expPct = expPct;
      els.expBar.style.width = expPct + '%';
    }
    const expText = `${p.exp} / ${p.expToNext}`;
    if (last.expText !== expText) {
      last.expText = expText;
      els.expText.textContent = expText;
    }

    // Genre level
    if (last.genreLv !== st.genreLv) {
      last.genreLv = st.genreLv;
      els.genreLv.textContent = st.genreLv;
    }

    // BOSS 倒计时（屏幕最上方；普通 90s / 无尽每 60s；BOSS 触发后隐藏）
    const spawned = !!EnemyManager._bossTimeSpawned;
    if (last.bossSpawned !== spawned) {
      last.bossSpawned = spawned;
      els.bossTimer.classList.toggle('hidden', spawned);
      els.bossWarn.classList.toggle('hidden', !spawned);
    }
    if (!spawned) {
      const trigger = st.endlessMode
        ? ((EnemyManager._nextBossSpawnTime != null) ? EnemyManager._nextBossSpawnTime : 60)
        : 90;
      const remain = Math.max(0, Math.ceil(trigger - st.time));
      if (last.bossRemain !== remain) {
        last.bossRemain = remain;
        els.bossTimer.textContent = `BOSS还有 ${remain} 秒出现`;
      }
    }

    // Time
    const m = Math.floor(st.time / 60).toString().padStart(2, '0');
    const s = Math.floor(st.time % 60).toString().padStart(2, '0');
    const tStr = `${m}:${s}`;
    if (last.time !== tStr) {
      last.time = tStr;
      els.time.textContent = tStr;
    }

    // 本局得分（左上）：千位分隔；分数增加时短促弹动一次（同帧多杀只触发一次）
    const score = st.score || 0;
    if (last.score !== score) {
      const prevScore = last.score;
      last.score = score;
      els.score.textContent = score.toLocaleString('en-US');
      if (prevScore !== undefined && score > prevScore) {
        els.score.classList.remove('pop');
        void els.score.offsetWidth;
        els.score.classList.add('pop');
        clearTimeout(this._scorePopT);
        this._scorePopT = setTimeout(() => els.score.classList.remove('pop'), 160);
      }
    }

    // 连击（右上）：由 ComboCounterHUD 在 _render 中用真实击杀状态与游戏时间驱动
  },

  // ── Game Over ──────────────────────────────────────────────────────
  _showGameOver() {
    this.running = false;
    // 死亡时清空所有雷区/预约/批次与弹射流状态（不残留到结算界面）
    SkyThunderManager.clearSkyThunderStrikes();
    PublicLightningManager.clear();
    RicochetManager.clear();
    LobberBombs.clear(); // 游戏死亡时清理未结算炸弹
    OrbitField.clear();
    if (typeof ComboCounterHUD !== 'undefined') ComboCounterHUD.reset();
    document.getElementById('hud').classList.add('hidden');
    this.canvas.classList.remove('active');

    const st = this.state;
    const p  = Player;
    const m  = Math.floor(st.time / 60).toString().padStart(2, '0');
    const s  = Math.floor(st.time % 60).toString().padStart(2, '0');

    document.getElementById('gameover-stats').innerHTML = `
      <div>存活时间: <span>${m}:${s}</span></div>
      <div>本局得分: <span>${(st.score || 0).toLocaleString('en-US')}</span></div>
      <div>击杀数: <span>${p.kills}</span></div>
      <div>达到等级: <span>${p.level}</span></div>
      <div>流派: <span>${GENRE_NAMES_CN[st.genre]} / ${GENRE_NAMES[st.genre]} Lv.${st.genreLv}</span></div>
    `;

    this._showScreen('screen-gameover');
  },

  // ── Game Win ───────────────────────────────────────────────────────
  _showGameWin() {
    this.running = false;
    // 通关时清空所有雷区/预约/批次与弹射流状态
    SkyThunderManager.clearSkyThunderStrikes();
    PublicLightningManager.clear();
    RicochetManager.clear();
    LobberBombs.clear(); // 通关时清理未结算炸弹
    OrbitField.clear();
    if (typeof ComboCounterHUD !== 'undefined') ComboCounterHUD.reset();
    document.getElementById('hud').classList.add('hidden');
    this.canvas.classList.remove('active');

    const st = this.state;
    const p  = Player;
    const m  = Math.floor(st.time / 60).toString().padStart(2, '0');
    const s  = Math.floor(st.time % 60).toString().padStart(2, '0');

    document.getElementById('win-stats').innerHTML = `
      <div>通关时间: <span>${m}:${s}</span></div>
      <div>本局得分: <span>${(st.score || 0).toLocaleString('en-US')}</span></div>
      <div>击杀数: <span>${p.kills}</span></div>
      <div>达到等级: <span>${p.level}</span></div>
      <div>流派: <span>${GENRE_NAMES_CN[st.genre]} / ${GENRE_NAMES[st.genre]} Lv.${st.genreLv}</span></div>
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
    if (this._bgAnimId) return; // 已在运行
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
      this._bgAnimId = requestAnimationFrame(loop);
    };
    loop();
  },

  // 停止背景动画（进入游戏后界面不可见，没必要继续抢 CPU/GPU）
  _stopBgCanvas() {
    if (this._bgAnimId) {
      cancelAnimationFrame(this._bgAnimId);
      this._bgAnimId = null;
    }
  }
};

// ── STARTUP ──────────────────────────────────────────────────────────────────
window.addEventListener('load', () => Game.boot());

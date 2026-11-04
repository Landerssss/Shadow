// ─── 战斗反馈系统（集中配置 + 统一入口）──────────────────────────────────────
// 覆盖：受击闪白 / 子弹击退 / 挤压拉伸 / 开火后坐 / 伤害飘字 / 命中火花 /
//       死亡碎片 / 击杀顿帧 / 震屏 / 地面网格波动 / 击杀数与连击。
// 所有数值集中在此，禁止散落到各系统里硬编码。

const COMBAT_FX = {
  // 受击闪白：普通 35~50ms、暴击 50~65ms；BOSS 只做局部短闪
  flash: {
    normalMs: 42,
    critMs: 58,
    normalAlpha: 0.55,
    critAlpha: 0.70,
    bossAlpha: 0.32,
  },

  // 子弹击退：普通 4~6px（暴击 6~8px），重甲 ×0.5，BOSS 0
  knockback: {
    normalPx: 5,
    critPx: 7,
    heavyMult: 0.5,
    bossPx: 0,
    windowMs: 120,
    windowCapPx: 14,
    decay: 16, // 衰减系数（位移积分 = 初速 / decay）
  },

  // 挤压拉伸：沿攻击方向缩、垂直方向胀，仅影响渲染
  squash: {
    along: 0.90,
    perp: 1.07,
    critAlong: 0.86,
    critPerp: 1.10,
    ms: 120,
  },

  // 开火后坐：渲染位置沿开火反方向偏移
  recoil: {
    minPx: 2,
    maxPx: 4,
    ms: 90,
  },

  // 伤害飘字：弹出 → 上飘缩小淡出
  dmgText: {
    lifeMs: 720,
    critLifeMs: 820,
    critScale: 1.5,
    mergeMs: 120,
    maxAlive: 36,
  },

  // 粒子：命中 3~5 枚小火花、死亡 6~12 枚碎片
  particles: {
    hitMin: 3,
    hitMax: 5,
    hitLifeMs: 180,
    deathMin: 6,
    deathMax: 12,
    deathLifeMs: 650,
    maxAlive: 900,
  },

  // 击杀顿帧：普通 24~30ms、多杀 35~45ms、BOSS 终死 60~70ms
  hitStop: {
    normalMs: 27,
    multiMs: 40,
    bossMs: 65,
    minGapMs: 300,
    maxPerSecMs: 90,
  },

  // 震屏：普通命中不震；小爆炸 0.2~0.4px、暗影冲击 0.6~1.0px、大型雷霆 1.0~1.5px
  shake: {
    maxPx: 2,
    smallPx: 0.3,
    blastPx: 0.8,
    bigPx: 1.2,
    ms: 110,
  },

  // 暗影冲击（流派 0 Lv.6）：保留原 echo_lv6 卡片 id 与触发条件
  // 视觉：完整连续的暗紫圆环 + 内侧细亮边，中央透明，快速扩散后快速淡出
  shockwave: {
    radius: 85,
    dmgBase: 30,
    dmgRatio: 0.8,
    expandMs: 250,       // 扩散 220~280ms
    afterMs: 100,        // 淡出 80~120ms
    chainDepth: 2,
    maxWavesPerChain: 12,
    mainColor: '#AE7BFF',  // 主环
    edgeColor: '#D5B9FF',  // 内侧细亮边
    glowColor: '#7040B0',  // 外侧柔和光晕
  },

  // 地面网格波动（只作用于波前窄带，位移 2~4px，叠加累计 ≤6px）
  grid: {
    pushPx: 3,
    maxPx: 6,
    bandPx: 40,
    segPx: 32,   // 网格线分段采样长度（小于带宽度，避免漏掉波前）
    ms: 250,
  },

  // 连击：相邻两次击杀间隔 < 3s 才续接（游戏时间，暂停/顿帧不消耗）
  combo: {
    timeoutMs: 3000,
    popScale: 1.2,
  },
};

const CombatFeedback = {
  // 可关闭项（接入现有设置时可切换；默认开启）
  settings: { shake: true, hitStop: true },

  shakePx: 0,
  _shakePeak: 0,
  _shakeT: 0,
  _shakeDur: 0,

  hitStopMs: 0,
  _hitStopCd: 0,
  _hitStopBudget: COMBAT_FX.hitStop.maxPerSecMs,
  _hitStopBudgetT: 0,

  gridWaves: [],
  _gridSeq: 0,

  comboCount: 0,
  comboExpiresAt: 0,   // 本段连击截止时间（游戏时间 ms）
  comboChainId: 0,     // 连击链编号：每次从 x1 重新开始时 +1
  comboPop: 0,
  timeMs: 0,           // 当前游戏时间（ms）

  kills: 0,
  _frameKills: 0,

  reset() {
    this.shakePx = 0;
    this._shakePeak = 0;
    this._shakeT = 0;
    this._shakeDur = 0;
    this.hitStopMs = 0;
    this._hitStopCd = 0;
    this._hitStopBudget = COMBAT_FX.hitStop.maxPerSecMs;
    this._hitStopBudgetT = 0;
    this.gridWaves.length = 0;
    this.comboCount = 0;
    this.comboExpiresAt = 0;
    this.comboChainId = 0;
    this.comboPop = 0;
    this.timeMs = 0;
    this.kills = 0;
    this._frameKills = 0;
    if (typeof Utils !== 'undefined' && Utils.clearDmgNums) Utils.clearDmgNums();
  },

  // ── 每帧更新（游戏时间；顿帧/暂停时不调用，计时自然冻结）──────────────
  // nowMs 传入本帧游戏时间，保证连击边界与真实游戏时钟一致。
  update(dt, nowMs) {
    this.timeMs = (nowMs != null) ? nowMs : (this.timeMs + dt * 1000);
    // 震屏衰减
    if (this._shakeT > 0) {
      this._shakeT -= dt;
      if (this._shakeT <= 0) {
        this._shakeT = 0;
        this.shakePx = 0;
      } else {
        this.shakePx = this._shakePeak * (this._shakeT / this._shakeDur);
      }
    }

    // 顿帧预算窗口（1s 内累计 ≤90ms）
    if (this._hitStopBudgetT > 0) {
      this._hitStopBudgetT -= dt;
      if (this._hitStopBudgetT <= 0) {
        this._hitStopBudget = COMBAT_FX.hitStop.maxPerSecMs;
      }
    }

    // 连击超时（游戏时间）：恰好达到截止时间按超时处理
    if (this.comboCount > 0 && this.timeMs >= this.comboExpiresAt) {
      this.comboCount = 0;
      this.comboExpiresAt = 0;
    }
    if (this.comboPop > 0) {
      this.comboPop = Math.max(0, this.comboPop - dt * 5);
    }

    // 网格波
    for (let i = this.gridWaves.length - 1; i >= 0; i--) {
      const w = this.gridWaves[i];
      w.t += dt;
      if (w.t >= w.dur + w.after) this.gridWaves.splice(i, 1);
    }

    // 本帧多杀统计清零（必须在所有击杀结算之后）
    this._frameKills = 0;
  },

  // ── 真实时间（顿帧冻结世界时仍在走）──────────────────────────────
  tickReal(realDt) {
    if (this.hitStopMs > 0) {
      this.hitStopMs = Math.max(0, this.hitStopMs - realDt * 1000);
    }
    if (this._hitStopCd > 0) {
      this._hitStopCd = Math.max(0, this._hitStopCd - realDt * 1000);
    }
  },

  // ── 震屏统一入口（像素）──────────────────────────────────────────
  shake(px, ms) {
    if (!this.settings.shake) return;
    if (!(px > 0)) return;
    const peak = Math.min(COMBAT_FX.shake.maxPx, px);
    const dur = Math.max(0.04, (ms || COMBAT_FX.shake.ms) / 1000);
    if (peak >= this._shakePeak || this._shakeT <= 0) {
      this._shakePeak = peak;
      this._shakeT = dur;
      this._shakeDur = dur;
    }
    this.shakePx = Math.max(this.shakePx, peak);
  },

  // 渲染用：当前总偏移（含既有引雷震屏），硬上限 2px
  renderShake(extraPx) {
    return Math.min(COMBAT_FX.shake.maxPx, this.shakePx + (extraPx || 0));
  },

  // ── 击杀顿帧 ────────────────────────────────────────────────────
  hitStop(kind, multi) {
    if (!this.settings.hitStop) return;
    let ms = COMBAT_FX.hitStop.normalMs;
    if (kind === 'boss') ms = COMBAT_FX.hitStop.bossMs;
    else if (multi) ms = COMBAT_FX.hitStop.multiMs;

    // 300ms 内只触发一次；同帧多次击杀只提升到最大值，不叠加
    if (this._hitStopCd > 0) {
      if (ms > this.hitStopMs) this.hitStopMs = ms;
      return;
    }
    // 1s 内累计预算
    ms = Math.min(ms, this._hitStopBudget);
    if (ms <= 0) return;
    if (ms > this.hitStopMs) this.hitStopMs = ms;
    this._hitStopBudget -= ms;
    this._hitStopCd = COMBAT_FX.hitStop.minGapMs;
    this._hitStopBudgetT = 1.0;
  },

  // ── 地面网格波动 ────────────────────────────────────────────────
  gridWave(x, y, radius, strength) {
    const dur = COMBAT_FX.grid.ms / 1000;
    this.gridWaves.push({
      x, y,
      t: 0,
      dur,
      after: 0.08,
      speed: (radius || COMBAT_FX.shockwave.radius) / dur,
      strength: strength != null ? strength : 1,
      id: ++this._gridSeq,
    });
  },

  // 返回该世界坐标处的网格偏移（只在波前附近）
  gridOffset(wx, wy) {
    const waves = this.gridWaves;
    if (waves.length === 0) return null;
    const cfg = COMBAT_FX.grid;
    let ox = 0, oy = 0;
    for (let i = 0; i < waves.length; i++) {
      const w = waves[i];
      const dx = wx - w.x, dy = wy - w.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1) continue;
      const front = w.speed * w.t;
      const dd = d - front;
      if (dd > cfg.bandPx || dd < -cfg.bandPx) continue;
      const fade = Math.max(0, 1 - w.t / (w.dur + w.after));
      const k = (1 - Math.abs(dd) / cfg.bandPx) * w.strength * fade;
      const push = cfg.pushPx * k;
      ox += (dx / d) * push;
      oy += (dy / d) * push;
    }
    if (ox === 0 && oy === 0) return null;
    if (ox > cfg.maxPx) ox = cfg.maxPx; else if (ox < -cfg.maxPx) ox = -cfg.maxPx;
    if (oy > cfg.maxPx) oy = cfg.maxPx; else if (oy < -cfg.maxPx) oy = -cfg.maxPx;
    return { x: ox, y: oy };
  },

  // ── 连击 ────────────────────────────────────────────────────────
  // 必须在处理击杀的当下检查是否超时，不能只依赖上一帧 update 清零。
  addKill(nowMs) {
    this.kills += 1;
    const now = (nowMs != null) ? nowMs : this.timeMs;

    if (this.comboCount > 0 && now < this.comboExpiresAt) {
      this.comboCount += 1;
    } else {
      this.comboCount = 1;
      this.comboChainId += 1;
    }
    this.comboExpiresAt = now + COMBAT_FX.combo.timeoutMs;
    this.comboPop = 1;
  },

  // ── 开火后坐（渲染位置，不移动本体）──────────────────────────────
  onPlayerFire(player) {
    if (!player) return;
    const r = COMBAT_FX.recoil;
    player._recoil = {
      t: r.ms / 1000,
      dur: r.ms / 1000,
      dx: -Math.cos(player.facing),
      dy: -Math.sin(player.facing),
      px: Utils.rand(r.minPx, r.maxPx),
    };
  },

  // ── 命中反馈 ────────────────────────────────────────────────────
  onHit(enemy, opts) {
    if (!enemy) return;
    const o = opts || {};
    const crit = !!o.crit;
    const dx = o.dirX != null ? o.dirX : 0;
    const dy = o.dirY != null ? o.dirY : 0;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dx / len, ny = dy / len;
    const isBoss = enemy.type === 'boss';
    // 高频命中（90ms 内再次受击）与持续伤害使用更弱反馈
    const nowMs = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    const lastAt = (enemy._fxHitAt != null) ? enemy._fxHitAt : -1e9;
    const since = nowMs - lastAt;
    const weak = !!o.dot || since < 90;
    enemy._fxHitAt = nowMs;

    // 1) 受击闪白（短促，高频命中不无限延长；持续伤害更弱）
    const f = COMBAT_FX.flash;
    const dur = (crit ? f.critMs : f.normalMs) / 1000;
    if (weak) {
      // 高频/持续伤害：仅在当前闪白结束后补一次短闪，不连续刷新
      if (!(enemy.flashTimer > 0)) {
        const d = dur * 0.6;
        enemy.flashTimer = d;
        enemy.flashDur = d;
        enemy.flashAlpha = (isBoss ? f.bossAlpha : (crit ? f.critAlpha : f.normalAlpha)) * 0.55;
      }
    } else if (enemy.flashTimer == null || enemy.flashTimer < dur) {
      enemy.flashTimer = dur;
      enemy.flashDur = dur;
      enemy.flashAlpha = isBoss ? f.bossAlpha : (crit ? f.critAlpha : f.normalAlpha);
    }

    // 2) 形变（仅渲染；高频命中不重复触发）
    if (!weak) {
      const s = COMBAT_FX.squash;
      const durS = s.ms / 1000;
      enemy._squash = {
        t: durS, dur: durS,
        dx: nx, dy: ny,
        along: crit ? s.critAlong : s.along,
        perp: crit ? s.critPerp : s.perp,
      };
    }

    // 3) 击退（仅直接命中；BOSS 不击退）
    if (!weak) this._applyKnockback(enemy, nx, ny, crit);

    // 4) 命中火花
    if (typeof Particles !== 'undefined' && Particles.spawnHit) {
      Particles.spawnHit(enemy.x, enemy.y, nx, ny, { crit, weak });
    }

    // 5) 伤害飘字
    if (o.damage != null && typeof Utils !== 'undefined') {
      const sv = Utils.worldToScreen(enemy.x, enemy.y - (enemy.radius || 14) - 10, Renderer.cam);
      const type = isBoss ? 'boss' : (crit ? 'crit' : '');
      const key = isBoss ? 'boss' : ('e' + enemy.id);
      Utils.spawnDmgNum(sv.x, sv.y, o.damage, type, key);
    }
  },

  _applyKnockback(enemy, nx, ny, crit) {
    const kb = COMBAT_FX.knockback;
    if (enemy.type === 'boss') return;
    let px = crit ? kb.critPx : kb.normalPx;
    if (enemy.selfDefense > 0) px *= kb.heavyMult;
    if (px <= 0) return;

    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    let win = enemy._kbWin;
    if (!win) { win = enemy._kbWin = { t: 0, sum: 0 }; }
    if (now - win.t > kb.windowMs) { win.t = now; win.sum = 0; }
    px = Math.min(px, kb.windowCapPx - win.sum);
    if (px <= 0) return;
    win.sum += px;

    const v = px * kb.decay;
    enemy.kx = nx * v;
    enemy.ky = ny * v;
  },

  // ── 击杀反馈 ────────────────────────────────────────────────────
  onKill(enemy, opts) {
    if (!enemy) return;
    const o = opts || {};
    this.addKill(o.nowMs);
    this._frameKills++;
    const multi = this._frameKills > 1 || !!o.multi;

    if (typeof Particles !== 'undefined' && Particles.spawnDeath) {
      Particles.spawnDeath(enemy.x, enemy.y, enemy.color || '#ff3060', !!o.crit);
    }

    this.hitStop(enemy.type === 'boss' ? 'boss' : 'normal', multi);

    // 多杀无震屏、BOSS 终死轻微震屏
    if (enemy.type === 'boss') {
      this.shake(COMBAT_FX.shake.blastPx, COMBAT_FX.shake.ms);
    }
  },
};

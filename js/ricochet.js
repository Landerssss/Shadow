// ─── GENRE 4: SHADOW RICOCHET（不息的暗影 · 弹射流）───────────────────────────
// 核心：有限弹球反弹 + 蓄能召回发射 + 雷霆化 + 电磁场传导。
// 弹球状态机（蓄能球是现有弹球的状态变化，绝不新增球）：
//   normal / recalling / charging / aiming / thunderCore / thunderBall / returning
// 直接碰撞（可暴击 / 推冰封）与派生伤害（电弧 / 爆炸 / 电磁场 tick）严格分离：
//   派生伤害不暴击、不递归、不消耗碰撞预算、不推进冰封计数。

// 碰撞类型（扫掠求交用）
const RICOCHET_HIT = { NONE: 0, WALL: 1, BOUNDARY: 2, ENEMY: 3, NODE: 4 };

// 派生伤害来源标记（fromOwner 不用 'player'/'shadow'，避免推进冰封计数）
const RICOCHET_DERIVED_OWNER = 'ricochet_derived';

// 每帧特效预算（同帧反弹合并、限制同时生成数量；普通反弹不闪屏不震屏）
const RICOCHET_FX_BUDGET = 8;
const RICOCHET_FX_MAX    = 64;

// ── 雷霆爆炸屏幕反馈（同帧合并一次；全屏白闪 ≤0.08、震屏 ≤0.8，无高频闪屏）──
const ThunderFeedback = {
  flash: 0,
  shake: 0,
  request(intensity, shakeAmt) {
    // 150ms 内多次爆炸不叠加：只保留最大值，随时间快速衰减
    if (intensity > this.flash) this.flash = Math.min(0.08, intensity);
    if (shakeAmt > this.shake) this.shake = Math.min(0.8, shakeAmt);
  },
  update(dt) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 1.15);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 8);
  },
  clear() { this.flash = 0; this.shake = 0; }
};

const RicochetManager = {
  balls:  [],  // 永久弹球（含蓄能 / 雷霆状态）
  fields: [],  // 电磁场（Lv.5 磁场回流 / Lv.7 雷霆爆炸）
  nodes:  [],  // 磁极残核（死亡暗影适配）
  fx:     [],  // 特效（火花 / 电弧 / 爆炸 / 磁场 / 召回弧）

  _ballSeq: 1,
  _nodeSeq: 1,
  _fieldSeq: 1,
  _impactSeq: 1,
  _replenishTimer: 0,
  _started: false,

  // 蓄能控制器（全场唯一；不给每个弹球建独立计时器）
  _chg: {
    phase: 'idle',        // idle | recall | charge
    ballId: -1,
    timer: 1.5,           // 距下次召回
    recallT: 0,
    chargeT: 0,
    orbitAng: 0,
    orbitDir: 1,
    rotateIdx: 0,
    moveDirX: 1, moveDirY: 0, moveDirT: -99,   // 最近有效移动方向采样
    launchX: 1, launchY: 0,
    locked: false,
  },

  // 去重 / 限频记录（定期清理）
  _hitCd:     new Map(),  // `${ballId}|${enemyId}` → state.time
  _bossPoolCd:new Map(),  // `ballId|bossPool` / `f|fieldId|tick` → state.time
  _nodeCd:    new Map(),  // `${ballId}|${nodeId}` → state.time
  _arcCd:     new Map(),  // `o|${ballId}|${enemyId}` 过载电弧限频
  _pruneTimer: 0,

  _fxBudget: 0,
  _grid: null,
  _cand: [],

  // ── 数值入口（随流派等级 / BUFF 动态变化）────────────────────────────
  _ballCap(state) {
    const cfg = CONFIG.RICOCHET;
    let cap = cfg.BALL_CAP;
    if (state.genreLv >= 2) cap = cfg.BALL_CAP_LV2;
    if (state.genreLv >= 4) cap = cfg.BALL_CAP_LV4;
    // 暗影散弹适配：上限 +2（不复制现有弹球）
    if (state.player.shotgun) cap += cfg.BALL_CAP_SHOTGUN;
    return cap;
  },

  _ballRadius(state) {
    return state.genreLv >= 2 ? CONFIG.RICOCHET.BALL_RADIUS_LV2 : CONFIG.RICOCHET.BALL_RADIUS;
  },

  // 常态速度 = 520 × sqrt(有效攻速 / 2.0)，上限 900
  _ballSpeed(state) {
    const cfg = CONFIG.RICOCHET;
    const effRate = Math.max(0.1, state.player.effectiveFireRate);
    const sp = cfg.BALL_SPEED * Math.sqrt(effRate / cfg.BALL_ASPD_REF);
    return Math.min(sp, cfg.BALL_SPEED_MAX);
  },

  // 雷霆球速度 = 常态速度 × 倍率，受各自上限约束（暗影疾行经攻速间接生效）
  _thunderSpeed(state, isBall) {
    const cfg = isBall ? CONFIG.THUNDER_BALL : CONFIG.THUNDER_CORE;
    return Math.min(this._ballSpeed(state) * cfg.speedMultiplier, cfg.maxSpeed);
  },

  // 同目标伤害保护：250ms 按攻速比例缩短，最低 120ms
  _hitCdMs(state) {
    const cfg = CONFIG.RICOCHET;
    const effRate = Math.max(0.1, state.player.effectiveFireRate);
    return Math.max(cfg.HIT_CD_MIN_MS,
      Math.min(cfg.HIT_CD_MS, cfg.HIT_CD_MS * (cfg.BALL_ASPD_REF / effRate)));
  },

  // ── 生命周期 ────────────────────────────────────────────────────────
  clear() {
    this.balls.length = 0;
    this.fields.length = 0;
    this.nodes.length = 0;
    this.fx.length = 0;
    this._hitCd.clear();
    this._bossPoolCd.clear();
    this._nodeCd.clear();
    this._arcCd.clear();
    this._replenishTimer = 0;
    this._started = false;
    const chg = this._chg;
    chg.phase = 'idle';
    chg.ballId = -1;
    chg.timer = CONFIG.CHARGED_BALL.firstTriggerDelay;
    chg.recallT = 0;
    chg.chargeT = 0;
    chg.locked = false;
    chg.moveDirT = -99;
    ThunderFeedback.clear();
    if (typeof ShadowLink !== 'undefined') ShadowLink.forgetBalls();
    if (typeof OrbitField !== 'undefined') OrbitField.clear();
  },

  // 开局立即生成（凝聚 → 发射）
  _beginBalls(state) {
    const cfg = CONFIG.RICOCHET;
    for (let i = 0; i < cfg.BALL_START_COUNT; i++) this._spawnBall(state);
    this._replenishTimer = 1 / Math.max(0.2, state.player.effectiveFireRate);
  },

  _spawnBall(state) {
    const cfg = CONFIG.RICOCHET;
    const p = state.player;
    this.balls.push({
      id: this._ballSeq++,
      active: true,
      x: p.x, y: p.y,
      vx: 0, vy: 0,
      radius: this._ballRadius(state),
      spawning: true,
      spawnTimer: cfg.SPAWN_CHARGE_TIME,
      boostTimer: 0,
      boostMult: 1,
      bndLock: false,
      impactFlash: 0,
      _softFxT: 0,
      segPierce: 0,
      passIds: new Set(),
      trail: [],
      // ── 状态机 ──
      state: 'normal',
      recallT: 0, recallDur: 0,
      recallFromX: 0, recallFromY: 0, recallCtrlX: 0, recallCtrlY: 0,
      chargeAng: 0,
      // ── 蓄能 / 过载 / 雷霆 ──
      chargedTag: false,     // 本次发射来自蓄能
      firstHitBonus: true,   // 首次有效命中 ×1.2
      firstArcCd: 0,         // Lv.3 方向脉冲冷却
      overloadT: 0,
      overloadHits: 0,
      thunderHits: 0,
      thunderT: 0,
      // ── 导电（电磁场 / 磁极残核赋予）──
      conductive: null,      // { expiresAt, remainingHits, sourceFieldId }
      lastHitTime: -99,
      // 伤害身份字段（去重键不得只用 ballId，也不得每帧新 impactId）
      impactId: 0,
      attackBatchId: 0,
      sourceType: 'ricochet_direct',
      targetId: -1,
      damageInstanceId: '',
    });
    this._addFx('spark', p.x, p.y, 0, 0.3, '#b26bff');
  },

  _launchBall(ball, enemies, state) {
    const p = state.player;
    ball.spawning = false;
    ball.radius = this._ballRadius(state);

    let angle = p.facing;
    let nearest = null, best = Infinity;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      const dSq = Utils.distSq(e, p);
      if (dSq < best) { best = dSq; nearest = e; }
    }
    if (nearest) angle = Utils.angle(p, nearest);

    const sp = this._ballSpeed(state);
    ball.vx = Math.cos(angle) * sp;
    ball.vy = Math.sin(angle) * sp;
    this._addFx('spark', ball.x, ball.y, 0, 0.35, '#c97bff');
  },

  // ── 每帧更新 ────────────────────────────────────────────────────────
  update(dt, enemies, state) {
    const cfg = CONFIG.RICOCHET;
    const p = state.player;
    if (!this._started) { this._started = true; this._beginBalls(state); }
    this._fxBudget = RICOCHET_FX_BUDGET;

    // 蓄能控制器（计时 / 选择 / 召回 / 环绕 / 发射；全场唯一）
    this._updateCharged(dt, state, enemies);

    // 电磁场生命周期 + tick
    this._updateFields(dt, state);

    // 磁极残核生命周期
    this._updateNodes(dt, state);

    // 敌人空间网格（扫掠碰撞邻域查询）
    if (enemies.length > 0) {
      if (!this._grid) this._grid = Utils.createGrid(128);
      this._grid.build(enemies, 0, 0, CONFIG.MAP_W, CONFIG.MAP_H);
    }

    // 按攻速补充弹球（凝聚 → 发射；不突破上限；蓄能不占新增名额）
    this._replenishTimer -= dt;
    if (this._replenishTimer <= 0 && this.balls.length < this._ballCap(state)) {
      this._replenishTimer = 1 / Math.max(0.2, p.effectiveFireRate);
      this._spawnBall(state);
    }

    // 弹球推进（按状态分发）
    for (let i = 0; i < this.balls.length; i++) {
      const ball = this.balls[i];
      ball.radius = this._ballRadius(state);
      if (ball.firstArcCd > 0) ball.firstArcCd -= dt;

      if (ball.state === 'recalling') {
        this._updateRecall(ball, dt, state);
        continue;
      }
      if (ball.state === 'charging' || ball.state === 'aiming') {
        // 位置由蓄能控制器摆放；这里只维护拖尾与导电（不改变蓄能形态）
        ball.trail.push({ x: ball.x, y: ball.y });
        if (ball.trail.length > cfg.TRAIL_LENGTH) ball.trail.shift();
        this._tickConductive(ball, dt, state);
        this._checkFieldConduction(ball, state);
        continue;
      }
      if (ball.spawning) {
        ball.spawnTimer -= dt;
        ball.x = p.x;
        ball.y = p.y;
        if (ball.spawnTimer <= 0) this._launchBall(ball, enemies, state);
        continue;
      }

      // 状态计时衰减（雷霆 / 过载 / 导电）
      if (ball.boostTimer > 0) ball.boostTimer -= dt;
      if (ball.safeRecall > 0) ball.safeRecall -= dt;
      if (ball.impactFlash > 0) ball.impactFlash -= dt;
      if (ball._softFxT > 0) ball._softFxT -= dt;
      if (ball.overloadT > 0) {
        ball.overloadT -= dt;
        if (ball.overloadT <= 0) { ball.overloadT = 0; ball.overloadHits = 0; }
      }
      if (ball.state === 'thunderCore' || ball.state === 'thunderBall') {
        ball.thunderT -= dt;
        const cfgT = ball.state === 'thunderBall' ? CONFIG.THUNDER_BALL : CONFIG.THUNDER_CORE;
        if (ball.thunderT <= 0) {
          // 超时：雷霆球必须爆炸 / 雷核安全结束，不能永远存在
          if (ball.state === 'thunderBall') this._explodeThunderBall(ball, state);
          else this._endThunderCore(ball, state);
          continue;
        }
        // 爆炸前收缩提示
        if (ball.state === 'thunderBall' && ball.thunderT < cfgT.preExplosionShrink) {
          ball.thunderShrink = ball.thunderT / cfgT.preExplosionShrink;
        } else {
          ball.thunderShrink = 0;
        }
      }
      if (ball.state === 'returning') {
        ball.returnT -= dt;
        if (ball.returnT <= 0) ball.state = 'normal';
      }
      this._tickConductive(ball, dt, state);
      this._checkFieldConduction(ball, state);
      this._moveBall(ball, dt, enemies, state);
    }

    // 特效寿命
    this.updateFx(dt);

    // 去重记录清理（防 Map 无限增长）
    this._pruneTimer -= dt;
    if (this._pruneTimer <= 0) {
      this._pruneTimer = 2;
      this._prune(state.time);
    }
  },

  // ── 蓄能控制器（Lv.1 起可用；同时最多一颗蓄能球）──────────────────────
  _updateCharged(dt, state, enemies) {
    const cc = CONFIG.CHARGED_BALL;
    const chg = this._chg;
    const p = state.player;

    // 移动方向采样（发射方向优先级用）
    const mv = Math.hypot(p.vx || 0, p.vy || 0);
    if (mv > 10) {
      chg.moveDirX = p.vx / mv;
      chg.moveDirY = p.vy / mv;
      chg.moveDirT = state.time;
    }

    // 提前发射输入（鼠标 / 空格；非必需操作）
    let early = false;
    if (typeof Game !== 'undefined' && Game.input) {
      early = !!Game.input.firePressed || !!Game.input.keys['Space'];
    }

    if (chg.phase === 'idle') {
      chg.timer -= dt;
      if (chg.timer <= 0) {
        const ball = this._selectChargeBall(state);
        if (ball) {
          chg.phase = 'recall';
          chg.ballId = ball.id;
          chg.recallT = 0;
          const dur = (state.genreLv >= 2 ? cc.recallDurationLv2 : cc.recallDuration);
          ball.state = 'recalling';
          ball.recallT = 0;
          ball.recallDur = dur;
          ball.recallFromX = ball.x;
          ball.recallFromY = ball.y;
          // 弯曲召回路径：垂直偏移控制点（暗影弯曲拖尾，不瞬移）
          const dx = p.x - ball.x, dy = p.y - ball.y;
          ball.recallCtrlX = (ball.x + p.x) / 2 - dy * 0.35;
          ball.recallCtrlY = (ball.y + p.y) / 2 + dx * 0.35;
          this._addFx('recall', ball.x, ball.y, 0, dur, '#8a4ad9');
        } else {
          chg.timer = 0.5; // 暂无可用球（都在凝聚），稍后再试
        }
      }
      return;
    }

    // 找到当前蓄能球
    let ball = null;
    for (let i = 0; i < this.balls.length; i++) {
      if (this.balls[i].id === chg.ballId) { ball = this.balls[i]; break; }
    }
    if (!ball) { chg.phase = 'idle'; chg.timer = cc.chargeInterval * 0.5; return; }

    if (chg.phase === 'recall') {
      // 召回由 _updateRecall 推进；到位后进入环绕
      if (ball.state !== 'recalling') {
        chg.phase = 'charge';
        chg.chargeT = 0;
        chg.locked = false;
        chg.orbitAng = Math.atan2(ball.y - p.y, ball.x - p.x);
        ball.state = 'charging';
      }
      return;
    }

    // ── 环绕蓄能 / 方向采样 / 锁定 / 发射 ──
    chg.chargeT += dt;
    const orbitDur = cc.orbitDuration;
    const t = Math.min(1, chg.chargeT / orbitDur);
    const orbitSpd = cc.initialOrbitSpeed + (cc.finalOrbitSpeed - cc.initialOrbitSpeed) * t;
    chg.orbitAng += orbitSpd * dt * chg.orbitDir;
    ball.x = p.x + Math.cos(chg.orbitAng) * cc.orbitRadius;
    ball.y = p.y + Math.sin(chg.orbitAng) * cc.orbitRadius;

    // 瞄准窗口：发射前 0.45s 显示方向箭头（aiming 状态），0.25s 锁定
    const remain = orbitDur - chg.chargeT;
    if (remain <= cc.aimWindowDuration) ball.state = 'aiming';
    if (!chg.locked && remain <= cc.directionLockDuration) {
      chg.locked = true;
      const dir = this._resolveLaunchDir(chg, state, enemies);
      chg.launchX = dir.x;
      chg.launchY = dir.y;
      this._addFx('aimlock', ball.x, ball.y, Math.atan2(dir.y, dir.x), 0.25, '#9d68ff');
    }

    if (chg.chargeT >= orbitDur || early) {
      if (!chg.locked) {
        const dir = this._resolveLaunchDir(chg, state, enemies);
        chg.launchX = dir.x;
        chg.launchY = dir.y;
      }
      this._fireCharged(ball, state);
      chg.phase = 'idle';
      chg.ballId = -1;
      chg.locked = false;
      // 蓄能周期（暗影律动最多缩短到 75%）
      let interval = (state.genreLv >= 2 ? cc.chargeIntervalLv2 : cc.chargeInterval);
      const cdMult = Math.max(cc.mechCdMinFactor, p.mechCooldownMult || 1);
      chg.timer = interval * cdMult;
    }
  },

  // 召回球选择：优先距离玩家较远 → 最近 1 秒未命中 → 轮换索引
  _selectChargeBall(state) {
    const p = state.player;
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i];
      if (b.state !== 'normal' || b.spawning) continue;
      const dist = Math.hypot(b.x - p.x, b.y - p.y);
      const fresh = (state.time - b.lastHitTime) >= 1 ? 300 : 0;
      const rot = ((i - this._chg.rotateIdx) % Math.max(1, this.balls.length)) * 5;
      const score = dist + fresh + rot;
      if (score > bestScore) { bestScore = score; best = b; }
    }
    this._chg.rotateIdx++;
    return best;
  },

  // 发射方向优先级：最近 250ms 移动方向 → 上次移动方向 → 场内最近敌人 → 环绕切线
  _resolveLaunchDir(chg, state, enemies) {
    const cc = CONFIG.CHARGED_BALL;
    const p = state.player;
    if (chg.moveDirT > -50 && (state.time - chg.moveDirT) <= cc.directionLockDuration) {
      return { x: chg.moveDirX, y: chg.moveDirY };
    }
    if (chg.moveDirT > -50) {
      return { x: chg.moveDirX, y: chg.moveDirY };
    }
    // 自动瞄准场内最近敌人（Lv.3 校准后偏差 ≤18°）
    let nearest = null, best = Infinity;
    const R2 = CONFIG.RICOCHET.BOUNDARY_RADIUS * CONFIG.RICOCHET.BOUNDARY_RADIUS;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      const dSq = Utils.distSq(e, p);
      if (dSq < R2 && dSq < best) { best = dSq; nearest = e; }
    }
    if (nearest) {
      const err = (state.genreLv >= 3 ? cc.autoAimErrorLv3 : cc.autoAimErrorBase);
      const ang = Utils.angle(p, nearest) + (Math.random() * 2 - 1) * err;
      return { x: Math.cos(ang), y: Math.sin(ang) };
    }
    // 环绕切线方向
    const tang = chg.orbitAng + (Math.PI / 2) * chg.orbitDir;
    return { x: Math.cos(tang), y: Math.sin(tang) };
  },

  // 发射蓄能球：Lv.6 → 雷核；Lv.7 → 雷霆闪电球；否则强化普通弹球
  _fireCharged(ball, state) {
    const cc = CONFIG.CHARGED_BALL;
    const chg = this._chg;
    const ang = Math.atan2(chg.launchY, chg.launchX);
    ball.state = 'normal';
    ball.chargedTag = true;
    ball.firstHitBonus = true;
    ball.overloadT = 0;
    ball.overloadHits = 0;
    ball.passIds.clear();
    ball.segPierce = 0;

    if (state.genreLv >= 7) {
      ball.state = 'thunderBall';
      ball.thunderHits = 0;
      ball.thunderT = CONFIG.THUNDER_BALL.hardLifetime;
      ball.thunderShrink = 0;
      ball.sourceType = 'thunder_ball';
      const sp = this._thunderSpeed(state, true);
      ball.vx = Math.cos(ang) * sp;
      ball.vy = Math.sin(ang) * sp;
      this._addFx('thunderBorn', ball.x, ball.y, ang, 0.35, '#7de3ff');
    } else if (state.genreLv >= 6) {
      ball.state = 'thunderCore';
      ball.thunderHits = 0;
      ball.thunderT = CONFIG.THUNDER_CORE.hardLifetime;
      ball.sourceType = 'thunder_core';
      const sp = this._thunderSpeed(state, false);
      ball.vx = Math.cos(ang) * sp;
      ball.vy = Math.sin(ang) * sp;
      this._addFx('thunderBorn', ball.x, ball.y, ang, 0.35, '#9d68ff');
    } else {
      const mult = (state.genreLv >= 3) ? cc.launchSpeedMultiplierLv3 : cc.launchSpeedMultiplier;
      const sp = this._ballSpeed(state) * mult;
      ball.vx = Math.cos(ang) * sp;
      ball.vy = Math.sin(ang) * sp;
      this._addFx('launchRift', ball.x, ball.y, ang, 0.3, '#b26bff');
    }
    // 轨道场发射反馈（纯视觉裂光）
    if (typeof OrbitField !== 'undefined') OrbitField.registerLaunch(ang);
  },

  // ── 召回路径（弯曲暗影拖尾；不造成伤害、不反弹）────────────────────────
  _updateRecall(ball, dt, state) {
    ball.recallT += dt;
    const k = Math.min(1, ball.recallT / ball.recallDur);
    const e = k * k * (3 - 2 * k);   // 平滑
    const p = state.player;
    const x0 = ball.recallFromX, y0 = ball.recallFromY;
    const cx = ball.recallCtrlX, cy = ball.recallCtrlY;
    const it = 1 - e;
    ball.x = it * it * x0 + 2 * it * e * cx + e * e * p.x;
    ball.y = it * it * y0 + 2 * it * e * cy + e * e * p.y;
    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > CONFIG.RICOCHET.TRAIL_LENGTH + 4) ball.trail.shift();
    if (k >= 1) {
      ball.state = 'charging';
      ball.vx = 0;
      ball.vy = 0;
    }
  },

  // ── 导电状态 ───────────────────────────────────────────────────────
  _tickConductive(ball, dt, state) {
    const c = ball.conductive;
    if (!c) return;
    if (c.remainingHits <= 0 || state.time >= c.expiresAt) {
      ball.conductive = null;
      this._addFx('spark', ball.x, ball.y, 0, 0.2, '#51d9ff');
    }
  },

  // 赋予 / 刷新导电（不叠倍率、不加次数；每个磁场每球只授予一次由调用方保证）
  _grantConductive(ball, state, sourceFieldId, cfg) {
    const dur = cfg.conductiveDuration != null ? cfg.conductiveDuration : cfg.ballConductiveDuration;
    const hits = cfg.conductiveHitLimit != null ? cfg.conductiveHitLimit : cfg.ballConductiveHitLimit;
    if (!ball.conductive) {
      ball.conductive = {
        expiresAt: state.time + dur,
        remainingHits: hits,
        sourceFieldId: sourceFieldId,
      };
      this._addFx('conductive', ball.x, ball.y, 0, 0.3, '#51d9ff');
    } else {
      // 只刷新时间，不叠倍率、不补次数
      ball.conductive.expiresAt = Math.max(ball.conductive.expiresAt, state.time + dur);
    }
  },

  // 普通球进入电磁场 → 导电（不吸附、不改方向、不触发蓄能）
  _checkFieldConduction(ball, state) {
    if (ball.state !== 'normal' && ball.state !== 'returning' && ball.state !== 'charging') return;
    if (ball.state === 'thunderBall' || ball.state === 'thunderCore') return;
    for (let i = 0; i < this.fields.length; i++) {
      const f = this.fields[i];
      const rSum = f.radius + ball.radius;
      const dx = ball.x - f.x, dy = ball.y - f.y;
      if (dx * dx + dy * dy <= rSum * rSum) {
        this._grantConductive(ball, state, f.id, CONFIG.MAGNETIC_FIELD);
        return;
      }
    }
  },

  // ── 移动 + 扫掠碰撞（CCD：最早碰撞优先，每帧有限反弹预算）────────────
  _moveBall(ball, dt, enemies, state) {
    const cfg = CONFIG.RICOCHET;
    const p = state.player;
    const isThunder = (ball.state === 'thunderCore' || ball.state === 'thunderBall');

    // 1) 回弹边界：位置校正 / 安全回收（不产特效、不计伤害）
    const dxp = ball.x - p.x, dyp = ball.y - p.y;
    let dist = Math.hypot(dxp, dyp) || 0.0001;
    const maxR = cfg.BOUNDARY_RADIUS - ball.radius;
    if (dist > maxR) {
      if (dist > maxR * 2) {
        const k = (maxR * 0.6) / dist;
        ball.x = p.x + dxp * k;
        ball.y = p.y + dyp * k;
        ball.safeRecall = 0.15;
        if (typeof OrbitField !== 'undefined' && !(ball._softFxT > 0)) {
          ball._softFxT = 0.25;
          OrbitField.registerSafeRecall(ball.x, ball.y);
        }
      } else {
        const k = maxR / dist;
        ball.x = p.x + dxp * k;
        ball.y = p.y + dyp * k;
        ball.bndLock = true;
        if (typeof OrbitField !== 'undefined' && !(ball._softFxT > 0)) {
          ball._softFxT = 0.25;
          OrbitField.registerSafeRecall(ball.x, ball.y);
        }
      }
      const nx = dxp / dist, ny = dyp / dist;
      const vn = ball.vx * nx + ball.vy * ny;
      if (vn > 0) {
        ball.vx -= 2 * vn * nx;
        ball.vy -= 2 * vn * ny;
      }
      dist = maxR;
    }
    if (ball.bndLock && dist < maxR - 8) ball.bndLock = false;

    // 2) 速度归一到目标速度
    let sp = isThunder ? this._thunderSpeed(state, ball.state === 'thunderBall') : this._ballSpeed(state);
    if (!isThunder && ball.boostTimer > 0) {
      sp *= ball.boostMult;
    }
    const cur = Math.hypot(ball.vx, ball.vy);
    if (cur > 0.01) {
      ball.vx = (ball.vx / cur) * sp;
      ball.vy = (ball.vy / cur) * sp;
    }

    // 3) CCD：沿剩余时间找最早碰撞，逐步结算（最多 BOUNCE_BUDGET 次）
    let rem = dt;
    let budget = cfg.BOUNCE_BUDGET;
    while (rem > 1e-6 && budget-- > 0) {
      const dx = ball.vx * rem, dy = ball.vy * rem;
      let bestT = 2, bestKind = RICOCHET_HIT.NONE, bestObj = null;

      // 地图边缘
      if (dx !== 0) {
        const wallX = dx > 0 ? (CONFIG.MAP_W - ball.radius) : ball.radius;
        const t = (wallX - ball.x) / dx;
        if (t >= 0 && t < bestT) { bestT = t; bestKind = RICOCHET_HIT.WALL; }
      }
      if (dy !== 0) {
        const wallY = dy > 0 ? (CONFIG.MAP_H - ball.radius) : ball.radius;
        const t = (wallY - ball.y) / dy;
        if (t >= 0 && t < bestT) { bestT = t; bestKind = RICOCHET_HIT.WALL; }
      }

      // 回弹边界圆（以玩家为中心）
      {
        const ox = ball.x - p.x, oy = ball.y - p.y;
        const a2 = dx * dx + dy * dy;
        if (a2 > 1e-12) {
          const b2 = 2 * (ox * dx + oy * dy);
          const c2 = ox * ox + oy * oy - maxR * maxR;
          const disc = b2 * b2 - 4 * a2 * c2;
          if (disc >= 0) {
            const t = (-b2 + Math.sqrt(disc)) / (2 * a2);
            if (t > 0 && t < bestT) { bestT = t; bestKind = RICOCHET_HIT.BOUNDARY; }
          }
        }
      }

      // 敌人（扫掠圆）
      if (enemies.length > 0 && this._grid) {
        const maxQ = ball.radius + 45 + Math.hypot(dx, dy) + 2;
        this._grid.query(ball.x, ball.y, maxQ, this._cand);
        for (let k = 0; k < this._cand.length; k++) {
          const e = enemies[this._cand[k]];
          if (!e.alive || ball.passIds.has(e.id)) continue;
          const bossMove = (e.type === 'boss') ? Math.hypot(e.vx || 0, e.vy || 0) * rem : 0;
          const R = ball.radius + e.radius + bossMove;
          const t = this._sweepCircle(ball.x, ball.y, dx, dy, e.x, e.y, R);
          if (t >= 0 && t < bestT) { bestT = t; bestKind = RICOCHET_HIT.ENEMY; bestObj = e; }
        }
      }

      // 磁极残核（静态圆）
      for (let k = 0; k < this.nodes.length; k++) {
        const node = this.nodes[k];
        const R = ball.radius + node.radius;
        const t = this._sweepCircle(ball.x, ball.y, dx, dy, node.x, node.y, R);
        if (t >= 0 && t < bestT) { bestT = t; bestKind = RICOCHET_HIT.NODE; bestObj = node; }
      }

      if (bestT > 1) {
        ball.x += dx;
        ball.y += dy;
        break;
      }

      // 推进到碰撞点
      ball.x += dx * bestT;
      ball.y += dy * bestT;
      rem -= rem * bestT;

      if (bestKind === RICOCHET_HIT.WALL) {
        const r = ball.radius;
        if (ball.vx < 0 && ball.x <= r + 0.01) {
          ball.vx = -ball.vx;
          ball.x = r + 0.5;
        } else if (ball.vx > 0 && ball.x >= CONFIG.MAP_W - r - 0.01) {
          ball.vx = -ball.vx;
          ball.x = CONFIG.MAP_W - r - 0.5;
        }
        if (ball.vy < 0 && ball.y <= r + 0.01) {
          ball.vy = -ball.vy;
          ball.y = r + 0.5;
        } else if (ball.vy > 0 && ball.y >= CONFIG.MAP_H - r - 0.01) {
          ball.vy = -ball.vy;
          ball.y = CONFIG.MAP_H - r - 0.5;
        }
        this._afterReflect(ball);
        this._addFx('spark', ball.x, ball.y, 0, 0.25, isThunder ? '#7de3ff' : '#8a4ad9');
      } else if (bestKind === RICOCHET_HIT.BOUNDARY) {
        this._onBoundaryHit(ball, p, state, isThunder);
      } else if (bestKind === RICOCHET_HIT.ENEMY) {
        const e = bestObj;
        const pierce = (p.bulletPierce > 0);
        const mult = (pierce && ball.segPierce === 1) ? cfg.PIERCE_SECOND_MULT : 1;
        if (isThunder) this._onThunderImpact(ball, e, state, mult);
        else this._onNormalImpact(ball, e, state, mult);
        // 雷霆爆炸 / 雷核结束（恢复普通态）后停止本帧扫掠
        if (ball.state === 'returning') break;
        if (pierce && ball.segPierce === 0) {
          // 贯穿段第 1 敌：正常伤害、不反弹；推过体外避免同帧重复判定
          ball.segPierce = 1;
          ball.passIds.add(e.id);
          const vs = Math.hypot(ball.vx, ball.vy) || 1;
          const R = ball.radius + e.radius;
          ball.x += (ball.vx / vs) * (R + 2);
          ball.y += (ball.vy / vs) * (R + 2);
          continue;
        }
        if (ball.state === 'returning') break;
        // 反弹：反射速度并推出体外
        let nx = ball.x - e.x, ny = ball.y - e.y;
        let nl = Math.hypot(nx, ny);
        if (nl < 1e-6) {
          const vlen = Math.hypot(ball.vx, ball.vy) || 1;
          nx = -ball.vx / vlen; ny = -ball.vy / vlen;
          nl = 1e-6;
        } else {
          nx /= nl; ny /= nl;
        }
        const vn = ball.vx * nx + ball.vy * ny;
        ball.vx -= 2 * vn * nx;
        ball.vy -= 2 * vn * ny;
        const R = ball.radius + e.radius;
        const push = (R + 0.5 > nl) ? (R + 0.5 - nl) : 0.5;
        ball.x += nx * push;
        ball.y += ny * push;
        this._afterReflect(ball);
        this._addFx('spark', ball.x, ball.y, 0, 0.25, isThunder ? '#7de3ff' : '#c97bff');
      } else if (bestKind === RICOCHET_HIT.NODE) {
        this._onNodeHit(ball, bestObj, state, isThunder);
      }
    }

    // 拖尾：固定长度缓冲
    const trail = ball.trail;
    trail.push({ x: ball.x, y: ball.y });
    if (trail.length > cfg.TRAIL_LENGTH + (isThunder ? 6 : 0)) trail.shift();
  },

  // 反弹后重置贯穿段状态
  _afterReflect(ball) {
    ball.segPierce = 0;
    ball.passIds.clear();
  },

  // 扫掠圆 vs 静态圆：返回 [0,1] 内最早碰撞参数 t，无碰撞返回 -1
  _sweepCircle(px, py, dx, dy, cx, cy, R) {
    const ox = px - cx, oy = py - cy;
    const a = dx * dx + dy * dy;
    if (a < 1e-12) return (ox * ox + oy * oy < R * R) ? 0 : -1;
    const cc = ox * ox + oy * oy - R * R;
    if (cc < 0) return 0;
    const b = 2 * (ox * dx + oy * dy);
    const disc = b * b - 4 * a * cc;
    if (disc < 0) return -1;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    return (t >= 0 && t <= 1) ? t : -1;
  },

  // ── 回弹边界真实碰撞（反弹 + 轨道场视觉；不计伤害、无元素充能）──────────
  _onBoundaryHit(ball, p, state, isThunder) {
    const cfg = CONFIG.RICOCHET;
    let nx = ball.x - p.x, ny = ball.y - p.y;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn > 0) {
      ball.vx -= 2 * vn * nx;
      ball.vy -= 2 * vn * ny;
    }
    const maxR = cfg.BOUNDARY_RADIUS - ball.radius;
    ball.x = p.x + nx * (maxR - 0.5);
    ball.y = p.y + ny * (maxR - 0.5);
    this._afterReflect(ball);

    this._addFx('barrier', ball.x, ball.y, Math.atan2(ny, nx), 0.25,
      isThunder ? '#7de3ff' : '#a259ff');
    this._addFx('spark', ball.x, ball.y, 0, 0.22, isThunder ? '#9fe8ff' : '#b26bff');

    // 暗影轨道场视觉反馈（纯视觉）
    ball.impactFlash = 0.18;
    if (typeof OrbitField !== 'undefined') OrbitField.registerImpact(ball.x, ball.y, nx, ny);
  },

  // ── 普通 / 蓄能弹球的敌人直接碰撞 ────────────────────────────────────
  _onNormalImpact(ball, enemy, state, dmgMult) {
    const cfg = CONFIG.RICOCHET;
    const p = state.player;
    const now = state.time;

    if (ball.safeRecall > 0) return false;

    // 同目标伤害保护
    const key = ball.id + '|' + enemy.id;
    const last = this._hitCd.get(key);
    if (last != null && (now - last) * 1000 < this._hitCdMs(state)) return false;

    // BOSS 共享血池保护
    if (enemy.type === 'boss') {
      const bKey = ball.id + '|bossPool';
      const bLast = this._bossPoolCd.get(bKey);
      if (bLast != null && (now - bLast) * 1000 < cfg.BOSS_POOL_CD_MS) return false;
      this._bossPoolCd.set(bKey, now);
    }
    this._hitCd.set(key, now);
    ball.lastHitTime = now;

    // 伤害实例标识
    const impactId = ++this._impactSeq;
    ball.impactId = impactId;
    ball.attackBatchId = impactId;
    ball.sourceType = ball.chargedTag ? 'charged_ball' : 'normal_ball';
    ball.targetId = enemy.id;
    ball.damageInstanceId = ball.id + ':' + impactId;

    // 伤害倍率：贯穿第二敌 / 蓄能首发 / 导电
    let mult = dmgMult || 1;
    let wasFirst = false;
    if (ball.firstHitBonus) {
      ball.firstHitBonus = false;
      wasFirst = true;
      mult *= CONFIG.CHARGED_BALL.firstHitDamageMultiplier;
    }
    if (ball.conductive) mult *= 1 + CONFIG.MAGNETIC_FIELD.conductiveDamageMultiplier;

    const baseDmg = p.effectiveDamage;
    let dmg = baseDmg * mult;
    let crit = false;
    const critChance = cfg.CRIT_CHANCE + (p.critChance || 0);
    if (Math.random() < critChance) {
      crit = true;
      dmg = Math.round(dmg * cfg.CRIT_MULT);
    }
    dmg = Math.round(dmg);

    // 直接碰撞：计入冰封有效命中（fromOwner 'player'）
    enemy.takeDamage(dmg, state, 'player');
    const sv = Utils.worldToScreen(enemy.x, enemy.y - 20, Renderer.cam);
    Utils.spawnDmgNum(sv.x, sv.y, dmg, enemy.type === 'boss' ? 'boss' : (crit ? 'crit' : ''));
    Particles.spawn(ball.x, ball.y, ball.chargedTag ? '#7de3ff' : '#c97bff', 5, 60, 0.4);

    // 导电碰撞：麻痹 + 局部电弧 + 消耗 1 次
    if (ball.conductive) {
      enemy.applyStun(CONFIG.MAGNETIC_FIELD.conductiveParalyzeDuration);
      ball.conductive.remainingHits--;
      this._conductiveArc(ball, enemy, baseDmg * mult, state,
        CONFIG.MAGNETIC_FIELD.conductiveArcRadius * p.skillRangeMult,
        CONFIG.MAGNETIC_FIELD.conductiveArcDamageMultiplier);
    }

    // Lv.4 过载电弧：蓄能球首次命中后进入过载；之后每次有效碰撞产生一次短电弧
    if (state.genreLv >= 4 && ball.chargedTag && ball.state === 'normal') {
      if (wasFirst) {
        ball.overloadT = CONFIG.OVERLOAD.overloadDuration;
        ball.overloadHits = 0;
      } else if (ball.overloadT > 0 && ball.overloadHits < CONFIG.OVERLOAD.overloadHitLimit) {
        ball.overloadHits++;
        enemy.applyStun(CONFIG.OVERLOAD.arcParalyzeDuration);
        this._overloadArc(ball, enemy, baseDmg * mult, state);
        if (ball.overloadHits >= CONFIG.OVERLOAD.overloadHitLimit) {
          ball.overloadT = 0;
        }
      }
    }

    // Lv.3 磁轨校准：蓄能球第一次有效碰撞产生一次小型方向脉冲（弹射流派生伤害）
    if (state.genreLv >= 3 && ball.chargedTag && wasFirst && ball.firstArcCd <= 0) {
      ball.firstArcCd = CONFIG.CHARGED_BALL.firstImpactArcCooldown;
      const rr = CONFIG.CHARGED_BALL.firstImpactArcRadius * p.skillRangeMult;
      this._addFx('arc', ball.x, ball.y, Math.atan2(ball.vy, ball.vx), 0.25, '#51d9ff', rr);
      this._aoeDamage(enemy.x, enemy.y, rr,
        baseDmg * CONFIG.CHARGED_BALL.firstImpactArcDamageMultiplier,
        state, 'ricochet_arc', false, enemy.id);
    }

    // Lv.5 磁场回流：蓄能 / 过载弹球的有效碰撞位置生成短暂磁场
    if (state.genreLv >= 5 && ball.chargedTag && ball.state === 'normal') {
      this._spawnField(enemy.x, enemy.y, state, false);
    }
    return true;
  },

  // ── 雷霆球 / 雷核的敌人直接碰撞（麻痹 + 碰撞预算）────────────────────
  _onThunderImpact(ball, enemy, state, dmgMult) {
    const cfgT = ball.state === 'thunderBall' ? CONFIG.THUNDER_BALL : CONFIG.THUNDER_CORE;
    const cfg = CONFIG.RICOCHET;
    const p = state.player;
    const now = state.time;

    if (ball.safeRecall > 0) return false;

    // 雷霆专用同目标保护（同一敌人保护间隔内不重复计数 / 不重复伤害）
    const key = 't' + ball.id + '|' + enemy.id;
    const last = this._hitCd.get(key);
    if (last != null && (now - last) * 1000 < cfgT.sameTargetCooldown * 1000) return false;

    if (enemy.type === 'boss') {
      const bKey = ball.id + '|bossPool';
      const bLast = this._bossPoolCd.get(bKey);
      if (bLast != null && (now - bLast) * 1000 < cfg.BOSS_POOL_CD_MS) return false;
      this._bossPoolCd.set(bKey, now);
    }
    this._hitCd.set(key, now);
    ball.lastHitTime = now;

    const impactId = ++this._impactSeq;
    ball.impactId = impactId;
    ball.attackBatchId = impactId;
    ball.sourceType = ball.state === 'thunderBall' ? 'thunder_ball' : 'thunder_core';
    ball.targetId = enemy.id;
    ball.damageInstanceId = ball.id + ':' + impactId;

    let mult = dmgMult || 1;
    if (ball.state === 'thunderBall') mult *= CONFIG.THUNDER_BALL.directDamageMultiplier;
    if (ball.firstHitBonus) {
      ball.firstHitBonus = false;
      mult *= CONFIG.CHARGED_BALL.firstHitDamageMultiplier;
    }

    const baseDmg = p.effectiveDamage;
    let dmg = Math.round(baseDmg * mult);
    let crit = false;
    const critChance = cfg.CRIT_CHANCE + (p.critChance || 0);
    if (Math.random() < critChance) {
      crit = true;
      dmg = Math.round(dmg * cfg.CRIT_MULT);
    }

    enemy.takeDamage(dmg, state, 'player');
    const sv = Utils.worldToScreen(enemy.x, enemy.y - 20, Renderer.cam);
    Utils.spawnDmgNum(sv.x, sv.y, dmg, enemy.type === 'boss' ? 'boss' : (crit ? 'crit' : ''));
    // 麻痹（直接碰撞附带）
    enemy.applyStun(cfgT.paralyzeDuration);
    Particles.spawn(ball.x, ball.y, '#7de3ff', 6, 80, 0.35);
    this._addFx('arc', ball.x, ball.y, Math.atan2(enemy.y - ball.y, enemy.x - ball.x),
      0.22, '#9fe8ff', 26);

    // 碰撞预算：只在有效敌人碰撞时减少
    ball.thunderHits++;
    const maxImpacts = ball.state === 'thunderBall'
      ? Math.min(CONFIG.THUNDER_BALL.maxImpactsLimit,
          Math.max(CONFIG.THUNDER_BALL.minImpacts, CONFIG.THUNDER_BALL.maxImpacts))
      : CONFIG.THUNDER_CORE.maxImpacts;
    if (ball.thunderHits >= maxImpacts) {
      if (ball.state === 'thunderBall') this._explodeThunderBall(ball, state);
      else this._endThunderCore(ball, state);
    }
    return true;
  },

  // ── 雷霆爆炸（瞬时伤害 + 电磁场）────────────────────────────────────
  _explodeThunderBall(ball, state) {
    const cfgT = CONFIG.THUNDER_BALL;
    const p = state.player;
    const radius = cfgT.explosionRadius * p.skillRangeMult;
    const baseDmg = p.effectiveDamage * cfgT.directDamageMultiplier;

    // 瞬时爆炸：一次性主要伤害（BOSS 共享血池只结算一次）
    this._aoeDamage(ball.x, ball.y, radius,
      baseDmg * cfgT.explosionDamageMultiplier, state, 'thunder_explosion');

    // 电磁场（快速扩散 + 持续 tick + 导电）
    this._spawnField(ball.x, ball.y, state, true);

    // 屏幕反馈（同帧合并；白闪 ≤0.08、震屏 ≤0.8）
    ThunderFeedback.request(0.08, 0.6);

    // 视觉：雷核压缩 → 爆发（蓝白核心 + 蓝紫电弧，无火焰）
    this._addFx('thunderBurst', ball.x, ball.y, 0, 0.3, '#dff8ff', radius);
    Particles.spawn(ball.x, ball.y, '#7de3ff', 10, 160, 0.5);
    Particles.spawn(ball.x, ball.y, '#9d68ff', 8, 120, 0.45);

    // 状态结束：恢复为普通弹球（不销毁、不新建，数量不变）
    this._restoreNormal(ball);
  },

  // ── 雷核结束（小型局部电弧，不产生最终磁场）──────────────────────────
  _endThunderCore(ball, state) {
    const cfgT = CONFIG.THUNDER_CORE;
    const p = state.player;
    // 小型局部电弧：附近一个敌人受派生伤害 + 麻痹
    let nearest = null, best = Infinity;
    const rr = CONFIG.OVERLOAD.arcRadius * p.skillRangeMult;
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (!e.alive) continue;
      const dSq = Utils.distSq(e, ball);
      if (dSq < rr * rr && dSq < best) { best = dSq; nearest = e; }
    }
    if (nearest) {
      const dmg = Math.round(p.effectiveDamage * cfgT.endArcDamageMultiplier);
      nearest.takeDamage(dmg, state, RICOCHET_DERIVED_OWNER);
      nearest.applyStun(cfgT.paralyzeDuration);
      const sv = Utils.worldToScreen(nearest.x, nearest.y - 20, Renderer.cam);
      Utils.spawnDmgNum(sv.x, sv.y, dmg);
      this._addFx('arc', ball.x, ball.y, Math.atan2(nearest.y - ball.y, nearest.x - ball.x),
        0.25, '#9fe8ff', rr);
    }
    this._restoreNormal(ball);
  },

  // 雷霆状态清理 → 恢复普通弹球（对象复用，数量不变）
  _restoreNormal(ball) {
    ball.state = 'returning';
    ball.returnT = 0.25;
    ball.thunderHits = 0;
    ball.thunderT = 0;
    ball.thunderShrink = 0;
    ball.sourceType = 'ricochet_direct';
    ball.chargedTag = false;
    ball.firstHitBonus = true;
    ball.overloadT = 0;
    ball.overloadHits = 0;
    ball.passIds.clear();
    ball.segPierce = 0;
  },

  // ── 导电 / 过载电弧（派生伤害：不暴击、不递归、不生成磁场）────────────
  _conductiveArc(ball, target, baseDmg, state, radius, mult) {
    let nearest = null, best = Infinity;
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (!e.alive || e.id === target.id) continue;
      const dSq = Utils.distSq(e, target);
      if (dSq < radius * radius && dSq < best) { best = dSq; nearest = e; }
    }
    if (!nearest) return;
    const dmg = Math.round(baseDmg * mult);
    nearest.takeDamage(dmg, state, RICOCHET_DERIVED_OWNER);
    const sv = Utils.worldToScreen(nearest.x, nearest.y - 20, Renderer.cam);
    Utils.spawnDmgNum(sv.x, sv.y, dmg);
    this._addFx('arc', target.x, target.y,
      Math.atan2(nearest.y - target.y, nearest.x - target.x), 0.22, '#7de3ff', radius);
    Particles.spawn(nearest.x, nearest.y, '#7de3ff', 3, 60, 0.3);
  },

  _overloadArc(ball, target, baseDmg, state) {
    const cfgO = CONFIG.OVERLOAD;
    const p = state.player;
    const radius = cfgO.arcRadius * p.skillRangeMult;
    let nearest = null, best = Infinity;
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (!e.alive || e.id === target.id) continue;
      // 同球同目标电弧限频
      const cdKey = 'o|' + ball.id + '|' + e.id;
      const last = this._arcCd.get(cdKey);
      if (last != null && (state.time - last) < cfgO.arcTargetCooldown) continue;
      const dSq = Utils.distSq(e, target);
      if (dSq < radius * radius && dSq < best) { best = dSq; nearest = e; }
    }
    if (!nearest) return;
    this._arcCd.set('o|' + ball.id + '|' + nearest.id, state.time);
    const dmg = Math.round(baseDmg * cfgO.arcDamageMultiplier);
    nearest.takeDamage(dmg, state, RICOCHET_DERIVED_OWNER);
    nearest.applyStun(cfgO.arcParalyzeDuration);
    const sv = Utils.worldToScreen(nearest.x, nearest.y - 20, Renderer.cam);
    Utils.spawnDmgNum(sv.x, sv.y, dmg);
    this._addFx('arc', target.x, target.y,
      Math.atan2(nearest.y - target.y, nearest.x - target.x), 0.22, '#9d68ff', radius);
    Particles.spawn(nearest.x, nearest.y, '#9fe8ff', 3, 60, 0.3);
  },

  // ── 电磁场（Lv.5 磁场回流 / Lv.7 雷霆爆炸）───────────────────────────
  _spawnField(x, y, state, fromThunder) {
    const cfgF = CONFIG.MAGNETIC_FIELD;
    const cfgT = CONFIG.THUNDER_BALL;
    const p = state.player;
    const maxActive = fromThunder ? cfgT.maxActiveFields : cfgF.maxActiveFields;
    if (this.fields.length >= maxActive) this.fields.shift();
    this.fields.push({
      id: this._fieldSeq++,
      x: x, y: y,
      radius: 0,
      maxRadius: (fromThunder ? cfgT.fieldRadius : cfgF.radius) * p.skillRangeMult,
      expandDur: fromThunder ? cfgT.fieldExpandDuration : cfgF.expandDuration,
      life: fromThunder ? cfgT.fieldDuration : cfgF.duration,
      t: 0,
      tickInterval: fromThunder ? cfgT.fieldTickInterval : cfgF.tickInterval,
      tickT: 0,
      tickIndex: 0,
      tickMult: fromThunder ? cfgT.fieldTickDamageMultiplier : cfgF.enemyTickDamageMultiplier,
      paralyze: fromThunder ? cfgT.conductiveParalyzeDuration : cfgF.conductiveParalyzeDuration,
      fromThunder: !!fromThunder,
    });
    this._addFx('fieldBorn', x, y, 0, 0.3, '#7de3ff',
      (fromThunder ? cfgT.fieldRadius : cfgF.radius) * p.skillRangeMult);
  },

  _updateFields(dt, state) {
    const p = state.player;
    for (let i = this.fields.length - 1; i >= 0; i--) {
      const f = this.fields[i];
      f.t += dt;
      if (f.t >= f.life) { this.fields.splice(i, 1); continue; }
      // 快速扩散
      if (f.t < f.expandDur) {
        f.radius = f.maxRadius * (f.t / f.expandDur);
      } else {
        f.radius = f.maxRadius;
      }
      // 低频持续伤害 tick（只对范围内敌人；不吸引、不改位置）
      f.tickT += dt;
      if (f.tickT >= f.tickInterval) {
        f.tickT -= f.tickInterval;
        f.tickIndex++;
        const dmg = Math.round(p.effectiveDamage * f.tickMult);
        let bossHit = false;
        for (let k = 0; k < state.enemies.length; k++) {
          const e = state.enemies[k];
          if (!e.alive) continue;
          const rSum = f.radius + e.radius;
          const dx = e.x - f.x, dy = e.y - f.y;
          if (dx * dx + dy * dy > rSum * rSum) continue;
          if (e.type === 'boss') {
            if (bossHit) continue; // 同一 tick 对 BOSS 共享血池只结算一次
            bossHit = true;
          }
          e.takeDamage(dmg, state, RICOCHET_DERIVED_OWNER);
          e.applyStun(f.paralyze);
          const sv = Utils.worldToScreen(e.x, e.y - 20, Renderer.cam);
          Utils.spawnDmgNum(sv.x, sv.y, dmg, e.type === 'boss' ? 'boss' : '');
          // 局部电弧向场内目标跳动（视觉）
          this._addFx('arc', f.x, f.y, Math.atan2(dy, dx), 0.18, '#7de3ff', f.radius * 0.6);
        }
      }
    }
  },

  // ── 磁极残核（死亡暗影适配；只与弹球交互）────────────────────────────
  spawnNode(x, y, enemy, state) {
    const cfgN = CONFIG.MAGNETIC_NODE;
    if (this.nodes.length >= cfgN.maxActiveNodes) {
      // 替换最旧的
      let idx = 0, bestT = Infinity;
      for (let i = 0; i < this.nodes.length; i++) {
        if (this.nodes[i].timer < bestT) { bestT = this.nodes[i].timer; idx = i; }
      }
      this.nodes.splice(idx, 1);
    }
    const frozen = !!(enemy && enemy.freezeTimer > 0 && (enemy.freezeSpeedMult || 1) <= 0.5);
    this.nodes.push({
      id: this._nodeSeq++,
      x: x, y: y,
      radius: cfgN.radius * (state ? state.player.skillRangeMult : 1),
      timer: cfgN.lifetime,
      uses: cfgN.maxActivationsPerNode,
      frozen: frozen,
      pulse: 0,
    });
    this._addFx('nodeBorn', x, y, 0, 0.35, frozen ? '#7de3ff' : '#9d68ff');
  },

  _updateNodes(dt, state) {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      n.timer -= dt;
      n.pulse += dt;
      if (n.timer <= 0) {
        this._addFx('spark', n.x, n.y, 0, 0.3, n.frozen ? '#7de3ff' : '#9d68ff');
        this.nodes.splice(i, 1);
      }
    }
  },

  // 磁极残核碰撞：反弹 + （普通球）加速/导电；不造成节点伤害、不消耗雷霆预算
  _onNodeHit(ball, node, state, isThunder) {
    const cfgN = CONFIG.MAGNETIC_NODE;
    // 反弹（不消耗任何预算）
    let nx = ball.x - node.x, ny = ball.y - node.y;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn > 0) {
      ball.vx -= 2 * vn * nx;
      ball.vy -= 2 * vn * ny;
    }
    const R = ball.radius + node.radius;
    ball.x = node.x + nx * (R + 0.5);
    ball.y = node.y + ny * (R + 0.5);
    this._afterReflect(ball);
    this._addFx('spark', ball.x, ball.y, 0, 0.25, node.frozen ? '#7de3ff' : '#9d68ff');

    // 消费条件：同球同节点限频 + 尚有激活次数
    const cdKey = ball.id + '|' + node.id;
    const last = this._nodeCd.get(cdKey);
    if (last != null && (state.time - last) * 1000 < cfgN.activateCdMs) return;

    if (isThunder) {
      // 雷霆球：不加碰撞预算、不重置状态；剩余次数让附近普通球获得导电
      this._addFx('arc', node.x, node.y, Math.atan2(ny, nx), 0.25, '#7de3ff', 40);
      if (node.uses > 0) {
        let nearest = null, best = Infinity;
        for (let i = 0; i < this.balls.length; i++) {
          const b = this.balls[i];
          if (b.state !== 'normal' || b.spawning) continue;
          const dSq = Utils.distSq(b, node);
          if (dSq < 22500 && dSq < best) { best = dSq; nearest = b; }
        }
        if (nearest) {
          this._nodeCd.set(cdKey, state.time);
          node.uses--;
          this._grantConductive(nearest, state, 'node' + node.id, CONFIG.MAGNETIC_NODE);
        }
      }
      return;
    }

    if (node.uses <= 0) return;
    this._nodeCd.set(cdKey, state.time);
    node.uses--;
    // 普通球：速度 +20%（1.5s）+ 导电 2s
    ball.boostTimer = cfgN.speedDuration;
    ball.boostMult = cfgN.ballSpeedMultiplier;
    this._grantConductive(ball, state, 'node' + node.id, cfgN);
    this._addFx('nodeHit', node.x, node.y, Math.atan2(ny, nx), 0.35,
      node.frozen ? '#7de3ff' : '#b26bff');
    if (node.uses <= 0) {
      const idx = this.nodes.indexOf(node);
      if (idx >= 0) this.nodes.splice(idx, 1);
    }
  },

  // 范围派生伤害：不暴击、不递归；BOSS 共享血池同次只结算一次
  _aoePt: { x: 0, y: 0 },
  _aoeDamage(x, y, radius, dmg, state, sourceType, isSlow, excludeId) {
    const round = Math.round(dmg);
    let bossHit = false;
    this._aoePt.x = x;
    this._aoePt.y = y;
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (!e.alive) continue;
      if (excludeId != null && e.id === excludeId) continue;
      const rSum = radius + e.radius;
      if (Utils.distSq(e, this._aoePt) > rSum * rSum) continue;
      if (e.type === 'boss') {
        if (bossHit) continue;
        bossHit = true;
      }
      e.takeDamage(round, state, RICOCHET_DERIVED_OWNER);
      const sv = Utils.worldToScreen(e.x, e.y - 20, Renderer.cam);
      Utils.spawnDmgNum(sv.x, sv.y, round, e.type === 'boss' ? 'boss' : '');
    }
    Particles.spawn(x, y, '#7de3ff', 8, 110, 0.45);
  },

  // ── 暗影连线适配：玩家 ↔ 最近 3 个有效弹球（蓄能球暂时退出连线）──────
  linkBalls(player) {
    const out = [];
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i];
      if (b.spawning) continue;
      if (b.state === 'recalling' || b.state === 'charging' || b.state === 'aiming') continue;
      out.push(b);
    }
    if (out.length <= CONFIG.RICOCHET.LINK_MAX) return out;
    const p = player || Player;
    out.sort((a, b) => Utils.distSq(a, p) - Utils.distSq(b, p));
    out.length = CONFIG.RICOCHET.LINK_MAX;
    return out;
  },

  // ── 特效（限频：同帧合并、限制同时数量）────────────────────────────────
  _addFx(kind, x, y, ang, life, color, radius) {
    if (this._fxBudget <= 0 && kind !== 'thunderBurst' && kind !== 'fieldBorn') return;
    this._fxBudget--;
    if (this.fx.length >= RICOCHET_FX_MAX) this.fx.shift();
    this.fx.push({
      kind, x, y,
      ang: ang || 0,
      life, maxLife: life,
      color: color || '#c97bff',
      radius: radius || 0,
    });
  },

  updateFx(dt) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.life -= dt;
      if (f.life <= 0) this.fx.splice(i, 1);
    }
  },

  _prune(now) {
    const ttl = 2;
    for (const [k, v] of this._hitCd) if (now - v > ttl) this._hitCd.delete(k);
    for (const [k, v] of this._bossPoolCd) if (now - v > ttl) this._bossPoolCd.delete(k);
    for (const [k, v] of this._nodeCd) if (now - v > ttl) this._nodeCd.delete(k);
    for (const [k, v] of this._arcCd) if (now - v > ttl) this._arcCd.delete(k);
  },
};

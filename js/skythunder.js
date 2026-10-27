// ─── SKY THUNDER（引雷 · 公共机制卡「引雷」）────────────────────────────────
// 与流派 1 的漩涡电（VortexManager.lightnings / Renderer.drawVortexLightning）
// 完全分离的机制与视觉语言：
//   引雷   = 天空、垂直、巨大雷柱、落点、持续雷区、麻痹（本文件）
//   漩涡电 = 局部、随机、围绕漩涡、短促细小放电（vortex.js，保持原样）
//
// 战斗流程（每 4 秒一次）：
//   锁定主目标 → 天空预兆(350ms) → 天雷落地(140ms) → 持续雷区(1200ms) → 消散(300ms)
//   落地一次性伤害 + 雷区 tick 伤害/麻痹（最多 2 个落点，第二落点较弱）

// ─── 数值配置（所有倍率集中在此，禁止散落魔法数字）────────────────────────
const SKY_THUNDER_CONFIG = {
  cooldown: 4000,            // 触发间隔（ms）
  searchRadius: 900,         // 首个目标搜索范围（px，相对玩家）
  maxTargets: 2,             // 一次引雷最多落雷目标数（主 + 次）
  chainRadius: 160,          // 第二目标搜索范围（px，相对主目标）

  strikeRadius: 120,         // 主落雷半径（px）
  secondaryStrikeRadius: 90, // 第二目标落雷半径（px）

  damagePerTarget: 45,       // 主落雷初始伤害（每个目标 45，保持原公共闪电语义）
  secondaryDamageMultiplier: 0.75, // 第二目标初始伤害倍率（45 × 0.75 = 33.75）

  warningDuration: 350,      // 天空预兆时长（ms）
  strikeDuration: 140,       // 天雷落地时长（ms）
  zoneDuration: 1200,        // 持续雷区时长（ms）
  fadeDuration: 300,         // 雷区消散时长（ms）

  tickInterval: 300,         // 雷区 tick 间隔（ms）
  tickDamage: 5,             // 雷区单次 tick 伤害

  paralyzeDuration: 140,             // 麻痹持续（ms，只刷新不叠加）
  paralyzeRefreshInterval: 300,      // 麻痹刷新间隔（ms，单雷区/全局均生效）

  maxActiveZones: 6,         // 同时存在的雷区上限
};

// ─── 屏幕反馈限制（引雷不得压过白蚀爆裂）──────────────────────────────────
const SKY_THUNDER_FEEDBACK = {
  strikeFlashAlpha: 0.05,    // 落地闪光透明度上限（≤ 0.06）
  strikeFlashDuration: 45,   // 落地闪光时长（ms）
  strikeCameraShake: 0.35,   // 落地震屏强度上限
  tickFlashAlpha: 0,         // 雷区 tick 不闪屏
  tickCameraShake: 0,        // 雷区 tick 不震屏
  priority: 1,               // 反馈优先级（白蚀爆裂最高）
};

// ─── 因果残响兼容规则（防雷区 tick 无限刷因果节点）────────────────────────
const CAUSAL_LIGHTNING_RULES = {
  strikeCreatesNode: true,             // 雷柱落地可创建闪电节点
  tickCanCreateNode: false,            // 雷区 tick 绝不创建节点
  contributionInterval: 600,           // tick 因果贡献最小间隔（ms）
  maxContributionsPerZone: 3,          // 每枚雷区最多因果贡献次数
  sameZoneSameNodeCooldown: 1000,      // 同一雷区对同一节点的贡献间隔（ms）
  sameTargetLightningEventCooldown: 500, // 同一目标事件（PARALYZE）冷却（ms）
  paralyzeCountsAsControl: true,       // 麻痹计入 CONTROL/PARALYZE
  paralyzeCountsAsLightning: false,    // 麻痹绝不同时计作 LIGHTNING
  zoneEndCreatesEvent: false,          // 雷区结束不产生因果事件
};

// 引雷内部事件（内部 ID 保留英文，降低迁移风险；用户可见名称为「引雷」）
const SKY_THUNDER_EVENT = {
  STRIKE: 'LIGHTNING_STRIKE',        // 主雷柱落地
  ZONE_START: 'LIGHTNING_ZONE_START', // 雷区开始
  TICK: 'LIGHTNING_TICK',            // 雷区持续伤害 tick
  PARALYZE: 'PARALYZE',              // 雷区施加麻痹
  ZONE_END: 'LIGHTNING_ZONE_END',    // 雷区结束
};

const SkyThunderManager = {
  zones: [],    // 活跃雷区（warning → strike → active → fade）
  scorch: [],   // 地面焦痕残留（纯视觉）
  flash: 0,     // 屏幕闪光（≤ strikeFlashAlpha）
  shake: 0,     // 震屏强度（≤ strikeCameraShake，快速衰减）

  _nextId: 1,
  _hitThisFrame: new Set(),  // 同一敌人同一帧最多接受一次引雷伤害
  _paraGlobal: new Map(),    // 全局麻痹刷新记录（防多雷区永久麻痹）
  _paraEventCd: new Map(),   // 同目标 PARALYZE 事件冷却
  _mergeBuf: [],             // 渲染合并缓冲（45px 内雷区合并视觉）
  _enBuf: [],                // 敌人快照缓冲

  // ── 生成引雷（PublicLightningManager 每 4 秒调用一次）────────────────────
  spawnSkyThunderStrike(state) {
    if (!state || !state.player) return;
    const cfg = SKY_THUNDER_CONFIG;
    const p = state.player;
    const enemies = EnemyManager.getAlive();

    // 主目标：900px 范围内离玩家最近的敌人
    let target = null, bestD = cfg.searchRadius * cfg.searchRadius;
    for (const e of enemies) {
      const dSq = Utils.distSq(e, p);
      if (dSq < bestD) { bestD = dSq; target = e; }
    }
    if (!target) return;

    // 技能范围加成（BUFF「技能范围」：范围类效果半径增大）
    const rangeMult = (state.genre === 3) ? EchoManager.skillRangeMult(state) : 1;

    // 第二目标：主目标 160px 范围内最近的另一个敌人（绝不找第三、第四个）
    let extra = null, extraD = cfg.chainRadius * cfg.chainRadius;
    for (const e of enemies) {
      if (e === target) continue;
      const dSq = Utils.distSq(e, target);
      if (dSq < extraD) { extraD = dSq; extra = e; }
    }

    // 主落雷（锁定主目标当前位置，预警期间不追踪）
    this._pushZone(target.x, target.y, cfg.strikeRadius * rangeMult,
      cfg.damagePerTarget, 1, state);
    // 第二落雷（较弱）
    if (extra && cfg.maxTargets >= 2) {
      this._pushZone(extra.x, extra.y, cfg.secondaryStrikeRadius * rangeMult,
        cfg.damagePerTarget * cfg.secondaryDamageMultiplier, 0.8, state);
    }
  },

  _pushZone(x, y, radius, damage, visualScale, state) {
    const cfg = SKY_THUNDER_CONFIG;
    // 超出上限：优先回收剩余时间最短的雷区
    while (this.zones.length >= cfg.maxActiveZones) {
      let worst = 0, worstRemain = Infinity;
      for (let i = 0; i < this.zones.length; i++) {
        const r = this._remain(this.zones[i]);
        if (r < worstRemain) { worstRemain = r; worst = i; }
      }
      this.zones.splice(worst, 1);
    }
    const seed = Math.random() * 1000;
    const z = {
      id: this._nextId++,
      x, y,
      radius,
      damage,
      visualScale,
      state: 'warning',
      createdAt: state.time,
      elapsed: 0,
      duration: cfg.warningDuration / 1000,
      source: 'mechanic',
      sourceEntityId: -1,
      chainId: this._nextId,
      reactionDepth: 0,
      tickTimer: 0,
      tickIndex: 0,
      causalContributionTimer: 0,
      causalContributionCount: 0,
      contributedNodes: new Map(),
      affectedTargets: new Set(),
      paralyzeTargets: new Map(),
      consumed: false,
      // 视觉
      seed,
      bolt: null,
      branches: null,
      boltTimer: 0,
      struck: false,
      impactT: 1,
      tickFlash: 0,
      miniT: 0.3 + Math.random() * 0.3,
      miniLife: 0,
    };
    this._genBolt(z);
    this.zones.push(z);
  },

  // ── 统一 update（暂停时不被调用 → 计时自然停止）──────────────────────────
  updateSkyThunderStrikes(dt, state) {
    const tickSec = SKY_THUNDER_CONFIG.tickInterval / 1000;
    // 同帧伤害限制每帧清零
    this._hitThisFrame.clear();
    // 屏幕反馈衰减（同一帧最多一次屏幕级反馈：flash 取最大值合并）
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * (0.05 / (SKY_THUNDER_FEEDBACK.strikeFlashDuration / 1000)));
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 4);

    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.elapsed += dt;
      if (z.elapsed >= z.duration) {
        this._advancePhase(z, state);
        if (z.consumed) { this.zones.splice(i, 1); continue; }
      }
      const t = (z.duration > 0) ? z.elapsed / z.duration : 1;

      if (z.state === 'warning') {
        // 预警：不伤害、不麻痹、不触发因果；仅视觉蓄力
      } else if (z.state === 'strike') {
        // 雷柱分叉随下降变化（每 45ms 重生成折线）
        z.boltTimer -= dt;
        if (z.boltTimer <= 0) { z.boltTimer = 0.045; this._genBolt(z); }
        // 落地瞬间：一次性初始伤害 + 屏幕反馈 + 因果 STRIKE（只结算一次）
        if (!z.struck && t >= 0.55) {
          z.struck = true;
          z.impactT = 0;
          this.emitSkyThunderEvent(z, SKY_THUNDER_EVENT.STRIKE, null, state);
          this._strikeImpact(z, state);
        }
        if (z.impactT < 1) z.impactT = Math.min(1, z.impactT + dt / 0.25);
      } else if (z.state === 'active') {
        // 雷区 tick：伤害 + 麻痹（tickInterval 一次）
        z.tickTimer += dt;
        if (z.tickTimer >= tickSec) {
          z.tickTimer -= tickSec;
          z.tickIndex++;
          this._zoneTick(z, state);
        }
        // 上窜小雷柱节奏
        z.miniT -= dt;
        if (z.miniT <= 0) { z.miniT = 0.35 + Math.random() * 0.35; z.miniLife = 0.09; }
        if (z.miniLife > 0) z.miniLife -= dt;
        if (z.tickFlash > 0) z.tickFlash = Math.max(0, z.tickFlash - dt * 6);
      } else if (z.state === 'fade') {
        // 消散：不再造成伤害
      }
    }

    // 焦痕残留衰减
    for (let i = this.scorch.length - 1; i >= 0; i--) {
      this.scorch[i].life -= dt;
      if (this.scorch[i].life <= 0) this.scorch.splice(i, 1);
    }
  },

  // 相位切换：warning → strike → active → fade → 结束
  _advancePhase(z, state) {
    const cfg = SKY_THUNDER_CONFIG;
    z.elapsed = 0;
    if (z.state === 'warning') {
      z.state = 'strike';
      z.duration = cfg.strikeDuration / 1000;
      this._genBolt(z);
    } else if (z.state === 'strike') {
      // 保险：若落地伤害未结算（极短帧等），在此补结算
      if (!z.struck) {
        z.struck = true;
        z.impactT = 0;
        this.emitSkyThunderEvent(z, SKY_THUNDER_EVENT.STRIKE, null, state);
        this._strikeImpact(z, state);
      }
      z.state = 'active';
      z.duration = cfg.zoneDuration / 1000;
      this.emitSkyThunderEvent(z, SKY_THUNDER_EVENT.ZONE_START, null, state);
    } else if (z.state === 'active') {
      z.state = 'fade';
      z.duration = cfg.fadeDuration / 1000;
      this.emitSkyThunderEvent(z, SKY_THUNDER_EVENT.ZONE_END, null, state);
    } else {
      // fade 结束：留下短暂焦痕后回收
      z.consumed = true;
      if (this.scorch.length < 16) {
        this.scorch.push({ x: z.x, y: z.y, radius: z.radius, life: 0.5, maxLife: 0.5 });
      }
    }
  },

  // 剩余存活时间（用于 maxActiveZones 淘汰：回收剩余时间最短者）
  _remain(z) {
    const cfg = SKY_THUNDER_CONFIG;
    const phaseLeft = Math.max(0, z.duration - z.elapsed);
    if (z.state === 'warning') return phaseLeft + (cfg.strikeDuration + cfg.zoneDuration + cfg.fadeDuration) / 1000;
    if (z.state === 'strike')  return phaseLeft + (cfg.zoneDuration + cfg.fadeDuration) / 1000;
    if (z.state === 'active')  return phaseLeft + cfg.fadeDuration / 1000;
    return phaseLeft;
  },

  // ── 天雷落地：一次性初始伤害（区域内目标，绝不因动画多帧重复结算）────────
  _strikeImpact(z, state) {
    const cfg = SKY_THUNDER_CONFIG;
    const enemies = EnemyManager.getAlive();
    const rr = z.radius * z.radius;
    for (const e of enemies) {
      if (!e.alive) continue;
      if (Utils.distSq(e, z) > rr) continue;
      z.affectedTargets.add(e.id);
      this.applySkyThunderDamage(z, e, state);
    }
    // 屏幕反馈（同帧多次落地合并为一次；强度低于白蚀爆裂）
    this.flash = Math.max(this.flash, SKY_THUNDER_FEEDBACK.strikeFlashAlpha);
    this.shake = Math.max(this.shake, SKY_THUNDER_FEEDBACK.strikeCameraShake);
    // 落地粒子（少量，不喧宾夺主）
    Particles.spawn(z.x, z.y, '#bfe6ff', 10, 150, 0.4);
    Particles.spawn(z.x, z.y, '#7df9ff', 6, 110, 0.5);
  },

  // ── 雷区 tick：轻微伤害 + 麻痹（渲染层绝不调用）──────────────────────────
  _zoneTick(z, state) {
    z.tickFlash = 0.6;
    // 1) 因果贡献在伤害之前执行：
    //    新生成的死亡回响节点不会被产生它的同一 tick 立即重复填充
    z.causalContributionTimer += SKY_THUNDER_CONFIG.tickInterval / 1000;
    if (z.causalContributionTimer * 1000 >= CAUSAL_LIGHTNING_RULES.contributionInterval &&
        z.causalContributionCount < CAUSAL_LIGHTNING_RULES.maxContributionsPerZone) {
      z.causalContributionTimer = 0;
      z.causalContributionCount++;
      this.emitSkyThunderEvent(z, SKY_THUNDER_EVENT.TICK, null, state);
    }
    // 2) 收集区域内敌人（快照）
    const enemies = EnemyManager.getAlive();
    const list = this._enBuf;
    list.length = 0;
    const rr = z.radius * z.radius;
    for (const e of enemies) {
      if (!e.alive) continue;
      if (Utils.distSq(e, z) <= rr) list.push(e);
    }
    // 3) 麻痹（含 PARALYZE 事件）→ 4) tick 伤害
    for (const e of list) this.applySkyThunderParalyze(z, e, state);
    for (const e of list) this.applySkyThunderDamage(z, e, state);
  },

  // ── 伤害入口（走 enemy.takeDamage：含减伤 / BOSS 共享血池 / 真实死亡）────
  applySkyThunderDamage(zone, enemy, state) {
    if (!enemy.alive) return;
    // 同一敌人同一帧最多接受一次引雷伤害
    if (this._hitThisFrame.has(enemy.id)) return;
    this._hitThisFrame.add(enemy.id);
    const dmg = zone.damage;
    enemy.takeDamage(dmg, state, 'player');
    const sv = Utils.worldToScreen(enemy.x, enemy.y - 20, Renderer.cam);
    Utils.spawnDmgNum(sv.x, sv.y, dmg, enemy.type === 'boss' ? 'boss' : '');
  },

  // ── 麻痹入口（刷新不叠加；全局限频防多雷区永久麻痹）──────────────────────
  applySkyThunderParalyze(zone, enemy, state) {
    const cfg = SKY_THUNDER_CONFIG;
    const now = state.time;
    // 同一雷区对同一敌人：refreshInterval 内不重复
    const lastZone = zone.paralyzeTargets.get(enemy.id);
    if (lastZone != null && (now - lastZone) * 1000 < cfg.paralyzeRefreshInterval) return;
    zone.paralyzeTargets.set(enemy.id, now);
    // 全局刷新间隔：多个雷区叠加也不会把敌人永久钉住
    const lastGlobal = this._paraGlobal.get(enemy.id);
    if (lastGlobal != null && (now - lastGlobal) * 1000 < cfg.paralyzeRefreshInterval) return;
    this._paraGlobal.set(enemy.id, now);
    // 复用现有控制入口：applyStun 只刷新剩余时间，绝不叠加、不覆盖速度字段
    enemy.applyStun(cfg.paralyzeDuration / 1000);
    // 因果：PARALYZE 事件（CONTROL/PARALYZE 类，不计 LIGHTNING、不创建节点）
    const lastEvt = this._paraEventCd.get(enemy.id);
    if (lastEvt == null ||
        (now - lastEvt) * 1000 >= CAUSAL_LIGHTNING_RULES.sameTargetLightningEventCooldown) {
      this._paraEventCd.set(enemy.id, now);
      this.emitSkyThunderEvent(zone, SKY_THUNDER_EVENT.PARALYZE, { x: enemy.x, y: enemy.y, target: enemy }, state);
    }
  },

  // ── 因果残响事件分发（仅流派 3；tick 不创建节点、ZONE_END 无事件）────────
  emitSkyThunderEvent(zone, type, context, state) {
    if (!state || state.genre !== 3) return;
    if (type === SKY_THUNDER_EVENT.STRIKE) {
      // 雷柱落地 → 落点生成一个闪电因果节点（LIGHTNING 标签只记一次）
      if (CAUSAL_LIGHTNING_RULES.strikeCreatesNode) {
        EchoManager.onSkyThunderStrike(zone.x, zone.y, zone.damage, state);
      }
    } else if (type === SKY_THUNDER_EVENT.TICK) {
      // 雷区 tick → 有限度推进附近已有节点（节奏由调用方预算控制）
      if (!CAUSAL_LIGHTNING_RULES.tickCanCreateNode) {
        EchoManager.onSkyThunderZoneTick(zone.x, zone.y, zone.radius, state, zone.contributedNodes);
      }
    } else if (type === SKY_THUNDER_EVENT.PARALYZE) {
      // 麻痹 → CONTROL/PARALYZE 事件（不创建完整因果节点）
      if (context && context.target) {
        EchoManager.onSkyThunderParalyze(context.x, context.y, context.target, state);
      }
    }
    // ZONE_START / ZONE_END：仅内部记账（zoneEndCreatesEvent: false）
  },

  // ── 渲染（渲染层绝不造成伤害；ground 在敌人之下 / air 在敌人之上）────────
  renderSkyThunderStrikes(ctx, cam, state, pass) {
    if (pass === 'ground') {
      if (this.zones.length === 0 && this.scorch.length === 0) return;
      this._renderGround(ctx, cam, state ? state.time : 0);
    } else {
      if (this.zones.length === 0 && this.flash <= 0.001) return;
      this._renderAir(ctx, cam, state ? state.time : 0);
    }
  },

  // ── 地面层：焦痕 / 预警圈 / 雷区边界 / 上窜小雷 / 敌人周围电弧 ────────────
  _renderGround(ctx, cam, time) {
    const merge = this._mergeBuf;
    merge.length = 0;

    // 焦痕（最底层残留）
    for (const s of this.scorch) {
      const sv = Utils.worldToScreen(s.x, s.y, cam);
      const a = 0.22 * (s.life / s.maxLife);
      Renderer._drawGlow(sv.x, sv.y, s.radius * 0.7, '#2b5cff', a);
    }

    for (const z of this.zones) {
      const sv = Utils.worldToScreen(z.x, z.y, cam);
      if (!Utils.isOnScreen(z.x, z.y, cam, z.radius + 60)) continue;
      const t = (z.duration > 0) ? Math.min(1, z.elapsed / z.duration) : 1;

      // 45px 内雷区合并视觉：只画一枚边界环，伤害互不影响
      let merged = false;
      for (let i = 0; i < merge.length; i += 2) {
        const dx = merge[i] - sv.x, dy = merge[i + 1] - sv.y;
        if (dx * dx + dy * dy < 45 * 45) { merged = true; break; }
      }

      if (z.state === 'warning') {
        this._drawWarnRing(ctx, sv, z, t, merged);
      } else if (z.state === 'strike') {
        this._drawGroundImpact(ctx, sv, z, t, merged);
      } else if (z.state === 'active') {
        if (!merged) merge.push(sv.x, sv.y);
        this._drawZoneGround(ctx, sv, z, t, merged);
      } else if (z.state === 'fade') {
        if (!merged) merge.push(sv.x, sv.y);
        this._drawZoneFade(ctx, sv, z, t, merged);
      }
    }
  },

  // 阶段 1：地面预警（断裂圆弧 + 不规则电纹，逐渐变亮；不造成伤害）
  _drawWarnRing(ctx, sv, z, t, merged) {
    const r = z.radius * (0.86 + 0.14 * t);
    ctx.save();
    if (!merged) {
      // 断裂圆弧（4 段弧 + 缺口）
      ctx.lineCap = 'round';
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#6ab8ff';
      ctx.globalAlpha = 0.18 + 0.5 * t;
      for (let k = 0; k < 4; k++) {
        const a0 = z.seed + k * (Math.PI / 2) + t * 0.4;
        ctx.beginPath();
        ctx.arc(sv.x, sv.y, r, a0, a0 + Math.PI / 2 * 0.72);
        ctx.stroke();
      }
      // 不规则电纹（沿环的短锯齿）
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#9fd8ff';
      ctx.globalAlpha = 0.12 + 0.35 * t;
      for (let k = 0; k < 8; k++) {
        const a = z.seed * 1.7 + k * (Math.PI / 4) + timeJitter(z, k);
        const jr = r + Utils.rand(-6, 6);
        const x0 = sv.x + Math.cos(a) * jr, y0 = sv.y + Math.sin(a) * jr;
        const x1 = x0 + Utils.rand(-10, 10), y1 = y0 + Utils.rand(-10, 10);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    }
    // 地面蓄力光
    Renderer._drawGlow(sv.x, sv.y, r * 0.9, '#4aa8ff', 0.05 + 0.14 * t);
    ctx.restore();

    function timeJitter(z, k) {
      return Math.sin(z.seed + k * 2.1 + z.elapsed * 24) * 0.12;
    }
  },

  // 阶段 2：落地冲击（裂光 + 冲击波环 + 飞溅电弧）
  _drawGroundImpact(ctx, sv, z, t, merged) {
    const dec = 1 - t;
    ctx.save();
    // 地面裂光（不规则放射）
    const cracks = 7;
    ctx.lineCap = 'round';
    for (let k = 0; k < cracks; k++) {
      const a = z.seed * 2.3 + k * (Math.PI * 2 / cracks);
      const len = z.radius * (0.55 + 0.5 * ((k * 37 % 10) / 10));
      ctx.strokeStyle = (k % 2 === 0) ? '#dff4ff' : '#6ab8ff';
      ctx.globalAlpha = 0.55 * dec;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      let px = sv.x, py = sv.y;
      const segs = 3;
      for (let s = 1; s <= segs; s++) {
        const rr = len * s / segs;
        px = sv.x + Math.cos(a + Math.sin(z.seed + k + s) * 0.25) * rr;
        py = sv.y + Math.sin(a + Math.sin(z.seed + k + s) * 0.25) * rr;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    // 冲击波细环（快速扩张）
    if (!merged && t < 0.8) {
      const rr = z.radius * (0.5 + t * 0.85);
      ctx.globalAlpha = 0.5 * (1 - t);
      ctx.strokeStyle = '#bfe6ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sv.x, sv.y, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    // 白蓝落地闪光（局部，不遮挡敌人）
    Renderer._drawGlow(sv.x, sv.y, z.radius * 1.15, '#cfe8ff', 0.5 * dec * (1 - z.impactT));
  },

  // 阶段 3：持续雷区（断裂电弧边界 / 边缘跳跃 / tick 闪烁 / 上窜小雷 / 敌人电弧）
  _drawZoneGround(ctx, sv, z, t, merged) {
    ctx.save();
    if (!merged) {
      // 断裂电弧边界（不使用漩涡圆盘、不旋转吸附）
      ctx.lineCap = 'round';
      ctx.lineWidth = 2;
      for (let k = 0; k < 6; k++) {
        const a0 = z.seed * 1.3 + k * (Math.PI / 3) + t * 0.25;
        ctx.strokeStyle = (k % 2 === 0) ? '#7df9ff' : '#4aa8ff';
        ctx.globalAlpha = 0.34;
        ctx.beginPath();
        ctx.arc(sv.x, sv.y, z.radius, a0, a0 + Math.PI / 3 * 0.55);
        ctx.stroke();
      }
      // 边缘低频电弧跳跃（短锯齿）
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#9fd8ff';
      ctx.globalAlpha = 0.3;
      for (let k = 0; k < 3; k++) {
        const a = z.seed + k * 2.1 + t * 3.2;
        const x0 = sv.x + Math.cos(a) * z.radius, y0 = sv.y + Math.sin(a) * z.radius;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + Utils.rand(-12, 12), y0 + Utils.rand(-12, 12));
        ctx.lineTo(x0 + Utils.rand(-16, 16), y0 + Utils.rand(-16, 16));
        ctx.stroke();
      }
    }
    // tick 局部闪烁（不做全屏白闪）
    if (z.tickFlash > 0.01) {
      Renderer._drawGlow(sv.x, sv.y, z.radius * 0.6, '#8fd0ff', 0.22 * z.tickFlash);
    }
    // 中心偶尔上窜短雷柱
    if (z.miniLife > 0) {
      const mh = 34 + (z.id * 13 % 26);
      ctx.globalAlpha = 0.75 * (z.miniLife / 0.09);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#dff4ff';
      ctx.beginPath();
      ctx.moveTo(sv.x, sv.y);
      for (let s = 1; s <= 3; s++) {
        ctx.lineTo(sv.x + Utils.rand(-7, 7), sv.y - mh * s / 3);
      }
      ctx.stroke();
      ctx.lineWidth = 7;
      ctx.strokeStyle = 'rgba(110,180,255,0.35)';
      ctx.stroke();
    }
    ctx.restore();

    // 区域内敌人周围短促电弧
    const enemies = EnemyManager.getAlive();
    const rr = z.radius * z.radius;
    const cam = Renderer.cam;
    ctx.save();
    ctx.lineCap = 'round';
    for (const e of enemies) {
      if (!e.alive) continue;
      if (!Utils.isOnScreen(e.x, e.y, cam)) continue;
      const dSq = Utils.distSq(e, z);
      if (dSq > rr) continue;
      const ev = Utils.worldToScreen(e.x, e.y, cam);
      const flick = 0.45 + 0.3 * Math.sin(z.seed + e.id * 0.7 + z.elapsed * 30);
      ctx.globalAlpha = flick;
      ctx.strokeStyle = '#9fe8ff';
      ctx.lineWidth = 1.5;
      for (let k = 0; k < 2; k++) {
        const a = z.seed + e.id + k * 2.3 + z.elapsed * 18;
        const x0 = ev.x + Math.cos(a) * (e.radius || 12), y0 = ev.y + Math.sin(a) * (e.radius || 12);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + Math.cos(a) * 8 + Utils.rand(-4, 4), y0 + Math.sin(a) * 8 + Utils.rand(-4, 4));
        ctx.stroke();
      }
    }
    ctx.restore();
  },

  // 阶段 4：雷区消散（边界从外向内收缩、电弧断裂、最后回到中心）
  _drawZoneFade(ctx, sv, z, t, merged) {
    ctx.save();
    const r = z.radius * (1 - t * 0.55);
    if (!merged) {
      ctx.lineCap = 'round';
      ctx.lineWidth = 1.8;
      for (let k = 0; k < 4; k++) {
        const a0 = z.seed * 1.3 + k * (Math.PI / 2);
        ctx.strokeStyle = '#6ab8ff';
        ctx.globalAlpha = 0.32 * (1 - t);
        ctx.beginPath();
        ctx.arc(sv.x, sv.y, r, a0, a0 + Math.PI / 2 * 0.35 * (1 - t));
        ctx.stroke();
      }
      // 最后一条电弧回到中心
      if (t > 0.55) {
        ctx.globalAlpha = 0.5 * (1 - t);
        ctx.strokeStyle = '#dff4ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sv.x + r * 0.5, sv.y - r * 0.3);
        ctx.lineTo(sv.x, sv.y);
        ctx.stroke();
      }
    }
    // 焦痕渐显
    Renderer._drawGlow(sv.x, sv.y, z.radius * 0.62, '#2b5cff', 0.16 * t);
    ctx.restore();
  },

  // ── 空中层：暗云 / 垂直光路 / 巨大雷柱 + 分叉 / 落地冲击闪光 / 屏幕闪光 ──
  _renderAir(ctx, cam, time) {
    for (const z of this.zones) {
      if (!Utils.isOnScreen(z.x, z.y, cam, z.radius + 120)) continue;
      const sv = Utils.worldToScreen(z.x, z.y, cam);
      const t = (z.duration > 0) ? Math.min(1, z.elapsed / z.duration) : 1;

      if (z.state === 'warning') {
        this._drawSkyOmen(ctx, sv, z, t);
      } else if (z.state === 'strike') {
        this._drawSkyOmen(ctx, sv, z, 1 - t * 0.7);
        this._drawBolt(ctx, sv, z, t);
      } else if (z.state === 'active') {
        // 落雷结束，仅中心低亮余晖（亮度低于落雷瞬间）
        Renderer._drawGlow(sv.x, sv.y - 26, z.radius * 0.5, '#6ab8ff', 0.1);
      } else if (z.state === 'fade') {
        // 天空暗云快速消散
        this._drawCloud(ctx, sv, z, 0.22 * (1 - t), 0.5);
      }
    }

    // 落地局部闪光（alpha ≤ 0.06；同帧合并；绝不做全屏白闪式遮挡）
    if (this.flash > 0.001) {
      ctx.save();
      ctx.globalAlpha = Math.min(SKY_THUNDER_FEEDBACK.strikeFlashAlpha, this.flash);
      ctx.fillStyle = '#d6e8ff';
      ctx.fillRect(0, 0, cam.sw, cam.sh);
      ctx.restore();
    }
  },

  // 天空预兆：暗蓝压缩云层 + 蓝白聚光 + 极淡垂直光路
  _drawSkyOmen(ctx, sv, z, t) {
    this._drawCloud(ctx, sv, z, 0.28 + 0.12 * t, 1);
    // 云层中心聚光
    Renderer._drawGlow(sv.x, 74, 22 + 26 * t, '#bfe6ff', 0.12 + 0.35 * t);
    // 从天空到目标的极淡垂直光路
    const grad = ctx.createLinearGradient(sv.x, 80, sv.x, sv.y);
    grad.addColorStop(0, `rgba(150,200,255,${0.05 + 0.06 * t})`);
    grad.addColorStop(1, 'rgba(150,200,255,0.015)');
    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(sv.x - 3, 80, 6, Math.max(0, sv.y - 80));
    ctx.fillRect(sv.x - 9, 80, 18, Math.max(0, sv.y - 80));
    ctx.restore();
  },

  // 暗蓝色压缩云层（屏幕上方，目标正上方）
  _drawCloud(ctx, sv, z, alpha, widthScale) {
    if (alpha <= 0.004) return;
    const w = z.radius * 1.5 * widthScale * z.visualScale;
    ctx.save();
    ctx.globalAlpha = alpha;
    const grad = ctx.createRadialGradient(sv.x, 70, 4, sv.x, 70, w);
    grad.addColorStop(0, 'rgba(52,84,168,0.9)');
    grad.addColorStop(0.55, 'rgba(30,52,120,0.5)');
    grad.addColorStop(1, 'rgba(20,32,80,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(sv.x, 70, w, w * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },

  // 天雷落地：巨大垂直雷柱（内芯高亮 / 外层光晕 / 分叉电弧 / 下降贯穿）
  _drawBolt(ctx, sv, z, t) {
    const scale = z.visualScale;
    const yTop = -24, yEnd = sv.y;
    // 下降进度：0.6 内贯穿到底，其后保持（落地冲击在 0.55）
    const p = Math.min(1, t / 0.6);
    const yTip = yTop + (yEnd - yTop) * p;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 柱体三层：外层光晕 40~65px → 中层 → 内芯 14~22px（不是细线、不是静态矩形）
    const path = () => {
      ctx.beginPath();
      let started = false;
      for (const pt of z.bolt) {
        const py = yTop + (yEnd - yTop) * pt.y;
        if (py > yTip) break;
        const px = sv.x + pt.x;
        if (!started) { ctx.moveTo(px, py); started = true; }
        else ctx.lineTo(px, py);
      }
      if (started) ctx.lineTo(sv.x, yTip);
    };
    path();
    ctx.strokeStyle = 'rgba(72,120,255,0.22)';
    ctx.lineWidth = (40 + 25 * scale) * (0.75 + 0.25 * p);
    ctx.stroke();
    path();
    ctx.strokeStyle = 'rgba(106,184,255,0.55)';
    ctx.lineWidth = 20 + 10 * scale;
    ctx.stroke();
    path();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 12 + 6 * scale;
    ctx.stroke();

    // 分叉电弧（4~8 条不规则、尖锐、有方向性）
    for (const br of z.branches) {
      const by = yTop + (yEnd - yTop) * br.by;
      if (by > yTip) continue;
      ctx.beginPath();
      ctx.moveTo(sv.x + br.x0, by);
      for (const q of br.pts) ctx.lineTo(sv.x + br.x0 + q.x, by + q.y);
      ctx.strokeStyle = 'rgba(120,190,255,0.5)';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(230,245,255,0.85)';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    // 落地冲击闪光（接触地面后）
    if (t >= 0.55) {
      const dec = 1 - Math.min(1, (t - 0.55) / 0.45);
      Renderer._drawGlow(sv.x, sv.y, z.radius * 1.2, '#dff4ff', 0.55 * dec);
      // 地面能量飞溅（向上短弧）
      ctx.strokeStyle = 'rgba(200,235,255,0.8)';
      ctx.lineWidth = 2.2;
      for (let k = 0; k < 6; k++) {
        const a = -Math.PI / 2 + (k - 2.5) * 0.42 + Math.sin(z.seed + k) * 0.15;
        const len = (z.radius * 0.5) * (0.5 + 0.5 * dec);
        ctx.beginPath();
        ctx.moveTo(sv.x, sv.y);
        ctx.lineTo(sv.x + Math.cos(a) * len, sv.y + Math.sin(a) * len * 0.75);
        ctx.stroke();
      }
    }
    ctx.restore();
  },

  // 雷柱折线 + 分叉预生成（strike 期间周期重生成 → 分叉变化）
  _genBolt(z) {
    const n = 10;
    const pts = new Array(n);
    for (let i = 0; i < n; i++) {
      pts[i] = {
        x: (this._seedRand(z.seed, i) - 0.5) * 28,
        y: i / (n - 1),
      };
    }
    z.bolt = pts;
    const bn = 4 + Math.floor(this._seedRand(z.seed, 99) * 5); // 4~8 条分叉
    const brs = new Array(bn);
    for (let k = 0; k < bn; k++) {
      const by = 0.15 + 0.75 * this._seedRand(z.seed + 3, k);
      const dir = (k % 2 === 0) ? 1 : -1;
      const segs = 3;
      const qs = new Array(segs);
      for (let s = 0; s < segs; s++) {
        qs[s] = {
          x: dir * (14 + s * 16) + (this._seedRand(z.seed + 7, k * 5 + s) - 0.5) * 18,
          y: 22 + s * 18 + (this._seedRand(z.seed + 11, k * 5 + s) - 0.5) * 14,
        };
      }
      brs[k] = { by, x0: (this._seedRand(z.seed, k + 20) - 0.5) * 22, pts: qs };
    }
    z.branches = brs;
  },

  // 确定性伪随机（同一 seed 每次调用结果一致，避免每帧闪烁跳变）
  _seedRand(seed, i) {
    const x = Math.sin(seed * 91.7 + i * 37.3) * 43758.5453;
    return x - Math.floor(x);
  },

  // ── 清空（重开 / 死亡 / 通关 / 返回开始页必须全部回收）────────────────────
  clearSkyThunderStrikes() {
    this.zones.length = 0;
    this.scorch.length = 0;
    this.flash = 0;
    this.shake = 0;
    this._hitThisFrame.clear();
    this._paraGlobal.clear();
    this._paraEventCd.clear();
  },
};

// ─── SKY THUNDER（引雷 · 公共机制卡「引雷」）────────────────────────────────
// 与流派 1 的漩涡电（VortexManager.lightnings / Renderer.drawVortexLightning）
// 完全分离的机制与视觉语言：
//   引雷   = 天空、细长蓝白折线雷电、落点、俯视雷区、局部麻痹电弧（本文件）
//   漩涡电 = 局部、随机、围绕漩涡、短促细小放电（vortex.js，保持原样）
//
// 视觉参考：pixelfx moves/lightning-call → lightning/lightning-strike → lightning/_lib
// 只提取底层雷击：曲折主干、白核、电蓝外缘、细叉、接地电火花；
// 不引入施法/受击角色、横版地面、火光余烬、演示镜头与顿帧。
//
// 战斗流程（每 4 秒开始一个批次）：
//   批次数量 = min(6, 2 + floor(玩家等级 / 5))，逐道落地（实际间隔 550ms，硬性 ≥500ms）
//   每道：逐次选目标 → 天空预兆(350ms) → 天雷落地(140ms) → 持续雷区(1200ms) → 消散(300ms)
//   普通敌人落点建立区域预约（持续到目标死亡，落点不重叠）；BOSS 不做永久锁定

// ─── 数值配置（所有倍率集中在此，禁止散落魔法数字）────────────────────────
const SKY_THUNDER_CONFIG = {
  cooldown: 4000,            // 批次触发间隔（ms）
  searchRadius: 900,         // 目标搜索范围（px，相对玩家）

  // 批次数量：min(6, 2 + floor(playerLevel / 5))
  // Lv.1-4 → 2 道；Lv.5-9 → 3 道；Lv.10-14 → 4 道；Lv.15-19 → 5 道；Lv.20+ → 6 道
  baseStrikeCount: 2,
  strikeCountLevelStep: 5,
  maxStrikeCount: 6,

  // 逐道落地：相邻两道「实际落地」间隔；硬性不低于 500ms
  strikeInterval: 550,
  strikeMinInterval: 500,

  strikeRadius: 120,         // 每道落雷半径（px）
  damagePerTarget: 45,       // 每道落雷初始伤害（数量成长不提高单道伤害）

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
  strikeFlashAlpha: 0,       // 全屏落地闪光已关闭：冲击只由细雷电 / 接地点 / 电火花表达
  strikeFlashDuration: 0,
  strikeCameraShake: 0.35,   // 沿用既有落地震屏上限（总偏移仍受 2px 硬上限约束）
  tickFlashAlpha: 0,         // 雷区 tick 不闪屏
  tickCameraShake: 0,        // 雷区 tick 不震屏
  priority: 1,               // 反馈优先级（白蚀爆裂最高）
};

// 引雷专用视觉参数：雷电宽度、分叉长度与地面范围彼此独立，不随雷区半径等比放大
const SKY_THUNDER_VIS = {
  boltTop: -24,              // 空中雷电起点（屏幕上方）
  trunkAmp: 17,              // 主干首次折线摆幅（px）
  trunkDepth: 4,             // 折线细分层数（17 个节点）
  forksMin: 3,
  forksMax: 4,
  glowWidth: 10,             // 蓝紫外晕（px，低透明度）
  glowColor: 'rgba(92, 72, 255, 0.10)',
  outerWidth: 4.6,           // 电蓝外缘
  outerColor: 'rgba(78, 150, 255, 0.52)',
  bodyWidth: 3.0,            // 蓝色主体
  bodyColor: 'rgba(150, 220, 255, 0.88)',
  coreWidth: 1.25,           // 白色细核心
  forkWidth: 1.9,
  forkColor: 'rgba(150, 215, 255, 0.66)',
  forkCoreWidth: 0.8,
  warnSegments: 8,
  activeSegments: 10,
  edgeArcs: 5,
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
  zones: [],         // 活跃雷区（warning → strike → active → fade）
  reservations: [],  // 普通敌人区域预约（持续到目标真实死亡）
  shake: 0,          // 震屏强度（≤ strikeCameraShake，快速衰减）

  _nextId: 1,
  _nextResId: 1,
  _hitThisFrame: new Set(),  // 同一敌人同一帧最多接受一次引雷伤害
  _paraGlobal: new Map(),    // 全局麻痹刷新记录（防多雷区永久麻痹）
  _paraEventCd: new Map(),   // 同目标 PARALYZE 事件冷却
  _paraVisual: new Map(),    // 引雷麻痹视觉（enemyId → { until, seed }），只影响渲染
  _enBuf: [],                // 敌人快照缓冲

  // ── 数量成长：读取玩家等级（非流派等级/波次/无尽轮次）──────────────────
  strikeCountForLevel(level) {
    const cfg = SKY_THUNDER_CONFIG;
    const lv = Math.max(1, Math.floor(level || 1));
    return Math.min(cfg.maxStrikeCount,
      cfg.baseStrikeCount + Math.floor(lv / cfg.strikeCountLevelStep));
  },

  // 从预警开始到「实际落地」的提前量（用于让实际落地间隔贴合配置）
  strikeLeadSeconds() {
    const cfg = SKY_THUNDER_CONFIG;
    return (cfg.warningDuration + cfg.strikeDuration * 0.55) / 1000;
  },

  // 该批次是否还有「尚未落地」的攻击（warning / strike 未 struck）
  hasPendingStrikeForBatch(batchId) {
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i];
      if (z.batchId !== batchId) continue;
      if (z.state === 'warning' || (z.state === 'strike' && !z.struck)) return true;
    }
    return false;
  },

  // ── 生成单道引雷（PublicLightningManager 逐道调用）──────────────────────
  // 每次只创建 1 个落点；成功返回 true；无合法目标返回 false（不强行补足）。
  spawnSkyThunderStrike(state, opts) {
    if (!state || !state.player) return false;
    const cfg = SKY_THUNDER_CONFIG;
    // 技能范围加成（BUFF「技能范围」：范围类效果半径增大）
    const rangeMult = (state.genre === 3) ? EchoManager.skillRangeMult(state) : 1;
    const radius = cfg.strikeRadius * rangeMult;
    const batchId = (opts && opts.batchId != null) ? opts.batchId : 0;

    const target = this._pickStrikeTarget(state, radius);
    if (!target) return false;

    this._pushZone(target.x, target.y, radius, cfg.damagePerTarget, state, {
      batchId,
      targetId: target.id,
      isBoss: target.type === 'boss',
    });
    return true;
  },

  // ── 目标选择：普通敌人优先（未预约 + 区域不重叠）→ BOSS ────────────────
  _pickStrikeTarget(state, radius) {
    const cfg = SKY_THUNDER_CONFIG;
    const p = state.player;
    const enemies = EnemyManager.getAlive();
    const maxD = cfg.searchRadius * cfg.searchRadius;

    // 1) 普通敌人：存活、未被预约、落点区域不与已有预约/雷区重叠
    let best = null, bestD = maxD;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive || e.type === 'boss') continue;
      if (this._hasReservationForTarget(e.id)) continue;
      if (!this._areaFree(e.x, e.y, radius)) continue;
      const d = Utils.distSq(e, p);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) return best;

    // 2) 没有合法普通敌人：优先尚未被雷区覆盖的 BOSS 位置
    let boss = null, bossD = maxD;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive || e.type !== 'boss') continue;
      if (!this._areaFree(e.x, e.y, radius)) continue;
      const d = Utils.distSq(e, p);
      if (d < bossD) { bossD = d; boss = e; }
    }
    if (boss) return boss;

    // 3) BOSS 无未覆盖位置：按现有 BOSS 规则允许重复攻击
    let fallback = null, fallbackD = maxD;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive || e.type !== 'boss') continue;
      const d = Utils.distSq(e, p);
      if (d < fallbackD) { fallbackD = d; fallback = e; }
    }
    return fallback;
  },

  // 落点区域排他：与所有预约、所有现存雷区（预警/落雷/活动/消散）都不重叠
  _areaFree(x, y, radius) {
    for (let i = 0; i < this.reservations.length; i++) {
      const r = this.reservations[i];
      const need = radius + r.radius;
      const dx = x - r.x, dy = y - r.y;
      if (dx * dx + dy * dy < need * need) return false;
    }
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i];
      const need = radius + z.radius;
      const dx = x - z.x, dy = y - z.y;
      if (dx * dx + dy * dy < need * need) return false;
    }
    return true;
  },

  _hasReservationForTarget(targetId) {
    for (let i = 0; i < this.reservations.length; i++) {
      if (this.reservations[i].targetId === targetId) return true;
    }
    return false;
  },

  _reservationByZone(zoneId) {
    for (let i = 0; i < this.reservations.length; i++) {
      if (this.reservations[i].zoneId === zoneId) return this.reservations[i];
    }
    return null;
  },

  _findEnemyById(id) {
    const list = EnemyManager.enemies;
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  },

  _pushZone(x, y, radius, damage, state, opts) {
    const cfg = SKY_THUNDER_CONFIG;
    const o = opts || {};
    // 超出上限：优先回收已落地且剩余时间最短的雷区，绝不淘汰未落地预警
    while (this.zones.length >= cfg.maxActiveZones) {
      let worst = -1, worstRemain = Infinity;
      for (let i = 0; i < this.zones.length; i++) {
        const z = this.zones[i];
        if (z.state === 'warning' || (z.state === 'strike' && !z.struck)) continue;
        const r = this._remain(z);
        if (r < worstRemain) { worstRemain = r; worst = i; }
      }
      if (worst < 0) worst = 0;
      this.zones.splice(worst, 1);
    }
    const seed = Math.random() * 1000;
    const z = {
      id: this._nextId++,
      x, y,
      radius,
      damage,
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
      // 批次 / 目标 / 预约
      batchId: o.batchId || 0,
      targetId: (o.targetId != null) ? o.targetId : -1,
      isBoss: !!o.isBoss,
      reservationId: -1,
      // 视觉：路径在创建时一次性生成，strike 期间只切换预计算变体与亮度
      seed,
      boltPaths: null,
      branches: null,
      struck: false,
      impactT: 1,
      tickFlash: 0,
      miniT: 0.3 + Math.random() * 0.3,
      miniLife: 0,
      miniAngle: Math.random() * Math.PI * 2,
    };
    this._genBolt(z);

    // 普通敌人：建立持续到目标真实死亡的区域预约（BOSS 不做永久锁定）
    if (!z.isBoss && z.targetId >= 0) {
      const res = {
        id: this._nextResId++,
        targetId: z.targetId,
        x, y,
        radius,
        batchId: z.batchId,
        zoneId: z.id,
        landed: false,
      };
      z.reservationId = res.id;
      this.reservations.push(res);
    }

    this.zones.push(z);
  },

  // ── 统一 update（暂停时不被调用 → 计时自然停止）──────────────────────────
  updateSkyThunderStrikes(dt, state) {
    const tickSec = SKY_THUNDER_CONFIG.tickInterval / 1000;
    // 同帧伤害限制每帧清零
    this._hitThisFrame.clear();
    // 仅保留既有落地震屏衰减；全屏闪光已关闭
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
        // 落地瞬间：一次性初始伤害 + 因果 STRIKE（只结算一次）
        if (!z.struck && t >= 0.55) {
          z.struck = true;
          z.impactT = 0;
          this.emitSkyThunderEvent(z, SKY_THUNDER_EVENT.STRIKE, null, state);
          this._strikeImpact(z, state);
        }
      } else if (z.state === 'active') {
        // 雷区 tick：伤害 + 麻痹（tickInterval 一次）
        z.tickTimer += dt;
        if (z.tickTimer >= tickSec) {
          z.tickTimer -= tickSec;
          z.tickIndex++;
          this._zoneTick(z, state);
        }
        // 地面电弧间歇跳动（只换位置与相位，不重播天空落雷）
        z.miniT -= dt;
        if (z.miniT <= 0) {
          z.miniT = 0.32 + Math.random() * 0.38;
          z.miniLife = 0.10;
          z.miniAngle = Math.random() * Math.PI * 2;
        }
        if (z.miniLife > 0) z.miniLife -= dt;
        if (z.tickFlash > 0) z.tickFlash = Math.max(0, z.tickFlash - dt * 6);
      } else if (z.state === 'fade') {
        // 消散：不再造成伤害
      }
      // 接地余晖计时（视觉；雷区 tick / 伤害节奏不受影响）
      if (z.struck && z.impactT < 1) z.impactT = Math.min(1, z.impactT + dt / 0.25);
    }

    // 预约有效性：目标真实死亡 / 合法移除时释放（雷区消散不释放预约）
    this._checkReservations(state);
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
      // fade 结束：冷蓝余光已在 fade 阶段内衰减完，不留下灼烧/焦痕
      z.consumed = true;
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
    // BOSS 共享血池：每道雷最多结算一次（多眼球重叠不复制伤害）
    let bossHit = false;
    for (const e of enemies) {
      if (!e.alive) continue;
      if (Utils.distSq(e, z) > rr) continue;
      if (e.type === 'boss') {
        if (bossHit) continue;
        bossHit = true;
      }
      z.affectedTargets.add(e.id);
      this.applySkyThunderDamage(z, e, state);
    }
    // 预约标记已落地（预约本身保留到目标真实死亡）
    const res = this._reservationByZone(z.id);
    if (res) res.landed = true;
    // 记录实际落地时间（游戏时间；暂停时 update 不执行，计时自然停止）
    if (typeof PublicLightningManager !== 'undefined' && z.batchId) {
      PublicLightningManager.onActualStrike(z.batchId, state ? state.time : 0);
    }
    // 屏幕反馈：全屏闪光关闭，只保留既有小震屏
    this.shake = Math.max(this.shake, SKY_THUNDER_FEEDBACK.strikeCameraShake);
    // 接地电火花（少量蓝白，无火光/余烬）
    Particles.spawn(z.x, z.y, '#cfeeff', 7, 180, 0.32, [1, 2.2]);
    Particles.spawn(z.x, z.y, '#7cc8ff', 4, 120, 0.4, [1, 1.8]);
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
    // 3) 麻痹（含 PARALYZE 事件；BOSS 遵守控制抗性，只刷新不叠加）
    for (const e of list) this.applySkyThunderParalyze(z, e, state);
    // 4) tick 伤害：BOSS 共享血池每个雷区每 tick 最多结算一次
    let bossHit = false;
    for (const e of list) {
      if (e.type === 'boss') {
        if (bossHit) continue;
        bossHit = true;
      }
      this.applySkyThunderDamage(z, e, state);
    }
  },

  // ── 预约有效性检查（只释放真实死亡/移除的目标；离屏/未更新不误判）────────
  _checkReservations(state) {
    if (this.reservations.length === 0) return;
    for (let i = this.reservations.length - 1; i >= 0; i--) {
      const r = this.reservations[i];
      const target = this._findEnemyById(r.targetId);
      if (target && target.alive) continue;

      // 目标已真实死亡（或已从本局移除）：释放预约
      this.reservations.splice(i, 1);

      // 尚未落地的对应攻击：取消，不在失效位置强行落雷
      for (let j = this.zones.length - 1; j >= 0; j--) {
        const z = this.zones[j];
        if (z.reservationId !== r.id || z.struck) continue;
        this.zones.splice(j, 1);
        // 补偿批次数量，允许后续重新选择合法目标（仍受落地间隔约束）
        if (typeof PublicLightningManager !== 'undefined' && z.batchId) {
          PublicLightningManager.compensate(z.batchId);
        }
      }
    }
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
    // 引雷专用麻痹视觉：只记录到期时间与相位，不改敌人位置/碰撞/硬直
    this._paraVisual.set(enemy.id, {
      until: now + cfg.paralyzeDuration / 1000,
      seed: (enemy.id * 131 + zone.id * 17) % 997,
    });
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
      if (this.zones.length === 0) return;
      this._renderGround(ctx, cam, state ? state.time : 0);
    } else {
      if (this.zones.length === 0 && this._paraVisual.size === 0) return;
      this._renderAir(ctx, cam, state ? state.time : 0);
    }
  },

  // ── 地面层：预警断裂圈 / 接地电弧 / 俯视雷区边界 / 消散电痕 ───────────────
  _renderGround(ctx, cam, time) {
    for (const z of this.zones) {
      const sv = Utils.worldToScreen(z.x, z.y, cam);
      if (!Utils.isOnScreen(z.x, z.y, cam, z.radius + 40)) continue;
      const t = (z.duration > 0) ? Math.min(1, z.elapsed / z.duration) : 1;
      if (z.state === 'warning') {
        this._drawWarnRing(ctx, sv, z, t);
      } else if (z.state === 'strike') {
        this._drawGroundStrike(ctx, sv, z, t);
      } else if (z.state === 'active') {
        this._drawZoneGround(ctx, sv, z, t);
      } else if (z.state === 'fade') {
        this._drawZoneFade(ctx, sv, z, t);
      }
    }
  },

  // 落地前仍显示蓄力圈；接地后才出现冷蓝裂光与电火花
  _drawGroundStrike(ctx, sv, z, t) {
    if (!z.struck) {
      this._drawWarnRing(ctx, sv, z, 1, 0.35);
      return;
    }
    this._drawGroundImpact(ctx, sv, z, t);
  },

  // 阶段 1：俯视预警（低亮度蓝紫断裂圈 + 少量向心电纹；不压暗屏幕、不提前伤害）
  _drawWarnRing(ctx, sv, z, t, boost = 0) {
    const V = SKY_THUNDER_VIS;
    const flick = this._timeBucket(z.elapsed);
    const r = z.radius + Math.sin(z.elapsed * 6 + z.seed) * 1.5;
    ctx.save();
    ctx.lineCap = 'round';
    // 近圆形断裂圈：固定 8 段，段间留缺口
    for (let k = 0; k < V.warnSegments; k++) {
      const gap = (Math.PI * 2 / V.warnSegments);
      const a0 = z.seed + k * gap + 0.08;
      const a1 = a0 + gap * (0.52 + 0.18 * this._seedRand(z.seed + flick, k));
      const col = k % 2 === 0 ? '#7c5cff' : '#5fa8ff';
      this._jagArc(
        ctx, sv.x, sv.y, r, a0, a1,
        z.seed + flick * 13 + k * 5, 3.2,
        col, 1.5,
        (0.16 + 0.38 * t + boost) * (0.75 + 0.25 * this._seedRand(z.seed, k + 30))
      );
    }
    // 少量电纹向中心聚集（不从中心向外铺）
    ctx.globalAlpha = 0.10 + 0.20 * t;
    ctx.strokeStyle = '#8f7cff';
    ctx.lineWidth = 1;
    for (let k = 0; k < 5; k++) {
      const a = z.seed * 1.7 + k * (Math.PI * 2 / 5) + 0.3;
      const x0 = sv.x + Math.cos(a) * r * 0.82;
      const y0 = sv.y + Math.sin(a) * r * 0.82;
      const x1 = sv.x + Math.cos(a + 0.18) * r * 0.20;
      const y1 = sv.y + Math.sin(a + 0.18) * r * 0.20;
      const mx = (x0 + x1) / 2 + (this._seedRand(z.seed + flick, k + 50) - 0.5) * 14;
      const my = (y0 + y1) / 2 + (this._seedRand(z.seed + flick, k + 70) - 0.5) * 14;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(mx, my);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    // 极低亮度中心蓄力点（中央保持通透）
    ctx.globalAlpha = 1;
    Renderer._drawGlow(sv.x, sv.y, 8, '#6a5cff', 0.05 + 0.08 * t);
    ctx.restore();
  },

  // 阶段 2：接地冲击（细电弧向四周炸开 + 很小的蓝白接地点；无火光/余烬）
  _drawGroundImpact(ctx, sv, z, t) {
    const k = this._clamp01((t - 0.55) / 0.45);
    const dec = 1 - k;
    const flick = this._timeBucket(z.elapsed + 0.13);
    ctx.save();
    ctx.lineCap = 'round';
    // 短裂光：近圆分布，长度固定上限，不随雷区半径拉成长星
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = z.seed * 2.1 + i * (Math.PI * 2 / n) +
        (this._seedRand(z.seed + flick, i) - 0.5) * 0.25;
      const len = 16 + this._seedRand(z.seed, i + 20) * 38;
      const pts = [[0, 0]];
      let x = 0, y = 0;
      for (let s = 1; s <= 3; s++) {
        x += Math.cos(a) * len / 3 + (this._seedRand(z.seed + flick, i * 7 + s) - 0.5) * 9;
        y += Math.sin(a) * len / 3 + (this._seedRand(z.seed + flick, i * 7 + s + 40) - 0.5) * 9;
        pts.push([x, y]);
      }
      this._strokePolyline(ctx, pts, sv.x, sv.y, 'rgba(105,78,255,0.16)', 5.5, 0.60 * dec);
      this._strokePolyline(ctx, pts, sv.x, sv.y, 'rgba(94,170,255,0.55)', 2.4, 0.65 * dec);
      this._strokePolyline(ctx, pts, sv.x, sv.y, 'rgba(235,250,255,0.90)', 1.1, 0.80 * dec);
    }
    // 冲击波细环（不填充）
    const rr = z.radius * (0.72 + 0.28 * k);
    ctx.globalAlpha = 0.30 * dec;
    ctx.strokeStyle = '#8fc8ff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(sv.x, sv.y, rr, 0, Math.PI * 2);
    ctx.stroke();
    // 接地蓝白亮点：小范围，不做大面积光墙
    ctx.globalAlpha = 1;
    Renderer._drawGlow(sv.x, sv.y, 12 + 8 * k, '#e8f8ff', 0.50 * dec);
    ctx.globalAlpha = 0.85 * dec;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(sv.x, sv.y, 2.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },

  // 阶段 3：持续雷区（俯视近圆断裂边界 / 边缘电弧 / tick 局部提亮 / 间歇地面电弧）
  _drawZoneGround(ctx, sv, z, t) {
    const V = SKY_THUNDER_VIS;
    const flick = this._timeBucket(z.elapsed);
    const r = z.radius;
    ctx.save();
    ctx.lineCap = 'round';
    // 近圆形断裂边界：角度固定，只做 12Hz 低频抖动（不旋转、不吸附）
    for (let k = 0; k < V.activeSegments; k++) {
      const gap = (Math.PI * 2 / V.activeSegments);
      const a0 = z.seed * 0.7 + k * gap + this._seedRand(z.seed, k + 10) * gap * 0.15;
      const a1 = a0 + gap * (0.42 + 0.22 * this._seedRand(z.seed, k + 20));
      const boost = z.tickFlash > 0.01 ? 0.18 * z.tickFlash : 0;
      const col = k % 3 === 0 ? '#8b6dff' : (k % 3 === 1 ? '#5b9dff' : '#7fd8ff');
      this._jagArc(
        ctx, sv.x, sv.y, r, a0, a1,
        z.seed + flick * 13 + k * 5, 3.5,
        col, 1.4,
        0.16 + boost + 0.08 * this._seedRand(z.seed, k + 40)
      );
    }
    // 边缘低频跳跃电弧：向内外两侧跳动
    for (let k = 0; k < V.edgeArcs; k++) {
      const a = z.seed + k * 1.37 + flick * 0.21;
      const inOut = this._seedRand(z.seed + flick, k + 60) < 0.5 ? 1 : -1;
      const len = 7 + this._seedRand(z.seed + flick, k + 80) * 13;
      const x0 = sv.x + Math.cos(a) * (r - inOut * 2);
      const y0 = sv.y + Math.sin(a) * (r - inOut * 2);
      const x1 = x0 + Math.cos(a + (this._seedRand(z.seed + flick, k + 90) - 0.5) * 0.7) * len;
      const y1 = y0 + Math.sin(a + (this._seedRand(z.seed + flick, k + 90) - 0.5) * 0.7) * len;
      const mx = (x0 + x1) / 2 + (this._seedRand(z.seed + flick, k + 110) - 0.5) * 7;
      const my = (y0 + y1) / 2 + (this._seedRand(z.seed + flick, k + 120) - 0.5) * 7;
      ctx.globalAlpha = 0.20 + 0.20 * this._seedRand(z.seed + flick, k + 130);
      ctx.strokeStyle = '#9fd8ff';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(mx, my);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    // 间歇地面短电弧：在雷区内跳动，不重播天空落雷
    if (z.miniLife > 0) {
      const a = z.miniAngle;
      const r0 = r * (0.35 + 0.25 * this._seedRand(z.seed, 150));
      const r1 = r * (0.78 + 0.10 * this._seedRand(z.seed, 151));
      const x0 = sv.x + Math.cos(a) * r0;
      const y0 = sv.y + Math.sin(a) * r0;
      const x1 = sv.x + Math.cos(a + 0.35) * r1;
      const y1 = sv.y + Math.sin(a + 0.35) * r1;
      const mx = (x0 + x1) / 2 + (this._seedRand(z.seed + z.miniAngle, 160) - 0.5) * 10;
      const my = (y0 + y1) / 2 + (this._seedRand(z.seed + z.miniAngle, 161) - 0.5) * 10;
      const aLife = Math.max(0, z.miniLife / 0.10);
      ctx.globalAlpha = 0.65 * aLife;
      ctx.strokeStyle = 'rgba(190,235,255,0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(mx, my);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.globalAlpha = 0.28 * aLife;
      ctx.strokeStyle = '#5b9dff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    // tick：只让边缘局部电纹短促提亮，不做中心大面积闪光
    if (z.tickFlash > 0.01) {
      ctx.globalAlpha = 0.18 * z.tickFlash;
      ctx.strokeStyle = '#e8f8ff';
      ctx.lineWidth = 1.6;
      for (let k = 0; k < 3; k++) {
        const a = z.seed + k * 2.1 + flick * 0.17;
        const x0 = sv.x + Math.cos(a) * (r - 6);
        const y0 = sv.y + Math.sin(a) * (r - 6);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + Math.cos(a + 0.4) * 12, y0 + Math.sin(a + 0.4) * 12);
        ctx.stroke();
      }
    }
    ctx.restore();
  },

  // 阶段 4：雷区消散（边界逐段熄灭 + 极短冷蓝余光；不留燃烧/焦痕）
  _drawZoneFade(ctx, sv, z, t) {
    const segs = SKY_THUNDER_VIS.activeSegments;
    const r = z.radius;
    const flick = this._timeBucket(z.elapsed + 0.2);
    ctx.save();
    ctx.lineCap = 'round';
    for (let k = 0; k < segs; k++) {
      const fadeAt = 0.08 + 0.62 * this._seedRand(z.seed, k + 200);
      if (t > fadeAt) continue;
      const gap = (Math.PI * 2 / segs);
      const a0 = z.seed * 0.7 + k * gap + this._seedRand(z.seed, k + 10) * gap * 0.15;
      const a1 = a0 + gap * (0.42 + 0.22 * this._seedRand(z.seed, k + 20));
      const a = (1 - t / Math.max(0.2, fadeAt)) * 0.24;
      this._jagArc(
        ctx, sv.x, sv.y, r, a0, a1,
        z.seed + flick * 13 + k * 5, 3.0,
        k % 2 ? '#5b9dff' : '#8b6dff', 1.2, a
      );
    }
    // 极短冷蓝余光：只在落点附近，不留下持续痕迹
    ctx.globalAlpha = 1;
    Renderer._drawGlow(sv.x, sv.y, 12, '#6a8dff', 0.12 * (1 - t));
    ctx.globalAlpha = 0.22 * (1 - t);
    ctx.strokeStyle = '#bfe6ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sv.x, sv.y, 8 + 10 * t, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },

  // ── 空中层：细长蓝白雷电 / 接地余晖 / 敌人麻痹局部电弧 ────────────────────
  _renderAir(ctx, cam, time) {
    // 已锁定小怪头顶的极小米蓝紫色雷印（预警期间；不画预约范围圈）
    for (let i = 0; i < this.reservations.length; i++) {
      const r = this.reservations[i];
      if (r.landed) continue;
      const en = this._findEnemyById(r.targetId);
      if (!en || !en.alive) continue;
      if (!Utils.isOnScreen(en.x, en.y, cam, 40)) continue;
      const sv = Utils.worldToScreen(en.x, en.y - (en.radius || 12) - 10, cam);
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#9d7bff';
      ctx.beginPath();
      ctx.moveTo(sv.x, sv.y - 4);
      ctx.lineTo(sv.x + 3, sv.y + 2);
      ctx.lineTo(sv.x - 3, sv.y + 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    for (const z of this.zones) {
      if (!Utils.isOnScreen(z.x, z.y, cam, z.radius + 120)) continue;
      const sv = Utils.worldToScreen(z.x, z.y, cam);
      const t = (z.duration > 0) ? Math.min(1, z.elapsed / z.duration) : 1;
      if (z.state === 'strike') {
        this._drawBolt(ctx, sv, z, t);
      } else if (z.state === 'active') {
        this._drawResidualBolt(ctx, sv, z);
      }
    }

    // 敌人身上的引雷麻痹局部电流（画在敌人之上；麻痹结束即消失）
    this._drawParalyzeArcs(ctx, cam, time);
  },

  // 主雷电接地后的极短余晖：只保留主干，快速变细消失
  _drawResidualBolt(ctx, sv, z) {
    const a = this._clamp01(1 - z.impactT / 0.55);
    if (a <= 0.01) return;
    const V = SKY_THUNDER_VIS;
    const trunk = z.boltPaths[0];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = a;
    ctx.beginPath();
    this._addBoltSubpath(ctx, trunk, sv.x, V.boltTop, sv.y, 1, 0);
    ctx.strokeStyle = V.outerColor;
    ctx.lineWidth = 2.8;
    ctx.stroke();
    ctx.strokeStyle = V.bodyColor;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  },

  // 麻痹局部电流：2~3 条短弧贴在敌人轮廓，冷蓝 + 少量白色，相位按敌人错开
  _drawParalyzeArcs(ctx, cam, time) {
    if (this._paraVisual.size === 0) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (const [id, v] of this._paraVisual) {
      if (time >= v.until) { this._paraVisual.delete(id); continue; }
      const e = this._findEnemyById(id);
      if (!e || !e.alive) { this._paraVisual.delete(id); continue; }
      if (!Utils.isOnScreen(e.x, e.y, cam, (e.radius || 14) + 24)) continue;
      const sv = Utils.worldToScreen(e.x, e.y, cam);
      const rad = (e.radius || 14) * 1.05;
      const bucket = Math.floor(time * 14 + v.seed * 0.13);
      const phase = time * 18 + v.seed;
      for (let k = 0; k < 3; k++) {
        const a = phase + k * 2.1 + this._seedRand(v.seed, k + 10) * 1.4;
        const spread = 0.45 + 0.35 * this._seedRand(v.seed + bucket, k + 20);
        const r0 = rad * (0.88 + 0.12 * this._seedRand(v.seed + bucket, k + 30));
        const r1 = rad * (1.02 + 0.18 * this._seedRand(v.seed + bucket, k + 40));
        const x0 = sv.x + Math.cos(a) * r0;
        const y0 = sv.y + Math.sin(a) * r0 - rad * 0.1;
        const x1 = sv.x + Math.cos(a + spread) * r1;
        const y1 = sv.y + Math.sin(a + spread) * r1 - rad * 0.1;
        const mx = (x0 + x1) / 2 + (this._seedRand(v.seed + bucket, k + 50) - 0.5) * 7;
        const my = (y0 + y1) / 2 + (this._seedRand(v.seed + bucket, k + 60) - 0.5) * 7;
        const fade = 0.55 + 0.35 * this._seedRand(v.seed + bucket, k + 70);
        ctx.globalAlpha = fade;
        ctx.strokeStyle = '#8fe0ff';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(mx, my);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.globalAlpha = 0.28 * fade;
        ctx.strokeStyle = '#4f86ff';
        ctx.lineWidth = 2.6;
        ctx.stroke();
      }
    }
    ctx.restore();
  },

  // 细长蓝白雷电：预计算折线路径，接地前分段向下延伸，接地后只做亮度闪动
  _drawBolt(ctx, sv, z, t) {
    const V = SKY_THUNDER_VIS;
    const yTop = V.boltTop, yEnd = sv.y;
    if (yEnd <= yTop + 4) return;

    let tipNorm;
    if (z.struck) {
      tipNorm = 1;
    } else {
      const u = this._clamp01(t / 0.55);
      const steps = 6;
      tipNorm = Math.min(1, (Math.floor(u * steps) + 1) / steps);
    }
    if (tipNorm <= 0.001) return;

    const vIdx = Math.floor(z.elapsed * 24) % 3;
    const trunk = z.boltPaths[0];
    const drift = [0, 1.8, 3.6][vIdx];
    const flicker = [1, 0.72, 0.3, 0.95, 0.5, 0.8, 0.22][
      Math.floor(z.elapsed * 30 + z.seed) % 7
    ];

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 主干：薄蓝紫光晕 → 电蓝外缘 → 蓝色主体
    ctx.beginPath();
    this._addBoltSubpath(ctx, trunk, sv.x, yTop, yEnd, tipNorm, drift);
    ctx.strokeStyle = V.glowColor;
    ctx.lineWidth = V.glowWidth;
    ctx.stroke();
    ctx.strokeStyle = V.outerColor;
    ctx.lineWidth = V.outerWidth;
    ctx.stroke();
    ctx.strokeStyle = V.bodyColor;
    ctx.lineWidth = V.bodyWidth;
    ctx.stroke();

    // 白色细核心（只画主干）
    ctx.beginPath();
    this._addBoltSubpath(ctx, trunk, sv.x, yTop, yEnd, tipNorm, drift);
    ctx.strokeStyle = `rgba(255,255,255,${0.92 * flicker})`;
    ctx.lineWidth = V.coreWidth;
    ctx.stroke();

    // 少量细叉：比主干更细、更暗
    ctx.beginPath();
    for (const br of z.branches) this._addBoltSubpath(ctx, br, sv.x, yTop, yEnd, tipNorm, drift);
    ctx.strokeStyle = 'rgba(78, 120, 255, 0.20)';
    ctx.lineWidth = 4.2;
    ctx.stroke();
    ctx.strokeStyle = V.forkColor;
    ctx.lineWidth = V.forkWidth;
    ctx.stroke();
    ctx.strokeStyle = `rgba(240, 250, 255, ${0.55 * flicker})`;
    ctx.lineWidth = V.forkCoreWidth;
    ctx.stroke();

    // 延伸中的亮点 / 临界接地点
    const tip = this._boltTip(trunk, sv.x, yTop, yEnd, tipNorm, drift);
    Renderer._drawGlow(tip[0], tip[1], 8, '#cfefff', 0.42 * flicker);
    ctx.restore();
  },

  // ── 雷电路径生成（创建时一次完成；strike 期间不再重建）────────────────────
  _genBolt(z) {
    const rng = this._makeRng(Math.floor(z.seed * 1000003) ^ 0x9e3779b9);
    const main = this._buildBolt(rng, SKY_THUNDER_VIS.trunkAmp, SKY_THUNDER_VIS.trunkDepth);
    z.boltPaths = [main];
    z.branches = this._buildBranches(rng, main);
  },

  _makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  // 中点位移生成主干：y 单调向下，x 摆幅逐层衰减；末点固定在落点
  _buildBolt(rng, amp, depth) {
    let pts = [[0, 0], [0, 1]];
    let off = amp;
    for (let d = 0; d < depth; d++) {
      const next = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        let mx = (ax + bx) / 2 + (rng() * 2 - 1) * off;
        if (rng() < 0.18) mx += (rng() < 0.5 ? -1 : 1) * off * 0.7; // 局部急转
        next.push([mx, (ay + by) / 2], [bx, by]);
      }
      pts = next;
      off *= 0.52;
    }
    pts[0][0] = (rng() * 2 - 1) * 4;
    pts[pts.length - 1][0] = 0;
    return pts;
  },

  // 亮度闪动使用的轻微路径偏移在绘制时叠加：首尾不偏移，中段产生 1~4px 抖动
  _boltDriftX(drift, y) {
    return drift * Math.sin(Math.PI * y);
  },

  // 3~4 条细叉，从主干随机节点分出，长度与雷区半径无关
  _buildBranches(rng, main) {
    const V = SKY_THUNDER_VIS;
    const n = V.forksMin + Math.floor(rng() * (V.forksMax - V.forksMin + 1));
    const out = [];
    for (let k = 0; k < n; k++) {
      const ai = 2 + Math.floor(rng() * Math.max(1, main.length - 6));
      const [ax, ay] = main[ai];
      const dir = rng() < 0.5 ? -1 : 1;
      const lenY = 0.05 + rng() * 0.10;
      const pts = [[ax, ay]];
      let x = ax, y = ay;
      for (let s = 1; s <= 3; s++) {
        x += dir * (6 + rng() * 9) * (1 - s * 0.12);
        y += lenY / 3 * (0.65 + rng() * 0.7);
        if (y > 0.985) y = 0.985;
        pts.push([x, y]);
      }
      out.push(pts);
    }
    return out;
  },

  // 只绘制到 tipNorm 位置；跨过雷尖的线段按比例截断
  _addBoltSubpath(ctx, pts, sx, yTop, yEnd, tipNorm, drift = 0) {
    let started = false;
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      if (y > tipNorm) {
        if (i > 0 && pts[i - 1][1] < tipNorm) {
          const [px, py] = pts[i - 1];
          const u = (tipNorm - py) / (y - py);
          const X = sx + px + (x - px) * u + this._boltDriftX(drift, tipNorm);
          const Y = yTop + (yEnd - yTop) * tipNorm;
          if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y);
        }
        break;
      }
      const X = sx + x + this._boltDriftX(drift, y);
      const Y = yTop + (yEnd - yTop) * y;
      if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y);
    }
    return started;
  },

  _boltTip(pts, sx, yTop, yEnd, tipNorm, drift = 0) {
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][1] >= tipNorm) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
        const u = (tipNorm - ay) / Math.max(1e-6, by - ay);
        const x0 = ax + this._boltDriftX(drift, ay);
        const x1 = bx + this._boltDriftX(drift, by);
        return [sx + x0 + (x1 - x0) * u, yTop + (yEnd - yTop) * tipNorm];
      }
    }
    const last = pts[pts.length - 1];
    return [sx + last[0] + this._boltDriftX(drift, last[1]), yTop + (yEnd - yTop) * last[1]];
  },

  // ── 地面/电弧绘制工具 ───────────────────────────────────────────────────
  _timeBucket(t) {
    return Math.floor(t * 12); // 12Hz 低频换形，避免每帧变成完全无关的形状
  },

  _clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; },

  _jagArc(ctx, cx, cy, r, a0, a1, seed, jitter, color, width, alpha) {
    if (alpha <= 0.003) return;
    const segs = 7;
    ctx.beginPath();
    for (let i = 0; i <= segs; i++) {
      const u = i / segs, a = a0 + (a1 - a0) * u;
      const rr = r + (this._seedRand(seed, i) - 0.5) * jitter;
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  },

  _strokePolyline(ctx, pts, ox, oy, color, width, alpha) {
    if (alpha <= 0.003) return;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = ox + pts[i][0], y = oy + pts[i][1];
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = prev;
  },

  // 确定性伪随机（同一 seed 每次调用结果一致，避免每帧闪烁跳变）
  _seedRand(seed, i) {
    const x = Math.sin(seed * 91.7 + i * 37.3) * 43758.5453;
    return x - Math.floor(x);
  },

  // ── 清空（重开 / 死亡 / 通关 / 返回开始页必须全部回收）────────────────────
  clearSkyThunderStrikes() {
    this.zones.length = 0;
    this.reservations.length = 0;
    this.shake = 0;
    this._hitThisFrame.clear();
    this._paraGlobal.clear();
    this._paraEventCd.clear();
    this._paraVisual.clear();
    this._enBuf.length = 0;
  },
};

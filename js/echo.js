// ─── CAUSAL NODE SYSTEM (Genre 3: 因果残响 / Causal Echo) ───────────────────
// 核心对象是「因果节点」(causal node)，不是单位：
//   · 节点固定在事件发生位置，不移动、不索敌、不追踪玩家、不持续普攻
//   · 节点不生成暗影分身、不生成漩涡，负责接收后续攻击 / 机制事件的标签
//   · 累积 3 个不同事件标签触发「白蚀爆裂」，反应后消耗或转化为裂口
//   · 反应事件推进其他节点，形成真正的机制连锁（受限深度，防无限循环）

// ─── 防无限循环规则（限制单条链的深度与目标重复，而非禁止联动）────────────
const CAUSAL_RULES = {
  maxActiveNodes: 8,
  nodeLifetime: 3.0,
  deathNodeLifetime: 4.0,
  nodeMaxTags: 3,
  maxReactionDepth: 4,
  maxChainLength: 10,
  sameNodeSameEventCooldown: 250,
  sameTargetSameReactionCooldown: 400,
  ruptureBossMultiplier: 0.5,
  deathNodeCanContinueChain: true,
  deathNodeCanCreateFakeKill: false,
  fragmentsCanCreateFullNode: false,
};
// 兼容旧名（历史代码可能引用 ECHO_RULES）
const ECHO_RULES = CAUSAL_RULES;

// 事件标签（统一事件接口的 type 取值）
const ECHO_EVENT = {
  HIT: 'HIT', CRIT: 'CRIT', PROJECTILE: 'PROJECTILE', PENETRATE: 'PENETRATE',
  CONTROL: 'CONTROL', FREEZE: 'FREEZE', LINK: 'LINK', EXPLOSION: 'EXPLOSION',
  LIGHTNING: 'LIGHTNING', DEATH: 'DEATH', DEATH_SHADOW: 'DEATH_SHADOW',
  DAMAGE_TAKEN: 'DAMAGE_TAKEN', PICKUP: 'PICKUP', RUPTURE: 'RUPTURE',
  PARALYZE: 'PARALYZE',   // 引雷麻痹（CONTROL/PARALYZE 类，绝不同时计作 LIGHTNING）
};

// LV5 因果转化：两个事件标签的组合决定转化结果（键按字母序归一）
const ECHO_COMBOS = {
  'FREEZE+HIT':  'ICE_BREAK',     // HIT + FREEZE → 冰裂
  'HIT+LINK':    'LINK_BURST',    // HIT + LINK → 连线爆发
  'CRIT+HIT':    'CRIT_PULSE',    // HIT + CRIT → 暴击脉冲
  'DEATH_SHADOW+HIT': 'DEATH_CHARGE', // DEATH_SHADOW + HIT → 死亡节点提前临界
  'LINK+LINK':   'LONG_CHAIN',    // LINK + LINK → 长链（连线传播加倍）
  'EXPLOSION+HIT': 'SHARD_BURST', // EXPLOSION + HIT → 碎片爆发
  'HIT+LIGHTNING': 'ARC_CHAIN',   // LIGHTNING + HIT → 电弧连锁
};

// 组合键归一（两标签按字母序）
function _comboKey(a, b) {
  return (a < b) ? (a + '+' + b) : (b + '+' + a);
}

const EchoManager = {
  echoes: [],       // 活跃因果节点（含死亡回响节点）
  zones: [],        // 区域（弱化死亡阴影 / 减速 / 延迟爆炸预备 / 裂口残留）
  fx: [],           // 视觉特效（触发闪光 / 连线 / 电弧 / 反击波等）
  causalLinks: [],  // 因果连线（节点 A ↔ 节点 B，事件沿连线传播）
  replayDepth: 0,   // > 0 表示反应执行中：机制只触发弱化版本，且不生成完整节点
  playerGuard: { timer: 0, amount: 0 },  // LV7 受击反制：玩家短暂减伤

  _haste: { stacks: 0, timer: 0 },       // LV6 连锁回声：连锁等级（加速下一条链）
  _nextDelayBonus: 0,                    // 冰裂等奖励：下一个节点延迟一次性缩减
  _targetCd: new Map(),   // 同目标同反应冷却（400ms）
  _chainCounts: new Map(),// chainId -> 已发生反应次数（≤ maxChainLength）
  _poolEcho: [],          // 节点对象复用池
  _poolFx: [],            // 特效对象复用池
  _poolZone: [],          // 区域对象复用池
  _eventSeq: 1,
  _chainSeq: 1,
  _pruneTimer: 0,

  // ── 技能范围倍率（通用 BUFF「暗影领域」联动）────────────────────────────
  skillRangeMult(state) {
    const p = state && state.player;
    return (p && p.skillRangeMult) ? p.skillRangeMult : 1;
  },
  // ── 机制冷却倍率（通用 BUFF「暗影律动」联动，越小越快）──────────────────
  mechCooldownMult(state) {
    const p = state && state.player;
    return (p && p.mechCooldownMult) ? p.mechCooldownMult : 1;
  },

  // ── 重置（死亡 / 通关 / 重开 / 新开局必须清空）────────────────────────────
  clear() {
    this.echoes.length = 0;
    this.zones.length = 0;
    this.fx.length = 0;
    this.causalLinks.length = 0;
    this.replayDepth = 0;
    this.playerGuard.timer = 0;
    this.playerGuard.amount = 0;
    this._haste.stacks = 0;
    this._haste.timer = 0;
    this._nextDelayBonus = 0;
    this._targetCd.clear();
    this._chainCounts.clear();
    this._eventSeq = 1;
    this._chainSeq = 1;
    this._pruneTimer = 0;
    if (typeof WhiteRuptureFX !== 'undefined') WhiteRuptureFX.clear();
  },

  // ── 事件构造（统一字段：source / chainId / reactionDepth / canCreateNode ...）──
  makeEvent(type, x, y, angle, damage, source, opts) {
    const e = {
      id: this._eventSeq++,
      type: type,
      x: x, y: y,
      angle: angle || 0,
      damage: damage || 0,
      source: source || 'player',
      targetId: -1,
      tx: x, ty: y,            // 原始目标位置快照
      radius: 0,
      length: 0,
      chainId: this._chainSeq++,
      reactionDepth: 0,
      canCreateNode: true,
      canTriggerMechanic: true,
      excludeNodeId: -1,
      tags: null
    };
    if (opts) {
      if (opts.targetId != null) e.targetId = opts.targetId;
      if (opts.tx != null) e.tx = opts.tx;
      if (opts.ty != null) e.ty = opts.ty;
      if (opts.radius != null) e.radius = opts.radius;
      if (opts.length != null) e.length = opts.length;
      if (opts.chainId != null) e.chainId = opts.chainId;
      if (opts.reactionDepth != null) e.reactionDepth = opts.reactionDepth;
      if (opts.canCreateNode != null) e.canCreateNode = opts.canCreateNode;
      if (opts.canTriggerMechanic != null) e.canTriggerMechanic = opts.canTriggerMechanic;
      if (opts.excludeNodeId != null) e.excludeNodeId = opts.excludeNodeId;
      if (opts.tags) e.tags = opts.tags;
    }
    return e;
  },

  // ── 统一事件入口：所有攻击 / 机制 / 死亡事件从这里进入因果系统 ────────────
  // 事件至少携带 type / x / y / targetId / source / chainId / reactionDepth
  //            / canCreateNode / canTriggerMechanic
  emitGameEvent(evt, state) {
    if (!evt || !state || state.genre !== 3) return;
    this.processCausalEvent(evt, state);
  },

  // ── 因果事件处理：按概率生成节点 + 广播给接收半径内的节点 ─────────────────
  processCausalEvent(evt, state) {
    if (!state || state.genre !== 3 || !evt) return;
    // 超过最大反应深度：保留视觉，但不生成节点、不再推进
    if (evt.reactionDepth > CAUSAL_RULES.maxReactionDepth) return;
    // 单条链反应次数上限
    const chainCount = this._chainCounts.get(evt.chainId) || 0;
    if (chainCount >= CAUSAL_RULES.maxChainLength) return;

    // 1) 生成节点（事件本身落点固定；反应事件 canCreateNode=false 不生成完整节点）
    if (evt.canCreateNode && this._nodeChance(evt, state)) {
      if (this.echoes.length < CAUSAL_RULES.maxActiveNodes) {
        this.createCausalNode(evt, state);
      }
    }
    // 2) 投递给接收半径内的节点（记录事件标签 → 推进反应）
    this._broadcastToNodes(evt, state);
  },

  // 节点生成概率：命中 15% / Lv2 起 25%，其他事件 20%
  _nodeChance(evt, state) {
    const cfg = CONFIG.CAUSAL;
    const p = (evt.type === ECHO_EVENT.HIT || evt.type === ECHO_EVENT.CRIT)
      ? (state.genreLv >= 2 ? cfg.LV2_ECHO_CHANCE : cfg.BASE_ECHO_CHANCE)
      : cfg.OTHER_ECHO_CHANCE;
    return Math.random() < p;
  },

  // ── 创建因果节点（延迟残响升级为节点：先延迟复现，再吸收后续事件）────────
  createCausalNode(evt, state) {
    const cfg = CONFIG.CAUSAL;
    const e = this._poolEcho.pop() || {};
    const delayMs = cfg.NODE_DELAY_MS *
      (1 - cfg.HASTE_DELAY_REDUCTION * this._haste.stacks) * this.mechCooldownMult(state) -
      this._nextDelayBonus * 1000;
    this._nextDelayBonus = 0;

    e.id = this._eventSeq++;
    e.x = evt.x;
    e.y = evt.y;
    e.angle = evt.angle;
    e.tx = evt.tx;
    e.ty = evt.ty;
    e.dmg = evt.damage || 0;
    e.targetId = evt.targetId;
    e.createdAt = state.time;
    e.lifetime = CAUSAL_RULES.nodeLifetime;
    e.timer = 0;
    e.delayLeft = Math.max(80, delayMs) / 1000;
    e.triggered = false;
    e.source = evt.source || 'player';
    e.sourceEventType = evt.type;
    e.tags = [];
    e.tagTimes = {};
    e.bonusTags = 0;
    e.state = 'idle';
    e.chainId = evt.chainId;
    e.reactionCount = 0;
    e.reactionDepth = evt.reactionDepth;
    e.inheritedTag = null;
    e.canCreateNode = evt.canCreateNode !== false;
    e.canTriggerMechanic = evt.canTriggerMechanic !== false;
    e.visualSeed = Math.random() * 1000;
    e.isDeathNode = false;
    this.echoes.push(e);
    return e;
  },

  // ── 死亡回响节点（死亡阴影机制卡在流派 3 的表现）────────────────────────
  // 不自动攻击、不吸引敌人、不持续普攻；吸收后续事件，第三标签触发白蚀爆裂
  createDeathCausalNode(x, y, inheritedTag, state) {
    if (!state || state.genre !== 3) return null;
    if (this.echoes.length >= CAUSAL_RULES.maxActiveNodes) {
      // 超出上限时淘汰最旧的普通节点，保证击杀链路能延续
      for (let i = 0; i < this.echoes.length; i++) {
        if (!this.echoes[i].isDeathNode) { this.echoes.splice(i, 1); break; }
      }
      if (this.echoes.length >= CAUSAL_RULES.maxActiveNodes) return null;
    }
    const e = this._poolEcho.pop() || {};
    e.id = this._eventSeq++;
    e.x = x;
    e.y = y;
    e.angle = 0;
    e.tx = x; e.ty = y;
    e.dmg = CONFIG.CAUSAL.PUBLIC_BLAST_DAMAGE;
    e.targetId = -1;
    e.createdAt = state.time;
    e.lifetime = CAUSAL_RULES.deathNodeLifetime;
    e.timer = 0;
    e.delayLeft = 0;              // 死亡回响节点立即就绪
    e.triggered = true;
    e.source = 'death-shadow';
    e.sourceEventType = ECHO_EVENT.DEATH;
    e.tags = [];
    e.tagTimes = {};
    e.bonusTags = 0;
    e.state = 'idle';
    e.chainId = this._chainSeq++;
    e.reactionCount = 0;
    e.reactionDepth = 0;
    e.inheritedTag = null;
    e.canCreateNode = true;
    e.canTriggerMechanic = true;
    e.visualSeed = Math.random() * 1000;
    e.isDeathNode = true;

    // LV7：死亡回响节点继承死亡敌人最近的一个公共机制标签（绝不继承 KILL）
    // 继承只作为第一个标签计入，不能直接完成三标签，仍需后续事件
    if (state.genreLv >= 7 && inheritedTag && inheritedTag !== ECHO_EVENT.KILL) {
      e.inheritedTag = inheritedTag;
      e.tags.push(inheritedTag);
      e.tagTimes[inheritedTag] = state.time;
      e.state = 'charged';
    }
    this.echoes.push(e);
    return e;
  },

  // ── 事件广播：位置在节点接收半径内的节点记录该事件标签 ───────────────────
  _broadcastToNodes(evt, state) {
    const recv = CONFIG.CAUSAL.NODE_RECV_RADIUS;
    const tag = evt.type;
    for (let i = 0; i < this.echoes.length; i++) {
      const node = this.echoes[i];
      if (node.state === 'consumed' || node.state === 'critical') continue;
      // 反应事件不反馈自身节点（防节点通过自身反应无限推进）
      if (evt.excludeNodeId === node.id) continue;
      const dx = evt.x - node.x, dy = evt.y - node.y;
      const rr = recv + 24;
      if (dx * dx + dy * dy > rr * rr) continue;
      this.recordNodeTag(node, tag, state, false);
    }
  },

  // ── 记录节点事件标签（同一节点 250ms 内不重复记录同种标签；只记不同标签）──
  recordNodeTag(node, tag, state, force, noPropagate) {
    if (!node || node.state === 'consumed' || node.state === 'critical') return false;
    if (node.tags.length + node.bonusTags >= CAUSAL_RULES.nodeMaxTags) return false;
    if (node.tags.indexOf(tag) >= 0) return false;
    const now = state.time;
    if (!force) {
      const last = node.tagTimes[tag];
      if (last != null && (now - last) * 1000 < CAUSAL_RULES.sameNodeSameEventCooldown) return false;
    }
    node.tagTimes[tag] = now;
    node.tags.push(tag);
    this.resolveNodeReaction(node, state);
    // 事件沿因果连线传播（传播不再递归传播，防无限循环）
    if (!noPropagate && node.state !== 'consumed') {
      this._propagateLinks(node, tag, state);
    }
    return true;
  },

  // ── 节点反应：1 标签 charged → 2 标签脉冲 → 3 标签白蚀爆裂 ─────────────────
  resolveNodeReaction(node, state) {
    const progress = node.tags.length + node.bonusTags;
    if (progress <= 0) return;
    if (progress === 1) {
      node.state = 'charged';
      return;
    }
    if (progress === 2) {
      node.state = 'charged';
      this.triggerCausalPulse(node, state);
      return;
    }
    // 第三个不同标签：critical → 白蚀爆裂 → 消耗
    node.state = 'critical';
    this.triggerWhiteRupture(node, state);
    this.consumeCausalNode(node, state, false);
  },

  // ── 节点消耗 / 转为裂口残留（LV7 残响崩解）──────────────────────────────
  consumeCausalNode(node, state, expired) {
    if (node.state === 'consumed') return;
    node.state = 'consumed';
    if (state && state.genreLv >= 7) {
      // LV7：完成反应后产生裂口残留，传播一次弱化 RUPTURE（不生成完整节点）
      this._addZone('crack', node.x, node.y, 55, CONFIG.CAUSAL.CRACK_DURATION, 0, state);
      const targets = this._enemiesNear(node.x, node.y, 140, 2, state);
      const weak = (state.player ? state.player.effectiveDamage : CONFIG.PLAYER_DAMAGE) * 0.2;
      for (let i = 0; i < targets.length; i++) {
        if (this._deal(targets[i], weak, 'RUPTURE', state)) {
          this._emitReaction(ECHO_EVENT.RUPTURE, node, targets[i].x, targets[i].y,
            weak, state, targets[i].id);
        }
      }
    }
  },

  // ── 主更新：连锁衰减 → 区域 → 节点（延迟触发 / 初始复现 / 过期崩解）→ 特效
  update(dt, state) {
    if (!state || state.genre !== 3) return;
    const cfg = CONFIG.CAUSAL;

    // LV6 连锁等级衰减
    if (this._haste.timer > 0) {
      this._haste.timer -= dt;
      if (this._haste.timer <= 0) this._haste.stacks = 0;
    }
    // LV7 玩家减伤衰减
    if (this.playerGuard.timer > 0) {
      this.playerGuard.timer -= dt;
      if (this.playerGuard.timer <= 0) this.playerGuard.amount = 0;
    }

    // 区域（弱化死亡阴影 / 减速 / 延迟爆炸 / 裂口残留）
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.timer -= dt;
      if (z.kind === 'death') {
        z.tickTimer -= dt;
        if (z.tickTimer <= 0) {
          z.tickTimer = cfg.ZONE_TICK;
          this._positionalAoe(z.x, z.y, z.radius, z.dmg, 'ZONE', state, 99);
        }
      } else if (z.kind === 'slow') {
        z.tickTimer -= dt;
        if (z.tickTimer <= 0) {
          z.tickTimer = 0.3;
          const enemies = state.enemies;
          for (let k = 0; k < enemies.length; k++) {
            const e2 = enemies[k];
            if (!e2.alive) continue;
            const dx = e2.x - z.x, dy = e2.y - z.y;
            const rr = z.radius + e2.radius;
            if (dx * dx + dy * dy < rr * rr) {
              if (e2.freezeTimer < 0.6) e2.freezeTimer = 0.6;
              if (e2.freezeSpeedMult > 0.5) e2.freezeSpeedMult = 0.5;
            }
          }
        }
      } else if (z.kind === 'blast') {
        if (z.timer <= 0) {
          this._positionalAoe(z.x, z.y, z.radius, z.dmg, 'EXPLOSION', state, 5);
          this._pushFx('flash', z.x, z.y, 0.35);
          Particles.spawn(z.x, z.y, '#35f0ff', 10, 130, 0.5);
        }
      }
      // kind 'crack'：纯视觉裂口（渲染层绘制，无持续伤害）
      if (z.timer <= 0) {
        this._releaseZone(z);
        this.zones.splice(i, 1);
      }
    }

    // 因果节点：延迟 → 初始复现 → 吸收事件 → 过期崩解
    for (let i = this.echoes.length - 1; i >= 0; i--) {
      const node = this.echoes[i];
      if (node.state === 'consumed') {
        this.echoes.splice(i, 1);
        this._releaseEcho(node);
        continue;
      }
      node.timer += dt;
      if (!node.triggered) {
        node.delayLeft -= dt;
        if (node.delayLeft <= 0) {
          node.triggered = true;
          this._initialReplay(node, state);
          // 来源事件作为第一个标签计入（charged）
          this.recordNodeTag(node, node.sourceEventType, state, true);
        }
      } else if (node.timer >= node.lifetime) {
        this.consumeCausalNode(node, state, true);
      }
    }

    // 特效衰减
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.life -= dt;
      if (f.life <= 0) {
        this._releaseFx(f);
        this.fx.splice(i, 1);
      }
    }

    // 冷却表 / 链计数定期清理（防长局内存增长）
    this._pruneTimer -= dt;
    if (this._pruneTimer <= 0) {
      this._pruneTimer = 3;
      const now = state.time;
      if (this._targetCd.size > 64) {
        for (const [k, t] of this._targetCd) if (now - t > 2) this._targetCd.delete(k);
      }
      if (this._chainCounts.size > 64) {
        for (const [k, t] of this._chainCounts) if (now - t > 2) this._chainCounts.delete(k);
      }
    }
  },

  // ── 初始复现（延迟残响的兼容体验：弱化复现原事件，不移动、不索敌）────────
  _initialReplay(node, state) {
    this.replayDepth++;
    try {
      const mult = (state.genreLv >= 2 &&
        (node.sourceEventType === ECHO_EVENT.HIT || node.sourceEventType === ECHO_EVENT.CRIT))
        ? CONFIG.CAUSAL.LV2_HIT_MULT : 0.4;
      const dmg = (node.dmg || CONFIG.PLAYER_DAMAGE) * mult;
      switch (node.sourceEventType) {
        case ECHO_EVENT.HIT:
        case ECHO_EVENT.CRIT:
          this._hitReplay({ x: node.x, y: node.y, tx: node.tx, ty: node.ty,
            targetId: node.targetId, dmg: dmg, srcTags: [] }, state,
            node.sourceEventType === ECHO_EVENT.CRIT);
          break;
        case ECHO_EVENT.PROJECTILE:
          this._spawnShards({ x: node.x, y: node.y, angle: node.angle }, node.angle,
            1, dmg, state);
          break;
        case ECHO_EVENT.PENETRATE:
          this._lineBurst(node.x, node.y, node.angle, CONFIG.CAUSAL.LINE_LENGTH, dmg, state);
          break;
        case ECHO_EVENT.DAMAGE_TAKEN:
          this._counterWave(node.x, node.y, dmg, state);
          break;
        case ECHO_EVENT.CONTROL:
        case ECHO_EVENT.FREEZE:
          this._weakFreeze(node.x, node.y, dmg, state);
          break;
        case ECHO_EVENT.EXPLOSION:
          this._positionalAoe(node.x, node.y,
            (node.radius || CONFIG.CAUSAL.PUBLIC_BLAST_RADIUS) * 0.7,
            dmg, 'EXPLOSION', state, 4);
          break;
        case ECHO_EVENT.LIGHTNING:
          this._positionalAoe(node.x, node.y,
            node.radius || CONFIG.CAUSAL.PUBLIC_LIGHTNING_CHAIN_RANGE,
            dmg, 'LIGHTNING', state, 2);
          break;
        case ECHO_EVENT.LINK:
          this._lineBurst(node.x, node.y, node.angle,
            (node.length || CONFIG.CAUSAL.LINK_BASE_LENGTH) * 0.6, dmg, state, 'LINK', 3);
          break;
        case ECHO_EVENT.DEATH_SHADOW:
          this._addZone('death', node.x, node.y, 60,
            CONFIG.DEATH_SHADOW_DURATION * 0.5, dmg, state);
          break;
        default:
          this._positionalAoe(node.x, node.y, 60, dmg, 'HIT', state, 3);
          break;
      }
      this._pushFx('flash', node.x, node.y, 0.35);
      Particles.spawn(node.x, node.y, '#b04cff', 8, 110, 0.4);
      Particles.spawn(node.x, node.y, '#35f0ff', 6, 90, 0.4);
    } finally {
      this.replayDepth--;
    }
  },

  // ── 小型脉冲（第二个不同标签）：按来源机制 / 双标签组合分流 ──────────────
  triggerCausalPulse(node, state) {
    const cfg = CONFIG.CAUSAL;
    const lv = state.genreLv;
    // LV3 双重回放：双标签组合反应，脉冲强度提升
    let combo = null;
    if (node.tags.length >= 2) {
      const key = _comboKey(node.tags[node.tags.length - 1], node.tags[node.tags.length - 2]);
      if (lv >= 5 && ECHO_COMBOS[key]) combo = ECHO_COMBOS[key];
      else if (lv >= 3) combo = 'PULSE';   // LV3：任意双标签强化脉冲
    }
    const comboMult = (combo && combo !== 'PULSE') ? cfg.COMBO_PULSE_MULT
      : (combo === 'PULSE' ? 1.25 : 1);
    const baseDmg = (state.player ? state.player.effectiveDamage : CONFIG.PLAYER_DAMAGE)
      * cfg.NODE_PULSE_MULT * comboMult;

    this.replayDepth++;
    try {
      // 组合转化优先（LV5），其次按来源机制类型分流
      if (combo === 'ICE_BREAK') {
        this._iceBreak(node, state, baseDmg * 1.2);
      } else if (combo === 'DEATH_CHARGE') {
        // 死亡节点提前临界：进度 +1（虚拟进度，仍需至少一个后续事件）
        node.bonusTags = Math.min(1, node.bonusTags + 1);
        this._positionalAoe(node.x, node.y, cfg.NODE_PULSE_RADIUS, baseDmg, 'HIT', state, 3);
        this._pushFx('burst', node.x, node.y, 0.3);
      } else if (combo === 'LINK_BURST' || combo === 'LONG_CHAIN') {
        this._lineBurst(node.x, node.y, node.angle || 0,
          combo === 'LONG_CHAIN' ? cfg.LINK_BASE_LENGTH * 1.5 : cfg.LINK_BASE_LENGTH,
          baseDmg, state, 'LINK', combo === 'LONG_CHAIN' ? 4 : 3);
      } else if (combo === 'SHARD_BURST') {
        this._spawnShards(node, node.angle, 3, baseDmg * 0.6, state);
      } else if (combo === 'ARC_CHAIN') {
        this._localLightning(node, baseDmg, state);
      } else if (combo === 'CRIT_PULSE') {
        this._positionalAoe(node.x, node.y, cfg.NODE_PULSE_RADIUS * 1.2,
          baseDmg * 1.1, 'CRIT', state, 4);
        this._pushFx('burst', node.x, node.y, 0.35);
      } else {
        // 按节点来源机制分流（机制复现：节点与后续事件产生反应）
        switch (node.sourceEventType) {
          case ECHO_EVENT.CONTROL:
          case ECHO_EVENT.FREEZE:
            this._iceBreak(node, state, baseDmg);
            break;
          case ECHO_EVENT.EXPLOSION:
            this._positionalAoe(node.x, node.y,
              (node.radius || cfg.PUBLIC_BLAST_RADIUS) * 0.7, baseDmg, 'EXPLOSION', state, 5);
            this._pushFx('burst', node.x, node.y, 0.3);
            break;
          case ECHO_EVENT.LIGHTNING:
            this._localLightning(node, baseDmg, state);
            break;
          case ECHO_EVENT.LINK:
            this._lineBurst(node.x, node.y, node.angle, cfg.LINK_BASE_LENGTH * 0.6,
              baseDmg, state, 'LINK', 3);
            break;
          case ECHO_EVENT.DEATH_SHADOW:
          case ECHO_EVENT.DEATH:
            this._positionalAoe(node.x, node.y, 70, baseDmg, 'HIT', state, 3);
            this._pushFx('wave', node.x, node.y, 0.35);
            break;
          default:
            this._positionalAoe(node.x, node.y, cfg.NODE_PULSE_RADIUS, baseDmg, 'HIT', state, 3);
            this._pushFx('burst', node.x, node.y, 0.25);
            break;
        }
      }
    } finally {
      this.replayDepth--;
    }
    // 脉冲是一次真实反应：推进其他节点（不生成完整节点）
    this._chainTick(node.chainId, state);
    this._emitReaction(ECHO_EVENT.RUPTURE, node, node.x, node.y, baseDmg, state);
  },

  // ── 冰裂（冰封节点的反应）：弱化范围伤害 + 短暂减速，不是重播一次冰封 ──────
  _iceBreak(node, state, dmg) {
    const cfg = CONFIG.CAUSAL;
    const radius = Utils.rand(cfg.ICE_BREAK_RADIUS_MIN, cfg.ICE_BREAK_RADIUS_MAX)
      * this.skillRangeMult(state);
    const breakDmg = dmg * Utils.rand(cfg.ICE_BREAK_MULT_MIN, cfg.ICE_BREAK_MULT_MAX) / 0.5;
    const targets = this._enemiesNear(node.x, node.y, radius, 8, state);
    let hits = 0;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (!this._deal(t, breakDmg, 'RUPTURE', state)) continue;
      // 短暂减速（不重新占用完整冰封冷却）
      if (t.freezeTimer < 0.6) t.freezeTimer = 0.6;
      if (t.freezeSpeedMult > 0.5) t.freezeSpeedMult = 0.5;
      hits++;
    }
    // 对至少两个目标生效：下一个因果节点延迟一次性减少
    if (hits >= 2) this._nextDelayBonus = Math.max(this._nextDelayBonus, 0.3);
    this._pushFx('wave', node.x, node.y, 0.4);
    Particles.spawn(node.x, node.y, '#3c8cff', 10, 120, 0.5);
  },

  // ── 局部电击（闪电节点的反应）────────────────────────────────────────────
  _localLightning(node, dmg, state) {
    const cfg = CONFIG.CAUSAL;
    const targets = this._enemiesNear(node.x, node.y,
      cfg.PUBLIC_LIGHTNING_CHAIN_RANGE, cfg.PUBLIC_LIGHTNING_MAX_TARGETS, state);
    let hits = 0;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (this._deal(t, dmg, 'LIGHTNING', state)) {
        this._pushFx('lightning', node.x, node.y, 0.3, { x2: t.x, y2: t.y });
        hits++;
      }
    }
    if (hits === 0) this._pushFx('fizzle', node.x, node.y, 0.25);
  },

  // ── 白蚀爆裂 / White Rupture（第三标签：流派 3 的核心爆发）────────────────
  // 触发来源：节点三标签 / 死亡回响节点三标签 / 三节点连线闭环 / 连锁第三次跳转
  triggerWhiteRupture(node, state) {
    this.triggerWhiteRuptureAt(node.x, node.y, node.chainId, node.reactionDepth,
      node.canCreateNode, state);
  },

  triggerWhiteRuptureAt(x, y, chainId, depth, canCreateNode, state) {
    const cfg = CONFIG.CAUSAL;
    const radius = cfg.RUPTURE_RADIUS * this.skillRangeMult(state);
    const dmg = (state.player ? state.player.effectiveDamage : CONFIG.PLAYER_DAMAGE)
      * cfg.RUPTURE_DAMAGE_MULT;

    // 基础效果：范围内真实伤害 + RUPTURE 标签（真实击杀正常走死亡流程）
    const targets = this._enemiesNear(x, y, radius, 99, state);
    let hits = 0;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (this._deal(t, dmg, 'RUPTURE', state)) hits++;
    }
    // RUPTURE 事件广播（推进附近节点，形成连锁；不生成完整节点）
    this._chainTick(chainId, state);
    this._emitReaction(ECHO_EVENT.RUPTURE, { chainId, reactionDepth: depth },
      x, y, dmg, state);

    // 爆裂中心生成弱化因果节点（不继承完整三标签状态）
    if (canCreateNode && this.echoes.length < CAUSAL_RULES.maxActiveNodes) {
      for (let i = 0; i < cfg.RUPTURE_CHILD_NODES; i++) {
        if (this.echoes.length >= CAUSAL_RULES.maxActiveNodes) break;
        const ang = Math.random() * Math.PI * 2;
        const evt = this.makeEvent(ECHO_EVENT.RUPTURE,
          x + Math.cos(ang) * 18, y + Math.sin(ang) * 18, ang, dmg * 0.3, 'echo',
          { chainId, reactionDepth: depth + 1, canCreateNode: true });
        const child = this.createCausalNode(evt, state);
        if (child) {
          // 弱化节点：直接就绪，只继承一个来源标签
          child.delayLeft = 0;
          child.triggered = true;
          child.dmg = dmg * 0.3;
          child.sourceEventType = ECHO_EVENT.RUPTURE;
          this.recordNodeTag(child, ECHO_EVENT.RUPTURE, state, true);
        }
      }
    }

    // LV6 连锁回声：白蚀爆裂影响 ≥3 个敌人 → 连锁等级 +1（最多 3 层，4s 衰减）
    if (state.genreLv >= 6 && hits >= 3) {
      this._haste.stacks = Math.min(CONFIG.CAUSAL.HASTE_MAX_STACKS, this._haste.stacks + 1);
      this._haste.timer = CONFIG.CAUSAL.HASTE_DURATION;
    }

    // 裂口弧线目标（3~5 个，取爆心附近存活敌人，不足随机方向补位）
    const arcCount = Utils.randInt(cfg.RUPTURE_ARC_COUNT_MIN, cfg.RUPTURE_ARC_COUNT_MAX);
    const arcs = [];
    const near = this._enemiesNear(x, y, radius * 2.2, arcCount, state);
    for (let i = 0; i < near.length && arcs.length < arcCount; i++) {
      arcs.push({ x: near[i].x, y: near[i].y, targetId: near[i].id });
    }
    while (arcs.length < arcCount) {
      const ang = Math.random() * Math.PI * 2;
      const d = Utils.rand(radius * 0.6, radius * 1.4);
      arcs.push({ x: x + Math.cos(ang) * d, y: y + Math.sin(ang) * d, targetId: -1 });
    }

    // 视觉：四阶段白蚀爆裂（预兆 / 核心压缩 / 爆裂 / 裂口残留）
    if (typeof WhiteRuptureFX !== 'undefined') {
      WhiteRuptureFX.spawn(x, y, {
        radius, seed: Math.random() * 1000, arcs,
        reactionDepth: depth, chainId,
      });
    }
    // 兜底粒子（白蚀爆裂主视觉由 WhiteRuptureFX 承担）
    Particles.spawn(x, y, '#ffffff', 10, 160, 0.5);
    Particles.spawn(x, y, '#b04cff', 8, 130, 0.5);
  },

  // ── 白蚀爆裂裂口弧线（视觉进入裂口残留阶段时回调一次）────────────────────
  handleRuptureArcs(effect, state) {
    if (!state) return;
    const cfg = CONFIG.CAUSAL;
    const dmg = (state.player ? state.player.effectiveDamage : CONFIG.PLAYER_DAMAGE)
      * cfg.RUPTURE_DAMAGE_MULT * cfg.RUPTURE_ARC_MULT;
    const depth = (effect && effect.reactionDepth != null) ? effect.reactionDepth : 0;
    if (depth > CAUSAL_RULES.maxReactionDepth) return;
    const arcs = (effect && effect.arcs) || [];
    for (let i = 0; i < arcs.length; i++) {
      const a = arcs[i];
      // 弱化 RUPTURE：一次性小范围传播（弧线不是自动攻击单位）
      this._positionalAoe(a.x, a.y, 40, dmg, 'RUPTURE', state, 1);
      this._emitReaction(ECHO_EVENT.RUPTURE,
        { chainId: effect.chainId, reactionDepth: depth + 1 },
        a.x, a.y, dmg, state);
      Particles.spawn(a.x, a.y, '#ffffff', 3, 70, 0.3);
    }
  },

  // ── 反应事件：反应可推进其他节点（连锁），但不能生成完整节点 ─────────────
  _emitReaction(type, parent, x, y, damage, state, targetId) {
    const depth = ((parent && parent.reactionDepth) || 0) + 1;
    if (depth > CAUSAL_RULES.maxReactionDepth) return;
    const evt = this.makeEvent(type, x, y, 0, damage, 'echo', {
      targetId: targetId != null ? targetId : -1,
      chainId: (parent && parent.chainId) || 0,
      reactionDepth: depth,
      canCreateNode: false,
      canTriggerMechanic: (parent && parent.canTriggerMechanic) !== false,
      excludeNodeId: (parent && parent.id != null) ? parent.id : -1,
      tags: [type],
    });
    this.replayDepth++;
    try {
      this.processCausalEvent(evt, state);
    } finally {
      this.replayDepth--;
    }
  },

  // 单条链反应计数（≤ maxChainLength）
  _chainTick(chainId, state) {
    const n = (this._chainCounts.get(chainId) || 0) + 1;
    this._chainCounts.set(chainId, n);
    return n;
  },

  // ── 公共机制 · 流派 3 适配入口 ───────────────────────────────────────────

  // 公共爆炸：爆炸中心生成爆裂节点，范围内有效敌人提供事件输入
  // hitCount ≥1 → HIT 输入（小型脉冲）；hitCount ≥3 → RUPTURE 输入（白蚀爆裂）
  onExplosionNode(x, y, radius, dmg, hitCount, state) {
    if (!state || state.genre !== 3) return;
    if (this.echoes.length >= CAUSAL_RULES.maxActiveNodes) return;
    const evt = this.makeEvent(ECHO_EVENT.EXPLOSION, x, y, 0, dmg, 'mechanic', {
      radius,
      tags: [ECHO_EVENT.EXPLOSION, ECHO_EVENT.HIT],
    });
    const node = this.createCausalNode(evt, state);
    if (!node) return;
    node.delayLeft = 0;
    node.triggered = true;
    this.recordNodeTag(node, ECHO_EVENT.EXPLOSION, state, true);
    if (hitCount >= 1) this.recordNodeTag(node, ECHO_EVENT.HIT, state, true);
    if (hitCount >= 3) this.recordNodeTag(node, ECHO_EVENT.RUPTURE, state, true);
    Particles.spawn(x, y, '#ff9a3c', 10, 140, 0.5);
  },

  // 公共闪电：每个跳转目标留下闪电节点，可连接或合并
  onLightningNode(x, y, dmg, hitList, state) {
    if (!state || state.genre !== 3) return;
    const made = [];
    for (let i = 0; i < hitList.length; i++) {
      if (this.echoes.length >= CAUSAL_RULES.maxActiveNodes) break;
      const t = hitList[i];
      const evt = this.makeEvent(ECHO_EVENT.LIGHTNING, t.x, t.y, 0, dmg, 'mechanic', {
        targetId: t.id,
        radius: CONFIG.CAUSAL.PUBLIC_LIGHTNING_CHAIN_RANGE,
        tags: [ECHO_EVENT.LIGHTNING, ECHO_EVENT.HIT],
      });
      const node = this.createCausalNode(evt, state);
      if (!node) continue;
      node.delayLeft = 0;
      node.triggered = true;
      this.recordNodeTag(node, ECHO_EVENT.LIGHTNING, state, true);
      made.push(node);
    }
    // 闪电节点合并：距离在连锁范围内的两个节点，标签并入较新节点
    const range = CONFIG.CAUSAL.PUBLIC_LIGHTNING_CHAIN_RANGE;
    for (let i = 0; i < made.length; i++) {
      for (let j = i + 1; j < made.length; j++) {
        const a = made[i], b = made[j];
        if (a.state === 'consumed' || b.state === 'consumed') continue;
        const dx = a.x - b.x, dy = a.y - b.y;
        if (dx * dx + dy * dy > range * range) continue;
        for (const tag of b.tags) {
          this.recordNodeTag(a, tag, state, true);
        }
        this.consumeCausalNode(b, state, false);
      }
    }
  },

  // 引雷（Sky Thunder）· LIGHTNING_STRIKE：雷柱落地
  // 在落点生成一个闪电因果节点（LIGHTNING 标签只记一次；可参与 HIT/CRIT/FREEZE 等组合）
  onSkyThunderStrike(x, y, dmg, state) {
    if (!state || state.genre !== 3) return;
    if (this.echoes.length >= CAUSAL_RULES.maxActiveNodes) return;
    const evt = this.makeEvent(ECHO_EVENT.LIGHTNING, x, y, 0, dmg, 'mechanic', {
      radius: CONFIG.CAUSAL.PUBLIC_LIGHTNING_CHAIN_RANGE,
      tags: [ECHO_EVENT.LIGHTNING],
    });
    const node = this.createCausalNode(evt, state);
    if (!node) return;
    node.delayLeft = 0;
    node.triggered = true;
    this.recordNodeTag(node, ECHO_EVENT.LIGHTNING, state, true);
  },

  // 引雷 · LIGHTNING_TICK：雷区有限度推进附近已有节点
  // tick 绝不创建节点、绝不重复添加 LIGHTNING 标签（重复标签由 recordNodeTag 拒绝）；
  // contributedNodes 保证同一雷区对同一节点最多贡献一次
  onSkyThunderZoneTick(x, y, radius, state, contributedNodes) {
    if (!state || state.genre !== 3) return;
    const rr = radius + 24;
    for (let i = 0; i < this.echoes.length; i++) {
      const node = this.echoes[i];
      if (node.state === 'consumed' || node.state === 'critical') continue;
      const dx = x - node.x, dy = y - node.y;
      if (dx * dx + dy * dy > rr * rr) continue;
      if (contributedNodes) {
        if (contributedNodes.has(node.id)) continue;
        contributedNodes.set(node.id, state.time);
      }
      // noPropagate：雷区 tick 不沿因果连线传播（防链式无限推进）
      this.recordNodeTag(node, ECHO_EVENT.LIGHTNING, state, true, true);
    }
  },

  // 引雷 · PARALYZE：雷区麻痹（CONTROL/PARALYZE 事件）
  // 不创建完整因果节点（canCreateNode: false），只推进已有节点
  onSkyThunderParalyze(x, y, target, state) {
    if (!state || state.genre !== 3) return;
    this.processCausalEvent(this.makeEvent(ECHO_EVENT.PARALYZE, x, y, 0, 0, 'sky-thunder-zone',
      { targetId: target ? target.id : -1, canCreateNode: false,
        tags: [ECHO_EVENT.PARALYZE], reactionDepth: this.replayDepth }), state);
  },

  // 暗影连线 · 流派 3：因果连线（连接节点、传播事件、闭合结构触发白蚀爆裂）
  // 不是流派 0 的暗影攻击，也不是流派 1 的漩涡控制
  updateCausalLinks(dt, player, enemies, state) {
    const nodes = [];
    for (let i = 0; i < this.echoes.length; i++) {
      const n = this.echoes[i];
      if (n.state !== 'consumed' && n.triggered) nodes.push(n);
    }
    this.causalLinks.length = 0;
    if (nodes.length < 2) return;

    // 重建连线：距离 ≤ LINK_NODE_RANGE 的节点配对，最多连接 3 个节点
    const maxNodes = CONFIG.CAUSAL.LINK_NODE_MAX;
    const rangeSq = CONFIG.CAUSAL.LINK_NODE_RANGE * CONFIG.CAUSAL.LINK_NODE_RANGE;
    const grouped = [];
    for (let i = 0; i < nodes.length && grouped.length < maxNodes; i++) {
      let join = false;
      for (let j = 0; j < grouped.length; j++) {
        const g = grouped[j];
        const dx = nodes[i].x - g.x, dy = nodes[i].y - g.y;
        if (dx * dx + dy * dy <= rangeSq) { join = true; break; }
      }
      if (join || grouped.length === 0) grouped.push(nodes[i]);
    }
    for (let i = 0; i < grouped.length; i++) {
      for (let j = i + 1; j < grouped.length; j++) {
        const a = grouped[i], b = grouped[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        if (dx * dx + dy * dy <= rangeSq) {
          this.causalLinks.push({ a, b });
        }
      }
    }
    if (this.causalLinks.length === 0) return;

    // 事件沿连线传播由 recordNodeTag → _propagateLinks 负责；
    // 敌人穿过因果连线：一次伤害 + 向两端节点输入 LINK 标签
    const linkDmg = CONFIG.CAUSAL.LINK_NODE_DAMAGE;
    for (const link of this.causalLinks) {
      for (const e of enemies) {
        if (!e.alive) continue;
        const minX = Math.min(link.a.x, link.b.x) - (e.radius + 10);
        const maxX = Math.max(link.a.x, link.b.x) + (e.radius + 10);
        const minY = Math.min(link.a.y, link.b.y) - (e.radius + 10);
        const maxY = Math.max(link.a.y, link.b.y) + (e.radius + 10);
        if (e.x < minX || e.x > maxX || e.y < minY || e.y > maxY) continue;
        if (this._distToSeg(e.x, e.y, link.a.x, link.a.y, link.b.x, link.b.y) > e.radius + 10) continue;
        if (this._deal(e, linkDmg, 'LINK', state)) {
          this.recordNodeTag(link.a, ECHO_EVENT.LINK, state, false);
          this.recordNodeTag(link.b, ECHO_EVENT.LINK, state, false);
          Particles.spawn(e.x, e.y, '#aa44ff', 3, 50, 0.25);
        }
      }
    }

    // 三个节点形成闭合结构（三角形）→ 白蚀爆裂
    if (this.causalLinks.length >= 3 && grouped.length >= 3) {
      const a = grouped[0], b = grouped[1], c = grouped[2];
      const hasAB = this.causalLinks.some(l =>
        (l.a === a && l.b === b) || (l.a === b && l.b === a));
      const hasBC = this.causalLinks.some(l =>
        (l.a === b && l.b === c) || (l.a === c && l.b === b));
      const hasCA = this.causalLinks.some(l =>
        (l.a === c && l.b === a) || (l.a === a && l.b === c));
      if (hasAB && hasBC && hasCA) {
        const mx = (a.x + b.x + c.x) / 3;
        const my = (a.y + b.y + c.y) / 3;
        this.triggerWhiteRuptureAt(mx, my, a.chainId, 0, true, state);
        this.consumeCausalNode(a, state, false);
        this.consumeCausalNode(b, state, false);
        this.consumeCausalNode(c, state, false);
        this.causalLinks.length = 0;
      }
    }
  },

  // 事件沿连线传播（每次传播生成新的事件标签）
  _propagateLinks(node, tag, state) {
    if (this.causalLinks.length === 0) return;
    for (let i = 0; i < this.causalLinks.length; i++) {
      const link = this.causalLinks[i];
      const other = (link.a === node) ? link.b : ((link.b === node) ? link.a : null);
      if (!other || other.state === 'consumed' || other.state === 'critical') continue;
      this.recordNodeTag(other, tag, state, true, true);
    }
  },

  // ── 便捷事件入口（各系统一行调用；非流派 3 零开销）────────────────────────
  rollCrit() {
    const bonus = (typeof Player !== 'undefined' && Player.critChance) ? Player.critChance : 0;
    return Math.random() < (CONFIG.CAUSAL.CRIT_CHANCE + bonus);
  },

  // 旧接口兼容：事件捕获
  capture(evt, state) {
    this.processCausalEvent(evt, state);
  },

  onHit(x, y, angle, dmg, target, killed, state, crit) {
    if (!state || state.genre !== 3 || this.replayDepth > 0) return;
    const tags = killed ? (crit ? [ECHO_EVENT.CRIT, ECHO_EVENT.KILL] : [ECHO_EVENT.HIT, ECHO_EVENT.KILL])
                        : [crit ? ECHO_EVENT.CRIT : ECHO_EVENT.HIT];
    const evt = this.makeEvent(crit ? ECHO_EVENT.CRIT : ECHO_EVENT.HIT,
      x, y, angle, dmg, 'player',
      { targetId: target ? target.id : -1, tx: target ? target.x : x, ty: target ? target.y : y, tags });
    this.processCausalEvent(evt, state);
  },

  onProjectile(x, y, angle, dmg, state) {
    if (!state || state.genre !== 3 || this.replayDepth > 0) return;
    this.processCausalEvent(this.makeEvent(ECHO_EVENT.PROJECTILE, x, y, angle, dmg, 'player',
      { tags: [ECHO_EVENT.PROJECTILE] }), state);
  },

  // 冰封触发（暗影冰封 · 流派 3：生成冰封因果节点，后续事件触发冰裂）
  // 反应引发的冰封不生成新节点，但仍推进现有节点（限制链深度而非禁止联动）
  onControl(x, y, target, state) {
    if (!state || state.genre !== 3) return;
    this.processCausalEvent(this.makeEvent(ECHO_EVENT.FREEZE,
      target ? target.x : x, target ? target.y : y, 0, CONFIG.PLAYER_DAMAGE, 'mechanic',
      { targetId: target ? target.id : -1, tags: [ECHO_EVENT.FREEZE, ECHO_EVENT.HIT],
        reactionDepth: this.replayDepth, canCreateNode: this.replayDepth === 0 }), state);
  },

  onExplosion(x, y, radius, dmg, state, replay) {
    if (!state || state.genre !== 3) return;
    this.processCausalEvent(this.makeEvent(ECHO_EVENT.EXPLOSION, x, y, 0, dmg, 'mechanic',
      { radius, tags: [ECHO_EVENT.EXPLOSION, ECHO_EVENT.HIT],
        reactionDepth: replay ? 1 : 0, canCreateNode: !replay }), state);
  },

  onLightning(x, y, dmg, target, state) {
    if (!state || state.genre !== 3) return;
    this.processCausalEvent(this.makeEvent(ECHO_EVENT.LIGHTNING, x, y, 0, dmg, 'mechanic',
      { targetId: target ? target.id : -1, radius: CONFIG.CAUSAL.PUBLIC_LIGHTNING_CHAIN_RANGE,
        tags: [ECHO_EVENT.LIGHTNING, ECHO_EVENT.HIT],
        reactionDepth: this.replayDepth > 0 ? 1 : 0 }), state);
  },

  onLink(x, y, angle, dmg, target, state) {
    if (!state || state.genre !== 3) return;
    this.processCausalEvent(this.makeEvent(ECHO_EVENT.LINK, x, y, angle, dmg, 'mechanic',
      { targetId: target ? target.id : -1, length: CONFIG.CAUSAL.LINK_BASE_LENGTH,
        tags: [ECHO_EVENT.LINK, ECHO_EVENT.HIT],
        reactionDepth: this.replayDepth, canCreateNode: this.replayDepth === 0 }), state);
  },

  // 死亡阴影生成（流派 3 的死亡回响节点由 DeathShadowManager 分流创建）
  onDeathShadow(x, y, state) {
    if (!state || state.genre !== 3) return;
    this.processCausalEvent(this.makeEvent(ECHO_EVENT.DEATH_SHADOW, x, y, 0,
      CONFIG.CAUSAL.PUBLIC_BLAST_DAMAGE, 'mechanic',
      { radius: 60, tags: [ECHO_EVENT.DEATH_SHADOW],
        reactionDepth: this.replayDepth, canCreateNode: this.replayDepth === 0 }), state);
  },

  // 真实敌人死亡：只有真实死亡才能产生 DEATH 标签（绝不伪造）
  onDeath(x, y, state) {
    if (!state || state.genre !== 3) return;
    this.processCausalEvent(this.makeEvent(ECHO_EVENT.DEATH, x, y, 0, 0, 'enemy',
      { canCreateNode: false, tags: [ECHO_EVENT.DEATH], reactionDepth: this.replayDepth }), state);
  },

  onKill(x, y, dmg, state) {
    if (!state || state.genre !== 3 || this.replayDepth > 0) return;
    this.processCausalEvent(this.makeEvent(ECHO_EVENT.KILL, x, y, 0, dmg, 'player',
      { tags: [ECHO_EVENT.KILL], canCreateNode: false }), state);
  },

  onDamageTaken(x, y, dmg, state) {
    if (!state || state.genre !== 3 || this.replayDepth > 0) return;
    this.processCausalEvent(this.makeEvent(ECHO_EVENT.DAMAGE_TAKEN, x, y, 0, dmg, 'enemy',
      { tags: [ECHO_EVENT.DAMAGE_TAKEN] }), state);
  },

  onPickup(x, y, dmg, state) {
    if (!state || state.genre !== 3 || this.replayDepth > 0) return;
    this.processCausalEvent(this.makeEvent(ECHO_EVENT.PICKUP, x, y, 0, dmg, 'player',
      { tags: [ECHO_EVENT.PICKUP] }), state);
  },

  // ── 初始复现：命中（严格目标锁定，绝不重新寻找目标）────────────────────
  _hitReplay(e, state, crit) {
    const t = e.targetId >= 0 ? this._findById(state.enemies, e.targetId) : null;
    if (!t || !t.alive) {
      const killed = (e.srcTags && e.srcTags.indexOf(ECHO_EVENT.KILL) >= 0);
      if (killed) {
        this._positionalAoe(e.x, e.y, 60, e.dmg, 'HIT', state, 2);
        this._pushFx('burst', e.x, e.y, 0.25);
      } else {
        this._pushFx('fizzle', e.x, e.y, 0.25);
      }
      return 0;
    }
    const dx = t.x - e.x, dy = t.y - e.y;
    const snap = CONFIG.CAUSAL.TARGET_SNAP_RADIUS;
    if (dx * dx + dy * dy > snap * snap) {
      this._pushFx('fizzle', e.x, e.y, 0.25);   // 目标已远离原位 → 打空
      return 0;
    }
    return this._deal(t, e.dmg, 'HIT', state, crit) ? 1 : 0;
  },

  // ── 弱冰封（初始复现 / 回放触发时的弱化版本：0.6s / 50% 减速）────────────
  _weakFreeze(x, y, dmg, state) {
    const targets = this._enemiesNear(x, y, CONFIG.CAUSAL.MECH_TARGET_RANGE, 2, state);
    let hits = 0;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (!this._deal(t, dmg * 0.2, 'CONTROL', state)) continue;
      if (t.freezeTimer < 0.6) t.freezeTimer = 0.6;
      if (t.freezeSpeedMult > 0.5) t.freezeSpeedMult = 0.5;
      hits++;
    }
    if (hits > 0) Particles.spawn(x, y, '#3c8cff', 8, 90, 0.5);
  },

  // ── 通用效果 ─────────────────────────────────────────────────────────────
  // 位置固定范围伤害（只作用于该位置范围内的敌人，不主动索敌）
  _positionalAoe(x, y, radius, dmg, type, state, maxTargets) {
    const targets = this._enemiesNear(x, y, radius, maxTargets || 99, state);
    let hits = 0;
    for (let i = 0; i < targets.length; i++) {
      if (this._deal(targets[i], dmg, type, state)) hits++;
    }
    return hits;
  },

  // 短程残响碎片（固定方向、一次性、不能创建完整节点）
  _spawnShards(e, baseAngle, count, dmgEach, state) {
    const cfg = CONFIG.CAUSAL;
    const spread = cfg.FRAGMENT_SPREAD;
    for (let i = 0; i < count; i++) {
      const off = (count === 1) ? 0 : (i - (count - 1) / 2) * spread;
      const b = BulletManager.spawn(
        e.x, e.y, baseAngle + off,
        cfg.FRAGMENT_SPEED, dmgEach, cfg.FRAGMENT_RADIUS,
        '#66f6ff', 'echo'
      );
      if (b) {
        b.life = cfg.FRAGMENT_LIFE;
        b.canCreateNode = false;   // fragmentsCanCreateFullNode: false
      }
    }
  },

  // 短距离连线：线段上的敌人受到一次伤害（一次性，不追踪）
  _lineBurst(x, y, angle, len, dmg, state, type, maxTargets) {
    const x2 = x + Math.cos(angle) * len;
    const y2 = y + Math.sin(angle) * len;
    const targets = this._enemiesNear(x, y, len + 60, 8, state);
    let hits = 0;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (this._distToSeg(t.x, t.y, x, y, x2, y2) > t.radius + 10) continue;
      if (this._deal(t, dmg, type || 'HIT', state)) hits++;
      if (hits >= (maxTargets || 3)) break;
    }
    this._pushFx('line', x, y, 0.4, { x2, y2 });
    return hits;
  },

  // 受击反制波：玩家位置向外扩散的伤害波
  _counterWave(x, y, dmg, state) {
    this._positionalAoe(x, y, CONFIG.CAUSAL.COUNTER_WAVE_RADIUS, dmg, 'HIT', state, 5);
    this._pushFx('wave', x, y, 0.4);
    Particles.spawn(x, y, '#35f0ff', 10, 120, 0.5);
  },

  // ── 伤害结算（同目标同反应冷却 + BOSS 减半 + 机制标签记录）────────────────
  _deal(enemy, dmg, type, state, crit) {
    if (!enemy || !enemy.alive) return false;
    if (!this._canAffect(enemy, type, state)) return false;
    let amount = dmg;
    if (enemy.type === 'boss') amount *= CAUSAL_RULES.ruptureBossMultiplier;
    enemy.takeDamage(amount, state, 'echo');
    const sv = Utils.worldToScreen(enemy.x, enemy.y - 20, Renderer.cam);
    Utils.spawnDmgNum(sv.x, sv.y, amount, enemy.type === 'boss' ? 'boss' : (crit ? 'crit' : ''));
    Particles.spawn(enemy.x, enemy.y, crit ? '#35f0ff' : '#b04cff', 4, 50, 0.3);
    // 记录敌人最近的公共机制标签（LV7 死亡回响节点继承用；绝不继承 KILL）
    if (type === 'CONTROL' || type === 'FREEZE' || type === 'EXPLOSION' ||
        type === 'LIGHTNING' || type === 'LINK' || type === 'DEATH_SHADOW') {
      enemy.lastMechanicTag = type;
    }
    // 回放 / 反应触发的机制只能触发弱化版本（弱化冰封：0.6s / 50% 减速）
    if (this.replayDepth > 0 && state.freezeEnabled && enemy.freezeTimer < 0.6) {
      enemy.freezeTimer = 0.6;
      if (enemy.freezeSpeedMult > 0.5) enemy.freezeSpeedMult = 0.5;
    }
    return true;
  },

  // 残响碎片命中结算（由 bullet.js 调用；碎片不能创建完整节点）
  applyFragmentHit(b, enemy, state) {
    if (!enemy || !enemy.alive) return;
    this._deal(enemy, b.damage, 'HIT', state);
  },

  // 同目标同反应冷却（400ms，防无限重复命中同一目标）
  _canAffect(enemy, type, state) {
    const now = (state && state.time != null) ? state.time : 0;
    const key = enemy.id + '|' + type;
    const last = this._targetCd.get(key);
    if (last != null && (now - last) * 1000 < CAUSAL_RULES.sameTargetSameReactionCooldown) return false;
    this._targetCd.set(key, now);
    return true;
  },

  // ── 查询工具（内部距离缓冲复用；结果数组独立，支持嵌套调用）──────────────
  _nearBufE: [],
  _nearBufD: [],
  _enemiesNear(x, y, radius, maxN, state) {
    const bufE = this._nearBufE;
    const bufD = this._nearBufD;
    bufE.length = 0;
    bufD.length = 0;
    const enemies = (state && state.enemies) || EnemyManager.enemies;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      const dx = e.x - x, dy = e.y - y;
      const rr = radius + e.radius;
      const dSq = dx * dx + dy * dy;
      if (dSq > rr * rr) continue;
      bufE.push(e);
      bufD.push(dSq);
    }
    // 取最近 N 个（N 很小，简单选择排序即可）
    const n = Math.min(bufE.length, maxN || 99);
    for (let i = 0; i < n; i++) {
      let minIdx = i;
      for (let j = i + 1; j < bufE.length; j++) {
        if (bufD[j] < bufD[minIdx]) minIdx = j;
      }
      if (minIdx !== i) {
        const te = bufE[i], td = bufD[i];
        bufE[i] = bufE[minIdx]; bufD[i] = bufD[minIdx];
        bufE[minIdx] = te; bufD[minIdx] = td;
      }
    }
    return bufE.slice(0, n);
  },

  _findById(enemies, id) {
    if (!enemies) return null;
    for (let i = 0; i < enemies.length; i++) {
      if (enemies[i].id === id) return enemies[i];
    }
    return null;
  },

  _distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const cx = x1 + t * dx - px;
    const cy = y1 + t * dy - py;
    return Math.sqrt(cx * cx + cy * cy);
  },

  // ── 对象池 ───────────────────────────────────────────────────────────────
  _pushFx(kind, x, y, life, opts) {
    const f = this._poolFx.pop() || {};
    f.kind = kind;
    f.x = x; f.y = y;
    f.life = life; f.maxLife = life;
    f.x2 = (opts && opts.x2 != null) ? opts.x2 : 0;
    f.y2 = (opts && opts.y2 != null) ? opts.y2 : 0;
    f.segments = (opts && opts.segments) || null;
    this.fx.push(f);
  },
  _releaseFx(f) {
    f.segments = null;
    if (this._poolFx.length < 32) this._poolFx.push(f);
  },
  _addZone(kind, x, y, radius, duration, dmg, state) {
    const z = this._poolZone.pop() || {};
    z.kind = kind;
    z.x = x; z.y = y;
    z.radius = radius;
    z.timer = duration;
    z.maxDuration = duration;
    z.dmg = dmg;
    z.tickTimer = 0;
    z.id = this._eventSeq++;
    this.zones.push(z);
    return z;
  },
  _releaseZone(z) {
    if (this._poolZone.length < 16) this._poolZone.push(z);
  },
  _releaseEcho(e) {
    e.tags = null;
    e.tagTimes = null;
    if (this._poolEcho.length < 8) this._poolEcho.push(e);
  },

  // ── 兼容接口（历史命名；内部为因果节点系统）───────────────────────────────
  createEcho(evt, state) { return this.createCausalNode(evt, state); },
  updateEchoes(dt, state) { return this.update(dt, state); },
  renderEchoes() { /* 渲染由 Renderer / game.js 负责 */ },
  triggerEcho(node, state) { return this.triggerWhiteRupture(node, state); },
  clearEchoes() { return this.clear(); },
};

// ─── SHADOW UNDYING (genre 2 / 不灭的暗影 / 汲取流) ─────────────────────────────
// 核心循环：攻击/击杀 → 汲取收益与死亡余烬 → 恢复生命 → 实际恢复与溢出恢复生成护壳
//           → 护壳达阈值 → 蚀白冲击 → 击杀产生新余烬 → 循环
// 核心对象是附着于玩家的「蚀影护壳」：不是分身、不是漩涡、不是因果节点。
const UndyingManager = {
  // ── 运行时状态 ──────────────────────────────────────────────────────
  shell:      0,      // 当前护壳（生命值单位，独立于生命值存储）
  pulseCd:    0,      // 蚀白冲击剩余冷却（s）
  charge:     null,   // LV5 蓄势状态 { timer, extra }
  feastTimer: 0,      // LV7 盛宴剩余时间（s）

  embers:     [],     // 死亡余烬 { x, y, life, value(合并份数), cordHits }
  husks:      [],     // 余烬遗蜕 { x, y, life, value, cordHits, spawnedBy }
  ribbons:    [],     // 余烬丝带（遗蜕引爆后飞回玩家）{ x, y, vx, vy, life, value }
  fx:         [],     // 视觉特效（见 _pushFx）

  _cords:     [],     // 汲取脐带端点快照（每帧由 ShadowLink.updateCords 重建）
  _pendingSpawns: [], // 单帧预算外排队的掉落（后续更新补发，不丢失）
  _familyTimer: 0,    // 主冲击及余波归属窗口（s）
  _familyKills: null, // 本冲击家族唯一击杀记录 Set<enemyId>
  _familyCdrUsed: 0,  // 本冲击家族已用冷却缩减（s）
  _familyResCount: 0, // 本冲击家族累计收集的资源份数（LV7 盛宴判定）
  _pulseSeq:  0,      // 主冲击代数（防止同帧递归 / 遗蜕重复引爆）

  // ── 资源与容量 ──────────────────────────────────────────────────────
  shellMax(state) {
    const cfg = CONFIG.UNDYING;
    const pct = (state.genreLv >= 3) ? cfg.SHELL_HP_PCT_LV3 : cfg.SHELL_HP_PCT;
    return state.player.effectiveMaxHp * pct;
  },

  // 恢复转化唯一入口的护壳侧：actualHeal×比例 + overheal×100%（盛宴 +25%）
  onHeal(actualHeal, overheal, state) {
    if (!state || state.genre !== 2) return;
    const cfg = CONFIG.UNDYING;
    const rate = (state.genreLv >= 3) ? cfg.HEAL_TO_SHELL_LV3 : cfg.HEAL_TO_SHELL;
    let gain = actualHeal * rate + overheal * cfg.OVERHEAL_TO_SHELL;
    if (this.feastTimer > 0) gain *= (1 + cfg.FEAST_SHELL_BONUS);
    this.addShell(gain, state);
  },

  addShell(v, state) {
    const cap = this.shellMax(state);
    this.shell = Math.min(cap, this.shell + v);
    // LV5 临界喂养：蓄势期间新增护壳的一部分计入本次额外消耗（上限为最大护壳 20%）
    if (this.charge) {
      const extraCap = cap * CONFIG.UNDYING.CHARGE_EXTRA_PCT;
      const add = v * CONFIG.UNDYING.CHARGE_EXTRA_SHARE;
      this.charge.extra = Math.min(extraCap, this.charge.extra + add);
    }
  },

  // 护壳吸收（Player.takeDamage 调用）：返回穿透到生命的剩余伤害
  absorbDamage(dmg, state, fromX, fromY) {
    if (this.shell <= 0) return dmg;
    const absorbed = Math.min(this.shell, dmg);
    this.shell -= absorbed;
    // 吸收方向的甲片短促碎裂（视觉）
    const p = state.player;
    const angle = (fromX != null)
      ? Math.atan2(p.y - fromY, p.x - fromX) : -Math.PI / 2;
    this._pushFx('absorb', p.x, p.y, { angle, life: 0.25 });
    return dmg - absorbed;
  },

  // ── 基础汲取（有效攻击批次限频）────────────────────────────────────
  _leechTimes: 0, _leechWin: 0, _lastBatch: -1,

  onPlayerHit(batchId, state) {
    if (!state || state.genre !== 2) return;
    // 同一批次只计一次完整基础汲取；每秒最多 LEECH_PER_SEC 次
    if (batchId === this._lastBatch) return;
    this._lastBatch = batchId;
    const now = state.time;
    if (now - this._leechWin >= 1.0) { this._leechWin = now; this._leechTimes = 0; }
    if (this._leechTimes >= CONFIG.UNDYING.LEECH_PER_SEC) return;
    this._leechTimes++;
    const heal = state.player.effectiveMaxHp * CONFIG.UNDYING.LEECH_HP_PCT;
    state.player.heal(heal, state);   // 统一恢复入口 → 转护壳
    this._pushFx('leech', state.player.x, state.player.y, { life: 0.3 });
  },

  // ── 死亡掉落（enemy.js 真实死亡调用）────────────────────────────────
  onEnemyDeath(x, y, state, enemy) {
    if (!state || state.genre !== 2) return;
    // 有死亡阴影卡时由遗蜕替代普通余烬（同一击杀不重复发完整资源）
    if (typeof DeathShadowManager !== 'undefined' && DeathShadowManager.enabled) {
      // 遗蜕由 resolveDeathShadowByArchetype 生成
    } else {
      // 排队发放（单帧预算内补发，不丢失已确认资源；硬上限防无限增长）
      if (this._pendingSpawns.length >= 128) this._pendingSpawns.shift();
      this._pendingSpawns.push({ kind: 'ember', x, y, value: 1 });
    }
    // LV6 死潮回流：冲击家族内唯一击杀记录 → 减少剩余冷却（同一敌人只记一次）
    if (state.genreLv >= 6 && this._familyTimer > 0 && this._familyKills && enemy) {
      const key = enemy.id;
      if (key != null && !this._familyKills.has(key)) {
        this._familyKills.add(key);
        const cfg = CONFIG.UNDYING;
        if (this._familyCdrUsed < cfg.KILL_CDR_MAX) {
          const cut = Math.min(cfg.KILL_CDR, cfg.KILL_CDR_MAX - this._familyCdrUsed);
          this._familyCdrUsed += cut;
          this.pulseCd = Math.max(0, this.pulseCd - cut);
        }
      }
    }
  },

  // 死亡阴影在流派 2 的形态：余烬遗蜕（替代该次击杀的普通死亡余烬）
  spawnHusk(x, y, state) {
    if (!state || state.genre !== 2) return;
    if (this._pendingSpawns.length >= 128) this._pendingSpawns.shift();
    this._pendingSpawns.push({ kind: 'husk', x, y, value: 1 });
  },

  // ── 主更新 ──────────────────────────────────────────────────────────
  update(dt, state) {
    if (!state || state.genre !== 2) return;
    const cfg = CONFIG.UNDYING;

    // 掉落队列：单帧预算 EVENT_BUDGET，超额排到后续更新（不丢失）
    let budget = cfg.EVENT_BUDGET;
    while (this._pendingSpawns.length > 0 && budget-- > 0) {
      const s = this._pendingSpawns.shift();
      this._spawnGround(s.kind, s.x, s.y, s.value, state);
    }

    // 冷却 / 家族窗口 / 盛宴衰减
    if (this.pulseCd > 0) this.pulseCd -= dt;
    if (this._familyTimer > 0) this._familyTimer -= dt;
    if (this.feastTimer > 0) this.feastTimer -= dt;

    // LV5 蓄势：结束后结算冲击；玩家死亡取消尚未结算的攻击
    if (this.charge) {
      if (state.gameOver || state.player.hp <= 0) {
        this.charge = null;
      } else {
        this.charge.timer -= dt;
        if (this.charge.timer <= 0) {
          const extra = this.charge.extra;
          this.charge = null;
          this._firePulse(state, extra);
        }
      }
    }

    // 自动触发：护壳 ≥ 70% 容量且冷却结束（非蓄势、非同帧重复）
    const cap = this.shellMax(state);
    if (this.shell > cap) this.shell = cap;
    if (!this.charge && this.pulseCd <= 0 && this.shell >= cap * cfg.PULSE_THRESHOLD) {
      if (state.genreLv >= 5) {
        // 临界喂养：先蓄势，期间新增护壳的一部分计入额外消耗
        this.charge = { timer: cfg.CHARGE_TIME, extra: 0 };
        this._pushFx('charge', state.player.x, state.player.y, { life: cfg.CHARGE_TIME });
      } else {
        this._firePulse(state, 0);
      }
    }

    // 地面资源寿命 / 自动收集 / 合并
    this._updateGround(dt, state);
    // 丝带（遗蜕回流）飞行
    this._updateRibbons(dt, state);
    // 特效衰减（回潮到点结算一次；其余仅视觉）
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.life -= dt;
      if (f.kind === 'rebound' && !f.fired) {
        f.timer -= dt;
        if (f.timer <= 0) {
          f.fired = true;
          this._fireRebound(f.x, f.y, f.radius, f.dmg, state);
        }
      }
      if (f.life <= 0) this.fx.splice(i, 1);
    }
  },

  // ── 蚀白冲击（核心输出）────────────────────────────────────────────
  _firePulse(state, extra) {
    const cfg = CONFIG.UNDYING;
    const p = state.player;
    // 实际消耗：当前护壳 50% + 蓄势期额外消耗（已 clamp）
    const cap = this.shellMax(state);
    const consume = Math.min(this.shell, this.shell * cfg.PULSE_CONSUME_PCT + extra);
    this.shell -= consume;

    // 伤害 = 玩家攻击 × 1.6 + 实际消耗护壳 × 2（加成只应用一次，走统一入口）
    const dmg = p.effectiveDamage * cfg.PULSE_DMG_MULT + consume * cfg.PULSE_SHELL_MULT;
    // 半径：受技能范围加成；蓄势额外消耗最多提高 25%
    const radiusBonus = (cap > 0)
      ? Math.min(cfg.CHARGE_RADIUS_BONUS, (extra / (cap * cfg.CHARGE_EXTRA_PCT)) * cfg.CHARGE_RADIUS_BONUS)
      : 0;
    const radius = cfg.PULSE_RADIUS * p.skillRangeMult * (1 + radiusBonus);

    this._pulseSeq++;
    this.pulseCd = cfg.PULSE_COOLDOWN;
    this._familyTimer = 1.0;
    this._familyKills = new Set();
    this._familyCdrUsed = 0;
    this._familyResCount = 0;   // 本次冲击及余波的资源收集计数（LV7 判定）

    // 一次性结算伤害（视觉与伤害时间分离，不逐帧重复）
    let hits = 0, bossHit = false;
    const hitIds = new Set();
    const enemies = state.enemies;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const rr = radius + e.radius;
      if (dx * dx + dy * dy > rr * rr) continue;
      hitIds.add(e.id);
      // BOSS 共享血池只结算一次（多实例同帧不再重复扣池）
      if (e.type === 'boss') {
        if (bossHit) continue;
        bossHit = true;
      }
      e.takeDamage(dmg, state, 'player');
      hits++;
      // 冻壳剥离：命中已冰封敌人（每次冰封期间每目标一次）
      this._tryShatter(e, dmg, state);
      const sv = Utils.worldToScreen(e.x, e.y - 20, Renderer.cam);
      Utils.spawnDmgNum(sv.x, sv.y, Math.round(dmg), e.type === 'boss' ? 'boss' : '');
    }

    // 主冲击扫过遗蜕（快照：新遗蜕不被本次冲击再次引爆）
    const huskSnap = this.husks.slice();
    for (let i = 0; i < huskSnap.length; i++) {
      const h = huskSnap[i];
      const dx = h.x - p.x, dy = h.y - p.y;
      const rr = radius + 14;
      if (dx * dx + dy * dy > rr * rr) continue;
      this._detonateHusk(h, dmg, state);
    }

    // 沿汲取脐带发送白色脉冲（同一遗蜕不与圆形冲击重复引爆）
    this._cordPulse(dmg, hitIds, state);

    // LV4 裂壳回潮：命中至少一个敌人后延迟收缩（不消耗护壳、不产生下一道回潮）
    if (hits > 0 && state.genreLv >= 4) {
      this._pushFx('rebound', p.x, p.y, {
        life: cfg.REBOUND_DELAY + 0.4, timer: cfg.REBOUND_DELAY,
        radius, dmg: dmg * cfg.REBOUND_DMG_MULT, fired: false,
      });
    }
    // LV7 盛宴：额外 4 道尖瓣裂光（可真实击杀与掉落，不触发基础汲取）
    if (this.feastTimer > 0 && state.genreLv >= 7) {
      for (let k = 0; k < cfg.FEAST_PETAL_COUNT; k++) {
        const ang = (k / cfg.FEAST_PETAL_COUNT) * Math.PI * 2 + Utils.rand(-0.15, 0.15);
        this._petalBurst(p.x, p.y, ang, radius, dmg * cfg.FEAST_PETAL_MULT, state);
      }
    }

    // 视觉：爆发阶段（6~8 尖瓣 + 中心闪白 + 黑紫破碎轮廓）
    this._pushFx('burst', p.x, p.y, { life: 0.55, radius, petals: 6 + Math.floor(Math.random() * 3) });
    Particles.spawn(p.x, p.y, '#e8e0ff', 10, 200, 0.4);
    Particles.spawn(p.x, p.y, '#2a0a3a', 14, 160, 0.5);
  },

  // 回潮实际结算（fx 到点调用一次；可真实击杀；不触发基础汲取）
  _fireRebound(x, y, radius, dmg, state) {
    const enemies = state.enemies;
    let bossHit = false;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      const dx = e.x - x, dy = e.y - y;
      const rr = radius + e.radius;
      if (dx * dx + dy * dy > rr * rr) continue;
      if (e.type === 'boss') { if (bossHit) continue; bossHit = true; }
      e.takeDamage(dmg, state, 'player');
      const sv = Utils.worldToScreen(e.x, e.y - 20, Renderer.cam);
      Utils.spawnDmgNum(sv.x, sv.y, Math.round(dmg), e.type === 'boss' ? 'boss' : '');
    }
    // 向玩家方向收集范围内余烬
    const p = state.player;
    for (let i = this.embers.length - 1; i >= 0; i--) {
      const em = this.embers[i];
      const dx = em.x - x, dy = em.y - y;
      if (dx * dx + dy * dy <= radius * radius) {
        this._collectEmber(em, state);
        this.embers.splice(i, 1);
      }
    }
    this._pushFx('wave', p.x, p.y, { life: 0.4, radius });
  },

  // 尖瓣裂光：短线段走廊一次性伤害（真实击杀 / 掉落，不触发汲取）
  _petalBurst(x, y, angle, radius, dmg, state) {
    const len = radius * 1.15, half = 18;
    const dirX = Math.cos(angle), dirY = Math.sin(angle);
    const enemies = state.enemies;
    let bossHit = false;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      const dx = e.x - x, dy = e.y - y;
      const t = dx * dirX + dy * dirY;
      if (t < 0 || t > len) continue;
      const px = x + dirX * t, py = y + dirY * t;
      const ddx = e.x - px, ddy = e.y - py;
      const rr = half + e.radius;
      if (ddx * ddx + ddy * ddy > rr * rr) continue;
      if (e.type === 'boss') { if (bossHit) continue; bossHit = true; }
      e.takeDamage(dmg, state, 'player');
      const sv = Utils.worldToScreen(e.x, e.y - 20, Renderer.cam);
      Utils.spawnDmgNum(sv.x, sv.y, Math.round(dmg), e.type === 'boss' ? 'boss' : '');
    }
    this._pushFx('petal', x, y, { life: 0.35, angle, len, half });
  },

  // ── 冻壳剥离（暗影冰封适配）────────────────────────────────────────
  // 主冲击命中已冰封敌人：每次冰封期间每目标最多一次；
  // 碎壳飞向玩家恢复 1% 最大生命 + 主冲击 30% 局部冰裂伤害。
  _tryShatter(e, mainDmg, state) {
    if (!state.freezeEnabled) return;
    if (!e.alive) return;
    if (!(e.freezeTimer > 0)) return;
    // 每次冰封期间每目标一次：记录本次冰封的起始时间戳
    const stamp = e.freezeLastTime;
    if (e._undyingShatterStamp === stamp) return;
    e._undyingShatterStamp = stamp;

    const cfg = CONFIG.UNDYING;
    const heal = state.player.effectiveMaxHp * cfg.SHATTER_HEAL_PCT;
    // 冷白色碎壳飞向玩家（到达后结算恢复，统一恢复入口）
    this.ribbons.push({
      x: e.x, y: e.y,
      vx: (state.player.x - e.x) * 2.2, vy: (state.player.y - e.y) * 2.2,
      life: 0.45, value: heal, color: '#dff2ff',
    });
    // 额外局部冰裂伤害（来源为主冲击伤害，不引用不存在的冰封基础伤害）
    const crack = mainDmg * cfg.SHATTER_DMG_MULT;
    e.takeDamage(crack, state, 'player');
    const sv = Utils.worldToScreen(e.x, e.y - 16, Renderer.cam);
    Utils.spawnDmgNum(sv.x, sv.y, Math.round(crack), 'crit');
    Particles.spawn(e.x, e.y, '#dff2ff', 8, 120, 0.45);
    this._pushFx('shard', e.x, e.y, { life: 0.4, tx: state.player.x, ty: state.player.y });
  },

  // ── 余烬遗蜕 ───────────────────────────────────────────────────────
  // 倒伏、逐渐剥落的黑白影壳；不开火、不吸怪、不自动攻击。
  // 收集方式 A：玩家靠近（恢复 2%）；B：蚀白冲击扫过 → 丝带回流 + 壳裂。
  _spawnGround(kind, x, y, value, state) {
    const arr = (kind === 'husk') ? this.husks : this.embers;
    // 优先合并相近同类资源（保留总量，单体存量上限）
    const cfg = CONFIG.UNDYING;
    for (let i = 0; i < arr.length; i++) {
      const o = arr[i];
      const dx = o.x - x, dy = o.y - y;
      if (dx * dx + dy * dy <= cfg.MERGE_DIST * cfg.MERGE_DIST && o.value < cfg.MERGE_CAP) {
        o.value = Math.min(cfg.MERGE_CAP, o.value + value);
        return;
      }
    }
    // 容量管理：超出预算优先清理最旧对象
    if (this.embers.length + this.husks.length >= cfg.MAX_EMBERS) {
      const victim = (this.embers.length > 0) ? this.embers : this.husks;
      victim.shift();
    }
    arr.push({
      x, y,
      life: (kind === 'husk') ? cfg.HUSK_LIFE : cfg.EMBER_LIFE,
      value,
      cordHits: new Set(),   // 汲取脐带：同一端点只能收集一次
    });
  },

  // 遗蜕引爆（主冲击扫过 / 脐带脉冲端点；同一遗蜕只结算一次）
  _detonateHusk(h, mainDmg, state) {
    const idx = this.husks.indexOf(h);
    if (idx < 0) return;              // 已被圆形冲击或线脉冲消费
    this.husks.splice(idx, 1);

    const cfg = CONFIG.UNDYING;
    const p = state.player;
    const heal = p.effectiveMaxHp * cfg.HUSK_HEAL_PCT *
      (state.genreLv >= 2 ? (1 + cfg.LV2_HEAL_BONUS) : 1) * h.value;

    // 余烬丝带飞回玩家（到达后结算恢复 → 转护壳；属于冲击家族资源）
    this.ribbons.push({
      x: h.x, y: h.y,
      vx: (p.x - h.x) * 2.0, vy: (p.y - h.y) * 2.0,
      life: 0.55, value: heal, color: '#ff5a3c',
      fam: true,
    });
    // 遗蜕位置产生一次小型壳裂（不继续引爆其他遗蜕；
    // 新遗蜕来自壳裂击杀时，spawned 代数大于当前冲击，不会被本次主冲击再引爆）
    const crackDmg = mainDmg * cfg.SHELLCRACK_MULT;
    const radius = cfg.SHELLCRACK_RADIUS * p.skillRangeMult;
    let bossHit = false;
    const enemies = state.enemies;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      const dx = e.x - h.x, dy = e.y - h.y;
      const rr = radius + e.radius;
      if (dx * dx + dy * dy > rr * rr) continue;
      if (e.type === 'boss') { if (bossHit) continue; bossHit = true; }
      e.takeDamage(crackDmg, state, 'player');
      const sv = Utils.worldToScreen(e.x, e.y - 20, Renderer.cam);
      Utils.spawnDmgNum(sv.x, sv.y, Math.round(crackDmg), e.type === 'boss' ? 'boss' : '');
    }
    // 小型侧向碎壳喷发（与主冲击视觉区分）
    this._pushFx('crack', h.x, h.y, { life: 0.35, radius });
    Particles.spawn(h.x, h.y, '#c9b8ff', 8, 130, 0.4);
    Particles.spawn(h.x, h.y, '#1a0a2a', 10, 150, 0.5);
  },

  // ── 汲取脐带（暗影连线适配）────────────────────────────────────────
  // 端点：玩家 ↔ 附近余烬遗蜕（无死亡阴影时允许普通余烬；余烬保留自身寿命）。
  // 复用线段伤害：敌人穿过受 LINK_DAMAGE（终身一次/端点）；连线伤害积累汲取收益。
  updateCords(dt, player, enemies, state) {
    const cfg = CONFIG.UNDYING;
    const useHusk = (typeof DeathShadowManager !== 'undefined' && DeathShadowManager.enabled);
    const pool = useHusk ? this.husks : this.embers;
    // 最近 3 个有效端点（按距玩家距离取最近）
    this._cords.length = 0;
    for (let i = 0; i < pool.length; i++) this._cords.push(pool[i]);
    this._cords.sort((a, b) => {
      const da = (a.x - player.x) ** 2 + (a.y - player.y) ** 2;
      const db = (b.x - player.x) ** 2 + (b.y - player.y) ** 2;
      return da - db;
    });
    if (this._cords.length > cfg.CORD_MAX) this._cords.length = cfg.CORD_MAX;

    for (let c = 0; c < this._cords.length; c++) {
      const se = this._cords[c];
      const dx = se.x - player.x, dy = se.y - player.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq > 1500 * 1500) continue;
      for (let k = 0; k < enemies.length; k++) {
        const e = enemies[k];
        if (!e.alive) continue;
        if (se.cordHits.has(e.id)) continue;   // 同一端点只结算一次
        const minX = Math.min(player.x, se.x) - (e.radius + 10);
        const maxX = Math.max(player.x, se.x) + (e.radius + 10);
        const minY = Math.min(player.y, se.y) - (e.radius + 10);
        const maxY = Math.max(player.y, se.y) + (e.radius + 10);
        if (e.x < minX || e.x > maxX || e.y < minY || e.y > maxY) continue;
        if (ShadowLink._distToSegmentSq(e, player, se, dx, dy, lenSq) >= (e.radius + 10) * (e.radius + 10)) continue;
        se.cordHits.add(e.id);
        e.takeDamage(CONFIG.LINK_DAMAGE, state, 'shadow');
        // 连线伤害积累一份汲取收益（走统一恢复入口 → 转护壳）
        player.heal(player.effectiveMaxHp * CONFIG.UNDYING.LEECH_HP_PCT, state);
        const sv = Utils.worldToScreen(e.x, e.y - 16, Renderer.cam);
        Utils.spawnDmgNum(sv.x, sv.y, CONFIG.LINK_DAMAGE);
        Particles.spawn(e.x, e.y, '#ff5a3c', 4, 50, 0.3);
      }
    }
  },

  // 主冲击沿脐带发送白色脉冲（端点若为遗蜕正常引爆；同一遗蜕不与圆形冲击重复引爆）
  _cordPulse(mainDmg, hitIds, state) {
    const p = state.player;
    const cfg = CONFIG.UNDYING;
    const dmg = mainDmg * cfg.CORD_DMG_MULT;
    for (let c = 0; c < this._cords.length; c++) {
      const se = this._cords[c];
      const dx = se.x - p.x, dy = se.y - p.y;
      const lenSq = dx * dx + dy * dy;
      const enemies = state.enemies;
      let bossHit = false;
      for (let k = 0; k < enemies.length; k++) {
        const e = enemies[k];
        if (!e.alive) continue;
        if (hitIds.has(e.id)) continue;        // 不与圆形冲击重复结算
        if (ShadowLink._distToSegmentSq(e, p, se, dx, dy, lenSq) >= (e.radius + 12) * (e.radius + 12)) continue;
        if (e.type === 'boss') { if (bossHit) continue; bossHit = true; }
        e.takeDamage(dmg, state, 'player');
        const sv = Utils.worldToScreen(e.x, e.y - 20, Renderer.cam);
        Utils.spawnDmgNum(sv.x, sv.y, Math.round(dmg), e.type === 'boss' ? 'boss' : '');
      }
      this._pushFx('cord', p.x, p.y, { life: 0.3, tx: se.x, ty: se.y });
      // 端点遗蜕引爆（_detonateHusk 内 indexOf 保证只结算一次）
      const hi = this.husks.indexOf(se);
      if (hi >= 0) this._detonateHusk(se, mainDmg, state);
    }
    this._cords.length = 0;
  },

  // ── 地面资源：自动收集 / 寿命 / 溢出 ─────────────────────────────────
  _updateGround(dt, state) {
    const p = state.player;
    const cfg = CONFIG.UNDYING;
    const range = cfg.EMBER_PICKUP_RANGE *
      (state.genreLv >= 2 ? (1 + cfg.LV2_PICKUP_BONUS) : 1);
    const rr = range * range;

    for (let i = this.embers.length - 1; i >= 0; i--) {
      const em = this.embers[i];
      em.life -= dt;
      const dx = em.x - p.x, dy = em.y - p.y;
      if (dx * dx + dy * dy <= rr) {
        this._flyToPlayer(em.x, em.y, this._emberHeal(em, state), '#e04426', state, this._familyTimer > 0);
        this.embers.splice(i, 1);
        continue;
      }
      if (em.life <= 0) this.embers.splice(i, 1);
    }
    for (let i = this.husks.length - 1; i >= 0; i--) {
      const h = this.husks[i];
      h.life -= dt;
      const dx = h.x - p.x, dy = h.y - p.y;
      if (dx * dx + dy * dy <= rr) {
        // 收集方式 A：玩家靠近 → 余烬丝带沿弧线飞回玩家，到达结算恢复（× LV2 × 合并份数）
        this._flyToPlayer(h.x, h.y, this._huskHeal(h, state), '#c9b8ff', state, this._familyTimer > 0);
        Particles.spawn(h.x, h.y, '#c9b8ff', 6, 100, 0.4);
        this.husks.splice(i, 1);
        continue;
      }
      if (h.life <= 0) this.husks.splice(i, 1);
    }
  },

  // 余烬恢复量（× LV2 加成 × 合并份数）
  _emberHeal(em, state) {
    const cfg = CONFIG.UNDYING;
    return state.player.effectiveMaxHp * cfg.EMBER_HEAL_PCT *
      (state.genreLv >= 2 ? (1 + cfg.LV2_HEAL_BONUS) : 1) * em.value;
  },

  // 遗蜕恢复量（× LV2 加成 × 合并份数）
  _huskHeal(h, state) {
    const cfg = CONFIG.UNDYING;
    return state.player.effectiveMaxHp * cfg.HUSK_HEAL_PCT *
      (state.genreLv >= 2 ? (1 + cfg.LV2_HEAL_BONUS) : 1) * h.value;
  },

  // 收集即起飞：丝带到达玩家后经统一恢复入口结算（实际恢复 + 溢出 → 护壳）
  // fam=true 表示属于当前冲击家族的余烬资源（LV7 盛宴计数；碎壳回流不计）
  _flyToPlayer(x, y, heal, color, state, fam) {
    const p = state.player;
    this.ribbons.push({
      x, y,
      vx: (p.x - x) * 1.6 + Utils.rand(-40, 40),   // 初始横向偏移 → 弧线轨迹
      vy: (p.y - y) * 1.6 + Utils.rand(-40, 40),
      life: 0.55, value: heal, color,
      fam: !!fam,
    });
  },

  _collectEmber(em, state) {
    // 回潮收聚：直接收集（同恢复口径，经统一入口）
    state.player.heal(this._emberHeal(em, state), state);
    // LV7 盛宴：仅统计冲击家族窗口内的资源收集
    if (this._familyTimer > 0) {
      this._familyResCount += 1;
      this._checkFeast(state);
    }
    Particles.spawn(em.x, em.y, '#ff5a3c', 5, 90, 0.35);
  },

  // LV7 盛宴：一次冲击及余波累计收集 ≥3 份资源 → 盛宴 4 秒（刷新不叠乘）
  _checkFeast(state) {
    if (!state || state.genreLv < 7) return;
    if (this._familyResCount >= CONFIG.UNDYING.FEAST_NEED) {
      this.feastTimer = CONFIG.UNDYING.FEAST_DURATION;   // 刷新持续时间
      this._familyResCount = 0;
    }
  },

  // ── 丝带 / 碎壳飞向玩家（到达后结算恢复）─────────────────────────────
  _updateRibbons(dt, state) {
    const p = state.player;
    for (let i = this.ribbons.length - 1; i >= 0; i--) {
      const r = this.ribbons[i];
      // 朝玩家收敛（弧线近似：速度向玩家方向再加速）
      const dx = p.x - r.x, dy = p.y - r.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      r.x += (dx / d) * 420 * dt + r.vx * dt * 0.35;
      r.y += (dy / d) * 420 * dt + r.vy * dt * 0.35;
      r.life -= dt;
      if (d < 26 || r.life <= 0) {
        p.heal(r.value, state);          // 统一恢复入口 → 转护壳
        // LV7 盛宴：只统计冲击家族的余烬资源（碎壳回流不计）
        if (r.fam) {
          this._familyResCount += 1;
          this._checkFeast(state);
        }
        Particles.spawn(p.x, p.y, r.color || '#ff5a3c', 4, 80, 0.3);
        this.ribbons.splice(i, 1);
      }
    }
  },

  // ── 视觉特效队列 ─────────────────────────────────────────────────────
  _pushFx(kind, x, y, opts) {
    const f = { kind, x, y, life: 0.4, timer: 0, radius: 0, angle: 0, len: 0, half: 0,
      tx: 0, ty: 0, petals: 6, dmg: 0, fired: true };
    if (opts) for (const k in opts) f[k] = opts[k];
    this.fx.push(f);
    return f;
  },

  // ── 视觉（黑紫护壳 / 冷白裂纹 / 暗红余烬；白色仅满溢与冲击峰值高亮）──
  // layer: 'ground' 地面资源与脐带 | 'shell' 玩家护壳甲片 | 'fx' 冲击与余波
  render(ctx, cam, state, time, layer) {
    if (layer === 'ground') this._renderGround(ctx, cam, state, time);
    else if (layer === 'shell') this._renderShell(ctx, cam, state, time);
    else this._renderFx(ctx, cam, state, time);
  },

  _renderGround(ctx, cam, state, time) {
    // 汲取脐带：玩家 ↔ 端点（暗红细线，脉冲时变白）
    const p = state.player;
    const ps = Utils.worldToScreen(p.x, p.y, cam);
    for (let i = 0; i < this._cords.length; i++) {
      const se = this._cords[i];
      const es = Utils.worldToScreen(se.x, se.y, cam);
      ctx.save();
      ctx.strokeStyle = 'rgba(200,60,40,0.55)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -time * 30;
      ctx.beginPath();
      ctx.moveTo(ps.x, ps.y);
      ctx.lineTo(es.x, es.y);
      ctx.stroke();
      ctx.restore();
    }
    // 普通余烬：暗红核心 + 外层细薄黑片
    for (let i = 0; i < this.embers.length; i++) {
      const em = this.embers[i];
      const s = Utils.worldToScreen(em.x, em.y, cam);
      const r = 6 + em.value * 1.6;
      const pulse = 1 + Math.sin(time * 5 + i) * 0.12;
      ctx.save();
      // 细薄黑片包裹
      ctx.fillStyle = 'rgba(20,6,16,0.92)';
      for (let k = 0; k < 3; k++) {
        const a = time * 0.8 + k * 2.1;
        ctx.beginPath();
        ctx.ellipse(s.x + Math.cos(a) * r * 0.55, s.y + Math.sin(a) * r * 0.4,
          r * 0.62, r * 0.28, a, 0, Math.PI * 2);
        ctx.fill();
      }
      // 暗红核心
      ctx.shadowBlur = 12; ctx.shadowColor = '#c03018';
      ctx.fillStyle = '#e04426';
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 0.52 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // 余烬遗蜕：倒伏、剥落的空壳轮廓（不画成站立射击分身）
    for (let i = 0; i < this.husks.length; i++) {
      const h = this.husks[i];
      const s = Utils.worldToScreen(h.x, h.y, cam);
      const r = 16 + h.value * 2.5;
      const peel = 1 - h.life / CONFIG.UNDYING.HUSK_LIFE;   // 剥落程度随寿命推进
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(-0.35);                                     // 倒伏姿态
      // 倒伏壳体（黑白）
      ctx.fillStyle = 'rgba(226,222,236,0.20)';
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.15, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(232,228,242,0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.15, r * 0.55, 0, Math.PI * 0.15, Math.PI * 1.05);
      ctx.stroke();
      // 剥落缺口（逐渐变多）
      ctx.fillStyle = 'rgba(10,4,18,0.9)';
      const chips = 1 + Math.floor(peel * 4);
      for (let k = 0; k < chips; k++) {
        const a = k * 1.9 + 0.6;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.32,
          r * 0.22, r * 0.12, a, 0, Math.PI * 2);
        ctx.fill();
      }
      // 内部残余暗红微光
      ctx.fillStyle = `rgba(200,60,36,${0.35 + 0.2 * Math.sin(time * 3 + i)})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.5, r * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // 丝带（回流余烬 / 冷白碎壳）：拖尾
    for (let i = 0; i < this.ribbons.length; i++) {
      const rb = this.ribbons[i];
      const s = Utils.worldToScreen(rb.x, rb.y, cam);
      const ang = Math.atan2(rb.vy, rb.vx);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(ang);
      ctx.fillStyle = rb.color || '#e04426';
      ctx.shadowBlur = 10; ctx.shadowColor = rb.color || '#e04426';
      ctx.beginPath();
      ctx.ellipse(0, 0, 14, 3.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.ellipse(-12, 0, 9, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  },

  _renderShell(ctx, cam, state, time) {
    const p = state.player;
    const s = Utils.worldToScreen(p.x, p.y, cam);
    const cap = this.shellMax(state) || 1;
    const ratio = Utils.clamp(this.shell / cap, 0, 1);
    if (ratio <= 0) return;
    const r = CONFIG.PLAYER_RADIUS + 9;
    const plates = 8;
    const filled = Math.ceil(ratio * plates);          // 护壳越多甲片覆盖越完整
    const near = ratio >= CONFIG.UNDYING.PULSE_THRESHOLD * 0.8;   // 接近阈值：白裂纹透光
    const charging = !!this.charge;
    const squeeze = charging ? 0.82 : 1;               // 蓄势：甲片向中心收紧

    ctx.save();
    ctx.translate(s.x, s.y);
    for (let i = 0; i < filled; i++) {
      const a0 = (i / plates) * Math.PI * 2 - Math.PI / 2 + 0.16;
      const a1 = a0 + (Math.PI * 2 / plates) - 0.42;   // 不闭合甲片（留缝）
      const rr = r * squeeze;
      ctx.beginPath();
      ctx.arc(0, 0, rr, a0, a1);
      ctx.arc(0, 0, rr * 0.72, a1, a0, true);
      ctx.closePath();
      // 黑紫甲片
      const grad = ctx.createRadialGradient(0, 0, rr * 0.6, 0, 0, rr);
      grad.addColorStop(0, 'rgba(26,10,40,0.92)');
      grad.addColorStop(1, 'rgba(14,4,24,0.98)');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,70,190,0.8)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      // 冷白裂纹：接近阈值 / 蓄势时向外透光
      if (near || charging) {
        const crackA = (a0 + a1) / 2;
        const flick = 0.55 + 0.45 * Math.sin(time * 8 + i * 1.7);
        ctx.strokeStyle = `rgba(232,238,255,${(near ? 0.5 : 0.25) * flick})`;
        ctx.shadowBlur = 8; ctx.shadowColor = '#e8eeff';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(crackA) * rr * 0.74, Math.sin(crackA) * rr * 0.74);
        ctx.lineTo(Math.cos(crackA) * rr * 0.98, Math.sin(crackA) * rr * 0.98);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
    ctx.restore();

    // 护壳 UI：血条上方的冷白细条（明确看出护壳资源变化）
    const bw = 44, bh = 4;
    const by = -(CONFIG.PLAYER_RADIUS) - 12 - 6 - bh - 6;
    ctx.save();
    ctx.fillStyle = 'rgba(10,4,18,0.8)';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + by + bh / 2, bw / 2 + 1, bh / 2 + 1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(232,238,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(s.x - bw / 2 + (bw * ratio) / 2, s.y + by + bh / 2,
      Math.max(0.5, (bw * ratio) / 2), bh / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    // 阈值刻度（70%）
    const thX = s.x - bw / 2 + bw * CONFIG.UNDYING.PULSE_THRESHOLD;
    ctx.fillStyle = 'rgba(224,68,38,0.9)';
    ctx.fillRect(thX - 1, s.y + by - 1, 2, bh + 2);
    ctx.restore();
  },

  _renderFx(ctx, cam, state, time) {
    for (let i = 0; i < this.fx.length; i++) {
      const f = this.fx[i];
      const s = Utils.worldToScreen(f.x, f.y, cam);
      const t = Utils.clamp(f.life / 0.5, 0, 1);
      ctx.save();
      if (f.kind === 'burst') {
        // 蚀白冲击爆发：中心短促闪白 + 外壳剥离成尖瓣 + 黑紫破碎外缘
        const grow = 1 - t;
        // 中心闪白（限制亮度/面积，保证 BOSS 预警与弹幕可辨认）
        if (f.life > 0.45) {
          ctx.globalAlpha = Math.min(0.5, (f.life - 0.45) * 6);
          ctx.fillStyle = '#f4f0ff';
          ctx.beginPath();
          ctx.arc(s.x, s.y, 34, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        // 6~8 片尖瓣向外剥离（带方向性裂光与碎壳）
        for (let k = 0; k < f.petals; k++) {
          const a = (k / f.petals) * Math.PI * 2 + f.angle;
          const pr = f.radius * (0.35 + grow * 0.75);
          const w = 0.22 + grow * 0.1;
          ctx.beginPath();
          ctx.moveTo(s.x + Math.cos(a - w) * pr * 0.25, s.y + Math.sin(a - w) * pr * 0.25);
          ctx.lineTo(s.x + Math.cos(a) * pr, s.y + Math.sin(a) * pr);
          ctx.lineTo(s.x + Math.cos(a + w) * pr * 0.25, s.y + Math.sin(a + w) * pr * 0.25);
          ctx.closePath();
          ctx.fillStyle = `rgba(40,14,64,${0.75 * t})`;
          ctx.fill();
          ctx.strokeStyle = `rgba(232,238,255,${0.7 * t})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        // 黑紫破碎轮廓（不规则外缘）
        ctx.beginPath();
        for (let k = 0; k <= 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          const jag = f.radius * (0.55 + grow * 0.5) * (0.86 + 0.14 * Math.sin(k * 2.3 + f.angle));
          const px = s.x + Math.cos(a) * jag, py = s.y + Math.sin(a) * jag;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.strokeStyle = `rgba(70,30,110,${0.8 * t})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      } else if (f.kind === 'rebound') {
        // 回潮：外围残片向玩家方向收缩
        const shrink = 1 - t;
        const rr = f.radius * (0.35 + shrink * 0.75);
        ctx.beginPath();
        for (let k = 0; k <= 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          const jag = rr * (0.88 + 0.12 * Math.sin(k * 1.9 + time * 4));
          const px = s.x + Math.cos(a) * jag, py = s.y + Math.sin(a) * jag;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.strokeStyle = `rgba(190,70,50,${0.75 * t})`;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([10, 7]);
        ctx.lineDashOffset = time * 40;
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (f.kind === 'crack') {
        // 遗蜕壳裂：小型侧向碎壳喷发（与主冲击区分）
        const grow = 1 - t;
        for (let k = 0; k < 5; k++) {
          const a = k * 1.256 + f.angle + 0.4;
          const d = f.radius * (0.3 + grow * 0.8);
          ctx.fillStyle = `rgba(200,190,225,${0.8 * t})`;
          ctx.save();
          ctx.translate(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d);
          ctx.rotate(a);
          ctx.fillRect(-7, -2.2, 14, 4.4);
          ctx.restore();
        }
        ctx.beginPath();
        ctx.arc(s.x, s.y, f.radius * (0.35 + grow * 0.55), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(226,214,246,${0.55 * t})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (f.kind === 'petal') {
        // 尖瓣裂光：白色方向性光带
        ctx.translate(s.x, s.y);
        ctx.rotate(f.angle);
        const g = ctx.createLinearGradient(0, 0, f.len, 0);
        g.addColorStop(0, `rgba(240,238,255,${0.85 * t})`);
        g.addColorStop(1, 'rgba(240,238,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, -f.half * 0.45);
        ctx.lineTo(f.len * (0.4 + t * 0.6), -f.half * 0.12);
        ctx.lineTo(f.len * (0.4 + t * 0.6), f.half * 0.12);
        ctx.lineTo(0, f.half * 0.45);
        ctx.closePath();
        ctx.fill();
      } else if (f.kind === 'absorb') {
        // 吸收方向甲片短促碎裂
        const d = 26 + (1 - t) * 16;
        ctx.translate(s.x, s.y);
        ctx.rotate(f.angle);
        ctx.fillStyle = `rgba(210,200,240,${0.85 * t})`;
        for (let k = -1; k <= 1; k++) {
          ctx.save();
          ctx.translate(d, k * 8);
          ctx.rotate(k * 0.5 + f.angle * 0.2);
          ctx.fillRect(-6, -1.8, 12, 3.6);
          ctx.restore();
        }
      } else if (f.kind === 'charge') {
        // 蓄势：白色裂纹沿外壳蔓延（环状提示，压缩感由 _renderShell 收紧表达）
        ctx.beginPath();
        ctx.arc(s.x, s.y, (CONFIG.PLAYER_RADIUS + 12) * (1.25 - t * 0.35), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(232,238,255,${0.5 * t})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 6]);
        ctx.lineDashOffset = -time * 60;
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (f.kind === 'cord') {
        // 脐带白色脉冲：沿线行进的一段亮线
        const es = Utils.worldToScreen(f.tx, f.ty, cam);
        const prog = 1 - t;
        const px = s.x + (es.x - s.x) * prog, py = s.y + (es.y - s.y) * prog;
        const bx = s.x + (es.x - s.x) * Math.max(0, prog - 0.22);
        const by = s.y + (es.y - s.y) * Math.max(0, prog - 0.22);
        const g = ctx.createLinearGradient(bx, by, px, py);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(1, `rgba(255,255,255,${0.9 * t})`);
        ctx.strokeStyle = g;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(px, py);
        ctx.stroke();
      } else if (f.kind === 'wave') {
        ctx.beginPath();
        ctx.arc(s.x, s.y, f.radius * (1.05 - t * 0.25), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(226,214,246,${0.6 * t})`;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      } else if (f.kind === 'shard' || f.kind === 'leech') {
        // 小亮点（碎壳飞向玩家 / 汲取反馈）
        ctx.fillStyle = f.kind === 'shard'
          ? `rgba(223,242,255,${0.8 * t})` : `rgba(224,68,38,${0.7 * t})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4 + t * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  },

  // ── 清理（死亡 / 重开 / 通关 / 模式切换）─────────────────────────────
  clear() {
    this.shell = 0;
    this.pulseCd = 0;
    this.charge = null;
    this.feastTimer = 0;
    this.embers.length = 0;
    this.husks.length = 0;
    this.ribbons.length = 0;
    this.fx.length = 0;
    this._cords.length = 0;
    this._pendingSpawns.length = 0;
    this._familyTimer = 0;
    this._familyKills = null;
    this._familyCdrUsed = 0;
    this._familyResCount = 0;
    this._pulseSeq = 0;
    this._leechTimes = 0;
    this._leechWin = 0;
    this._lastBatch = -1;
  },
};

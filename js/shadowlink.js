// ─── SHADOW LINK (BUFF 2) ─────────────────────────────────────────────────────
// Lines between player and each shadow entity; enemies passing through take damage.
// Each (link, enemy) pair can deal damage at most once — permanently.
const ShadowLink = {
  enabled: false,
  // 每个 shadow entity 已造成过伤害的敌人集合：Map<seId, Set<eId>>
  // （替代字符串键 Set：不再每帧拼接字符串，且实体消失时可整组释放）
  hitKeys: new Map(),
  // 流派 4 连线限频：Map<ballId, Map<eId, time>>（同球同敌 1s 限频，非永久一次性）
  _ricochetCd: new Map(),

  update(dt, player, shadowEntities, enemies, state) {
    if (!this.enabled) return;

    // 流派 4：暗影连线表现为「弹球连线」——玩家 ↔ 最近 3 个有效弹球，
    // 敌人穿过受固定伤害（同球同敌 1s 限频）；连线伤害不触发碰撞/元素/反弹
    if (state && state.genre === 4 && typeof RicochetManager !== 'undefined') {
      this._updateRicochetLinks(dt, player, enemies, state);
      return;
    }

    // 流派 3：暗影连线表现为「因果连线」——连接因果节点、传播事件、
    // 闭合结构触发白蚀爆裂（不是流派 0 的暗影攻击，也不是流派 1 的漩涡控制）
    if (state && state.genre === 3) {
      EchoManager.updateCausalLinks(dt, player, enemies, state);
      return;
    }

    // 流派 2：暗影连线表现为「汲取脐带」——玩家 ↔ 余烬遗蜕/普通余烬，
    // 敌人穿过受线段伤害，连线伤害积累汲取收益；主冲击沿线发白色脉冲
    if (state && state.genre === 2 && typeof UndyingManager !== 'undefined') {
      UndyingManager.updateCords(dt, player, enemies, state);
      return;
    }

    // 预计算每个 shadow entity 端点
    const segs = [];
    for (const se of shadowEntities) {
      if (!(se.active || se.timer > 0)) continue;
      const dx = se.x - player.x, dy = se.y - player.y;
      const lenSq = dx * dx + dy * dy;
      // 链接长度太远直接跳过该 entity 的全部敌人检测
      if (lenSq > 1500 * 1500) continue;
      segs.push({ se, dx, dy, lenSq });
    }

    for (const { se, dx, dy, lenSq } of segs) {
      let hitSet = this.hitKeys.get(se.id);
      for (const e of enemies) {
        if (!e.alive) continue;
        // 敌人在 link 端点的包围盒之外直接跳过
        const minX = Math.min(player.x, se.x) - (e.radius + 10);
        const maxX = Math.max(player.x, se.x) + (e.radius + 10);
        const minY = Math.min(player.y, se.y) - (e.radius + 10);
        const maxY = Math.max(player.y, se.y) + (e.radius + 10);
        if (e.x < minX || e.x > maxX || e.y < minY || e.y > maxY) continue;

        // 永久标记：该 link 对该 enemy 只造成一次伤害
        if (hitSet && hitSet.has(e.id)) continue;

        // Check if enemy is near the line segment player→shadow
        if (this._distToSegmentSq(e, player, se, dx, dy, lenSq) < (e.radius + 10) * (e.radius + 10)) {
          if (!hitSet) {
            hitSet = new Set();
            this.hitKeys.set(se.id, hitSet);
          }
          hitSet.add(e.id);
          const dmg = CONFIG.LINK_DAMAGE;
          e.takeDamage(dmg, state, 'shadow');
          // 因果残响：连线伤害视为 LINK 事件（可生成残响）
          if (state.genre === 3) {
            EchoManager.onLink(e.x, e.y, Utils.angle(player, se), dmg, e, state);
          }
          const sv = Utils.worldToScreen(e.x, e.y - 16, Renderer.cam);
          Utils.spawnDmgNum(sv.x, sv.y, dmg);
          Particles.spawn(e.x, e.y, '#aa44ff', 4, 50, 0.3);
        }
      }
    }
  },

  // ── 流派 4：玩家 ↔ 最近 3 个有效弹球的连线伤害 ──────────────────────
  // 连线伤害为固定值、同球同敌 1s 限频；不触发弹球碰撞、不消费元素、不反弹
  _updateRicochetLinks(dt, player, enemies, state) {
    const balls = RicochetManager.linkBalls(player);
    if (balls.length === 0) return;
    const cdMs = CONFIG.RICOCHET.LINK_CD_MS;
    const now = state.time;
    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      const dx = ball.x - player.x, dy = ball.y - player.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq > CONFIG.RICOCHET.LINK_RANGE * CONFIG.RICOCHET.LINK_RANGE) continue;
      let cdMap = this._ricochetCd.get(ball.id);
      if (!cdMap) {
        cdMap = new Map();
        this._ricochetCd.set(ball.id, cdMap);
      }
      for (const e of enemies) {
        if (!e.alive) continue;
        const last = cdMap.get(e.id);
        if (last != null && (now - last) * 1000 < cdMs) continue;
        const minX = Math.min(player.x, ball.x) - (e.radius + 10);
        const maxX = Math.max(player.x, ball.x) + (e.radius + 10);
        const minY = Math.min(player.y, ball.y) - (e.radius + 10);
        const maxY = Math.max(player.y, ball.y) + (e.radius + 10);
        if (e.x < minX || e.x > maxX || e.y < minY || e.y > maxY) continue;
        if (this._distToSegmentSq(e, player, ball, dx, dy, lenSq) < (e.radius + 10) * (e.radius + 10)) {
          cdMap.set(e.id, now);
          const dmg = CONFIG.RICOCHET.LINK_DAMAGE;
          // 连线伤害标 sourceType 'shadow'：不推进冰封计数、不消费元素、不递归
          e.takeDamage(dmg, state, 'shadow');
          const sv = Utils.worldToScreen(e.x, e.y - 16, Renderer.cam);
          Utils.spawnDmgNum(sv.x, sv.y, dmg);
          Particles.spawn(e.x, e.y, '#aa44ff', 4, 50, 0.3);
        }
      }
    }
  },

  // 弹球回收/清空时释放其连线限频记录
  forgetBalls() {
    this._ricochetCd.clear();
  },

  // 用预计算的 dx/dy/lenSq 算点到线段距离的平方（避免重复 sqrt）
  _distToSegmentSq(p, a, b, dx, dy, lenSq) {
    if (lenSq === 0) {
      const ddx = p.x - a.x, ddy = p.y - a.y;
      return ddx * ddx + ddy * ddy;
    }
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const cx = a.x + t * dx - p.x;
    const cy = a.y + t * dy - p.y;
    return cx * cx + cy * cy;
  },

  _distToSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Utils.dist(p, a);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Utils.clamp(t, 0, 1);
    const cx = a.x + t * dx, cy = a.y + t * dy;
    return Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
  },

  // 实体消失时释放其命中记录（防止 Map 单局内无限增长）
  forget(seId) {
    this.hitKeys.delete(seId);
  },

  clear() {
    this.hitKeys.clear();
    this._ricochetCd.clear();
  }
};

// ─── DEATH SHADOW (BUFF 1) ────────────────────────────────────────────────────
let _dShadowId = 1000;

// 统一适配：同一张「死亡阴影」机制卡按当前流派切换执行方式
//   流派 0：原地生成会自动攻击的暗影分身（暗影实体）
//   流派 1：原地生成小型漩涡
//   流派 2：原地生成余烬遗蜕（倒伏剥落的空壳；不开火、不吸怪）
//   流派 3：原地生成死亡回响节点（不攻击、不吸引、不索敌）
//   流派 4：原地生成磁极残核（只与弹球交互；导电 / 加速 / 反弹）
function resolveDeathShadowByArchetype(x, y, enemy, state) {
  const genre = state ? state.genre : -1;
  if (genre === 4 && typeof RicochetManager !== 'undefined') {
    // 磁极残核：替代死亡阴影实体；不移动、不攻击、不吸引
    RicochetManager.spawnNode(x, y, enemy, state);
    return;
  }
  if (genre === 3) {
    // 死亡回响节点：吸收后续事件 → 白蚀爆裂 → 击杀继续生成节点（不伪造 KILL）
    EchoManager.createDeathCausalNode(x, y, enemy ? enemy.lastMechanicTag : null, state);
    return;
  }
  if (genre === 2 && typeof UndyingManager !== 'undefined') {
    // 余烬遗蜕：替代该次击杀的普通死亡余烬；储存一份更强的恢复资源
    UndyingManager.spawnHusk(x, y, state);
    return;
  }
  // 流派 0 / 1：保持现有表现（暗影实体；Echo 攻击 / Vortex 小漩涡）
  DeathShadowManager.shadows.push({
    id:          _dShadowId++,
    x, y,
    alive:       false,    // not a threat
    active:      true,     // shadow entity for link/buff
    timer:       CONFIG.DEATH_SHADOW_DURATION,
    maxDuration: CONFIG.DEATH_SHADOW_DURATION,
    fireTimer:   0,        // Echo 流派用
    vortexTimer: 0,        // Vortex 流派用
  });
}

const DeathShadowManager = {
  enabled: false,
  shadows: [],

  spawn(x, y, state, enemy) {
    if (!this.enabled) return;
    // 残响 / 反应回放导致的死亡：流派 3 仍走死亡回响节点（真实死亡可继续链）；
    // 流派 0 / 1 只触发弱化版（50% 时长的残响区域），不生成 shadow 实例
    if (typeof EchoManager !== 'undefined' && EchoManager.replayDepth > 0) {
      if (state && state.genre === 3) {
        EchoManager.createDeathCausalNode(x, y, enemy ? enemy.lastMechanicTag : null, state);
        return;
      }
      EchoManager._addZone('death', x, y, 60, CONFIG.DEATH_SHADOW_DURATION * 0.5,
        CONFIG.CAUSAL.PUBLIC_BLAST_DAMAGE * 0.4, state);
      return;
    }
    // 流派适配：0 → 暗影分身，1 → 小漩涡，3 → 死亡回响节点
    resolveDeathShadowByArchetype(x, y, enemy, state);
    // 因果残响：死亡阴影生成视为 DEATH_SHADOW 事件（可推进附近节点）
    if (state && state.genre === 3) {
      EchoManager.onDeathShadow(x, y, state);
    }
  },

  update(dt, enemies, state) {
    const genre = state.genre;
    for (let i = this.shadows.length - 1; i >= 0; i--) {
      const s = this.shadows[i];
      s.timer -= dt;

      if (genre === 0) {
        // Echo 流派：缓慢攻击，攻速为生成暗影的 1/2
        s.fireTimer -= dt;
        if (s.fireTimer <= 0) {
          const fireRate = CONFIG.ECHO.BASE_FIRE_RATE / 2;
          s.fireTimer = 1 / fireRate;
          this._shootNearest(s, enemies);
        }
      } else if (genre === 1) {
        // Vortex 流派：每 4 秒生成一个 2 秒漩涡（半径为投射物漩涡的 1/2）
        s.vortexTimer -= dt;
        if (s.vortexTimer <= 0) {
          s.vortexTimer = 4.0;
          const smallRadius = CONFIG.VORTEX.VORTEX_RADIUS * 0.5;
          VortexManager.spawnVortex(s.x, s.y, state, 2.0, smallRadius);
          Particles.spawn(s.x, s.y, '#dd00ff', 8, 80, 0.5);
        }
      }

      if (s.timer <= 0) {
        s.active = false;
        ShadowLink.forget(s.id);
        this.shadows.splice(i, 1);
      }
    }
  },

  _shootNearest(s, enemies) {
    let nearest = null, bestD = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = Utils.dist(s, e);
      if (d < 500 && d < bestD) { bestD = d; nearest = e; }
    }
    if (nearest) {
      const angle = Utils.angle(s, nearest);
      BulletManager.spawn(
        s.x, s.y, angle,
        CONFIG.ECHO.BULLET_SPEED,
        CONFIG.ECHO.BASE_DAMAGE,
        CONFIG.ECHO.BULLET_RADIUS,
        '#aa44ff', 'shadow'
      );
    }
  },

  clear() { this.shadows = []; }
};

// ─── SHADOW EXPLOSION (怪物死后白色圆圈爆破) ────────────────────────────────
const ShadowExplosionManager = {
  explosions: [],

  spawn(x, y, state) {
    const cfg = CONFIG.ECHO;
    const radius = cfg.EXPLOSION_RADIUS;
    const dmg = cfg.EXPLOSION_DAMAGE;
    for (const e of EnemyManager.enemies) {
      if (!e.alive) continue;
      const dx = e.x - x, dy = e.y - y;
      const rSum = radius + e.radius;
      if (dx * dx + dy * dy < rSum * rSum) {
        e.takeDamage(dmg, state);
      }
    }
    this.explosions.push({
      x, y, radius: 0, maxRadius: radius,
      life: 0.5, maxLife: 0.5,
    });
    // 白色粒子（爆破伴随飞溅）
    Particles.spawn(x, y, '#ffffff', 16, 160, 0.5);
  },

  update(dt) {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.life -= dt;
      e.radius = e.maxRadius * (1 - e.life / e.maxLife);
      if (e.life <= 0) this.explosions.splice(i, 1);
    }
  },

  clear() { this.explosions = []; }
};

// ─── PUBLIC BLAST（公共机制卡：公共爆炸）────────────────────────────────────
// 敌人死亡时产生小范围爆炸。所有流派均可获得该机制卡。
// 残响回放触发时只产生弱化版本（范围 70%、伤害 40%），且不生成新残响。
// 爆炸走队列迭代结算（而非递归），防止「死亡→爆炸→死亡」链式调用导致栈溢出。
const PublicBlastManager = {
  enabled: false,
  _pending: [],

  onEnemyDeath(x, y, state) {
    if (!this.enabled || !state) return;
    const replay = (typeof EchoManager !== 'undefined' && EchoManager.replayDepth > 0);
    if (this._pending.length >= 64) this._pending.shift();
    this._pending.push({ x, y, replay });
  },

  update(dt, state) {
    while (this._pending.length > 0) {
      const item = this._pending.shift();
      this._blast(item.x, item.y, item.replay, state);
    }
  },

  _blast(x, y, replay, state) {
    if (!state) return;
    const cfg = CONFIG.CAUSAL;
    const genre3 = state.genre === 3;
    // 流派 3：公共爆炸范围受「暗影领域」技能范围加成
    const rangeMult = genre3 ? EchoManager.skillRangeMult(state) : 1;
    const radius = cfg.PUBLIC_BLAST_RADIUS * (replay ? 0.7 : 1) * rangeMult;
    const base = cfg.PUBLIC_BLAST_DAMAGE +
      (state.player ? state.player.effectiveDamage * 0.4 : 0);
    const dmg = base * (replay ? 0.4 : 1);

    let hitCount = 0;
    for (const e of EnemyManager.enemies) {
      if (!e.alive) continue;
      const dx = e.x - x, dy = e.y - y;
      const rSum = radius + e.radius;
      if (dx * dx + dy * dy < rSum * rSum) {
        // 回放触发的弱化爆炸走残响结算（同目标冷却 + BOSS 减半）；真实死亡走正常结算
        if (replay) {
          if (typeof EchoManager !== 'undefined') EchoManager._deal(e, dmg, 'EXPLOSION', state);
        } else {
          e.takeDamage(dmg, state, 'player');
        }
        hitCount++;
      }
    }
    ShadowExplosionManager.explosions.push({
      x, y, radius: 0, maxRadius: radius, life: 0.5, maxLife: 0.5
    });
    Particles.spawn(x, y, '#ff9a3c', 12, 140, 0.5);
    // 流派 3：爆炸中心生成爆裂节点，范围内有效敌人提供事件输入
    //（hitCount ≥1 → HIT 输入；≥3 → RUPTURE 输入，直接推进白蚀爆裂）
    if (genre3) {
      if (replay) {
        EchoManager.onExplosion(x, y, radius, dmg, state, true);
      } else {
        EchoManager.onExplosionNode(x, y, radius, dmg, hitCount, state);
      }
    }
  },

  clear() {
    this.enabled = false;
    this._pending.length = 0;
  }
};

// ─── PUBLIC LIGHTNING（公共机制卡：引雷）────────────────────────────────────
// 每 4 秒触发一次天雷。战斗流程、区域伤害/麻痹与视觉全部在 skythunder.js
// （SkyThunderManager），与流派 1 的漩涡电完全分离。
const PublicLightningManager = {
  enabled: false,
  timer: CONFIG.CAUSAL.PUBLIC_LIGHTNING_INTERVAL,

  update(dt, state) {
    if (!this.enabled) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      // 「暗影律动」冷却缩减：引雷产生频率提高（倍率越小越快）
      // 暗影律动联动：流派 3（因果节点延迟）与流派 4（弹射流，仅冷却适配）均生效
      const cdMult = (state && (state.genre === 3 || state.genre === 4))
        ? EchoManager.mechCooldownMult(state) : 1;
      this.timer = CONFIG.CAUSAL.PUBLIC_LIGHTNING_INTERVAL * cdMult;
      SkyThunderManager.spawnSkyThunderStrike(state);
    }
  },

  clear() {
    this.enabled = false;
    this.timer = CONFIG.CAUSAL.PUBLIC_LIGHTNING_INTERVAL;
  }
};

// ─── VORTEX SYSTEM (Genre 1: Shadow Vortex) ──────────────────────────────────
let _vortexId = 0;

class VortexProjectile {
  constructor(x, y, angle, state) {
    this.id    = _vortexId++;
    this.x     = x;
    this.y     = y;
    this.angle = angle;
    this.speed = CONFIG.VORTEX.PROJECTILE_SPEED;
    this.vx    = Math.cos(angle) * this.speed;
    this.vy    = Math.sin(angle) * this.speed;
    this.radius = CONFIG.VORTEX.PROJECTILE_RADIUS;
    this.alive  = true;
    this.life   = 3.0;
  }

  update(dt, enemies, state) {
    if (!this.alive) return;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }

    // Check hit
    const r = this.radius + 30; // 估算：与敌人半径之和（避免每个敌人 e.radius 累加）
    const rSq = (r + 14) * (r + 14);
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.x - this.x, dy = e.y - this.y;
      if (dx * dx + dy * dy < rSq) {
        // Spawn vortex at impact point
        VortexManager.spawnVortex(this.x, this.y, state);
        Particles.spawn(this.x, this.y, '#dd00ff', 10, 100, 0.6);
        this.alive = false;
        return;
      }
    }
  }
}

class Vortex {
  constructor(x, y, state) {
    this.id          = _vortexId++;
    this.x           = x;
    this.y           = y;
    this.alive       = true;
    this.active      = true; // shadow entity
    this._riftWith   = new Set(); // track which other vortex IDs we've already spawned a rift with
    this._fused      = false;     // LV7: 已参与融合（不可再被融合为大漩涡）
    this._isFused    = false;     // LV7 融合产物（大漩涡）：旋转 3x、闪电 3x、不能继续合成
    const cfg = CONFIG.VORTEX;
    const genreLv = state.genreLv;

    let radiusBonus = genreLv >= 2 ? cfg.LV2_RADIUS_BONUS : 0;
    this.radius      = cfg.VORTEX_RADIUS * (1 + radiusBonus);
    this.maxDuration = cfg.VORTEX_DURATION;
    this.timer       = cfg.VORTEX_DURATION;
    this.pullForce   = cfg.VORTEX_PULL_FORCE;
    this.tickDamage  = cfg.VORTEX_TICK_DAMAGE * (genreLv >= 3 ? (1 + cfg.LV3_DMG_BONUS) : 1);
    this.tickRate    = cfg.VORTEX_TICK_RATE;
    this.tickTimer   = 0;
    this.lightningTimer = 0.5; // LV5: 自产闪电节奏
  }

  update(dt, enemies, state) {
    if (!this.alive) return;
    this.timer -= dt;
    if (this.timer <= 0) { this.alive = false; this.active = false; return; }

    // Pull enemies & deal tick damage
    this.tickTimer -= dt;
    const doTick = this.tickTimer <= 0;
    if (doTick) this.tickTimer = this.tickRate;

    const rSq = this.radius * this.radius;
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.x - this.x, dy = e.y - this.y;
      const dSq = dx * dx + dy * dy;
      if (dSq < rSq) {
        // Pull toward center
        const angle = Math.atan2(-dy, -dx);
        e.x += Math.cos(angle) * this.pullForce * dt;
        e.y += Math.sin(angle) * this.pullForce * dt;

        // Tick damage
        if (doTick) {
          e.takeDamage(this.tickDamage, state);
          const sv = Utils.worldToScreen(e.x, e.y - 16, Renderer.cam);
          Utils.spawnDmgNum(sv.x, sv.y, this.tickDamage);
        }
      }
    }

    // LV5: 漩涡从自己中心持续产生闪电（0.8s 消失，方向随机）
    if (state.genreLv >= 5) {
      // 大漩涡（LV7 融合产物）：产生闪电速度 3x，闪电白色
      this.lightningTimer -= dt * (this._isFused ? 3 : 1);
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 0.5;
        const angle = Math.random() * Math.PI * 2;
        VortexManager.spawnLightning(this.x, this.y, angle, state, this._isFused);
      }
    }

    // LV6: 两个漩涡相交时，在两者之间生成暗影裂隙（分 3/6 次朝怪物密集方向发射激光）
    // 任意两个漩涡都能产生裂隙（fused 大漩涡之间也能，激光数 ×2）
    if (state.genreLv >= 6) {
      for (const other of VortexManager.vortices) {
        if (other === this || !other.alive) continue;
        const sumR = this.radius + other.radius;
        const dx = other.x - this.x, dy = other.y - this.y;
        if (dx * dx + dy * dy < sumR * sumR && !this._riftWith.has(other.id)) {
          this._riftWith.add(other.id);
          other._riftWith && other._riftWith.add(this.id);
          const mx = (this.x + other.x) / 2;
          const my = (this.y + other.y) / 2;
          // 裂隙记录两个 vortex 引用，激光结束后由 VortexManager 处理融合
          // fused × fused 时激光数 ×2（默认 3 → 6）
          const doubleLaser = this._isFused && other._isFused;
          VortexManager.spawnRift(mx, my, state, this, other, doubleLaser);
        }
      }
    }
  }
}

class RiftLaser {
  constructor(x, y, state, v1 = null, v2 = null, doubleLaser = false) {
    this.id    = _vortexId++;
    this.x     = x;
    this.y     = y;
    this.timer  = 0;
    this.alive  = true;
    this.state  = state;
    this._damaged = new Set(); // 每个敌人只受一次伤害
    // 关联的两个 vortex（用于 LV7 融合）
    this._v1 = v1;
    this._v2 = v2;
    // 大漩涡 × 大漩涡 碰撞：激光数 × 2 + 黑白交加 + 长度 × 1.5
    this._isFusedRift = !!(v1 && v2 && v1._isFused && v2._isFused);
    // 大漩涡 × 大漩涡 碰撞时激光数 × 2：3 → 6
    const baseCount = 3;
    const count     = doubleLaser ? baseCount * 2 : baseCount;
    // N 道激光：每隔 0.5s 朝怪物密集方向发射一次
    this._phases = [];
    for (let i = 0; i < count; i++) {
      this._phases.push({ delay: 0.5 + i * 0.5, fired: false, angle: null });
    }
    this._phaseLife  = 0.4;                        // 单次激光持续 0.4s
    this._totalLife  = 0.5 + count * 0.5 + 0.5;    // 末次激光 + 缓冲
  }

  update(dt, enemies) {
    if (!this.alive) return;
    this.timer += dt;

    for (const phase of this._phases) {
      if (!phase.fired && this.timer >= phase.delay) {
        phase.fired = true;
        const angle = this._directionWithNthMostEnemies(enemies, phase.delay);
        if (angle !== null) {
          phase.angle = angle;
          this._damageInCone(angle, enemies);
        }
      }
    }

    if (this.timer >= this._totalLife) {
      this.alive = false;
    }
  }

  // 找扇区内敌人第 N 多的方向（N=1..6，rank 越大方向越靠后）；空扇区不计入
  _directionWithNthMostEnemies(enemies, delay) {
    // 根据 delay 决定第几多的方向：0.5s→1多, 1.0s→2多, 1.5s→3多, 2.0s→4多, 2.5s→5多, 3.0s→6多
    const rank = (delay <= 0.6) ? 1
               : (delay <= 1.1) ? 2
               : (delay <= 1.6) ? 3
               : (delay <= 2.1) ? 4
               : (delay <= 2.6) ? 5
               : 6;
    const sectors = 8;
    const counts = new Array(sectors).fill(0);
    const range  = this._isFusedRift
      ? CONFIG.VORTEX.RIFT_LASER_RANGE * 1.5
      : CONFIG.VORTEX.RIFT_LASER_RANGE;
    for (const e of enemies) {
      if (!e.alive) continue;
      if (this._damaged.has(e.id)) continue;
      const d = Utils.dist(this, e);
      if (d > range) continue;
      const a = Utils.angle(this, e);
      const sector = Math.floor(((a + Math.PI) / (Math.PI * 2)) * sectors) % sectors;
      counts[sector]++;
    }
    // 收集非零扇区并按数量降序排序
    const nonzero = [];
    for (let i = 0; i < sectors; i++) {
      if (counts[i] > 0) nonzero.push({ idx: i, c: counts[i] });
    }
    if (nonzero.length === 0) return null;
    nonzero.sort((a, b) => b.c - a.c);
    const pick = nonzero[Math.min(rank - 1, nonzero.length - 1)];
    const sectorAngle = ((pick.idx / sectors) * Math.PI * 2) - Math.PI;
    // 随机角度扰动 ±30°，避免几次激光完全重合
    const jitter = (Math.random() - 0.5) * (Math.PI / 3);
    return sectorAngle + jitter;
  }

  _damageInCone(angle, enemies) {
    const cfg = CONFIG.VORTEX;
    const dmg = cfg.RIFT_LASER_DAMAGE;
    // 大漩涡裂隙：长度 × 1.5
    const range = this._isFusedRift ? cfg.RIFT_LASER_RANGE * 1.5 : cfg.RIFT_LASER_RANGE;
    for (const e of enemies) {
      if (!e.alive) continue;
      if (this._damaged.has(e.id)) continue;
      const d = Utils.dist(this, e);
      if (d > range) continue;
      const eAngle = Utils.angle(this, e);
      const diff = Math.abs(((eAngle - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (diff < 0.25) { // within ~14 degrees
        e.takeDamage(dmg, this.state);
        const sv = Utils.worldToScreen(e.x, e.y - 16, Renderer.cam);
        Utils.spawnDmgNum(sv.x, sv.y, dmg, 'crit');
        Particles.spawn(e.x, e.y, '#ff00ff', 8, 80, 0.4);
        this._damaged.add(e.id);
      }
    }
  }
}

// ─── VORTEX MANAGER ──────────────────────────────────────────────────────────
const VortexManager = {
  projectiles: [],
  vortices:    [],
  rifts:       [],
  lightnings:  [], // LV5 自产闪电
  fireTimer:   0,

  init() {
    this.projectiles = [];
    this.vortices    = [];
    this.rifts       = [];
    this.lightnings  = [];
    this.fireTimer   = 0;
  },

  update(dt, player, enemies, state) {
    const genreLv = state.genreLv;

    // Auto-fire projectiles toward nearest enemy
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      this.fireTimer = CONFIG.VORTEX.PROJECTILE_INTERVAL;
      const nearest = this._nearestEnemy(player, enemies);
      if (nearest) {
        const angle = Utils.angle(player, nearest);
        // 散弹激活时 ×3（三方向 ±π/6），否则 LV4 时 ×2
        const shotgun = player.shotgun === true;
        const count = shotgun ? 3 : (genreLv >= 4 ? 2 : 1);
        const SHOTGUN_SPREAD = Math.PI / 6;
        for (let i = 0; i < count; i++) {
          let spread = 0;
          if (shotgun) {
            spread = (i === 0) ? -SHOTGUN_SPREAD : (i === 1) ? 0 : SHOTGUN_SPREAD;
          } else if (count > 1) {
            spread = (i === 0) ? -0.15 : 0.15;
          }
          this.projectiles.push(new VortexProjectile(player.x, player.y, angle + spread, state));
        }
      }
    }

    // Update projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      this.projectiles[i].update(dt, enemies, state);
      if (!this.projectiles[i].alive) this.projectiles.splice(i, 1);
    }

    // Update vortices (会 push rift / lightning)
    for (let i = this.vortices.length - 1; i >= 0; i--) {
      this.vortices[i].update(dt, enemies, state);
      if (!this.vortices[i].alive) {
        ShadowLink.forget(this.vortices[i].id); // 释放该漩涡的命中记录
        this.vortices.splice(i, 1);
      }
    }

    // Update rifts (完成后做 LV7 融合)
    for (let i = this.rifts.length - 1; i >= 0; i--) {
      const r = this.rifts[i];
      r.update(dt, enemies);
      if (!r.alive) {
        // LV7: 裂隙激光都发射完后，融合两个 vortex
        // 两个 vortex 至少有一个未 fused 且都还活着时进行融合
        if (state.genreLv >= 7 && r._v1 && r._v2) {
          if (r._v1.alive && r._v2.alive && !r._v1._fused && !r._v2._fused) {
            const mx = (r._v1.x + r._v2.x) / 2;
            const my = (r._v1.y + r._v2.y) / 2;
            const fusedR = CONFIG.VORTEX.VORTEX_RADIUS * CONFIG.VORTEX.LV7_FUSE_RADIUS_MULT;
            // 大漩涡（isFused=true）：旋转 3x、闪电 3x、不能继续合成
            VortexManager.spawnVortex(mx, my, state, undefined, fusedR, true);
            const fv = VortexManager.vortices[VortexManager.vortices.length - 1];
            if (fv) {
              fv._fused   = true;
              fv._isFused = true;
            }
            r._v1.alive = false; r._v1.active = false;
            r._v2.alive = false; r._v2.active = false;
          }
        }
        this.rifts.splice(i, 1);
      }
    }

    // Update lightnings (LV5 自产，0.8s 消失，方向随机)
    for (let i = this.lightnings.length - 1; i >= 0; i--) {
      const l = this.lightnings[i];
      l.life -= dt;
      for (const e of enemies) {
        if (!e.alive || l._damaged.has(e.id)) continue;
        const dx = e.x - l.x, dy = e.y - l.y;
        const range = CONFIG.VORTEX.RIFT_LASER_RANGE;
        if (dx * dx + dy * dy > range * range) continue;
        const eAngle = Math.atan2(dy, dx);
        const diff = Math.abs(((eAngle - l.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (diff < 0.25) {
          e.takeDamage(CONFIG.VORTEX.RIFT_LASER_DAMAGE, l.state);
          l._damaged.add(e.id);
        }
      }
      if (l.life <= 0) this.lightnings.splice(i, 1);
    }
  },

  spawnVortex(x, y, state, duration, radius, isFused) {
    const v = new Vortex(x, y, state);
    if (duration != null) {
      v.maxDuration = duration;
      v.timer = duration;
    }
    if (radius != null) {
      v.radius = radius;
    }
    if (isFused) {
      v._isFused = true; // 大漩涡：旋转 3x、闪电 3x、不能继续合成
    }
    this.vortices.push(v);
  },

  // LV6: 漩涡相交生成的暗影裂隙（v1, v2 用于 LV7 融合；doubleLaser = 激光数 ×2）
  spawnRift(x, y, state, v1 = null, v2 = null, doubleLaser = false) {
    const rift = new RiftLaser(x, y, state, v1, v2, doubleLaser);
    this.rifts.push(rift);
    Particles.spawn(x, y, '#ff00ff', 15, 120, 0.7);
  },

  // LV5: 漩涡自产闪电（0.8s 消失，方向随机）
  spawnLightning(x, y, angle, state, isWhite) {
    const range = CONFIG.VORTEX.RIFT_LASER_RANGE;
    const steps = 7;
    const amp = 14;
    const segs = [{ x: 0, y: 0 }];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      segs.push({
        x: Math.cos(angle) * range * t + Utils.rand(-amp, amp),
        y: Math.sin(angle) * range * t + Utils.rand(-amp, amp),
      });
    }
    this.lightnings.push({
      x, y, angle, segments: segs,
      life: 0.8, maxLife: 0.8,
      state,
      _damaged: new Set(),
      isWhite: !!isWhite, // 大漩涡（LV7 融合产物）的闪电：黑白交加
    });
  },

  getActiveVortices() {
    return this.vortices.filter(v => v.alive);
  },

  _nearestEnemy(player, enemies) {
    let best = null, bestD = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const dSq = Utils.distSq(player, e);
      if (dSq < bestD) { bestD = dSq; best = e; }
    }
    return best;
  },

  clear() {
    this.projectiles = [];
    this.vortices    = [];
    this.rifts       = [];
    this.lightnings  = [];
    this.fireTimer   = 0;
  }
};

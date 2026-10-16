// ─── SHADOW LINK (BUFF 2) ─────────────────────────────────────────────────────
// Lines between player and each shadow entity; enemies passing through take damage.
// Each (link, enemy) pair can deal damage at most once — permanently.
const ShadowLink = {
  enabled: false,
  // Set of "${se.id}_${e.id}" pairs that have already been damaged
  hitKeys: new Set(),

  update(dt, player, shadowEntities, enemies, state) {
    if (!this.enabled) return;

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
      for (const e of enemies) {
        if (!e.alive) continue;
        // 敌人在 link 端点的包围盒之外直接跳过
        const minX = Math.min(player.x, se.x) - (e.radius + 10);
        const maxX = Math.max(player.x, se.x) + (e.radius + 10);
        const minY = Math.min(player.y, se.y) - (e.radius + 10);
        const maxY = Math.max(player.y, se.y) + (e.radius + 10);
        if (e.x < minX || e.x > maxX || e.y < minY || e.y > maxY) continue;

        const key = `${se.id}_${e.id}`;
        if (this.hitKeys.has(key)) continue;

        // Check if enemy is near the line segment player→shadow
        if (this._distToSegmentSq(e, player, se, dx, dy, lenSq) < (e.radius + 10) * (e.radius + 10)) {
          this.hitKeys.add(key); // 永久标记：该 link 对该 enemy 只造成一次伤害
          const dmg = CONFIG.LINK_DAMAGE;
          e.takeDamage(dmg, state, 'shadow');
          const sv = Utils.worldToScreen(e.x, e.y - 16, Renderer.cam);
          Utils.spawnDmgNum(sv.x, sv.y, dmg);
          Particles.spawn(e.x, e.y, '#aa44ff', 4, 50, 0.3);
        }
      }
    }
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

  clear() { this.hitKeys.clear(); }
};

// ─── DEATH SHADOW (BUFF 1) ────────────────────────────────────────────────────
let _dShadowId = 1000;
const DeathShadowManager = {
  enabled: false,
  shadows: [],

  spawn(x, y, state) {
    if (!this.enabled) return;
    this.shadows.push({
      id:          _dShadowId++,
      x, y,
      alive:       false,    // not a threat
      active:      true,     // shadow entity for link/buff
      timer:       CONFIG.DEATH_SHADOW_DURATION,
      maxDuration: CONFIG.DEATH_SHADOW_DURATION,
      fireTimer:   0,        // Echo 流派用
      vortexTimer: 0,        // Vortex 流派用
    });
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
    if (window && window.console) console.debug('[ShadowExplosion]', x.toFixed(0), y.toFixed(0), 'r=' + radius);
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

// ─── SHADOW CLONE (Genre 0: Shadow Echo) ─────────────────────────────────────
let _shadowId = 0;

class ShadowClone {
  constructor(x, y, damage, fireRate, duration) {
    this.id          = _shadowId++;
    this.x           = x;
    this.y           = y;
    this.spawnX      = x;
    this.spawnY      = y;
    this.damage      = damage;
    this.fireRate    = fireRate;
    this.maxDuration = duration;
    this.timer       = duration;
    this.alive       = true;
    this.active      = true; // counts as shadow entity
    this.fireTimer   = 0;
    this.patrolTimer = 0;
    this.patrolAngle = Math.random() * Math.PI * 2;
    this.targetX     = x;
    this.targetY     = y;
    this.radius      = CONFIG.ECHO.BODY_RADIUS;
    this.speed       = 80;
  }

  update(dt, enemies, state) {
    if (!this.alive) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      // LV6: 暗影消散时产生暗影爆破（仅流派 1 Shadow Echo）
      if (state.genre === 0 && state.genreLv >= 6) {
        ShadowExplosionManager.spawn(this.x, this.y, state);
      }
      this.alive = false; this.active = false; return;
    }

    // Patrol movement within radius
    this.patrolTimer -= dt;
    if (this.patrolTimer <= 0) {
      this.patrolTimer = Utils.rand(1.5, 3.0);
      this.patrolAngle += Utils.rand(-1.5, 1.5);
      const pr = CONFIG.ECHO.PATROL_RADIUS;
      let nx = this.spawnX + Math.cos(this.patrolAngle) * Utils.rand(0, pr);
      let ny = this.spawnY + Math.sin(this.patrolAngle) * Utils.rand(0, pr);
      nx = Utils.clamp(nx, 0, CONFIG.MAP_W);
      ny = Utils.clamp(ny, 0, CONFIG.MAP_H);
      this.targetX = nx;
      this.targetY = ny;
    }

    // Move toward patrol target
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const d  = Math.sqrt(dx * dx + dy * dy);
    if (d > 5) {
      this.x += (dx / d) * this.speed * dt;
      this.y += (dy / d) * this.speed * dt;
    }

    // Find nearest enemy and shoot
    this.fireTimer -= dt;
    if (this.fireTimer <= 0 && enemies.length > 0) {
      this.fireTimer = 1 / this.fireRate;
      const nearest = this._nearestEnemy(enemies);
      if (nearest) {
        const angle = Utils.angle(this, nearest);
        BulletManager.spawn(
          this.x, this.y, angle,
          CONFIG.ECHO.BULLET_SPEED,
          this.damage,
          CONFIG.ECHO.BULLET_RADIUS,
          '#aa44ff', 'shadow'
        );
      } else {
        // No enemies nearby — shoot upward
        BulletManager.spawn(
          this.x, this.y, -Math.PI / 2,
          CONFIG.ECHO.BULLET_SPEED,
          this.damage,
          CONFIG.ECHO.BULLET_RADIUS,
          '#aa44ff', 'shadow'
        );
      }
    }
  }

  _nearestEnemy(enemies) {
    let best = null, bestD = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = Utils.dist(this, e);
      if (d < 400 && d < bestD) { bestD = d; best = e; }
    }
    return best;
  }
}

// ─── SHADOW CLONE MANAGER ─────────────────────────────────────────────────────
const ShadowCloneManager = {
  clones: [],

  spawn(x, y, state) {
    const cfg = CONFIG.ECHO;
    let dmg  = cfg.BASE_DAMAGE;
    let rate = cfg.BASE_FIRE_RATE;
    const genreLv = state.genreLv;

    if (genreLv >= 4) dmg *= (1 + cfg.LV4_DMG_BONUS);

    // LV5 speed bonus
    if (genreLv >= 5) {
      const n = this.clones.filter(c => c.alive).length;
      rate = cfg.BASE_FIRE_RATE * (1 + n * cfg.LV5_SHADOW_ASPD_PER_SHADOW);
    }

    const clone = new ShadowClone(x, y, dmg, rate, cfg.DURATION);
    this.clones.push(clone);
    Particles.spawn(x, y, '#6600cc', 12, 100, 0.8);
  },

  update(dt, enemies, state) {
    for (let i = this.clones.length - 1; i >= 0; i--) {
      const c = this.clones[i];
      c.update(dt, enemies, state);
      if (!c.alive) this.clones.splice(i, 1);
    }
  },

  getActive() {
    return this.clones.filter(c => c.alive);
  },

  clear() { this.clones = []; }
};

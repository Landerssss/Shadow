// ─── BULLET ──────────────────────────────────────────────────────────────────
let _bulletId = 0;

class Bullet {
  constructor(x, y, angle, speed, damage, radius, color, owner = 'player') {
    this.id     = _bulletId++;
    this.x      = x;
    this.y      = y;
    this.angle  = angle;
    this.vx     = Math.cos(angle) * speed;
    this.vy     = Math.sin(angle) * speed;
    this.damage = damage;
    this.radius = radius;
    this.color  = color;
    this.owner  = owner; // 'player' | 'shadow' | 'enemy'
    this.alive  = true;
    this.life   = 30; // 兜底最长生命（正常靠命中/地图边界淘汰）
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;

    // 子弹仅在飞出地图边界或兜底时间到时消失
    if (this.x < 0 || this.x > CONFIG.MAP_W ||
        this.y < 0 || this.y > CONFIG.MAP_H ||
        this.life <= 0) {
      this.alive = false;
    }
  }
}

// ─── BULLET MANAGER ──────────────────────────────────────────────────────────
const BulletManager = {
  bullets: [],

  spawn(x, y, angle, speed, damage, radius, color, owner) {
    this.bullets.push(new Bullet(x, y, angle, speed, damage, radius, color, owner));
  },

  update(dt, enemies, state) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.update(dt);
      if (!b.alive) { this.bullets.splice(i, 1); continue; }

      // Collision with enemies (player bullets and shadow bullets)
      if (b.owner === 'player' || b.owner === 'shadow') {
        for (let j = enemies.length - 1; j >= 0; j--) {
          const e = enemies[j];
          if (!e.alive) continue;
          // BOSS 移速极快，用更大碰撞半径（子弹+BOSS+BOSS 本帧位移）避免漏击；
          // 玩家子弹碰到 BOSS 应造成伤害并消失（不反弹）
          const bossMove = (e.type === 'boss') ? Math.hypot(e.vx || 0, e.vy || 0) * dt : 0;
          const collR = b.radius + e.radius + bossMove;
          if (Utils.dist(b, e) < collR) {
            const dmg = b.damage;
            e.takeDamage(dmg, state, b.owner);
            b.alive = false;
            // spawn particles
            Particles.spawn(b.x, b.y,
              b.owner === 'shadow' ? '#aa44ff' : '#c97bff', 5, 60, 0.4);
            // screen damage number
            const sv = Utils.worldToScreen(e.x, e.y - 20, Renderer.cam);
            Utils.spawnDmgNum(sv.x, sv.y, dmg, e.type === 'boss' ? 'boss' : '');
            break;
          }
        }
      } else if (b.owner === 'enemy') {
        // Enemy bullets hit the player
        const p = state.player;
        if (Utils.dist(b, p) < b.radius + CONFIG.PLAYER_RADIUS) {
          const dmg = b.damage;
          p.takeDamage(dmg, state);
          b.alive = false;
          Particles.spawn(b.x, b.y, b.color || '#ffd84a', 5, 60, 0.4);
          const sv = Utils.worldToScreen(p.x, p.y - 20, Renderer.cam);
          Utils.spawnDmgNum(sv.x, sv.y, dmg);
        }
      }
    }
  },

  clear() { this.bullets = []; }
};

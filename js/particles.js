// ─── PARTICLE SYSTEM ─────────────────────────────────────────────────────────
const Particles = {
  list: [],

  spawn(x, y, color = '#c97bff', count = 6, speed = 80, life = 0.5, rRange = [2, 4]) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd   = Utils.rand(speed * 0.5, speed);
      this.list.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        r:  Utils.rand(rRange[0], rRange[1]),
        life, maxLife: life,
        alpha: 1,
        color
      });
    }
  },

  // Floating text particle (e.g. "+" heal indicator)
  spawnText(x, y, text, color = '#44ff88', life = 1.0, size = 16) {
    this.list.push({
      x, y,
      vx: Utils.rand(-15, 15),
      vy: -40,
      r: 0,
      life, maxLife: life,
      alpha: 1,
      color,
      text,
      size,
      isText: true
    });
  },

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.x  += p.vx * dt;
      p.y  += p.vy * dt;
      p.vx *= 0.9;
      p.vy *= 0.9;
      p.life -= dt;
      p.alpha = Math.max(0, p.life / p.maxLife);
      if (p.life <= 0) this.list.splice(i, 1);
    }
  },

  clear() { this.list = []; }
};

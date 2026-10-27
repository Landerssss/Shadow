// ─── PARTICLE SYSTEM ─────────────────────────────────────────────────────────
const Particles = {
  list: [],
  MAX: 4000, // 保险上限：极端情况下丢弃新粒子，防止数组无限增长拖垮帧率

  spawn(x, y, color = '#c97bff', count = 6, speed = 80, life = 0.5, rRange = [2, 4]) {
    for (let i = 0; i < count; i++) {
      if (this.list.length >= this.MAX) return;
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
    if (this.list.length >= this.MAX) return;
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
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.x  += p.vx * dt;
      p.y  += p.vy * dt;
      p.vx *= 0.9;
      p.vy *= 0.9;
      p.life -= dt;
      p.alpha = Math.max(0, p.life / p.maxLife);
      if (p.life <= 0) {
        // 交换删除（O(1)），粒子间无绘制层级语义
        list[i] = list[list.length - 1];
        list.pop();
      }
    }
  },

  clear() { this.list = []; }
};

// ─── MAP / BACKGROUND PARTICLES ──────────────────────────────────────────────
const MapDecor = {
  bgParticles: [],

  init() {
    this.bgParticles = [];
    for (let i = 0; i < 80; i++) {
      this.bgParticles.push({
        x:     Utils.rand(0, CONFIG.MAP_W),
        y:     Utils.rand(0, CONFIG.MAP_H),
        r:     Utils.rand(1, 3),
        alpha: Utils.rand(0.05, 0.25),
        drift: Utils.rand(0.2, 0.6),
        driftAngle: Math.random() * Math.PI * 2,
        color: Math.random() < 0.5 ? '#7b2fff' : '#ff3cac',
      });
    }
  },

  update(dt) {
    for (const p of this.bgParticles) {
      p.x += Math.cos(p.driftAngle) * p.drift;
      p.y += Math.sin(p.driftAngle) * p.drift;
      p.driftAngle += Utils.rand(-0.02, 0.02);
      // Wrap
      if (p.x < 0) p.x += CONFIG.MAP_W;
      if (p.x > CONFIG.MAP_W) p.x -= CONFIG.MAP_W;
      if (p.y < 0) p.y += CONFIG.MAP_H;
      if (p.y > CONFIG.MAP_H) p.y -= CONFIG.MAP_H;
    }
  },

  draw(ctx, cam) {
    const ox = cam.sw / 2 - cam.x;
    const oy = cam.sh / 2 - cam.y;
    for (const p of this.bgParticles) {
      const sx = p.x + ox;
      const sy = p.y + oy;
      if (sx < -20 || sx > cam.sw + 20 || sy < -20 || sy > cam.sh + 20) continue;
      // 发光用光晕贴图替代 shadowBlur
      Renderer._drawGlow(sx, sy, p.r * 3, p.color, p.alpha * 0.8);
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(sx, sy, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
};

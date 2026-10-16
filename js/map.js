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
    for (const p of this.bgParticles) {
      if (!Utils.isOnScreen(p.x, p.y, cam, 20)) continue;
      const s = Utils.worldToScreen(p.x, p.y, cam);
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 6; ctx.shadowColor = p.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
};

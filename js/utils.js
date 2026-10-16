// ─── UTILITY FUNCTIONS ───────────────────────────────────────────────────────
const Utils = {
  dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  },
  angle(from, to) {
    return Math.atan2(to.y - from.y, to.x - from.x);
  },
  normalize(dx, dy) {
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: dx / len, y: dy / len };
  },
  lerp(a, b, t) { return a + (b - a) * t; },
  clamp(v, min, max) { return Math.min(max, Math.max(min, v)); },
  rand(min, max) { return min + Math.random() * (max - min); },
  randInt(min, max) { return Math.floor(Utils.rand(min, max + 1)); },
  shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },
  // screen coords from world coords
  worldToScreen(wx, wy, cam) {
    return {
      x: wx - cam.x + cam.sw / 2,
      y: wy - cam.y + cam.sh / 2
    };
  },
  screenToWorld(sx, sy, cam) {
    return {
      x: sx + cam.x - cam.sw / 2,
      y: sy + cam.y - cam.sh / 2
    };
  },
  isOnScreen(wx, wy, cam, margin = 80) {
    const s = Utils.worldToScreen(wx, wy, cam);
    return s.x > -margin && s.x < cam.sw + margin &&
           s.y > -margin && s.y < cam.sh + margin;
  },
  // spawn floating damage number
  spawnDmgNum(screenX, screenY, value, type = '') {
    const el = document.createElement('div');
    el.className = 'dmg-num' + (type ? ' ' + type : '');
    el.textContent = Math.round(value);
    el.style.left = (screenX - 12) + 'px';
    el.style.top  = (screenY - 10) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 700);
  }
};

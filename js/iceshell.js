// ─── 暗影冰封 · 俯视角透明结晶冰壳（纯视觉）──────────────────────────────
// 只读取敌人世界坐标与 freezeTimer；不修改伤害、减速、命中累计、控制时长、冷却与流派逻辑。
// 冰壳由固定种子的 9 块主晶面 + 外侧厚度环组成，enter / hold / exit 共用同一套几何。
// 材质采用透明分面、深浅折面、窄厚度边、局部反光与少量冰纹；雪花走现有粒子池。
const IceShell = {
  ENTER: 0.70,
  EXIT: 0.32,
  CRACK: 0.09,

  list: [],

  clear() {
    for (const s of this.list) {
      if (s.enemy) s.enemy._iceShell = null;
    }
    this.list.length = 0;
    if (typeof Particles !== 'undefined' && Particles.clearSnowflakes) {
      Particles.clearSnowflakes();
    }
  },

  // 按怪物实际可见身体范围留 4～6px 空间；不使用碰撞半径直接放大，也不做统一固定大罩。
  visualRadius(enemy) {
    const r = enemy.radius || 14;
    switch (enemy.type) {
      case 'healer':  return r * 1.30 + 5; // 三角主体顶点约 1.3r
      case 'charger': return r * 1.74 + 5; // 前伸裂角约 1.74r
      case 'bulwark': return r * 1.22 + 5; // 六边形甲壳与足爪约 1.2r
      case 'lobber':  return r * 1.64 + 5; // 头顶灰烬囊最高约 1.64r
      case 'wave':    return r + 7;
      case 'boss':    return r * 1.30 + 8; // Boss 眼体与外围光晕较大，留出可见冰层
      default:        return r + 7;
    }
  },

  _clamp(v) { return Math.max(0, Math.min(1, v)); },

  _rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  _seed(enemy) {
    const type = enemy.type || 'melee';
    let h = 2166136261;
    for (let i = 0; i < type.length; i++) h = Math.imul(h ^ type.charCodeAt(i), 16777619);
    return (h ^ (enemy.id * 2654435761)) >>> 0;
  },

  _centroid(pts) {
    let x = 0, y = 0;
    for (const p of pts) { x += p.x; y += p.y; }
    return { x: x / pts.length, y: y / pts.length };
  },

  _bbox(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    return [x0, y0, x1, y1];
  },

  _pickColors(kind, lit) {
    const t = this._clamp(lit);
    // 低饱和冰蓝 / 深蓝紫 / 淡青蓝三档，作为透明玻璃的折面色。
    if (kind === 'top') {
      return t > 0.55
        ? ['#d6f6ff', '#8ec4e6', '#4d63a4']
        : ['#a9d7ee', '#6f95ca', '#383f7f'];
    }
    if (kind === 'front') {
      return t > 0.50
        ? ['#c8edfb', '#7fa9d8', '#405498']
        : ['#a9c8ea', '#6f8fc9', '#3d4580'];
    }
    return t > 0.55
      ? ['#d3f6ff', '#86badf', '#4a619f']
      : ['#93b9e2', '#627fc0', '#3a3f80'];
  },

  _bandColors(lit) {
    return lit > 0.55
      ? ['#3a3f7c', '#6d8cc4', '#c4f2ff']
      : ['#121226', '#2d326b', '#6079b5'];
  },

  _mixColor(hex, target, t) {
    const a = parseInt(hex.slice(1), 16), b = parseInt(target.slice(1), 16);
    const r = Math.round(((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t);
    const g = Math.round(((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t);
    const bl = Math.round((a & 255) + ((b & 255) - (a & 255)) * t);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  },

  _build(radius, seed) {
    const TAU = Math.PI * 2, N = 9;
    const rnd = this._rng(seed);
    const center = {
      x: (rnd() - 0.5) * radius * 0.05,
      y: (rnd() - 0.5) * radius * 0.05,
    };
    const crown = {
      x: center.x + (rnd() - 0.5) * radius * 0.07,
      y: center.y - radius * (0.06 + rnd() * 0.04),
    };

    const outer = [];
    for (let k = 0; k < N; k++) {
      const a = -Math.PI / 2 + (k * TAU) / N + (rnd() - 0.5) * 0.11;
      let rr;
      if (k === 0)       rr = radius * (1.08 + rnd() * 0.05); // 顶部主晶峰
      else if (k === 1)  rr = radius * (1.02 + rnd() * 0.05); // 右上晶峰
      else if (k === 8)  rr = radius * (1.04 + rnd() * 0.04); // 左上晶峰
      else if (k === 2 || k === 7) rr = radius * (0.99 + rnd() * 0.04); // 两侧外折面
      else               rr = radius * (0.88 + rnd() * 0.09);
      outer.push({
        x: center.x + Math.cos(a) * rr * 0.98,
        y: center.y + Math.sin(a) * rr * 1.04,
      });
    }

    const inner = outer.map((p) => {
      const dx = p.x - center.x, dy = p.y - center.y;
      const d = Math.hypot(dx, dy) || 1;
      const a = Math.atan2(dy, dx);
      const band = radius * (0.09 + 0.055 * (0.5 + 0.5 * Math.sin(a))) * (0.85 + rnd() * 0.3);
      return { x: p.x - (dx / d) * band, y: p.y - (dy / d) * band };
    });

    const facets = [];
    for (let k = 0; k < N; k++) {
      const pts = [inner[k], inner[(k + 1) % N], crown];
      const c = this._centroid(pts);
      const dx = c.x - center.x, dy = c.y - center.y;
      const d = Math.hypot(dx, dy) || 1;
      const lit = this._clamp(
        0.5 + (-(dx / d) * 0.55 - (dy / d) * 0.84) * 0.55 + (rnd() - 0.5) * 0.18
      );
      const kind = (k === 8 || k === 0 || k === 1) ? 'top'
        : (k === 4 || k === 5 || k === 6) ? 'front' : 'side';
      const at = kind === 'top' ? 0.30 + (k % 3) * 0.035
        : kind === 'front' ? 0.43 + (k % 3) * 0.028
        : 0.11 + (k % 3) * 0.035;
      const dur = 0.15 + (k % 3) * 0.02;
      const colors = this._pickColors(kind, lit);
      const smallBoost = radius < 26 ? 1.34 : 1;
      const tint = radius < 26 ? 0.30 : 0;
      const light = tint ? this._mixColor(colors[0], '#e6faff', tint) : colors[0];
      const mid = tint ? this._mixColor(colors[1], '#b9e6ff', tint) : colors[1];
      const dark = tint ? this._mixColor(colors[2], '#7fb8e8', tint) : colors[2];
      const alpha = (kind === 'top' ? 0.17 + 0.08 * lit
        : kind === 'front' ? 0.20 + 0.10 * lit
        : 0.18 + 0.10 * lit) * smallBoost;
      const box = this._bbox(pts);
      const F = {
        pts, c, lit, kind, at, dur, i: k,
        light, mid, dark,
        alpha: this._clamp(alpha),
        back: c.y < center.y - radius * 0.28,
        box,
        seam: (k === 2 || k === 5 || k === 7) ? [crown, inner[(k + 1) % N]] : null,
        _grad: null,
      };
      facets.push(F);
    }

    const band = [];
    for (let k = 0; k < N; k++) {
      const pts = [outer[k], outer[(k + 1) % N], inner[(k + 1) % N], inner[k]];
      const c = this._centroid(pts);
      const dx = c.x - center.x, dy = c.y - center.y;
      const d = Math.hypot(dx, dy) || 1;
      const lit = this._clamp(
        0.5 + (-(dx / d) * 0.55 - (dy / d) * 0.84) * 0.55 + (rnd() - 0.5) * 0.14
      );
      const colors = this._bandColors(lit);
      band.push({
        pts, c, lit, i: k,
        light: colors[2], mid: colors[1], dark: colors[0],
        alpha: 0.24 + 0.16 * (1 - lit),
        at: 0.05 + k * 0.013,
        dur: 0.16,
        back: c.y < center.y - radius * 0.14,
        _grad: null,
      });
    }

    const shards = facets.map((F, i) => {
      const dx = F.c.x - center.x, dy = F.c.y - center.y;
      const d = Math.hypot(dx, dy) || 1;
      return {
        pts: F.pts.map((p) => ({ x: p.x - F.c.x, y: p.y - F.c.y })),
        x: F.c.x, y: F.c.y, dx: dx / d, dy: dy / d,
        spd: 30 + (i % 5) * 8 + (i % 3) * 5,
        rot: (i % 2 ? 1 : -1) * (0.6 + rnd() * 1.2),
        lit: F.lit,
        light: F.light,
        dark: F.dark,
        formed: 0,
      };
    });

    const cracks = [];
    for (let n = 0; n < 3; n++) {
      const a = rnd() * TAU;
      let x = center.x + Math.cos(a) * radius * (0.12 + rnd() * 0.16);
      let y = center.y + Math.sin(a) * radius * (0.12 + rnd() * 0.16);
      const pts = [{ x, y }];
      const len = radius * (0.16 + rnd() * 0.14);
      for (let s = 1; s <= 3; s++) {
        const aa = a + (rnd() - 0.5) * 0.55;
        x += Math.cos(aa) * len / 3;
        y += Math.sin(aa) * len / 3;
        pts.push({ x, y });
      }
      const c = pts[1];
      cracks.push({ pts, back: c.y < center.y });
    }

    const bubbles = [];
    for (let n = 0; n < 2; n++) {
      const a = -Math.PI * 0.86 + rnd() * Math.PI * 0.72;
      const rr = radius * (0.22 + rnd() * 0.26);
      const bx = center.x + Math.cos(a) * rr;
      const by = center.y + Math.sin(a) * rr;
      bubbles.push({
        x: bx, y: by,
        r: Math.max(1.4, radius * (0.045 + rnd() * 0.035)),
        back: by < center.y,
        _grad: null,
      });
    }

    const frontFacets = facets
      .filter((F) => !F.back && F.kind !== 'top')
      .sort((a, b) => b.lit - a.lit);
    const refl = frontFacets.slice(0, 2).map((F, i) => ({
      i: F.i,
      off: 0.12 + i * 0.34 + rnd() * 0.1,
    }));

    const seeds = [8, 0, 2, 5].map((idx, i) => ({
      x: outer[idx].x,
      y: outer[idx].y,
      size: 2.2 + rnd() * 1.6,
      at: 0.01 + i * 0.025,
      back: outer[idx].y < center.y,
    }));

    // 底缘/转角厚度反光：只取最低的 2 段外缘，避免整圈双线。
    const rimGlints = band.slice().sort((a, b) => b.c.y - a.c.y).slice(0, 3).map((b) => b.i);

    return {
      radius, center, crown, outer, inner, facets, band, shards, cracks, bubbles,
      refl, seeds, rimGlints, seed,
      phaseOffset: (seed % 1000) / 1000,
      _baseGrad: null,
    };
  },

  _create(enemy) {
    const radius = this.visualRadius(enemy);
    const shell = this._build(radius, this._seed(enemy));
    shell.enemy = enemy;
    shell.x = enemy.x;
    shell.y = enemy.y;
    shell.phase = 'enter';
    shell.t = 0;
    shell.exitDur = this.EXIT;
    shell.exitForm = 1;
    shell.natural = false;
    shell.snowBorn = 0;
    shell.snowNext = 0.05;
    shell.snowAlive = 0;
    return shell;
  },

  _facetReveal(shell, F) {
    if (shell.phase === 'enter') return this._clamp((shell.t - F.at) / F.dur);
    if (shell.phase === 'exit') return F._formed || 0;
    return 1;
  },

  // 自然解除和死亡共用同一套晶面；死亡按当前形成进度碎裂，形成中死亡不会补全。
  _beginExit(shell, natural) {
    if (!shell || shell.phase === 'exit') return;
    shell.exitForm = shell.phase === 'enter' ? this._clamp(shell.t / this.ENTER) : 1;
    for (const F of shell.facets) {
      F._formed = shell.phase === 'enter'
        ? this._clamp((shell.t - F.at) / F.dur)
        : 1;
    }
    for (let i = 0; i < shell.shards.length; i++) {
      shell.shards[i].formed = shell.facets[i]._formed || 0;
    }
    shell.phase = 'exit';
    shell.t = 0;
    shell.natural = !!natural;
    shell.exitDur = natural ? this.EXIT : Math.min(this.EXIT, 0.28);
    this._spawnExitSnow(shell, natural);
  },

  // EnemyManager.update 在移除死亡敌人之前调用；这里只接管视觉实例。
  onEnemyDeath(enemy) {
    const shell = enemy._iceShell;
    if (!shell) return;
    shell.x = enemy.x;
    shell.y = enemy.y;
    this._beginExit(shell, false);
    shell.enemy = null;
    enemy._iceShell = null;
  },

  _spawnSnow(shell, exit) {
    if (typeof Particles === 'undefined' || !Particles.spawnSnowflake) return false;
    const a = Math.random() * Math.PI * 2;
    const r = shell.radius;
    const dist = r * (exit ? (0.82 + Math.random() * 0.25) : (1.02 + Math.random() * 0.30));
    const size = Math.max(2.5, Math.min(4.4, r * 0.11 + 1.7));
    return Particles.spawnSnowflake(shell.x + Math.cos(a) * dist, shell.y + Math.sin(a) * dist * 0.9, {
      owner: exit ? null : shell,
      back: Math.random() < 0.45,
      r: size * (0.82 + Math.random() * 0.38),
      arms: Math.random() < 0.22 ? 4 : 6,
      vx: exit ? Math.cos(a) * (20 + Math.random() * 22) : Math.cos(a) * (3 + Math.random() * 5),
      vy: exit ? Math.sin(a) * (16 + Math.random() * 18) : Math.sin(a) * 3 - 4 - Math.random() * 5,
      life: exit ? (0.65 + Math.random() * 0.5) : (2.1 + Math.random() * 1.2),
      rotV: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.5),
    });
  },

  _spawnExitSnow(shell, natural) {
    const n = 2 + (shell.seed % 2);
    for (let i = 0; i < n; i++) this._spawnSnow(shell, true);
    void natural;
  },

  update(dt, enemies) {
    if (!enemies) return;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      if (e.freezeTimer > 0) {
        let s = e._iceShell;
        if (!s) {
          s = this._create(e);
          e._iceShell = s;
          this.list.push(s);
        }
        s.x = e.x;
        s.y = e.y;
      } else if (e._iceShell) {
        e._iceShell.x = e.x;
        e._iceShell.y = e.y;
        this._beginExit(e._iceShell, true);
        e._iceShell.enemy = null;
        e._iceShell = null;
      }
    }

    let attached = 0;
    for (let i = 0; i < this.list.length; i++) if (this.list[i].enemy) attached++;

    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      if (s.enemy) {
        s.x = s.enemy.x;
        s.y = s.enemy.y;
      }
      s.t += dt;

      if (s.phase === 'enter' && s.t >= this.ENTER) {
        s.phase = 'hold';
        s.t = 0;
      } else if (s.phase === 'exit' && s.t >= s.exitDur) {
        this.list.splice(i, 1);
        continue;
      }

      if (!s.enemy) continue;
      if (s.phase === 'enter') {
        let cap = 5 + (s.seed % 3);
        if (attached > 4) cap = 3 + (s.seed % 2);
        while (s.snowBorn < cap && s.t >= s.snowNext) {
          if (this._spawnSnow(s, false)) s.snowBorn++;
          s.snowNext += 0.055 + ((s.seed >>> 5) % 4) * 0.012;
        }
      } else if (s.phase === 'hold') {
        s.snowNext -= dt;
        if (s.snowNext <= 0) {
          const crowded = attached > 4;
          const cap = crowded ? 2 : 4;
          if ((s.snowAlive || 0) < cap) this._spawnSnow(s, false);
          s.snowNext = (crowded ? 1.7 : 1.0) + ((s.seed >>> 4) % 7) * 0.14 + Math.random() * 0.4;
        }
      }
    }
  },

  _path(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  },

  _traceOpen(ctx, pts, frac) {
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    let left = total * this._clamp(frac);
    let tip = pts[0];
    for (let i = 1; i < pts.length && left > 0; i++) {
      const a = pts[i - 1], b = pts[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const u = Math.min(1, left / Math.max(0.001, len));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u);
      ctx.stroke();
      tip = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
      left -= len;
    }
    return tip;
  },

  _tracePoly(ctx, pts, frac) {
    let total = 0;
    for (let i = 0; i < pts.length; i++) {
      const q = pts[(i + 1) % pts.length];
      total += Math.hypot(q.x - pts[i].x, q.y - pts[i].y);
    }
    let left = total * this._clamp(frac);
    let tip = pts[0];
    for (let i = 0; i < pts.length && left > 0; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const u = Math.min(1, left / Math.max(0.001, len));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u);
      ctx.stroke();
      tip = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
      left -= len;
    }
    return tip;
  },

  _facetGradient(ctx, F) {
    if (F._grad) return F._grad;
    const b = F.box;
    const g = ctx.createLinearGradient(b[0], b[1], b[2], b[3]);
    g.addColorStop(0, F.light);
    g.addColorStop(0.55, F.mid);
    g.addColorStop(1, F.dark);
    F._grad = g;
    return g;
  },

  _bandGradient(ctx, bf) {
    if (bf._grad) return bf._grad;
    const a = bf.pts[0], b = bf.pts[1], c = bf.pts[2], d = bf.pts[3];
    const ox = (a.x + b.x) * 0.5, oy = (a.y + b.y) * 0.5;
    const ix = (c.x + d.x) * 0.5, iy = (c.y + d.y) * 0.5;
    const g = ctx.createLinearGradient(ox, oy, ix, iy);
    g.addColorStop(0, bf.dark);
    g.addColorStop(0.62, bf.mid);
    g.addColorStop(1, bf.light);
    bf._grad = g;
    return g;
  },

  _drawBase(ctx, shell) {
    if (!shell._baseGrad) {
      const g = ctx.createRadialGradient(
        shell.center.x, shell.center.y, shell.radius * 0.12,
        shell.center.x, shell.center.y, shell.radius * 1.18
      );
      g.addColorStop(0, 'rgba(84,124,184,0.012)');
      g.addColorStop(0.62, 'rgba(58,82,154,0.070)');
      g.addColorStop(1, 'rgba(24,24,62,0.310)');
      shell._baseGrad = g;
    }
    const p = shell.phase === 'enter'
      ? this._clamp(shell.t / 0.18)
      : (shell.exitForm == null ? 1 : shell.exitForm);
    if (p <= 0) return;
    ctx.save();
    ctx.globalAlpha = p;
    ctx.fillStyle = shell._baseGrad;
    this._path(ctx, shell.outer);
    ctx.fill();
    ctx.restore();
  },

  _drawBand(ctx, shell, bf, enter) {
    const rev = enter
      ? this._clamp((shell.t - bf.at) / bf.dur)
      : (shell.exitForm == null ? 1 : shell.exitForm);
    if (rev <= 0) return;
    const fillRev = enter ? this._clamp((rev - 0.28) / 0.72) : rev;

    if (fillRev > 0) {
      ctx.save();
      ctx.globalAlpha = bf.alpha * fillRev;
      ctx.fillStyle = this._bandGradient(ctx, bf);
      this._path(ctx, bf.pts);
      ctx.fill();
      ctx.restore();
    }

    if (enter && rev < 1) {
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(230,253,255,0.82)';
      const tip = this._traceOpen(ctx, [bf.pts[0], bf.pts[1]], this._clamp(rev / 0.74));
      if (rev < 0.74) {
        ctx.fillStyle = 'rgba(244,255,255,0.95)';
        ctx.fillRect(tip.x - 0.9, tip.y - 0.9, 1.8, 1.8);
      }
      ctx.restore();
      return;
    }

    // 厚度边：受光侧用亮边，背光侧用深边；不做整圈等亮双线。
    const lit = bf.lit > 0.54;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = lit ? 'rgba(220,251,255,0.58)' : 'rgba(18,18,48,0.58)';
    ctx.lineWidth = lit ? 0.9 : 1.5;
    ctx.beginPath();
    ctx.moveTo(bf.pts[0].x, bf.pts[0].y);
    ctx.lineTo(bf.pts[1].x, bf.pts[1].y);
    ctx.stroke();

    // 内缘：用低亮冰青勾出玻璃厚度，外缘负责明暗变化。
    ctx.strokeStyle = lit ? 'rgba(206,246,255,0.34)' : 'rgba(150,225,250,0.18)';
    ctx.lineWidth = lit ? 0.85 : 0.75;
    ctx.beginPath();
    ctx.moveTo(bf.pts[3].x, bf.pts[3].y);
    ctx.lineTo(bf.pts[2].x, bf.pts[2].y);
    ctx.stroke();

    // 少量厚度反光，落在部分外缘上，不做整圈高亮。
    if (lit && bf.i % 3 === 0) {
      ctx.strokeStyle = 'rgba(244,255,255,0.42)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(bf.pts[0].x + (bf.pts[1].x - bf.pts[0].x) * 0.24,
                 bf.pts[0].y + (bf.pts[1].y - bf.pts[0].y) * 0.24);
      ctx.lineTo(bf.pts[0].x + (bf.pts[1].x - bf.pts[0].x) * 0.72,
                 bf.pts[0].y + (bf.pts[1].y - bf.pts[0].y) * 0.72);
      ctx.stroke();
    }
    ctx.restore();
  },

  _drawFacet(ctx, shell, F, enter) {
    const rev = this._facetReveal(shell, F);
    if (rev <= 0) return;

    const fillRev = enter ? this._clamp((rev - 0.30) / 0.70) : rev;
    if (fillRev > 0) {
      ctx.save();
      ctx.globalAlpha = F.alpha * fillRev;
      ctx.fillStyle = this._facetGradient(ctx, F);
      this._path(ctx, F.pts);
      ctx.fill();
      ctx.restore();
    }

    if (enter && rev < 1) {
      const edgeRev = this._clamp(rev / 0.62);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(224,252,255,' + (0.48 + 0.42 * edgeRev).toFixed(3) + ')';
      const tip = this._tracePoly(ctx, F.pts, edgeRev);
      if (edgeRev < 1) {
        ctx.fillStyle = 'rgba(246,255,255,0.96)';
        ctx.fillRect(tip.x - 0.9, tip.y - 0.9, 1.8, 1.8);
      }
      ctx.restore();
      return;
    }

    if (rev >= 1 && enter) this._drawEnterGlint(ctx, shell, F);
  },

  _drawEnterGlint(ctx, shell, F) {
    const age = shell.t - (F.at + F.dur);
    if (age < 0 || age > 0.17) return;
    const u = age / 0.17;
    const a = Math.sin(Math.PI * u) * 0.52;
    if (a <= 0.01) return;
    const b = F.box;
    ctx.save();
    this._path(ctx, F.pts);
    ctx.clip();
    ctx.translate(b[0] + (b[2] - b[0]) * 0.55, b[1] + (b[3] - b[1]) * 0.55);
    ctx.rotate(-0.65);
    const len = Math.hypot(b[2] - b[0], b[3] - b[1]) * 0.7;
    const g = ctx.createLinearGradient(-len * 0.5, 0, len * 0.5, 0);
    g.addColorStop(0, 'rgba(232,253,255,0)');
    g.addColorStop(0.5, 'rgba(246,255,255,' + a.toFixed(3) + ')');
    g.addColorStop(1, 'rgba(168,236,255,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = Math.max(2, len * 0.10);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-len * 0.5, 0);
    ctx.lineTo(len * 0.5, 0);
    ctx.stroke();
    ctx.restore();
  },

  _drawStructure(ctx, shell, layer) {
    const C = shell.crown;
    // 中央折脊：只作为材质高光，不构成贯穿线框。
    if (layer === 'front') {
      const o = shell.outer[0];
      const ex = C.x + (o.x - C.x) * 0.56;
      const ey = C.y + (o.y - C.y) * 0.56;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(20,24,60,0.18)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(C.x + 0.5, C.y + 0.4);
      ctx.lineTo(ex + 0.5, ey + 0.4);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(210,248,255,0.34)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(C.x - 0.4, C.y - 0.3);
      ctx.lineTo(ex - 0.4, ey - 0.3);
      ctx.stroke();
      ctx.restore();
    }

    // 底缘厚度反光：让外圈在深色背景上仍能读出冰层厚度。
    if (layer === 'front') {
      for (const idx of shell.rimGlints) {
        const bf = shell.band[idx];
        if (!bf) continue;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(20,24,60,0.24)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(bf.pts[0].x + 0.5, bf.pts[0].y + 0.5);
        ctx.lineTo(bf.pts[1].x + 0.5, bf.pts[1].y + 0.5);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(226,252,255,0.55)';
        ctx.lineWidth = 0.95;
        ctx.beginPath();
        ctx.moveTo(bf.pts[0].x - 0.3, bf.pts[0].y - 0.3);
        ctx.lineTo(bf.pts[1].x - 0.3, bf.pts[1].y - 0.3);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 少量内部折面接缝：明暗交错，避免把 9 块晶面全部勾成线网。
    for (const F of shell.facets) {
      if (!F.seam) continue;
      if (F.back !== (layer === 'back')) continue;
      const a = F.seam[0], b = F.seam[1];
      const x0 = a.x + (b.x - a.x) * 0.16;
      const y0 = a.y + (b.y - a.y) * 0.16;
      const x1 = a.x + (b.x - a.x) * 0.58;
      const y1 = a.y + (b.y - a.y) * 0.58;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(18,22,54,' + (0.13 + 0.07 * (1 - F.lit)).toFixed(3) + ')';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x0 + 0.5, y0 + 0.4);
      ctx.lineTo(x1 + 0.5, y1 + 0.4);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(196,242,255,' + (0.13 + 0.14 * F.lit).toFixed(3) + ')';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(x0 - 0.3, y0 - 0.3);
      ctx.lineTo(x1 - 0.3, y1 - 0.3);
      ctx.stroke();
      ctx.restore();
    }
  },

  _drawBubbles(ctx, shell, layer) {
    for (const b of shell.bubbles) {
      if (b.back !== (layer === 'back')) continue;
      if (!b._grad) {
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 1.4);
        g.addColorStop(0, 'rgba(238,254,255,0.20)');
        g.addColorStop(0.45, 'rgba(174,236,255,0.09)');
        g.addColorStop(1, 'rgba(120,190,235,0)');
        b._grad = g;
      }
      ctx.save();
      ctx.fillStyle = b._grad;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(246,255,255,0.16)';
      ctx.beginPath();
      ctx.arc(b.x - b.r * 0.18, b.y - b.r * 0.22, b.r * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  },

  _drawCracks(ctx, shell, layer, frac, bright) {
    for (const c of shell.cracks) {
      if (c.back !== (layer === 'back')) continue;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = bright ? 'rgba(238,254,255,0.85)' : 'rgba(22,26,62,0.28)';
      ctx.lineWidth = bright ? 1 : 1.2;
      let tip = this._traceOpen(ctx, c.pts, frac);
      if (bright) {
        ctx.strokeStyle = 'rgba(246,255,255,0.92)';
        ctx.lineWidth = 0.8;
        this._traceOpen(ctx, c.pts, frac);
        if (frac < 1) {
          ctx.fillStyle = 'rgba(246,255,255,0.9)';
          ctx.fillRect(tip.x - 0.9, tip.y - 0.9, 1.8, 1.8);
        }
      } else {
        ctx.strokeStyle = 'rgba(190,236,255,0.16)';
        ctx.lineWidth = 0.7;
        this._traceOpen(ctx, c.pts, frac);
      }
      ctx.restore();
    }
  },

  _drawSeeds(ctx, shell, layer) {
    for (const s of shell.seeds) {
      if (s.back !== (layer === 'back')) continue;
      const age = shell.t - s.at;
      if (age < 0 || age > 0.30) continue;
      const a = 1 - this._clamp(age / 0.30);
      const r = s.size * (0.5 + 0.5 * this._clamp(age / 0.12));
      ctx.save();
      ctx.strokeStyle = 'rgba(226,252,255,' + (0.72 * a).toFixed(3) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - r);
      ctx.lineTo(s.x + r * 0.62, s.y);
      ctx.lineTo(s.x, s.y + r);
      ctx.lineTo(s.x - r * 0.62, s.y);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = 'rgba(246,255,255,' + (0.85 * a).toFixed(3) + ')';
      ctx.fillRect(s.x - 0.6, s.y - 0.6, 1.2, 1.2);
      ctx.restore();
    }
  },

  _drawReflections(ctx, shell, time, layer) {
    if (layer !== 'front' || shell.phase !== 'hold') return;
    for (const rf of shell.refl) {
      const F = shell.facets[rf.i];
      if (!F) continue;
      const cycle = (time * 0.11 + shell.phaseOffset + rf.off) % 1;
      if (cycle > 0.16) continue;
      const u = cycle / 0.16;
      const a = Math.sin(Math.PI * u) * 0.45;
      if (a <= 0.01) continue;
      const b = F.box;
      ctx.save();
      this._path(ctx, F.pts);
      ctx.clip();
      ctx.translate(b[0] + (b[2] - b[0]) * (0.15 + 0.7 * u), b[1] + (b[3] - b[1]) * (0.15 + 0.7 * u));
      ctx.rotate(-0.60);
      const len = Math.hypot(b[2] - b[0], b[3] - b[1]);
      const g = ctx.createLinearGradient(-len * 0.35, 0, len * 0.35, 0);
      g.addColorStop(0, 'rgba(232,253,255,0)');
      g.addColorStop(0.5, 'rgba(242,255,255,' + a.toFixed(3) + ')');
      g.addColorStop(1, 'rgba(156,230,255,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = Math.max(2.2, len * 0.075);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-len * 0.35, 0);
      ctx.lineTo(len * 0.35, 0);
      ctx.stroke();
      ctx.restore();
    }
  },

  _drawExitCracks(ctx, shell, progress) {
    const frac = this._clamp(progress);
    for (const c of shell.cracks) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(20,24,58,0.36)';
      ctx.lineWidth = 1.5;
      let tip = this._traceOpen(ctx, c.pts, frac);
      ctx.strokeStyle = 'rgba(236,253,255,0.88)';
      ctx.lineWidth = 0.95;
      this._traceOpen(ctx, c.pts, frac);
      if (frac < 1) {
        ctx.fillStyle = 'rgba(248,255,255,0.95)';
        ctx.fillRect(tip.x - 0.9, tip.y - 0.9, 1.8, 1.8);
      }
      ctx.restore();
    }
  },

  _drawShards(ctx, shell, layer, u) {
    if (layer !== 'front') return;
    const fade = Math.pow(1 - this._clamp(u), 1.25);
    if (fade <= 0.01) return;
    const k = this._clamp(u);
    for (const sh of shell.shards) {
      if (sh.formed < 0.12) continue;
      const d = sh.spd * (k + 0.38 * k * k);
      const px = sh.x + sh.dx * d;
      const py = sh.y + sh.dy * d;
      const ca = Math.cos(sh.rot * k * 1.7);
      const sa = Math.sin(sh.rot * k * 1.7);
      const pts = [];
      for (let i = 0; i < sh.pts.length; i++) {
        const p = sh.pts[i];
        pts.push({ x: px + p.x * ca - p.y * sa, y: py + p.x * sa + p.y * ca });
      }

      ctx.save();
      ctx.globalAlpha = fade * 0.30;
      ctx.fillStyle = 'rgba(18,20,52,1)';
      this._path(ctx, pts.map((p) => ({ x: p.x + 1.1, y: p.y + 1.2 })));
      ctx.fill();

      ctx.globalAlpha = fade * (0.16 + 0.10 * sh.lit) * (0.55 + 0.45 * sh.formed);
      ctx.fillStyle = sh.light;
      this._path(ctx, pts);
      ctx.fill();

      ctx.globalAlpha = fade * 0.72;
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = sh.lit > 0.52 ? 'rgba(214,250,255,1)' : 'rgba(128,196,235,1)';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.lineTo(pts[2].x, pts[2].y);
      ctx.stroke();

      if (k < 0.38 && sh.formed > 0.55) {
        ctx.globalAlpha = fade * 0.75;
        ctx.fillStyle = 'rgba(246,255,255,1)';
        ctx.fillRect(pts[0].x - 0.9, pts[0].y - 0.9, 1.8, 1.8);
      }
      ctx.restore();
    }
  },

  _drawIntact(ctx, shell, layer, time) {
    const enter = shell.phase === 'enter';
    if (layer === 'back') this._drawBase(ctx, shell);

    for (const bf of shell.band) {
      if (bf.back !== (layer === 'back')) continue;
      this._drawBand(ctx, shell, bf, enter);
    }
    for (const F of shell.facets) {
      if (F.back !== (layer === 'back')) continue;
      this._drawFacet(ctx, shell, F, enter);
    }

    if (!enter) {
      this._drawStructure(ctx, shell, layer);
      this._drawBubbles(ctx, shell, layer);
      if (shell.phase === 'hold') this._drawCracks(ctx, shell, layer, 1, false);
      this._drawReflections(ctx, shell, time, layer);
    }
    if (enter) this._drawSeeds(ctx, shell, layer);
  },

  _draw(ctx, shell, layer, time) {
    const s = Utils.worldToScreen(shell.x, shell.y, Renderer.cam);
    ctx.save();
    ctx.translate(Math.round(s.x), Math.round(s.y));
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (shell.phase === 'exit') {
      if (shell.t < this.CRACK) {
        this._drawIntact(ctx, shell, layer, time);
        if (layer === 'front') this._drawExitCracks(ctx, shell, shell.t / this.CRACK);
      } else {
        const u = (shell.t - this.CRACK) / Math.max(0.001, shell.exitDur - this.CRACK);
        this._drawShards(ctx, shell, layer, u);
      }
      ctx.restore();
      return;
    }

    this._drawIntact(ctx, shell, layer, time);
    ctx.restore();
  },

  drawBack(ctx, enemy, time) {
    const shell = enemy._iceShell;
    if (shell) this._draw(ctx, shell, 'back', time);
  },

  drawFront(ctx, enemy, time) {
    const shell = enemy._iceShell;
    if (shell) this._draw(ctx, shell, 'front', time);
  },

  drawDetached(ctx, layer, time) {
    for (const shell of this.list) {
      if (!shell.enemy) this._draw(ctx, shell, layer, time);
    }
  },
};

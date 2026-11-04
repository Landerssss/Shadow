// ─── 连击计数器 HUD（pixelfx ui/combo-counter 适配版）────────────────────────
// 外观直接复用特效库 pixelfx 的 arcane 色板与 spell/drawWord 绘制路径：
//   · 左侧倾斜像素数字 + 较小 COMBO 标签
//   · 紫色到浅紫白的分层渐变、亮色顶边、深色底边、暗紫描边与阴影
//   · 入场短促速度线 / 残影 / 局部白色高光与星光
//   · 底部三秒真实剩余时间条
// 与官方 1.45s 一次性演示不同：这里由真实击杀状态驱动，动画与计时分开管理。
// 所有计时使用游戏时间（暂停 / 选卡 / 顿帧时自动冻结），不使用 setTimeout。

(function () {
  'use strict';

  // ── pixelfx 颜色工具（src/core/color.js 精简）────────────────────────────
  const rgb = (r, g, b) => (255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
  const red = (c) => c & 255;
  const green = (c) => (c >>> 8) & 255;
  const blue = (c) => (c >>> 16) & 255;

  function hex(h) {
    if (typeof h === 'number') return h;
    let s = String(h).replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    const v = parseInt(s.slice(0, 6), 16);
    return rgb((v >> 16) & 255, (v >> 8) & 255, v & 255);
  }

  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const seg = (t, t0, t1) => clamp((t - t0) / (t1 - t0));
  const scale = (c, k) => rgb(Math.min(255, red(c) * k), Math.min(255, green(c) * k), Math.min(255, blue(c) * k));

  // 参考截图中实际选择的 arcane 色板（来自 src/core/color.js 的 PAL.arcane）
  const PAL_ARCANE = ['#140a26', '#2b1252', '#481c88', '#6b2cc0', '#9a48ec', '#c684ff', '#ecc8ff', '#ffffff'];
  const C = PAL_ARCANE.map(hex);
  const SHADOW = scale(C[0], 0.5);
  const WHITE = hex('#ffffff');

  // ── pixelfx 像素字体（src/core/font.js 的 big 字体）──────────────────────
  const BIG = {
    A: '.###.|#...#|#...#|#####|#...#|#...#|#...#', B: '####.|#...#|#...#|####.|#...#|#...#|####.',
    C: '.###.|#...#|#....|#....|#....|#...#|.###.', D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
    E: '#####|#....|#....|####.|#....|#....|#####', F: '#####|#....|#....|####.|#....|#....|#....',
    G: '.###.|#...#|#....|#.###|#...#|#...#|.####', H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
    I: '###|.#.|.#.|.#.|.#.|.#.|###', J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
    K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#', L: '#....|#....|#....|#....|#....|#....|#####',
    M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#', N: '#...#|#...#|##..#|#.#.#|#..##|#...#|#...#',
    O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.', P: '####.|#...#|#...#|####.|#....|#....|#....',
    Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#', R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
    S: '.####|#....|#....|.###.|....#|....#|####.', T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
    U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.', V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
    W: '#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.', X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
    Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..', Z: '#####|....#|...#.|..#..|.#...|#....|#####',
    0: '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.', 1: '.#.|##.|.#.|.#.|.#.|.#.|###',
    2: '.###.|#...#|....#|...#.|..#..|.#...|#####', 3: '#####|...#.|..#..|...#.|....#|#...#|.###.',
    4: '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.', 5: '#####|#....|####.|....#|....#|#...#|.###.',
    6: '..##.|.#...|#....|####.|#...#|#...#|.###.', 7: '#####|....#|...#.|..#..|.#...|.#...|.#...',
    8: '.###.|#...#|#...#|.###.|#...#|#...#|.###.', 9: '.###.|#...#|#...#|.####|....#|...#.|.##..',
    '!': '#|#|#|#|#|.|#', '?': '.###.|#...#|....#|...#.|..#..|.....|..#..',
    '+': '.....|..#..|..#..|#####|..#..|..#..|.....', '-': '....|....|....|####|....|....|....',
    '.': '.|.|.|.|.|.|#', ',': '..|..|..|..|..|.#|#.', ':': '.|.|#|.|.|#|.',
    '/': '....#|....#|...#.|..#..|.#...|#....|#....', '%': '##...|##..#|...#.|..#..|.#...|#..##|...##',
    x: '.....|.....|#...#|.#.#.|..#..|.#.#.|#...#', '*': '.....|..#..|#.#.#|.###.|#.#.#|..#..|.....',
    "'": '#|#|.|.|.|.|.', '<': '...#|..#.|.#..|#...|.#..|..#.|...#',
    '>': '#...|.#..|..#.|...#|..#.|.#..|#...', '=': '....|....|####|....|####|....|....',
    '(': '..#|.#.|#..|#..|#..|.#.|..#', ')': '#..|.#.|..#|..#|..#|.#.|#..',
    '#': '.#.#.|.#.#.|#####|.#.#.|#####|.#.#.|.#.#.',
  };

  function buildFont(table, h) {
    const out = {};
    for (const ch of Object.keys(table)) {
      const rows = table[ch].split('|');
      out[ch] = { w: rows[0].length, rows: rows.map((r) => Array.from(r, (c) => c === '#')) };
      if (rows.length !== h) throw new Error('字形高度不匹配: ' + ch);
    }
    return out;
  }

  const FONT = { h: 7, space: 3, gap: 1, glyphs: buildFont(BIG, 7) };

  function spell(str) {
    const letters = [];
    let x = 0;
    for (const ch of String(str)) {
      const g = FONT.glyphs[ch] ?? FONT.glyphs[ch.toUpperCase()] ?? null;
      const w = g ? g.w : FONT.space;
      letters.push({ ch, g, x, w, h: FONT.h });
      x += w + FONT.gap;
    }
    return { letters, w: Math.max(0, x - FONT.gap), h: FONT.h };
  }

  // ── pixelfx 文字绘制（src/fx/ui/_lib.js 的 drawWord）────────────────────
  let ids = new Int16Array(4096);
  let edges = new Uint8Array(4096);

  function drawWord(p, items, st) {
    if (!items.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of items) {
      const h = it.g.rows.length * it.sy, w = it.g.w * it.sx, sl = Math.abs(it.slant ?? 0) * it.g.rows.length;
      x0 = Math.min(x0, it.x - sl); x1 = Math.max(x1, it.x + w + sl);
      y0 = Math.min(y0, it.y); y1 = Math.max(y1, it.y + h);
    }
    const ow = st.ow ?? 1;
    x0 = Math.floor(x0) - 1 - ow; y0 = Math.floor(y0) - 1 - ow; x1 = Math.ceil(x1) + 2 + ow; y1 = Math.ceil(y1) + 3 + ow;
    const W = x1 - x0, H = y1 - y0;
    if (W * H > ids.length) { ids = new Int16Array(W * H * 2); edges = new Uint8Array(W * H * 2); }
    ids.fill(0, 0, W * H);
    items.forEach((it, k) => {
      const g = it.g, gh = g.rows.length, h = gh * it.sy, bot = it.y + h, sl = it.slant ?? 0;
      for (let py = Math.floor(it.y); py < Math.ceil(bot); py++) {
        const gy = Math.floor((py + 0.5 - it.y) / it.sy);
        if (gy < 0 || gy >= gh) continue;
        const shift = Math.round(((bot - py - 0.5) / it.sy) * sl);
        const ry = py + 0.5 - it.y - gy * it.sy, row = g.rows[gy];
        for (let px = Math.floor(it.x + shift) - 1; px <= Math.ceil(it.x + shift + g.w * it.sx); px++) {
          const fx = px + 0.5 - it.x - shift, gx = Math.floor(fx / it.sx);
          if (gx < 0 || gx >= g.w || !row[gx]) continue;
          const i = (py - y0) * W + (px - x0);
          if (i < 0 || i >= W * H) continue;
          ids[i] = k + 1;
          const rx = fx - gx * it.sx, up = gy > 0 ? g.rows[gy - 1] : null, dn = gy < gh - 1 ? g.rows[gy + 1] : null;
          const open = (r) => !r || (!r[gx] && !r[gx - 1] && !r[gx + 1]);
          edges[i] = (ry < 1 && open(up) ? 1 : 0) | (ry >= it.sy - 1 && open(dn) ? 2 : 0) | (rx < 1 && !(gx > 0 && row[gx - 1]) ? 4 : 0);
        }
      }
    });
    const at = (x, y) => (x < x0 || y < y0 || x >= x1 || y >= y1 ? 0 : ids[(y - y0) * W + (x - x0)]);
    const F = st.fill, nF = F.length, shine = st.shine, glint = st.glint ?? WHITE, sy0 = st.shineY ?? y0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const id = at(x, y);
        if (id) {
          const it = items[id - 1], v = (y + 0.5 - it.y) / (it.g.rows.length * it.sy);
          const i = Math.min(nF - 1, Math.max(0, Math.floor((1 - v) * nF)));
          let c = F[i];
          const e = edges[(y - y0) * W + (x - x0)];
          if (e & 1) c = st.edge ?? F[nF - 1];
          else if (e & 2) c = st.under ?? F[0];
          else if (e & 4 && i < nF - 1) c = F[i + 1];
          if (shine !== undefined && shine !== null) {
            const d = Math.abs(x + 0.5 - (y + 0.5 - sy0) * 0.6 - shine);
            if (d < 1.1) c = WHITE;
            else if (d < 2.4) c = glint;
          }
          if (it.flash > 0.6 || (it.flash > 0.25 && v < 0.5)) c = WHITE;
          p.dot(x, y, c, it.a ?? 1);
          continue;
        }
        let n = 0;
        for (let dy = -ow; dy <= ow && !n; dy++) for (let dx = -ow; dx <= ow && !n; dx++) if (ow < 2 || Math.abs(dx) + Math.abs(dy) < 4) n = at(x + dx, y + dy);
        if (n) {
          p.dot(x, y, st.outline, items[n - 1].a ?? 1);
          continue;
        }
        const s = at(x - ow, y - 1 - ow) || at(x + 1 - ow, y - 1 - ow) || at(x - ow, y - ow);
        if (s && st.shadow) p.dot(x, y, st.shadow, (items[s - 1].a ?? 1) * 0.9);
      }
  }

  // ── pixelfx 随机与噪声（src/core/math.js 精简）──────────────────────────
  function hash() {
    let h = 0x9e3779b9;
    for (let i = 0; i < arguments.length; i++) {
      h = Math.imul(h ^ (arguments[i] | 0), 0x85ebca6b);
      h ^= h >>> 13;
      h = Math.imul(h, 0xc2b2ae35);
      h ^= h >>> 16;
    }
    return h >>> 0;
  }
  const rand = function () { return hash.apply(null, arguments) / 4294967296; };

  class Rng {
    constructor(seed = 1) { this.s = seed >>> 0 || 1; }
    next() {
      let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    range(a, b) { return a + (b - a) * this.next(); }
    chance(p) { return this.next() < p; }
    pick(list) { return list[Math.floor(this.next() * list.length)]; }
  }

  function noise(x, seed = 0) {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return (rand(i, seed) + (rand(i + 1, seed) - rand(i, seed)) * u) * 2 - 1;
  }

  // ── pixelfx Painter（src/core/painter.js 精简，带固定原点偏移）───────────
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
  const OUT = { c: 0, a: 1, l: 0, k: 0 };
  const call = (v, ...args) => (typeof v === 'function' ? v(...args) : v);

  class Painter {
    constructor(frame) { this.frame = frame; this.reset(); }
    reset() {
      const f = this.frame;
      this.w = f.w; this.h = f.h; this.C = f.color; this.L = f.light;
      this.ox = f.originX; this.oy = f.originY;
      this.fade = 1; this.lightK = 1;
      return this;
    }
    toX(x) { return this.ox + x; }
    toY(y) { return this.oy + y; }
    cellX(x) { return this.ox + Math.floor(x); }
    cellY(y) { return this.oy + Math.floor(y); }

    put(sx, sy, c, a = 1) {
      if (!c) return;
      a *= this.fade;
      if (a < 1 && a <= BAYER[((sy & 3) << 2) | (sx & 3)]) return;
      if (sx < 0 || sy < 0 || sx >= this.w || sy >= this.h) return;
      this.C[sy * this.w + sx] = c;
    }
    add(sx, sy, c, k = 1) {
      k *= this.fade * this.lightK;
      if (k <= 0.004) return;
      if (sx < 0 || sy < 0 || sx >= this.w || sy >= this.h) return;
      const i = sy * this.w + sx, d = this.L[i];
      const r = Math.min(255, (d & 255) + (c & 255) * k) | 0;
      const g = Math.min(255, ((d >>> 8) & 255) + ((c >>> 8) & 255) * k) | 0;
      const b = Math.min(255, ((d >>> 16) & 255) + ((c >>> 16) & 255) * k) | 0;
      this.L[i] = (255 << 24) | (b << 16) | (g << 8) | r;
    }
    px(x, y, c) { this.put(this.cellX(x), this.cellY(y), c, 1); }
    dot(x, y, c, a = 1) { if (a > 0) this.put(this.cellX(x), this.cellY(y), c, a); }
    light(x, y, c, k = 1) { this.add(this.cellX(x), this.cellY(y), c, k); }

    each(x0, y0, x1, y1, fn) {
      const sx0 = Math.max(Math.floor(this.ox + x0), 0);
      const sx1 = Math.min(Math.ceil(this.ox + x1), this.w - 1);
      const sy0 = Math.max(Math.floor(this.oy + y0), 0);
      const sy1 = Math.min(Math.ceil(this.oy + y1), this.h - 1);
      for (let sy = sy0; sy <= sy1; sy++)
        for (let sx = sx0; sx <= sx1; sx++)
          fn(sx + 0.5 - this.ox, sy + 0.5 - this.oy, sx, sy);
    }
    shade(x0, y0, x1, y1, fn) {
      const o = OUT;
      this.each(x0, y0, x1, y1, (lx, ly, sx, sy) => {
        o.c = 0; o.a = 1; o.l = 0; o.k = 0;
        const c = fn(lx, ly, o) || o.c;
        if (c) this.put(sx, sy, c, o.a);
        if (o.k > 0) this.add(sx, sy, o.l || c, o.k);
      });
    }
    line(x0, y0, x1, y1, c, a = 1) {
      let sx = this.cellX(x0), sy = this.cellY(y0);
      const ex = this.cellX(x1), ey = this.cellY(y1);
      const dx = Math.abs(ex - sx), dy = -Math.abs(ey - sy), stepx = sx < ex ? 1 : -1, stepy = sy < ey ? 1 : -1;
      const n = Math.max(dx, -dy) || 1, fc = typeof c === 'function', fa = typeof a === 'function';
      let err = dx + dy, i = 0;
      for (;;) {
        const u = i++ / n;
        this.put(sx, sy, fc ? c(u) : c, fa ? a(u) : a);
        if (sx === ex && sy === ey) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; sx += stepx; }
        if (e2 <= dx) { err += dx; sy += stepy; }
      }
    }
    beam(x0, y0, x1, y1, width, c, a = 1) {
      const r = width / 2, dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1e-9;
      this.shade(Math.min(x0, x1) - r, Math.min(y0, y1) - r, Math.max(x0, x1) + r, Math.max(y0, y1) + r, (x, y, o) => {
        const u = clamp(((x - x0) * dx + (y - y0) * dy) / L2), px = x0 + dx * u - x, py = y0 + dy * u - y;
        const d2 = px * px + py * py;
        if (d2 > r * r) return;
        const v = Math.sqrt(d2) / r;
        o.c = call(c, u, v);
        o.a = call(a, u, v);
      });
    }
    ellipse(cx, cy, rx, ry, c, a = 1) {
      if (rx <= 0 || ry <= 0) return;
      this.shade(cx - rx, cy - ry, cx + rx, cy + ry, (x, y, o) => {
        const dx = (x - cx) / rx, dy = (y - cy) / ry, d2 = dx * dx + dy * dy;
        if (d2 > 1) return;
        const d = Math.sqrt(d2), ang = Math.atan2(dy, dx);
        o.c = call(c, d, ang);
        o.a = call(a, d, ang);
      });
    }
    rect(x, y, w, h, c, a = 1) {
      const X0 = Math.round(x), Y0 = Math.round(y), X1 = Math.round(x + w), Y1 = Math.round(y + h);
      for (let yy = Y0; yy < Y1; yy++) for (let xx = X0; xx < X1; xx++) this.put(this.cellX(xx), this.cellY(yy), c, a);
    }
    glow(x, y, r, c, k = 0.5) {
      if (r < 1 || k <= 0.004) return;
      const cx = this.toX(x), cy = this.toY(y);
      const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r), y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
      for (let sy = y0; sy <= y1; sy++) {
        const dy = (sy + 0.5 - cy) / r;
        for (let sx = x0; sx <= x1; sx++) {
          const dx = (sx + 0.5 - cx) / r, d = dx * dx + dy * dy;
          if (d >= 1) continue;
          const f = 1 - Math.sqrt(d);
          this.add(sx, sy, c, f * f * k);
        }
      }
    }
  }

  // ── pixelfx 粒子与星光（src/core/sim.js 精简：SPARK / MOTE / STAR）───────
  const P = { SPARK: 0, MOTE: 1, STAR: 6 };

  class Particles {
    constructor(opts) {
      this.R = opts.rng;
      this.list = [];
      this.t = 0;
      this.sparks = opts.sparks;
      this.max = opts.max || 48;
    }
    spawn(k, x, y, vx, vy, life, col = WHITE, size = 1) {
      if (this.list.length >= this.max) return;
      const c = typeof col === 'string' ? hex(col) : col;
      this.list.push({ k, x, y, vx, vy, life, max: life, col: c || WHITE, size, seed: this.R.next() * 100 });
    }
    update(dt) {
      this.t += dt;
      for (let i = this.list.length - 1; i >= 0; i--) {
        const p = this.list[i];
        if ((p.life -= dt) <= 0) { this.list.splice(i, 1); continue; }
        if (p.k === P.SPARK) {
          p.vy += 950 * 0.45 * dt;
          p.vx -= p.vx * 2.2 * dt;
          p.vy -= p.vy * 2.2 * dt;
        } else if (p.k === P.MOTE) {
          p.vx -= p.vx * 0.6 * dt;
          p.vy -= p.vy * 0.6 * dt;
        } else {
          p.vx -= p.vx * 1.6 * dt;
          p.vy -= p.vy * 1.6 * dt + 5 * dt;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    }
    draw(p) {
      for (const q of this.list) {
        const k = q.life / q.max, x = q.x, y = q.y;
        const sp = Math.hypot(q.vx, q.vy) || 1, ux = q.vx / sp, uy = q.vy / sp;
        if (q.k === P.SPARK) {
          const S = this.sparks, head = k > 0.6 ? S[0] : k > 0.3 ? S[1] : S[2];
          const len = Math.min(9, 1 + sp * 0.022);
          p.line(x - ux * len, y - uy * len, x - ux * len * 0.4, y - uy * len * 0.4, k > 0.5 ? head : S[S.length - 1]);
          p.line(x - ux * len * 0.45, y - uy * len * 0.45, x, y, head);
          p.glow(x, y, 3, head, 0.45 * k);
        } else if (q.k === P.MOTE) {
          const len = Math.min(16, 0.5 + sp * 0.026) * q.size, a = k < 0.35 ? k / 0.35 : 1;
          p.line(x - ux * len, y - uy * len, x - ux * len * 0.35, y - uy * len * 0.35, scale(q.col, 0.55), a);
          p.line(x - ux * len * 0.4, y - uy * len * 0.4, x, y, q.col, a);
          p.glow(x, y, 2.5 + q.size, q.col, 0.4 * k);
        } else {
          const tw = 0.6 + 0.4 * Math.sin(this.t * (8 + (q.seed % 5)) + q.seed);
          sparkle(p, x, y, q.size * tw * Math.min(1, k * 3), q.col, scale(q.col, 0.75), 0.5 * k * tw);
        }
      }
    }
  }

  function sparkle(p, x, y, arm, c, tip, k = 0.6) {
    const n = Math.round(arm);
    if (n < 1) return;
    const X = Math.floor(x), Y = Math.floor(y);
    for (let d = 1; d <= n; d++) {
      const cc = d > n * 0.6 ? tip : c;
      p.px(X + d, Y, cc); p.px(X - d, Y, cc); p.px(X, Y + d, cc); p.px(X, Y - d, cc);
    }
    if (n >= 3) {
      p.px(X + 1, Y + 1, c); p.px(X - 1, Y + 1, c); p.px(X + 1, Y - 1, c); p.px(X - 1, Y - 1, c);
    }
    if (n >= 6) {
      p.px(X + 2, Y + 2, tip); p.px(X - 2, Y + 2, tip); p.px(X + 2, Y - 2, tip); p.px(X - 2, Y - 2, tip);
    }
    p.px(X, Y, WHITE);
    p.glow(x, y, 4 + n * 2, c, k);
  }

  class Lights {
    constructor() { this.list = []; }
    add(x, y, r, color, k, life) {
      this.list.push({ x, y, r, color: typeof color === 'string' ? hex(color) : color, k, life, max: life });
    }
    update(dt) { for (let i = this.list.length - 1; i >= 0; i--) if ((this.list[i].life -= dt) <= 0) this.list.splice(i, 1); }
    draw(p) {
      for (const l of this.list) {
        const k = l.life / l.max;
        p.glow(l.x, l.y, l.r * (0.55 + 0.45 * k), l.color, l.k * k * k);
      }
    }
  }

  // ── 动画常量与画布布局 ─────────────────────────────────────────────────
  const W = 232, H = 72;
  const ORIGIN_X = W / 2, ORIGIN_Y = 36;
  const RIGHT = W / 2 - 14;           // 内容右边缘（右侧锚点，留出斜体/描边安全边距）
  const LABEL_GAP = 6;                 // 数字与 COMBO 标签之间
  const BASE = 12;                    // 基线
  const BS = 4, LS = 2;               // 数字 / 标签像素倍率
  const ENTRY_DUR = 0.18, ENTRY_HIT = 0.10, EXIT_DUR = 0.20;
  const PULSE_MIN_MS = 110;           // 更新脉冲视觉限频（不影响真实计数）
  const TIMEOUT_MS = 3000;

  function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }
  function easeInQuad(t) { return t * t; }

  function shakeAt(t, amp, t0, len, seed) {
    if (t < t0 || t > t0 + len) return [0, 0];
    const k = 1 - (t - t0) / len;
    return [Math.round(noise(t * 32, seed) * amp * k * 1.7), Math.round(noise(t * 32, seed + 7) * amp * k * 1.3)];
  }

  const frame = {
    w: W, h: H, originX: ORIGIN_X, originY: ORIGIN_Y,
    color: new Uint32Array(W * H),
    light: new Uint32Array(W * H),
  };

  const painter = new Painter(frame);
  const rng = new Rng(6);
  const ps = new Particles({ rng, sparks: [C[7], C[6], C[5], C[3]], max: 44 });
  const lights = new Lights();
  const lab = spell('COMBO');

  const HUD = {
    canvas: null, ctx: null, img: null, out: null,
    state: 'hidden',
    count: 0, text: '', big: null, Wc: 0, X0: 0,
    expiresAt: 0, chainId: 0,
    lastChain: -1, lastCount: 0,
    entryStart: 0, pulseStart: -1e9, exitStart: 0,
    lastNow: 0, everTicked: false,
    entrySpawned: false, exitSpawned: false,
    starAcc: 0,
    _paintedKey: '',
    _forcePaint: true,

    init() {
      this.canvas = document.getElementById('hud-combo-canvas');
      if (!this.canvas) return;
      this.canvas.width = W;
      this.canvas.height = H;
      this.ctx = this.canvas.getContext('2d');
      this.ctx.imageSmoothingEnabled = false;
      this.img = new ImageData(W, H);
      this.out = new Uint32Array(this.img.data.buffer);
      this.reset();
    },

    reset() {
      this.state = 'hidden';
      this.count = 0;
      this.text = '';
      this.big = null;
      this.Wc = 0;
      this.X0 = RIGHT;
      this.expiresAt = 0;
      this.chainId = 0;
      this.lastChain = -1;
      this.lastCount = 0;
      this.entryStart = 0;
      this.pulseStart = -1e9;
      this.exitStart = 0;
      this.lastNow = 0;
      this.everTicked = false;
      this.entrySpawned = false;
      this.exitSpawned = false;
      this.starAcc = 0;
      this._paintedKey = '';
      this._forcePaint = true;
      ps.list.length = 0;
      ps.t = 0;
      rng.s = 6;
      lights.list.length = 0;
      if (this.ctx) this._paintEmpty();
    },

    _setText(count) {
      const text = 'x' + count;
      if (text === this.text) return;
      this.text = text;
      this.big = spell(text);
      this.Wc = this.big.w * BS + LABEL_GAP + lab.w * LS;
      this.X0 = RIGHT - this.Wc;
    },

    _pulseK(nowMs) {
      const pt = (nowMs - this.pulseStart) / 1000;
      if (pt < 0 || pt > 0.16) return 0;
      return Math.exp(-Math.pow((pt - 0.03) / 0.05, 2));
    },

    _spawnImpact(nowMs) {
      const cx = this.X0 + (this.big ? this.big.w * BS : 28) / 2;
      lights.add(cx, 0, 66, C[5], 0.65, 0.38);
      lights.add(cx - 18, 0, 30, WHITE, 0.75, 0.1);
      const R = rng;
      for (let i = 0; i < 24 && ps.list.length < ps.max; i++) {
        const an = R.range(-1.2, 1.2) + (R.chance(0.3) ? Math.PI : 0);
        const sp = R.range(110, 260);
        ps.spawn(P.SPARK, cx + R.range(-16, 16), R.range(-8, 8), Math.cos(an) * sp, Math.sin(an) * sp * 0.6 - 20, R.range(0.12, 0.3));
      }
      this.exitSpawned = false;
    },

    _spawnPulse() {
      const R = rng;
      const cx = this.X0 + (this.big ? this.big.w * BS : 28) / 2;
      lights.add(cx, 0, 26, C[5], 0.28, 0.16);
      for (let i = 0; i < 4 && ps.list.length < ps.max; i++) {
        const x = this.X0 + R.range(0, this.Wc);
        const y = BASE - R.range(0, 26);
        ps.spawn(P.STAR, x, y, R.range(-10, 10), -R.range(5, 18), R.range(0.22, 0.4), R.pick([C[7], C[6]]), R.chance(0.3) ? 1.5 : 0.6);
      }
    },

    _spawnExit() {
      const R = rng;
      for (let i = 0; i < 8 && ps.list.length < ps.max; i++) {
        ps.spawn(P.MOTE, this.X0 + R.range(0, this.Wc), R.range(-12, 8), R.range(200, 300), R.range(-10, 10), R.range(0.06, 0.14), R.pick([C[7], C[6]]), 1);
      }
    },

    // 官方速度线：入场向右、退场向左；只在内容附近，不铺满全屏
    _speedLines(p, t, k, dir, seed) {
      if (k <= 0.02) return;
      const f = Math.floor(t * 30) + seed;
      const left = this.X0, right = RIGHT, cx = (left + right) / 2, half = (right - left) / 2 + 18;
      for (let i = 0; i < 14; i++) {
        if (rand(f, i, 3) > k) continue;
        const y = Math.round((rand(f, i, 1) - 0.5) * 60);
        const L = 16 + rand(f, i, 2) * 50;
        const x = cx + (rand(f, i, 4) - 0.5) * (half * 2);
        const x0 = Math.max(left - 10, x - L / 2), x1 = Math.min(right + 10, x + L / 2);
        p.line(x0, y, x1, y,
          (u) => ((dir > 0 ? u : 1 - u) > 0.75 ? WHITE : (dir > 0 ? u : 1 - u) > 0.35 ? C[6] : C[4]),
          (u) => ((dir > 0 ? u : 1 - u) < 0.25 ? 0.6 : 1));
      }
    },

    tick(nowMs, count, expiresAt, chainId) {
      if (!this.ctx) this.init();
      if (!this.ctx) return;

      let dt = this.everTicked ? (nowMs - this.lastNow) / 1000 : 0;
      if (!(dt > 0)) dt = 0;
      if (dt > 0.05) dt = 0.05;
      const first = !this.everTicked;
      this.everTicked = true;
      this.lastNow = nowMs;

      const key = nowMs + '|' + count + '|' + chainId + '|' + expiresAt;
      const same = (key === this._paintedKey) && !this._forcePaint;
      if (same && this.state === 'hidden') return;

      // 新连击链：首次击杀、同帧多杀、退场中重新击杀都走这里
      if (count > 0 && chainId !== this.lastChain) {
        this.chainId = chainId;
        this.state = 'entering';
        this.entryStart = nowMs;
        this.pulseStart = nowMs;
        this.entrySpawned = false;
        this.exitSpawned = false;
        this.starAcc = 0;
        this._setText(count);
        this.count = count;
        ps.list.length = 0;
        lights.list.length = 0;
      } else if (count > this.count) {
        this.count = count;
        this._setText(count);
        // 连击继续：计时条由 expiresAt 立即恢复满格，视觉脉冲限频
        if (nowMs - this.pulseStart >= PULSE_MIN_MS) {
          this.pulseStart = nowMs;
          if (this.state !== 'entering') this._spawnPulse();
        }
      } else if (count !== this.count) {
        this.count = count;
      }

      if (count <= 0 && this.state !== 'hidden' && this.state !== 'exiting') {
        this.state = 'exiting';
        this.exitStart = nowMs;
        this.exitSpawned = false;
      }

      this.expiresAt = expiresAt;
      this.lastChain = chainId;
      this.lastCount = count;

      const entryT = (nowMs - this.entryStart) / 1000;
      const exitT = (nowMs - this.exitStart) / 1000;

      if (this.state === 'entering' && entryT >= ENTRY_DUR) this.state = 'active';
      if (this.state === 'exiting' && exitT >= EXIT_DUR) {
        this.state = 'hidden';
        ps.list.length = 0;
        lights.list.length = 0;
      }

      // 入场冲击局部粒子（只在数字附近）
      if (!this.entrySpawned && (this.state === 'entering' || this.state === 'active') && entryT >= ENTRY_HIT) {
        this.entrySpawned = true;
        this._spawnImpact(nowMs);
      }
      // 退场时一次速度尘
      if (this.state === 'exiting' && !this.exitSpawned) {
        this.exitSpawned = true;
        this._spawnExit();
      }
      // 活跃期少量低频星光
      if (this.state === 'active') {
        this.starAcc += dt;
        if (this.starAcc >= 0.45) {
          this.starAcc = 0;
          if (ps.list.length < ps.max && this.big) {
            const R = rng;
            ps.spawn(P.STAR, this.X0 + R.range(0, this.Wc), BASE - R.range(0, 26),
              R.range(-8, 8), -R.range(4, 16), R.range(0.24, 0.42), R.pick([C[7], C[6]]), R.chance(0.3) ? 1.4 : 0.55);
          }
        }
      }

      if (this.state !== 'hidden') {
        if (dt > 0) { ps.update(dt); lights.update(dt); }
      }

      if (this.state === 'hidden') {
        if (this._paintedKey !== 'hidden') this._paintEmpty();
        return;
      }

      if (same && !first) {
        // 时间没有推进（暂停 / 顿帧）且状态未变：无需重绘
        return;
      }

      this._paint(nowMs, entryT, exitT);
      this._paintedKey = key;
      this._forcePaint = false;
    },

    _paintEmpty() {
      frame.color.fill(0);
      frame.light.fill(0);
      if (this.out) this.out.fill(0);
      if (this.ctx && this.img) this.ctx.putImageData(this.img, 0, 0);
      this._paintedKey = 'hidden';
    },

    _paint(nowMs, entryT, exitT) {
      frame.color.fill(0);
      frame.light.fill(0);
      painter.reset();

      const p = painter;
      const state = this.state;
      const pulse = this._pulseK(nowMs);
      const Wc = this.Wc;
      const X0 = this.X0;
      const moving = state === 'entering' || state === 'exiting';

      const [sx, sy] = (state === 'entering' || state === 'active')
        ? shakeAt(entryT, 3, ENTRY_HIT, 0.25, 6)
        : [0, 0];

      let x;
      if (state === 'exiting') {
        const k = seg(exitT, 0, EXIT_DUR);
        x = k < 0.3 ? -4 * easeOutQuad(k / 0.3) : -4 + 24 * easeInQuad((k - 0.3) / 0.7);
      } else if (state === 'entering') {
        if (entryT < ENTRY_HIT) x = -32 * Math.pow(1 - entryT / ENTRY_HIT, 2);
        else x = 7 * Math.exp(-(entryT - ENTRY_HIT) * 18) * Math.sin((entryT - ENTRY_HIT) * 34);
      } else {
        x = entryT < 0.45 ? 7 * Math.exp(-Math.max(0, entryT - ENTRY_HIT) * 18) * Math.sin(Math.max(0, entryT - ENTRY_HIT) * 34) : 0;
      }

      const stretch = moving ? (state === 'exiting' ? 1.12 : (entryT < ENTRY_HIT ? 1.22 : 1.12)) : 1;
      const flash = (state === 'entering' && entryT >= ENTRY_HIT && entryT < ENTRY_HIT + 0.07) ? 1 : 0;
      const a = state === 'exiting' ? 1 - seg(exitT, 0.06, 0.18) : (state === 'entering' && entryT < 0.035 ? 0.5 : 1);

      // 速度线：入场向右，退场向左
      let lineK = 0, lineT = entryT;
      if (state === 'entering') {
        lineK = entryT < ENTRY_HIT ? 1 : Math.max(0, 1 - (entryT - ENTRY_HIT) / 0.35) * 0.9;
      } else if (state === 'exiting') {
        lineT = exitT;
        lineK = seg(exitT, 0.04, 0.12) * (1 - seg(exitT, 0.18, 0.3));
      }
      this._speedLines(p, lineT, lineK, state === 'exiting' ? -1 : 1, 6);

      // 入场落点：白色尖刺 + 扩散环（局部，围绕数字）
      const countCx = X0 + (this.big ? this.big.w * BS : 28) / 2;
      const hk = entryT - ENTRY_HIT;
      if (hk >= 0 && hk < 0.07) {
        const k = hk < 0.035 ? 1 : 1.3;
        for (let i = 0; i < 10; i++) {
          const an = (i / 10) * Math.PI * 2 + 0.15 * Math.sin(i * 3.7);
          const L = 14 + ((i * 7) % 11);
          const ca = Math.cos(an) * 1.4, sa = Math.sin(an);
          if (k === 1) p.beam(countCx, 0, countCx + ca * L, sa * L, 3, (u) => (u < 0.5 ? WHITE : C[6]));
          else p.line(countCx + ca * L * 0.5, sa * L * 0.5, countCx + ca * L * k, sa * L * k, C[5]);
        }
      }
      const rk = (entryT - ENTRY_HIT) / 0.32;
      if (rk > 0 && rk < 1) {
        const r = 16 + 26 * (1 - Math.pow(1 - rk, 3));
        p.ellipse(countCx + sx, sy, r * 1.45, r * 0.72, rk < 0.3 ? WHITE : C[5], (d) => (d > 1 - 1.4 / (r * 0.72) ? 1.25 - rk : 0));
      }
      ps.draw(p);

      // 文字布局：右锚点固定，位数增加时向左扩展
      const layout = (dx) => {
        const bs = BS * (1 + 0.12 * pulse), items = [];
        const bx = X0 + dx - (this.big.w * BS * (stretch - 1)) / 2, by = BASE - 7 * bs;
        this.big.letters.forEach((L) => {
          if (L.g) items.push({ g: L.g, x: bx + L.x * BS * stretch, y: by, sx: BS * stretch, sy: bs, slant: 1, flash, a });
        });
        const lx = X0 + dx + this.big.w * BS * stretch + LABEL_GAP;
        lab.letters.forEach((L) => {
          if (L.g) items.push({ g: L.g, x: lx + L.x * LS * stretch, y: BASE - 7 * LS, sx: LS * stretch, sy: LS, slant: 0.5, flash, a });
        });
        return items;
      };

      if (moving && a > 0) {
        for (const lag of [0.03, 0.015]) {
          const lagT = state === 'exiting' ? exitT + lag : entryT - lag;
          let lx;
          if (state === 'exiting') {
            const k = seg(lagT, 0, EXIT_DUR);
            lx = k < 0.3 ? -4 * easeOutQuad(k / 0.3) : -4 + 24 * easeInQuad((k - 0.3) / 0.7);
          } else {
            lx = lagT < ENTRY_HIT ? -32 * Math.pow(1 - Math.max(0, lagT) / ENTRY_HIT, 2)
              : 7 * Math.exp(-(lagT - ENTRY_HIT) * 18) * Math.sin((lagT - ENTRY_HIT) * 34);
          }
          const items = layout(lx + sx);
          const c = lag > 0.02 ? C[2] : C[3];
          drawWord(p, items.map((it) => Object.assign({}, it, { flash: 0 })), { fill: [c], edge: c, under: c, outline: 0, shadow: 0 });
        }
      }

      if (a > 0) {
        let shine = null;
        if (state === 'entering' && entryT > 0.2 && entryT < 0.55) shine = X0 - 10 + (Wc + 24) * seg(entryT, 0.2, 0.55);
        else if (pulse > 0.35) shine = X0 + Wc * 0.86;

        const items = layout(x + sx);
        drawWord(p, items.map((it) => Object.assign({}, it, { y: it.y + sy })), {
          fill: [C[3], C[4], C[5], C[6]], edge: WHITE, under: C[2], outline: C[0], ow: 2,
          shadow: SHADOW, shine: shine, shineY: BASE - 28, glint: C[6],
        });

        // 底部计时条：宽度由真实剩余时间决定
        const ratio = clamp((this.expiresAt - nowMs) / TIMEOUT_MS, 0, 1);
        const grow = seg(entryT, ENTRY_HIT + 0.04, ENTRY_HIT + 0.14);
        if (state !== 'exiting' && grow > 0 && ratio > 0) {
          const bw = Wc * grow;
          const bx = X0 + x + sx, by = BASE + 5 + sy;
          p.rect(bx - 1, by - 1, bw + 2, 4, C[0]);
          p.rect(bx, by, bw, 2, C[1]);
          const fw = bw * ratio;
          if (fw > 0) {
            p.rect(bx, by, fw, 2, C[5]);
            p.rect(bx, by, fw, 1, C[6]);
            p.px(bx + fw - 1, by, WHITE);
          }
        }
      }

      const cx = (X0 + RIGHT) / 2;
      const gk = 0.2 * a + (state === 'entering' && entryT >= ENTRY_HIT && entryT < ENTRY_HIT + 0.15 ? 0.5 * (1 - (entryT - ENTRY_HIT) / 0.15) : 0) + 0.22 * pulse;
      p.glow(cx + sx, 0, 66, C[4], gk);

      if (pulse > 0.15) sparkle(p, X0 + Wc - 2 + sx, BASE - 14 + sy, 4 * pulse, C[7], C[5], 0.4 * pulse);
      lights.draw(p);

      // 合成到透明 HUD 画布：颜色 + 局部加光；不创建全屏蒙层
      const out = this.out, cb = frame.color, lb = frame.light;
      for (let i = 0; i < out.length; i++) {
        const c = cb[i], l = lb[i];
        let r = c ? (c & 255) : 0;
        let g = c ? ((c >>> 8) & 255) : 0;
        let b = c ? ((c >>> 16) & 255) : 0;
        let al = c ? 255 : 0;
        if (l) {
          const lr = l & 255, lg = (l >>> 8) & 255, lbv = (l >>> 16) & 255;
          r = Math.min(255, r + lr); g = Math.min(255, g + lg); b = Math.min(255, b + lbv);
          if (!al) {
            const m = Math.max(lr, lg, lbv);
            al = Math.min(255, (m * 2) | 0);
          }
        }
        out[i] = (al << 24) | (b << 16) | (g << 8) | r;
      }
      this.ctx.putImageData(this.img, 0, 0);
    },

    // 供外部查询（调试 / 验证）
    remainingRatio(nowMs) {
      return clamp((this.expiresAt - nowMs) / TIMEOUT_MS, 0, 1);
    },
  };

  window.ComboCounterHUD = HUD;
})();

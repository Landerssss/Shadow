// ─── WHITE RUPTURE FX（白蚀爆裂 · 流派 3 核心视觉）──────────────────────────
// 四阶段视觉：预兆(250ms) → 核心压缩(120ms) → 爆裂(200ms) → 裂口残留(500ms)
// 纯视觉封装；伤害与事件传播由 EchoManager 负责（进入裂口阶段时回调一次）。

const WhiteRuptureFX = {
  effects: [],
  _pool: [],
  MAX: 12,

  // 阶段分界（秒）
  T_PRE:   0.25,
  T_CORE:  0.37,
  T_BURST: 0.57,
  T_END:   1.07,

  // 生成一次白蚀爆裂视觉
  // ctx: { radius, seed, arcs:[{x,y,targetId}], reactionDepth, chainId }
  spawn(x, y, context) {
    if (this.effects.length >= this.MAX) this.effects.shift();
    const e = this._pool.pop() || {};
    e.x = x;
    e.y = y;
    e.t = 0;
    e.radius = (context && context.radius) || 90;
    e.seed = (context && context.seed) || Math.random() * 1000;
    e.arcs = (context && context.arcs) || [];
    e.reactionDepth = (context && context.reactionDepth) || 0;
    e.chainId = (context && context.chainId) || 0;
    e.tagCount = 3;              // 触发时已积累 3 个不同标签
    e.arcsFired = false;         // 裂口弧线事件只触发一次
    e.flash = 0;
    // 尖瓣碎片：固定随机方向 + 速度差（visualSeed 决定，非每帧随机）
    if (!e.petals || e.petals.length === 0) {
      e.petals = [];
      for (let i = 0; i < 9; i++) {
        e.petals.push({
          ang: 0, spd: 0, len: 0, w: 0, rot: 0,
        });
      }
    }
    for (let i = 0; i < e.petals.length; i++) {
      const p = e.petals[i];
      p.ang = (i / e.petals.length) * Math.PI * 2 + Utils.rand(-0.25, 0.25);
      p.spd = Utils.rand(220, 420);
      p.len = Utils.rand(14, 30);
      p.w = Utils.rand(3, 7);
      p.rot = Utils.rand(-0.6, 0.6);
    }
    this.effects.push(e);
    return e;
  },

  update(dt, state) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.t += dt;
      // 进入裂口残留阶段：弧线弱化传播只触发一次（不是自动攻击单位）
      if (!e.arcsFired && e.t >= this.T_BURST) {
        e.arcsFired = true;
        if (typeof EchoManager !== 'undefined' && state) {
          EchoManager.handleRuptureArcs(e, state);
        }
      }
      // 屏幕闪白：爆裂瞬间快速衰减（不遮挡整个画面）
      if (e.t >= this.T_BURST - 0.02 && e.t < this.T_BURST + 0.12) {
        e.flash = Math.max(e.flash, 0.12);
      }
      if (e.flash > 0) e.flash = Math.max(0, e.flash - dt * 0.9);
      if (e.t >= this.T_END) {
        e.arcs = [];
        this.effects.splice(i, 1);
        if (this._pool.length < 8) this._pool.push(e);
      }
    }
  },

  clear() {
    this.effects.length = 0;
    for (const e of this._pool) e.arcs = [];
  },

  render(ctx, cam) {
    for (const e of this.effects) {
      if (!Utils.isOnScreen(e.x, e.y, cam, e.radius * 2.5)) continue;
      const s = Utils.worldToScreen(e.x, e.y, cam);
      if (e.t < this.T_PRE)          this._renderPrecursor(ctx, s, e);
      else if (e.t < this.T_CORE)    this._renderCore(ctx, s, e);
      else if (e.t < this.T_BURST)   this._renderBurst(ctx, s, e);
      else                           this._renderCrack(ctx, s, e, cam);
    }
    // 少量屏幕闪白（alpha 很低，绝不遮挡整个画面）
    for (const e of this.effects) {
      if (e.flash > 0.001) {
        ctx.save();
        ctx.globalAlpha = e.flash;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cam.sw, cam.sh);
        ctx.restore();
      }
    }
  },

  // ── 阶段 1：预兆（250ms）——紫色细环 + 三个旋转缺口 + 标签依次点亮 ──────
  _renderPrecursor(ctx, s, e) {
    const t = e.t / this.T_PRE;                 // 0 → 1
    const ringR = e.radius * (0.35 + t * 0.55); // 细环逐渐扩大
    const rot = e.seed + e.t * 1.6;             // 缺口随时间旋转
    const gapColors = ['#b04cff', '#35f0ff', '#ffffff'];
    ctx.save();
    // 地面紫色细环（分 3 段弧，缺口位置随 rot 旋转）
    for (let i = 0; i < 3; i++) {
      const lit = Math.min(2, Math.floor(t * 3.3));  // 标签依次点亮缺口
      const a0 = rot + (i / 3) * Math.PI * 2;
      const a1 = a0 + Math.PI * 2 / 3 - 0.42;         // 缺口约 0.42 rad
      ctx.beginPath();
      ctx.arc(s.x, s.y, ringR, a0, a1);
      ctx.strokeStyle = (i <= lit) ? gapColors[i] : '#55217a';
      ctx.lineWidth = (i <= lit) ? 2.2 : 1.4;
      ctx.globalAlpha = (i <= lit) ? 0.85 : 0.35;
      ctx.stroke();
    }
    // 节点中心轻微抖动：标签越多中心越亮（爆裂时 3 标签全亮）
    const wob = Math.sin(e.t * 42 + e.seed) * (1 + t);
    const coreR = 5 + t * 4;
    ctx.globalAlpha = 0.35 + t * 0.55;
    const grad = ctx.createRadialGradient(s.x + wob, s.y - wob, 0, s.x, s.y, coreR * 3);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.5, 'rgba(176,76,255,0.5)');
    grad.addColorStop(1, 'rgba(176,76,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(s.x + wob, s.y - wob, coreR * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },

  // ── 阶段 2：核心压缩（120ms）——白色菱形四尖角光片 + 黑紫收缩边缘 ──────
  _renderCore(ctx, s, e) {
    const t = (e.t - this.T_PRE) / (this.T_CORE - this.T_PRE);  // 0 → 1
    const R = e.radius * (0.9 - t * 0.62);                      // 明显收缩
    ctx.save();
    // 外围黑紫色收缩边缘（空间压缩感）
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(s.x, s.y, R * 1.25, 0, Math.PI * 2);
    ctx.strokeStyle = '#1a0426';
    ctx.lineWidth = 6 * (1 - t * 0.5);
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(s.x, s.y, R * 1.45, 0, Math.PI * 2);
    ctx.strokeStyle = '#3b1266';
    ctx.lineWidth = 3;
    ctx.stroke();
    // 中心白色菱形：四个尖角光片（不用普通圆球）
    const spin = e.seed * 0.3 + e.t * 1.2;
    for (let i = 0; i < 4; i++) {
      const a = spin + (i / 4) * Math.PI * 2;
      const tipX = s.x + Math.cos(a) * R;
      const tipY = s.y + Math.sin(a) * R;
      const lX = s.x + Math.cos(a + 1.25) * R * 0.34;
      const lY = s.y + Math.sin(a + 1.25) * R * 0.34;
      const rX = s.x + Math.cos(a - 1.25) * R * 0.34;
      const rY = s.y + Math.sin(a - 1.25) * R * 0.34;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(lX, lY);
      ctx.lineTo(rX, rY);
      ctx.closePath();
      const g = ctx.createLinearGradient(tipX, tipY, s.x, s.y);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(1, 'rgba(53,240,255,0.25)');
      ctx.fillStyle = g;
      ctx.globalAlpha = 0.75 + t * 0.25;
      ctx.fill();
    }
    // 菱形核心高光
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - R * 0.32);
    ctx.lineTo(s.x + R * 0.32, s.y);
    ctx.lineTo(s.x, s.y + R * 0.32);
    ctx.lineTo(s.x - R * 0.32, s.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },

  // ── 阶段 3：爆裂（200ms）——白色高亮 + 紫冲击波 + 青断裂环 + 白尖瓣 ──────
  _renderBurst(ctx, s, e) {
    const t = (e.t - this.T_CORE) / (this.T_BURST - this.T_CORE); // 0 → 1
    const R = e.radius;
    ctx.save();
    // 中心白色高亮（快速衰减）
    const hi = 1 - t;
    if (hi > 0) {
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, R * 0.8);
      g.addColorStop(0, `rgba(255,255,255,${0.85 * hi})`);
      g.addColorStop(0.55, `rgba(255,255,255,${0.3 * hi})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, R * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    // 第一层：紫色冲击波（边缘断裂、不完整——分段弧）
    const waveR = R * (0.35 + t * 1.05);
    ctx.globalAlpha = 0.75 * (1 - t * 0.75);
    for (let i = 0; i < 6; i++) {
      const a0 = e.seed + (i / 6) * Math.PI * 2 + t * 0.8;
      ctx.beginPath();
      ctx.arc(s.x, s.y, waveR, a0, a0 + 0.62);
      ctx.strokeStyle = '#b04cff';
      ctx.lineWidth = 5 * (1 - t * 0.5);
      ctx.stroke();
    }
    // 第二层：青色断裂环（弧段更碎）
    const ring2 = R * (0.5 + t * 0.85);
    ctx.globalAlpha = 0.6 * (1 - t * 0.6);
    for (let i = 0; i < 8; i++) {
      const a0 = e.seed * 2 + (i / 8) * Math.PI * 2 - t * 1.1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, ring2, a0, a0 + 0.38);
      ctx.strokeStyle = '#35f0ff';
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }
    // 第三层：白色尖瓣碎片（方向性 + 速度差）
    for (let i = 0; i < e.petals.length; i++) {
      const p = e.petals[i];
      const d = p.spd * t * 0.55 + 12;
      const px = s.x + Math.cos(p.ang + p.rot * t) * d;
      const py = s.y + Math.sin(p.ang + p.rot * t) * d;
      const tipX = px + Math.cos(p.ang) * p.len * (1 + t);
      const tipY = py + Math.sin(p.ang) * p.len * (1 + t);
      const bx = px + Math.cos(p.ang + Math.PI / 2) * p.w;
      const by = py + Math.sin(p.ang + Math.PI / 2) * p.w;
      const cx = px + Math.cos(p.ang - Math.PI / 2) * p.w;
      const cy = py + Math.sin(p.ang - Math.PI / 2) * p.w;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(bx, by);
      ctx.lineTo(cx, cy);
      ctx.closePath();
      ctx.globalAlpha = 0.85 * (1 - t * 0.8);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    ctx.restore();
  },

  // ── 阶段 4：裂口残留（500ms）——白色裂口旋转 + 白色弧线 ─────────────────
  _renderCrack(ctx, s, e, cam) {
    const t = (e.t - this.T_BURST) / (this.T_END - this.T_BURST); // 0 → 1
    const fade = 1 - t;
    const R = e.radius * 0.42;
    ctx.save();
    // 地面白色裂口：不规则多边形（seed 决定顶点），缓慢旋转
    const spin = e.seed * 0.2 + e.t * 0.7;
    ctx.translate(s.x, s.y);
    ctx.rotate(spin);
    ctx.beginPath();
    const verts = 7;
    for (let i = 0; i < verts; i++) {
      const a = (i / verts) * Math.PI * 2;
      const jitter = 0.62 + ((Math.sin(e.seed + i * 2.7) + 1) / 2) * 0.55;
      const r = R * jitter * (1 + t * 0.18);
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r * 0.72;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.22 * fade;
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.globalAlpha = 0.75 * fade;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.restore();

    // 白色弧线：裂口向附近目标发出 3~5 条（只触发一次弱化传播，非自动攻击）
    const arcT = Math.min(1, t * 2.2);
    for (let i = 0; i < e.arcs.length; i++) {
      const a = e.arcs[i];
      const s2 = Utils.worldToScreen(a.x, a.y, cam);
      const mx = (s.x + s2.x) / 2 + Math.sin(e.seed + i * 3.1) * 26;
      const my = (s.y + s2.y) / 2 + Math.cos(e.seed + i * 2.3) * 26;
      ctx.save();
      ctx.globalAlpha = 0.7 * fade * arcT;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.quadraticCurveTo(mx, my, s2.x, s2.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
    }
  },
};

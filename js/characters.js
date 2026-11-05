// ─── 玩家角色程序绘制（五流派）───────────────────────────────────────────────
// 全部由 Canvas 2D 路径 / 多边形 / 贝塞尔曲线生成，不加载、不裁切参考设定图。
// 统一坐标：脚底 / 悬浮基准为 (0, 0)，向上为负 y；设计高度 56。
// 五名角色共用同一套渲染入口与调色板，但拥有各自独立的部件与动作参数。

const CHAR_DESIGN_H = 56;
const CHAR_TAU = Math.PI * 2;
// 各角色设计坐标中的可见最高点（含帽尖 / 冠片），用于血条与避让
const CHAR_VISUAL_TOPS = { 0: 56, 1: 59, 2: 51, 3: 63, 4: 60 };

// ── 头像 / ICON 调色板（portrait：保持现有主界面观感）──────────────────────
const CHAR_PALETTES = {
  0: {
    outline: '#07030d', deep: '#0f0819', back: '#190d28', mid: '#261239',
    front: '#351b51', light: '#4d2a73', metal: '#6b4a92',
    accent: '#b15cff', eye: '#e3b0ff', core: '#c97bff', hand: '#2a163f',
  },
  1: {
    outline: '#07030d', deep: '#0d0918', back: '#171029', mid: '#24143d',
    front: '#341d55', light: '#4b2b78', metal: '#5d3b86',
    accent: '#45d8ff', eye: '#8ff7ff', core: '#9a5cff', hand: '#25153b',
  },
  2: {
    outline: '#07030d', deep: '#100a16', back: '#1b1125', mid: '#2a1938',
    front: '#3b244e', light: '#553568', metal: '#5a467e',
    accent: '#ff4fd8', eye: '#f4f0ff', core: '#ff3cc8', hand: '#2a1836',
  },
  3: {
    outline: '#07030d', deep: '#0f0b18', back: '#191226', mid: '#261939',
    front: '#35244d', light: '#4c3468', metal: '#7a5f9c',
    accent: '#a66cff', eye: '#c9a4ff', core: '#d9b6ff',
    mask: '#b6a3c9', hand: '#b7a5c9',
  },
  4: {
    outline: '#07030d', deep: '#0d0818', back: '#171029', mid: '#23143a',
    front: '#331e52', light: '#4a2c73', metal: '#5e4b90',
    accent: '#7d5cff', eye: '#d7c2ff', core: '#4f8cff', hand: '#25143b',
  },
};

// ── 局内战斗调色板（battle：身体色块先被看见，再看到内部细节）──────────────
// 深缝 / 面罩保持最暗；身体主面比新地面亮一档；受光面再亮一档。
const CHAR_BATTLE_PALETTES = {
  0: {
    outline: '#0b0814', deep: '#100d19', back: '#2a1d3c', mid: '#3d2b52',
    front: '#4d3767', light: '#624779', metal: '#6f5785', hand: '#3d2b52',
    accent: '#b15cff', eye: '#e3b0ff', core: '#c97bff',
  },
  1: {
    outline: '#0b0814', deep: '#100d19', back: '#291f3d', mid: '#3a2d52',
    front: '#4a3967', light: '#5f4a7d', metal: '#6b5787', hand: '#3a2d52',
    accent: '#45d8ff', eye: '#8ff7ff', core: '#9a5cff',
  },
  2: {
    outline: '#0b0814', deep: '#100d19', back: '#2c1e36', mid: '#402c4c',
    front: '#4f3860', light: '#644877', metal: '#70587f', hand: '#402c4c',
    accent: '#ff4fd8', eye: '#f4f0ff', core: '#ff3cc8',
  },
  3: {
    outline: '#0b0814', deep: '#100d19', back: '#2b203e', mid: '#3e2d52',
    front: '#4e3867', light: '#634b7c', metal: '#74608b', hand: '#b7a5c9',
    mask: '#b6a3c9', accent: '#a66cff', eye: '#c9a4ff', core: '#d9b6ff',
  },
  4: {
    outline: '#0b0814', deep: '#100d19', back: '#2a1e42', mid: '#3d2b57',
    front: '#4c386d', light: '#604883', metal: '#6d5a90', hand: '#3d2b57',
    accent: '#7d5cff', eye: '#d7c2ff', core: '#4f8cff',
  },
};

// 更暗、更透明的暗影配色（分身 / 死亡分身）
const CHAR_SHADOW_PALETTE = {
  outline: '#090610', deep: '#130d1d', back: '#1e1430', mid: '#2b1d40',
  front: '#38264f', light: '#46325f', metal: '#4f386a',
  accent: '#8a4de0', eye: '#b07aff', core: '#9a5df0', hand: '#2b1d40',
  mask: '#3a2a50',
};

// 剪影模式：深紫主体 + 流派色边光
function charSilhouettePalette(genre) {
  const base = CHAR_PALETTES[genre] || CHAR_PALETTES[0];
  return {
    outline: base.accent,
    deep: '#1b0a36', back: '#241043', mid: '#2d1552',
    front: '#381b63', light: '#462574', metal: '#52308a',
    accent: base.accent, eye: base.accent, core: base.accent,
    hand: '#2d1552', mask: '#381b63',
  };
}

function charPalette(genre, mode) {
  const g = CHAR_PALETTES[genre] ? genre : 0;
  if (mode === 'silhouette') return charSilhouettePalette(g);
  if (mode === 'shadow') return CHAR_SHADOW_PALETTE;
  if (mode === 'portrait') return CHAR_PALETTES[g];
  return CHAR_BATTLE_PALETTES[g];
}

// ── 静态几何缓存 ────────────────────────────────────────────────────────────
const _charPolyCache = new Map();

function cpoly(name, pts) {
  let p = _charPolyCache.get(name);
  if (p) return p;
  p = new Path2D();
  p.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
  p.closePath();
  _charPolyCache.set(name, p);
  return p;
}

function cfill(ctx, path, fill, outline, lw) {
  ctx.fillStyle = fill;
  ctx.fill(path);
  if (outline) {
    let lwv = (lw != null) ? lw : 2.2;
    if (ctx._charSilhouette) lwv = Math.min(lwv, 1.15);
    else if (ctx._charBattle && lwv < 1.8) lwv = Math.max(0.72, lwv * 0.7);
    ctx.lineWidth = lwv;
    ctx.strokeStyle = outline;
    ctx.stroke(path);
  }
}

function cstroke(ctx, path, color, lw, alpha) {
  ctx.save();
  if (alpha != null) ctx.globalAlpha *= alpha;
  ctx.lineWidth = ctx._charSilhouette ? Math.min(lw, 1.1) : lw;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke(path);
  ctx.restore();
}

// 粗描边肢体（腿 / 手臂）
function climb(ctx, x0, y0, x1, y1, w, fill, outline, ow) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (outline) {
    const owv = (ow != null ? ow : 2.2);
    ctx.strokeStyle = outline;
    ctx.lineWidth = w + (ctx._charSilhouette ? Math.min(owv, 1.2) : owv);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  ctx.strokeStyle = fill;
  ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}

function cshadow(ctx, rx, ry, alpha) {
  ctx.save();
  ctx.globalAlpha *= (alpha != null ? alpha : 0.5);
  ctx.fillStyle = '#020006';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, CHAR_TAU);
  ctx.fill();
  ctx.restore();
}

// ── 局部光晕贴图缓存（替代每帧 shadowBlur）──────────────────────────────────
const _charGlowSprites = new Map();

function _charColorParts(hex) {
  if (typeof hex === 'string' && hex[0] === '#') {
    const h = hex.slice(1);
    if (h.length >= 6) {
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
  }
  return [200, 150, 255];
}

function cglow(ctx, x, y, radius, color, alpha) {
  let sp = _charGlowSprites.get(color);
  if (!sp) {
    const size = 64;
    sp = document.createElement('canvas');
    sp.width = size; sp.height = size;
    const g = sp.getContext('2d');
    const c = _charColorParts(color);
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},1)`);
    grad.addColorStop(0.42, `rgba(${c[0]},${c[1]},${c[2]},0.55)`);
    grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    _charGlowSprites.set(color, sp);
  }
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * (alpha != null ? alpha : 1);
  ctx.drawImage(sp, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = prev;
}

// ── 动作状态（玩家 / 攻击分身 / 死亡分身各自独立）────────────────────────────
class CharacterAnim {
  constructor(genre, aim) {
    this.genre = genre != null ? genre : 0;
    this.reset();
    if (aim != null) this.snapAim(aim);
  }

  reset() {
    this.time = 0;
    this.side = 1;
    this._flipT = 0;
    this.aim = -Math.PI / 2;
    this.moving = false;
    this.moveBlend = 0;
    this.walk = 0;
    this.firePulse = 0;
    this.fireKind = 'basic';
    this.fireDir = -Math.PI / 2;
    this.skillT = 0;
    this.skillDur = 0.5;
    this.skillKind = '';
    this.recallT = 0;
    this.recallDur = 0.5;
    this.spawnT = 0;
    this.spawnDur = 0.4;
    this.nodeT = 0;
    this.nodeDur = 0.5;
    this.nodeCd = 0;
    this.charge = 0;
    this.chargeTarget = 0;
    this.thunderT = 0;
    this.showcase = false;
  }

  // 立即设置朝向（用于 UI 展示 / 图标）
  snapAim(angle) {
    this.aim = angle;
    this.side = Math.cos(angle) >= 0 ? 1 : -1;
    this._flipT = 0;
  }

  setAim(angle) {
    if (angle == null) return;
    this.aim = angle;
  }

  triggerFire(kind, angle) {
    this.fireKind = kind || 'basic';
    if (angle != null) this.fireDir = angle;
    else this.fireDir = this.aim;
    this.firePulse = Math.min(1.35, this.firePulse + 0.9);
  }

  triggerSkill(kind, dur, angle) {
    this.skillKind = kind || 'skill';
    this.skillDur = dur || 0.5;
    this.skillT = this.skillDur;
    if (angle != null) this.aim = angle;
    // 同一时刻的技能与普通攻击合并为一次施法：压低普通开火脉冲
    this.firePulse = Math.min(this.firePulse, 0.35);
  }

  triggerRecall(dur) {
    this.recallDur = dur || 0.5;
    this.recallT = this.recallDur;
  }

  triggerSpawn() {
    this.spawnT = this.spawnDur;
  }

  triggerNode() {
    if (this.nodeCd > 0) return;
    this.nodeCd = 0.9;
    this.nodeT = this.nodeDur;
  }

  triggerThunder() {
    this.thunderT = 0.6;
  }

  setCharge(v) {
    this.chargeTarget = Math.max(0, Math.min(1, v || 0));
  }

  update(dt, opts) {
    const o = opts || {};
    this.time += dt;

    // 朝向稳定：只有横向分量足够大且持续一小段时间才翻转身体
    const aim = (o.aimAngle != null) ? o.aimAngle : this.aim;
    this.aim = aim;
    const cx = Math.cos(aim);
    if (Math.abs(cx) > 0.16) {
      const want = cx >= 0 ? 1 : -1;
      if (want !== this.side) {
        this._flipT += dt;
        if (this._flipT >= 0.14) {
          this.side = want;
          this._flipT = 0;
        }
      } else {
        this._flipT = 0;
      }
    }

    this.moving = !!o.moving;
    this.moveBlend += ((this.moving ? 1 : 0) - this.moveBlend) * Math.min(1, dt * 9);
    this.walk += dt * (this.moving ? (o.speedFactor || 8) : 1.8);

    this.firePulse = Math.max(0, this.firePulse - dt * 7.5);
    if (this.skillT > 0) this.skillT = Math.max(0, this.skillT - dt);
    if (this.recallT > 0) this.recallT = Math.max(0, this.recallT - dt);
    if (this.spawnT > 0) this.spawnT = Math.max(0, this.spawnT - dt);
    if (this.nodeT > 0) this.nodeT = Math.max(0, this.nodeT - dt);
    if (this.nodeCd > 0) this.nodeCd = Math.max(0, this.nodeCd - dt);
    if (this.thunderT > 0) this.thunderT = Math.max(0, this.thunderT - dt);
    this.charge += (this.chargeTarget - this.charge) * Math.min(1, dt * 8);
  }

  get fireK() { return Math.min(1, this.firePulse); }
  get skillK() {
    if (this.skillT <= 0) return 0;
    return Math.sin((1 - this.skillT / this.skillDur) * Math.PI);
  }
  get recallK() {
    if (this.recallT <= 0) return 0;
    return Math.sin((1 - this.recallT / this.recallDur) * Math.PI);
  }
  get spawnK() {
    if (this.spawnT <= 0) return 0;
    return Math.sin((1 - this.spawnT / this.spawnDur) * Math.PI);
  }
  get nodeK() {
    if (this.nodeT <= 0) return 0;
    return Math.sin((1 - this.nodeT / this.nodeDur) * Math.PI);
  }
  get thunderK() { return this.thunderT > 0 ? Math.min(1, this.thunderT / 0.6) : 0; }
}

// ── 通用小部件 ──────────────────────────────────────────────────────────────
function drawSlit(ctx, pts, fill, outline) {
  const p = cpoly('slit|' + pts.join(','), pts);
  cfill(ctx, p, fill, outline, 0.8);
}

function shortAngle(from, to) {
  let d = (to - from) % CHAR_TAU;
  if (d > Math.PI) d -= CHAR_TAU;
  if (d < -Math.PI) d += CHAR_TAU;
  return d;
}

// ==== 角色 0：兜帽枪手 =====================================================
const CHAR_GUNNER = {
  icon: { cx: 0, cy: -35.5, zoom: 1.02 },
  draw(ctx, P, a, o) {
    const side = a.side;
    const f = o.f;
    const m = a.moveBlend;
    const walk = a.walk;
    const step = Math.sin(walk) * m;
    const breath = Math.sin(a.time * 2.2) * 0.7;
    const behind = Math.sin(a.aim) < -0.16;

    cshadow(ctx, 15, 3.2, o.mode === 'silhouette' ? 0.3 : 0.5);

    // 分身生成残影：身体后方短暂错位
    if (o.spk > 0 && o.mode === 'normal') {
      for (let i = 1; i <= 2; i++) {
        ctx.save();
        ctx.globalAlpha *= 0.26 * o.spk * (1 - i * 0.3);
        ctx.translate(-side * i * 5 * o.spk, i * 1.5);
        ctx.scale(0.98, 0.98);
        CHAR_GUNNER.draw(ctx, P, a, Object.assign({}, o, { mode: 'shadow', spk: 0, f: 0 }));
        ctx.restore();
      }
    }

    ctx.save();
    ctx.translate(0, breath + Math.abs(step) * 0.5);
    ctx.scale(side, 1);
    if (m > 0.02) ctx.rotate(m * 0.035);

    // 后层披风（破损短披风）
    const capeSwing = Math.sin(a.time * 2.0) * 1.4 + m * 2.2;
    ctx.save();
    ctx.translate(0, -32);
    ctx.rotate((capeSwing * 0.012) * side);
    ctx.translate(0, 32);
    const cape = cpoly('g0_cape', [
      -9, -33, 9, -33, 13, -26, 11, -18, 15, -10, 9, -7, 7, -15,
      4, -8, 1, -16, -2, -7, -6, -14, -9, -8, -12, -17, -14, -24,
    ]);
    cfill(ctx, cape, P.back, P.outline, 2.3);
    const capeHi = cpoly('g0_cape_hi', [-8, -31, 5, -31, 8, -24, 4, -20, 1, -26, -3, -20, -6, -26]);
    cfill(ctx, capeHi, P.front, null);
    ctx.restore();

    // 后腿 / 前腿（短促交替步伐）
    const legBack = -step * 1.1;
    const legFront = step * 1.1;
    const liftF = Math.max(0, Math.sin(walk)) * m * 1.2;
    cfill(ctx, cpoly('g0_leg_b', [-7, -14, -2, -14, -3 - legBack * 0.4, -4, -7 - legBack * 0.4, -4]),
      P.mid, P.outline, 1.8);
    cfill(ctx, cpoly('g0_boot_b', [-8, -5, -2, -5, -2 - legBack * 0.4, 0, -8 - legBack * 0.4, 0]),
      P.front, P.outline, 1.8);
    cfill(ctx, cpoly('g0_leg_f', [2, -15, 7, -15, 8 + legFront * 0.4, -4, 4 + legFront * 0.4, -4]),
      P.front, P.outline, 1.8);
    cfill(ctx, cpoly('g0_boot_f', [3, -5, 9, -5, 9 + legFront * 0.4, 0 - liftF, 3 + legFront * 0.4, 0 - liftF]),
      P.light, P.outline, 1.8);

    // 后侧手臂
    climb(ctx, -8, -29, -9, -22, 3.2, P.mid, P.outline, 2);
    ctx.fillStyle = P.hand;
    ctx.beginPath(); ctx.arc(-9, -21, 2.2, 0, CHAR_TAU); ctx.fill();
    ctx.restore();

    // 武器在身体后方（朝上 / 后方攻击时）
    if (behind) this._drawGunArm(ctx, P, a, o);
    if (behind) this._drawGun(ctx, P, a, o);

    ctx.save();
    ctx.scale(side, 1);
    // 躯干
    const torso = cpoly('g0_torso', [-9, -32, 8, -32, 7, -14, 0, -11, -8, -14]);
    cfill(ctx, torso, P.mid, P.outline, 2.3);
    const chest = cpoly('g0_chest', [2, -30, 8, -28, 7, -17, 2, -17, 0, -23]);
    cfill(ctx, chest, P.front, null);
    cfill(ctx, cpoly('g0_belt', [-8, -16, 7, -16, 7, -13, -8, -13]), P.deep, P.outline, 1.3);
    cfill(ctx, cpoly('g0_buckle', [-2, -16, 2, -16, 1.4, -13.4, -1.4, -13.4]), P.accent, null);

    // 领口 / 兜帽肩部
    cfill(ctx, cpoly('g0_shoulder', [-11, -31, -3, -33, 2, -31, -1, -27, -9, -27]),
      P.front, P.outline, 1.8);

    // 头部
    this._head(ctx, P, a, o, false);

    // 前侧持枪手与枪（朝下 / 前方时在身体前）
    ctx.restore();

    if (!behind) {
      this._drawGunArm(ctx, P, a, o);
      this._drawGun(ctx, P, a, o);
    }

    // 枪口火花 / 短促局部轨迹
    this._muzzle(ctx, P, a, o);
  },

  _head(ctx, P, a, o, icon) {
    const hood = cpoly('g0_hood', [
      -10, -30, -15, -39, -13, -48, -7, -54, 1, -55,
      8, -51, 12, -44, 13, -36, 9, -30, 4, -28, -4, -28,
    ]);
    cfill(ctx, hood, P.mid, P.outline, 2.4);
    // 兜帽高光折面
    const hoodHi = cpoly('g0_hood_hi', [-13, -39, -7, -50, -1, -52, -5, -46, -8, -38]);
    cfill(ctx, hoodHi, P.front, null);
    cstroke(ctx, cpoly('g0_hood_rim', [-13, -39, -7, -50, 1, -53, 8, -49, 11, -42]), P.edge || P.accent, 1.1, 0.55);

    // 黑色面部
    const face = cpoly('g0_face', [-8, -31, -9, -40, -5, -46, 1, -47, 6, -43, 8, -35, 4, -30, -2, -30]);
    cfill(ctx, face, P.deep, null);

    // 两只狭长紫色眼睛
    drawSlit(ctx, [-7.2, -40.2, -3.0, -42.0, -2.5, -40.0, -6.4, -38.4], P.eye, null);
    drawSlit(ctx, [2.7, -40.0, 6.1, -38.4, 6.8, -40.5, 3.2, -42.0], P.eye, null);
    drawSlit(ctx, [-5.8, -39.7, -3.5, -40.6, -3.2, -39.8, -5.5, -39.0], P.core, null);

    // 遮住下半张脸的面罩
    const mask = cpoly('g0_mask', [-6, -35, 5, -35, 6, -31.4, -5, -31.4]);
    cfill(ctx, mask, P.front, P.outline, 1.4);
    cstroke(ctx, cpoly('g0_mask_line', [-4.5, -33.2, 4.2, -33.2]), P.light, 0.8, 0.8);

    // 颈部围巾
    cfill(ctx, cpoly('g0_scarf', [-7, -29, 5, -30, 7, -27, -5, -26.4]), P.front, P.outline, 1.2);

    if (icon) {
      // 头肩像：披风领口
      cfill(ctx, cpoly('g0_icon_shoulder', [-18, -22, -10, -31, 9, -31, 18, -22, 15, -14, -14, -14]),
        P.back, P.outline, 2);
      cfill(ctx, cpoly('g0_icon_cloak', [-14, -20, -8, -27, 7, -27, 14, -20, 10, -16, -10, -16]),
        P.front, null);
    }
  },

  _drawGunArm(ctx, P, a, o) {
    const side = a.side;
    const f = o.f;
    const hx = side * 8.4;
    const hy = -22.6;
    climb(ctx, side * 7, -29, hx, hy, 3.4, P.mid, P.outline, 2.1);
    ctx.fillStyle = P.front;
    ctx.beginPath(); ctx.arc(hx, hy, 2.5, 0, CHAR_TAU); ctx.fill();
    ctx.strokeStyle = P.outline; ctx.lineWidth = 1.6; ctx.stroke();
  },

  _drawGun(ctx, P, a, o) {
    const f = o.f;
    const side = a.side;
    ctx.save();
    ctx.translate(side * 8.4, -22.6);
    ctx.rotate(a.aim);
    ctx.translate(-f * 2.1, 0);

    // 枪身
    cfill(ctx, cpoly('g0_gun_body', [-4.5, -3.2, 8.5, -3.2, 9, 2.6, -4.5, 2.6]), P.metal, P.outline, 2);
    // 枪管
    cfill(ctx, cpoly('g0_gun_barrel', [8, -2.1, 15.8, -2.1, 15.8, 1.9, 8, 1.9]), P.front, P.outline, 1.7);
    // 枪口
    cfill(ctx, cpoly('g0_gun_muzzle', [15.4, -2.7, 17.4, -2.7, 17.4, 2.5, 15.4, 2.5]), P.light, P.outline, 1.3);
    ctx.fillStyle = P.deep;
    ctx.fillRect(16.6, -1.4, 0.8, 2.8);
    // 握把
    cfill(ctx, cpoly('g0_gun_grip', [0.5, 2.2, 4.2, 2.2, 2.3, 7.4, -1.2, 7.4]), P.back, P.outline, 1.5);
    // 顶部导轨高光
    cfill(ctx, cpoly('g0_gun_rail', [-3.4, -3.6, 7.4, -3.6, 7.4, -2.8, -3.4, -2.8]), P.accent, null);
    // 扳机护圈
    cstroke(ctx, cpoly('g0_gun_guard', [1.4, 2.8, 4.6, 2.8, 4.4, 5.1, 2.8, 5.1]), P.light, 1.0, 0.9);

    // 枪口紫白火花
    if (f > 0.1) {
      cglow(ctx, 18.2, 0, 6.5 + f * 3, '#e6c8ff', 0.55 * f);
      const spark = cpoly('g0_spark', [18, 0, 21.5, -1.4, 20.4, 0, 23.4, 0.8, 20.4, 1.2, 21.2, 2.8]);
      ctx.save();
      ctx.globalAlpha *= Math.min(1, f * 1.4);
      cfill(ctx, spark, '#f2ddff', null);
      ctx.restore();
    }
    ctx.restore();
  },

  _muzzle(ctx, P, a, o) {
    const f = o.f;
    if (f <= 0.05) return;
    const side = a.side;
    const mx = side * 8.4 + Math.cos(a.aim) * 18;
    const my = -22.6 + Math.sin(a.aim) * 18;
    cglow(ctx, mx, my, 7 + f * 4, '#c97bff', 0.42 * f);
    // 短促局部轨迹：从枪口指向实际出射方向（不改变真实弹体出生点）
    ctx.save();
    ctx.globalAlpha *= 0.5 * f;
    ctx.strokeStyle = '#d9a8ff';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(mx + Math.cos(a.aim) * 8 * f, my + Math.sin(a.aim) * 8 * f);
    ctx.stroke();
    ctx.restore();
  },
};

// ==== 角色 1：尖帽法师 =====================================================
const CHAR_MAGE = {
  icon: { cx: 0, cy: -36, zoom: 0.98 },
  draw(ctx, P, a, o) {
    const f = o.f;
    const sk = o.sk;
    const m = a.moveBlend;
    const float = Math.sin(a.time * 1.9) * 1.1 + m * 0.5;

    cshadow(ctx, 14, 3.0, o.mode === 'silhouette' ? 0.24 : 0.4);

    ctx.save();
    ctx.translate(0, float);
    if (m > 0.02) ctx.rotate(m * 0.032);

    // 法杖在身体后方
    this._drawStaff(ctx, P, a, o);

    // 悬浮下摆 / 长袍
    const hem = cpoly('g1_hem', [
      -13, -12, 13, -12, 15, -5, 10, -2, 8, -7, 4, -1, 0, -6,
      -4, -1, -8, -8, -12, -2, -15, -6,
    ]);
    cfill(ctx, hem, P.back, P.outline, 2.3);
    cfill(ctx, cpoly('g1_hem_hi', [-9, -12, 2, -12, 0, -4, -5, -6]), P.front, null);

    // 长袍主体
    const robe = cpoly('g1_robe', [-11, -31, 10, -31, 13, -15, 9, -10, 2, -13, -4, -9, -10, -13, -13, -16]);
    cfill(ctx, robe, P.mid, P.outline, 2.4);
    // 分片袍摆
    cfill(ctx, cpoly('g1_panel_l', [-11, -27, -2, -25, -4, -8, -10, -12]), P.front, P.outline, 1.5);
    cfill(ctx, cpoly('g1_panel_r', [2, -25, 10, -27, 11, -13, 4, -10]), P.front, P.outline, 1.5);
    // 腰饰
    cfill(ctx, cpoly('g1_sash', [-8, -18, 8, -18, 7, -15, -7, -15]), P.deep, P.outline, 1.2);
    cfill(ctx, cpoly('g1_gem', [-1.5, -17, 1.5, -17, 0, -13.6]), P.core, null);

    // 后手 / 袖子
    this._drawBackSleeve(ctx, P, a, o);

    // 头部
    this._head(ctx, P, a, o, false);

    // 前手推掌 / 施法
    this._drawCastHand(ctx, P, a, o);

    ctx.restore();
  },

  _head(ctx, P, a, o, icon) {
    // 帽下黑色面部（眼睛位于帽檐下缘之下）
    ctx.fillStyle = P.deep;
    ctx.beginPath();
    ctx.ellipse(0, -36.6, 8.2, 6.2, 0, 0, CHAR_TAU);
    ctx.fill();

    // 冰青色眼睛
    drawSlit(ctx, [-6.6, -37.8, -2.4, -39.0, -2.0, -37.2, -6.2, -36.2], P.eye, null);
    drawSlit(ctx, [2.2, -37.8, 6.4, -36.2, 6.8, -38.1, 2.6, -39.0], P.eye, null);

    // 宽帽檐（压在面部上方，不遮住眼睛）
    const brim = cpoly('g1_brim', [
      -19, -43, -11, -40, 4, -39, 15, -41, 22, -47,
      14, -49, 2, -50, -9, -49, -16, -46,
    ]);
    cfill(ctx, brim, P.mid, P.outline, 2.4);
    cfill(ctx, cpoly('g1_brim_band', [-11, -42.6, 6, -42.2, 15, -44.4, 6, -45.6, -9, -45.2]), P.front, null);
    cstroke(ctx, cpoly('g1_brim_edge', [-19, -43, -11, -40, 4, -39, 15, -41, 22, -47]), P.accent, 1.0, 0.7);

    // 弯曲尖帽（帽尖随待机错相摆动）
    ctx.save();
    ctx.translate(0, -46);
    ctx.rotate(Math.sin(a.time * 1.35) * 0.055);
    ctx.translate(0, 46);
    const cone = cpoly('g1_cone', [
      -10, -47, -4, -54, 0, -58, 5, -56, 6, -51,
      12, -53.5, 15, -48.5, 8, -46, 3, -47, -2, -48,
    ]);
    cfill(ctx, cone, P.front, P.outline, 2.3);
    cfill(ctx, cpoly('g1_cone_hi', [-7, -48, -3, -55, 1, -56.5, 2, -50.5, 0, -48]), P.light, null);
    cstroke(ctx, cpoly('g1_cone_edge', [-4, -54, 0, -58, 5, -56]), P.accent, 0.9, 0.55);
    ctx.restore();

    if (icon) {
      cfill(ctx, cpoly('g1_icon_shoulder', [-18, -22, -10, -31, 8, -31, 18, -23, 14, -15, -14, -15]),
        P.back, P.outline, 2);
      cfill(ctx, cpoly('g1_icon_robe', [-13, -20, -7, -28, 7, -28, 13, -20, 9, -16, -9, -16]),
        P.front, null);
    }
  },

  _drawBackSleeve(ctx, P, a, o) {
    const side = a.side;
    const hx = side * -10;
    const hy = -24;
    // 宽袖：从肩到持杖手
    cfill(ctx, cpoly('g1_sleeve_b', [
      side * -8, -30, side * -12, -28, hx - side * 2, hy + 1,
      hx + side * 2, hy - 2,
    ]), P.back, P.outline, 1.8);
    ctx.fillStyle = P.hand;
    ctx.beginPath(); ctx.arc(hx, hy, 2.4, 0, CHAR_TAU); ctx.fill();
    ctx.strokeStyle = P.outline; ctx.lineWidth = 1.5; ctx.stroke();
  },

  _drawStaff(ctx, P, a, o) {
    const side = a.side;
    const hx = side * -10;
    const hy = -24;
    const rest = -2.25;
    // 技能时法杖向目标点出；普通开火只轻微配合
    const t = Math.max(o.sk * 0.9, o.f * 0.18);
    const ang = rest + shortAngle(rest, a.aim) * Math.min(1, t);
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(ang);
    // 杖身
    climb(ctx, -7, 0, 20, 0, 2.6, P.metal, P.outline, 1.8);
    // 杖头弯月（C 形缺口 + 中央暗核）
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(26, 0, 9.0, -1.3, 1.3, false);
    ctx.lineWidth = 6.6; ctx.strokeStyle = P.outline; ctx.stroke();
    ctx.beginPath(); ctx.arc(26, 0, 9.0, -1.3, 1.3, false);
    ctx.lineWidth = 4.3; ctx.strokeStyle = P.light; ctx.stroke();
    ctx.restore();
    // 暗核
    ctx.fillStyle = P.deep;
    ctx.beginPath(); ctx.arc(27.5, 0, 4.0, 0, CHAR_TAU); ctx.fill();
    ctx.strokeStyle = P.core; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(27.5, 0, 4.0, 0, CHAR_TAU); ctx.stroke();
    cglow(ctx, 27.5, 0, 7.5, P.core, 0.35 + o.sk * 0.4);
    // 小横饰
    cfill(ctx, cpoly('g1_staff_band', [18, -2.6, 21, -2.6, 21, 2.6, 18, 2.6]), P.accent, null);
    ctx.restore();
  },

  _drawCastHand(ctx, P, a, o) {
    const side = a.side;
    const f = o.f;
    const sk = o.sk;
    const push = 5.5 * f + 10 * sk;
    const hx = side * 9 + Math.cos(a.aim) * push;
    const hy = -21.5 + Math.sin(a.aim) * push;
    // 宽袖
    cfill(ctx, cpoly('g1_sleeve_f', [
      side * 8, -30, side * 13, -28, hx + side * 2, hy - 1,
      hx - side * 3, hy + 3,
    ]), P.front, P.outline, 1.8);
    climb(ctx, side * 9, -29, hx, hy, 3.2, P.mid, P.outline, 2);
    // 手掌
    ctx.fillStyle = P.hand;
    ctx.beginPath(); ctx.arc(hx, hy, 2.8, 0, CHAR_TAU); ctx.fill();
    ctx.strokeStyle = P.outline; ctx.lineWidth = 1.5; ctx.stroke();
    // 手指（推掌）
    const fx = Math.cos(a.aim), fy = Math.sin(a.aim);
    ctx.strokeStyle = P.hand; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hx + fx * 2, hy + fy * 2);
    ctx.lineTo(hx + fx * 5.5, hy + fy * 5.5 - 1.5);
    ctx.moveTo(hx + fx * 2, hy + fy * 2);
    ctx.lineTo(hx + fx * 5.5, hy + fy * 5.5 + 1.8);
    ctx.stroke();

    if (f > 0.08 || sk > 0.08) {
      const k = Math.max(f, sk);
      cglow(ctx, hx + fx * 4, hy + fy * 4, 6 + k * 4, P.core, 0.45 * k);
      if (sk > 0.1) {
        // 漩涡释放：更明显的推送轨迹（纯视觉）
        ctx.save();
        ctx.globalAlpha *= 0.55 * sk;
        ctx.strokeStyle = P.accent;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(hx + fx * 5, hy + fy * 5);
        ctx.lineTo(hx + fx * (9 + 6 * sk), hy + fy * (9 + 6 * sk));
        ctx.stroke();
        ctx.restore();
      }
    }
  },
};

// ==== 角色 2：重甲战士 =====================================================
const CHAR_WARRIOR = {
  icon: { cx: 0, cy: -34, zoom: 1.15 },
  draw(ctx, P, a, o) {
    const side = a.side;
    const f = o.f;
    const sk = o.sk;
    const m = a.moveBlend;
    const walk = a.walk;
    const step = Math.sin(walk) * m;
    const breathe = Math.sin(a.time * 1.8) * 0.6;
    const behind = Math.sin(a.aim) < -0.1;
    const shell = o.shellPct || 0;

    cshadow(ctx, 19, 3.8, o.mode === 'silhouette' ? 0.32 : 0.55);

    ctx.save();
    // 蚀白冲击：重心压低；移动时肩部轻微重量摆动
    ctx.translate(0, breathe + sk * 1.6);
    ctx.scale(side, 1);
    ctx.rotate(step * 0.012);

    // 腿 / 厚重靴子
    const lb = -step * 0.9, lf = step * 0.9;
    cfill(ctx, cpoly('g2_leg_b', [-9, -15, -3, -15, -4 + lb, -4, -9 + lb, -4]), P.back, P.outline, 2);
    cfill(ctx, cpoly('g2_boot_b', [-11, -5, -3, -5, -3 + lb, 0, -11 + lb, 0]), P.mid, P.outline, 2);
    cfill(ctx, cpoly('g2_leg_f', [2, -16, 8, -16, 9 + lf, -4, 4 + lf, -4]), P.front, P.outline, 2);
    cfill(ctx, cpoly('g2_boot_f', [3, -5, 10, -5, 10 + lf, 0, 3 + lf, 0]), P.front, P.outline, 2);

    // 后侧肩甲 / 后手
    this._pauldron(ctx, P, -14, -32, -1, 2.5 + sk * 2.5, o.mode, shell);
    cfill(ctx, cpoly('g2_fist_b', [-15, -23, -10, -23, -10, -17, -15, -17]), P.back, P.outline, 1.6);
    ctx.restore();

    // 臂炮在后方
    if (behind) this._drawCannon(ctx, P, a, o);

    ctx.save();
    ctx.scale(side, 1);

    // 躯干
    const torso = cpoly('g2_torso', [-13, -34, 13, -34, 11, -15, 7, -11, -7, -11, -11, -15]);
    cfill(ctx, torso, P.mid, P.outline, 2.6);
    cfill(ctx, cpoly('g2_chestplate', [-10, -31, 10, -31, 8, -17, 0, -14, -8, -17]), P.front, P.outline, 1.6);
    // 胸口紫红能量裂缝
    const crackA = 0.35 + shell * 0.45 + Math.max(0, Math.sin(a.time * 1.4)) * 0.12 + sk * 0.3;
    ctx.save();
    ctx.globalAlpha *= Math.min(1, crackA);
    ctx.strokeStyle = P.core;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(1, -29); ctx.lineTo(-1.5, -25); ctx.lineTo(2.2, -23); ctx.lineTo(-1, -18.5);
    ctx.stroke();
    cglow(ctx, 0, -24, 5.5, P.core, 0.35 * crackA);
    ctx.restore();

    // 前侧肩甲（宽大肩甲）
    this._pauldron(ctx, P, 15, -33, 1, 3.0 + sk * 3.0, o.mode, shell);

    // 封闭头盔
    this._head(ctx, P, a, o, false);

    ctx.restore();

    // 臂炮在前方
    if (!behind) this._drawCannon(ctx, P, a, o);

    // 另一只手
    ctx.fillStyle = P.front;
    ctx.beginPath();
    ctx.arc(side * -12, -20, 3.0, 0, CHAR_TAU);
    ctx.fill();
    ctx.strokeStyle = P.outline; ctx.lineWidth = 1.6; ctx.stroke();
  },

  _pauldron(ctx, P, cx, cy, dir, expand, mode, shell) {
    const ex = dir * expand;
    const path = cpoly('g2_pauldron_' + (dir > 0 ? 'f' : 'b'), [
      cx - 7 * dir - ex, cy - 1, cx + 2 * dir - ex, cy - 9, cx + 8 * dir - ex, cy - 4,
      cx + 5 * dir - ex, cy + 6, cx - 5 * dir - ex, cy + 7, cx - 9 * dir - ex, cy + 2,
    ]);
    cfill(ctx, path, P.back, P.outline, 2.4);
    cfill(ctx, cpoly('g2_pauldron_hi_' + (dir > 0 ? 'f' : 'b'), [
      cx - 5 * dir - ex, cy - 2, cx + 1 * dir - ex, cy - 7, cx + 5 * dir - ex, cy - 3,
      cx + 2 * dir - ex, cy + 2,
    ]), P.light, null);
    cstroke(ctx, cpoly('g2_pauldron_edge_' + (dir > 0 ? 'f' : 'b'), [
      cx - 8 * dir - ex, cy + 1, cx + 2 * dir - ex, cy - 9, cx + 8 * dir - ex, cy - 4,
    ]), P.accent, 0.9, 0.6 + (shell || 0) * 0.28);
  },

  _head(ctx, P, a, o, icon) {
    // 头盔
    cfill(ctx, cpoly('g2_helmet', [-9, -38, -7, -45, -2, -49, 4, -48, 9, -43, 9, -35, 5, -31, -5, -31]),
      P.mid, P.outline, 2.4);
    cfill(ctx, cpoly('g2_helmet_hi', [-6, -42, -2, -47, 3, -46, 6, -41, 2, -38, -3, -38]),
      P.front, null);
    // 面甲 / 冷白视缝
    cfill(ctx, cpoly('g2_visor', [-8, -40, 8, -40, 7, -35, -7, -35]), P.deep, P.outline, 1.4);
    const visorGlow = 0.7 + Math.max(0, Math.sin(a.time * 1.2)) * 0.18;
    ctx.save();
    ctx.globalAlpha *= visorGlow;
    drawSlit(ctx, [-6.6, -38.6, 6.4, -38.6, 6.4, -37.2, -6.6, -37.2], P.eye, null);
    cglow(ctx, 0, -38, 7, P.eye, 0.22);
    ctx.restore();
    // 颈部护甲
    cfill(ctx, cpoly('g2_neck', [-6, -31, 6, -31, 5, -27, -5, -27]), P.deep, P.outline, 1.4);

    if (icon) {
      cfill(ctx, cpoly('g2_icon_shoulder', [-22, -20, -12, -31, 12, -31, 22, -20, 18, -13, -18, -13]),
        P.back, P.outline, 2.2);
      this._pauldron(ctx, P, -13, -20, -1, 1.2, 'normal', 0);
      this._pauldron(ctx, P, 13, -20, 1, 1.2, 'normal', 0);
    }
  },

  _drawCannon(ctx, P, a, o) {
    const side = a.side;
    const f = o.f;
    const sk = o.sk;
    const ch = a.charge;
    ctx.save();
    ctx.translate(side * 12.5, -25.5);
    ctx.rotate(a.aim);
    ctx.translate(-f * 3.2, 0);

    // 炮身（粗大臂炮）
    cfill(ctx, cpoly('g2_cannon_body', [-6, -7, 8, -6.5, 10, -2.5, 10, 2.5, 8, 6.5, -6, 7]),
      P.front, P.outline, 2.4);
    // 炮管
    cfill(ctx, cpoly('g2_cannon_barrel', [8, -5.6, 17, -5.0, 17, 5.0, 8, 5.6]), P.mid, P.outline, 2);
    // 炮口
    cfill(ctx, cpoly('g2_cannon_muzzle', [16.4, -6.2, 19.2, -5.4, 19.2, 5.4, 16.4, 6.2]), P.light, P.outline, 1.6);
    ctx.fillStyle = P.deep;
    ctx.beginPath(); ctx.ellipse(18.2, 0, 1.2, 4.2, 0, 0, CHAR_TAU); ctx.fill();
    // 能量裂缝
    ctx.save();
    ctx.globalAlpha *= 0.45 + f * 0.35 + ch * 0.2;
    ctx.strokeStyle = P.core; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(2, -5.5); ctx.lineTo(0, -2); ctx.lineTo(3.5, 0); ctx.lineTo(1, 3.8); ctx.stroke();
    ctx.restore();
    // 炮口火花（真实发射时）
    if (f > 0.12) {
      cglow(ctx, 20 + f * 2.5, 0, 6.5 + f * 3, P.core, 0.5 * f);
      cfill(ctx, cpoly('g2_muzzle_flash', [19.5, 0, 24 + f * 3, -2.4, 22.5, 0, 24.6, 2.1]), '#ffd8ff', null);
    }
    // 肩甲下部装甲
    cfill(ctx, cpoly('g2_cannon_plate', [-4, 6.5, 5, 6.8, 5, 9.4, -5, 9]), P.back, null);
    ctx.restore();
  },
};

// ==== 角色 3：棱面司祭 =====================================================
const CHAR_PRIEST = {
  icon: { cx: 0, cy: -36, zoom: 0.97 },
  draw(ctx, P, a, o) {
    const side = a.side;
    const f = o.f;
    const nk = o.nk;
    const m = a.moveBlend;
    const breathe = Math.sin(a.time * 1.6) * 1.0 + m * 0.4;

    cshadow(ctx, 13, 2.8, o.mode === 'silhouette' ? 0.24 : 0.4);

    ctx.save();
    ctx.translate(0, breathe);
    ctx.scale(side, 1);
    if (m > 0.02) ctx.rotate(m * 0.03);

    // 后侧披肩（不对称）
    const mantle = cpoly('g3_mantle', [-15, -31, -2, -33, 2, -25, -5, -14, -11, -18, -16, -24]);
    cfill(ctx, mantle, P.front, P.outline, 2.2);
    cfill(ctx, cpoly('g3_mantle_hi', [-13, -29, -5, -30, -4, -23, -9, -18]), P.light, null);

    // 直线条祭衣
    const robe = cpoly('g3_robe', [-11, -31, 10, -31, 12, -16, 9, -5, 4, -2, 0, -5, -4, -2, -9, -5, -12, -16]);
    cfill(ctx, robe, P.mid, P.outline, 2.4);
    cfill(ctx, cpoly('g3_panel', [-6, -29, 0, -29, 0, -4, -3, -5]), P.front, null);
    cfill(ctx, cpoly('g3_panel2', [3, -29, 8, -29, 7, -6, 4, -4]), P.back, null);
    // 祭衣浅色饰带
    cstroke(ctx, cpoly('g3_trim', [-8, -27, -7, -8]), P.mask, 1.2, 0.55);
    cstroke(ctx, cpoly('g3_trim2', [7, -27, 6, -8]), P.mask, 1.2, 0.4);
    // 腰印
    cfill(ctx, cpoly('g3_belt_gem', [-1.4, -17, 1.4, -17, 0, -14.6]), P.core, null);

    // 头部 / 面具
    this._head(ctx, P, a, o, false);

    // 双手托印
    this._hands(ctx, P, a, o);

    // 悬浮冠片（不同相位）
    this._crowns(ctx, P, a, o);

    ctx.restore();
  },

  _head(ctx, P, a, o, icon) {
    // 棱角头巾 / 黑发轮廓
    cfill(ctx, cpoly('g3_hood', [-11, -34, -13, -44, -7, -52, 0, -55, 8, -51, 12, -43, 9, -34, 4, -30, -4, -30]),
      P.back, P.outline, 2.4);
    cfill(ctx, cpoly('g3_hood_hi', [-9, -45, -4, -52, 1, -53, -2, -46, -5, -39]), P.mid, null);

    // 菱形 / 棱面面具（浅灰紫）
    const mask = cpoly('g3_mask', [0, -53, -9, -44, -7, -33, 0, -29, 8, -34, 9, -44]);
    cfill(ctx, mask, P.mask, P.outline, 2.1);
    // 棱面分割
    cfill(ctx, cpoly('g3_mask_facet', [0, -53, -9, -44, -4, -42, 0, -36]), P.light, null);
    cfill(ctx, cpoly('g3_mask_facet2', [-4, -42, 0, -36, 2, -44]), P.front, null);
    // 单侧发光视缝
    drawSlit(ctx, [2.6, -43.6, 8.2, -42.4, 8.0, -40.6, 2.2, -41.7], P.eye, null);
    cglow(ctx, 5.2, -42, 5.5, P.accent, 0.28);
    // 面具中线
    cstroke(ctx, cpoly('g3_mask_line', [0, -52, 0, -30]), P.hand, 0.8, 0.45);

    if (icon) {
      cfill(ctx, cpoly('g3_icon_shoulder', [-18, -22, -10, -31, 9, -31, 18, -22, 14, -15, -14, -15]),
        P.back, P.outline, 2);
      cfill(ctx, cpoly('g3_icon_mantle', [-18, -23, -9, -27, 2, -24, -5, -17, -13, -18]),
        P.front, null);
    }
  },

  _hands(ctx, P, a, o) {
    const side = a.side;
    const f = o.f;
    const nk = o.nk;
    // 后手（托住印记）
    const bhx = side * -4.5;
    const bhy = -21.5;
    cfill(ctx, cpoly('g3_sleeve_b', [side * -10, -29, side * -5, -28, bhx + side * 1.5, bhy + 2, bhx - side * 1.5, bhy - 1]),
      P.back, P.outline, 1.5);
    // 前手（拨出印片）
    const push = 5.0 * f + 2.5 * nk;
    const fhx = side * 5 + Math.cos(a.aim) * push;
    const fhy = -21.0 + Math.sin(a.aim) * push;
    cfill(ctx, cpoly('g3_sleeve_f', [side * 9, -29, side * 12, -27, fhx + side * 1.5, fhy + 1.5, fhx - side * 2, fhy - 1]),
      P.front, P.outline, 1.5);

    // 简化浅灰紫手部
    const handPath = cpoly('g3_hand', [-2.2, -1.8, 2.0, -2.2, 2.8, 0.8, 0.8, 2.6, -2.4, 1.8]);
    ctx.save();
    ctx.translate(bhx, bhy);
    cfill(ctx, handPath, P.hand, P.outline, 1.1);
    ctx.restore();
    ctx.save();
    ctx.translate(fhx, fhy);
    ctx.rotate(Math.atan2(Math.sin(a.aim), Math.cos(a.aim)) * 0.15);
    cfill(ctx, handPath, P.hand, P.outline, 1.1);
    // 手指
    ctx.strokeStyle = P.hand; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(1.8, -1.4); ctx.lineTo(5.2, -2.6);
    ctx.moveTo(2.2, 0.2); ctx.lineTo(5.6, 0.2); ctx.stroke();
    ctx.restore();

    // 胸前 / 双手之间的菱形印片
    const sigX = side * 1.5 + Math.cos(a.aim) * push * 0.7;
    const sigY = -25.5 + Math.sin(a.aim) * push * 0.7;
    const pulse = 0.75 + Math.sin(a.time * 2.4) * 0.15 + nk * 0.4;
    ctx.save();
    ctx.globalAlpha *= Math.min(1, pulse);
    cfill(ctx, cpoly('g3_sigil', [0, -4.6, 3.1, 0, 0, 4.6, -3.1, 0]), P.core, P.outline, 1.2);
    cfill(ctx, cpoly('g3_sigil_in', [0, -2.4, 1.6, 0, 0, 2.4, -1.6, 0]), P.deep, null);
    cglow(ctx, 0, 0, 6.5, P.core, 0.35 + nk * 0.3);
    ctx.restore();

    // 拨出印片时的短促轨迹
    if (f > 0.15) {
      ctx.save();
      ctx.globalAlpha *= 0.45 * f;
      ctx.strokeStyle = P.accent; ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(sigX + Math.cos(a.aim) * 4, sigY + Math.sin(a.aim) * 4);
      ctx.lineTo(sigX + Math.cos(a.aim) * 12, sigY + Math.sin(a.aim) * 12);
      ctx.stroke();
      ctx.restore();
    }
  },

  _crowns(ctx, P, a, o) {
    const nk = o.nk;
    const bob1 = Math.sin(a.time * 1.7) * 1.6;
    const bob2 = Math.cos(a.time * 1.3 + 0.8) * 1.4;
    const c1x = -6.5 - nk * 1.2;
    const c2x = 7.0 + nk * 1.0;
    const c1y = -60 + bob1 - nk * 1.5;
    const c2y = -59 + bob2 - nk * 1.2;
    ctx.save();
    ctx.globalAlpha *= 0.8 + nk * 0.2;
    // 大冠片
    ctx.save(); ctx.translate(c1x, c1y); ctx.rotate(-0.32);
    cfill(ctx, cpoly('g3_crown1', [0, -4.8, 3.2, 0, 0, 4.8, -3.2, 0]), P.accent, P.outline, 1.2);
    cfill(ctx, cpoly('g3_crown1_in', [0, -2.6, 1.5, 0, 0, 2.6, -1.5, 0]), P.light, null);
    ctx.restore();
    // 小冠片
    ctx.save(); ctx.translate(c2x, c2y); ctx.rotate(0.5);
    cfill(ctx, cpoly('g3_crown2', [0, -3.4, 2.3, 0, 0, 3.4, -2.3, 0]), P.accent, P.outline, 1.1);
    cfill(ctx, cpoly('g3_crown2_in', [0, -1.8, 1.0, 0, 0, 1.8, -1.0, 0]), P.light, null);
    ctx.restore();
    if (nk > 0.2) {
      cglow(ctx, c1x, c1y, 7, P.accent, 0.3 * nk);
      cglow(ctx, c2x, c2y, 5, P.accent, 0.25 * nk);
    }
    ctx.restore();
  },
};

// ==== 角色 4：磁轨驭球者 ===================================================
const CHAR_RICOCHET = {
  icon: { cx: 0, cy: -35.5, zoom: 1.02 },
  draw(ctx, P, a, o) {
    const side = a.side;
    const f = o.f;
    const rk = o.rk;
    const m = a.moveBlend;
    const walk = a.walk;
    const step = Math.sin(walk) * m;
    const breath = Math.sin(a.time * 2.4) * 0.55;
    const ch = a.charge;
    const behind = Math.sin(a.aim) < -0.14;

    cshadow(ctx, 15, 3.2, o.mode === 'silhouette' ? 0.3 : 0.5);

    ctx.save();
    ctx.translate(0, breath + m * 0.4);
    ctx.scale(side, 1);
    if (m > 0.02) ctx.rotate(m * 0.03);

    // 灵活短腿
    const lb = -step * 1.4, lf = step * 1.4;
    const lift = Math.max(0, Math.sin(walk)) * m * 1.4;
    cfill(ctx, cpoly('g4_leg_b', [-7, -13, -2, -13, -3 + lb, -4, -8 + lb, -4]), P.back, P.outline, 1.8);
    cfill(ctx, cpoly('g4_boot_b', [-9, -5, -2, -5, -2 + lb, 0, -9 + lb, 0]), P.mid, P.outline, 1.8);
    cfill(ctx, cpoly('g4_leg_f', [2, -14, 7, -14, 8 + lf, -4, 3 + lf, -4]), P.front, P.outline, 1.8);
    cfill(ctx, cpoly('g4_boot_f', [2, -5, 9, -5, 9 + lf, 0 - lift, 2 + lf, 0 - lift]), P.front, P.outline, 1.8);

    // 后侧手臂
    climb(ctx, -8, -28, -10, -20, 3.0, P.back, P.outline, 1.8);

    // 短款衣装
    const jacket = cpoly('g4_jacket', [-10, -31, 9, -31, 9, -18, 4, -13, 0, -16, -5, -13, -10, -18]);
    cfill(ctx, jacket, P.mid, P.outline, 2.3);
    cfill(ctx, cpoly('g4_jacket_hi', [-8, -29, 0, -29, 1, -17, -6, -18]), P.front, null);
    // 衣领
    cfill(ctx, cpoly('g4_collar', [-8, -31, 0, -35, 8, -31, 5, -27, 0, -30, -5, -27]), P.front, P.outline, 1.4);
    // 胸前圆形蓝紫能量核
    const corePulse = 0.7 + Math.sin(a.time * 2.8) * 0.15 + ch * 0.45;
    ctx.save();
    ctx.globalAlpha *= Math.min(1, corePulse);
    ctx.fillStyle = P.core;
    ctx.beginPath(); ctx.arc(1, -24, 3.6, 0, CHAR_TAU); ctx.fill();
    ctx.strokeStyle = P.accent; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(1, -24, 4.6, 0, CHAR_TAU); ctx.stroke();
    ctx.fillStyle = '#dff4ff';
    ctx.beginPath(); ctx.arc(1, -24, 1.4, 0, CHAR_TAU); ctx.fill();
    cglow(ctx, 1, -24, 7 + ch * 3, P.core, 0.35 + ch * 0.3);
    ctx.restore();

    // 头部（上翘短发 / 护额 / 亮眼带）
    this._head(ctx, P, a, o, false);

    ctx.restore();

    // U 形磁轨护手（后方）
    if (behind) this._rail(ctx, P, a, o);

    // 空闲手（召回时抬起）
    this._freeHand(ctx, P, a, o);

    // U 形磁轨护手（前方）
    if (!behind) this._rail(ctx, P, a, o);
  },

  _head(ctx, P, a, o, icon) {
    // 颈部
    cfill(ctx, cpoly('g4_neck', [-4, -32, 4, -32, 4, -29, -4, -29]), P.deep, null);
    // 头
    cfill(ctx, cpoly('g4_head', [-8, -43, -5, -49, 2, -51, 8, -46, 9, -38, 4, -32, -4, -32, -8, -36]),
      P.mid, P.outline, 2.2);
    // 上翘黑紫短发（多个尖）
    const hair = cpoly('g4_hair', [
      -10, -42, -12, -50, -7, -48, -8, -56, -2, -51,
      1, -58, 4, -51, 10, -55, 9, -48, 15, -49, 10, -43,
      8, -46, 3, -47, -3, -47, -7, -45,
    ]);
    cfill(ctx, hair, P.back, P.outline, 2.2);
    cfill(ctx, cpoly('g4_hair_hi', [-7, -49, -4, -54, 0, -52, 1, -48, -3, -47]), P.light, null);
    // 紫色额部护具
    cfill(ctx, cpoly('g4_browplate', [-9, -43, -2, -46, 8, -43, 8, -39, -1, -38, -8, -40]),
      P.front, P.outline, 1.5);
    // 两侧耳甲
    cfill(ctx, cpoly('g4_ear', [-10, -40, -13, -38, -12, -33, -9, -34]), P.front, P.outline, 1.3);
    cfill(ctx, cpoly('g4_ear2', [9, -40, 12, -38, 11, -33, 8, -34]), P.front, P.outline, 1.3);
    // 弧形发光眼带
    ctx.save();
    ctx.strokeStyle = P.eye;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-6.5, -40.2);
    ctx.quadraticCurveTo(0, -36.8, 6.8, -40.2);
    ctx.stroke();
    ctx.globalAlpha *= 0.4;
    ctx.strokeStyle = P.accent;
    ctx.lineWidth = 4.4;
    ctx.beginPath();
    ctx.moveTo(-6.5, -40.2);
    ctx.quadraticCurveTo(0, -36.8, 6.8, -40.2);
    ctx.stroke();
    ctx.restore();
    // 嘴部 / 面罩
    cfill(ctx, cpoly('g4_mask', [-5, -34, 5, -34, 4, -31.5, -4, -31.5]), P.deep, null);

    if (icon) {
      cfill(ctx, cpoly('g4_icon_shoulder', [-17, -22, -9, -31, 9, -31, 17, -22, 13, -14, -13, -14]),
        P.back, P.outline, 2);
      cfill(ctx, cpoly('g4_icon_collar', [-14, -19, -8, -28, 8, -28, 14, -19, 9, -15, -9, -15]),
        P.front, null);
      // 胸口核心
      ctx.fillStyle = P.core;
      ctx.beginPath(); ctx.arc(0, -17, 2.6, 0, CHAR_TAU); ctx.fill();
      ctx.strokeStyle = P.accent; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, -17, 3.5, 0, CHAR_TAU); ctx.stroke();
    }
  },

  _freeHand(ctx, P, a, o) {
    const side = a.side;
    const rk = o.rk;
    const raised = rk > 0.08;
    const ax = side * -10;
    const ay = raised ? -27 - rk * 5 : -19;
    climb(ctx, side * -8, -29, ax, ay, 3.1, P.back, P.outline, 1.8);
    ctx.fillStyle = P.front;
    ctx.beginPath(); ctx.arc(ax, ay, 2.6, 0, CHAR_TAU); ctx.fill();
    ctx.strokeStyle = P.outline; ctx.lineWidth = 1.5; ctx.stroke();
    if (raised) {
      cglow(ctx, ax, ay - 2, 6.5, P.accent, 0.35 * rk);
      // 召回方向的短促牵引线（纯视觉，不生成装饰球）
      ctx.save();
      ctx.globalAlpha *= 0.45 * rk;
      ctx.strokeStyle = P.accent; ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(ax, ay - 4);
      ctx.lineTo(ax + side * 4, ay - 10);
      ctx.stroke();
      ctx.restore();
    }
  },

  _rail(ctx, P, a, o) {
    const side = a.side;
    const f = o.f;
    const ch = a.charge;
    const th = a.thunderK;
    const pull = ch * 2.4;
    ctx.save();
    ctx.translate(side * 10.5, -22.5);
    ctx.rotate(a.aim);
    ctx.translate(-pull - f * 1.4, 0);

    // 后段护手
    cfill(ctx, cpoly('g4_rail_back', [-5, -6, 2, -6, 2, 6, -5, 6]), P.mid, P.outline, 1.7);
    // 上叉
    cfill(ctx, cpoly('g4_rail_top', [0.5, -6.6, 13, -6.2, 15.5, -3.8, 14.6, -1.8, 1, -2]), P.front, P.outline, 1.7);
    // 下叉
    cfill(ctx, cpoly('g4_rail_bottom', [0.5, 6.6, 13, 6.2, 15.5, 3.8, 14.6, 1.8, 1, 2]), P.front, P.outline, 1.7);
    // 中间开口（明确保留）：不画任何封闭枪管
    // 叉内亮边
    ctx.save();
    ctx.globalAlpha *= 0.65 + ch * 0.35;
    cfill(ctx, cpoly('g4_rail_line_t', [2, -4.7, 12.6, -4.4, 13.6, -3.7, 2, -3.8]), P.accent, null);
    cfill(ctx, cpoly('g4_rail_line_b', [2, 4.7, 12.6, 4.4, 13.6, 3.7, 2, 3.8]), P.accent, null);
    ctx.restore();
    // 开口处的能量弧（只是发射口局部光效）
    if (ch > 0.05 || f > 0.1 || th > 0.1) {
      const k = Math.max(ch * 0.8, f, th);
      cglow(ctx, 12, 0, 4.5 + k * 4, th > 0.1 ? '#9fe8ff' : P.accent, 0.45 * k);
    }
    // 蓝白电弧
    if (th > 0.1) {
      ctx.save();
      ctx.globalAlpha *= 0.7 * th;
      ctx.strokeStyle = '#bff4ff'; ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(6, -2); ctx.lineTo(9, -3.6); ctx.lineTo(11.8, -1.2); ctx.lineTo(14.4, -2.8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(5, 2.2); ctx.lineTo(8.4, 3.6); ctx.lineTo(11, 1.4);
      ctx.stroke();
      ctx.restore();
    }
    // 手腕
    ctx.fillStyle = P.hand;
    ctx.beginPath(); ctx.arc(-1, 0, 3.0, 0, CHAR_TAU); ctx.fill();
    ctx.strokeStyle = P.outline; ctx.lineWidth = 1.5; ctx.stroke();

    if (f > 0.12) {
      // 实际发射时的短促出射轨迹（沿真实方向）
      ctx.save();
      ctx.globalAlpha *= 0.55 * f;
      ctx.strokeStyle = P.accent; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(22 + f * 4, 0);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  },
};

const CHAR_DEFS = {
  0: CHAR_GUNNER,
  1: CHAR_MAGE,
  2: CHAR_WARRIOR,
  3: CHAR_PRIEST,
  4: CHAR_RICOCHET,
};

// ── 统一渲染入口 ────────────────────────────────────────────────────────────
const Characters = {
  DESIGN_HEIGHT: CHAR_DESIGN_H,
  VISUAL_HEIGHT: 62,
  PALETTES: { portrait: CHAR_PALETTES, battle: CHAR_BATTLE_PALETTES },
  DEFS: CHAR_DEFS,

  // 局内实际可见高度（设计单位 → CSS 像素）
  visualTop(genre, height) {
    const g = CHAR_VISUAL_TOPS[genre] ? genre : 0;
    return CHAR_VISUAL_TOPS[g] * ((height || this.VISUAL_HEIGHT) / CHAR_DESIGN_H);
  },

  createAnim(genre, aim) {
    return new CharacterAnim(genre, aim);
  },

  // 全身绘制（局内 / 卡片剪影共用）
  draw(ctx, genre, anim, x, y, opts) {
    const o = opts || {};
    const g = CHAR_DEFS[genre] ? genre : 0;
    const def = CHAR_DEFS[g];
    const mode = o.mode || 'battle';
    const P = charPalette(g, mode);
    const height = o.height || this.VISUAL_HEIGHT;
    const k = (height / CHAR_DESIGN_H) * (o.scale || 1);
    if (!anim) anim = this.createAnim(g, o.aim != null ? o.aim : -Math.PI / 2);
    const prevSil = ctx._charSilhouette;
    const prevBattle = ctx._charBattle;
    ctx._charSilhouette = mode === 'silhouette';
    ctx._charBattle = mode === 'battle';
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    def.draw(ctx, P, anim, {
      mode,
      f: Math.min(1, anim.firePulse),
      sk: anim.skillK,
      rk: anim.recallK,
      spk: anim.spawnK,
      nk: anim.nodeK,
      shellPct: o.shellPct || 0,
    });
    ctx.restore();
    ctx._charSilhouette = prevSil;
    ctx._charBattle = prevBattle;
  },

  // 头肩像（ICON 用）
  drawHead(ctx, genre, x, y, size, opts) {
    const o = opts || {};
    const g = CHAR_DEFS[genre] ? genre : 0;
    const def = CHAR_DEFS[g];
    const mode = o.mode || 'portrait';
    const P = charPalette(g, mode);
    const ic = def.icon || { cx: 0, cy: -40, zoom: 1.3 };
    const anim = o.anim || this.createAnim(g, -Math.PI / 2);
    const s = (size / 44) * ic.zoom;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.translate(-ic.cx, -ic.cy);
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    // 头肩像背后的极淡流派色光，帮助深色角色在深色卡片上分离（背景仍透明）
    cglow(ctx, 0, -34, 25, P.accent, 0.12);
    def._head(ctx, P, anim, {
      mode,
      f: Math.min(1, anim.firePulse),
      sk: anim.skillK,
      rk: anim.recallK,
      spk: anim.spawnK,
      nk: anim.nodeK,
    }, true);
    ctx.restore();
  },

  // 卡片右侧完整剪影
  drawSilhouette(ctx, genre, x, y, size, opts) {
    const o = Object.assign({}, opts, { mode: 'silhouette', height: size });
    this.draw(ctx, genre, o.anim, x, y, o);
  },
};

// ── 选择卡：ICON 与右侧剪影（独立展示状态，不运行战斗逻辑）──────────────────
const CharacterUI = {
  inited: false,
  running: false,
  items: [],
  raf: 0,
  _last: 0,
  _uiTime: 0,

  init() {
    if (this.inited) return;
    const cards = document.querySelectorAll('.genre-card');
    if (!cards.length) return;
    this.items = [];
    const pushItem = (genre, card) => {
      const icon = card.querySelector('.genre-icon');
      const sil = card.querySelector('.genre-silhouette');
      if (!icon || !sil) return;
      const anim = new CharacterAnim(genre, Math.PI);
      anim.showcase = true;
      const item = {
        genre, card, icon, sil,
        anim,
        iconCtx: icon.getContext('2d'),
        silCtx: sil.getContext('2d'),
        hover: false,
        iconW: 44, iconH: 44,
        silW: 0, silH: 0,
      };
      this.items.push(item);
      card.addEventListener('mouseenter', () => {
        item.hover = true;
        item.anim.triggerFire('showcase', Math.PI - 0.3);
      });
      card.addEventListener('mouseleave', () => { item.hover = false; });
      card.addEventListener('focus', () => {
        item.hover = true;
        item.anim.triggerFire('showcase', Math.PI - 0.3);
      });
      card.addEventListener('blur', () => { item.hover = false; });
      card.addEventListener('keydown', (e) => {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          if (typeof Game !== 'undefined') Game.selectGenre(genre);
        }
      });
    };
    cards.forEach((card, i) => {
      const icon = card.querySelector('.genre-icon');
      const genre = icon && icon.dataset.charIcon != null ? +icon.dataset.charIcon : i;
      pushItem(genre, card);
    });
    this.inited = true;
    this._resizeAll();
    this._drawFrame(0);
    window.addEventListener('resize', () => this._resizeAll());
  },

  _setupCanvas(canvas, w, h, dpr) {
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  },

  _resizeAll() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const it of this.items) {
      const ir = it.icon.getBoundingClientRect();
      const sr = it.sil.getBoundingClientRect();
      it.iconW = ir.width || 44;
      it.iconH = ir.height || 44;
      it.silW = sr.width || 100;
      it.silH = sr.height || 200;
      it.iconCtx = this._setupCanvas(it.icon, it.iconW, it.iconH, dpr);
      it.silCtx = this._setupCanvas(it.sil, it.silW, it.silH, dpr);
    }
  },

  show() {
    if (!this.inited) this.init();
    if (!this.inited) return;
    // 选择界面此时才可见，重新测量真实尺寸（避免隐藏状态下拿到 0 尺寸）
    this._resizeAll();
    this.running = true;
    this._last = performance.now();
    if (!this.raf) this.raf = requestAnimationFrame(t => this._loop(t));
  },

  hide() {
    this.running = false;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  },

  _loop(t) {
    if (!this.running) { this.raf = 0; return; }
    const dt = Math.min(0.05, (t - this._last) / 1000 || 0);
    this._last = t;
    this._uiTime += dt;
    for (const it of this.items) {
      const aim = Math.PI + Math.sin(this._uiTime * 0.7 + it.genre) * 0.04;
      it.anim.update(dt, { moving: false, aimAngle: aim });
      this._drawItem(it);
    }
    this.raf = requestAnimationFrame(tt => this._loop(tt));
  },

  _drawItem(it) {
    const iconCtx = it.iconCtx;
    const silCtx = it.silCtx;
    if (!iconCtx || !silCtx) return;
    iconCtx.clearRect(0, 0, it.iconW, it.iconH);
    silCtx.clearRect(0, 0, it.silW, it.silH);

    // 图标：头肩像，透明背景
    Characters.drawHead(iconCtx, it.genre, it.iconW / 2, it.iconH * 0.55, Math.min(it.iconW, it.iconH) * 0.98, {
      anim: it.anim,
    });

    // 右侧完整剪影：脚底贴近画布底部，朝文字方向（左）
    Characters.drawSilhouette(silCtx, it.genre, it.silW * 0.53, it.silH * 0.96, it.silH * 0.83, {
      anim: it.anim,
    });
  },

  _drawFrame() {
    for (const it of this.items) this._drawItem(it);
  },
};

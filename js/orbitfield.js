// ─── 暗影轨道场（Shadow Orbit Field）· 纯视觉层 ──────────────────────────────
// 弹射流「以玩家为中心的圆形弹球活动区域」可视化：
//   弹球在场内直线运动、撞边界反弹、场随玩家移动——本模块只负责"看得见"，不改物理。
// 禁止在本文件引入：引力吸附、弹球公转、敌人拉拽、伤害、元素充能、边界蓄能、爆点全屏闪光。
// 视觉半径恒等于 CONFIG.RICOCHET.BOUNDARY_RADIUS（visualRadius === collisionRadius）。
// 渲染顺序：远景场线 / 主边界 → 敌人层 → 弹球 / 玩家 → 撞击局部反馈（renderOverlay）。

const OrbitField = {
  // 中心（世界坐标，每帧同步玩家位置；playerFollowSpeed 为瞬时跟随）
  cx: 0, cy: 0,
  radius: 360,

  // 自转相位
  rotation: 0,           // 主断裂弧
  secondaryRotation: 0,  // 次级椭圆轨道（反向）
  fieldRotation: 0,      // 引力场线
  time: 0,

  // 状态
  active: false,
  pulseTimer: 0,         // 雷霆球出现时的一次性紫色脉冲
  tutorialTimer: 0,      // 首次登场整环亮起（剩余秒）
  tutorialWave: 0,       // 首次登场扩散轨道波（>0 进行中）
  introSpark: -1,        // 沿边界滑行一次的引导光点（-1 未激活）
  _thunderEdge: false,   // 雷霆球沿检测（边沿触发脉冲）
  _flowSpeed: 1,         // 场线 / 星尘流速（随弹球速度轻微加快）

  // 固定结构（初始化一次，避免每帧分配）
  _segs: [],             // 主边界断裂弧段 {a0, len, speed, alpha, width, dash}
  _orbits: [],           // 次级椭圆 {a, b, tilt, speed, alpha, glow, glowT}
  _lines: [],            // 引力场线（单位空间折线点列）
  _particles: [],        // 轨道星尘（固定池）
  _impacts: [],          // 撞击反馈（上限 maxImpactRings）
  _softs: [],            // 安全校正柔和波纹（上限 4）
  _launchRifts: [],      // 蓄能发射裂光（上限 3）
  _initialized: false,

  // ── 初始化 / 清理 ──────────────────────────────────────────────────
  init() {
    if (this._initialized) return;
    this._initialized = true;
    const cfg = CONFIG.ORBIT_FIELD;
    const rnd = (min, max) => min + Math.random() * (max - min);

    // 主边界断裂弧段：长度 / 透明度 / 转速各不相同，部分反向运动
    this._segs.length = 0;
    const n = cfg.boundarySegmentCount;
    for (let i = 0; i < n; i++) {
      this._segs.push({
        a0: (i / n) * Math.PI * 2 + rnd(-0.18, 0.18),
        len: rnd(0.55, 1.25),
        speed: cfg.baseRotationSpeed * (i % 2 === 0 ? rnd(0.6, 1.1) : -rnd(0.5, 0.9)),
        alpha: cfg.baseAlpha * rnd(0.7, 1.25),
        width: rnd(2.0, 3.2),
        dash: i % 2 === 1,          // 隔段虚线边缘，制造"断裂感"
      });
    }

    // 次级椭圆轨道：不同倾角、不同扁率，纯视觉参考线
    this._orbits.length = 0;
    for (let i = 0; i < cfg.secondaryOrbitCount; i++) {
      this._orbits.push({
        a: 1 - i * 0.16,            // 相对半径（乘以 radius）
        b: (1 - i * 0.16) * (0.42 + i * 0.09),
        tilt: rnd(0, Math.PI),
        speed: cfg.secondaryRotationSpeed * (0.7 + i * 0.25),
        alpha: 0.09 + i * 0.015,
        glow: 0,                    // 弹球经过时的短暂增亮
        glowT: 0,
      });
    }

    // 引力场线：中心密、向外稀疏、接近边界断开（单位空间预生成）
    this._lines.length = 0;
    const lc = 12;
    for (let i = 0; i < lc; i++) {
      const a0 = (i / lc) * Math.PI * 2 + rnd(-0.12, 0.12);
      const bend = rnd(-0.55, 0.55);            // 轻微弯折，不闭合
      const tMax = rnd(0.62, 0.95);             // 外端不到边界即断开
      const pts = [];
      const steps = 7;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const ang = a0 + bend * t * t;
        const dist = 0.24 + Math.pow(t, 0.85) * tMax;
        pts.push({ x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, t: t });
      }
      this._lines.push({ pts: pts, alpha: rnd(0.05, 0.10), phase: rnd(0, Math.PI * 2) });
    }

    // 轨道星尘：固定池，绕中心缓慢偏转、向外扩散再收缩
    this._particles.length = 0;
    for (let i = 0; i < cfg.particleCount; i++) {
      this._particles.push({
        ang: rnd(0, Math.PI * 2),
        dist: rnd(0.22, 0.96),
        spd: rnd(0.05, 0.16) * (Math.random() < 0.5 ? 1 : -1),
        size: rnd(1.0, 2.2),
        alpha: rnd(0.05, 0.13),
        phase: rnd(0, Math.PI * 2),
      });
    }
  },

  clear() {
    this._impacts.length = 0;
    this._softs.length = 0;
    this._launchRifts.length = 0;
    this.pulseTimer = 0;
    this.tutorialTimer = 0;
    this.tutorialWave = 0;
    this.introSpark = -1;
    this._thunderEdge = false;
    this.active = false;
    this._hideHint();
  },

  // ── 一次性教学提示（首次进入弹射流；不暂停、不遮挡战斗）────────────────
  showTutorial() {
    this.init();
    let shown = false;
    try { shown = window.localStorage.getItem('shadow_orbit_hint_v1') === '1'; } catch (e) { shown = this._hintShown; }
    if (shown || this._hintShown) return;
    this._hintShown = true;
    try { window.localStorage.setItem('shadow_orbit_hint_v1', '1'); } catch (e) { /* 忽略存储失败 */ }

    this.tutorialTimer = CONFIG.ORBIT_FIELD.tutorialDuration / 1000;
    this.tutorialWave = 1;
    this.introSpark = 0;

    const el = document.getElementById('hud-orbit-hint');
    if (el) {
      el.classList.remove('hidden');
      clearTimeout(this._hintT1);
      clearTimeout(this._hintT2);
      this._hintT1 = setTimeout(() => el.classList.add('fade'), CONFIG.ORBIT_FIELD.tutorialTextDuration - 600);
      this._hintT2 = setTimeout(() => this._hideHint(), CONFIG.ORBIT_FIELD.tutorialTextDuration);
    }
  },

  _hideHint() {
    const el = document.getElementById('hud-orbit-hint');
    if (el) el.classList.add('hidden');
  },

  // ── 边界撞击反馈（真实边界碰撞统一入口；纯视觉，无任何玩法副作用）──────────
  registerImpact(x, y, nx, ny) {
    this.init();
    const cfg = CONFIG.ORBIT_FIELD;
    if (this._impacts.length >= cfg.maxImpactRings) this._impacts.shift();
    this._impacts.push({
      ang: Math.atan2(ny, nx),
      t: 0,
      life: cfg.impactDuration / 1000,
      seed: Math.random() * Math.PI * 2,
      cracks: 2 + Math.floor(Math.random() * 3),   // 2~4 条短促裂线
      parts: 4 + Math.floor(Math.random() * 3),    // 4~6 粒向内暗影尘
    });
  },

  // 安全校正 / 安全回收：柔和紫色回收效果（不表现成正常边界撞击）
  registerSafeRecall(x, y) {
    this.init();
    if (this._softs.length >= 4) this._softs.shift();
    const dx = x - this.cx, dy = y - this.cy;
    this._softs.push({
      x: x, y: y,
      ang: Math.atan2(dy, dx),
      t: 0,
      life: CONFIG.ORBIT_FIELD.safeCorrectionDuration / 1000,
    });
  },

  // 蓄能球发射反馈：沿发射方向的短暂蓝紫裂光（纯视觉，不造成伤害、不改边界）
  registerLaunch(ang) {
    this.init();
    if (this._launchRifts.length >= 3) this._launchRifts.shift();
    this._launchRifts.push({ ang: ang, t: 0, life: 0.3 });
  },

  // ── 每帧更新（game._update 在流派 4 时调用）────────────────────────────
  update(dt, state) {
    this.init();
    const cfg = CONFIG.ORBIT_FIELD;
    this.time += dt;
    this.active = true;

    // 中心瞬时跟随玩家（与真实碰撞中心同一坐标）
    const p = state.player;
    this.cx = p.x;
    this.cy = p.y;
    this.radius = CONFIG.RICOCHET.BOUNDARY_RADIUS;   // 恒等于碰撞半径

    // 弹球状态 → 视觉状态（不改物理）
    const balls = RicochetManager.balls;
    const nBall = balls.length;
    let spdSum = 0, conductive = false, thunder = false;
    for (let i = 0; i < nBall; i++) {
      const b = balls[i];
      spdSum += Math.hypot(b.vx, b.vy);
      if (b.conductive) conductive = true;
      if (b.state === 'thunderBall' || b.state === 'thunderCore') thunder = true;
    }
    const spdRef = CONFIG.RICOCHET.BALL_SPEED;
    const spdFactor = nBall > 0 ? Math.min(1.5, (spdSum / nBall) / spdRef) : 1;
    this._flowSpeed += ((0.9 + (spdFactor - 1) * 0.8) - this._flowSpeed) * Math.min(1, dt * 3);
    this._conductiveAccent = conductive;
    this._thunderAccent = thunder;

    // 雷霆球出现：沿检测触发一次紫色脉冲；期间弧线轻微展开（仅视觉，半径不变）
    if (thunder && !this._thunderEdge) this.pulseTimer = 0.6;
    this._thunderEdge = thunder;
    if (this.pulseTimer > 0) this.pulseTimer -= dt;

    // 自转
    this.rotation += dt * cfg.baseRotationSpeed * 6 * this._flowSpeed;
    this.secondaryRotation += dt * cfg.secondaryRotationSpeed * 6;
    this.fieldRotation += dt * cfg.fieldLineSpeed * 6 * this._flowSpeed;

    // 次级轨道增亮衰减（弹球经过时短暂变亮）
    for (let i = 0; i < this._orbits.length; i++) {
      const o = this._orbits[i];
      const rOrbit = this.radius * o.a;
      let touched = false;
      for (let k = 0; k < nBall; k++) {
        const b = balls[k];
        const d = Math.hypot(b.x - this.cx, b.y - this.cy);
        if (Math.abs(d - rOrbit) < 26) { touched = true; break; }
      }
      if (touched) o.glowT = 0.35;
      else if (o.glowT > 0) o.glowT -= dt;
      o.glow += ((touched ? 1 : 0) - o.glow) * Math.min(1, dt * 8);
    }

    // 星尘：绕中心缓慢偏转 + 向外扩散再收缩
    for (let i = 0; i < this._particles.length; i++) {
      const pt = this._particles[i];
      pt.ang += dt * pt.spd * this._flowSpeed;
    }

    // 撞击反馈寿命
    for (let i = this._impacts.length - 1; i >= 0; i--) {
      const im = this._impacts[i];
      im.t += dt;
      if (im.t >= im.life) this._impacts.splice(i, 1);
    }
    // 安全校正柔和波纹寿命
    for (let i = this._softs.length - 1; i >= 0; i--) {
      const sf = this._softs[i];
      sf.t += dt;
      if (sf.t >= sf.life) this._softs.splice(i, 1);
    }
    // 发射裂光寿命
    for (let i = this._launchRifts.length - 1; i >= 0; i--) {
      const lr = this._launchRifts[i];
      lr.t += dt;
      if (lr.t >= lr.life) this._launchRifts.splice(i, 1);
    }

    // 首次登场
    if (this.tutorialTimer > 0) this.tutorialTimer -= dt;
    if (this.tutorialWave > 0) this.tutorialWave = Math.max(0, this.tutorialWave - dt / 1.2);
    if (this.introSpark >= 0) {
      this.introSpark += dt / 0.8;
      if (this.introSpark > 1) this.introSpark = -1;
    }
  },

  // ── 场主体渲染（远景场线 / 主边界 / 次级轨道 / 中心核心；敌人层之下）────────
  render(ctx, cam, state) {
    this.init();
    const cfg = CONFIG.ORBIT_FIELD;
    const sx = this.cx - cam.x + cam.sw / 2;
    const sy = this.cy - cam.y + cam.sh / 2;
    const R = this.radius;

    // 大幅出屏时跳过（轨道场随玩家，基本恒在屏内；防御一下）
    if (sx < -R - 60 || sy < -R - 60 || sx > cam.sw + R + 60 || sy > cam.sh + R + 60) return;

    const intro = this.tutorialTimer > 0 ? this.tutorialTimer / (cfg.tutorialDuration / 1000) : 0;
    const pulse = this.pulseTimer > 0 ? this.pulseTimer / 0.6 : 0;

    this._drawFieldLines(ctx, sx, sy, R);
    this._drawCore(ctx, sx, sy, R);
    this._drawSecondaryOrbits(ctx, sx, sy, R);
    this._drawBoundary(ctx, sx, sy, R, intro, pulse, state);
    this._drawOuterRings(ctx, sx, sy, R);
    if (this.tutorialWave > 0) this._drawTutorialWave(ctx, sx, sy, R);
    if (this.introSpark >= 0) this._drawIntroSpark(ctx, sx, sy, R);
    this._drawParticles(ctx, sx, sy, R);
  },

  // ── 撞击局部反馈（玩家 / 弹球之上；只在碰撞点附近，无全屏闪光、无震屏）────
  renderOverlay(ctx, cam, state) {
    const cfg = CONFIG.ORBIT_FIELD;
    const sx = this.cx - cam.x + cam.sw / 2;
    const sy = this.cy - cam.y + cam.sh / 2;
    const R = this.radius;
    if (this._impacts.length === 0 && this._softs.length === 0 && this._launchRifts.length === 0) return;

    // 蓄能发射裂光：沿方向的短暂蓝紫裂痕（不造成伤害）
    for (let i = 0; i < this._launchRifts.length; i++) {
      const lr = this._launchRifts[i];
      const k = lr.t / lr.life;
      const fade = 1 - k;
      ctx.save();
      ctx.strokeStyle = 'rgba(157,104,255,' + (0.4 * fade).toFixed(3) + ')';
      ctx.lineWidth = 3.2 * (1 - k) + 0.8;
      ctx.lineCap = 'round';
      const a0 = R * 0.12 + k * R * 0.25;
      const a1 = R * 0.55 + k * R * 0.45;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(lr.ang) * a0, sy + Math.sin(lr.ang) * a0);
      ctx.lineTo(sx + Math.cos(lr.ang) * a1, sy + Math.sin(lr.ang) * a1);
      ctx.stroke();
      ctx.restore();
    }

    // 撞击：局部弧段变亮 + 涟漪向两侧传播 + 短裂线 + 向内暗影尘
    for (let i = 0; i < this._impacts.length; i++) {
      const im = this._impacts[i];
      const k = im.t / im.life;                 // 0 → 1
      const fade = 1 - k;
      const a = im.ang;

      // 接触点聚光：局部弧段瞬间变亮（少量白色只出现在最初瞬间）
      const spread = 0.12 + k * 0.23;
      ctx.save();
      ctx.lineCap = 'round';
      const headMix = Math.max(0, 1 - k * 4);   // 仅前 25% 生命带白
      if (headMix > 0) {
        ctx.strokeStyle = 'rgba(232,216,255,' + (0.35 * headMix * fade).toFixed(3) + ')';
        ctx.lineWidth = 3.2;
        this._arc(ctx, sx, sy, R, a - spread * 0.5, a + spread * 0.5);
      }
      ctx.strokeStyle = 'rgba(178,107,255,' + (cfg.impactAlpha * 0.55 * fade).toFixed(3) + ')';
      ctx.lineWidth = 2.4;
      this._arc(ctx, sx, sy, R, a - spread, a + spread);

      // 涟漪沿边界向两侧传播（局部弯曲 + 能量回弹感）
      const travel = (cfg.impactRippleSpeed * im.t) / R;
      for (let s = -1; s <= 1; s += 2) {
        const ca = a + s * travel;
        const ta = 0.10 + 0.05 * fade;
        ctx.strokeStyle = 'rgba(81,217,255,' + (0.4 * fade * fade).toFixed(3) + ')';
        ctx.lineWidth = 1.6;
        this._arc(ctx, sx, sy, R, ca - ta, ca + ta);
        ctx.strokeStyle = 'rgba(157,104,255,' + (0.3 * fade * fade).toFixed(3) + ')';
        this._arc(ctx, sx, sy, R * 0.985, ca - ta * 0.7, ca + ta * 0.7);
      }

      // 2~4 条短促紫青裂线（径向，瞬间出现快速消散）
      const crackFade = fade * fade;
      for (let c = 0; c < im.cracks; c++) {
        const ca = a + Math.sin(im.seed * (c + 1)) * 0.28;
        const inner = R * (0.955 - 0.02 * c);
        const outer = R * (1.02 + 0.012 * ((c % 2) + 1));
        ctx.strokeStyle = 'rgba(81,217,255,' + (0.5 * crackFade).toFixed(3) + ')';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(ca) * inner, sy + Math.sin(ca) * inner);
        ctx.lineTo(sx + Math.cos(ca) * outer, sy + Math.sin(ca) * outer);
        ctx.stroke();
      }

      // 少量向内飞散的暗影粒子（数量固定，上限由 maxAdditiveParticles 控制）
      const innerFade = fade * 0.8;
      for (let q = 0; q < im.parts; q++) {
        const qa = a + Math.sin(im.seed * 2.7 + q * 1.7) * 0.22;
        const prog = Math.min(1, k * 1.3 + q * 0.06);
        const rr = R * (1.01 - 0.16 * prog);
        ctx.fillStyle = 'rgba(157,104,255,' + (0.5 * innerFade * (1 - prog * 0.7)).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(sx + Math.cos(qa) * rr, sy + Math.sin(qa) * rr, 1.6 + (q % 2) * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 安全校正柔和回收：低亮度波纹 + 紫色拖影光斑（无白色闪光）
    for (let i = 0; i < this._softs.length; i++) {
      const sf = this._softs[i];
      const k = sf.t / sf.life;
      const fade = 1 - k;
      const px = sf.x - cam.x + cam.sw / 2;
      const py = sf.y - cam.y + cam.sh / 2;
      ctx.save();
      // 弹球周围短暂紫色拖影
      ctx.fillStyle = 'rgba(110,54,201,' + (0.22 * fade).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(px, py, 12 + k * 16, 0, Math.PI * 2);
      ctx.fill();
      // 边界低亮度波纹
      ctx.strokeStyle = 'rgba(110,54,201,' + (0.16 * fade).toFixed(3) + ')';
      ctx.lineWidth = 1.6;
      this._arc(ctx, sx, sy, R, sf.ang - 0.16, sf.ang + 0.16);
      ctx.restore();
    }
  },

  // ── 内部绘制 ────────────────────────────────────────────────────────

  // 引力场线：中心密、向外稀疏、近边界断开；绕中心缓慢流动
  _drawFieldLines(ctx, sx, sy, R) {
    ctx.save();
    ctx.lineCap = 'round';
    const rot = this.fieldRotation;
    for (let i = 0; i < this._lines.length; i++) {
      const ln = this._lines[i];
      const pts = ln.pts;
      const wob = Math.sin(this.time * 0.7 + ln.phase) * 0.02;
      ctx.strokeStyle = 'rgba(110,54,201,' + ln.alpha.toFixed(3) + ')';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (let s = 0; s < pts.length; s++) {
        const pt = pts[s];
        const ang = rot + wob;
        const cos = Math.cos(ang), sin = Math.sin(ang);
        const x = sx + (pt.x * cos - pt.y * sin) * R;
        const y = sy + (pt.x * sin + pt.y * cos) * R;
        if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  },

  // 中心引力核心：脚下不规则暗影斑块 + 内层引力纹 + 微弱紫色脉动（不遮挡玩家）
  _drawCore(ctx, sx, sy, R) {
    const t = this.time;
    ctx.save();
    // 外层不规则暗影斑块（3 块缓慢反向漂移的深色圆，制造非标准圆阴影）
    const blobs = [
      { r: R * 0.20, ox: Math.cos(t * 0.35) * 9, oy: Math.sin(t * 0.31) * 7 },
      { r: R * 0.16, ox: Math.cos(t * 0.27 + 2.1) * 12, oy: Math.sin(t * 0.33 + 1.3) * 9 },
      { r: R * 0.13, ox: Math.cos(t * 0.42 + 4.0) * 8, oy: Math.sin(t * 0.25 + 3.2) * 11 },
    ];
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      const g = ctx.createRadialGradient(sx + b.ox, sy + b.oy, b.r * 0.15, sx + b.ox, sy + b.oy, b.r);
      g.addColorStop(0, 'rgba(22,11,56,0.42)');
      g.addColorStop(1, 'rgba(9,5,28,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx + b.ox, sy + b.oy, b.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 内层微弱引力纹（两道短弧，缓慢反向）
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(110,54,201,0.12)';
    ctx.lineWidth = 1.6;
    this._arc(ctx, sx, sy, R * 0.16, t * 0.22, t * 0.22 + 1.9);
    ctx.strokeStyle = 'rgba(81,217,255,0.08)';
    this._arc(ctx, sx, sy, R * 0.11, -t * 0.3, -t * 0.3 + 1.5);

    // 中心轻微紫色脉动（极弱，不把玩家画成漩涡中心）
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.1);
    ctx.strokeStyle = 'rgba(157,104,255,' + (0.05 + 0.05 * pulse).toFixed(3) + ')';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(sx, sy, R * 0.06 + pulse * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },

  // 次级引力轨道：椭圆断弧（纯视觉参考线，不吸附、不碰撞）
  _drawSecondaryOrbits(ctx, sx, sy, R) {
    ctx.save();
    for (let i = 0; i < this._orbits.length; i++) {
      const o = this._orbits[i];
      const tilt = o.tilt + this.secondaryRotation * (1 + i * 0.15);
      const a = R * o.a, b = R * o.b;
      const alpha = Math.min(CONFIG.ORBIT_FIELD.maxRenderAlpha, o.alpha + o.glow * 0.22);
      // 两段断弧，不画完整椭圆
      const base = this.secondaryRotation * 0.6 + o.tilt;
      for (let s = 0; s < 2; s++) {
        const start = base + s * Math.PI + 0.25;
        const end = start + Math.PI * 0.62;
        ctx.strokeStyle = (s === 0 ? 'rgba(157,104,255,' : 'rgba(81,217,255,') + alpha.toFixed(3) + ')';
        ctx.lineWidth = 1.2 + o.glow * 0.9;
        ctx.beginPath();
        ctx.ellipse(sx, sy, a, b, tilt, start, end);
        ctx.stroke();
      }
    }
    ctx.restore();
  },

  // 主轨道边界：3~5 段断裂紫弧（各自转速、部分反向）+ 容量刻痕 + 局部增亮
  _drawBoundary(ctx, sx, sy, R, intro, pulse, state) {
    const cfg = CONFIG.ORBIT_FIELD;
    const Rv = R + pulse * 6;                     // 雷霆脉冲：弧线短暂向外展开（半径不变）
    ctx.save();
    ctx.lineCap = 'round';

    // 极淡整圆轮廓（只给形状可读性，不是发光标准圆）
    ctx.strokeStyle = 'rgba(110,54,201,' + (0.05 + intro * 0.13).toFixed(3) + ')';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sx, sy, Rv, 0, Math.PI * 2);
    ctx.stroke();

    // 断裂弧段
    const balls = RicochetManager.balls;
    for (let i = 0; i < this._segs.length; i++) {
      const seg = this._segs[i];
      const a0 = seg.a0 + this.rotation * seg.speed * 6;
      const a1 = a0 + seg.len;
      // 弹球靠近该弧段所在方向时局部变亮
      let boost = 0;
      for (let k = 0; k < balls.length; k++) {
        const b = balls[k];
        const ba = Math.atan2(b.y - this.cy, b.x - this.cx);
        let d = ba - (a0 + seg.len / 2);
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        if (Math.abs(d) < seg.len * 0.6 + 0.25) boost = Math.max(boost, 0.14);
      }
      const alpha = Math.min(cfg.maxRenderAlpha,
        seg.alpha + boost + intro * 0.4 + pulse * 0.12);
      ctx.strokeStyle = 'rgba(157,104,255,' + alpha.toFixed(3) + ')';
      ctx.lineWidth = seg.width + pulse * 0.8;
      if (seg.dash) ctx.setLineDash([16, 7, 9, 5]); else ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(sx, sy, Rv, a0, a1);
      ctx.stroke();
      ctx.setLineDash([]);

      // 青紫轨道刻痕（弧段边缘的小切口）
      const notchA = a0 + seg.len * (0.35 + (i % 3) * 0.18);
      ctx.strokeStyle = 'rgba(81,217,255,' + (alpha * 0.8).toFixed(3) + ')';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(notchA) * (Rv - 5), sy + Math.sin(notchA) * (Rv - 5));
      ctx.lineTo(sx + Math.cos(notchA) * (Rv + 4), sy + Math.sin(notchA) * (Rv + 4));
      ctx.stroke();
    }

    // 容量刻痕：少量短刻线暗示当前弹球数量（达上限时更细密）
    const nBall = balls.length;
    if (nBall > 0) {
      const cap = RicochetManager._ballCap(state);
      const atCap = nBall >= cap;
      ctx.strokeStyle = 'rgba(157,104,255,' + (0.14 + intro * 0.2).toFixed(3) + ')';
      ctx.lineWidth = 2;
      for (let i = 0; i < nBall; i++) {
        const a = (i / nBall) * Math.PI * 2 + this.rotation * 0.15;
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(a) * (Rv - 8), sy + Math.sin(a) * (Rv - 8));
        ctx.lineTo(sx + Math.cos(a) * (Rv - 3), sy + Math.sin(a) * (Rv - 3));
        ctx.stroke();
      }
      if (atCap) {
        ctx.fillStyle = 'rgba(157,104,255,0.12)';
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2 - this.rotation * 0.1;
          ctx.beginPath();
          ctx.arc(sx + Math.cos(a) * (Rv - 12), sy + Math.sin(a) * (Rv - 12), 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // 状态局部点缀（导电=青紫电痕 / 雷霆=蓝白刻痕；只在局部弧段，不覆盖全场）
    if (this._conductiveAccent) this._drawAccentDots(ctx, sx, sy, Rv, -0.9, 'conductive');
    if (this._thunderAccent) this._drawAccentDots(ctx, sx, sy, Rv, Math.PI - 0.9, 'thunder');
    ctx.restore();
  },

  _drawAccentDots(ctx, sx, sy, Rv, baseAng, kind) {
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const a = baseAng + i * 0.12 + Math.sin(this.time * 0.8 + i) * 0.02;
      const x = sx + Math.cos(a) * Rv, y = sy + Math.sin(a) * Rv;
      if (kind === 'conductive') {
        // 小型电痕刻点（青紫）
        ctx.fillStyle = 'rgba(81,217,255,0.32)';
        ctx.beginPath();
        ctx.moveTo(x, y - 3.2); ctx.lineTo(x + 2.4, y); ctx.lineTo(x, y + 3.2); ctx.lineTo(x - 2.4, y);
        ctx.closePath();
        ctx.fill();
      } else {
        // 雷霆刻点（蓝白）
        ctx.fillStyle = 'rgba(159,232,255,0.36)';
        ctx.beginPath();
        ctx.arc(x, y, 1.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 双状态：两侧冷暖交替的微弱光痕
    if (this._conductiveAccent && this._thunderAccent) {
      for (let s = 0; s < 2; s++) {
        const a0 = s === 0 ? -0.75 : Math.PI - 0.75;
        ctx.strokeStyle = s === 0 ? 'rgba(81,217,255,0.16)' : 'rgba(159,232,255,0.15)';
        ctx.lineWidth = 1.4;
        this._arc(ctx, sx, sy, Rv * 0.985, a0, a0 + 0.35);
      }
    }
    ctx.restore();
  },

  // 首次登场扩散轨道波（缓慢向外扩散的紫色环）
  _drawTutorialWave(ctx, sx, sy, R) {
    const k = 1 - this.tutorialWave;            // 0 → 1
    const r = R * (0.15 + k * 0.95);
    ctx.save();
    ctx.strokeStyle = 'rgba(157,104,255,' + (0.3 * this.tutorialWave).toFixed(3) + ')';
    ctx.lineWidth = 2.2 - k * 1.2;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },

  // 首次登场引导光点：沿边界滑行一圈（纯视觉，不操纵真实弹球）
  _drawIntroSpark(ctx, sx, sy, R) {
    const a = this.introSpark * Math.PI * 2 - Math.PI / 2;
    const x = sx + Math.cos(a) * R, y = sy + Math.sin(a) * R;
    ctx.save();
    ctx.fillStyle = 'rgba(216,184,255,0.75)';
    ctx.beginPath();
    ctx.arc(x, y, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(157,104,255,0.35)';
    ctx.lineWidth = 2;
    this._arc(ctx, sx, sy, R, a - 0.35, a);
    ctx.restore();
  },

  // 轨道星尘：运动中的暗影微粒（固定池、上限明确）
  _drawParticles(ctx, sx, sy, R) {
    const cfg = CONFIG.ORBIT_FIELD;
    ctx.save();
    for (let i = 0; i < this._particles.length; i++) {
      const pt = this._particles[i];
      const breathe = Math.sin(this.time * 0.6 + pt.phase) * 0.045;
      const d = R * (pt.dist + breathe);
      const x = sx + Math.cos(pt.ang) * d;
      const y = sy + Math.sin(pt.ang) * d;
      const a = Math.min(cfg.maxRenderAlpha, pt.alpha * (0.85 + 0.3 * Math.sin(this.time + pt.phase)));
      ctx.fillStyle = i % 3 === 0
        ? 'rgba(81,217,255,' + a.toFixed(3) + ')'
        : 'rgba(157,104,255,' + a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(x, y, pt.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },

  // 外层断裂轨道环：主边界外侧 1~2 圈极淡断环（层次与深度，不是碰撞边界）
  _drawOuterRings(ctx, sx, sy, R) {
    const cfg = CONFIG.ORBIT_FIELD;
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 0; i < cfg.outerRingCount; i++) {
      const rr = R * (1.03 + i * 0.035);
      const rot = this.rotation * (0.35 + i * 0.12) * (i % 2 === 0 ? 1 : -1);
      const alpha = 0.055 - i * 0.014;
      for (let s = 0; s < 2; s++) {
        const a0 = rot + s * Math.PI + i * 0.6;
        ctx.strokeStyle = 'rgba(110,54,201,' + Math.max(0.02, alpha).toFixed(3) + ')';
        ctx.lineWidth = 1.2;
        this._arc(ctx, sx, sy, rr, a0, a0 + Math.PI * 0.55);
      }
    }
    ctx.restore();
  },

  // 圆弧辅助（世界半径 = 屏幕半径：本项目摄像机无缩放）
  _arc(ctx, sx, sy, r, a0, a1) {
    ctx.beginPath();
    ctx.arc(sx, sy, r, a0, a1);
    ctx.stroke();
  },
};

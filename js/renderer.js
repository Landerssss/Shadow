// ─── RENDERER (pixel-art style drawing) ──────────────────────────────────────
const Renderer = {
  ctx: null,
  cam: { x: 0, y: 0, sw: 0, sh: 0 },

  init(canvas) {
    this.ctx = canvas.getContext('2d');
    this.resize(canvas);
  },

  resize(canvas) {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    this.cam.sw = canvas.width;
    this.cam.sh = canvas.height;
    // 地图大小 = 屏幕 × 1.2（上下左右各留 10% 边距）
    CONFIG.MAP_W = canvas.width  * 1.2;
    CONFIG.MAP_H = canvas.height * 1.2;
  },

  clear() {
    this.ctx.clearRect(0, 0, this.cam.sw, this.cam.sh);
  },

  // ── BACKGROUND MAP ──────────────────────────────────────────────
  drawMap(mapData) {
    const ctx = this.ctx;
    const cam = this.cam;
    // Dark tile grid
    const tileSize = 64;
    const startX = Math.floor((cam.x - cam.sw / 2) / tileSize) * tileSize;
    const startY = Math.floor((cam.y - cam.sh / 2) / tileSize) * tileSize;

    for (let wx = startX; wx < cam.x + cam.sw / 2 + tileSize; wx += tileSize) {
      for (let wy = startY; wy < cam.y + cam.sh / 2 + tileSize; wy += tileSize) {
        const s = Utils.worldToScreen(wx, wy, cam);
        const col = (Math.floor(wx / tileSize) + Math.floor(wy / tileSize)) % 2;
        ctx.fillStyle = col === 0 ? '#0a0418' : '#0d0520';
        ctx.fillRect(s.x, s.y, tileSize + 1, tileSize + 1);
      }
    }

    // Subtle grid lines
    ctx.strokeStyle = '#1a0840';
    ctx.lineWidth = 0.5;
    for (let wx = startX; wx < cam.x + cam.sw / 2 + tileSize; wx += tileSize) {
      const s = Utils.worldToScreen(wx, startY, cam);
      ctx.beginPath(); ctx.moveTo(s.x, 0); ctx.lineTo(s.x, cam.sh); ctx.stroke();
    }
    for (let wy = startY; wy < cam.y + cam.sh / 2 + tileSize; wy += tileSize) {
      const s = Utils.worldToScreen(startX, wy, cam);
      ctx.beginPath(); ctx.moveTo(0, s.y); ctx.lineTo(cam.sw, s.y); ctx.stroke();
    }

    // 地图边界（醒目线 + 四角标记）
    this._drawMapBounds();
  },

  // 绘制地图边界
  _drawMapBounds() {
    const ctx = this.ctx;
    const cam = this.cam;
    const w = CONFIG.MAP_W, h = CONFIG.MAP_H;
    const tl = Utils.worldToScreen(0,    0,    cam);
    const tr = Utils.worldToScreen(w,    0,    cam);
    const br = Utils.worldToScreen(w,    h,    cam);
    const bl = Utils.worldToScreen(0,    h,    cam);

    // 屏幕矩形
    const minSX = Math.min(tl.x, tr.x, br.x, bl.x);
    const maxSX = Math.max(tl.x, tr.x, br.x, bl.x);
    const minSY = Math.min(tl.y, tr.y, br.y, bl.y);
    const maxSY = Math.max(tl.y, tr.y, br.y, bl.y);

    ctx.save();
    ctx.shadowBlur = 14;
    ctx.shadowColor = '#ff00ff';
    ctx.strokeStyle = '#ff44dd';
    ctx.lineWidth = 3;
    // 仅当边界穿过当前视野时绘制四条边
    const drawIfVisible = (ax, ay, bx, by) => {
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    };
    // 顶边 / 底边
    if (tl.y >= 0 && tl.y <= cam.sh) {
      drawIfVisible(Math.max(tl.x, 0), tl.y, Math.min(tr.x, cam.sw), tr.y);
    }
    if (bl.y >= 0 && bl.y <= cam.sh) {
      drawIfVisible(Math.max(bl.x, 0), bl.y, Math.min(br.x, cam.sw), br.y);
    }
    // 左边 / 右边
    if (tl.x >= 0 && tl.x <= cam.sw) {
      drawIfVisible(tl.x, Math.max(tl.y, 0), bl.x, Math.min(bl.y, cam.sh));
    }
    if (tr.x >= 0 && tr.x <= cam.sw) {
      drawIfVisible(tr.x, Math.max(tr.y, 0), br.x, Math.min(br.y, cam.sh));
    }
    ctx.restore();

    // 四角发光标记（即使不在屏幕内也试图绘制可见的角）
    ctx.save();
    ctx.shadowBlur = 18;
    ctx.shadowColor = '#ff00ff';
    ctx.fillStyle = '#ff66ee';
    const corners = [
      { p: tl, inX: tl.x >= -10 && tl.x <= cam.sw + 10, inY: tl.y >= -10 && tl.y <= cam.sh + 10 },
      { p: tr, inX: tr.x >= -10 && tr.x <= cam.sw + 10, inY: tr.y >= -10 && tr.y <= cam.sh + 10 },
      { p: br, inX: br.x >= -10 && br.x <= cam.sw + 10, inY: br.y >= -10 && br.y <= cam.sh + 10 },
      { p: bl, inX: bl.x >= -10 && bl.x <= cam.sw + 10, inY: bl.y >= -10 && bl.y <= cam.sh + 10 },
    ];
    for (const c of corners) {
      if (c.inX && c.inY) {
        ctx.beginPath();
        ctx.arc(c.p.x, c.p.y, 8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  },

  // ── PLAYER (pixel chibi) ──────────────────────────────────────────
  drawPlayer(player, time) {
    const ctx = this.ctx;
    const s = Utils.worldToScreen(player.x, player.y, this.cam);
    const sx = Math.round(s.x);
    const sy = Math.round(s.y);
    const facing = player.facing; // angle
    const bob = Math.sin(time * 6) * 2;
    const r = CONFIG.PLAYER_RADIUS;

    ctx.save();
    ctx.translate(sx, sy + bob);

    // Shadow blob under player
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(100,0,200,0.25)';
    ctx.beginPath();
    ctx.ellipse(0, r + 4, r * 0.8, r * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Glow aura
    if (player.invincibleTimer > 0) {
      ctx.shadowBlur = 30; ctx.shadowColor = '#ff3cac';
    } else {
      ctx.shadowBlur = 20; ctx.shadowColor = '#7b2fff';
    }

    // Body cloak
    ctx.fillStyle = '#2a0060';
    ctx.beginPath();
    ctx.ellipse(0, 4, r * 0.75, r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();

    // Cloak highlight
    ctx.fillStyle = '#5a10b0';
    ctx.beginPath();
    ctx.ellipse(-4, 0, r * 0.35, r * 0.55, -0.2, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.fillStyle = '#f0e0ff';
    ctx.beginPath();
    ctx.arc(0, -r * 0.55, r * 0.42, 0, Math.PI * 2);
    ctx.fill();

    // Hair
    ctx.fillStyle = '#dde8ff';
    ctx.fillRect(-r * 0.38, -r - 2, r * 0.76, r * 0.5);
    ctx.beginPath();
    ctx.arc(0, -r * 0.85, r * 0.42, 0, Math.PI);
    ctx.fill();

    // Eyes (red)
    ctx.fillStyle = '#ff3060';
    ctx.shadowBlur = 8; ctx.shadowColor = '#ff3060';
    ctx.fillRect(-6, -r * 0.55 - 2, 4, 3);
    ctx.fillRect(3,  -r * 0.55 - 2, 4, 3);
    ctx.shadowBlur = 0;

    // Gun direction indicator
    ctx.save();
    ctx.rotate(facing);
    ctx.fillStyle = '#888ab0';
    ctx.fillRect(4, -3, r * 0.9, 6);
    ctx.fillStyle = '#aaccff';
    ctx.fillRect(r * 0.4, -2, r * 0.5, 4);
    // muzzle flash
    if (player.muzzleFlash > 0) {
      ctx.fillStyle = `rgba(200,180,255,${player.muzzleFlash})`;
      ctx.shadowBlur = 12; ctx.shadowColor = '#c97bff';
      ctx.beginPath();
      ctx.arc(r * 0.95, 0, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 主角血条（正下方）
    this._drawPlayerHpBar(player, r, time);

    ctx.restore();

    // 受击闪红（独立于画布坐标，不受 translate/bob 影响）
    if (player.hitFlash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, player.hitFlash * 5);
      ctx.shadowBlur = 18;
      ctx.shadowColor = '#ff3c6e';
      ctx.fillStyle = '#ff3c6e';
      ctx.beginPath();
      ctx.arc(sx, Math.round(sy + bob), r * 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  },

  _drawPlayerHpBar(player, r, time) {
    const ctx = this.ctx;
    const maxHp = player.effectiveMaxHp || 1;
    const pct = Math.max(0, Math.min(1, player.hp / maxHp));
    const bw = 44, bh = 6;
    const rx = bw / 2, ry = bh / 2;
    const bx = -rx, by = -r - 12 - bh; // 血条挪到主角上方

    ctx.save();
    ctx.shadowBlur = 0;
    // 外框（椭圆）
    ctx.fillStyle = '#0a1a0a';
    ctx.beginPath();
    ctx.ellipse(0, by + ry, rx + 1, ry + 1, 0, 0, Math.PI * 2);
    ctx.fill();
    // 深底
    ctx.fillStyle = '#001a05';
    ctx.beginPath();
    ctx.ellipse(0, by + ry, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    // 颜色（按血量）
    let c1, c2;
    if (pct > 0.2)      { c1 = '#22cc44'; c2 = '#aaff88'; } // 绿
    else if (pct > 0.1) { c1 = '#cca022'; c2 = '#ffe488'; } // 黄
    else                { c1 = '#cc2233'; c2 = '#ff8888'; } // 红

    if (pct > 0) {
      // 主体渐变（裁剪到椭圆 + 按血量遮罩）
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, by + ry, rx, ry, 0, 0, Math.PI * 2);
      ctx.clip();
      // 血量遮罩
      ctx.fillStyle = '#001a05';
      ctx.fillRect(bx, by, bw, bh);
      // 主体渐变
      const grad = ctx.createLinearGradient(bx, by, bx, by + bh);
      grad.addColorStop(0, c2);
      grad.addColorStop(1, c1);
      ctx.fillStyle = grad;
      ctx.fillRect(bx, by, bw * pct, bh);
      // 流动高光带
      const phase = (((time || 0) * 0.8) % 1.4) - 0.2;
      const hx = bx + bw * pct * phase;
      const sg = ctx.createLinearGradient(hx - 12, 0, hx + 12, 0);
      sg.addColorStop(0,   'rgba(255,255,255,0)');
      sg.addColorStop(0.5, 'rgba(255,255,255,0.55)');
      sg.addColorStop(1,   'rgba(255,255,255,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(hx - 12, by, 24, bh);
      ctx.restore();
    }

    ctx.restore();
  },

  // ── ENEMY ─────────────────────────────────────────────────────────
  drawEnemy(enemy, time, player) {
    const t = enemy.type || 'melee';
    if (t === 'shooter') { this._drawShooter(enemy, time, player); }
    else if (t === 'wave')    { this._drawWaveEm(enemy, time); }
    else if (t === 'healer')  { this._drawHealer(enemy, time); }
    else if (t === 'boss')    { this._drawBoss(enemy, time); }
    else                      { this._drawMelee(enemy, time); }
    // 暗影冰封玻璃罩（叠加在任意怪物外）
    if (enemy.freezeTimer > 0) this._drawIceBlock(enemy);
  },

  // 怪物1：近战红眼怪
  _drawMelee(enemy, time) {
    const ctx = this.ctx;
    const s = Utils.worldToScreen(enemy.x, enemy.y, this.cam);
    const sx = Math.round(s.x);
    const sy = Math.round(s.y);
    const r  = enemy.radius || 14;
    const bob = Math.sin(time * 5 + enemy.id * 1.3) * 1.5;

    ctx.save();
    const spawn = enemy.spawnTimer != null ? enemy.spawnTimer : 1;
    const scaleM = 0.3 + spawn * 0.7;
    ctx.translate(sx, sy + bob);
    ctx.scale(scaleM, scaleM);
    ctx.globalAlpha = Math.min(1, spawn * 1.5);

    ctx.fillStyle = 'rgba(200,0,80,0.2)';
    ctx.beginPath();
    ctx.ellipse(0, r + 3, r * 0.7, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 16; ctx.shadowColor = '#cc002266';

    ctx.fillStyle = '#1a0010';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#cc0033';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#ff1040';
    ctx.shadowBlur = 10; ctx.shadowColor = '#ff1040';
    ctx.beginPath();
    ctx.arc(0, -1, r * 0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(-r * 0.15, -r * 0.2, r * 0.15, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffccdd';
    for (let i = -2; i <= 2; i++) {
      ctx.fillRect(i * 5 - 2, r - 6, 4, 7);
    }

    this._drawHpBar(enemy, r);
    this._drawHitFlash(enemy, r);

    ctx.restore();
  },

  // 怪物2：黄色射手（持枪造型）
  _drawShooter(enemy, time, player) {
    const ctx = this.ctx;
    const s = Utils.worldToScreen(enemy.x, enemy.y, this.cam);
    const sx = Math.round(s.x);
    const sy = Math.round(s.y);
    const r  = enemy.radius || 14;
    const bob = Math.sin(time * 4 + enemy.id * 1.7) * 1.2;

    ctx.save();
    const spawn = enemy.spawnTimer != null ? enemy.spawnTimer : 1;
    const scaleM = 0.3 + spawn * 0.7;
    ctx.translate(sx, sy + bob);
    ctx.scale(scaleM, scaleM);
    ctx.globalAlpha = Math.min(1, spawn * 1.5);

    ctx.fillStyle = 'rgba(200,160,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(0, r + 3, r * 0.7, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 14; ctx.shadowColor = '#aa770033';

    ctx.fillStyle = '#1a1408';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#cc9900';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    // 中央黄色大眼
    ctx.fillStyle = '#ffd84a';
    ctx.shadowBlur = 10; ctx.shadowColor = '#ffd84a';
    ctx.beginPath();
    ctx.arc(0, -1, r * 0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(-r * 0.15, -r * 0.2, r * 0.15, 0, Math.PI * 2);
    ctx.fill();

    // 黄色牙齿
    ctx.fillStyle = '#fff2a8';
    for (let i = -2; i <= 2; i++) {
      ctx.fillRect(i * 5 - 2, r - 6, 4, 7);
    }

    // 枪管（自动朝向玩家）
    const aim = player
      ? Math.atan2(player.y - enemy.y, player.x - enemy.x)
      : 0;
    ctx.save();
    ctx.rotate(aim);
    ctx.fillStyle = '#666033';
    ctx.fillRect(r * 0.55, -3, r * 0.7, 6);
    ctx.fillStyle = '#aa9944';
    ctx.fillRect(r * 0.55, -2, r * 0.7, 2);
    ctx.restore();

    this._drawHpBar(enemy, r);
    this._drawHitFlash(enemy, r);

    ctx.restore();
  },

  // 怪物3：鲜亮翠绿色声波怪（环状造型）
  _drawWaveEm(enemy, time) {
    const ctx = this.ctx;
    const s = Utils.worldToScreen(enemy.x, enemy.y, this.cam);
    const sx = Math.round(s.x);
    const sy = Math.round(s.y);
    const r  = enemy.radius || 14;
    const bob = Math.sin(time * 3 + enemy.id * 0.9) * 0.6; // 平缓无弹跳
    const pulse = 0.92 + Math.sin(time * 4 + enemy.id) * 0.08;

    ctx.save();
    const spawn = enemy.spawnTimer != null ? enemy.spawnTimer : 1;
    const scaleM = 0.3 + spawn * 0.7;
    ctx.translate(sx, sy + bob);
    ctx.scale(scaleM, scaleM);
    ctx.globalAlpha = Math.min(1, spawn * 1.5);

    ctx.fillStyle = 'rgba(34,238,112,0.18)';
    ctx.beginPath();
    ctx.ellipse(0, r + 3, r * 0.7, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 12; ctx.shadowColor = '#1ee86044';

    ctx.fillStyle = '#0a2814';
    ctx.beginPath();
    ctx.arc(0, 0, r * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#22ee70';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    // 身体表面淡绿色环形纹理
    ctx.strokeStyle = 'rgba(120,255,170,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,255,170,0.3)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2);
    ctx.stroke();

    // 中央翠绿眼
    ctx.fillStyle = '#22ee70';
    ctx.shadowBlur = 10; ctx.shadowColor = '#22ee70';
    ctx.beginPath();
    ctx.arc(0, -1, r * 0.45, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(-r * 0.13, -r * 0.2, r * 0.13, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#cfffd8';
    for (let i = -2; i <= 2; i++) {
      ctx.fillRect(i * 5 - 2, r - 6, 4, 7);
    }

    // 扩散声波圈（半透明淡绿，由内向外逐渐变淡扩大）
    for (const ring of enemy.waveRings || []) {
      const a = Math.min(1, ring.life / ring.maxLife) * 0.55;
      ctx.strokeStyle = `rgba(140,255,180,${a})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, ring.radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 常驻暗红色警戒线（最大声波范围，实线）
    const cfg = CONFIG.ENEMY_TYPES.wave;
    ctx.strokeStyle = 'rgba(120,30,30,0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, cfg.attackRadius, 0, Math.PI * 2);
    ctx.stroke();

    this._drawHpBar(enemy, r);
    this._drawHitFlash(enemy, r);

    ctx.restore();
  },

  // 怪物4：暗金色 + 深棕底色回血法杖怪（静止）
  _drawHealer(enemy, time) {
    const ctx = this.ctx;
    const s = Utils.worldToScreen(enemy.x, enemy.y, this.cam);
    const sx = Math.round(s.x);
    const sy = Math.round(s.y);
    const r  = enemy.radius || 14;
    // 静止：bob 极小
    const bob = Math.sin(time * 2 + enemy.id * 2.1) * 0.3;
    const aura = 0.6 + Math.sin(time * 2.5 + enemy.id) * 0.3;
    const isHit = enemy.hitTimer > 0;

    ctx.save();
    const spawn = enemy.spawnTimer != null ? enemy.spawnTimer : 1;
    const scaleM = 0.3 + spawn * 0.7;
    ctx.translate(sx, sy + bob);
    ctx.scale(scaleM, scaleM);
    ctx.globalAlpha = Math.min(1, spawn * 1.5);

    // 治疗范围光环（蓝色）
    ctx.strokeStyle = `rgba(80,140,255,${0.18 * aura})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, CONFIG.ENEMY_TYPES.healer.healRadius, 0, Math.PI * 2);
    ctx.stroke();

    // 投影（三角锥感）
    ctx.fillStyle = 'rgba(20,40,90,0.22)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.7 + 4, r * 0.8, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();

    // 等腰三角形主体（顶点朝上，高 1.3r、底 1.7r，稍高）
    const triTop    = { x: 0,        y: -r * 1.3 };
    const triLeft   = { x: -r * 0.85, y:  r * 0.6 };
    const triRight  = { x:  r * 0.85, y:  r * 0.6 };
    const bodyColor  = isHit ? '#5a0a18' : '#101a3a';
    const strokeCol  = isHit ? '#ff3c3c' : '#3c64d8';
    const shadowCol  = isHit ? '#ff3c3c' : '#3c64d8';

    ctx.shadowBlur = 14;
    ctx.shadowColor = shadowCol + '88';
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.moveTo(triTop.x, triTop.y);
    ctx.lineTo(triLeft.x, triLeft.y);
    ctx.lineTo(triRight.x, triRight.y);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(triTop.x, triTop.y);
    ctx.lineTo(triLeft.x, triLeft.y);
    ctx.lineTo(triRight.x, triRight.y);
    ctx.closePath();
    ctx.stroke();

    // 中央亮眼（三角形内部偏上一点）
    ctx.fillStyle = isHit ? '#ff8888' : '#80a8ff';
    ctx.shadowBlur = 12;
    ctx.shadowColor = isHit ? '#ff3c3c' : '#80a8ff';
    ctx.beginPath();
    ctx.arc(0, r * 0.0, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // 高光小白点
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-r * 0.08, r * 0.0 - r * 0.06, r * 0.12, 0, Math.PI * 2);
    ctx.fill();

    // 内部横向装饰条（三角形腰部高亮，保持画风统一）
    ctx.fillStyle = isHit ? '#ffaaaa' : '#cfe0ff';
    for (let i = -1; i <= 1; i++) {
      ctx.fillRect(i * 5 - 2, r * 0.35, 4, 5);
    }

    // 回血连线（细淡蓝色，从 healer 指向被治疗的怪物快照位置）
    for (const link of enemy.healLinks || []) {
      const tx = link.x - enemy.x;
      const ty = link.y - enemy.y;
      const a = Math.min(1, link.life / link.maxLife) * 0.75;
      ctx.strokeStyle = `rgba(140,180,255,${a})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }

    this._drawHpBar(enemy, r * 1.1);

    ctx.restore();
  },

  // ── BOSS：极大圆球，弹球移动 ─────────────────────────────────────
  _drawBoss(enemy, time) {
    const ctx = this.ctx;
    const s = Utils.worldToScreen(enemy.x, enemy.y, this.cam);
    const sx = Math.round(s.x);
    const sy = Math.round(s.y);
    const r  = enemy.radius || 40;
    const bob = Math.sin(time * 3 + enemy.id) * 2;
    const spawn = enemy.spawnTimer != null ? enemy.spawnTimer : 1;

    ctx.save();
    ctx.translate(sx, sy + bob);
    ctx.scale(spawn, spawn);
    ctx.globalAlpha = Math.min(1, spawn * 2);

    // 单只流血眼睛（每只 BOSS 1 眼；眼数 = BOSS 数量）
    // 外圈血光晕
    ctx.shadowBlur = 24;
    ctx.shadowColor = '#ff2030';
    const halo = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 1.2);
    halo.addColorStop(0, 'rgba(255,80,80,0.55)');
    halo.addColorStop(1, 'rgba(255,32,48,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2);
    ctx.fill();

    // 眼白（主体圆，淡黄白底带血丝）
    ctx.shadowBlur = 0;
    const eyeWhite = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.1, 0, 0, r);
    eyeWhite.addColorStop(0, '#fff4d4');
    eyeWhite.addColorStop(0.5, '#e8c8a8');
    eyeWhite.addColorStop(1, '#a06848');
    ctx.fillStyle = eyeWhite;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // 流血细节（从底部和侧面蔓延的红色血条/血斑）
    ctx.fillStyle = 'rgba(180,20,20,0.78)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.7, r * 0.7, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-r * 0.55, r * 0.2, r * 0.12, r * 0.55, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(r * 0.6, r * 0.35, r * 0.1, r * 0.45, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(r * 0.35, r * 0.85, r * 0.08, 0, Math.PI * 2);
    ctx.arc(-r * 0.3, r * 0.95, r * 0.06, 0, Math.PI * 2);
    ctx.arc(r * 0.05, r * 1.05, r * 0.05, 0, Math.PI * 2);
    ctx.fill();

    // 红色虹膜
    ctx.shadowBlur = 16;
    ctx.shadowColor = '#ff2030';
    const iris = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r * 0.55);
    iris.addColorStop(0, '#ff5050');
    iris.addColorStop(0.7, '#cc1010');
    iris.addColorStop(1, '#660505');
    ctx.fillStyle = iris;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
    ctx.fill();

    // 瞳孔
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#000000';
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#ff8080';
    ctx.fillStyle = '#ff8080';
    ctx.beginPath();
    ctx.arc(-r * 0.08, -r * 0.08, r * 0.08, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;

    // 描边
    ctx.strokeStyle = '#2a0808';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  },

  // 共享血条（与经验条同款：宽 260 高 16 圆角 10 暗红底 + 红色渐变 + shimmer + 不显示数字）
  drawBossSharedHpBar(sharedHp, sharedMaxHp, time) {
    if (sharedMaxHp == null || sharedMaxHp <= 0) return;
    const ctx = this.ctx;
    const cam = this.cam;
    const pct = Math.max(0, Math.min(1, sharedHp / sharedMaxHp));
    const bw = 260, bh = 16;
    const sx = cam.sw / 2;
    const sy = 28;
    const rx = bw / 2, ry = bh / 2;

    ctx.save();
    ctx.shadowBlur = 0;
    // 暗红底（与 .exp-bar-wrap 背景 #1a0040 同款位置）
    ctx.fillStyle = '#1a0040';
    ctx.beginPath();
    ctx.roundRect(sx - rx, sy - ry, bw, bh, 10);
    ctx.fill();

    if (pct > 0) {
      // 亮度提升：填充渐变更亮 + 强发光阴影
      ctx.shadowBlur = 22;
      ctx.shadowColor = '#ff5050';
      const grad = ctx.createLinearGradient(sx - rx, 0, sx + rx, 0);
      grad.addColorStop(0,    '#ff3040');
      grad.addColorStop(0.5,  '#ff8090');
      grad.addColorStop(1,    '#ffc0c0');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(sx - rx, sy - ry, bw * pct, bh, 10);
      ctx.fill();
      ctx.shadowBlur = 0;
      // 顶部高光（白线）— 经验条没有，BOSS 血条独享
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx - rx + 4, sy - ry + 2);
      ctx.lineTo(sx - rx + bw * pct - 4, sy - ry + 2);
      ctx.stroke();
      // shimmer 高光（与 .exp-bar::after 同款）
      const shim = ctx.createLinearGradient(sx - rx, 0, sx + rx, 0);
      shim.addColorStop(0,   'rgba(255,255,255,0)');
      shim.addColorStop(0.5, 'rgba(255,255,255,0.5)');
      shim.addColorStop(1,   'rgba(255,255,255,0)');
      const shimX = sx - rx + ((time * 80) % (bw + 200)) - 200;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(sx - rx, sy - ry, bw * pct, bh, 10);
      ctx.clip();
      ctx.fillStyle = shim;
      ctx.fillRect(shimX, sy - ry, 200, bh);
      ctx.restore();
    }
    ctx.restore();
  },

  // BOSS 锁链：3 个 BOSS 互相用红色锁链连住对方（5s 持续）
  drawBossChain(aliveBosses, life, maxLife) {
    if (!aliveBosses || aliveBosses.length < 2 || life <= 0) return;
    const ctx = this.ctx;
    const cam = this.cam;
    const a = Math.min(1, life / maxLife);
    const pulse = 0.6 + 0.4 * Math.sin(performance.now() * 0.02);

    ctx.save();
    ctx.globalAlpha = a;
    ctx.lineCap = 'round';

    // 绘制每对 BOSS 之间的锁链
    for (let i = 0; i < aliveBosses.length; i++) {
      for (let j = i + 1; j < aliveBosses.length; j++) {
        const a1 = Utils.worldToScreen(aliveBosses[i].x, aliveBosses[i].y, cam);
        const a2 = Utils.worldToScreen(aliveBosses[j].x, aliveBosses[j].y, cam);
        // 链节（虚线 + 红色光晕）
        ctx.shadowBlur = 14 * pulse;
        ctx.shadowColor = '#ff2030';
        ctx.strokeStyle = '#ff2030';
        ctx.lineWidth = 4;
        ctx.setLineDash([10, 6]);
        ctx.beginPath();
        ctx.moveTo(a1.x, a1.y);
        ctx.lineTo(a2.x, a2.y);
        ctx.stroke();
        // 中线（深红）
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#7a0000';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 6]);
        ctx.beginPath();
        ctx.moveTo(a1.x, a1.y);
        ctx.lineTo(a2.x, a2.y);
        ctx.stroke();
        // 链节上的小尖刺（红色小三角）
        ctx.setLineDash([]);
        const dx = a2.x - a1.x, dy = a2.y - a1.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const nx = -uy, ny = ux;
        for (let s = 20; s < len; s += 28) {
          const px = a1.x + dx * (s / len);
          const py = a1.y + dy * (s / len);
          ctx.fillStyle = '#ff5060';
          ctx.shadowBlur = 8;
          ctx.shadowColor = '#ff2030';
          ctx.beginPath();
          ctx.moveTo(px + nx * 3, py + ny * 3);
          ctx.lineTo(px - nx * 3, py - ny * 3);
          ctx.lineTo(px + ux * 5, py + uy * 5);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
    ctx.restore();
  },

  _drawBossHpBar(enemy, time) {
    const ctx = this.ctx;
    const maxHp = enemy.maxHp || 1;
    const pct = Math.max(0, Math.min(1, enemy.hp / maxHp));
    const bw = 90, bh = 8;
    const rx = bw / 2, ry = bh / 2;
    const by = -enemy.radius - 18;
    const s = Utils.worldToScreen(enemy.x, enemy.y, this.cam);
    const sx = s.x;
    const sy = s.y;

    ctx.save();
    ctx.shadowBlur = 0;
    // 外框椭圆
    ctx.fillStyle = '#0a1a0a';
    ctx.beginPath();
    ctx.ellipse(sx, sy + by + ry, rx + 1, ry + 1, 0, 0, Math.PI * 2);
    ctx.fill();
    // 深底
    ctx.fillStyle = '#001a05';
    ctx.beginPath();
    ctx.ellipse(sx, sy + by + ry, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    // 颜色（BOSS 固定为红色）
    const c1 = '#cc2233', c2 = '#ff8888';

    if (pct > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(sx, sy + by + ry, rx, ry, 0, 0, Math.PI * 2);
      ctx.clip();
      // 血量遮罩
      ctx.fillStyle = '#001a05';
      ctx.fillRect(sx + (-rx), sy + by, bw, bh);
      // 主体渐变
      const grad = ctx.createLinearGradient(sx + (-rx), sy + by, sx + (-rx), sy + by + bh);
      grad.addColorStop(0, c2);
      grad.addColorStop(1, c1);
      ctx.fillStyle = grad;
      ctx.fillRect(sx + (-rx), sy + by, bw * pct, bh);

      // 流动高光带
      const phase = (((time || 0) * 0.8) % 1.4) - 0.2;
      const hx = sx + (-rx) + bw * pct * phase;
      const sg = ctx.createLinearGradient(hx - 16, 0, hx + 16, 0);
      sg.addColorStop(0,   'rgba(255,255,255,0)');
      sg.addColorStop(0.5, 'rgba(255,255,255,0.55)');
      sg.addColorStop(1,   'rgba(255,255,255,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(hx - 16, sy + by, 32, bh);
      ctx.restore();
    }

    ctx.restore();
  },

  _drawHpBar(enemy, r) {
    const ctx = this.ctx;
    const hpPct = enemy.hp / enemy.maxHp;
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#220022';
    ctx.fillRect(-r, -r - 10, r * 2, 5);
    ctx.fillStyle = hpPct > 0.5 ? '#ff3060' : '#ff5522';
    ctx.fillRect(-r, -r - 10, r * 2 * hpPct, 5);
  },

  // 受击红闪（在子方法 restore 之前调用）
  _drawHitFlash(enemy, r) {
    if (enemy.hitTimer > 0) {
      const a = Math.min(1, enemy.hitTimer / 0.12) * 0.7;
      this.ctx.fillStyle = `rgba(255,40,40,${a})`;
      this.ctx.beginPath();
      this.ctx.arc(0, 0, r * 1.05, 0, Math.PI * 2);
      this.ctx.fill();
    }
  },

  // ── SHADOW CLONE (Echo) ──────────────────────────────────────────
  drawShadowClone(shadow, time) {
    const ctx = this.ctx;
    const s = Utils.worldToScreen(shadow.x, shadow.y, this.cam);
    const sx = Math.round(s.x);
    const sy = Math.round(s.y);
    const alpha = Math.min(1, (shadow.maxDuration - shadow.timer) / 0.5,
                             shadow.timer / 0.5);
    const r = CONFIG.ECHO.BODY_RADIUS;
    const bob = Math.sin(time * 4 + shadow.id) * 2;
    const pulse = 0.85 + Math.sin(time * 3 + shadow.id) * 0.15;

    ctx.save();
    ctx.globalAlpha = alpha * pulse;
    ctx.translate(sx, sy + bob);

    ctx.shadowBlur = 28; ctx.shadowColor = '#6600cc';

    // Core body
    ctx.fillStyle = '#1a0040';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Purple flame aura
    ctx.fillStyle = 'rgba(100,0,200,0.4)';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + time * 1.5;
      const dist = r + 5 + Math.sin(time * 3 + i) * 4;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * dist * 0.6, Math.sin(a) * dist * 0.6, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Eyes
    ctx.fillStyle = '#aa44ff';
    ctx.shadowBlur = 10; ctx.shadowColor = '#aa44ff';
    ctx.fillRect(-5, -3, 3, 4);
    ctx.fillRect(2,  -3, 3, 4);

    ctx.restore();
  },

  // ── BULLET ────────────────────────────────────────────────────────
  drawBullet(b, time) {
    const ctx = this.ctx;
    const s = Utils.worldToScreen(b.x, b.y, this.cam);
    const sx = Math.round(s.x);
    const sy = Math.round(s.y);
    const r = b.radius || 6;
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.shadowBlur = 14;
    ctx.shadowColor = b.color || '#a259ff';
    ctx.fillStyle = b.color || '#c97bff';
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    // 敌方黄色子弹：边缘加暗红圆圈线
    if (b.owner === 'enemy') {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#a01030';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, r + 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    // trail
    ctx.fillStyle = (b.color || '#a259ff') + '55';
    ctx.beginPath();
    ctx.arc(sx - Math.cos(b.angle) * 8,
            sy - Math.sin(b.angle) * 8, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },

  // ── VORTEX ────────────────────────────────────────────────────────
  drawVortex(vortex, time) {
    const ctx = this.ctx;
    const s = Utils.worldToScreen(vortex.x, vortex.y, this.cam);
    const sx = Math.round(s.x), sy = Math.round(s.y);
    const r = vortex.radius;
    const lifeRatio = vortex.timer / vortex.maxDuration;
    const alpha = Math.min(1, lifeRatio * 3, (1 - lifeRatio) * 3);
    // 大漩涡（LV7 融合产物）：旋转速度 3x → 再快 50% = 4.5x
    const rot = time * 2 * (vortex._isFused ? 4.5 : 1);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(sx, sy);

    if (vortex._isFused) {
      // ── 大漩涡配色：白色系 ──
      // Outer ring（白色径向渐变）
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      grad.addColorStop(0,   'rgba(255,255,255,0.55)');
      grad.addColorStop(0.6, 'rgba(220,220,240,0.3)');
      grad.addColorStop(1,   'rgba(180,180,200,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      // Spiral arms（白色 + 强光晕）
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.shadowBlur = 8; ctx.shadowColor = '#ffffff';
      for (let arm = 0; arm < 3; arm++) {
        ctx.save();
        ctx.rotate(rot + (arm / 3) * Math.PI * 2);
        ctx.beginPath();
        for (let t = 0; t < Math.PI * 2; t += 0.18) {
          const rr = (t / (Math.PI * 2)) * r;
          const x = Math.cos(t) * rr;
          const y = Math.sin(t) * rr;
          t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      }
      // Center dot（白核）
      ctx.fillStyle = '#ffffff';
      ctx.shadowBlur = 16; ctx.shadowColor = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // ── 普通漩涡配色：紫色系（不变）──
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      grad.addColorStop(0, 'rgba(200,0,255,0.5)');
      grad.addColorStop(0.6, 'rgba(80,0,180,0.3)');
      grad.addColorStop(1, 'rgba(80,0,180,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#aa44ff';
      ctx.lineWidth = 2;
      ctx.shadowBlur = 4; ctx.shadowColor = '#7b2fff';
      for (let arm = 0; arm < 3; arm++) {
        ctx.save();
        ctx.rotate(rot + (arm / 3) * Math.PI * 2);
        ctx.beginPath();
        for (let t = 0; t < Math.PI * 2; t += 0.18) {
          const rr = (t / (Math.PI * 2)) * r;
          const x = Math.cos(t) * rr;
          const y = Math.sin(t) * rr;
          t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      }

      ctx.fillStyle = '#ffffff';
      ctx.shadowBlur = 12; ctx.shadowColor = '#fff';
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  },

  // ── VORTEX PROJECTILE ─────────────────────────────────────────────
  drawVortexProjectile(p, time) {
    const ctx = this.ctx;
    const s = Utils.worldToScreen(p.x, p.y, this.cam);
    ctx.save();
    ctx.shadowBlur = 8; ctx.shadowColor = '#ff00ff';
    ctx.fillStyle = '#dd44ff';
    ctx.translate(Math.round(s.x), Math.round(s.y));
    ctx.rotate(p.angle + Math.PI / 2); // 长条沿运动方向
    ctx.fillRect(-3, -10, 6, 20);
    ctx.restore();
  },

  // ── DEATH SHADOW ──────────────────────────────────────────────────
  drawDeathShadow(ds, time) {
    const ctx = this.ctx;
    const s = Utils.worldToScreen(ds.x, ds.y, this.cam);
    const lifeRatio = ds.timer / ds.maxDuration;
    const alpha = Math.min(lifeRatio * 4, (1 - lifeRatio) * 4, 0.7);
    const pulse = 0.8 + Math.sin(time * 2 + ds.id) * 0.2;
    const r = 10;

    ctx.save();
    ctx.globalAlpha = alpha * pulse;
    ctx.shadowBlur = 20; ctx.shadowColor = '#330066';
    ctx.fillStyle = '#220044';
    ctx.beginPath();
    ctx.arc(Math.round(s.x), Math.round(s.y), r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#6600aa55';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  },

  // ── SHADOW LINK ──────────────────────────────────────────────────
  drawShadowLinks(player, shadowEntities) {
    const ctx = this.ctx;
    const ps = Utils.worldToScreen(player.x, player.y, this.cam);
    const cam = this.cam;
    const MAX_LINKS = 250;
    let drawn = 0;

    for (const se of shadowEntities) {
      if (drawn >= MAX_LINKS) break;
      if (!se.active && se.timer <= 0) continue;
      // 端点全在屏幕外则跳过（包围盒粗筛）
      if (!Utils.isOnScreen(se.x, se.y, cam, 0)) continue;
      const es = Utils.worldToScreen(se.x, se.y, this.cam);
      const grad = ctx.createLinearGradient(ps.x, ps.y, es.x, es.y);
      grad.addColorStop(0, 'rgba(200,120,255,0.95)');
      grad.addColorStop(1, 'rgba(120,40,220,0.55)');
      ctx.save();
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 8; ctx.shadowColor = '#b56bff';
      ctx.beginPath();
      ctx.moveTo(ps.x, ps.y);
      ctx.lineTo(es.x, es.y);
      ctx.stroke();
      ctx.restore();
      drawn++;
    }
  },

  // ── SHADOW EXPLOSIONS (Echo LV6) ──────────────────────────────────
  drawShadowExplosions(explosions, cam) {
    const ctx = this.ctx;
    for (const e of explosions) {
      const s = Utils.worldToScreen(e.x, e.y, cam);
      const a = Math.min(1, e.life / e.maxLife);
      const sx = Math.round(s.x);
      const sy = Math.round(s.y);
      const r = Math.max(2, Math.round(e.radius));
      // 闪光进度（生命前 25% 强闪光，后 75% 持续 60% 透明扩散）
      const flashT = 1 - Math.min(1, e.life / (e.maxLife * 0.25));
      ctx.save();
      // ── 闪光效果：起始帧强烈的全屏白色瞬间闪光（最大 0.9 alpha 中心 + 渐变外圈）──
      const flashAlpha = (1 - flashT) * 0.9; // 起始 0.9 → 0
      if (flashAlpha > 0.01) {
        const flashR = r * (2 + flashT * 1.5); // 起始最大 r*3.5 → r*2
        const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, flashR);
        grad.addColorStop(0,    `rgba(255,255,255,${flashAlpha})`);
        grad.addColorStop(0.4,  `rgba(255,255,255,${flashAlpha * 0.6})`);
        grad.addColorStop(1,    `rgba(255,255,255,0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(sx, sy, flashR, 0, Math.PI * 2);
        ctx.fill();
      }
      // ── 白色实心圆（半径 ×2，60% 透明度）──
      ctx.globalAlpha = 0.6 * a;
      ctx.shadowBlur = 30;
      ctx.shadowColor = '#ffffff';
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(sx, sy, r * 2, 0, Math.PI * 2);
      ctx.fill();
      // 外层更亮的白色冲击环（半径 ×2.3）
      ctx.globalAlpha = 0.8 * a;
      ctx.shadowBlur = 36;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(sx, sy, r * 2.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  },

  // ── VORTEX LIGHTNING (Vortex LV5 self-spawn) ───────────────────────
  drawVortexLightning(lightning, time) {
    const ctx = this.ctx;
    const from = Utils.worldToScreen(lightning.x, lightning.y, this.cam);
    const alpha = Math.min(1, lightning.life / lightning.maxLife);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = CONFIG.VORTEX.LIGHTNING_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (lightning.isWhite) {
      // 大漩涡（LV7 融合产物）闪电：黑白交加
      // 先画黑色底层（错位 -1px）
      ctx.beginPath();
      ctx.moveTo(from.x - 1, from.y - 1);
      for (const seg of lightning.segments) {
        ctx.lineTo(from.x + seg.x - 1, from.y + seg.y - 1);
      }
      ctx.shadowBlur = 8;
      ctx.shadowColor = '#000000';
      ctx.strokeStyle = '#000000';
      ctx.stroke();
      // 再画白色顶层
      ctx.beginPath();
      ctx.moveTo(from.x + 1, from.y + 1);
      for (const seg of lightning.segments) {
        ctx.lineTo(from.x + seg.x + 1, from.y + seg.y + 1);
      }
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#ffffff';
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    } else {
      // 普通漩涡闪电：紫色
      ctx.shadowBlur = 6;
      ctx.shadowColor = '#dd00ff';
      ctx.strokeStyle = '#dd00ff';
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      for (const seg of lightning.segments) {
        ctx.lineTo(from.x + seg.x, from.y + seg.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  },

  // ── RIFT LASER (Vortex LV6: vortex intersection) ──────────────────
  drawRiftLaser(laser, time) {
    const ctx = this.ctx;
    if (!laser.alive) return;
    const from = Utils.worldToScreen(laser.x, laser.y, this.cam);
    // 大漩涡裂隙：长度 × 1.5
    const range = laser._isFusedRift
      ? CONFIG.VORTEX.RIFT_LASER_RANGE * 1.5
      : CONFIG.VORTEX.RIFT_LASER_RANGE;

    for (const phase of laser._phases) {
      if (!phase.fired || phase.angle == null) continue;
      const elapsed = laser.timer - phase.delay;
      const alpha = Math.max(0, 1 - elapsed / laser._phaseLife);
      if (alpha <= 0) continue;

      const endX = from.x + Math.cos(phase.angle) * range;
      const endY = from.y + Math.sin(phase.angle) * range;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.lineCap = 'round';
      const beamW = CONFIG.VORTEX.RIFT_BEAM_WIDTH;

      if (laser._isFusedRift) {
        // 大漩涡裂隙激光：黑白交加（黑边 + 白心 + 错位 2px）
        // 黑色底层（错位 -2px）
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#000000';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = beamW + 2;
        ctx.beginPath();
        ctx.moveTo(from.x - 2, from.y - 2);
        ctx.lineTo(endX - 2, endY - 2);
        ctx.stroke();
        // 白色顶层（错位 +2px）
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#ffffff';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = beamW;
        ctx.beginPath();
        ctx.moveTo(from.x + 2, from.y + 2);
        ctx.lineTo(endX + 2, endY + 2);
        ctx.stroke();
      } else {
        // 普通激光：紫色
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#ff00ff';
        ctx.strokeStyle = '#ff44ff';
        ctx.lineWidth = beamW;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        // 中心高亮细线
        ctx.shadowBlur = 6;
        ctx.shadowColor = '#ffbbff';
        ctx.strokeStyle = '#ffd0ff';
        ctx.lineWidth = Math.max(2, beamW * 0.3);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }

      ctx.restore();
    }
  },

  // ── PARTICLES ─────────────────────────────────────────────────────
  drawParticles(particles) {
    const ctx = this.ctx;
    for (const p of particles) {
      const s = Utils.worldToScreen(p.x, p.y, this.cam);
      ctx.save();
      ctx.globalAlpha = p.alpha;
      if (p.isText) {
        ctx.shadowBlur = 10; ctx.shadowColor = p.color;
        ctx.fillStyle = p.color;
        ctx.font = `bold ${p.size || 16}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.text, s.x, s.y);
      } else {
        ctx.shadowBlur = 8; ctx.shadowColor = p.color;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(Math.round(s.x), Math.round(s.y), p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  },

  // ── MINIMAP ──────────────────────────────────────────────────────
  drawMinimap(state) {
    const ctx = this.ctx;
    const mw = 100, mh = 100;
    const mx = this.cam.sw - mw - 10;
    const my = this.cam.sh - mh - 10;
    const scaleX = mw / CONFIG.MAP_W;
    const scaleY = mh / CONFIG.MAP_H;

    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#07030f';
    ctx.strokeStyle = '#3a0080';
    ctx.lineWidth = 1;
    ctx.fillRect(mx, my, mw, mh);
    ctx.strokeRect(mx, my, mw, mh);

    // enemies
    ctx.fillStyle = '#ff3060';
    for (const e of state.enemies) {
      ctx.fillRect(mx + e.x * scaleX - 1, my + e.y * scaleY - 1, 2, 2);
    }

    // player
    ctx.fillStyle = '#c97bff';
    ctx.beginPath();
    ctx.arc(mx + state.player.x * scaleX, my + state.player.y * scaleY, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  },

  // ── ICE BLOCK (暗影冰封：3D 玻璃多面体罩) ─────────────────────────
  _drawIceBlock(enemy) {
    const ctx = this.ctx;
    const verts = enemy.freezeVerts;
    if (!verts) return;
    const s = Utils.worldToScreen(enemy.x, enemy.y, this.cam);
    const sx = Math.round(s.x);
    const sy = Math.round(s.y);

    // 旋转 + 透视投影（绕 Y 轴）
    const rot = enemy.freezeRot || 0;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    const proj = verts.map(v => ({
      x: v.x * cosR - v.z * sinR,
      y: v.y,
      z: v.x * sinR + v.z * cosR,
    }));

    ctx.save();
    ctx.translate(sx, sy);

    // 后半面（z 较小）—— 先画淡蓝远面
    const sorted = proj.slice().sort((a, b) => a.z - b.z);
    // 描边（亮蓝玻璃高光）
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#7adcff';
    ctx.strokeStyle = 'rgba(180,230,255,0.75)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      const b = sorted[(i + 1) % sorted.length];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // 填充多面体（半透明蓝渐变，模拟玻璃）
    const minZ = sorted[0].z, maxZ = sorted[sorted.length - 1].z;
    const fade = (z) => 0.18 + 0.25 * ((z - minZ) / Math.max(1, maxZ - minZ));
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      const b = sorted[(i + 1) % sorted.length];
      const midZ = (a.z + b.z) / 2;
      ctx.fillStyle = `rgba(120,200,255,${fade(midZ).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.closePath();
      ctx.fill();
    }

    // 中心高亮（强化 3D 玻璃感）
    ctx.shadowBlur = 18;
    ctx.shadowColor = '#c0e8ff';
    ctx.fillStyle = 'rgba(220,240,255,0.22)';
    ctx.beginPath();
    ctx.arc(0, -enemy.radius * 0.25, enemy.radius * 0.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
};

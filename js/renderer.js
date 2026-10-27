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

  // ── 发光光晕贴图缓存 ──────────────────────────────────────────────
  // 用预渲染径向渐变贴图 + drawImage 替代昂贵的 shadowBlur（后者每帧
  // 每次绘制都要渲染一张模糊位图，实体一多就是灾难）。
  _glowCache: new Map(),

  _parseColor(color) {
    // 解析 #rgb / #rrggbb / #rrggbbaa / rgb() / rgba() → [r,g,b,a]
    if (typeof color === 'string' && color[0] === '#') {
      const hex = color.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        return [
          parseInt(hex[0] + hex[0], 16),
          parseInt(hex[1] + hex[1], 16),
          parseInt(hex[2] + hex[2], 16),
          hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1
        ];
      }
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
      ];
    }
    const m = typeof color === 'string' && color.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const parts = m[1].split(',');
      return [
        parseFloat(parts[0]) | 0,
        parseFloat(parts[1]) | 0,
        parseFloat(parts[2]) | 0,
        parts.length > 3 ? parseFloat(parts[3]) : 1
      ];
    }
    return [255, 255, 255, 1];
  },

  _glowSprite(color) {
    // 按颜色缓存一张 64×64 径向渐变光晕贴图，绘制时按需缩放
    const key = 'glow|' + color;
    let sp = this._glowCache.get(key);
    if (sp) return sp;
    const size = 64;
    sp = document.createElement('canvas');
    sp.width = size;
    sp.height = size;
    const g = sp.getContext('2d');
    const c = this._parseColor(color);
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0,    `rgba(${c[0]},${c[1]},${c[2]},${c[3]})`);
    grad.addColorStop(0.45, `rgba(${c[0]},${c[1]},${c[2]},${c[3] * 0.5})`);
    grad.addColorStop(1,    `rgba(${c[0]},${c[1]},${c[2]},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    this._glowCache.set(key, sp);
    return sp;
  },

  // 在 (x,y) 画半径 radius 的光晕；alphaMul 与当前 globalAlpha 相乘
  _drawGlow(x, y, radius, color, alphaMul = 1) {
    const ctx = this.ctx;
    const sp = this._glowSprite(color);
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * alphaMul;
    ctx.drawImage(sp, x - radius, y - radius, radius * 2, radius * 2);
    ctx.globalAlpha = a;
  },

  // ── BACKGROUND MAP ──────────────────────────────────────────────
  drawMap(mapData) {
    const ctx = this.ctx;
    const cam = this.cam;
    // Dark tile grid
    const tileSize = 64;
    const ox = cam.sw / 2 - cam.x; // 世界→屏幕常量偏移（内联换算，零分配）
    const oy = cam.sh / 2 - cam.y;
    const startX = Math.floor((cam.x - cam.sw / 2) / tileSize) * tileSize;
    const startY = Math.floor((cam.y - cam.sh / 2) / tileSize) * tileSize;
    const endX = cam.x + cam.sw / 2 + tileSize;
    const endY = cam.y + cam.sh / 2 + tileSize;

    // 棋盘格分两遍铺（每种颜色只切换一次 fillStyle）
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass === 0 ? '#0a0418' : '#0d0520';
      for (let wx = startX; wx < endX; wx += tileSize) {
        const sx = wx + ox;
        const px = Math.floor(wx / tileSize);
        for (let wy = startY; wy < endY; wy += tileSize) {
          if (((px + Math.floor(wy / tileSize)) & 1) !== pass) continue;
          ctx.fillRect(sx, wy + oy, tileSize + 1, tileSize + 1);
        }
      }
    }

    // Subtle grid lines（合并为一次 stroke）
    ctx.strokeStyle = '#1a0840';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let wx = startX; wx < endX; wx += tileSize) {
      const sx = wx + ox;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, cam.sh);
    }
    for (let wy = startY; wy < endY; wy += tileSize) {
      const sy = wy + oy;
      ctx.moveTo(0, sy); ctx.lineTo(cam.sw, sy);
    }
    ctx.stroke();

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
    ctx.lineCap = 'round';
    const drawIfVisible = (ax, ay, bx, by) => {
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    };
    const drawBounds = () => {
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
    };
    // 发光效果（替代 shadowBlur）：先描宽半透明线，再描实线
    ctx.strokeStyle = 'rgba(255,68,221,0.22)';
    ctx.lineWidth = 12;
    drawBounds();
    ctx.strokeStyle = '#ff44dd';
    ctx.lineWidth = 3;
    drawBounds();
    ctx.restore();

    // 四角发光标记（即使不在屏幕内也试图绘制可见的角）
    ctx.save();
    const corners = [
      { p: tl, inX: tl.x >= -10 && tl.x <= cam.sw + 10, inY: tl.y >= -10 && tl.y <= cam.sh + 10 },
      { p: tr, inX: tr.x >= -10 && tr.x <= cam.sw + 10, inY: tr.y >= -10 && tr.y <= cam.sh + 10 },
      { p: br, inX: br.x >= -10 && br.x <= cam.sw + 10, inY: br.y >= -10 && br.y <= cam.sh + 10 },
      { p: bl, inX: bl.x >= -10 && bl.x <= cam.sw + 10, inY: bl.y >= -10 && bl.y <= cam.sh + 10 },
    ];
    for (const c of corners) {
      if (c.inX && c.inY) {
        this._drawGlow(c.p.x, c.p.y, 18, '#ff00ff', 0.8);
        ctx.fillStyle = '#ff66ee';
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
    else if (t === 'charger') { this._drawCharger(enemy, time, player); }
    else if (t === 'bulwark') { this._drawBulwark(enemy, time, player); }
    else if (t === 'lobber')  { this._drawLobber(enemy, time, player); }
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

    // 发光光晕（替代 shadowBlur）
    this._drawGlow(0, 0, r * 1.75, '#cc0022', 0.3);

    ctx.fillStyle = '#1a0010';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#cc0033';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    this._drawGlow(0, -1, r * 0.9, '#ff1040', 0.5);
    ctx.fillStyle = '#ff1040';
    ctx.beginPath();
    ctx.arc(0, -1, r * 0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
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

    // 发光光晕（替代 shadowBlur）
    this._drawGlow(0, 0, r * 1.75, '#aa7700', 0.25);

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
    this._drawGlow(0, -1, r * 0.9, '#ffd84a', 0.5);
    ctx.fillStyle = '#ffd84a';
    ctx.beginPath();
    ctx.arc(0, -1, r * 0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
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

    // 发光光晕（替代 shadowBlur）
    this._drawGlow(0, 0, r * 1.8, '#1ee860', 0.25);

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
    this._drawGlow(0, -1, r * 0.85, '#22ee70', 0.5);
    ctx.fillStyle = '#22ee70';
    ctx.beginPath();
    ctx.arc(0, -1, r * 0.45, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
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

    // 发光光晕（替代 shadowBlur）
    this._drawGlow(0, 0, r * 1.9, shadowCol, 0.3);
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.moveTo(triTop.x, triTop.y);
    ctx.lineTo(triLeft.x, triLeft.y);
    ctx.lineTo(triRight.x, triRight.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(triTop.x, triTop.y);
    ctx.lineTo(triLeft.x, triLeft.y);
    ctx.lineTo(triRight.x, triRight.y);
    ctx.closePath();
    ctx.stroke();

    // 中央亮眼（三角形内部偏上一点）
    this._drawGlow(0, 0, r * 0.62, isHit ? '#ff3c3c' : '#80a8ff', 0.5);
    ctx.fillStyle = isHit ? '#ff8888' : '#80a8ff';
    ctx.beginPath();
    ctx.arc(0, r * 0.0, r * 0.32, 0, Math.PI * 2);
    ctx.fill();

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

  // ── 怪物5：裂角突袭者（轮廓重点：尖、窄、向前冲）────────────────────
  _drawCharger(enemy, time, player) {
    const ctx = this.ctx;
    const s = Utils.worldToScreen(enemy.x, enemy.y, this.cam);
    const sx = Math.round(s.x);
    const sy = Math.round(s.y);
    const r  = enemy.radius || 16;
    const cfg = CONFIG.NEW_ENEMY;
    const st = enemy.chargerState || 'chase';
    const aiming = (st === 'windup' || st === 'charge');
    const aim = aiming
      ? Math.atan2(enemy.chargeDirY || 0, enemy.chargeDirX != null ? enemy.chargeDirX : 1)
      : (player ? Math.atan2(player.y - enemy.y, player.x - enemy.x) : 0);
    const bob = Math.sin(time * 6 + enemy.id * 1.3) * 1.2;
    // 蓄势：身体向后压低；冲锋：身体前倾
    const lean = st === 'windup' ? -5 : (st === 'charge' ? 4 : 0);
    const windupT = st === 'windup'
      ? Math.min(1, 1 - (enemy.chargerTimer || 0) / cfg.CHARGER_WINDUP) : 0;

    ctx.save();
    const spawn = enemy.spawnTimer != null ? enemy.spawnTimer : 1;
    const scaleM = 0.3 + spawn * 0.7;
    ctx.translate(sx, sy + bob);
    ctx.scale(scaleM, scaleM);
    ctx.globalAlpha = Math.min(1, spawn * 1.5);

    // 冲锋拖尾：暗红碎线（不能画成弹球完整光尾）
    if (st === 'charge') {
      ctx.save();
      ctx.rotate(aim);
      ctx.strokeStyle = 'rgba(150,32,20,0.6)';
      ctx.lineWidth = 3;
      for (let i = 1; i <= cfg.CHARGER_TRAIL_COUNT; i++) {
        const t0 = i * cfg.CHARGER_TRAIL_STEP + 8;
        const t1 = t0 + cfg.CHARGER_TRAIL_STEP * 0.55;
        const off = ((i + enemy.id) % 2 ? 1 : -1) * r * 0.34;
        ctx.globalAlpha = Math.min(1, spawn * 1.5) * (1 - i / (cfg.CHARGER_TRAIL_COUNT + 2));
        ctx.beginPath();
        ctx.moveTo(-t0, off);
        ctx.lineTo(-t1, off * 0.55);
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = Math.min(1, spawn * 1.5);
    }

    ctx.save();
    ctx.rotate(aim);

    // 橙红色窄长身体
    ctx.fillStyle = 'rgba(255,112,67,0.16)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.88, r * 1.15, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    this._drawGlow(0, 0, r * 1.7, '#ff5722', 0.26);

    ctx.fillStyle = '#3a1208';
    ctx.beginPath();
    ctx.ellipse(lean, 0, r * 1.42, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff7043';
    ctx.beginPath();
    ctx.ellipse(lean, 0, r * 1.3, r * 0.68, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(120,22,12,0.5)';
    ctx.beginPath();
    ctx.ellipse(lean - r * 0.25, 0, r * 0.85, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    // 后方短小足爪
    ctx.fillStyle = '#1a0806';
    for (let i = 0; i < 3; i++) {
      const lx = -r * (0.5 + i * 0.34) + lean;
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(lx, sgn * r * 0.5);
        ctx.lineTo(lx - r * 0.22, sgn * r * 0.92);
        ctx.lineTo(lx - r * 0.04, sgn * r * 0.56);
        ctx.closePath();
        ctx.fill();
      }
    }

    // 前方两枚黑色裂角（蓄势时变亮）
    const hornGlow = aiming ? 0.4 + windupT * 0.5 : 0.12;
    this._drawGlow(r * 1.15 + lean, 0, r * 0.8, '#ffb070', hornGlow * 0.55);
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(r * 0.95 + lean, sgn * r * 0.34);
      ctx.lineTo(r * 1.74 + lean, sgn * r * 0.1);
      ctx.lineTo(r * 1.02 + lean, sgn * r * 0.04);
      ctx.closePath();
      ctx.fillStyle = '#120604';
      ctx.fill();
      if (aiming) {
        ctx.strokeStyle = `rgba(255,176,112,${0.3 + windupT * 0.6})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // 中央一只明显红眼
    this._drawGlow(r * 0.32 + lean, 0, r * 0.62, '#ff2010', 0.5);
    ctx.fillStyle = '#ff2010';
    ctx.beginPath();
    ctx.ellipse(r * 0.32 + lean, 0, r * 0.32, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd0c0';
    ctx.beginPath();
    ctx.arc(r * 0.26 + lean, -r * 0.08, r * 0.08, 0, Math.PI * 2);
    ctx.fill();

    // 暗色实体轮廓
    ctx.strokeStyle = '#20090a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(lean, 0, r * 1.3, r * 0.68, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();

    this._drawHpBar(enemy, r * 1.2);
    this._drawHitFlash(enemy, r);
    ctx.restore();
  },

  // ── 怪物6：重甲守卫（轮廓重点：宽、重、慢）────────────────────────
  _drawBulwark(enemy, time, player) {
    const ctx = this.ctx;
    const s = Utils.worldToScreen(enemy.x, enemy.y, this.cam);
    const sx = Math.round(s.x);
    const sy = Math.round(s.y);
    const r  = enemy.radius || 24;
    const hit = enemy.hitTimer > 0;
    // 移动时身体缓慢左右摆动
    const sway = Math.sin(time * 2 + (enemy.swayPhase || 0)) * 0.07;

    ctx.save();
    const spawn = enemy.spawnTimer != null ? enemy.spawnTimer : 1;
    const scaleM = 0.3 + spawn * 0.7;
    ctx.translate(sx, sy);
    ctx.scale(scaleM, scaleM);
    ctx.globalAlpha = Math.min(1, spawn * 1.5);
    ctx.rotate(sway);

    // 地面投影
    ctx.fillStyle = 'rgba(136,59,76,0.22)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.85, r * 1.05, r * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();

    // 两侧短而粗的足爪
    ctx.fillStyle = '#241016';
    for (const sgn of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const ly = (i - 1) * r * 0.52;
        ctx.beginPath();
        ctx.moveTo(sgn * r * 0.7, ly);
        ctx.lineTo(sgn * r * 1.2, ly + r * 0.16);
        ctx.lineTo(sgn * r * 0.7, ly + r * 0.32);
        ctx.closePath();
        ctx.fill();
      }
    }

    this._drawGlow(0, 0, r * 1.4, '#883b4c', 0.28);

    // 六边形宽厚甲壳（暗红黑）
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      const px = Math.cos(a) * r * 1.1;
      const py = Math.sin(a) * r * 0.94;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = '#241018';
    ctx.fill();
    ctx.fillStyle = hit ? '#a84a58' : '#883b4c';
    ctx.fill();
    ctx.strokeStyle = '#160710';
    ctx.lineWidth = 3;
    ctx.stroke();

    // 正面厚甲分块（受击时甲片局部闪红，不全身闪白）
    const plateCol = hit ? 'rgba(255,70,70,0.5)' : 'rgba(20,6,12,0.55)';
    const plateHi  = hit ? 'rgba(255,120,110,0.85)' : 'rgba(150,80,95,0.45)';
    for (const sgn of [-1, 1]) {
      ctx.fillStyle = plateCol;
      ctx.beginPath();
      ctx.moveTo(sgn * r * 0.18, -r * 0.72);
      ctx.lineTo(sgn * r * 0.95, -r * 0.34);
      ctx.lineTo(sgn * r * 0.95, r * 0.34);
      ctx.lineTo(sgn * r * 0.18, r * 0.72);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = plateHi;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.strokeStyle = plateHi;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.16, -r * 0.78);
    ctx.lineTo(-r * 0.16, r * 0.78);
    ctx.moveTo(r * 0.16, -r * 0.78);
    ctx.lineTo(r * 0.16, r * 0.78);
    ctx.stroke();

    // 生命较低时甲壳裂纹（仅视觉反馈，不增加战斗阶段）
    const hpPct = enemy.hp / (enemy.maxHp || 1);
    if (hpPct < 0.5) {
      ctx.strokeStyle = 'rgba(12,4,8,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.62, -r * 0.5);
      ctx.lineTo(-r * 0.3, -r * 0.12);
      ctx.lineTo(-r * 0.52, r * 0.22);
      ctx.moveTo(r * 0.55, -r * 0.38);
      ctx.lineTo(r * 0.32, r * 0.02);
      ctx.lineTo(r * 0.58, r * 0.34);
      if (hpPct < 0.25) {
        ctx.moveTo(-r * 0.05, -r * 0.62);
        ctx.lineTo(r * 0.12, -r * 0.2);
        ctx.lineTo(-r * 0.02, r * 0.3);
      }
      ctx.stroke();
    }

    // 中央窄红眼
    this._drawGlow(0, 0, r * 0.48, '#ff2424', 0.35);
    ctx.fillStyle = '#18060a';
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.36, r * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff2424';
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.28, r * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();

    this._drawHpBar(enemy, r * 1.05);
    ctx.restore();
  },

  // ── 怪物7：灰烬投手（轮廓重点：圆腹、背囊、抛投）──────────────────
  _drawLobber(enemy, time, player) {
    const ctx = this.ctx;
    const s = Utils.worldToScreen(enemy.x, enemy.y, this.cam);
    const sx = Math.round(s.x);
    const sy = Math.round(s.y);
    const r  = enemy.radius || 17;
    const windup = enemy.lobState === 'windup';
    const pulse  = enemy.podPulse || 0;
    const bob = Math.sin(time * 3 + enemy.id * 1.1) * 1.2;
    const aim = player ? Math.atan2(player.y - enemy.y, player.x - enemy.x) : 0;

    ctx.save();
    const spawn = enemy.spawnTimer != null ? enemy.spawnTimer : 1;
    const scaleM = 0.3 + spawn * 0.7;
    ctx.translate(sx, sy + bob);
    ctx.scale(scaleM, scaleM);
    ctx.globalAlpha = Math.min(1, spawn * 1.5);

    // 地面投影
    ctx.fillStyle = 'rgba(143,51,68,0.2)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.92, r * 0.85, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();

    // 下方数条短黑爪
    ctx.fillStyle = '#160a0c';
    for (let i = -2; i <= 2; i++) {
      const lx = i * r * 0.32;
      ctx.beginPath();
      ctx.moveTo(lx - r * 0.1, r * 0.6);
      ctx.lineTo(lx, r * 1.02);
      ctx.lineTo(lx + r * 0.12, r * 0.6);
      ctx.closePath();
      ctx.fill();
    }

    this._drawGlow(0, 0, r * 1.6, '#8f3344', 0.28);

    // 深红色圆腹
    ctx.fillStyle = '#2a0e14';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8f3344';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(60,16,26,0.55)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.28, r * 0.62, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // 正面一只红眼
    this._drawGlow(r * 0.12, -r * 0.18, r * 0.55, '#ff2418', 0.5);
    ctx.fillStyle = '#ff2418';
    ctx.beginPath();
    ctx.ellipse(r * 0.12, -r * 0.18, r * 0.26, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd0c0';
    ctx.beginPath();
    ctx.arc(r * 0.05, -r * 0.26, r * 0.07, 0, Math.PI * 2);
    ctx.fill();

    // 头顶偏后的灰烬囊（橙红裂纹；抬手时收缩发亮）
    const podScale = windup ? (1 - 0.22 * pulse) : 1;
    const podX = -r * 0.42, podY = -r * 1.02;
    const podR = r * 0.62 * podScale;
    this._drawGlow(podX, podY, podR * (windup ? 2.4 : 1.7), '#ff7a2a',
      windup ? 0.35 + 0.45 * pulse : 0.3);
    ctx.fillStyle = '#2c1012';
    ctx.beginPath();
    ctx.arc(podX, podY, podR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = windup ? '#a83c28' : '#7a2a24';
    ctx.beginPath();
    ctx.arc(podX, podY, podR * 0.82, 0, Math.PI * 2);
    ctx.fill();
    // 囊体橙红裂缝
    ctx.strokeStyle = `rgba(255,122,42,${windup ? 0.7 + 0.3 * pulse : 0.55})`;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const a = i * 2.05 + 0.5 + enemy.id * 0.3;
      ctx.beginPath();
      ctx.moveTo(podX + Math.cos(a) * podR * 0.2, podY + Math.sin(a) * podR * 0.2);
      ctx.lineTo(podX + Math.cos(a + 0.4) * podR * 0.78, podY + Math.sin(a + 0.4) * podR * 0.78);
      ctx.stroke();
    }
    ctx.strokeStyle = '#200a0c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(podX, podY, podR * 0.82, 0, Math.PI * 2);
    ctx.stroke();

    // 暗色实体轮廓
    ctx.strokeStyle = '#20090a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2);
    ctx.stroke();

    this._drawHpBar(enemy, r * 0.95);
    this._drawHitFlash(enemy, r);
    ctx.restore();
  },

  // ── 敌方地面预警（地面层：敌人之下绘制；顶层只补细边线）──────────────
  drawEnemyGroundFx(cam, time, enemies, bombs) {
    const ctx = this.ctx;
    const cfg = CONFIG.NEW_ENEMY;

    // 灰烬投手落点预警：暗红半透明地面 + 橙红外圈 + 中心尖齿标记
    for (let i = 0; i < bombs.length; i++) {
      const b = bombs[i];
      const u = Math.min(1, b.t / b.flight);
      const shrink = 1 - u * 0.12; // 边缘逐渐收拢到爆炸时刻（不高频闪烁）
      const s = Utils.worldToScreen(b.tx, b.ty, cam);
      const rr = b.radius * shrink;
      ctx.fillStyle = 'rgba(150,32,20,0.2)';
      ctx.beginPath();
      ctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,110,50,0.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
      ctx.stroke();
      // 中心敌方尖齿 / 三角标记
      ctx.fillStyle = 'rgba(255,110,50,0.8)';
      for (let k = 0; k < 3; k++) {
        const a = -Math.PI / 2 + k * (Math.PI * 2 / 3);
        const ca = Math.cos(a), sa = Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(s.x + ca * rr * 0.18, s.y + sa * rr * 0.18);
        ctx.lineTo(s.x + ca * rr * 0.55 - sa * rr * 0.2, s.y + sa * rr * 0.55 + ca * rr * 0.2);
        ctx.lineTo(s.x + ca * rr * 0.55 + sa * rr * 0.2, s.y + sa * rr * 0.55 - ca * rr * 0.2);
        ctx.closePath();
        ctx.fill();
      }
    }

    // 裂角突袭者冲锋预警：狭长暗红通道 + 末端朝前三角箭头
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive || e.type !== 'charger' || e.chargerState !== 'windup') continue;
      const windupT = Math.min(1, 1 - (e.chargerTimer || 0) / cfg.CHARGER_WINDUP);
      const ang = Math.atan2(e.chargeDirY || 0, e.chargeDirX != null ? e.chargeDirX : 1);
      const dirX = Math.cos(ang), dirY = Math.sin(ang);
      const perpX = -dirY, perpY = dirX;
      const halfW = cfg.CHARGER_WARN_WIDTH / 2;
      const len = cfg.CHARGER_MAX_DIST;
      const ax = e.x + perpX * halfW,  ay = e.y + perpY * halfW;
      const bx2 = e.x + dirX * len + perpX * halfW, by2 = e.y + dirY * len + perpY * halfW;
      const cx = e.x + dirX * len - perpX * halfW, cy = e.y + dirY * len - perpY * halfW;
      const dx = e.x - perpX * halfW, dy = e.y - perpY * halfW;
      const p1 = Utils.worldToScreen(ax, ay, cam);
      const p2 = Utils.worldToScreen(bx2, by2, cam);
      const p3 = Utils.worldToScreen(cx, cy, cam);
      const p4 = Utils.worldToScreen(dx, dy, cam);
      const alpha = 0.16 + 0.22 * windupT;
      ctx.fillStyle = `rgba(170,30,24,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.lineTo(p4.x, p4.y);
      ctx.closePath();
      ctx.fill();
      // 末端朝前三角箭头
      const tipW = halfW * 1.5;
      const t0 = Utils.worldToScreen(e.x + dirX * len, e.y + dirY * len, cam);
      const t1 = Utils.worldToScreen(
        e.x + dirX * (len + 30) + perpX * tipW,
        e.y + dirY * (len + 30) + perpY * tipW, cam);
      const t2 = Utils.worldToScreen(
        e.x + dirX * (len + 30) - perpX * tipW,
        e.y + dirY * (len + 30) - perpY * tipW, cam);
      ctx.fillStyle = `rgba(190,40,28,${alpha + 0.16})`;
      ctx.beginPath();
      ctx.moveTo(t1.x, t1.y);
      ctx.lineTo(t2.x, t2.y);
      ctx.lineTo(t0.x, t0.y);
      ctx.closePath();
      ctx.fill();
    }

    // 爆炸碎焰 / 地面焦痕
    const fx = (typeof LobberBombs !== 'undefined') ? LobberBombs.fx : null;
    if (!fx) return;
    for (let i = 0; i < fx.length; i++) {
      const f = fx[i];
      const s = Utils.worldToScreen(f.x, f.y, cam);
      const t = 1 - f.life / f.maxLife;
      if (f.kind === 'scorch') {
        const a = Math.min(1, f.life / f.maxLife) * 0.5;
        ctx.fillStyle = `rgba(30,12,10,${a})`;
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, f.radius * (0.8 + t * 0.3), f.radius * 0.55 * (0.8 + t * 0.3), 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // 橙红碎焰扩散环（不使用蓝白雷 / 白蚀爆裂视觉，不触发全屏白闪）
        const a = Math.min(1, f.life / f.maxLife);
        this._drawGlow(s.x, s.y, f.radius * (0.7 + t * 0.8), '#ff6a2a', 0.35 * a);
        ctx.strokeStyle = `rgba(255,120,50,${0.55 * a})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(s.x, s.y, f.radius * (0.35 + t * 0.85), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  },

  // 敌方预警细边线补绘（顶层）：只重绘轮廓保持可读，不把整块危险区画到角色上方
  drawEnemyWarnEdges(cam, time, enemies, bombs) {
    const ctx = this.ctx;
    const cfg = CONFIG.NEW_ENEMY;
    ctx.save();
    ctx.lineWidth = 1.5;
    for (let i = 0; i < bombs.length; i++) {
      const b = bombs[i];
      const u = Math.min(1, b.t / b.flight);
      const shrink = 1 - u * 0.12;
      const s = Utils.worldToScreen(b.tx, b.ty, cam);
      ctx.strokeStyle = 'rgba(255,130,60,0.8)';
      ctx.beginPath();
      ctx.arc(s.x, s.y, b.radius * shrink, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive || e.type !== 'charger' || e.chargerState !== 'windup') continue;
      const ang = Math.atan2(e.chargeDirY || 0, e.chargeDirX != null ? e.chargeDirX : 1);
      const dirX = Math.cos(ang), dirY = Math.sin(ang);
      const perpX = -dirY, perpY = dirX;
      const halfW = cfg.CHARGER_WARN_WIDTH / 2;
      const len = cfg.CHARGER_MAX_DIST;
      const a = Utils.worldToScreen(e.x + perpX * halfW, e.y + perpY * halfW, cam);
      const b2 = Utils.worldToScreen(e.x + dirX * len + perpX * halfW, e.y + dirY * len + perpY * halfW, cam);
      const c = Utils.worldToScreen(e.x + dirX * len - perpX * halfW, e.y + dirY * len - perpY * halfW, cam);
      const d = Utils.worldToScreen(e.x - perpX * halfW, e.y - perpY * halfW, cam);
      ctx.strokeStyle = 'rgba(255,110,70,0.55)';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b2.x, b2.y);
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
    }
    ctx.restore();
  },

  // 灰烬投手炸弹（抛物线飞行；高度偏移只影响绘制，不改变爆炸坐标）
  drawLobberBomb(b, time) {
    const ctx = this.ctx;
    const cfg = CONFIG.NEW_ENEMY;
    const u = Math.min(1, b.t / b.flight);
    const h = cfg.LOB_ARC_HEIGHT * 4 * u * (1 - u);
    const s = Utils.worldToScreen(b.x, b.y, this.cam);
    const r = cfg.LOB_BOMB_RADIUS;

    // 地面投影
    ctx.save();
    ctx.fillStyle = 'rgba(20,6,8,0.32)';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, r * (1.15 - u * 0.3), r * 0.55 * (1.15 - u * 0.3), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const bx = s.x, by = s.y - h;
    ctx.save();
    ctx.translate(bx, by);
    this._drawGlow(0, 0, r * 2.1, '#ff6a2a', 0.4);
    // 暗红外壳
    ctx.fillStyle = '#3a1214';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7a2620';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2);
    ctx.fill();
    // 橙色裂缝
    ctx.strokeStyle = '#ff7a2a';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + 0.6;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25);
      ctx.lineTo(Math.cos(a + 0.35) * r * 0.8, Math.sin(a + 0.35) * r * 0.8);
      ctx.stroke();
    }
    ctx.strokeStyle = '#200a0c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2);
    ctx.stroke();
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
    // 外圈血光晕（光晕贴图替代 radialGradient + shadowBlur）
    this._drawGlow(0, 0, r * 1.35, '#ff5050', 0.55);

    // 眼白（主体圆，淡黄白底带血丝）
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

    // 红色虹膜（发光用光晕贴图）
    this._drawGlow(0, 0, r * 0.85, '#ff2030', 0.5);
    const iris = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r * 0.55);
    iris.addColorStop(0, '#ff5050');
    iris.addColorStop(0.7, '#cc1010');
    iris.addColorStop(1, '#660505');
    ctx.fillStyle = iris;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
    ctx.fill();

    // 瞳孔
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    this._drawGlow(-r * 0.08, -r * 0.08, r * 0.18, '#ff8080', 0.6);
    ctx.fillStyle = '#ff8080';
    ctx.beginPath();
    ctx.arc(-r * 0.08, -r * 0.08, r * 0.08, 0, Math.PI * 2);
    ctx.fill();

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
      // 渐变坐标固定（屏幕居中 260 宽），按分辨率缓存复用
      const gkey = 'bossbar|' + cam.sw;
      if (this._gradCacheKey !== gkey || !this._bossBarGrad) {
        this._gradCacheKey = gkey;
        const g1 = ctx.createLinearGradient(sx - rx, 0, sx + rx, 0);
        g1.addColorStop(0,    '#ff3040');
        g1.addColorStop(0.5,  '#ff8090');
        g1.addColorStop(1,    '#ffc0c0');
        this._bossBarGrad = g1;
        const g2 = ctx.createLinearGradient(sx - rx, 0, sx + rx, 0);
        g2.addColorStop(0,   'rgba(255,255,255,0)');
        g2.addColorStop(0.5, 'rgba(255,255,255,0.5)');
        g2.addColorStop(1,   'rgba(255,255,255,0)');
        this._bossBarShim = g2;
      }
      ctx.fillStyle = this._bossBarGrad;
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
      const shimX = sx - rx + ((time * 80) % (bw + 200)) - 200;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(sx - rx, sy - ry, bw * pct, bh, 10);
      ctx.clip();
      ctx.fillStyle = this._bossBarShim;
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
        // 链节（虚线 + 红色光晕，光晕用宽半透明线替代 shadowBlur）
        ctx.shadowBlur = 0;
        ctx.setLineDash([10, 6]);
        ctx.strokeStyle = `rgba(255,32,48,${0.22 * pulse})`;
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.moveTo(a1.x, a1.y);
        ctx.lineTo(a2.x, a2.y);
        ctx.stroke();
        ctx.strokeStyle = '#ff2030';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(a1.x, a1.y);
        ctx.lineTo(a2.x, a2.y);
        ctx.stroke();
        // 中线（深红）
        ctx.strokeStyle = '#7a0000';
        ctx.lineWidth = 2;
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
        ctx.fillStyle = '#ff5060';
        for (let s = 20; s < len; s += 28) {
          const px = a1.x + dx * (s / len);
          const py = a1.y + dy * (s / len);
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

    // 发光光晕（替代 shadowBlur）
    this._drawGlow(0, 0, r * 2.1, '#6600cc', 0.8);

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
    const col = b.color || '#c97bff';
    // 发光光晕（替代 shadowBlur）
    this._drawGlow(sx, sy, r * 2.6, b.color || '#a259ff', 0.55);
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    // 敌方黄色子弹：边缘加暗红圆圈线
    if (b.owner === 'enemy') {
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
    ctx.globalAlpha = 1;
  },

  // ── RICOCHET（流派 4：弹球 / 蓄能 / 磁极 / 电磁场 / 特效）────────────────
  // 弹球：黑紫球体 + 冷紫轮廓 + 固定长度短拖尾（不用普通子弹的拉长视觉）
  drawRicochetBall(ball, cam, time) {
    const ctx = this.ctx;
    const s = Utils.worldToScreen(ball.x, ball.y, cam);
    const sx = Math.round(s.x);
    const sy = Math.round(s.y);
    const r = ball.radius || 16;

    // 短拖尾（固定长度缓冲，逐点渐隐；速度越快拖尾视觉略增强，不改物理缓冲）
    const trail = ball.trail;
    if (trail && trail.length > 1) {
      const spdNow = Math.hypot(ball.vx, ball.vy);
      const tb = 1 + Math.min(0.35, Math.max(0, (spdNow / CONFIG.RICOCHET.BALL_SPEED) - 1) * 0.35);
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 1; i < trail.length; i++) {
        const p0 = Utils.worldToScreen(trail[i - 1].x, trail[i - 1].y, cam);
        const p1 = Utils.worldToScreen(trail[i].x, trail[i].y, cam);
        const a = (i / trail.length) * 0.35 * tb;
        ctx.strokeStyle = 'rgba(162,89,255,' + a.toFixed(3) + ')';
        ctx.lineWidth = (r * 0.6) * (i / trail.length) * tb;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 凝聚阶段：半透明收缩球
    if (ball.spawning) {
      const t = 1 - Math.max(0, ball.spawnTimer / CONFIG.RICOCHET.SPAWN_CHARGE_TIME);
      ctx.save();
      this._drawGlow(sx, sy, r * (2.2 - t * 0.8), '#b26bff', 0.5 * (0.4 + t * 0.6));
      ctx.globalAlpha = 0.45 + t * 0.4;
      ctx.fillStyle = '#2a0a4a';
      ctx.beginPath();
      ctx.arc(sx, sy, r * (0.5 + t * 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // ── 状态视觉（普通 / 蓄能 / 雷核 / 雷霆 / 导电）────────────────────
    const boosted = ball.boostTimer > 0;
    const isThunderBall = ball.state === 'thunderBall';
    const isThunderCore = ball.state === 'thunderCore';
    const isThunder = isThunderBall || isThunderCore;
    const isCharging = ball.state === 'charging' || ball.state === 'aiming';
    const conductive = !!ball.conductive;

    // 发光光晕（雷霆更亮；导电偏青紫）
    const glowR = r * (isThunder ? 3.2 : boosted ? 3.0 : 2.5);
    const glowColor = isThunder ? '#7de3ff' : conductive ? '#8f7bff' : '#b26bff';
    this._drawGlow(sx, sy, glowR, glowColor, isThunder ? 0.85 : boosted ? 0.8 : 0.6);

    // 球体：径向渐变（雷霆 = 蓝白雷核；普通 = 黑紫）
    const grad = ctx.createRadialGradient(
      sx - r * 0.35, sy - r * 0.4, r * 0.2,
      sx, sy, r
    );
    if (isThunder) {
      grad.addColorStop(0, '#eaf9ff');
      grad.addColorStop(0.35, isThunderCore ? '#6a56c8' : '#3a6ad8');
      grad.addColorStop(1, '#0d1230');
    } else if (isCharging) {
      grad.addColorStop(0, '#5a2aa8');
      grad.addColorStop(0.55, '#241041');
      grad.addColorStop(1, '#0d0219');
    } else {
      grad.addColorStop(0, '#4a1c82');
      grad.addColorStop(0.55, '#22083e');
      grad.addColorStop(1, '#0d0219');
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, sy, r * (isThunderBall ? 1.12 : 1), 0, Math.PI * 2);
    ctx.fill();

    // 棱面高光（两三道短弧，避免圆滑球）
    ctx.save();
    ctx.globalAlpha = isThunder ? 0.7 : 0.5;
    ctx.strokeStyle = isThunder ? '#dff8ff' : '#d9b8ff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 0.72, -2.4, -1.4);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx, sy, r * 0.86, -1.1, -0.55);
    ctx.stroke();
    ctx.restore();

    // 轮廓（导电偏蓝紫；雷霆偏青白）
    const outline = isThunder ? (isThunderBall ? '#9fe8ff' : '#b7a8ff')
      : conductive ? '#7d9bff'
      : isCharging ? '#9d68ff'
      : boosted ? '#d9b8ff'
      : '#9a6bff';
    ctx.strokeStyle = outline;
    ctx.lineWidth = isThunderBall ? 2.8 : 2.2;
    ctx.beginPath();
    ctx.arc(sx, sy, r * (isThunderBall ? 1.12 : 1), 0, Math.PI * 2);
    ctx.stroke();

    // 雷霆 / 导电 / 过载：不规则短电弧（局部、少量）
    if (isThunder || conductive || ball.overloadT > 0) {
      this._drawBallArcs(ctx, sx, sy, r, time,
        isThunder ? 4 : conductive ? 2 : 2,
        isThunder ? '#9fe8ff' : '#7d9bff');
    }

    // 雷霆球剩余碰撞预算表现：外圈电弧密度 / 临界过载闪烁（不显数字）
    if (isThunder) {
      const maxI = isThunderBall ? CONFIG.THUNDER_BALL.maxImpacts : CONFIG.THUNDER_CORE.maxImpacts;
      const left = Math.max(0, maxI - (ball.thunderHits || 0));
      if (left <= 3) {
        const blink = 0.5 + 0.5 * Math.sin(time * 18);
        ctx.save();
        ctx.strokeStyle = 'rgba(223,248,255,' + (0.3 + 0.5 * blink).toFixed(3) + ')';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(sx, sy, r * (1.3 + 0.12 * blink), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      // 爆炸前快速收缩提示
      if (ball.thunderShrink > 0) {
        const k = 1 - ball.thunderShrink;
        ctx.save();
        ctx.strokeStyle = 'rgba(223,248,255,' + (0.4 + 0.5 * k).toFixed(3) + ')';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(sx, sy, r * (1.6 - k * 0.5), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 边界撞击瞬间表面短暂变亮（暗影轨道场反馈；少量白色仅用于撞击瞬间）
    if (ball.impactFlash > 0) {
      const fa = Math.min(1, ball.impactFlash / 0.18);
      ctx.save();
      ctx.strokeStyle = 'rgba(232,216,255,' + (0.7 * fa).toFixed(3) + ')';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(sx, sy, r * (1 + 0.12 * fa), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 加速：沿速度方向的短拉伸光（不拉大球本体）
    if (boosted) {
      const ang = Math.atan2(ball.vy, ball.vx);
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = '#d9b8ff';
      ctx.lineWidth = r * 0.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sx - Math.cos(ang) * r * 1.1, sy - Math.sin(ang) * r * 1.1);
      ctx.lineTo(sx - Math.cos(ang) * r * 2.2, sy - Math.sin(ang) * r * 2.2);
      ctx.stroke();
      ctx.restore();
    }
  },

  // 弹球表面短电弧（随时间跳动的不规则短线；数量少、长度短）
  _drawBallArcs(ctx, sx, sy, r, time, count, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const a = time * 3.1 + i * 2.2;
      const r0 = r * (1.02 + 0.1 * Math.sin(time * 5 + i));
      const r1 = r * (1.35 + 0.12 * Math.sin(time * 7 + i * 1.7));
      const a1 = a + 0.5 * Math.sin(time * 9 + i);
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(time * 11 + i * 2.3);
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(a) * r0, sy + Math.sin(a) * r0);
      ctx.lineTo(sx + Math.cos(a1) * r1, sy + Math.sin(a1) * r1);
      ctx.stroke();
    }
    ctx.restore();
  },

  // 磁极残核（死亡暗影适配）：黑紫核心 + 断裂蓝紫磁环 + 偶发微小电弧
  drawMagneticNode(node, cam, time) {
    const ctx = this.ctx;
    const s = Utils.worldToScreen(node.x, node.y, cam);
    const sx = Math.round(s.x);
    const sy = Math.round(s.y);
    const r = node.radius || 32;
    const frozen = !!node.frozen;

    ctx.save();
    // 冷蓝（冰封死者）/ 蓝紫磁环
    const ringColor = frozen ? 'rgba(125,227,255,' : 'rgba(122,106,255,';
    const coreColor = frozen ? '#12324a' : '#160b38';

    // 底部暗色核心（不使用三缺口圆环 / 不使用吸附盘）
    this._drawGlow(sx, sy, r * 1.2, frozen ? '#3ec8e8' : '#6e36c9', 0.4);
    const g = ctx.createRadialGradient(sx, sy, r * 0.15, sx, sy, r * 0.85);
    g.addColorStop(0, coreColor);
    g.addColorStop(1, 'rgba(9,5,28,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 0.85, 0, Math.PI * 2);
    ctx.fill();

    // 断裂磁环（两圈反向缓转断弧）
    ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const rr = r * (0.72 + i * 0.22);
      const rot = time * (i === 0 ? 0.55 : -0.4) + node.id * 0.8;
      ctx.strokeStyle = ringColor + (0.35 - i * 0.1).toFixed(2) + ')';
      ctx.lineWidth = 1.8;
      for (let k = 0; k < 3; k++) {
        const a0 = rot + k * 2.1;
        ctx.beginPath();
        ctx.arc(sx, sy, rr, a0, a0 + 0.75);
        ctx.stroke();
      }
    }

    // 中心偶发微小电弧
    const spark = Math.sin(time * 6 + node.id) > 0.75;
    if (spark) {
      ctx.strokeStyle = frozen ? 'rgba(189,240,255,0.8)' : 'rgba(157,104,255,0.75)';
      ctx.lineWidth = 1.3;
      const a = time * 2.4 + node.id;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(a) * r * 0.5, sy + Math.sin(a) * r * 0.5);
      ctx.lineTo(sx + Math.cos(a + 0.7) * r * 0.8, sy + Math.sin(a + 0.7) * r * 0.8);
      ctx.stroke();
    }

    // 剩余激活次数（少量小点）
    for (let i = 0; i < CONFIG.MAGNETIC_NODE.maxActivationsPerNode; i++) {
      ctx.fillStyle = i < node.uses ? ringColor + '0.75)' : 'rgba(120,120,140,0.3)';
      ctx.beginPath();
      ctx.arc(sx - 5 + i * 10, sy - r * 0.85 - 6, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },

  // 电磁场：快速扩散的断裂电弧环 + 低亮度电场 + 内部短电弧（非漩涡 / 非圆盘）
  drawMagneticField(field, cam, time) {
    const ctx = this.ctx;
    const s = Utils.worldToScreen(field.x, field.y, cam);
    const sx = Math.round(s.x);
    const sy = Math.round(s.y);
    const r = Math.max(1, field.radius);
    const lifeK = Math.max(0, 1 - field.t / field.life);   // 1 → 0
    const expanding = field.t < field.expandDur;

    ctx.save();
    // 低亮度电场底（稳定阶段淡蓝紫，不遮挡敌人）
    const g = ctx.createRadialGradient(sx, sy, r * 0.1, sx, sy, r);
    g.addColorStop(0, 'rgba(60,90,216,' + (0.10 * lifeK).toFixed(3) + ')');
    g.addColorStop(0.75, 'rgba(110,54,201,' + (0.10 * lifeK).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(110,54,201,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();

    // 外圈断裂弧段（2~4 层速度不同的电弧环；扩散时更亮）
    const layers = expanding ? 3 : 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < layers; i++) {
      const rr = r * (0.86 + i * 0.07);
      const rot = time * (2.2 - i * 0.6) * (i % 2 === 0 ? 1 : -1) + field.id;
      const la = (expanding ? 0.5 : 0.22) * lifeK;
      ctx.strokeStyle = i % 2 === 0
        ? 'rgba(81,217,255,' + la.toFixed(3) + ')'
        : 'rgba(122,106,255,' + la.toFixed(3) + ')';
      ctx.lineWidth = expanding ? 2.6 : 1.6;
      for (let k = 0; k < 4; k++) {
        const a0 = rot + k * 1.55;
        ctx.beginPath();
        ctx.arc(sx, sy, rr, a0, a0 + 0.55 + 0.2 * Math.sin(time * 3 + k));
        ctx.stroke();
      }
    }

    // 内部高速旋转短电弧
    const innerCount = expanding ? 5 : 3;
    for (let i = 0; i < innerCount; i++) {
      const a = time * 4.2 + i * 2.0 + field.id * 0.7;
      const rr0 = r * 0.25, rr1 = r * 0.62;
      ctx.strokeStyle = 'rgba(159,232,255,' + (0.3 * lifeK).toFixed(3) + ')';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(a) * rr0, sy + Math.sin(a) * rr0);
      ctx.lineTo(sx + Math.cos(a + 0.9) * rr1, sy + Math.sin(a + 0.9) * rr1);
      ctx.stroke();
    }

    // 消失阶段：从外向内收缩
    if (!expanding && lifeK < 0.25) {
      ctx.strokeStyle = 'rgba(223,248,255,' + (0.35 * (0.25 - lifeK) * 4).toFixed(3) + ')';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(sx, sy, r * (0.5 + lifeK * 2), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  },

  // 蓄能环 + 发射方向箭头（玩家脚下；蓄能期随进度闭合，锁定后箭头变亮）
  drawChargeRing(player, chg, time) {
    const ctx = this.ctx;
    const s = Utils.worldToScreen(player.x, player.y, this.cam);
    const sx = Math.round(s.x);
    const sy = Math.round(s.y);
    const cc = CONFIG.CHARGED_BALL;
    const R = cc.orbitRadius + 8;

    let progress = 0;
    if (chg.phase === 'charge') {
      progress = Math.min(1, chg.chargeT / cc.orbitDuration);
    } else if (chg.phase === 'recall') {
      progress = 0.08;
    }

    ctx.save();
    // 不完整蓄能环：随蓄能进度逐渐闭合（暗紫 → 蓝紫）
    const endAng = -Math.PI / 2 + Math.PI * 2 * progress;
    const col = chg.locked ? 'rgba(81,217,255,' : 'rgba(157,104,255,';
    ctx.strokeStyle = col + '0.75)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(sx, sy, R, -Math.PI / 2, endAng);
    ctx.stroke();
    // 底圈极淡完整环（空间参考）
    ctx.strokeStyle = 'rgba(110,54,201,0.18)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(sx, sy, R, 0, Math.PI * 2);
    ctx.stroke();

    // 方向箭头：发射前 0.45s 出现，0.25s 锁定变亮
    const remain = cc.orbitDuration - chg.chargeT;
    if (chg.phase === 'charge' && remain <= cc.aimWindowDuration) {
      const dirX = chg.locked ? chg.launchX : chg.moveDirX;
      const dirY = chg.locked ? chg.launchY : chg.moveDirY;
      const ang = Math.atan2(dirY, dirX);
      const a0 = R + 12, a1 = R + (chg.locked ? 52 : 38);
      const alpha = chg.locked ? 0.95 : 0.55;
      ctx.strokeStyle = chg.locked ? 'rgba(223,248,255,' + alpha + ')' : 'rgba(157,104,255,' + alpha + ')';
      ctx.lineWidth = chg.locked ? 3.4 : 2.4;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(ang) * a0, sy + Math.sin(ang) * a0);
      ctx.lineTo(sx + Math.cos(ang) * a1, sy + Math.sin(ang) * a1);
      // 箭头头部
      const hx = sx + Math.cos(ang) * a1, hy = sy + Math.sin(ang) * a1;
      const left = ang + 2.5, right = ang - 2.5;
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + Math.cos(left) * 12, hy + Math.sin(left) * 12);
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + Math.cos(right) * 12, hy + Math.sin(right) * 12);
      ctx.stroke();
    }
    ctx.restore();
  },

  // 弹射流特效：火花 / 召回 / 发射裂光 / 电弧 / 雷霆爆发 / 电磁场 / 磁极反馈
  drawRicochetFx(fxList, cam) {
    const ctx = this.ctx;
    for (let i = 0; i < fxList.length; i++) {
      const f = fxList[i];
      const s = Utils.worldToScreen(f.x, f.y, cam);
      const sx = Math.round(s.x);
      const sy = Math.round(s.y);
      const t = 1 - Math.max(0, f.life / f.maxLife); // 0→1 消散进度
      const a = Math.max(0, 1 - t);

      if (f.kind === 'barrier') {
        // 边界撞击：短紫色折光弧
        ctx.save();
        ctx.globalAlpha = a * 0.75;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sx, sy, 14 + t * 8, f.ang - 0.7, f.ang + 0.7);
        ctx.stroke();
        ctx.restore();
      } else if (f.kind === 'spark') {
        // 局部亮点（普通反弹合并反馈）
        this._drawGlow(sx, sy, 10 + t * 6, f.color, a * 0.8);
      } else if (f.kind === 'recall') {
        // 召回起点：弯曲暗影拖尾亮点
        this._drawGlow(sx, sy, 12 + t * 8, '#8a4ad9', a * 0.7);
      } else if (f.kind === 'aimlock') {
        // 方向锁定：短促方向刻痕
        ctx.save();
        ctx.globalAlpha = a * 0.9;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sx, sy, 18 + t * 10, f.ang - 0.5, f.ang + 0.5);
        ctx.stroke();
        ctx.restore();
      } else if (f.kind === 'launchRift') {
        // 发射反馈：沿方向的收束轨迹裂光（不造成伤害）
        ctx.save();
        ctx.globalAlpha = a * 0.8;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 4 * (1 - t) + 1;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sx - Math.cos(f.ang) * (10 + t * 46), sy - Math.sin(f.ang) * (10 + t * 46));
        ctx.lineTo(sx + Math.cos(f.ang) * 8, sy + Math.sin(f.ang) * 8);
        ctx.stroke();
        ctx.restore();
      } else if (f.kind === 'thunderBorn') {
        // 雷霆诞生：蓝白核心亮点 + 短电环
        this._drawGlow(sx, sy, 16 + t * 18, '#9fe8ff', a * 0.9);
        ctx.save();
        ctx.strokeStyle = 'rgba(159,232,255,' + (a * 0.7).toFixed(3) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, 12 + t * 26, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (f.kind === 'thunderBurst') {
        // 雷霆爆炸：蓝白核心向外爆发 + 蓝紫电弧扩散（无火焰、无白色实心圆）
        const rr = f.radius * (0.25 + t * 0.8);
        ctx.save();
        ctx.globalAlpha = a * 0.85;
        ctx.strokeStyle = '#9fe8ff';
        ctx.lineWidth = 4 * (1 - t) + 1;
        ctx.beginPath();
        ctx.arc(sx, sy, rr * 0.55, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = '#7a6aff';
        ctx.lineWidth = 3 * (1 - t) + 1;
        for (let k = 0; k < 5; k++) {
          const a0 = f.ang + k * 1.25 + t * 0.8;
          ctx.beginPath();
          ctx.arc(sx, sy, rr, a0, a0 + 0.5);
          ctx.stroke();
        }
        this._drawGlow(sx, sy, rr * 0.5, '#dff8ff', a * 0.5);
        ctx.restore();
      } else if (f.kind === 'fieldBorn') {
        // 电磁场生成：快速扩散冲击环（细节由 drawMagneticField 承担）
        const rr = f.radius * (0.2 + t * 0.7);
        ctx.save();
        ctx.globalAlpha = a * 0.7;
        ctx.strokeStyle = '#7de3ff';
        ctx.lineWidth = 2.6 * (1 - t) + 0.8;
        for (let k = 0; k < 3; k++) {
          const a0 = k * 2.1 + t * 1.2;
          ctx.beginPath();
          ctx.arc(sx, sy, rr, a0, a0 + 1.1);
          ctx.stroke();
        }
        ctx.restore();
      } else if (f.kind === 'arc') {
        // 短电弧（导电 / 过载 / 雷核结束 / tick 跳动）
        ctx.save();
        ctx.globalAlpha = a * 0.85;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        const len = f.radius > 0 ? f.radius : 30;
        const jitter = 0.35 * Math.sin(t * 24 + f.ang * 7);
        const mid = f.ang + jitter;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(
          sx + Math.cos(mid) * len * 0.5 + Math.sin(t * 31) * 6,
          sy + Math.sin(mid) * len * 0.5 + Math.cos(t * 27) * 6
        );
        ctx.lineTo(sx + Math.cos(f.ang) * len, sy + Math.sin(f.ang) * len);
        ctx.stroke();
        this._drawGlow(sx + Math.cos(f.ang) * len, sy + Math.sin(f.ang) * len,
          8 + t * 6, f.color, a * 0.6);
        ctx.restore();
      } else if (f.kind === 'conductive') {
        // 导电赋予：蓝紫局部描边（不闪屏）
        this._drawGlow(sx, sy, 14 + t * 12, '#51d9ff', a * 0.55);
      } else if (f.kind === 'nodeBorn' || f.kind === 'nodeHit') {
        this._drawGlow(sx, sy, (f.kind === 'nodeHit' ? 16 : 12) + t * 10, f.color, a * 0.8);
      }
    }
  },

  // ── VORTEX ────────────────────────────────────────────────────────
  // 单位螺旋线采样点缓存（半径缩放后复用，省掉每帧每臂的三角函数）
  _spiralPts: null,
  _getSpiralPts() {
    if (this._spiralPts) return this._spiralPts;
    const pts = [];
    for (let t = 0; t < Math.PI * 2; t += 0.18) {
      const rr = t / (Math.PI * 2);
      pts.push({ x: Math.cos(t) * rr, y: Math.sin(t) * rr });
    }
    this._spiralPts = pts;
    return pts;
  },

  // 漩涡径向渐变底（按类型缓存，绘制时缩放到目标半径）
  _vortexGrad(isFused) {
    const key = isFused ? 'vgrad|f' : 'vgrad|n';
    let cv = this._glowCache.get(key);
    if (cv) return cv;
    const c = isFused
      ? [[255, 255, 255, 0.55], [220, 220, 240, 0.3], [180, 180, 200, 0]]
      : [[200, 0, 255, 0.5], [80, 0, 180, 0.3], [80, 0, 180, 0]];
    const size = 128;
    cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const g2 = cv.getContext('2d');
    const grad = g2.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0,   `rgba(${c[0][0]},${c[0][1]},${c[0][2]},${c[0][3]})`);
    grad.addColorStop(0.6, `rgba(${c[1][0]},${c[1][1]},${c[1][2]},${c[1][3]})`);
    grad.addColorStop(1,   `rgba(${c[2][0]},${c[2][1]},${c[2][2]},${c[2][3]})`);
    g2.fillStyle = grad;
    g2.fillRect(0, 0, size, size);
    this._glowCache.set(key, cv);
    return cv;
  },

  drawVortex(vortex, time) {
    const ctx = this.ctx;
    const s = Utils.worldToScreen(vortex.x, vortex.y, this.cam);
    const sx = Math.round(s.x), sy = Math.round(s.y);
    const r = vortex.radius;
    const lifeRatio = vortex.timer / vortex.maxDuration;
    const alpha = Math.min(1, lifeRatio * 3, (1 - lifeRatio) * 3);
    // 大漩涡（LV7 融合产物）：旋转速度 3x → 再快 50% = 4.5x
    const rot = time * 2 * (vortex._isFused ? 4.5 : 1);
    const fused = !!vortex._isFused;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(sx, sy);

    // Outer ring（径向渐变用缓存贴图）
    const gradSp = this._vortexGrad(fused);
    ctx.drawImage(gradSp, -r, -r, r * 2, r * 2);

    // Spiral arms（发光用宽半透明线替代 shadowBlur）
    const pts = this._getSpiralPts();
    if (fused) {
      ctx.lineCap = 'round';
      for (let arm = 0; arm < 3; arm++) {
        ctx.save();
        ctx.rotate(rot + (arm / 3) * Math.PI * 2);
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const x = p.x * r, y = p.y * r;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 7;
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();
      }
      // Center dot（白核）
      this._drawGlow(0, 0, 16, '#ffffff', 0.8);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.lineCap = 'round';
      for (let arm = 0; arm < 3; arm++) {
        ctx.save();
        ctx.rotate(rot + (arm / 3) * Math.PI * 2);
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const x = p.x * r, y = p.y * r;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(120,40,220,0.25)';
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.strokeStyle = '#aa44ff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      this._drawGlow(0, 0, 12, '#ffffff', 0.8);
      ctx.fillStyle = '#ffffff';
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
    this._drawGlow(Math.round(s.x), Math.round(s.y), 16, '#ff00ff', 0.5);
    ctx.fillStyle = '#dd44ff';
    ctx.save();
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
    // 发光光晕（替代 shadowBlur）
    this._drawGlow(Math.round(s.x), Math.round(s.y), r * 2.2, '#330066', 0.9);
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

    ctx.lineCap = 'round';
    for (const se of shadowEntities) {
      if (drawn >= MAX_LINKS) break;
      if (!se.active && se.timer <= 0) continue;
      // 端点全在屏幕外则跳过（包围盒粗筛）
      if (!Utils.isOnScreen(se.x, se.y, cam, 0)) continue;
      const es = Utils.worldToScreen(se.x, se.y, this.cam);
      const grad = ctx.createLinearGradient(ps.x, ps.y, es.x, es.y);
      grad.addColorStop(0, 'rgba(200,120,255,0.95)');
      grad.addColorStop(1, 'rgba(120,40,220,0.55)');
      // 发光用宽半透明线替代 shadowBlur
      ctx.beginPath();
      ctx.moveTo(ps.x, ps.y);
      ctx.lineTo(es.x, es.y);
      ctx.strokeStyle = 'rgba(180,90,255,0.18)';
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.stroke();
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
        this._drawGlow(sx, sy, flashR, '#ffffff', flashAlpha);
      }
      // ── 白色实心圆（半径 ×2，60% 透明度）──
      this._drawGlow(sx, sy, r * 2.4, '#ffffff', 0.6 * a);
      ctx.globalAlpha = 0.6 * a;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(sx, sy, r * 2, 0, Math.PI * 2);
      ctx.fill();
      // 外层更亮的白色冲击环（半径 ×2.3）
      ctx.globalAlpha = 0.8 * a;
      ctx.beginPath();
      ctx.arc(sx, sy, r * 2.3, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 16;
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.restore();
    }
  },

  // ── CAUSAL ECHO 标记（流派 3）：紫青交错的收缩圆环，表现「延迟发生」 ──
  drawEchoMarker(echo, time) {
    const ctx = this.ctx;
    const s = Utils.worldToScreen(echo.x, echo.y, this.cam);
    const sx = Math.round(s.x);
    const sy = Math.round(s.y);
    const tagCount = (echo.tags && echo.tags.length) || 0;
    // 未触发（延迟阶段）：圆环从 38px 收缩到 12px
    let alpha, radius;
    if (!echo.triggered) {
      const t = 1 - Math.max(0, echo.delayLeft / 0.45);
      radius = Utils.lerp(38, 12, t);
      alpha = 0.85;
    } else {
      // 已就绪的因果节点：环 + 标签进度；临界时抖动加亮
      const lifeT = 1 - Math.max(0, echo.timer / (echo.lifetime || 1));
      radius = 14 + lifeT * 6 + (echo.state === 'critical' ? 4 : 0);
      alpha = 0.5 + lifeT * 0.45;
    }
    ctx.save();
    ctx.translate(sx, sy);
    // 临界抖动（视觉 seed 决定相位，不用每帧随机）
    if (echo.state === 'critical') {
      const wob = Math.sin(time * 34 + (echo.visualSeed || 0)) * 1.8;
      ctx.translate(wob, -wob);
    }
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    // 紫青交错：4 段弧交替着色（缓慢换相，不是持续攻击单位）
    const colors = echo.isDeathNode
      ? ['#ffffff', '#35f0ff']
      : ['#b04cff', '#35f0ff'];
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 4; i++) {
      const a0 = i * Math.PI / 2 + time * 0.6;
      ctx.beginPath();
      ctx.arc(0, 0, radius, a0, a0 + Math.PI * 0.4);
      ctx.strokeStyle = colors[i % 2];
      ctx.stroke();
    }
    // 内圈细环（交错色反向偏移）
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const a0 = i * Math.PI / 2 + Math.PI / 4 - time * 0.6;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.62, a0, a0 + Math.PI * 0.32);
      ctx.strokeStyle = colors[(i + 1) % 2];
      ctx.stroke();
    }
    // 标签进度指示：已记录的事件标签点亮缺口（紫 / 青 / 白）
    const tagColors = ['#b04cff', '#35f0ff', '#ffffff'];
    for (let i = 0; i < 3; i++) {
      const lit = i < tagCount || (i === 0 && echo.inheritedTag);
      const a0 = -Math.PI / 2 + (i / 3) * Math.PI * 2 + time * 0.25;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 1.22, a0, a0 + Math.PI * 0.42);
      ctx.strokeStyle = lit ? tagColors[i] : 'rgba(90,60,130,0.5)';
      ctx.lineWidth = lit ? 2.6 : 1.2;
      ctx.stroke();
    }
    // 中心（标签越多越亮）
    ctx.globalAlpha = alpha * (0.5 + tagCount * 0.18);
    ctx.fillStyle = echo.isDeathNode ? '#ffffff' : '#35f0ff';
    ctx.beginPath();
    ctx.arc(0, 0, 2.5 + tagCount * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },

  // ── 因果连线（流派 3 暗影连线）：事件沿连线传播 ──
  drawCausalLinks(links, cam, time) {
    if (!links || links.length === 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    for (const link of links) {
      const a = Utils.worldToScreen(link.a.x, link.a.y, cam);
      const b = Utils.worldToScreen(link.b.x, link.b.y, cam);
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = '#35f0ff';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = '#b04cff';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      // 事件光点沿连线移动（表现传播方向）
      const t = (time * 0.9 + (link.a.visualSeed || 0)) % 1;
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      this._drawGlow(px, py, 7, '#ffffff', 0.7);
    }
    ctx.restore();
  },

  // ── CAUSAL ECHO 特效（流派 3）：触发闪光 / 反击波 / 连线 / 电弧 / 落空涟漪 ──
  drawEchoFx(fxList, cam) {
    const ctx = this.ctx;
    for (const f of fxList) {
      const s = Utils.worldToScreen(f.x, f.y, cam);
      const a = Math.max(0, f.life / f.maxLife);
      switch (f.kind) {
        case 'flash': {
          // 延迟触发：一次向外扩散的闪光
          const t = 1 - a;
          const r = 14 + t * 52;
          ctx.save();
          ctx.globalAlpha = a;
          this._drawGlow(s.x, s.y, r * 1.6, '#35f0ff', 0.5 * a);
          ctx.beginPath();
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
          ctx.strokeStyle = '#35f0ff';
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(s.x, s.y, r * 0.72, 0, Math.PI * 2);
          ctx.strokeStyle = '#b04cff';
          ctx.lineWidth = 2;
          ctx.stroke();
          if (t < 0.35) this._drawGlow(s.x, s.y, 26, '#ffffff', (0.35 - t) * 1.6);
          ctx.restore();
          break;
        }
        case 'wave': {
          // 反击波 / 范围伤害：向外扩散的宽环
          const t = 1 - a;
          const r = 20 + t * (CONFIG.CAUSAL.COUNTER_WAVE_RADIUS || 140);
          ctx.save();
          ctx.globalAlpha = 0.7 * a;
          ctx.beginPath();
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
          ctx.strokeStyle = '#35f0ff';
          ctx.lineWidth = 4;
          ctx.stroke();
          ctx.globalAlpha = 0.35 * a;
          ctx.beginPath();
          ctx.arc(s.x, s.y, r * 0.8, 0, Math.PI * 2);
          ctx.strokeStyle = '#b04cff';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
          break;
        }
        case 'line': {
          // 短连线（紫青交加）
          const s2 = Utils.worldToScreen(f.x2, f.y2, cam);
          ctx.save();
          ctx.globalAlpha = 0.9 * a;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s2.x, s2.y);
          ctx.strokeStyle = 'rgba(53,240,255,0.35)';
          ctx.lineWidth = 6;
          ctx.stroke();
          ctx.strokeStyle = '#b04cff';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
          break;
        }
        case 'lightning': {
          // 局部电击 / 连线电弧
          const s2 = Utils.worldToScreen(f.x2, f.y2, cam);
          ctx.save();
          ctx.globalAlpha = a;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          const mx = (s.x + s2.x) / 2 + Utils.rand(-8, 8);
          const my = (s.y + s2.y) / 2 + Utils.rand(-8, 8);
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(mx, my);
          ctx.lineTo(s2.x, s2.y);
          ctx.strokeStyle = 'rgba(125,249,255,0.35)';
          ctx.lineWidth = 6;
          ctx.stroke();
          ctx.strokeStyle = '#7df9ff';
          ctx.lineWidth = 2;
          ctx.stroke();
          this._drawGlow(s2.x, s2.y, 14, '#7df9ff', 0.5 * a);
          ctx.restore();
          break;
        }
        case 'burst': {
          // 崩解 / 高亮爆发
          this._drawGlow(s.x, s.y, 26 + (1 - a) * 26, '#ffffff', 0.55 * a);
          this._drawGlow(s.x, s.y, 18 + (1 - a) * 18, '#35f0ff', 0.45 * a);
          break;
        }
        case 'fizzle': {
          // 打空的微弱涟漪（明确表现「这次没有发生」）
          const t = 1 - a;
          ctx.save();
          ctx.globalAlpha = 0.35 * a;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 8 + t * 18, 0, Math.PI * 2);
          ctx.strokeStyle = '#665588';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.restore();
          break;
        }
      }
    }
  },

  // ── CAUSAL ECHO 区域（流派 3）：弱化死亡阴影 / 减速区域 / 延迟爆炸预备 ──
  drawEchoZones(zones, cam, time) {
    const ctx = this.ctx;
    for (const z of zones) {
      if (!Utils.isOnScreen(z.x, z.y, cam, z.radius)) continue;
      const s = Utils.worldToScreen(z.x, z.y, cam);
      const a = Math.min(1, (z.timer / (z.maxDuration || 0.001)) * 2);
      if (z.kind === 'death') {
        // 复用死亡阴影视觉（弱化区域，不是暗影分身）
        this.drawDeathShadow(z, time);
      } else if (z.kind === 'slow') {
        ctx.save();
        ctx.globalAlpha = 0.28 * a;
        const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, z.radius);
        grad.addColorStop(0, 'rgba(53,240,255,0.5)');
        grad.addColorStop(1, 'rgba(53,240,255,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(s.x, s.y, z.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.6 * a;
        ctx.strokeStyle = '#35f0ff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, z.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (z.kind === 'blast') {
        // 延迟爆炸预备：收缩圆环
        const t = 1 - Math.max(0, z.timer / (z.maxDuration || 0.001));
        const r = Utils.lerp(30, 10, t);
        ctx.save();
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = '#ff9a3c';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      } else if (z.kind === 'crack') {
        // LV7 裂口残留：白色裂口缓慢旋转（无持续伤害，传播在逻辑层一次性完成）
        const t = 1 - Math.max(0, z.timer / (z.maxDuration || 0.001));
        const r = z.radius * (1 + t * 0.22);
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(time * 0.7 + (z.id || 0));
        ctx.globalAlpha = 0.7 * (1 - t);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          const rr = r * (0.62 + ((Math.sin((z.id || 0) + i * 2.7) + 1) / 2) * 0.55);
          const px = Math.cos(a) * rr;
          const py = Math.sin(a) * rr * 0.72;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
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
      // 大漩涡（LV7 融合产物）闪电：黑白交加（发光用宽半透明线替代 shadowBlur）
      // 先画黑色底层（错位 -1px）
      ctx.beginPath();
      ctx.moveTo(from.x - 1, from.y - 1);
      for (const seg of lightning.segments) {
        ctx.lineTo(from.x + seg.x - 1, from.y + seg.y - 1);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = CONFIG.VORTEX.LIGHTNING_WIDTH + 8;
      ctx.stroke();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = CONFIG.VORTEX.LIGHTNING_WIDTH + 2;
      ctx.stroke();
      // 再画白色顶层
      ctx.beginPath();
      ctx.moveTo(from.x + 1, from.y + 1);
      for (const seg of lightning.segments) {
        ctx.lineTo(from.x + seg.x + 1, from.y + seg.y + 1);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = CONFIG.VORTEX.LIGHTNING_WIDTH + 9;
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = CONFIG.VORTEX.LIGHTNING_WIDTH + 2;
      ctx.stroke();
    } else {
      // 普通漩涡闪电：紫色
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      for (const seg of lightning.segments) {
        ctx.lineTo(from.x + seg.x, from.y + seg.y);
      }
      ctx.strokeStyle = 'rgba(221,0,255,0.25)';
      ctx.lineWidth = CONFIG.VORTEX.LIGHTNING_WIDTH + 8;
      ctx.stroke();
      ctx.strokeStyle = '#dd00ff';
      ctx.lineWidth = CONFIG.VORTEX.LIGHTNING_WIDTH;
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
        // 大漩涡裂隙激光：黑白交加（黑边 + 白心 + 错位 2px；发光用宽半透明线替代 shadowBlur）
        // 黑色底层（错位 -2px）
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = beamW + 14;
        ctx.beginPath();
        ctx.moveTo(from.x - 2, from.y - 2);
        ctx.lineTo(endX - 2, endY - 2);
        ctx.stroke();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = beamW + 2;
        ctx.stroke();
        // 白色顶层（错位 +2px）
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = beamW + 14;
        ctx.beginPath();
        ctx.moveTo(from.x + 2, from.y + 2);
        ctx.lineTo(endX + 2, endY + 2);
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = beamW;
        ctx.stroke();
      } else {
        // 普通激光：紫色
        ctx.strokeStyle = 'rgba(255,68,255,0.22)';
        ctx.lineWidth = beamW + 14;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        ctx.strokeStyle = '#ff44ff';
        ctx.lineWidth = beamW;
        ctx.stroke();

        // 中心高亮细线
        ctx.strokeStyle = '#ffd0ff';
        ctx.lineWidth = Math.max(2, beamW * 0.3);
        ctx.stroke();
      }

      ctx.restore();
    }
  },

  // ── PARTICLES ─────────────────────────────────────────────────────
  drawParticles(particles) {
    const ctx = this.ctx;
    const cam = this.cam;
    const ox = cam.sw / 2 - cam.x;
    const oy = cam.sh / 2 - cam.y;
    let curFont = '';
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const sx = p.x + ox;
      const sy = p.y + oy;
      if (sx < -30 || sx > cam.sw + 30 || sy < -30 || sy > cam.sh + 30) continue;
      ctx.globalAlpha = p.alpha;
      if (p.isText) {
        // 发光用光晕贴图替代 shadowBlur
        this._drawGlow(sx, sy, (p.size || 16) * 1.1, p.color, 0.5);
        ctx.fillStyle = p.color;
        const font = `bold ${p.size || 16}px sans-serif`;
        if (curFont !== font) { ctx.font = font; curFont = font; }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.text, sx, sy);
      } else {
        // 发光用光晕贴图替代 shadowBlur
        this._drawGlow(Math.round(sx), Math.round(sy), p.r * 2.4, p.color, 0.4);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(Math.round(sx), Math.round(sy), p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
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
  // 冰面填充透明度分档颜色（避免每条边都拼一个 rgba 字符串）
  _iceColors: (() => {
    const arr = [];
    for (let i = 0; i <= 8; i++) {
      arr.push(`rgba(120,200,255,${(0.18 + 0.25 * (i / 8)).toFixed(3)})`);
    }
    return arr;
  })(),

  _drawIceBlock(enemy) {
    const ctx = this.ctx;
    const verts = enemy.freezeVerts;
    if (!verts) return;
    const s = Utils.worldToScreen(enemy.x, enemy.y, this.cam);
    const sx = Math.round(s.x);
    const sy = Math.round(s.y);

    // 旋转 + 透视投影（绕 Y 轴）—— 复用投影缓冲，避免每帧分配
    const rot = enemy.freezeRot || 0;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    if (!enemy._iceProj || enemy._iceProj.length !== verts.length) {
      enemy._iceProj  = verts.map(() => ({ x: 0, y: 0, z: 0 }));
      enemy._iceOrder = verts.map((_, i) => i);
    }
    const proj = enemy._iceProj;
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i], p = proj[i];
      p.x = v.x * cosR - v.z * sinR;
      p.y = v.y;
      p.z = v.x * sinR + v.z * cosR;
    }

    ctx.save();
    ctx.translate(sx, sy);

    // 后半面（z 较小）—— 先画淡蓝远面
    const order = enemy._iceOrder;
    order.sort((a, b) => proj[a].z - proj[b].z);
    // 描边（亮蓝玻璃高光；发光用宽半透明线替代 shadowBlur）
    ctx.strokeStyle = 'rgba(122,220,255,0.25)';
    ctx.lineWidth = 5;
    for (let i = 0; i < order.length; i++) {
      const a = proj[order[i]];
      const b = proj[order[(i + 1) % order.length]];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(180,230,255,0.75)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < order.length; i++) {
      const a = proj[order[i]];
      const b = proj[order[(i + 1) % order.length]];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // 填充多面体（半透明蓝渐变，模拟玻璃）
    const first = proj[order[0]].z, last = proj[order[order.length - 1]].z;
    const minZ = first, maxZ = last;
    const span = Math.max(1, maxZ - minZ);
    for (let i = 0; i < order.length; i++) {
      const a = proj[order[i]];
      const b = proj[order[(i + 1) % order.length]];
      const midZ = (a.z + b.z) / 2;
      const bucket = Math.min(8, Math.max(0, Math.round(((midZ - minZ) / span) * 8)));
      ctx.fillStyle = this._iceColors[bucket];
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.closePath();
      ctx.fill();
    }

    // 中心高亮（强化 3D 玻璃感）
    this._drawGlow(0, -enemy.radius * 0.25, enemy.radius * 0.55, '#c0e8ff', 0.35);
    ctx.fillStyle = 'rgba(220,240,255,0.22)';
    ctx.beginPath();
    ctx.arc(0, -enemy.radius * 0.25, enemy.radius * 0.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
};

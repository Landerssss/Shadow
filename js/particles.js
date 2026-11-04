// ─── PARTICLE SYSTEM ─────────────────────────────────────────────────────────
const Particles = {
  list: [],
  MAX: 4000, // 全局硬上限
  MAX_SNOW: 28, // 冰壳雪花单独限流，避免密集冰封时变成暴风雪
  snowAlive: 0,
  _pool: [],
  _fxAlive: 0, // 战斗反馈粒子（命中火花 / 死亡碎片）占用

  _take() {
    return this._pool.pop() || {};
  },

  _recycle(p) {
    if (this._pool.length < 1200) {
      p.text = null;
      p.shape = null;
      p.rotV = 0;
      p.fx = false;
      p.iceOwner = null;
      p.iceBack = false;
      p.arms = 0;
      p.branch = 0;
      p.seed = 0;
      this._pool.push(p);
    }
  },

  _canSpawn(count, fx) {
    if (this.list.length + count > this.MAX) return false;
    if (fx) {
      const max = (typeof COMBAT_FX !== 'undefined') ? COMBAT_FX.particles.maxAlive : 900;
      if (this._fxAlive + count > max) return false;
    }
    return true;
  },

  spawn(x, y, color = '#c97bff', count = 6, speed = 80, life = 0.5, rRange = [2, 4]) {
    for (let i = 0; i < count; i++) {
      if (!this._canSpawn(1, false)) return;
      const angle = Math.random() * Math.PI * 2;
      const spd   = Utils.rand(speed * 0.5, speed);
      const p = this._take();
      p.x = x; p.y = y;
      p.vx = Math.cos(angle) * spd;
      p.vy = Math.sin(angle) * spd;
      p.r = Utils.rand(rRange[0], rRange[1]);
      p.life = life; p.maxLife = life;
      p.alpha = 1;
      p.color = color;
      p.shape = 'dot';
      p.fx = false;
      p.isText = false;
      this.list.push(p);
    }
  },

  // 命中火花：沿受击方向喷出的小亮点 + 少量白屑 + 敌方红屑
  spawnHit(x, y, nx, ny, opts) {
    if (!this._canSpawn(3, true)) return;
    const cfg = (typeof COMBAT_FX !== 'undefined') ? COMBAT_FX.particles : { hitMin: 3, hitMax: 5, hitLifeMs: 180 };
    const crit = !!(opts && opts.crit);
    const weak = !!(opts && opts.weak);
    const n = weak ? 2 : Utils.randInt(cfg.hitMin, cfg.hitMax) + (crit ? 2 : 0);
    const dist = Math.atan2(ny, nx);
    const palette = ['#d7a6ff', '#a45cff', '#ffffff', '#ff5a7a'];
    for (let i = 0; i < n; i++) {
      if (!this._canSpawn(1, true)) return;
      const a = dist + Utils.rand(-0.9, 0.9);
      const spd = Utils.rand(70, crit ? 210 : 165);
      const life = Utils.rand(cfg.hitLifeMs * 0.55, cfg.hitLifeMs) / 1000;
      const p = this._take();
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * spd;
      p.vy = Math.sin(a) * spd;
      p.r = Utils.rand(1.4, crit ? 3.2 : 2.6);
      p.life = life; p.maxLife = life;
      p.alpha = 1;
      p.color = palette[i % palette.length];
      p.shape = 'spark';
      p.rot = a;
      p.len = p.r * Utils.rand(3.5, 6.5);
      p.fx = true;
      p.isText = false;
      this.list.push(p);
      this._fxAlive++;
    }
  },

  // 死亡碎片：6~12 枚暗色碎片，与经验 / 余烬 / 遗蜕 / 磁极残核区分
  spawnDeath(x, y, color, crit) {
    const cfg = (typeof COMBAT_FX !== 'undefined') ? COMBAT_FX.particles : { deathMin: 6, deathMax: 12, deathLifeMs: 650 };
    const n = Utils.randInt(cfg.deathMin, cfg.deathMax) + (crit ? 3 : 0);
    if (!this._canSpawn(n, true)) return;
    const base = color || '#ff3060';
    for (let i = 0; i < n; i++) {
      if (!this._canSpawn(1, true)) break;
      const a = Math.random() * Math.PI * 2;
      const spd = Utils.rand(90, 260);
      const life = Utils.rand(cfg.deathLifeMs * 0.7, cfg.deathLifeMs) / 1000;
      const p = this._take();
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * spd;
      p.vy = Math.sin(a) * spd;
      p.r = Utils.rand(2.2, 4.6);
      p.life = life; p.maxLife = life;
      p.alpha = 1;
      p.color = (i % 4 === 0) ? '#ffd0e0' : base;
      p.shape = 'shard';
      p.rot = a;
      p.rotV = Utils.rand(-8, 8);
      p.len = p.r * Utils.rand(1.4, 2.4);
      p.fx = true;
      p.isText = false;
      this.list.push(p);
      this._fxAlive++;
    }
  },

  // Floating text particle (e.g. "+" heal indicator)
  spawnText(x, y, text, color = '#44ff88', life = 1.0, size = 16) {
    if (!this._canSpawn(1, false)) return;
    const p = this._take();
    p.x = x; p.y = y;
    p.vx = Utils.rand(-15, 15);
    p.vy = -40;
    p.r = 0;
    p.life = life; p.maxLife = life;
    p.alpha = 1;
    p.color = color;
    p.text = text;
    p.size = size;
    p.shape = 'dot';
    p.fx = false;
    p.isText = true;
    this.list.push(p);
  },

  // 冰壳雪花：复用现有粒子池，六臂/四向晶花，尺寸 4～8px。
  spawnSnowflake(x, y, opts = {}) {
    if (this.snowAlive >= this.MAX_SNOW) return false;
    if (!this._canSpawn(1, false)) return false;

    const p = this._take();
    const life = opts.life != null ? opts.life : Utils.rand(2.1, 3.3);
    const colors = ['#b6f2ff', '#d6fbff', '#f2ffff'];
    p.x = x;
    p.y = y;
    p.vx = opts.vx != null ? opts.vx : Utils.rand(-6, 6);
    p.vy = opts.vy != null ? opts.vy : Utils.rand(-10, -2);
    p.r = opts.r != null ? opts.r : Utils.rand(2.4, 4.0);
    p.life = life;
    p.maxLife = life;
    p.alpha = 1;
    p.color = opts.color || colors[(Math.random() * colors.length) | 0];
    p.shape = 'snowflake';
    p.rot = opts.rot != null ? opts.rot : Utils.rand(0, Math.PI * 2);
    p.rotV = opts.rotV != null ? opts.rotV : Utils.rand(-0.55, 0.55);
    p.arms = opts.arms || (Math.random() < 0.22 ? 4 : 6);
    p.branch = opts.branch != null ? opts.branch : Utils.rand(0.28, 0.46);
    p.seed = Math.random() * Math.PI * 2;
    p.fx = false;
    p.isText = false;
    p.iceOwner = opts.owner || null;
    p.iceBack = !!opts.back;
    this.list.push(p);
    this.snowAlive++;
    if (p.iceOwner) p.iceOwner.snowAlive = (p.iceOwner.snowAlive || 0) + 1;
    return true;
  },

  update(dt) {
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (p.shape === 'snowflake') {
        // 雪花：缓慢漂移 + 轻微摆动 + 自转，不受普通粒子的强阻尼影响
        const age = p.maxLife - p.life;
        p.x += p.vx * dt + Math.sin(age * 1.8 + p.seed) * 3.2 * dt;
        p.y += p.vy * dt;
        p.vx *= 0.992;
        p.vy *= 0.992;
        p.rot += (p.rotV || 0) * dt;
      } else {
        p.x  += p.vx * dt;
        p.y  += p.vy * dt;
        const damp = p.shape === 'spark' ? 0.86 : 0.9;
        p.vx *= damp;
        p.vy *= damp;
        if (p.rotV) p.rot += p.rotV * dt;
      }
      p.life -= dt;
      p.alpha = Math.max(0, p.life / p.maxLife);
      if (p.life <= 0) {
        if (p.fx && this._fxAlive > 0) this._fxAlive--;
        if (p.shape === 'snowflake') {
          if (this.snowAlive > 0) this.snowAlive--;
          if (p.iceOwner && p.iceOwner.snowAlive > 0) p.iceOwner.snowAlive--;
        }
        // 交换删除（O(1)），粒子间无绘制层级语义
        list[i] = list[list.length - 1];
        list.pop();
        this._recycle(p);
      }
    }
  },

  // 只清理冰壳雪花，不影响命中火花 / 死亡碎片等战斗粒子。
  clearSnowflakes() {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (p.shape !== 'snowflake') continue;
      if (p.iceOwner && p.iceOwner.snowAlive > 0) p.iceOwner.snowAlive--;
      this.list[i] = this.list[this.list.length - 1];
      this.list.pop();
      this._recycle(p);
    }
    this.snowAlive = 0;
  },

  clear() {
    for (let i = 0; i < this.list.length; i++) this._recycle(this.list[i]);
    this.list.length = 0;
    this._fxAlive = 0;
    this.snowAlive = 0;
  },
};

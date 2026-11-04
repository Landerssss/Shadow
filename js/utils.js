// ─── UTILITY FUNCTIONS ───────────────────────────────────────────────────────
const Utils = {
  dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  },
  // 平方距离（免开方，用于只需比较大小的场合）
  distSq(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy;
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
    // 内联坐标换算，避免为每个实体每帧分配临时对象
    const sx = wx - cam.x + cam.sw / 2;
    const sy = wy - cam.y + cam.sh / 2;
    return sx > -margin && sx < cam.sw + margin &&
           sy > -margin && sy < cam.sh + margin;
  },

  // ── 伤害数字：DOM 对象池（复用节点，避免频繁创建/销毁引发 GC 与重排） ──
  _dmgPool: [],
  _dmgAlive: 0,
  _dmgMerge: new Map(),
  _dmgFrames: {
    normal: [
      { opacity: 1, transform: 'translateY(0) scale(1.12)' },
      { opacity: 1, transform: 'translateY(-16px) scale(1)' },
      { opacity: 0, transform: 'translateY(-40px) scale(.9)' }
    ],
    crit: [
      { opacity: 1, transform: 'translate(-2px,0) scale(1.55)' },
      { opacity: 1, transform: 'translate(2px,-4px) scale(1.5)' },
      { opacity: 1, transform: 'translate(-1px,-8px) scale(1.45)' },
      { opacity: 0, transform: 'translateY(-52px) scale(1.35)' }
    ]
  },
  // value: 伤害值；type: '' | 'crit' | 'boss' | 'heal'；key: 合并键（持续伤害 / BOSS 共享池）
  spawnDmgNum(screenX, screenY, value, type = '', key = '') {
    const cfg = (typeof COMBAT_FX !== 'undefined') ? COMBAT_FX.dmgText : { lifeMs: 720, critLifeMs: 820, mergeMs: 120, maxAlive: 36 };
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    const isCrit = type === 'crit';
    const isBoss = type === 'boss';

    // 合并表防膨胀：长期战斗中清理过期条目
    if (this._dmgMerge.size > 200) {
      for (const [k, v] of this._dmgMerge) {
        if (now - v.t > 500) this._dmgMerge.delete(k);
      }
    }

    // 同目标同类持续伤害 / BOSS 共享池：短窗口内合并为一次
    if (key) {
      const m = this._dmgMerge.get(key);
      if (m && now - m.t < cfg.mergeMs && m.type === type && m.el._busy && m.el._dmgKey === key) {
        m.value += value;
        m.t = now;
        m.el.textContent = Math.round(m.value) + (isCrit ? '!' : '');
        m.el.style.left = (screenX - 12) + 'px';
        m.el.style.top  = (screenY - 10) + 'px';
        return;
      }
    }

    // 数量预算：超出时优先保留暴击 / BOSS / 大伤害
    const isBig = value >= 100;
    if (this._dmgAlive >= cfg.maxAlive && !isCrit && !isBoss && !isBig) return;

    let el = null;
    for (let i = 0; i < this._dmgPool.length; i++) {
      const cand = this._dmgPool[i];
      if (!cand._busy) { el = cand; break; }
    }
    if (!el) {
      el = document.createElement('div');
      document.body.appendChild(el);
      el._animType = '';
      this._dmgPool.push(el);
    }

    // 动画类型切换时重建 WAAPI 动画（同类型复用，避免每次重建）
    const animType = isCrit ? 'crit' : 'normal';
    if (el._animType !== animType || !el._anim) {
      if (el._anim) el._anim.cancel();
      el._anim = el.animate(this._dmgFrames[animType], {
        duration: isCrit ? cfg.critLifeMs : cfg.lifeMs,
        easing: 'ease-out', fill: 'forwards'
      });
      el._animType = animType;
    }

    if (!el._busy) this._dmgAlive++;
    el._busy = true;
    el._dmgKey = key;
    const cls = 'dmg-num' + (type ? ' ' + type : '');
    if (el.className !== cls) el.className = cls;
    el.textContent = Math.round(value) + (isCrit ? '!' : '');
    el.style.left = (screenX - 12) + 'px';
    el.style.top  = (screenY - 10) + 'px';
    const anim = el._anim;
    anim.currentTime = 0;
    anim.play();

    if (key) this._dmgMerge.set(key, { el, value, type, t: now });

    clearTimeout(el._t);
    el._t = setTimeout(() => {
      el._busy = false;
      if (this._dmgAlive > 0) this._dmgAlive--;
    }, isCrit ? cfg.critLifeMs : cfg.lifeMs);
  },

  clearDmgNums() {
    for (const el of this._dmgPool) {
      clearTimeout(el._t);
      el._busy = false;
      if (el._anim) el._anim.cancel();
      el.style.opacity = 0;
    }
    this._dmgAlive = 0;
    this._dmgMerge.clear();
  },

  // ── 空间网格：把 O(n²) 邻域检测降为 O(n·k)（碰撞 / 刷怪间距查询共用） ──
  createGrid(cellSize = 128) {
    return {
      cell: cellSize,
      cols: 0, rows: 0,
      ox: 0, oy: 0,
      buckets: [],
      build(list, minX, minY, maxX, maxY) {
        const cell = this.cell;
        this.ox = minX;
        this.oy = minY;
        this.cols = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
        this.rows = Math.max(1, Math.ceil((maxY - minY) / cell) + 1);
        const n = this.cols * this.rows;
        if (this.buckets.length > n) this.buckets.length = n;
        while (this.buckets.length < n) this.buckets.push([]);
        for (let i = 0; i < n; i++) this.buckets[i].length = 0;
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          this._bucketOf(it.x, it.y).push(i);
        }
      },
      _bucketOf(x, y) {
        let cx = ((x - this.ox) / this.cell) | 0;
        let cy = ((y - this.oy) / this.cell) | 0;
        if (cx < 0) cx = 0; else if (cx >= this.cols) cx = this.cols - 1;
        if (cy < 0) cy = 0; else if (cy >= this.rows) cy = this.rows - 1;
        return this.buckets[cy * this.cols + cx];
      },
      // 追加一个新元素（刷怪时增量更新，避免重建整张网格）
      add(x, y, index) {
        this._bucketOf(x, y).push(index);
      },
      // 把 (x,y) 半径 radius 内的元素下标追加到 out（先清空 out）
      query(x, y, radius, out) {
        out.length = 0;
        const cell = this.cell;
        const x0 = Math.max(0, ((x - radius - this.ox) / cell) | 0);
        const x1 = Math.min(this.cols - 1, ((x + radius - this.ox) / cell) | 0);
        const y0 = Math.max(0, ((y - radius - this.oy) / cell) | 0);
        const y1 = Math.min(this.rows - 1, ((y + radius - this.oy) / cell) | 0);
        for (let cy = y0; cy <= y1; cy++) {
          const row = cy * this.cols;
          for (let cx = x0; cx <= x1; cx++) {
            const b = this.buckets[row + cx];
            for (let k = 0; k < b.length; k++) out.push(b[k]);
          }
        }
        return out;
      }
    };
  }
};

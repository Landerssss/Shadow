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
  _dmgAnims: [
    { opacity: 1, transform: 'translateY(0) scale(1)' },
    { opacity: 0, transform: 'translateY(-40px) scale(.8)' }
  ],
  spawnDmgNum(screenX, screenY, value, type = '') {
    let el = null;
    for (let i = 0; i < this._dmgPool.length; i++) {
      const cand = this._dmgPool[i];
      if (!cand._busy) { el = cand; break; }
    }
    if (!el) {
      el = document.createElement('div');
      document.body.appendChild(el);
      // 动画走 WAAPI（合成器驱动），视觉与原 floatUp 关键帧一致
      el._anim = el.animate(this._dmgAnims, {
        duration: 700, easing: 'ease-out', fill: 'forwards'
      });
      this._dmgPool.push(el);
    }
    el._busy = true;
    const cls = 'dmg-num' + (type ? ' ' + type : '');
    if (el.className !== cls) el.className = cls;
    el.textContent = Math.round(value);
    el.style.left = (screenX - 12) + 'px';
    el.style.top  = (screenY - 10) + 'px';
    const anim = el._anim;
    anim.currentTime = 0;
    anim.play();
    clearTimeout(el._t);
    el._t = setTimeout(() => { el._busy = false; }, 700);
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

// ─── BULLET ──────────────────────────────────────────────────────────────────
let _bulletId = 0;

class Bullet {
  constructor(x, y, angle, speed, damage, radius, color, owner = 'player') {
    this.id     = _bulletId++;
    this.x      = x;
    this.y      = y;
    this.angle  = angle;
    this.vx     = Math.cos(angle) * speed;
    this.vy     = Math.sin(angle) * speed;
    this.damage = damage;
    this.radius = radius;
    this.color  = color;
    this.owner  = owner; // 'player' | 'shadow' | 'enemy' | 'echo'
    this.alive  = true;
    this.life   = 30; // 兜底最长生命（正常靠命中/地图边界淘汰）
    this.pierce = 0;  // 可额外穿透的敌人数（通用 BUFF「暗影贯穿」）
    this.hitIds = null;
    this.batchId = 0; // 不灭的暗影：有效攻击批次 id（基础汲取按批次限频）
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;

    // 子弹仅在飞出地图边界或兜底时间到时消失
    if (this.x < 0 || this.x > CONFIG.MAP_W ||
        this.y < 0 || this.y > CONFIG.MAP_H ||
        this.life <= 0) {
      this.alive = false;
    }
  }
}

// ─── BULLET MANAGER ──────────────────────────────────────────────────────────
const BulletManager = {
  bullets: [],
  _grid: null,   // 敌人空间网格（每帧重建一次）
  _cand: [],     // 邻域查询结果缓冲

  spawn(x, y, angle, speed, damage, radius, color, owner) {
    const b = new Bullet(x, y, angle, speed, damage, radius, color, owner);
    this.bullets.push(b);
    return b;
  },

  update(dt, enemies, state) {
    // 用空间网格把 O(子弹×敌人) 的全表碰撞降为邻域查询（后期数百子弹×数百敌人时差距巨大）
    if (!this._grid) this._grid = Utils.createGrid(128);
    this._grid.build(enemies, 0, 0, CONFIG.MAP_W, CONFIG.MAP_H);
    const cand = this._cand;

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.update(dt);
      if (!b.alive) {
        this.bullets[i] = this.bullets[this.bullets.length - 1];
        this.bullets.pop();
        continue;
      }

      // Collision with enemies (player bullets, shadow bullets and echo fragments)
      if (b.owner === 'player' || b.owner === 'shadow' || b.owner === 'echo') {
        // 候选半径上限 = 子弹半径 + 最大敌人半径(≈40) + BOSS 本帧最大位移
        const maxR = b.radius + 45 + 450 * dt;
        this._grid.query(b.x, b.y, maxR, cand);
        let hitIdx = -1, hitE = null;
        for (let k = 0; k < cand.length; k++) {
          const idx = cand[k];
          const e = enemies[idx];
          if (!e.alive) continue;
          // 穿透子弹不重复命中同一敌人
          if (b.hitIds && b.hitIds.indexOf(e.id) >= 0) continue;
          // BOSS 移速极快，用更大碰撞半径（子弹+BOSS+BOSS 本帧位移）避免漏击；
          // 玩家子弹碰到 BOSS 应造成伤害并消失（不反弹）
          const bossMove = (e.type === 'boss') ? Math.hypot(e.vx || 0, e.vy || 0) * dt : 0;
          const collR = b.radius + e.radius + bossMove;
          const dx = e.x - b.x, dy = e.y - b.y;
          // 与原实现一致：命中"存活列表中下标最大"的重叠敌人
          if (dx * dx + dy * dy < collR * collR && idx > hitIdx) {
            hitIdx = idx;
            hitE = e;
          }
        }
        if (hitE) {
          // 残响碎片（owner 'echo'）：走残响伤害结算（同目标冷却 + BOSS 减半），不生成新残响
          if (b.owner === 'echo') {
            EchoManager.applyFragmentHit(b, hitE, state);
            b.alive = false;
            this.bullets[i] = this.bullets[this.bullets.length - 1];
            this.bullets.pop();
            continue;
          }
          let dmg = b.damage;
          // 暴击判定：因果残响（流派 3）/ 不灭的暗影（流派 2，强化原攻击）；其他流派行为不变
          let crit = false;
          if ((state.genre === 3 || state.genre === 2) && b.owner === 'player') {
            crit = EchoManager.rollCrit();
            if (crit) dmg = Math.round(dmg * CONFIG.CAUSAL.CRIT_MULT);
          }
          hitE.takeDamage(dmg, state, b.owner);
          // 不灭的暗影（流派 2）：玩家直接攻击造成有效伤害 → 基础汲取（批次限频）
          if (state.genre === 2 && b.owner === 'player' && typeof UndyingManager !== 'undefined') {
            UndyingManager.onPlayerHit(b.batchId, state);
          }
          // 因果残响：记录 HIT / CRIT / KILL 事件（可推进因果节点）
          if (b.owner === 'player') {
            EchoManager.onHit(b.x, b.y, b.angle, dmg, hitE, !hitE.alive, state, crit);
          }
          // spawn particles
          Particles.spawn(b.x, b.y,
            b.owner === 'shadow' ? '#aa44ff' : '#c97bff', 5, 60, 0.4);
          // screen damage number
          const sv = Utils.worldToScreen(hitE.x, hitE.y - 20, Renderer.cam);
          Utils.spawnDmgNum(sv.x, sv.y, dmg, hitE.type === 'boss' ? 'boss' : (crit ? 'crit' : ''));
          // 穿透（通用 BUFF「暗影贯穿」）：一发可命中多个目标 / 经过多个因果节点，
          // 穿透后伤害衰减；同一子弹不重复命中同一敌人
          if (b.pierce > 0 && b.owner === 'player') {
            b.pierce--;
            b.damage = b.damage * 0.65;
            if (!b.hitIds) b.hitIds = [];
            b.hitIds.push(hitE.id);
            continue;
          }
          b.alive = false;
          this.bullets[i] = this.bullets[this.bullets.length - 1];
          this.bullets.pop();
        }
      } else if (b.owner === 'enemy') {
        // Enemy bullets hit the player
        const p = state.player;
        const dx = p.x - b.x, dy = p.y - b.y;
        const rr = b.radius + CONFIG.PLAYER_RADIUS;
        if (dx * dx + dy * dy < rr * rr) {
          const dmg = b.damage;
          p.takeDamage(dmg, state, false, false, b.x, b.y);
          b.alive = false;
          Particles.spawn(b.x, b.y, b.color || '#ffd84a', 5, 60, 0.4);
          const sv = Utils.worldToScreen(p.x, p.y - 20, Renderer.cam);
          Utils.spawnDmgNum(sv.x, sv.y, dmg);
          this.bullets[i] = this.bullets[this.bullets.length - 1];
          this.bullets.pop();
        }
      }
    }
  },

  clear() { this.bullets = []; }
};

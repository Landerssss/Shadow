// ─── ENEMY ───────────────────────────────────────────────────────────────────
let _enemyId = 0;

class Enemy {
  constructor(x, y, scaleFactor = 1, type = 'melee', state = null) {
    this.id    = _enemyId++;
    this.type  = type;
    this.x     = x;
    this.y     = y;
    this.alive = true;
    const cfg = CONFIG.ENEMY_TYPES[type];
    // 暗影奴役 BUFF：普通怪（含三种新普通怪）速度 +40% / 血量 -25%
    const serv = state && state.servitudeActive &&
      (type === 'melee' || type === 'shooter' || type === 'wave' ||
       type === 'charger' || type === 'bulwark' || type === 'lobber');
    const speedMult = serv ? 1.4 : 1;
    const hpMult    = serv ? 0.75 : 1;
    // 10 级后所有怪物：血量 +20% / 防御 +20%
    const lv10 = state && state.player && state.player.level >= 10;
    const lv10HpMult  = lv10 ? 1.2 : 1.0;
    const lv10DefMult = lv10 ? 0.2 : 0; // 减伤 20%
    this.maxHp    = Math.round(cfg.hp * scaleFactor * hpMult * lv10HpMult);
    this.hp       = this.maxHp;
    this.defense  = lv10DefMult;
    // 重甲守卫自身减伤（只给 bulwark；与 10 级减伤乘算，不给其他怪）
    this.selfDefense = cfg.selfDefense || 0;
    this.speed    = cfg.speed * (0.85 + Math.random() * 0.3) * speedMult;
    this.damage   = Math.round(cfg.damage * scaleFactor);
    this.exp     = cfg.exp;
    this.radius  = cfg.radius;
    this.color   = cfg.color;
    this.hitTimer = 0;

    // 新敌人特殊攻击伤害：接入时间成长（与接触伤害同一 scaleFactor，不重复乘）
    this.chargeDamage    = Math.round((cfg.chargeDamage || 0) * scaleFactor);
    this.explosionDamage = Math.round((cfg.explosionDamage || 0) * scaleFactor);
    // 暗影奴役移速倍率对冲锋速度只应用一次（不叠加随机移速倍率）
    this.chargeSpeedMult = speedMult;

    // Type-specific timers
    this.fireTimer     = cfg.fireRate       ? (Math.random() * cfg.fireRate + 0.5) : 0;
    this.waveTimer     = cfg.attackInterval ? cfg.attackInterval : 0;
    this.healTimer     = cfg.healInterval   ? cfg.healInterval   : 0;
    this.plusSignTimer = 0.3; // 圈内 + 号浮现节奏

    // 视觉表现
    this.waveRings  = []; // wave 怪物的扩散声波圈
    this.healLinks  = []; // healer 怪物对其他怪物的回血连线
    this.spawnTimer = 0;   // 0 -> 1 冒出动画

    // 暗影冰封
    this.freezeTimer      = 0;   // 冰封剩余时间
    this.freezeSpeedMult  = 1;   // 冰封期间移速倍率（0.1 = -90%）
    this.freezeHitCount   = 0;   // 已受攻击次数（玩家/暗影）
    this.freezeLastTime   = -1e9; // 上次冰封触发时间（state.time）
    this.freezeRot        = 0;   // 多面体旋转角

    // 引雷麻痹（电击类控制：与冰封独立，不显示冰罩）
    this.paralyzeTimer      = 0;   // 麻痹剩余时间（只刷新不叠加）
    this.paralyzeSpeedMult  = 1;   // 麻痹期间移速倍率

    // 裂角突袭者：追击 → 蓄势 → 冲锋 → 恢复 状态机
    this.chargerState = 'chase';   // chase | windup | charge | recover
    this.chargerTimer = 0;         // 蓄势/冲锋/恢复剩余时间
    this.chargerCd    = CONFIG.NEW_ENEMY.CHARGER_FIRST_DELAY; // 冲锋冷却（首次至少等 1s）
    this.chargeDirX   = 1;         // 蓄势开始锁定的冲锋方向（不中途重新瞄准）
    this.chargeDirY   = 0;
    this.chargeDist   = 0;         // 本次冲锋已走距离
    this.chargeHit    = false;     // 本次冲锋是否已成功伤害玩家

    // 灰烬投手：抬手 → 投掷（落点锁定）→ 冷却 状态机
    this.lobState = 'cooldown';    // cooldown | windup
    this.lobTimer = CONFIG.NEW_ENEMY.LOB_FIRST_DELAY; // 首次攻击至少等 1.5s
    this.podPulse = 0;             // 灰烬囊抬手收缩进度（0~1，仅视觉）

    // 重甲守卫：移动摆动相位（仅视觉）
    this.swayPhase = Math.random() * Math.PI * 2;

    // Boss 弹球速度（初速 = cfg.speed，加速到 maxSpeed）
    if (type === 'boss') {
      this.maxSpeed = cfg.maxSpeed;
      this.accel    = cfg.accel;
      const ang = Math.random() * Math.PI * 2;
      this.vx = Math.cos(ang) * this.speed;
      this.vy = Math.sin(ang) * this.speed;
    }
  }

  update(dt, player, enemies, state) {
    if (!this.alive) return;
    if (this.hitTimer > 0) this.hitTimer -= dt;
    if (this.spawnTimer < 1) {
      this.spawnTimer = Math.min(1, this.spawnTimer + dt / 0.4); // 0.4s 冒出
    }

    // 暗影冰封：倒计时 + 多面体旋转
    if (this.freezeTimer > 0) {
      this.freezeTimer -= dt;
      this.freezeRot   += dt * 0.6;
      if (this.freezeTimer <= 0) {
        this.freezeTimer     = 0;
        this.freezeSpeedMult = 1;
      }
    }

    // 引雷麻痹：倒计时（结束后恢复移速倍率）
    if (this.paralyzeTimer > 0) {
      this.paralyzeTimer -= dt;
      if (this.paralyzeTimer <= 0) {
        this.paralyzeTimer     = 0;
        this.paralyzeSpeedMult = 1;
      }
    }

    // BOSS 眨眼（已删除）

    // 衰减声波圈
    for (let i = this.waveRings.length - 1; i >= 0; i--) {
      const r = this.waveRings[i];
      r.life -= dt;
      r.radius = r.maxRadius * (1 - r.life / r.maxLife);
      // 玩家在波纹范围里：每 0.5s 强制扣 1 点 + 闪红（绕过无敌）
      r.tickTimer -= dt;
      if (r.tickTimer <= 0) {
        r.tickTimer = 0.5;
        if (player && Utils.dist(this, player) < r.radius) {
          player.hp = Math.max(0, player.hp - 1);
          player.hitFlash = 0.2;
          Particles.spawn(player.x, player.y, '#ff3c6e', 4, 60, 0.3);
          if (player.hp <= 0 && state) state.gameOver = true;
        }
      }
      if (r.life <= 0) this.waveRings.splice(i, 1);
    }
    // 衰减回血连线
    for (let i = this.healLinks.length - 1; i >= 0; i--) {
      const link = this.healLinks[i];
      link.life -= dt;
      if (link.life <= 0) this.healLinks.splice(i, 1);
    }

    if (this.type === 'shooter') {
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) {
        this.fireTimer = CONFIG.ENEMY_TYPES.shooter.fireRate;
        this._shootAt(player);
      }
      this._moveToward(player, dt);
    } else if (this.type === 'wave') {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        this.waveTimer = CONFIG.ENEMY_TYPES.wave.attackInterval;
        this._waveAttack(player, state);
      }
      this._moveToward(player, dt);
    } else if (this.type === 'healer') {
      this.healTimer -= dt;
      if (this.healTimer <= 0) {
        this.healTimer = CONFIG.ENEMY_TYPES.healer.healInterval;
        this._healNearby(enemies);
      }
      // 圈内持续浮现暗绿色 + 号
      this.plusSignTimer -= dt;
      if (this.plusSignTimer <= 0) {
        this.plusSignTimer = 0.3;
        const r = CONFIG.ENEMY_TYPES.healer.healRadius;
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * r;
        Particles.spawnText(
          this.x + Math.cos(a) * d,
          this.y + Math.sin(a) * d,
          '+', '#3c64d8', 1.0, 24 // 150%X (X=16)
        );
      }
      // 静止不动
    } else if (this.type === 'charger') {
      // 裂角突袭者：追击 → 蓄势 → 冲锋 → 恢复
      this._updateCharger(dt, player, state);
    } else if (this.type === 'bulwark') {
      // 重甲守卫：缓慢追击（无远程、无冲锋）
      this._moveToward(player, dt);
    } else if (this.type === 'lobber') {
      // 灰烬投手：远距离靠近 / 近距离停下投掷
      this._updateLobber(dt, player, state);
    } else if (this.type === 'boss') {
      // 突袭者 BOSS：每 5s 触发一次 0.6s 极快冲向玩家
      if (this._isDasher) {
        if (this._dashing) {
          this._dashTime -= dt;
          if (this._dashTime <= 0) {
            this._dashing  = false;
            this._dashTimer = 5.0;
            // 突袭结束：给一个朝外的反弹初速度，恢复弹球模式
            const ang = Math.atan2(this.y - player.y, this.x - player.x) + (Math.random() - 0.5) * 0.6;
            const sp  = this.speed * 1.2;
            this.vx = Math.cos(ang) * sp;
            this.vy = Math.sin(ang) * sp;
          } else {
            // 突袭中：朝玩家极速移动（直线冲刺，不受弹球机制影响）
            const dx = player.x - this.x, dy = player.y - this.y;
            const d  = Math.hypot(dx, dy);
            if (d > 1) {
              const burstSp = this.maxSpeed * 1.8; // 突袭速度（极快）
              this.x += (dx / d) * burstSp * dt;
              this.y += (dy / d) * burstSp * dt;
            }
            // 突袭期间也保留与边界的 clamp
            this.x = Utils.clamp(this.x, 0, CONFIG.MAP_W);
            this.y = Utils.clamp(this.y, 0, CONFIG.MAP_H);
          }
        } else {
          this._dashTimer -= dt;
          if (this._dashTimer <= 0) {
            this._dashing  = true;
            this._dashTime = 0.6; // 0.6s 突袭
          }
        }
      }
      // Boss 弹球：撞到怪物/自己/边界都会反弹 + 加速
      if (!this._dashing) {
        this._bossBounceAndMove(dt, enemies);
      }
    } else {
      // melee：向主角移动
      this._moveToward(player, dt);
    }

    // Clamp to map
    this.x = Utils.clamp(this.x, 0, CONFIG.MAP_W);
    this.y = Utils.clamp(this.y, 0, CONFIG.MAP_H);
  }

  // 控制入口：减速（冰封类，只取更强减速，不覆盖速度字段）
  applySlow(duration, multiplier) {
    if (this.freezeTimer < duration) this.freezeTimer = duration;
    if (this.freezeSpeedMult > multiplier) this.freezeSpeedMult = multiplier;
  }

  // 控制入口：麻痹（引雷电击类；只刷新剩余时间，绝不叠加持续时间）
  applyStun(duration) {
    if (this.paralyzeTimer < duration) this.paralyzeTimer = duration;
    if (this.paralyzeSpeedMult > 0.05) this.paralyzeSpeedMult = 0.05;
  }

  // 综合移速倍率（冰封 × 麻痹）
  _ctrlSpeedMult() {
    return (this.freezeSpeedMult || 1) *
           (this.paralyzeTimer > 0 ? (this.paralyzeSpeedMult || 1) : 1);
  }

  _moveToward(player, dt) {
    if (this.speed <= 0) return;
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const d  = Math.sqrt(dx * dx + dy * dy);
    if (d > 1) {
      const sp = this.speed * this._ctrlSpeedMult();
      this.x += (dx / d) * sp * dt;
      this.y += (dy / d) * sp * dt;
    }
  }

  // ── 裂角突袭者：追击 → 蓄势 → 冲锋 → 恢复 ──────────────────────────────
  _updateCharger(dt, player, state) {
    const cfg = CONFIG.NEW_ENEMY;
    const st  = this.chargerState;
    // 冷却从一次冲锋结束起算（含恢复期），首次生成后至少等 CHARGER_FIRST_DELAY
    this.chargerCd -= dt;

    if (st === 'chase') {
      this._moveToward(player, dt);
      const d = Utils.dist(this, player);
      if (this.chargerCd <= 0 && d <= cfg.CHARGER_TRIGGER_RANGE && d > 1) {
        // 蓄势开始即记录玩家位置并锁定方向，蓄势结束不重新瞄准
        const ang = Math.atan2(player.y - this.y, player.x - this.x);
        this.chargeDirX = Math.cos(ang);
        this.chargeDirY = Math.sin(ang);
        this.chargerState = 'windup';
        this.chargerTimer = cfg.CHARGER_WINDUP;
      }
      return;
    }

    if (st === 'windup') {
      // 眩晕/麻痹可中断蓄势（不自行清除敌人身上的控制）
      if (this.paralyzeTimer > 0) {
        this.chargerState = 'chase';
        this.chargerCd    = cfg.CHARGER_COOLDOWN;
        return;
      }
      this.chargerTimer -= dt;
      if (this.chargerTimer <= 0) {
        this.chargerState = 'charge';
        this.chargerTimer = cfg.CHARGER_DURATION;
        this.chargeDist   = 0;
        this.chargeHit    = false;
      }
      return;
    }

    if (st === 'charge') {
      // 眩晕/麻痹可中断冲锋
      if (this.paralyzeTimer > 0) { this._endCharge(); return; }
      this.chargerTimer -= dt;
      // 减速通过统一移动倍率影响冲锋；暗影奴役移速倍率只应用一次
      const sp   = cfg.CHARGER_SPEED * (this.chargeSpeedMult || 1) * this._ctrlSpeedMult();
      const step = sp * dt;
      const px = this.x, py = this.y;
      const nx = this.x + this.chargeDirX * step;
      const ny = this.y + this.chargeDirY * step;
      // 路径碰撞检测：低帧率 / 玩家高速移动下不被穿过；同一次冲锋只结算一次
      if (!this.chargeHit) {
        const rr = CONFIG.PLAYER_RADIUS + this.radius - 4;
        if (this._segDist(px, py, nx, ny, player) < rr) {
          this.chargeHit = true;
          // 冲锋命中只造成普通特殊伤害（不追加 8 点接触伤害），
          // 走玩家受伤入口：正常遵守无敌帧、防御与护壳规则
          player.takeDamage(this.chargeDamage, state, false, false, this.x, this.y);
        }
      }
      this.x = nx;
      this.y = ny;
      this.chargeDist += step;
      // 撞到地图边界 / 不可穿越障碍提前结束（普通敌人不视为墙）
      const m = this.radius;
      let hitWall = (this.x < m || this.x > CONFIG.MAP_W - m ||
                     this.y < m || this.y > CONFIG.MAP_H - m);
      if (hitWall) {
        this.x = Utils.clamp(this.x, m, CONFIG.MAP_W - m);
        this.y = Utils.clamp(this.y, m, CONFIG.MAP_H - m);
      }
      if (hitWall || this.chargerTimer <= 0 || this.chargeDist >= cfg.CHARGER_MAX_DIST) {
        this._endCharge();
      }
      return;
    }

    // recover：暂停主动追击，身体从前倾恢复，随后回到正常追击
    this.chargerTimer -= dt;
    if (this.chargerTimer <= 0) this.chargerState = 'chase';
  }

  // 冲锋结束：进入恢复并开始计算冷却（冷却从冲锋结束起算）
  _endCharge() {
    this.chargerState = 'recover';
    this.chargerTimer = CONFIG.NEW_ENEMY.CHARGER_RECOVER;
    this.chargerCd    = CONFIG.NEW_ENEMY.CHARGER_COOLDOWN;
  }

  // 点到线段距离（冲锋本帧移动路径 vs 玩家）
  _segDist(x1, y1, x2, y2, p) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= 0) return Math.hypot(p.x - x1, p.y - y1);
    let t = ((p.x - x1) * dx + (p.y - y1) * dy) / lenSq;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return Math.hypot(p.x - (x1 + t * dx), p.y - (y1 + t * dy));
  }

  // ── 灰烬投手：抬手 → 投掷（落点锁定）→ 冷却 ────────────────────────────
  _updateLobber(dt, player, state) {
    const cfg = CONFIG.NEW_ENEMY;
    const d = Utils.dist(this, player);
    // 距离超过 400px 才缓慢靠近；进入后停下投掷（不绕路、不风筝、不后退）
    if (d > cfg.LOB_APPROACH_RANGE) this._moveToward(player, dt);

    if (this.lobState === 'windup') {
      this.lobTimer -= dt;
      this.podPulse = Math.min(1, 1 - this.lobTimer / cfg.LOB_WINDUP);
      if (this.lobTimer <= 0) {
        // 投掷瞬间锁定玩家当前位置为固定世界坐标；此后不追踪、不修正落点
        LobberBombs.spawn(this, player.x, player.y, this.explosionDamage);
        this.lobState = 'cooldown';
        this.lobTimer = cfg.LOB_COOLDOWN; // 冷却从投掷完成后开始计算
        this.podPulse = 0;
      }
      return;
    }

    this.lobTimer -= dt;
    if (this.lobTimer <= 0 && d <= cfg.LOB_ATTACK_RANGE) {
      this.lobState = 'windup';
      this.lobTimer = cfg.LOB_WINDUP;
      this.podPulse = 0;
    }
  }

  // Boss 弹球：撞到怪物/自己/边界都反弹，每次碰撞加速（封顶 maxSpeed）
  _bossBounceAndMove(dt, enemies) {
    // 撞到其他 enemy
    for (const other of enemies) {
      if (other === this || !other.alive) continue;
      const dx = other.x - this.x, dy = other.y - this.y;
      const sumR = this.radius + other.radius;
      const distSq = dx * dx + dy * dy;
      if (distSq < sumR * sumR && distSq > 0) {
        const dist = Math.sqrt(distSq);
        const nx = dx / dist, ny = dy / dist;
        const overlap = sumR - dist;
        // 推开 boss（不推对方，避免破坏其他怪物行为）
        this.x -= nx * overlap;
        this.y -= ny * overlap;
        // 沿连线反弹
        const dot = this.vx * nx + this.vy * ny;
        if (dot > 0) {
          this.vx -= 2 * dot * nx;
          this.vy -= 2 * dot * ny;
        }
        this._accelerate();
        // 撞到另一个 boss：对方也反弹
        if (other.type === 'boss' && other.vx != null) {
          const n2x = -nx, n2y = -ny;
          const dot2 = other.vx * n2x + other.vy * n2y;
          if (dot2 > 0) {
            other.vx -= 2 * dot2 * n2x;
            other.vy -= 2 * dot2 * n2y;
          }
          if (typeof other._accelerate === 'function') other._accelerate();
        }
      }
    }
    // 撞到地图边界
    if (this.x < this.radius) {
      this.x = this.radius; this.vx = -this.vx; this._accelerate();
    } else if (this.x > CONFIG.MAP_W - this.radius) {
      this.x = CONFIG.MAP_W - this.radius; this.vx = -this.vx; this._accelerate();
    }
    if (this.y < this.radius) {
      this.y = this.radius; this.vy = -this.vy; this._accelerate();
    } else if (this.y > CONFIG.MAP_H - this.radius) {
      this.y = CONFIG.MAP_H - this.radius; this.vy = -this.vy; this._accelerate();
    }
    // 移动
    this.x += this.vx * this._ctrlSpeedMult() * dt;
    this.y += this.vy * this._ctrlSpeedMult() * dt;
  }

  // Boss 加速（封顶 maxSpeed）
  _accelerate() {
    const cur = Math.hypot(this.vx, this.vy);
    if (cur < this.maxSpeed && cur > 0) {
      const target = Math.min(cur * this.accel, this.maxSpeed);
      const scale = target / cur;
      this.vx *= scale;
      this.vy *= scale;
    }
  }

  // 暗影冰封：生成不规则多面体顶点（3D 玻璃罩）
  _genIceVerts(radius) {
    const N = 12;
    const verts = [];
    for (let i = 0; i < N; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi   = Math.acos(2 * v - 1);
      verts.push({
        x: radius * Math.sin(phi) * Math.cos(theta),
        y: radius * Math.sin(phi) * Math.sin(theta) * 0.78, // y 略压扁，更像球状
        z: radius * Math.cos(phi),
      });
    }
    return verts;
  }

  _shootAt(player) {
    const cfg = CONFIG.ENEMY_TYPES.shooter;
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const d  = Math.sqrt(dx * dx + dy * dy);
    if (d < 1) return;
    const angle = Math.atan2(dy, dx);
    BulletManager.spawn(this.x, this.y, angle,
      cfg.bulletSpeed, this.damage, cfg.bulletRadius, cfg.bulletColor, 'enemy');
  }

  _waveAttack(player, state) {
    const cfg = CONFIG.ENEMY_TYPES.wave;
    // 触发扩散波纹圈；玩家在波纹范围里每 0.5s 受 1 点伤害（绕过无敌，强制扣血 + 闪红）
    this.waveRings.push({
      radius: 0,
      maxRadius: cfg.attackRadius,
      life: 1.2,
      maxLife: 1.2,
      tickTimer: 0.5,
    });
  }

  _healNearby(enemies) {
    const cfg = CONFIG.ENEMY_TYPES.healer;
    for (const e of enemies) {
      if (e === this || !e.alive) continue;
      if (Utils.dist(this, e) < cfg.healRadius) {
        e.hp = Math.min(e.maxHp, e.hp + cfg.healAmount);
        // Record heal link (coordinate snapshot for the yellow line)
        this.healLinks.push({
          x: e.x, y: e.y,
          life: 0.6, maxLife: 0.6,
        });
        // 深蓝色 + 号提示被治疗（230%X，X=16 → 37）
        Particles.spawnText(
          e.x + Utils.rand(-e.radius, e.radius),
          e.y - e.radius - 4,
          '+', '#3c64d8', 1.0, 37
        );
      }
    }
  }

  takeDamage(amount, state, fromOwner) {
    // BOSS：扣共享血池 + 同步所有 BOSS hp；共享池 <= 0 全部死亡
    if (this.type === 'boss') {
      this.hitTimer = 0.12;
      const sharedHpBefore = (EnemyManager._bossSharedHp != null) ? EnemyManager._bossSharedHp : this.hp;
      const newHp = Math.max(0, sharedHpBefore - amount);
      EnemyManager._bossSharedHp = newHp;
      // 同步所有 boss 实例的 hp 字段（视觉血条一致）—— 只遍历 BOSS 列表而非全表
      const bossList = EnemyManager._bossList;
      for (let i = 0; i < bossList.length; i++) bossList[i].hp = newHp;
      if (newHp <= 0) {
        // 全部 3 个 BOSS 同时死亡
        for (let i = 0; i < bossList.length; i++) {
          const e = bossList[i];
          e.hp    = 0;
          e.alive = false;
          e.active = false;
        }
        if (state) {
          // 一次性结算 3 倍奖励
          state.player.addExp(this.exp * 3, state);
          if (state.player.overlord) state.player.damage += 3;
          // 暗影爆破：仅流派 1（Shadow Echo）LV6+ 触发
          if (state.genre === 0 && state.genreLv >= 6) ShadowExplosionManager.spawn(this.x, this.y, state);
          // 公共爆炸机制卡：敌人死亡时产生爆炸
          PublicBlastManager.onEnemyDeath(this.x, this.y, state);
          Particles.spawn(this.x, this.y, '#ff2030', 30, 200, 0.8);
        }
        // 真实死亡 → DEATH 事件（只有真实死亡才能产生 DEATH 标签）
        if (state && typeof EchoManager !== 'undefined') {
          EchoManager.onDeath(this.x, this.y, state);
        }
        // 不灭的暗影：真实击杀产生死亡余烬 / 遗蜕 / 死潮回流冷却缩减
        if (state && state.genre === 2 && typeof UndyingManager !== 'undefined') {
          UndyingManager.onEnemyDeath(this.x, this.y, state, this);
        }
        DeathShadowManager.spawn(this.x, this.y, state, this);
        EnemyManager._defeatedBossCount = (EnemyManager._defeatedBossCount || 0) + 1;
        // 无尽模式：清标记，等下一轮 BOSS 触发（60s 后再次出现）
        // 普通模式：置「已击败」标记，不再复活（否则 time≥90 恒成立会立刻重刷 BOSS）
        if (state && state.endlessMode) {
          EnemyManager._bossTimeSpawned = false;
        } else {
          EnemyManager._bossDefeated = true;
        }
      }
      return;
    }

    // 重甲守卫自身减伤 × 10 级后普通怪减伤（乘算，只应用一次；其他怪自身减伤为 0）
    const selfDef = this.selfDefense || 0;
    const lvDef   = this.defense || 0;
    if (selfDef > 0 || lvDef > 0) {
      amount = amount * (1 - selfDef) * (1 - lvDef);
    }
    this.hp -= amount;
    this.hitTimer = 0.12;

    // 暗影冰封：玩家/暗影攻击累计 3 次触发（同一怪物 30s 内仅能触发一次）
    if (state && state.freezeEnabled && !this.alive) {
      // （hp 已 ≤ 0 时不再冻结，节省开销）
    } else if (state && state.freezeEnabled && (fromOwner === 'player' || fromOwner === 'shadow')) {
      this.freezeHitCount++;
      const now = (state.time != null) ? state.time : 0;
      if (this.freezeHitCount >= 3 && (now - this.freezeLastTime) >= 30) {
        this.freezeHitCount  = 0;
        this.freezeLastTime  = now;
        this.freezeTimer     = 10;
        this.freezeSpeedMult = 0.1;  // 10 秒内移速 -90%
        // 随机生成多面体顶点（不规则蓝色玻璃罩，3D 感）
        if (!this.freezeVerts) this.freezeVerts = this._genIceVerts(this.radius * 1.25);
        // 因果残响：冰封触发视为 CONTROL 事件（可生成残响）
        if (state.genre === 3) EchoManager.onControl(this.x, this.y, this, state);
      }
    }

    if (this.hp <= 0) {
      this.hp    = 0;
      this.alive = false;
      if (state) {
        state.player.addExp(this.exp, state);
        // 吸血：击杀时按最大生命百分比回血（走统一恢复入口，可转护壳）
        if (state.player.lifesteal > 0) {
          const heal = Math.round(state.player.effectiveMaxHp * state.player.lifesteal);
          if (heal > 0) {
            state.player.heal(heal, state);
          }
        }
        // 暗影君王：每杀一个怪，基础攻击 +1
        if (state.player.overlord) {
          state.player.damage += 1;
        }
        // LV6: 击杀时暗影爆破（仅流派 1 Shadow Echo 触发）
        if (state.genre === 0 && state.genreLv >= 6) {
          ShadowExplosionManager.spawn(this.x, this.y, state);
        }
        // 公共爆炸机制卡：敌人死亡时产生爆炸
        PublicBlastManager.onEnemyDeath(this.x, this.y, state);
      }
      // 真实死亡 → DEATH 事件（只有真实死亡才能产生 DEATH 标签）
      if (state && typeof EchoManager !== 'undefined') {
        EchoManager.onDeath(this.x, this.y, state);
      }
      // 不灭的暗影：真实击杀产生死亡余烬 / 遗蜕 / 死潮回流冷却缩减
      if (state && state.genre === 2 && typeof UndyingManager !== 'undefined') {
        UndyingManager.onEnemyDeath(this.x, this.y, state, this);
      }
      DeathShadowManager.spawn(this.x, this.y, state, this);
      Particles.spawn(this.x, this.y, this.color || '#ff3060', 10, 100, 0.6);
    }
  }
}

// ─── ENEMY MANAGER ───────────────────────────────────────────────────────────
const EnemyManager = {
  enemies:      [],
  spawnTimer:   0,
  waveInterval: CONFIG.ENEMY_SPAWN_INTERVAL,
  scaleTimer:   0,
  scaleFactor:  1,
  wave:         0, // 已生成的波次（用于解锁高级怪物）
  _bossList:    [],   // 当前存活 BOSS 缓存（避免全表 filter）
  _bossDefeated: false, // 普通模式：BOSS 全灭后置 true（不再复活）
  _spawnGrid:   null, // 刷怪间距查询用空间网格
  _gridBuf:     [],   // 网格查询结果缓冲
  _posBuf:      { x: 0, y: 0 }, // 随机落点复用缓冲

  init() {
    this.enemies     = [];
    this.spawnTimer  = 5; // first wave in 5s
    this.scaleTimer  = 0;
    this.scaleFactor = 1;
    this.wave        = 0;
    this._bossList   = [];
    this._defeatedBossCount  = 0;
    this._bossSummonTimer    = 1.0; // BOSS 在场时：每 1s 生成 2 个屏幕外随机怪
    this._wanderSpawnTimer   = 6.0; // 地图空地自然繁衍：每 2-3s 尝试 1 次

    // BOSS 计时触发（普通模式 90s 出现 3 眼；无尽模式每 60s 出现更高级 BOSS）
    this._bossTimeSpawned  = false;
    this._bossDefeated     = false; // 普通模式：BOSS 全灭后置 true（不再复活）
    this._bossSharedMaxHp  = CONFIG.ENEMY_TYPES.boss.hp; // 总血量（普通模式 60000 * 1.5 = 90000）
    this._bossSharedHp     = this._bossSharedMaxHp;
    this._bossChainTimer   = 15.0; // 距下次锁链（首个 15s 后开始）
    this._bossChainLife    = 0;    // 当前锁链剩余时间（>0 时锁链激活）
    this._bossIndex        = 0;    // 无尽模式：BOSS 编号（0 = 第 1 只）
    this._bossEyes         = 3;    // 当前 BOSS 眼数（普通模式 3；无尽模式 4, 5, 6, 7...）
    this._bossHpMult       = 1;    // 无尽模式：BOSS 血量倍率（300, 400, 500, 600% 附加）
    this._nextBossSpawnTime = null; // 无尽模式：下次 BOSS 触发时间（默认 60s）
  },

  update(dt, player, state) {
    // Scale timer
    this.scaleTimer += dt;
    if (this.scaleTimer >= CONFIG.ENEMY_SCALE_INTERVAL) {
      this.scaleTimer -= CONFIG.ENEMY_SCALE_INTERVAL;
      this.scaleFactor *= (1 + CONFIG.ENEMY_SCALE_HP * 0.5 + CONFIG.ENEMY_SCALE_DMG * 0.5);
    }

    // Wave spawn
    // 怪物 4（healer）不计入"场上数量"：它不死亡不会触发新一波
    let alive = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.alive && e.type !== 'healer') alive++;
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 || alive < CONFIG.ENEMY_MIN_ON_FIELD) {
      this.spawnTimer = this.waveInterval;
      this._spawnWave(player, state);
    }

    // 自然繁衍：地图空地会慢慢生成怪物（开局已开启，每 2-3s 尝试 1 次）
    this._wanderSpawnTimer -= dt;
    if (this._wanderSpawnTimer <= 0) {
      this._wanderSpawnTimer = Utils.rand(2.0, 3.0);
      // 距玩家 ≥ 220、距最近 enemy ≥ 80 才允许；healer 范围内不能再放 healer
      this._tryWanderSpawn(player, state);
    }

    // Update enemies（顺带重建存活 BOSS 列表，替代每帧 filter）
    const bossList = this._bossList;
    bossList.length = 0;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.update(dt, player, this.enemies, state);
      if (!e.alive) {
        this.enemies.splice(i, 1);
      } else if (e.type === 'boss') {
        bossList.push(e);
      }
    }

    // ── 胜利条件：普通模式 BOSS 全灭触发 gameWin；无尽模式不触发 ──
    if (state && !state.gameWin && !state.endlessMode && this._bossDefeated) {
      if (bossList.length === 0) state.gameWin = true;
    }

    // ── BOSS 触发（普通模式：90s 单波 3 眼；无尽模式：每 60s 一只，眼数/血量逐只递增）──
    // 普通模式击败 BOSS 后不再触发（防止无限复活）
    if (state && !this._bossTimeSpawned && !this._bossDefeated) {
      let trigger = Infinity;
      if (state.endlessMode) {
        // 无尽模式：从 60s 起每 60s 一只（_nextBossSpawnTime 维护下次时间）
        trigger = (this._nextBossSpawnTime != null) ? this._nextBossSpawnTime : 60;
      } else {
        // 普通模式：90s 单波（3 眼）
        this._bossEyes  = 3;
        this._bossHpMult = 1;
        this._bossSharedMaxHp = CONFIG.ENEMY_TYPES.boss.hp;
        trigger = 90;
      }
      if (state.time >= trigger) {
        // 准备本轮 BOSS 参数
        if (state.endlessMode) {
          this._bossIndex++;
          // 眼数 = BOSS 数量：第 1 只 4 眼=4 BOSS，第 2 只 5 眼=5 BOSS...
          this._bossEyes = 3 + this._bossIndex; // 4, 5, 6, 7...
          // 血量加成 300, 400, 500, 600%... 即 4x, 5x, 6x, 7x 基础血量
          const bonusPct = 300 + (this._bossIndex - 1) * 100;
          this._bossHpMult = 1 + bonusPct / 100;
          this._bossSharedMaxHp = Math.round(CONFIG.ENEMY_TYPES.boss.hp * this._bossHpMult);
          this._bossSharedHp    = this._bossSharedMaxHp;
          this._nextBossSpawnTime = state.time + 60;
        } else {
          // 普通模式：3 眼 = 3 BOSS 共享血条
          this._bossEyes  = 3;
          this._bossHpMult = 1;
          this._bossSharedMaxHp = CONFIG.ENEMY_TYPES.boss.hp;
          this._bossSharedHp    = this._bossSharedMaxHp;
        }
        this._bossTimeSpawned = true;
        this._spawnBosses(player, state, this._bossEyes);
      }
    }

    // BOSS 召唤：每 1s 在玩家屏幕外 spawn 2 个随机怪
    const hasBoss = bossList.length > 0;
    if (hasBoss) {
      this._bossSummonTimer -= dt;
      if (this._bossSummonTimer <= 0) {
        this._bossSummonTimer = 1.0;
        for (let i = 0; i < 2; i++) this._spawnOffscreenRandom(player, state);
      }
    } else {
      this._bossSummonTimer = 1.0;
    }

    // BOSS 锁链：每 15s 触发一次 5s 红色锁链（任意数量 BOSS 互连）
    const aliveBosses = bossList;
    if (aliveBosses.length >= 3) {
      if (this._bossChainLife > 0) {
        this._bossChainLife -= dt;
        // 玩家碰锁链受伤害
        if (state && state.player) {
          for (let i = 0; i < aliveBosses.length; i++) {
            for (let j = i + 1; j < aliveBosses.length; j++) {
              const a = aliveBosses[i], b = aliveBosses[j];
              const dx = b.x - a.x, dy = b.y - a.y;
              const lenSq = dx * dx + dy * dy;
              if (lenSq <= 0) continue;
              const dist = this._distToSegment(state.player, a, b);
              if (dist < 28) {
                if (!state.player._chainHitTimer) state.player._chainHitTimer = 0;
                state.player._chainHitTimer -= dt;
                if (state.player._chainHitTimer <= 0) {
                  state.player._chainHitTimer = 0.25;
                  // 锁链：33% 最大生命值真实伤害（无视防御力 + 无视玩家无敌）
                  state.player.takeDamage(Math.round(state.player.effectiveMaxHp * 0.33), state, true, true);
                }
              }
            }
          }
        }
      } else {
        this._bossChainTimer -= dt;
        if (this._bossChainTimer <= 0) {
          this._bossChainLife = 5.0;
          this._bossChainTimer = 15.0;
        }
      }
    } else {
      this._bossChainLife = 0;
    }
  },

  // 点到线段距离
  _distToSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    const px = a.x + t * dx, py = a.y + t * dy;
    return Math.hypot(p.x - px, p.y - py);
  },

  // BOSS 召唤：在玩家视口外 spawn 1 个随机类型怪物
  _spawnOffscreenRandom(player, state) {
    const types = ['melee', 'shooter', 'wave', 'healer'];
    // BOSS 召唤：保持总召唤频率不变，最多 30% 名额替换为已解锁新怪（遵守存活上限）
    const cfg = CONFIG.NEW_ENEMY;
    let type;
    const pool = [];
    for (const t of ['charger', 'bulwark', 'lobber']) {
      if (this._unlocked(t, state) && this._countAlive(t) < cfg.ALIVE_CAP[t]) pool.push(t);
    }
    if (pool.length > 0 && Math.random() < cfg.BOSS_SUMMON_SHARE) {
      type = pool[Math.floor(Math.random() * pool.length)];
    } else {
      type = types[Math.floor(Math.random() * types.length)];
    }
    const cam   = (state && state.cam) || { x: 0, y: 0, sw: CONFIG.MAP_W, sh: CONFIG.MAP_H };
    const edge  = CONFIG.ENEMY_EDGE_MARGIN;
    let x, y, ok = false;
    for (let t = 0; t < 12; t++) {
      x = Utils.rand(edge, CONFIG.MAP_W  - edge);
      y = Utils.rand(edge, CONFIG.MAP_H - edge);
      if (!Utils.isOnScreen(x, y, cam, 60)) { ok = true; break; }
    }
    if (!ok) { x = CONFIG.MAP_W - edge; y = CONFIG.MAP_H - edge; }
    // healer 范围内不能再生成 healer
    if (type === 'healer') {
      this._rebuildSpawnGrid();
      const healR = CONFIG.ENEMY_TYPES.healer.healRadius;
      if (this._anyEnemyNear(x, y, healR, 'healer')) return;
    }
    const e = new Enemy(x, y, this.scaleFactor, type, state);
    this.enemies.push(e);
  },

  // ── 刷怪间距查询（空间网格，判定结果与全表扫描一致但不随怪物数量劣化） ──
  _rebuildSpawnGrid() {
    if (!this._spawnGrid) this._spawnGrid = Utils.createGrid(128);
    this._spawnGrid.build(this.enemies, 0, 0, CONFIG.MAP_W, CONFIG.MAP_H);
  },

  // (x,y) 半径 radius 内是否存在存活敌人（type 非空时只看该类型）
  _anyEnemyNear(x, y, radius, type = null) {
    const grid = this._spawnGrid;
    const buf  = this._gridBuf;
    grid.query(x, y, radius, buf);
    const rSq = radius * radius;
    for (let k = 0; k < buf.length; k++) {
      const e = this.enemies[buf[k]];
      if (!e.alive) continue;
      if (type && e.type !== type) continue;
      const dx = e.x - x, dy = e.y - y;
      if (dx * dx + dy * dy < rSq) return true;
    }
    return false;
  },

  _spawnWave(player, state) {
    this.wave++;
    const w = this.wave;
    const base = CONFIG.ENEMY_WAVE_COUNT;

    // 本波刷怪共用一张间距查询网格（新生成的怪会增量入桶）
    this._rebuildSpawnGrid();

    // 第 3 波起小怪递增 2w-1；第 8 波起额外 +5/wave
    const meleeCount = base
      + (w >= 3 ? 2 * w - 1 : 0)
      + (w >= 8 ? (w - 7) * 5 : 0);

    // 第 2 波起射手递增（最多 4 个/波）；第 8 波起额外 +3/wave
    const shooterCount = (w >= 2 ? this._specialCount(w, 2) : 0)
      + (w >= 8 ? (w - 7) * 3 : 0);

    // Wave 1 起：怪物1（普通小怪）；30/45/60s 起部分近战名额替换为新怪
    this._spawnTypes(player, this._planMeleeMix(meleeCount, state), state);

    // Wave 2 起：怪物2（射手）
    if (w >= 2) this._spawn(player, shooterCount, 'shooter', state);

    // Wave 3 起：怪物3（声波）
    if (w >= 3) this._spawn(player, this._specialCount(w, 2), 'wave', state);

    // Wave 4 起：怪物4（治疗）
    if (w >= 4) this._spawn(player, this._specialCount(w, 1), 'healer', state);

    // 在玩家看不见的地方，每种额外生成 3-6 个（分散）
    this._spawnOffscreen(player, state);
  },

  _spawnBoss(player, state) {
    // 在玩家附近随机方向生成（不重叠），距离 280
    for (let attempt = 0; attempt < 10; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 280;
      const x = Utils.clamp(player.x + Math.cos(ang) * dist, 40, CONFIG.MAP_W - 40);
      const y = Utils.clamp(player.y + Math.sin(ang) * dist, 40, CONFIG.MAP_H - 40);
      // 不与已有 boss 重叠
      let overlap = false;
      for (const e of this.enemies) {
        if (e.type === 'boss' && e.alive) {
          const dx = e.x - x, dy = e.y - y;
          if (dx * dx + dy * dy < (e.radius + 50) * (e.radius + 50)) { overlap = true; break; }
        }
      }
      if (!overlap) {
        const boss = new Enemy(x, y, this.scaleFactor, 'boss', state);
        boss.hp    = this._bossSharedHp;
        boss.maxHp = this._bossSharedMaxHp;
        boss.eyes  = 1; // 每只 1 眼（眼数 = BOSS 数量）
        this.enemies.push(boss);
        this._bossList.push(boss);
        return;
      }
    }
    // 兜底：直接 push
    const boss = new Enemy(player.x + 100, player.y + 100, this.scaleFactor, 'boss', state);
    boss.hp    = this._bossSharedHp;
    boss.maxHp = this._bossSharedMaxHp;
    boss.eyes  = 1;
    this.enemies.push(boss);
    this._bossList.push(boss);
  },

  // 共享血量 BOSS 群 spawn：n 只 BOSS 互成 360°/n，共享血池，每只 1 只眼睛
  // 眼数 = BOSS 数量：普通 3 眼=3 只；无尽 4/5/6/7... 眼=对应数量
  // 第 0 只 BOSS 为"突袭者"：每 5s 一次 0.6s 极快冲向玩家
  _spawnBosses(player, state, n) {
    this._bossSharedHp    = this._bossSharedMaxHp;
    this._bossChainTimer  = 15.0;
    this._bossChainLife   = 0;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 260;
      const x = Utils.clamp(player.x + Math.cos(ang) * dist, 40, CONFIG.MAP_W - 40);
      const y = Utils.clamp(player.y + Math.sin(ang) * dist, 40, CONFIG.MAP_H - 40);
      const boss = new Enemy(x, y, this.scaleFactor, 'boss', state);
      boss.hp    = this._bossSharedHp;
      boss.maxHp = this._bossSharedMaxHp;
      boss.eyes  = 1; // 每只 1 眼（眼数 = BOSS 数量）
      boss._isDasher  = (i === 0);            // 第 0 只 BOSS 是突袭者
      boss._dashTimer = 5.0;                  // 突袭倒计时
      boss._dashing   = false;                // 当前是否在突袭
      boss._dashTime  = 0;                    // 突袭已用时间
      this.enemies.push(boss);
      this._bossList.push(boss);
    }
  },

  // 在玩家视野外随机位置生成怪物（开局很少，每波增多）
  _spawnOffscreen(player, state) {
    const cam = Renderer.cam;
    const offRadius = Math.max(cam.sw, cam.sh) / 2 + 50;
    const edge = CONFIG.ENEMY_EDGE_MARGIN;
    const types = ['melee'];
    if (this.wave >= 2) types.push('shooter');
    if (this.wave >= 3) types.push('wave');
    if (this.wave >= 4) types.push('healer');
    const healR = CONFIG.ENEMY_TYPES.healer.healRadius;
    // 第 1 波最少（约 1-2 个/种），每波 +1，封顶 7/种
    const base = 1 + Math.floor((this.wave - 1) * 0.6);
    for (const type of types) {
      const count = Math.min(base + Math.floor(Utils.rand(0, 2)), 7);
      // 视野外补充的近战名额同样按解锁与存活上限替换为新怪（不额外叠加数量）
      const plan = (type === 'melee') ? this._planMeleeMix(count, state) : null;
      for (let i = 0; i < count; i++) {
        const t = plan ? plan[i] : type;
        const angle = Math.random() * Math.PI * 2;
        const dist  = Utils.rand(offRadius, offRadius + 200);
        let x = player.x + Math.cos(angle) * dist;
        let y = player.y + Math.sin(angle) * dist;
        x = Utils.clamp(x, edge, CONFIG.MAP_W - edge);
        y = Utils.clamp(y, edge, CONFIG.MAP_H - edge);
        // healer 范围内不能再生成 healer
        if (t === 'healer' && this._anyEnemyNear(x, y, healR, 'healer')) continue;
        this.enemies.push(new Enemy(x, y, this.scaleFactor, t, state));
        this._spawnGrid.add(x, y, this.enemies.length - 1);
      }
    }
  },

  _spawn(player, count, type, state) {
    const types = [];
    for (let i = 0; i < count; i++) types.push(type);
    this._spawnTypes(player, types, state);
  },

  // 按类型列表生成（距玩家 400-800、距已有怪物 ≥ 60，避免挤在一起）
  _spawnTypes(player, types, state) {
    const minD = 400;
    const maxD = 800;
    const sep  = 60;
    for (let i = 0; i < types.length; i++) {
      let px = 0, py = 0, ok = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        const p = this._randomSpawnPos(player, minD, maxD);
        if (!this._anyEnemyNear(p.x, p.y, sep)) { px = p.x; py = p.y; ok = true; break; }
      }
      if (!ok) {
        const p = this._randomSpawnPos(player, minD, maxD);
        px = p.x; py = p.y;
      }
      this.enemies.push(new Enemy(px, py, this.scaleFactor, types[i], state));
      // 新怪入网格，保持与全表间距判定一致
      this._spawnGrid.add(px, py, this.enemies.length - 1);
    }
  },

  // ── 新普通敌人（charger / bulwark / lobber）生成规则 ─────────────────────
  // 全场某类型存活数量
  _countAlive(type) {
    let n = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.alive && e.type === type) n++;
    }
    return n;
  },

  // 按实际战斗时间解锁（不依赖波次数量，清怪快也不会提前解锁）
  _unlocked(type, state) {
    const t = CONFIG.NEW_ENEMY.UNLOCK_TIME[type];
    return t != null && !!state && state.time >= t;
  },

  // 常规波次：把部分近战名额替换为已解锁的新怪
  // （合计 ≤ 35%，遵守每波上限与全场存活上限；无合法名额时保留原有近战怪）
  _planMeleeMix(count, state) {
    const cfg = CONFIG.NEW_ENEMY;
    const out = [];
    for (let i = 0; i < count; i++) out.push('melee');
    if (count <= 0 || !state) return out;
    let slots = Math.floor(count * cfg.WAVE_SHARE);
    if (slots <= 0) return out;
    const waveUsed = { charger: 0, bulwark: 0, lobber: 0 };
    let replaceIdx = 0;
    for (let i = 0; i < slots; i++) {
      const pool = [];
      for (const t of ['charger', 'bulwark', 'lobber']) {
        if (!this._unlocked(t, state)) continue;
        if (waveUsed[t] >= cfg.WAVE_CAP[t]) continue;
        if (this._countAlive(t) + waveUsed[t] >= cfg.ALIVE_CAP[t]) continue;
        pool.push(t);
      }
      if (pool.length === 0) break;
      const t = pool[Math.floor(Math.random() * pool.length)];
      // 替换一个仍为近战怪的名额（达到上限时自然回退为近战怪）
      while (replaceIdx < out.length && out[replaceIdx] !== 'melee') replaceIdx++;
      if (replaceIdx >= out.length) break;
      out[replaceIdx++] = t;
      waveUsed[t]++;
    }
    return out;
  },

  // 地图空地自然繁衍：1 个/次，距玩家 ≥ 220、距最近 enemy ≥ 80
  _tryWanderSpawn(player, state) {
    const edge = CONFIG.ENEMY_EDGE_MARGIN;
    const types = ['melee', 'melee', 'melee', 'shooter', 'wave', 'healer'];
    // 自然繁衍：复用新怪解锁时间与全场存活上限（不加独立繁衍计时器）
    const cfg = CONFIG.NEW_ENEMY;
    for (const t of ['charger', 'bulwark', 'lobber']) {
      if (this._unlocked(t, state) && this._countAlive(t) < cfg.ALIVE_CAP[t]) types.push(t);
    }
    const healR = CONFIG.ENEMY_TYPES.healer.healRadius;
    this._rebuildSpawnGrid();
    for (let attempt = 0; attempt < 10; attempt++) {
      const x = Utils.rand(edge, CONFIG.MAP_W - edge);
      const y = Utils.rand(edge, CONFIG.MAP_H - edge);
      const dx = x - player.x, dy = y - player.y;
      if (dx * dx + dy * dy < 220 * 220) continue;
      if (this._anyEnemyNear(x, y, 80)) continue;
      // 选类型后再校验 healer 范围约束
      let chosen = null;
      const shuffled = Utils.shuffle(types);
      for (const t of shuffled) {
        if (t === 'healer' && this._anyEnemyNear(x, y, healR, 'healer')) {
          continue; // healer 范围内不能再放 healer
        }
        chosen = t;
        break;
      }
      if (!chosen) continue;
      this.enemies.push(new Enemy(x, y, this.scaleFactor, chosen, state));
      this._spawnGrid.add(x, y, this.enemies.length - 1);
      return;
    }
  },

  // 特殊怪物数量随波次递增（每多一波 +1，达到上限 4 个）
  _specialCount(wave, base) {
    return Math.min(base + (wave - 2), 4);
  },

  _randomSpawnPos(player, minD = CONFIG.ENEMY_SPAWN_MARGIN_MIN, maxD = CONFIG.ENEMY_SPAWN_MARGIN_MAX) {
    const edge = CONFIG.ENEMY_EDGE_MARGIN;
    const pos = this._posBuf;
    for (let attempt = 0; attempt < 20; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist  = Utils.rand(minD, maxD);
      let x = player.x + Math.cos(angle) * dist;
      let y = player.y + Math.sin(angle) * dist;
      x = Utils.clamp(x, edge, CONFIG.MAP_W - edge);
      y = Utils.clamp(y, edge, CONFIG.MAP_H - edge);
      const dx = x - player.x, dy = y - player.y;
      if (dx * dx + dy * dy >= minD * minD) { pos.x = x; pos.y = y; return pos; }
    }
    pos.x = Utils.rand(edge, CONFIG.MAP_W - edge);
    pos.y = Utils.rand(edge, CONFIG.MAP_H - edge);
    return pos;
  },

  getAlive() {
    // 复用缓冲返回存活列表（调用方须在同帧内用完，勿跨帧持有）
    const out = this._aliveBuf || (this._aliveBuf = []);
    out.length = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.alive) out.push(e);
    }
    return out;
  },

  // 存活 BOSS 列表（渲染 / 逻辑共用）
  getAliveBosses() {
    const out = [];
    for (let i = 0; i < this._bossList.length; i++) {
      const b = this._bossList[i];
      if (b.alive) out.push(b);
    }
    return out;
  },

  clear() { this.enemies = []; this._bossList = []; this._bossDefeated = false; }
};

// ─── LOBBER BOMBS（灰烬投手抛投攻击对象：统一管理）──────────────────────────
    // 炸弹不是敌人：不进敌人列表，不被玩家子弹 / 弹球 / 磁极残核当作敌人或可反弹单位。
// 逻辑落点固定为世界坐标；绘制高度偏移只影响视觉，不改变爆炸坐标。
// 投手死亡后已抛出的炸弹继续按原落点结算；游戏死亡 / 通关 / 重开时统一清理。
const LobberBombs = {
  bombs: [],
  fx:    [],   // 爆炸碎焰 / 地面焦痕（纯视觉）

  spawn(owner, targetX, targetY, damage) {
    const cfg = CONFIG.NEW_ENEMY;
    this.bombs.push({
      x:  owner.x, y:  owner.y,        // 当前世界坐标（起点→落点插值）
      sx: owner.x, sy: owner.y,        // 起点（抛物线基准）
      tx: targetX, ty: targetY,        // 固定落点（飞行中不再修正）
      t:  0,
      flight: cfg.LOB_FLIGHT_TIME,
      damage: damage,
      radius: cfg.LOB_RADIUS,
      alive:  true,
    });
  },

  update(dt, player, state) {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.t += dt;
      const u = Math.min(1, b.t / b.flight);
      b.x = b.sx + (b.tx - b.sx) * u;
      b.y = b.sy + (b.ty - b.sy) * u;
      if (b.t >= b.flight) {
        this.bombs.splice(i, 1);
        this._explode(b, player, state);
      }
    }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.life -= dt;
      if (f.life <= 0) this.fx.splice(i, 1);
    }
  },

  // 落点爆炸：范围内玩家一次性普通伤害（不逐帧重复、不伤敌人、不留持续伤害区）
  _explode(b, player, state) {
    const cfg = CONFIG.NEW_ENEMY;
    if (player && state && !state.gameOver && !state.gameWin) {
      const dx = player.x - b.tx, dy = player.y - b.ty;
      if (dx * dx + dy * dy <= b.radius * b.radius) {
        // 走玩家受伤入口：正常遵守无敌帧、防御与护壳规则
        player.takeDamage(b.damage, state, false, false, b.tx, b.ty);
      }
    }
    // 视觉：橙红碎焰 + 少量黑色灰烬 + 地面焦痕（不触发全屏白闪 / 蓝白雷）
    Particles.spawn(b.tx, b.ty, '#ff6a2a', 10, 150, 0.5);
    Particles.spawn(b.tx, b.ty, '#2a1410', 6, 90, 0.7);
    this.fx.push({
      kind: 'blast', x: b.tx, y: b.ty, radius: b.radius,
      life: cfg.LOB_BLAST_FX_LIFE, maxLife: cfg.LOB_BLAST_FX_LIFE,
    });
    this.fx.push({
      kind: 'scorch', x: b.tx, y: b.ty, radius: b.radius * 0.62,
      life: cfg.LOB_SCORCH_LIFE, maxLife: cfg.LOB_SCORCH_LIFE,
    });
  },

  clear() { this.bombs = []; this.fx = []; }
};

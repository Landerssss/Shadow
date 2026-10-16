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
    // 暗影奴役 BUFF：普通小怪/射手/声波怪 速度 +40% / 血量 -25%
    const serv = state && state.servitudeActive && (type === 'melee' || type === 'shooter' || type === 'wave');
    const speedMult = serv ? 1.4 : 1;
    const hpMult    = serv ? 0.75 : 1;
    // 10 级后所有怪物：血量 +20% / 防御 +20%
    const lv10 = state && state.player && state.player.level >= 10;
    const lv10HpMult  = lv10 ? 1.2 : 1.0;
    const lv10DefMult = lv10 ? 0.2 : 0; // 减伤 20%
    this.maxHp    = Math.round(cfg.hp * scaleFactor * hpMult * lv10HpMult);
    this.hp       = this.maxHp;
    this.defense  = lv10DefMult;
    this.speed    = cfg.speed * (0.85 + Math.random() * 0.3) * speedMult;
    this.damage   = Math.round(cfg.damage * scaleFactor);
    this.exp     = cfg.exp;
    this.radius  = cfg.radius;
    this.color   = cfg.color;
    this.hitTimer = 0;

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

  _moveToward(player, dt) {
    if (this.speed <= 0) return;
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const d  = Math.sqrt(dx * dx + dy * dy);
    if (d > 1) {
      const sp = this.speed * (this.freezeSpeedMult || 1);
      this.x += (dx / d) * sp * dt;
      this.y += (dy / d) * sp * dt;
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
    this.x += this.vx * (this.freezeSpeedMult || 1) * dt;
    this.y += this.vy * (this.freezeSpeedMult || 1) * dt;
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
      // 同步所有 boss 实例的 hp 字段（视觉血条一致）
      for (const e of EnemyManager.enemies) {
        if (e.type === 'boss') e.hp = newHp;
      }
      if (newHp <= 0) {
        // 全部 3 个 BOSS 同时死亡
        for (const e of EnemyManager.enemies) {
          if (e.type === 'boss') {
            e.hp    = 0;
            e.alive = false;
            e.active = false;
          }
        }
        if (state) {
          // 一次性结算 3 倍奖励
          state.player.addExp(this.exp * 3, state);
          if (state.player.overlord) state.player.damage += 3;
          // 暗影爆破：仅流派 1（Shadow Echo）LV6+ 触发
          if (state.genre === 0 && state.genreLv >= 6) ShadowExplosionManager.spawn(this.x, this.y, state);
          Particles.spawn(this.x, this.y, '#ff2030', 30, 200, 0.8);
        }
        DeathShadowManager.spawn(this.x, this.y, state);
        EnemyManager._defeatedBossCount = (EnemyManager._defeatedBossCount || 0) + 1;
        // 允许下一轮 BOSS 触发（无尽模式 60s 后再次出现；普通模式直接 gameWin）
        EnemyManager._bossTimeSpawned = false;
      }
      return;
    }

    // 10 级后所有怪物自带 20% 减伤
    if (this.defense && this.defense > 0) {
      amount = amount * (1 - this.defense);
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
      }
    }

    if (this.hp <= 0) {
      this.hp    = 0;
      this.alive = false;
      if (state) {
        state.player.addExp(this.exp, state);
        // 吸血：击杀时按最大生命百分比回血
        if (state.player.lifesteal > 0) {
          const heal = Math.round(state.player.effectiveMaxHp * state.player.lifesteal);
          if (heal > 0) {
            state.player.hp = Math.min(state.player.effectiveMaxHp, state.player.hp + heal);
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
      }
      DeathShadowManager.spawn(this.x, this.y, state);
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

  init() {
    this.enemies     = [];
    this.spawnTimer  = 5; // first wave in 5s
    this.scaleTimer  = 0;
    this.scaleFactor = 1;
    this.wave        = 0;
    this._defeatedBossCount  = 0;
    this._bossSummonTimer    = 1.0; // BOSS 在场时：每 1s 生成 2 个屏幕外随机怪
    this._wanderSpawnTimer   = 6.0; // 地图空地自然繁衍：每 2-3s 尝试 1 次

    // BOSS 计时触发（普通模式 90s 出现 3 眼；无尽模式每 60s 出现更高级 BOSS）
    this._bossTimeSpawned  = false;
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
    const alive = this.enemies.filter(e => e.alive && e.type !== 'healer').length;
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

    // Update enemies
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.update(dt, player, this.enemies, state);
      if (!e.alive) {
        this.enemies.splice(i, 1);
      }
    }

    // ── 胜利条件：普通模式 BOSS 全灭触发 gameWin；无尽模式不触发 ──
    if (state && !state.gameWin && !state.endlessMode && this._bossTimeSpawned && this._bossSharedHp <= 0) {
      const aliveBoss = this.enemies.some(e => e.alive && e.type === 'boss');
      if (!aliveBoss) state.gameWin = true;
    }

    // ── BOSS 触发（普通模式：90s 单波 3 眼；无尽模式：每 60s 一只，眼数/血量逐只递增）──
    if (state && !this._bossTimeSpawned) {
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
    const hasBoss = this.enemies.some(e => e.alive && e.type === 'boss');
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
    const aliveBosses = this.enemies.filter(e => e.alive && e.type === 'boss');
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
    const type  = types[Math.floor(Math.random() * types.length)];
    const cfg   = CONFIG.ENEMY_TYPES[type];
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
      const healR = CONFIG.ENEMY_TYPES.healer.healRadius;
      for (const e of this.enemies) {
        if (e.alive && e.type === 'healer' && Utils.dist({ x, y }, e) < healR) return;
      }
    }
    const e = new Enemy(x, y, this.scaleFactor, type, state);
    this.enemies.push(e);
  },

  _spawnWave(player, state) {
    this.wave++;
    const w = this.wave;
    const base = CONFIG.ENEMY_WAVE_COUNT;

    // 第 3 波起小怪递增 2w-1；第 8 波起额外 +5/wave
    const meleeCount = base
      + (w >= 3 ? 2 * w - 1 : 0)
      + (w >= 8 ? (w - 7) * 5 : 0);

    // 第 2 波起射手递增（最多 4 个/波）；第 8 波起额外 +3/wave
    const shooterCount = (w >= 2 ? this._specialCount(w, 2) : 0)
      + (w >= 8 ? (w - 7) * 3 : 0);

    // Wave 1 起：怪物1（普通小怪）
    this._spawn(player, meleeCount, 'melee', state);

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
        return;
      }
    }
    // 兜底：直接 push
    const boss = new Enemy(player.x + 100, player.y + 100, this.scaleFactor, 'boss', state);
    boss.hp    = this._bossSharedHp;
    boss.maxHp = this._bossSharedMaxHp;
    boss.eyes  = 1;
    this.enemies.push(boss);
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
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist  = Utils.rand(offRadius, offRadius + 200);
        let x = player.x + Math.cos(angle) * dist;
        let y = player.y + Math.sin(angle) * dist;
        x = Utils.clamp(x, edge, CONFIG.MAP_W - edge);
        y = Utils.clamp(y, edge, CONFIG.MAP_H - edge);
        // healer 范围内不能再生成 healer
        if (type === 'healer') {
          let inRange = false;
          for (const e of this.enemies) {
            if (e.alive && e.type === 'healer' && Utils.dist({ x, y }, e) < healR) {
              inRange = true; break;
            }
          }
          if (inRange) continue;
        }
        this.enemies.push(new Enemy(x, y, this.scaleFactor, type, state));
      }
    }
  },

  _spawn(player, count, type, state) {
    // 距玩家 400-800、距已有怪物 ≥ 60（避免挤在一起）
    const minD = 400;
    const maxD = 800;
    const sep  = 60;
    for (let i = 0; i < count; i++) {
      let pos = null;
      for (let attempt = 0; attempt < 30; attempt++) {
        const p = this._randomSpawnPos(player, minD, maxD);
        let tooClose = false;
        for (const e of this.enemies) {
          if (!e.alive) continue;
          if (Utils.dist(p, e) < sep) { tooClose = true; break; }
        }
        if (!tooClose) { pos = p; break; }
      }
      if (!pos) pos = this._randomSpawnPos(player, minD, maxD);
      this.enemies.push(new Enemy(pos.x, pos.y, this.scaleFactor, type, state));
    }
  },

  // 地图空地自然繁衍：1 个/次，距玩家 ≥ 220、距最近 enemy ≥ 80
  _tryWanderSpawn(player, state) {
    const edge = CONFIG.ENEMY_EDGE_MARGIN;
    const types = ['melee', 'melee', 'melee', 'shooter', 'wave', 'healer'];
    const healR = CONFIG.ENEMY_TYPES.healer.healRadius;
    for (let attempt = 0; attempt < 10; attempt++) {
      const x = Utils.rand(edge, CONFIG.MAP_W - edge);
      const y = Utils.rand(edge, CONFIG.MAP_H - edge);
      if (Utils.dist({ x, y }, player) < 220) continue;
      let nearEnemy = false;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (Utils.dist({ x, y }, e) < 80) { nearEnemy = true; break; }
      }
      if (nearEnemy) continue;
      // 选类型后再校验 healer 范围约束
      let chosen = null;
      const shuffled = Utils.shuffle(types);
      for (const t of shuffled) {
        if (t === 'healer') {
          let inHealRange = false;
          for (const e of this.enemies) {
            if (e.alive && e.type === 'healer' && Utils.dist({ x, y }, e) < healR) {
              inHealRange = true; break;
            }
          }
          if (inHealRange) continue; // healer 范围内不能再放 healer
        }
        chosen = t;
        break;
      }
      if (!chosen) continue;
      this.enemies.push(new Enemy(x, y, this.scaleFactor, chosen, state));
      return;
    }
  },

  // 特殊怪物数量随波次递增（每多一波 +1，达到上限 4 个）
  _specialCount(wave, base) {
    return Math.min(base + (wave - 2), 4);
  },

  _randomSpawnPos(player, minD = CONFIG.ENEMY_SPAWN_MARGIN_MIN, maxD = CONFIG.ENEMY_SPAWN_MARGIN_MAX) {
    const edge = CONFIG.ENEMY_EDGE_MARGIN;
    for (let attempt = 0; attempt < 20; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist  = Utils.rand(minD, maxD);
      let x = player.x + Math.cos(angle) * dist;
      let y = player.y + Math.sin(angle) * dist;
      x = Utils.clamp(x, edge, CONFIG.MAP_W - edge);
      y = Utils.clamp(y, edge, CONFIG.MAP_H - edge);
      if (Utils.dist({ x, y }, player) >= minD) return { x, y };
    }
    return { x: Utils.rand(edge, CONFIG.MAP_W - edge), y: Utils.rand(edge, CONFIG.MAP_H - edge) };
  },

  getAlive() {
    return this.enemies.filter(e => e.alive);
  },

  clear() { this.enemies = []; }
};

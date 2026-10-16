// ─── PLAYER ───────────────────────────────────────────────────────────────────
const Player = {
  x: CONFIG.MAP_W / 2,
  y: CONFIG.MAP_H / 2,
  vx: 0, vy: 0,
  facing: -Math.PI / 2,   // radians; default up
  speed:  CONFIG.PLAYER_SPEED,

  // Stats (modified by buffs)
  maxHp:    CONFIG.PLAYER_MAX_HP,
  hp:       CONFIG.PLAYER_MAX_HP,
  damage:   CONFIG.PLAYER_DAMAGE,
  fireRate: CONFIG.PLAYER_FIRE_RATE,  // shots/s

  // Multipliers accumulated by buffs
  hpMult:    1,
  dmgMult:   1,
  aspdMult:  1,
  speedMult: 1,    // 移动速度倍率
  defMult:   0,    // damage reduction (0..1)
  lifesteal: 0,    // heal on kill (% of max HP)
  shotgun:   false,// 散弹模式（一次发射三方向）

  fireTimer:       0,
  muzzleFlash:     0,
  invincibleTimer: 0,
  hitFlash:        0,    // 受击闪红（被波纹等持续伤害触发）
  shadowEnergy:    false,// 暗影能源 BUFF：每 5s 回复 15% 血量
  shadowEnergyTimer: 5,  // 距下次回血的剩余时间
  overlord:        false,// 暗影君王 BUFF：每杀一个怪 +1 基础攻击

  // EXP / leveling
  level:    1,
  exp:      0,
  expToNext: CONFIG.EXP_PER_LEVEL_BASE,

  // Accumulated stats
  kills:    0,
  totalDmg: 0,

  init(opts) {
    this.x = CONFIG.MAP_W / 2;
    this.y = CONFIG.MAP_H / 2;
    this.vx = this.vy = 0;
    this.facing = -Math.PI / 2;
    this.maxHp = CONFIG.PLAYER_MAX_HP;
    this.hp    = this.maxHp;
    this.damage    = CONFIG.PLAYER_DAMAGE;
    this.fireRate  = CONFIG.PLAYER_FIRE_RATE;
    this.hpMult    = 1;
    this.dmgMult   = 1;
    this.aspdMult  = 1;
    this.speedMult = 1;
    this.defMult   = 0;
    this.lifesteal = 0;
    this.shotgun   = false;
    this.fireTimer       = 0;
    this.muzzleFlash     = 0;
    this.invincibleTimer = 0;
    this.hitFlash        = 0;
    this.shadowEnergy    = false;
    this.shadowEnergyTimer = 5;
    this.overlord        = false;
    this.level    = 1;
    this.exp      = 0;
    this.expToNext = CONFIG.EXP_PER_LEVEL_BASE;
    this.kills    = 0;
    this.totalDmg = 0;
    // 无尽模式：BUFF 加成倍率（>1 时所有 apply*Buff 的数值乘以此值）
    this._endlessMult = (opts && opts.endlessBuffMult) ? opts.endlessBuffMult : 1;
  },

  // Effective stats after multipliers
  get effectiveDamage() {
    return this.damage * this.dmgMult;
  },
  get effectiveFireRate() {
    return this.fireRate * this.aspdMult;
  },
  get effectiveMaxHp() {
    return Math.round(this.maxHp * this.hpMult);
  },

  update(dt, input, enemies, state) {
    this._handleMovement(dt, input);
    this._handleShooting(dt, enemies, state);
    this._handleEnemyCollision(dt, enemies, state);
    this._updateCamera();
    if (this.invincibleTimer > 0) this.invincibleTimer -= dt;
    if (this.muzzleFlash > 0)    this.muzzleFlash -= dt * 4;
    if (this.hitFlash > 0)       this.hitFlash -= dt;
    // 暗影能源：每 5s 回复 15% 最大血量
    if (this.shadowEnergy) {
      this.shadowEnergyTimer -= dt;
      if (this.shadowEnergyTimer <= 0) {
        this.shadowEnergyTimer = 5.0;
        const heal = this.effectiveMaxHp * 0.15;
        this.hp = Math.min(this.effectiveMaxHp, this.hp + heal);
      }
    }
  },

  _handleMovement(dt, input) {
    let dx = 0, dy = 0;
    if (input.keys['KeyW'] || input.keys['ArrowUp'])    dy -= 1;
    if (input.keys['KeyS'] || input.keys['ArrowDown'])  dy += 1;
    if (input.keys['KeyA'] || input.keys['ArrowLeft'])  dx -= 1;
    if (input.keys['KeyD'] || input.keys['ArrowRight']) dx += 1;

    if (dx !== 0 || dy !== 0) {
      const norm = Utils.normalize(dx, dy);
      const sp = this.speed * this.speedMult;
      this.vx = norm.x * sp;
      this.vy = norm.y * sp;
      this.facing = Math.atan2(norm.y, norm.x);
    } else {
      this.vx *= 0.85;
      this.vy *= 0.85;
      // facing stays
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.x = Utils.clamp(this.x, 20, CONFIG.MAP_W - 20);
    this.y = Utils.clamp(this.y, 20, CONFIG.MAP_H - 20);
  },

  _handleShooting(dt, enemies, state) {
    // LV5 Echo: attack speed bonus per active shadow
    let aspdMult = this.aspdMult;
    if (state.genre === 0 && state.genreLv >= 5) {
      const n = ShadowCloneManager.getActive().length +
                DeathShadowManager.shadows.filter(s => s.active).length;
      aspdMult *= (1 + n * CONFIG.ECHO.LV5_PLAYER_ASPD_PER_SHADOW);
    }
    const fireRate = this.fireRate * aspdMult;

    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      this.fireTimer = 1 / fireRate;
      const dmg = this.effectiveDamage;

      let angle = this.facing;
      let nearest = null;
      let bestDistSq = Infinity;
      for (const e of enemies) {
        if (!e.alive) continue;
        const dx = e.x - this.x;
        const dy = e.y - this.y;
        const dSq = dx * dx + dy * dy;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          nearest = e;
        }
      }
      if (nearest) {
        angle = Math.atan2(nearest.y - this.y, nearest.x - this.x);
        this.facing = angle;
      }

      BulletManager.spawn(
        this.x, this.y,
        angle,
        CONFIG.PLAYER_BULLET_SPEED,
        dmg,
        CONFIG.PLAYER_BULLET_RADIUS,
        '#c97bff',
        'player'
      );
      // 散弹：主方向两侧 ±30°
      if (this.shotgun) {
        const spread = Math.PI / 6; // 30°
        BulletManager.spawn(
          this.x, this.y, angle - spread,
          CONFIG.PLAYER_BULLET_SPEED, dmg,
          CONFIG.PLAYER_BULLET_RADIUS, '#c97bff', 'player'
        );
        BulletManager.spawn(
          this.x, this.y, angle + spread,
          CONFIG.PLAYER_BULLET_SPEED, dmg,
          CONFIG.PLAYER_BULLET_RADIUS, '#c97bff', 'player'
        );
      }
      this.muzzleFlash = 1;
    }
  },

  _handleEnemyCollision(dt, enemies, state) {
    // 突袭中的 BOSS 无视玩家无敌（持续撞击造成真实伤害）
    for (const e of enemies) {
      if (!e.alive || e.damage <= 0) continue;
      if (e.type !== 'boss' || !e._dashing) continue;
      if (Utils.dist(this, e) < CONFIG.PLAYER_RADIUS + e.radius - 4) {
        this.takeDamage(Math.round(this.effectiveMaxHp * 0.44), state, true, true);
        return;
      }
    }
    if (this.invincibleTimer > 0) return;
    for (const e of enemies) {
      if (!e.alive) continue;
      if (e.damage <= 0) continue;
      if (Utils.dist(this, e) < CONFIG.PLAYER_RADIUS + e.radius - 4) {
        // BOSS 碰撞：44% 最大生命值真实伤害（无视防御力）
        if (e.type === 'boss') {
          this.takeDamage(Math.round(this.effectiveMaxHp * 0.44), state, true);
        } else {
          this.takeDamage(e.damage, state);
        }
        break;
      }
    }
  },

  takeDamage(amount, state, trueDamage, ignoreInvincible) {
    if (this.invincibleTimer > 0 && !ignoreInvincible) return;
    // 真实伤害（trueDamage）无视防御力；普通伤害按 defMult × 0.9 减伤（防御力下调 10%）
    const finalDmg = trueDamage
      ? amount
      : Math.max(1, amount * (1 - (this.defMult || 0) * 0.9));
    this.hp = Math.max(0, this.hp - finalDmg);
    if (!ignoreInvincible) {
      this.invincibleTimer = CONFIG.PLAYER_INVINCIBLE_MS / 1000;
    }
    this.hitFlash = 0.2;
    Particles.spawn(this.x, this.y, '#ff3c6e', 8, 80, 0.5);
    // screen shake placeholder
    if (this.hp <= 0) {
      state.gameOver = true;
    }
  },

  addExp(amount, state) {
    this.exp += amount;
    while (this.exp >= this.expToNext) {
      this.exp      -= this.expToNext;
      this.level    += 1;
      this.aspdMult *= 1.07;
      // 每级基础属性提升：伤害 +1.5、血量 +5（升级时同步回 5 血）
      this.damage   += 1.5;
      this.maxHp    += 5;
      this.hp       = Math.min(this.hp + 5, this.effectiveMaxHp);
      // 第 10 级起每级经验额外 ×1.25
      const lvl = this.level;
      const post10Mult = (lvl >= 10) ? Math.pow(1.25, lvl - 9) : 1;
      this.expToNext = Math.round(CONFIG.EXP_PER_LEVEL_BASE *
        Math.pow(CONFIG.EXP_SCALE, lvl - 1) * post10Mult);
      state.pendingLevelUp = true;
    }
  },

  _updateCamera() {
    Renderer.cam.x = this.x;
    Renderer.cam.y = this.y;
  },

  // Apply buff multipliers (called when buff selected)
  applyHpBuff(pct) {
    const base = (pct != null) ? pct : CONFIG.BUFF_HP_BONUS;
    const mult = (this._endlessMult != null) ? this._endlessMult : 1;
    const bonus = base * mult;
    this.hpMult += bonus;
    const newMax = this.effectiveMaxHp;
    const ratio  = this.hp / this.maxHp;
    this.maxHp   = newMax;
    this.hp      = Math.round(newMax * ratio);
  },
  applyDmgBuff(pct) {
    const base = (pct != null) ? pct : CONFIG.BUFF_DMG_BONUS;
    const mult = (this._endlessMult != null) ? this._endlessMult : 1;
    this.dmgMult += base * mult;
  },
  applyAspdBuff(pct) {
    const base = (pct != null) ? pct : CONFIG.BUFF_ASPD_BONUS;
    const mult = (this._endlessMult != null) ? this._endlessMult : 1;
    this.aspdMult += base * mult;
  },
  applyDefBuff(pct) {
    const base = (pct != null) ? pct : CONFIG.BUFF_DEF_BONUS;
    const mult = (this._endlessMult != null) ? this._endlessMult : 1;
    this.defMult += base * mult;
  },
  applyLifestealBuff(pct) {
    const base = (pct != null) ? pct : CONFIG.BUFF_LIFESTEAL_BONUS;
    const mult = (this._endlessMult != null) ? this._endlessMult : 1;
    this.lifesteal += base * mult;
  },
  applySpeedBuff(pct) {
    const base = (pct != null) ? pct : 0.08;
    const mult = (this._endlessMult != null) ? this._endlessMult : 1;
    this.speedMult += base * mult;
  },
};

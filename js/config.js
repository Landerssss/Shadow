// ─── GAME CONFIGURATION ──────────────────────────────────────────────────────
const CONFIG = {
  // Map
  MAP_W: 4000,
  MAP_H: 4000,
  TILE_SIZE: 64,

  // Player
  PLAYER_SPEED:      220,   // px/s
  PLAYER_MAX_HP:     144,    // -20% 初始血量再 -10% = 160 * 0.9 = 144
  PLAYER_DAMAGE:     25,    // base bullet damage
  PLAYER_FIRE_RATE:  2.0,   // bullets per second
  PLAYER_BULLET_SPEED: 480,
  PLAYER_BULLET_RADIUS: 6,
  PLAYER_RADIUS:     18,
  PLAYER_INVINCIBLE_MS: 600, // ms invincible after hit

  // EXP / Levels
  EXP_PER_LEVEL_BASE: 80,
  EXP_SCALE: 1.35,          // multiplier per level

  // Enemy
  ENEMY_SPAWN_INTERVAL: 30, // seconds
  ENEMY_MIN_ON_FIELD: 5,    // force next wave if fewer than this
  ENEMY_SPAWN_MARGIN_MIN: 300,    // min distance from player to spawn
  ENEMY_SPAWN_MARGIN_MAX: 500,    // max distance from player to spawn (screen edge ~540)
  ENEMY_EDGE_MARGIN:      100,    // 怪物距地图边缘的最小距离（防卡角）

  ENEMY_BASE: {
    hp: 60, speed: 90, damage: 12, exp: 15, radius: 14,
    fireRate: 0, // melee only
  },
  ENEMY_SCALE_INTERVAL: 60, // seconds until enemy stat boost
  ENEMY_SCALE_HP:       0.25, // +25% hp per minute
  ENEMY_SCALE_DMG:      0.20, // +20% damage per minute
  ENEMY_WAVE_COUNT:     8,    // enemies per wave

  ENEMY_TYPES: {
    melee: {
      color: '#ff3060',
      hp: 60, speed: 90, damage: 12, exp: 15, radius: 14,
    },
    shooter: {
      color: '#ffd84a',
      hp: 50, speed: 60, damage: 10, exp: 18, radius: 14,
      fireRate: 3.0,
      bulletSpeed: 360, bulletRadius: 6, bulletColor: '#ffd84a',
    },
    wave: {
      color: '#22ee70',
      hp: 90, speed: 130, damage: 3, exp: 20, radius: 18,  // 移速加快
      attackRadius: 114,
      attackInterval: 0.4,
    },
    healer: {
      color: '#3c64d8',  // 深蓝（与其他怪物画风一致：高饱和度强发光）
      hp: 320, speed: 0, damage: 0, exp: 30, radius: 39,  // 体积 +50%
      healRadius: 240,                                    // 范围 +20%
      healAmount: 6,
      healInterval: 1.0,
    },
    boss: {
      color: '#ff2030',
      hp: 90000, speed: 200, damage: 25, exp: 200, radius: 40,  // 血量 +50%（原 60000 → 90000）
      maxSpeed: 450, // 速度上限（极快）
      accel:    1.08, // 每次碰撞加速倍率
    },
  },

  // ── Genre 0: Shadow Echo ──────────────────────────────────────────
  ECHO: {
    SPAWN_INTERVAL: [null, 20, 10, 5, 5, 5],  // [lv0 unused, lv1=20s, lv2=10s, lv3=5s, lv4=5s, lv5=5s]
    DURATION:       20,    // seconds（暗影存在时间）
    PATROL_RADIUS:  180,   // px around spawn point
    BASE_DAMAGE:    20,
    BASE_FIRE_RATE: 2.1,
    BULLET_SPEED:   420,
    BULLET_RADIUS:  5,
    BODY_RADIUS:    14,
    LV4_DMG_BONUS:  0.40,
    LV5_PLAYER_ASPD_PER_SHADOW: 0.15,
    LV5_SHADOW_ASPD_PER_SHADOW: 0.10,
    EXPLOSION_RADIUS: 17,  // 暗影爆炸范围（≈ 怪物 1 半径 14 × 1.2）
    EXPLOSION_DAMAGE: 30,
  },

  // ── Genre 1: Shadow Vortex ─────────────────────────────────────────
  VORTEX: {
    PROJECTILE_INTERVAL: 2.0, // s
    PROJECTILE_SPEED:    520,
    PROJECTILE_RADIUS:   7,
    VORTEX_DURATION:     4.0, // s
    VORTEX_RADIUS:       80,  // px
    VORTEX_PULL_FORCE:   180, // px/s toward center
    VORTEX_TICK_DAMAGE:  8,   // per 0.3s tick
    VORTEX_TICK_RATE:    0.3, // s
    LV2_RADIUS_BONUS:    0.10,
    LV3_DMG_BONUS:       0.20,
    // lv5: 漩涡持续产生闪电（0.8s 消失，方向随机）
    // lv6: 两个漩涡相交生成暗影裂隙，分 3 次朝怪物密集方向发射激光
    // lv7: 两个相交的漩涡在裂隙结束后融合成 1.5 倍大漩涡
    RIFT_LASER_DAMAGE:   60,
    RIFT_LASER_RANGE:    300, // LV6 暗影裂隙激光长度（+50%）
    RIFT_BEAM_WIDTH:     6,   // 激光宽度（变细）
    LIGHTNING_WIDTH:     2,   // 闪电宽度（LV5 漩涡自产）
    LV7_FUSE_RADIUS_MULT: 1.5,
  },

  // ── Shadow Link (BUFF 2) ──────────────────────────────────────────
  LINK_DAMAGE:     20,     // damage per pass-through
  LINK_COOLDOWN:   3.0,    // s per enemy per link

  // ── Death Shadow (BUFF 1) ─────────────────────────────────────────
  DEATH_SHADOW_DURATION: 4.0,

  // ── BUFF values ──────────────────────────────────────────────────
  BUFF_HP_BONUS:    0.05,
  BUFF_DMG_BONUS:   0.05,
  BUFF_ASPD_BONUS:  0.10,
  BUFF_DEF_BONUS:        0.036, // 防御力 -10%（4% × 0.9 = 3.6%）
  BUFF_LIFESTEAL_BONUS:  0.05,
};

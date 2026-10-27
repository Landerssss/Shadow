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
    // 裂角突袭者：有预警的直线冲锋（近战怪的冲锋变体）
    charger: {
      color: '#ff7043',
      hp: 75, speed: 110, damage: 8, exp: 24, radius: 16,
      chargeDamage: 14,   // 冲锋命中伤害（走时间成长）
    },
    // 重甲守卫：缓慢追击的高耐久前排
    bulwark: {
      color: '#883b4c',
      hp: 180, speed: 55, damage: 16, exp: 32, radius: 24,
      selfDefense: 0.10,  // 自身减伤 10%（与 10 级后普通怪减伤乘算）
    },
    // 灰烬投手：落点固定的延迟范围攻击
    lobber: {
      color: '#8f3344',
      hp: 85, speed: 55, damage: 6, exp: 26, radius: 17,
      explosionDamage: 14, // 落点爆炸伤害（走时间成长）
    },
    boss: {
      color: '#ff2030',
      hp: 90000, speed: 200, damage: 25, exp: 200, radius: 40,  // 血量 +50%（原 60000 → 90000）
      maxSpeed: 450, // 速度上限（极快）
      accel:    1.08, // 每次碰撞加速倍率
    },
  },

  // ── 新普通敌人（charger / bulwark / lobber）行为与生成参数 ──────────────
  // 所有首轮测试基线集中在此，行为与渲染代码不得散落硬编码数值。
  NEW_ENEMY: {
    // 裂角突袭者（charger）：追击 → 蓄势 → 冲锋 → 恢复
    CHARGER_FIRST_DELAY:   1.0,   // 首次生成后至少等待（s）才能开始蓄势
    CHARGER_TRIGGER_RANGE: 260,   // 进入该距离且冷却完成才蓄势（px）
    CHARGER_WINDUP:        0.65,  // 蓄势时长（s）：停止移动、锁定方向、地面预警
    CHARGER_SPEED:         360,   // 冲锋速度（px/s；移速倍率只应用一次）
    CHARGER_DURATION:      0.5,   // 冲锋持续（s）
    CHARGER_MAX_DIST:      180,   // 冲锋最大基础距离（px）
    CHARGER_COOLDOWN:      4.5,   // 冲锋结束后冷却（s）
    CHARGER_RECOVER:       0.55,  // 冲锋后恢复（s）：暂停主动追击
    CHARGER_WARN_WIDTH:    46,    // 冲锋预警通道宽度（px）
    CHARGER_TRAIL_STEP:    14,    // 冲锋拖尾碎线间距（px）
    CHARGER_TRAIL_COUNT:   8,     // 冲锋拖尾碎线段数

    // 灰烬投手（lobber）：抬手 → 投掷（落点锁定）→ 抛物线飞行 → 爆炸
    LOB_FIRST_DELAY:       1.5,   // 首次生成后至少等待（s）才能攻击
    LOB_APPROACH_RANGE:    400,   // 超出该距离才缓慢靠近（px）
    LOB_ATTACK_RANGE:      480,   // 最大攻击距离（px）
    LOB_WINDUP:            0.3,   // 抬手时长（s）：囊体收缩发亮
    LOB_FLIGHT_TIME:       0.9,   // 抛物线飞行时间（s）= 落点预警持续时间
    LOB_COOLDOWN:          3.8,   // 投掷完成后冷却（s）
    LOB_RADIUS:            65,    // 爆炸半径（px）
    LOB_ARC_HEIGHT:        170,   // 抛物线视觉高度（px，只影响绘制不改落点）
    LOB_BOMB_RADIUS:       10,    // 炸弹视觉半径（px）
    LOB_SCORCH_LIFE:       2.0,   // 地面焦痕残留时间（s）
    LOB_BLAST_FX_LIFE:     0.35,  // 爆炸碎焰特效时间（s）

    // 生成解锁与名额（按实际战斗时间解锁，不依赖波次数量）
    UNLOCK_TIME: { charger: 30, bulwark: 45, lobber: 60 }, // 解锁时间（s）
    WAVE_SHARE:  0.35,  // 常规波次新敌人合计占本次生成普通怪数量上限（从近战名额替换）
    WAVE_CAP:    { charger: 3, bulwark: 2, lobber: 2 }, // 每波每种上限
    ALIVE_CAP:   { charger: 4, bulwark: 3, lobber: 3 }, // 全场同时存活上限（超出回退近战怪）
    BOSS_SUMMON_SHARE: 0.30, // BOSS 召唤名额替换为已解锁新怪的比例（总频率不变）
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

  // ── Genre 3: Causal Echo（因果残响）─────────────────────────────────
  CAUSAL: {
    CRIT_CHANCE:        0.15,  // 暴击概率（仅流派 3 判定，不影响其他流派）
    CRIT_MULT:          1.5,   // 暴击伤害倍率
    BASE_ECHO_CHANCE:   0.15,  // Lv1 命中生成残响概率
    LV2_ECHO_CHANCE:    0.25,  // Lv2 残响留痕：命中生成残响概率
    LV2_HIT_MULT:       0.35,  // Lv2：命中残响复现倍率
    OTHER_ECHO_CHANCE:  0.20,  // 非命中事件生成残响概率
    ECHO_DURATION:      0.8,   // 残响复现后的残留展示时间（s）
    TARGET_SNAP_RADIUS: 120,   // 原目标允许被复现的最大偏离距离（px）
    TRANSFORM_CHANCE:   0.5,   // LV5 因果转化触发概率
    TRANSFORM_MULT_MIN: 0.30,  // 转化倍率下限
    TRANSFORM_MULT_MAX: 0.45,  // 转化倍率上限
    LV3_TOTAL_MULT:     0.6,   // LV3 双重回放总倍率上限
    FRAGMENT_SPEED:     320,   // 残响碎片速度
    FRAGMENT_LIFE:      0.45,  // 残响碎片寿命（s）→ 射程约 144px
    FRAGMENT_RADIUS:    4,
    FRAGMENT_SPREAD:    0.35,  // 多枚碎片的扇形散布角（rad）
    SMALL_EXPLOSION_RADIUS: 70,  // HIT 转化小范围爆炸
    SLOW_ZONE_RADIUS:      90,   // CRIT 转化减速区域
    SLOW_ZONE_DURATION:    2.0,
    LINE_LENGTH:           160,  // 短距离连线
    LINK_BASE_LENGTH:      200,  // 连线复现的原始长度基准
    COUNTER_WAVE_RADIUS:   140,  // 受击反制波
    MECH_TARGET_RANGE:     110,  // 机制复现的作用半径
    ZONE_TICK:             0.5,  // 区域伤害间隔（s，≥350ms 冷却）
    DISSOLVE_MULT:         0.2,  // LV7 崩解效果倍率
    GUARD_AMOUNT:          0.25, // LV7 受击反制减伤
    GUARD_DURATION:        2.0,
    BOSS_DAMAGE_MULT:      0.5,  // BOSS 受残响伤害按 50% 计
    HASTE_DELAY_REDUCTION: 0.2,  // LV6 连锁回声：每层节点延迟缩减
    HASTE_MAX_STACKS:      3,    // LV6 连锁等级上限
    HASTE_DURATION:        4.0,  // 连锁等级无新反应清空时间

    // ── 因果节点系统（Causal Node，流派 3 核心）─────────────────────────
    NODE_MAX_ACTIVE:       8,     // 同时存在节点上限
    NODE_LIFETIME:         3.0,   // 普通节点存活时间（s）
    DEATH_NODE_LIFETIME:   4.0,   // 死亡回响节点存活时间（s）
    NODE_MAX_TAGS:         3,     // 节点最多记录的不同事件标签数
    NODE_RECV_RADIUS:      72,    // 事件进入节点的接收半径（px）
    NODE_DELAY_MS:         450,   // 节点初始延迟（ms，可被连锁缩减）
    NODE_PULSE_RADIUS:     50,    // 小型脉冲半径（px）
    NODE_PULSE_MULT:       0.6,   // 小型脉冲伤害 = 玩家攻击 × 此倍率
    RUPTURE_RADIUS:        90,    // 白蚀爆裂半径（px）
    RUPTURE_DAMAGE_MULT:   1.8,   // 白蚀爆裂伤害 = 玩家攻击 × 此倍率
    RUPTURE_ARC_COUNT_MIN: 3,     // 裂口弧线数量下限
    RUPTURE_ARC_COUNT_MAX: 5,     // 裂口弧线数量上限
    RUPTURE_ARC_MULT:      0.3,   // 弧线弱化 RUPTURE 伤害倍率
    RUPTURE_CHILD_NODES:   2,     // 爆裂中心生成的弱化节点数
    ICE_BREAK_RADIUS_MIN:  60,    // 冰裂半径下限（px）
    ICE_BREAK_RADIUS_MAX:  90,    // 冰裂半径上限（px）
    ICE_BREAK_MULT_MIN:    0.4,   // 冰裂伤害倍率下限
    ICE_BREAK_MULT_MAX:    0.6,   // 冰裂伤害倍率上限
    LINK_NODE_MAX:         3,     // 因果连线最多连接节点数
    LINK_NODE_RANGE:       300,   // 因果连线最大长度（px）
    LINK_NODE_DAMAGE:      20,    // 敌人穿过因果连线的伤害
    CRACK_DURATION:        0.5,   // LV7 裂口残留持续时间（s）
    COMBO_PULSE_MULT:      1.5,   // 双标签组合反应的脉冲强度倍率
    // 公共机制卡：公共爆炸 / 公共闪电
    PUBLIC_BLAST_RADIUS:   90,
    PUBLIC_BLAST_DAMAGE:   30,
    PUBLIC_LIGHTNING_DAMAGE:  45,
    PUBLIC_LIGHTNING_INTERVAL: 4.0,
    PUBLIC_LIGHTNING_CHAIN_RANGE: 160,
    PUBLIC_LIGHTNING_MAX_TARGETS: 2,
  },

  // ── Genre 4: Shadow Ricochet（不息的暗影 · 弹射流）───────────────────
  RICOCHET: {
    // 暴击（流派 4 为暴击支持流派）
    CRIT_CHANCE:        0.15,   // 基础暴击率（暗影洞察在此之上叠加）
    CRIT_MULT:          1.5,    // 暴击倍率

    // 弹球基础参数
    BALL_START_COUNT:   2,      // 开局立即生成（凝聚后发射）
    BALL_CAP:           3,      // 基础弹球上限
    BALL_CAP_LV2:       4,      // LV2 弹影增殖：上限 +1
    BALL_CAP_LV4:       5,      // LV4 双生弹场：上限 4 → 5（与散弹相加，最高 7）
    BALL_CAP_SHOTGUN:   2,      // 暗影散弹适配：上限 +2（不复制现有弹球）
    BALL_RADIUS:        16,     // 弹球半径（px）
    BALL_RADIUS_LV2:    18,     // LV2：半径 16 → 18
    BALL_SPEED:         520,    // 常态基础速度（px/s）
    BALL_SPEED_MAX:     900,    // 常态速度上限
    BALL_SPEED_BOOSTED_MAX: 1100, // 磁极加速后的最终速度上限
    BALL_ASPD_REF:      2.0,    // 攻速基准（有效攻速 = fireRate × aspdMult）
    SPAWN_CHARGE_TIME:  0.25,   // 凝聚时间（s），凝聚期不造成伤害、占用名额
    BOUNCE_BUDGET:      4,      // 单帧单球最大反弹次数（超出保留安全位置）
    TRAIL_LENGTH:       8,      // 拖尾固定长度缓冲

    // 同目标伤害保护（防止卡在碰撞体内部反复伤害）
    HIT_CD_MS:          250,    // 基础间隔（ms），按有效攻速比例缩短
    HIT_CD_MIN_MS:      120,    // 最低间隔（ms）
    BOSS_POOL_CD_MS:    250,    // 同球对 BOSS 共享血池的保护窗口（ms）
    DAMAGE_INSTANCE_ID: true,   // 伤害实例独立标识（ballId / impactId / damageInstanceId）

    // 磁极加速（普通球碰磁极残核后速度 +20%，持续 1.5 秒）
    BOOST_MULT:         1.2,
    BOOST_DURATION:     1.5,

    // 回弹边界（以玩家为中心的圆形活动边界，世界坐标）
    BOUNDARY_RADIUS:    360,

    // 暗影贯穿适配（每次反弹后的飞行段）
    PIERCE_FIRST_PASSES: true,  // 第一个敌人正常受伤、暂不反弹
    PIERCE_SECOND_MULT:  0.65,  // 第二个敌人受 65% 伤害后正常反弹

    // 暗影连线适配（玩家 ↔ 最多 3 个有效弹球）
    LINK_MAX:           3,
    LINK_DAMAGE:        20,
    LINK_CD_MS:         1000,   // 同一弹球—同一敌人伤害间隔（ms）
    LINK_RANGE:         1500,
  },

  // ── 蓄能回弹（弹射流 Lv.1 基础机制：状态变化，不新增弹球）─────────────
  CHARGED_BALL: {
    firstTriggerDelay:  1.5,    // 开局到第一次召回（s）
    chargeInterval:     4.5,    // 蓄能周期（s）
    chargeIntervalLv2:  3.8,    // Lv.2 快速蓄能
    recallDuration:     0.55,   // 召回时间（s）
    recallDurationLv2:  0.48,   // Lv.2 快速蓄能
    orbitDuration:      1.0,    // 环绕蓄能时间（s）
    aimWindowDuration:  0.45,   // 发射前方向箭头出现窗口（s）
    directionLockDuration: 0.25, // 发射前方向锁定窗口（s）
    orbitRadius:        46,     // 环绕半径（px）
    initialOrbitSpeed:  2.5,    // 环绕起始角速度（rad/s）
    finalOrbitSpeed:    8.5,    // 环绕结束角速度（rad/s）
    firstHitDamageMultiplier: 1.2, // 蓄能发射后第一次有效命中 ×1.2
    launchSpeedMultiplier:    1.1, // 发射速度倍率
    launchSpeedMultiplierLv3: 1.15, // Lv.3 磁轨校准
    autoAimErrorBase:   0.52,   // 自动瞄准基础偏差（±30°）
    autoAimErrorLv3:    0.314,  // Lv.3 校准后最大偏转 18°
    // Lv.3 首次碰撞方向脉冲（局部视觉 + 弹射流派生伤害）
    firstImpactArcRadius: 36,
    firstImpactArcDamageMultiplier: 0.2,
    firstImpactArcCooldown: 1.0,
    mechCdMinFactor:    0.75,   // 暗影律动最多把蓄能周期缩短到 75%
  },

  // ── 过载电弧（弹射流 Lv.4）────────────────────────────────────────
  OVERLOAD: {
    overloadDuration:   2.0,   // 过载持续（s）
    overloadHitLimit:   3,     // 过载最多产生电弧的碰撞次数
    arcDamageMultiplier: 0.25, // 电弧伤害 = 本次直接碰撞伤害 × 25%
    arcRadius:          55,    // 电弧连接半径（px，受技能范围加成）
    arcParalyzeDuration: 0.09, // 电弧麻痹 80~100ms
    arcTargetCooldown:  0.5,   // 同球同目标电弧限频（s）
  },

  // ── 磁场回流（Lv.5）：蓄能/过载弹球碰撞点生成短暂磁场 ─────────────────
  MAGNETIC_FIELD: {
    radius:             58,    // 磁场半径（px，受技能范围加成）
    duration:           0.7,   // 磁场持续（s）
    expandDuration:     0.16,  // 扩散时间（s）
    tickInterval:       0.35,  // 持续伤害间隔（s）
    enemyTickDamageMultiplier: 0.12, // tick 伤害 = 有效弹球直接伤害 × 12%
    ballConductiveDuration: 2.0,     // 导电持续（s）
    ballConductiveHitLimit: 2,       // 导电有效碰撞次数上限
    conductiveDamageMultiplier: 0.25, // 导电直接碰撞伤害 +25%（×1.25）
    conductiveParalyzeDuration: 0.1,  // 导电碰撞麻痹（s）
    conductiveArcDamageMultiplier: 0.2, // 导电电弧伤害 = 直接碰撞 × 20%
    conductiveArcRadius: 55,           // 导电电弧半径（px，受技能范围加成）
    maxActiveFields:    4,
  },

  // ── 雷核觉醒（弹射流 Lv.6：蓄能球预热形态）──────────────────────────
  THUNDER_CORE: {
    speedMultiplier:    1.8,
    maxSpeed:           1100,
    maxImpacts:         14,    // 有效敌人碰撞预算
    hardLifetime:       2.6,   // 硬生命周期（s）
    sameTargetCooldown: 0.28,  // 同球同敌最小碰撞间隔（s）
    paralyzeDuration:   0.12,
    endArcDamageMultiplier: 0.3, // 结束时小型局部电弧伤害倍率
  },

  // ── 雷霆闪电球（弹射流 Lv.7 最终形态）──────────────────────────────
  THUNDER_BALL: {
    speedMultiplier:    2.1,
    maxSpeed:           1250,
    maxImpacts:         24,    // 有效敌人碰撞预算（可调 18~30）
    minImpacts:         18,
    maxImpactsLimit:    30,
    hardLifetime:       2.8,   // 硬生命周期（s），超时也爆炸
    sameTargetCooldown: 0.28,
    directDamageMultiplier: 1.2, // 直接碰撞伤害 ×1.2
    paralyzeDuration:   0.16,
    explosionRadius:    92,    // 爆炸半径（px，受技能范围加成）
    explosionDamageMultiplier: 1.5, // 爆炸伤害 = 直接伤害 ×1.5
    fieldRadius:        125,   // 电磁场半径（px，受技能范围加成）
    fieldExpandDuration: 0.22,
    fieldDuration:      2.4,
    fieldTickInterval:  0.35,
    fieldTickDamageMultiplier: 0.18, // tick 伤害 = 直接伤害 ×0.18
    conductiveDuration: 2.0,
    conductiveHitLimit: 2,
    conductiveDamageMultiplier: 0.25,
    conductiveParalyzeDuration: 0.1,
    maxActiveFields:    4,
    preExplosionShrink: 0.15,  // 爆炸前收缩提示（s）
  },

  // ── 磁极残核（死亡暗影在弹射流的形态）───────────────────────────────
  MAGNETIC_NODE: {
    lifetime:           4.0,
    radius:             32,    // 接触半径（px，受技能范围加成）
    maxActiveNodes:     8,
    maxActivationsPerNode: 2,
    ballSpeedMultiplier: 1.2,  // 普通球激活后速度 +20%
    speedDuration:      1.5,
    conductiveDuration: 2.0,
    conductiveHitLimit: 2,
    normalBallArcDamageMultiplier: 0.2,
    activateCdMs:       600,   // 同球同节点重复激活保护（ms）
  },

  // ── 暗影轨道场（Shadow Orbit Field · 弹射流活动区域视觉）──────────────
  // 纯视觉层：不改弹球物理、不吸附敌人、不造成伤害、不计边界蓄能。
  // 视觉半径统一取 RICOCHET.BOUNDARY_RADIUS（保证 visualRadius === collisionRadius）。
  ORBIT_FIELD: {
    radius:              360,  // 仅作说明；运行时渲染半径恒等于 RICOCHET.BOUNDARY_RADIUS

    outerRingCount:      3,    // 外层断环辅助圈数（最外层暗环）
    boundarySegmentCount: 5,   // 主边界断裂弧段数（3~5 段）
    secondaryOrbitCount: 3,    // 次级椭圆轨道条数（纯视觉参考线）

    baseAlpha:           0.16, // 常态透明度
    activeAlpha:         0.34, // 活跃态（雷霆球 / 弹球多）透明度
    impactAlpha:         0.7,  // 撞击瞬间弧段高亮上限

    baseRotationSpeed:   0.08, // 主断裂弧自转（rad/s）
    secondaryRotationSpeed: -0.12, // 次级轨道反向自转（rad/s）
    fieldLineSpeed:      0.18, // 引力场线流动速度

    particleCount:       18,   // 轨道星尘数量（固定池）
    maxImpactRings:      6,    // 同时存在的撞击反馈上限

    impactDuration:      260,  // 撞击反馈时长（ms）
    impactRippleSpeed:   180,  // 涟漪沿边界传播速度（px/s）

    playerFollowSpeed:   9999, // 中心跟随玩家（瞬时，与真实碰撞中心一致）
    safeCorrectionDuration: 180, // 安全校正柔和回收效果时长（ms）

    tutorialDuration:    800,  // 首次登场整环亮起时长（ms）
    tutorialTextDuration: 3800, // 教学提示文字显示时长（ms）

    maxRenderAlpha:      0.45, // 场内静态元素透明度上限（不含撞击瞬间）
    maxAdditiveParticles: 80,  // 加亮粒子总量上限（撞击粒子共享预算）
  },

  // ── Shadow Link (BUFF 2) ──────────────────────────────────────────
  LINK_DAMAGE:     20,     // damage per pass-through
  LINK_COOLDOWN:   3.0,    // s per enemy per link

  // ── Death Shadow (BUFF 1) ─────────────────────────────────────────
  DEATH_SHADOW_DURATION: 4.0,

  // ── Shadow Undying (genre 2) ─────────────────────────────────────
  UNDYING: {
    // 蚀影护壳（生命值单位，独立于生命值存储）
    SHELL_HP_PCT:        0.30,   // 初始护壳容量 = 最大生命 30%
    SHELL_HP_PCT_LV3:    0.45,   // LV3 蚀影增殖：容量提升至 45%
    HEAL_TO_SHELL:       0.50,   // actualHeal 转护壳比例
    HEAL_TO_SHELL_LV3:   0.75,   // LV3：actualHeal 转护壳比例
    OVERHEAL_TO_SHELL:   1.00,   // overheal 转护壳比例（始终 100%）
    FEAST_SHELL_BONUS:   0.25,   // LV7 盛宴：护壳最终收益 +25%

    // 基础汲取（有效攻击批次限频）
    LEECH_HP_PCT:        0.005,  // 每次恢复最大生命 0.5%
    LEECH_PER_SEC:       4,      // 每秒最多触发次数

    // 死亡余烬
    EMBER_LIFE:          5.0,    // 存在时间（s）
    EMBER_PICKUP_RANGE:  100,    // 自动收集半径（px）
    EMBER_HEAL_PCT:      0.01,   // 恢复最大生命 1%

    // 余烬遗蜕（死亡阴影在流派 2 的形态）
    HUSK_LIFE:           4.0,    // 持续时间（s）
    HUSK_HEAL_PCT:       0.02,   // 收集恢复最大生命 2%

    // LV2 饥渴余烬
    LV2_PICKUP_BONUS:    0.40,   // 自动收集范围 +40%
    LV2_HEAL_BONUS:      0.25,   // 余烬/遗蜕恢复量 +25%

    // 蚀白冲击（主冲击）
    PULSE_COOLDOWN:      1.2,    // 冷却（s）
    PULSE_THRESHOLD:     0.30,   // 触发阈值：护壳达到容量 30%
    PULSE_CONSUME_PCT:   0.20,   // 消耗当前护壳的 20%
    PULSE_RADIUS:        240,    // 半径（px，受技能范围加成）
    PULSE_DMG_MULT:      1.6,    // 伤害 = 玩家攻击 × 1.6
    PULSE_SHELL_MULT:    2.0,    //        + 实际消耗护壳 × 2

    // LV4 裂壳回潮
    REBOUND_DELAY:       0.35,   // 主冲击命中后延迟（s）
    REBOUND_DMG_MULT:    0.35,   // 回潮伤害 = 主冲击伤害 × 35%

    // LV5 临界喂养（蓄势）
    CHARGE_TIME:         0.18,   // 蓄势时长（s）
    CHARGE_EXTRA_PCT:    0.20,   // 蓄势期额外消耗上限 = 最大护壳 20%
    CHARGE_EXTRA_SHARE:  0.50,   // 蓄势期新增护壳计入额外消耗的比例
    CHARGE_RADIUS_BONUS: 0.25,   // 额外消耗最多提高半径 25%

    // LV6 死潮回流
    KILL_CDR:            0.12,   // 每真实击杀减少剩余冷却（s）
    KILL_CDR_MAX:        0.60,   // 每次主冲击最多减少（s）

    // LV7 不灭盛宴
    FEAST_NEED:          3,      // 一次冲击及余波收集资源份数阈值
    FEAST_DURATION:      4.0,    // 盛宴持续（s）
    FEAST_PETAL_COUNT:   4,      // 尖瓣裂光数量
    FEAST_PETAL_MULT:    0.25,   // 裂光伤害 = 主冲击 × 25%

    // 公共机制适配
    SHATTER_HEAL_PCT:    0.01,   // 冻壳剥离：恢复最大生命 1%
    SHATTER_DMG_MULT:    0.30,   // 冻壳剥离：冰裂伤害 = 主冲击 × 30%
    SHELLCRACK_RADIUS:   60,     // 壳裂半径（px，受技能范围加成）
    SHELLCRACK_MULT:     0.25,   // 壳裂伤害 = 主冲击实际伤害 × 25%
    CORD_MAX:            3,      // 汲取脐带最多端点数
    CORD_DMG_MULT:       0.35,   // 脐带脉冲伤害 = 主冲击 × 35%

    // 容量管理
    MAX_EMBERS:          64,     // 地面资源总量上限（余烬 + 遗蜕）
    MERGE_DIST:          36,     // 相近同类资源合并距离（px）
    MERGE_CAP:           5,      // 单个合并体存量上限
    EVENT_BUDGET:        48,     // 单帧事件预算（超额排到后续更新）
  },

  // ── BUFF values ──────────────────────────────────────────────────
  BUFF_HP_BONUS:    0.05,
  BUFF_DMG_BONUS:   0.05,
  BUFF_ASPD_BONUS:  0.10,
  BUFF_DEF_BONUS:        0.036, // 防御力 -10%（4% × 0.9 = 3.6%）
  BUFF_LIFESTEAL_BONUS:  0.05,
};

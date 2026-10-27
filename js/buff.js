// ─── BUFF DEFINITIONS ────────────────────────────────────────────────────────
const BUFF_TIERED_RANGES = [
  [5, 10],
  [10, 20],
  [20, 30],
];

// 低数值区间（防御/吸血，避免叠成无敌）
const BUFF_LOW_RANGE = [3, 8];

// 移速区间（每级 5-10%，多次叠加不爆）
const BUFF_SPEED_RANGE = [5, 10];

function rollTieredPct(count) {
  const idx = Math.min(Math.max(count - 1, 0), BUFF_TIERED_RANGES.length - 1);
  const [min, max] = BUFF_TIERED_RANGES[idx];
  return Math.round(min + Math.random() * (max - min));
}

function rollLowPct() {
  const [min, max] = BUFF_LOW_RANGE;
  return Math.round(min + Math.random() * (max - min));
}

function rollSpeedPct() {
  const [min, max] = BUFF_SPEED_RANGE;
  return Math.round(min + Math.random() * (max - min));
}

const BUFFS = [
  {
    id:    'death_shadow',
    icon:  '💀',
    title: '死亡暗影',
    desc:  '敌人死亡后在原地生成持续4秒的静止暗影，视为暗影实体。',
    type:  'buff',
    oneTime: true,
    mechColor: '#ff2030',  // 血红
    descFn(state) {
      if (state.genre === 4) {
        return '敌人死亡后在原地生成磁极残核（4秒，最多8个）：弹球撞上反弹，普通球获得导电与加速，每个残核最多激活2次。';
      }
      if (state.genre === 3) {
        return '敌人死亡后在原地生成死亡回响节点（4秒）：吸收后续事件，第三标签触发白蚀爆裂，真实击杀延续因果链。';
      }
      if (state.genre === 2) {
        return '敌人死亡后在原地留下余烬遗蜕（4秒）：替代普通死亡余烬，靠近恢复2%最大生命；蚀白冲击扫过引爆遗蜕触发壳裂并回流余烬。';
      }
      return state.genre === 1
        ? '敌人死亡后在原地生成持续4秒的小型漩涡。'
        : '敌人死亡后在原地生成持续4秒的静止暗影，视为暗影实体。';
    },
    apply(state) { DeathShadowManager.enabled = true; }
  },
  {
    id:    'shadow_link',
    icon:  '🔗',
    title: '暗影连线',
    desc:  '玩家与每个暗影实体间生成连线，敌人经过时受到伤害。',
    type:  'buff',
    oneTime: true,
    // 默认金色（无 mechColor）
    descFn(state) {
      if (state.genre === 4) {
        return '玩家与最近的3个有效弹球间生成暗影连线：敌人穿过受20伤害（同球同敌1秒限频），连线伤害不触发弹球碰撞、不消耗雷霆碰撞预算；蓄能球环绕时连线暂隐。';
      }
      if (state.genre === 3) {
        return '因果节点之间生成因果连线（最多3个）：事件沿连线传播，三个节点闭合时触发白蚀爆裂。';
      }
      if (state.genre === 2) {
        return '玩家与最近的余烬遗蜕（或普通余烬）间生成汲取脐带（最多3条）：敌人穿过受20伤害并积累汲取收益；主冲击沿线释放白色脉冲。';
      }
      return '玩家与每个暗影实体间生成连线，敌人经过时受到伤害。';
    },
    apply(state) { ShadowLink.enabled = true; }
  },
  {
    id:    'buff_hp',
    icon:  '❤️',
    title: '暗影躯体',
    desc:  '玩家最大血量提高5%。',
    type:  'buff',
    descFn(state) {
      const next = (state.tieredBuffCounts.hp || 0) + 1;
      const pct = rollTieredPct(next);
      return state.genre === 2
        ? `玩家最大血量提高${pct}%（不灭流：护壳容量与按最大生命计算的恢复收益同步提高）。`
        : `玩家最大血量提高${pct}%。`;
    },
    apply(state) {
      const next = (state.tieredBuffCounts.hp || 0) + 1;
      state.tieredBuffCounts.hp = next;
      state.player.applyHpBuff(rollTieredPct(next) / 100);
    }
  },
  {
    id:    'buff_dmg',
    icon:  '⚡',
    title: '暗影力量',
    desc:  '玩家伤害提高5%。',
    type:  'buff',
    descFn(state) {
      const next = (state.tieredBuffCounts.dmg || 0) + 1;
      return `玩家伤害提高${rollTieredPct(next)}%。`;
    },
    apply(state) {
      const next = (state.tieredBuffCounts.dmg || 0) + 1;
      state.tieredBuffCounts.dmg = next;
      state.player.applyDmgBuff(rollTieredPct(next) / 100);
    }
  },
  {
    id:    'buff_aspd',
    icon:  '💨',
    title: '暗影疾行',
    desc:  '玩家攻击速度提高10%。',
    type:  'buff',
    descFn(state) {
      const next = (state.tieredBuffCounts.aspd || 0) + 1;
      return `玩家攻击速度提高${rollTieredPct(next)}%。`;
    },
    apply(state) {
      const next = (state.tieredBuffCounts.aspd || 0) + 1;
      state.tieredBuffCounts.aspd = next;
      state.player.applyAspdBuff(rollTieredPct(next) / 100);
    }
  },
  {
    id:    'buff_def',
    icon:  '🛡️',
    title: '暗影护盾',
    desc:  '受到伤害减少5%。',
    type:  'buff',
    unlockLevel: 4,
    descFn(state) {
      return `受到伤害减少${rollLowPct()}%。`;
    },
    apply(state) {
      state.player.applyDefBuff(rollLowPct() / 100);
    }
  },
  {
    id:    'buff_lifesteal',
    icon:  '🩸',
    title: '暗影汲取',
    desc:  '击杀敌人时回复5%最大生命。',
    type:  'buff',
    unlockLevel: 4,
    descFn(state) {
      const pct = rollLowPct();
      return state.genre === 2
        ? `击杀敌人时回复${pct}%最大生命（不灭流：恢复经统一入口结算并可转为护壳）。`
        : `击杀敌人时回复${pct}%最大生命。`;
    },
    apply(state) {
      state.player.applyLifestealBuff(rollLowPct() / 100);
    }
  },
  {
    id:    'buff_shotgun',
    icon:  '✦',
    title: '暗影散弹',
    desc:  '攻击模式变为散弹',
    type:  'buff',
    oneTime: true,
    mechColor: '#ffffff',  // 白色
    descFn(state) {
      return state.genre === 4
        ? '弹球上限+2（不复制现有弹球，上限最高7）。'
        : '同时朝三个方向发射子弹';
    },
    apply(state) { state.player.shotgun = true; }
  },
  {
    id:    'buff_servitude',
    icon:  '⛓️',
    title: '暗影奴役',
    desc:  '怪物 1/2/3 移动速度加快，血量降低25%。',
    type:  'buff',
    oneTime: true,
    mechColor: '#9aa0a8',  // 灰色
    descFn() {
      return '普通怪（含裂角突袭者、重甲守卫、灰烬投手）移动速度加快，血量降低25%。';
    },
    apply(state) { state.servitudeActive = true; }
  },
  {
    id:    'buff_shadow_energy',
    icon:  '💎',
    title: '暗影能源',
    desc:  '每隔5秒回复15%最大血量。',
    type:  'buff',
    oneTime: true,
    mechColor: '#ff7ec8',  // 粉色
    descFn(state) {
      return state.genre === 2
        ? '每5秒恢复15%最大生命；不灭流可将实际恢复的部分与全部溢出恢复转为护壳，满血时依然生效。'
        : '每隔5秒回复15%最大血量。';
    },
    apply(state) { state.player.shadowEnergy = true; }
  },
  {
    id:    'buff_overlord',
    icon:  '👑',
    title: '暗影君王',
    desc:  '每杀死一个怪物，基础攻击+1。',
    type:  'buff',
    oneTime: true,
    // 默认金色
    apply(state) { state.player.overlord = true; }
  },
  {
    id:    'buff_speed',
    icon:  '👟',
    title: '暗影疾步',
    desc:  '玩家移动速度提升。',
    type:  'buff',
    descFn(state) {
      const next = (state.tieredBuffCounts.speed || 0) + 1;
      return `玩家移速提升${rollSpeedPct()}%。`;
    },
    apply(state) {
      const next = (state.tieredBuffCounts.speed || 0) + 1;
      state.tieredBuffCounts.speed = next;
      state.player.applySpeedBuff(rollSpeedPct() / 100);
    }
  },
  {
    id:    'buff_crit',
    icon:  '🎯',
    title: '暗影洞察',
    desc:  '因果残响/不灭的暗影流派：暴击率提高；其他流派：伤害提高。',
    type:  'buff',
    unlockLevel: 4,
    descFn(state) {
      if (state.genre === 4) {
        return `暴击率提高${rollLowPct()}%（弹球直接碰撞判定一次，派生伤害不重复暴击）。`;
      }
      return (state.genre === 3 || state.genre === 2)
        ? `暴击率提高${rollLowPct()}%（强化原攻击，暴击不重复掉落余烬）。`
        : `伤害提高${Math.round(rollLowPct() * 0.6)}%。`;
    },
    apply(state) {
      const pct = rollLowPct();
      if (state.genre === 3 || state.genre === 2 || state.genre === 4) state.player.applyCritBuff(pct / 100);
      else state.player.applyDmgBuff(pct * 0.6 / 100);
    }
  },
  {
    id:    'buff_freeze',
    icon:  '❄️',
    title: '暗影冰封',
    desc:  '怪物受三次攻击后，在十秒内移速降低90%。',
    type:  'buff',
    oneTime: true,
    mechColor: '#3c8cff',  // 蓝色
    descFn(state) {
      if (state.genre === 4) {
        return '怪物受三次攻击后冰封（10秒移速-90%）：弹球与雷霆球直接碰撞计入攻击次数；电磁场tick、导电电弧与爆炸不额外计命中。';
      }
      if (state.genre === 3) {
        return '怪物受三次攻击后冰封（10秒移速-90%），并在目标位置生成冰封因果节点：后续事件触发冰裂。';
      }
      if (state.genre === 2) {
        return '怪物受三次攻击后冰封（10秒移速-90%）：蚀白冲击命中冰封敌人时触发冻壳剥离，碎壳飞回恢复1%最大生命并追加30%冰裂伤害。';
      }
      return '怪物受三次攻击后，在十秒内移速降低90%。';
    },
    apply(state) { state.freezeEnabled = true; }
  },
  {
    id:    'buff_pierce',
    icon:  '➹',
    title: '暗影贯穿',
    desc:  '子弹可额外穿透1个敌人，穿透后伤害降低35%。',
    type:  'buff',
    oneTime: true,
    mechColor: '#c0c8ff',  // 淡蓝紫
    descFn(state) {
      if (state.genre === 4) {
        return '弹球每次反弹后的飞行段可贯穿第1个敌人（正常伤害不反弹），第2个敌人受65%伤害后正常反弹并重置段状态。';
      }
      return state.genre === 3
        ? '子弹额外穿透1个敌人（伤害-35%）：一发攻击可经过多个因果节点输入事件。'
        : '子弹可额外穿透1个敌人，穿透后伤害降低35%。';
    },
    apply(state) { state.player.applyPierceBuff(1); }
  },
  {
    id:    'buff_range',
    icon:  '◎',
    title: '暗影领域',
    desc:  '技能范围提高12%。',
    type:  'buff',
    oneTime: true,
    mechColor: '#b06cff',  // 紫
    descFn(state) {
      if (state.genre === 4) {
        return '技能范围提高12%：雷霆爆炸、电磁场、磁极残核接触范围与导电电弧半径增大（不放大回弹边界与弹球）。';
      }
      return state.genre === 3
        ? '技能范围提高12%：白蚀爆裂、冰裂、公共爆炸的半径增大。'
        : '技能范围提高12%（范围类效果半径增大）。';
    },
    apply(state) { state.player.applyRangeBuff(0.12); }
  },
  {
    id:    'buff_mech_cd',
    icon:  '⏲',
    title: '暗影律动',
    desc:  '公共机制冷却缩减12%。',
    type:  'buff',
    oneTime: true,
    mechColor: '#58e0c8',  // 青绿
    descFn(state) {
      if (state.genre === 4) {
        return '公共机制冷却缩减12%：引雷更频繁，蓄能周期同步缩短（最多至基础值75%）；雷霆球硬生命周期与碰撞保护不受影响。';
      }
      return state.genre === 3
        ? '公共机制冷却缩减12%：引雷更频繁，因果节点触发延迟更短。'
        : '公共机制冷却缩减12%。';
    },
    apply(state) { state.player.applyMechCdBuff(0.12); }
  },
  {
    id:    'pub_blast',
    icon:  '💥',
    title: '公共爆炸',
    desc:  '敌人死亡时产生小范围爆炸，对周围敌人造成伤害。',
    type:  'buff',
    oneTime: true,
    hidden: true,   // 暂时隐藏：不进入卡池，代码保留
    mechColor: '#ff7a2a',  // 橙色
    descFn(state) {
      const base = '敌人死亡时产生爆炸，对周围敌人造成伤害（范围约90px）。';
      return state.genre === 3
        ? base + ' 流派「因果残响」：爆炸中心生成爆裂节点，范围敌人提供事件输入。'
        : base;
    },
    apply(state) { PublicBlastManager.enabled = true; }
  },
  {
    id:    'pub_lightning',
    icon:  '⚡',
    title: '引雷',
    desc:  '每 4 秒从天空召下一道范围雷击。',
    type:  'buff',
    oneTime: true,
    mechColor: '#7df9ff',  // 青色
    descFn(state) {
      const base = '每 4 秒从天空召下一道范围雷击：落点形成雷区，持续伤害并麻痹区域内敌人。';
      return state.genre === 3
        ? base + ' 流派「因果残响」：落雷生成闪电节点，雷区有限度推进附近节点。'
        : base;
    },
    apply(state) { PublicLightningManager.enabled = true; }
  },
];

// ─── GENRE LEVEL CARDS ───────────────────────────────────────────────────────
const GENRE_CARDS = {
  // Genre 0: Shadow Echo
  0: [
    null, // lv1 = starting level, no card
    {
      id: 'echo_lv2', icon: '⏱️', title: '回响加速 Lv.2',
      desc: '暗影生成间隔缩短至10秒。', type: 'genre',
      apply(state) { state.genreLv = 2; }
    },
    {
      id: 'echo_lv3', icon: '⚡', title: '回响共鸣 Lv.3',
      desc: '暗影生成间隔缩短至5秒。', type: 'genre',
      apply(state) { state.genreLv = 3; }
    },
    {
      id: 'echo_lv4', icon: '🔥', title: '暗影锋芒 Lv.4',
      desc: '暗影伤害提升40%。', type: 'genre',
      apply(state) { state.genreLv = 4; }
    },
    {
      id: 'echo_lv5', icon: '✨', title: '共鸣风暴 Lv.5',
      desc: '每个存活暗影使主角攻速+15%，暗影攻速+10%。', type: 'genre',
      apply(state) { state.genreLv = 5; }
    },
    {
      id: 'echo_lv6', icon: '💥', title: '暗影爆破 Lv.6',
      desc: '暗影消失和敌人死后会产生暗影爆炸。', type: 'genre',
      apply(state) { state.genreLv = 6; }
    },
  ],

  // Genre 1: Shadow Vortex
  1: [
    null, // lv1
    {
      id: 'vortex_lv2', icon: '🌀', title: '漩涡扩张 Lv.2',
      desc: '漩涡半径增大10%。', type: 'genre',
      apply(state) { state.genreLv = 2; }
    },
    {
      id: 'vortex_lv3', icon: '💥', title: '漩涡灼烧 Lv.3',
      desc: '漩涡持续伤害提升20%。', type: 'genre',
      apply(state) { state.genreLv = 3; }
    },
    {
      id: 'vortex_lv4', icon: '🎯', title: '双重投影 Lv.4',
      desc: '每次发射两个暗影投射物。', type: 'genre',
      apply(state) { state.genreLv = 4; }
    },
    {
      id: 'vortex_lv5', icon: '⚡', title: '静电漩涡 Lv.5',
      desc: '漩涡从自己中心持续产生闪电。', type: 'genre',
      apply(state) { state.genreLv = 5; }
    },
    {
      id: 'vortex_lv6', icon: '🌀', title: '暗影裂隙 Lv.6',
      desc: '两个漩涡相交时生成暗影裂隙，分 3 次朝敌群密集方向发射激光。', type: 'genre',
      apply(state) { state.genreLv = 6; }
    },
    {
      id: 'vortex_lv7', icon: '🌑', title: '裂隙融合 Lv.7',
      desc: '两个相交的漩涡在裂隙三次激光都结束后融合成 1.5 倍大的漩涡。', type: 'genre',
      apply(state) { state.genreLv = 7; }
    },
  ],

  // Genre 2: Shadow Undying（不灭的暗影 · 蚀影护壳版本）
  2: [
    null, // lv1 = starting level, no card（初始即拥有护壳/汲取/余烬/主冲击）
    {
      id: 'undying_lv2', icon: '🩸', title: '饥渴余烬 Lv.2',
      desc: '余烬与遗蜕的自动收集范围+40%，余烬和遗蜕提供的恢复量+25%。',
      type: 'genre',
      apply(state) { state.genreLv = 2; }
    },
    {
      id: 'undying_lv3', icon: '🛡️', title: '蚀影增殖 Lv.3',
      desc: '护壳容量从最大生命的30%提升到45%；实际恢复转护壳比例从50%提升到75%。',
      type: 'genre',
      apply(state) { state.genreLv = 3; }
    },
    {
      id: 'undying_lv4', icon: '🌊', title: '裂壳回潮 Lv.4',
      desc: '主冲击命中敌人后0.35秒产生收缩回潮（35%伤害），向玩家方向收集范围内余烬。',
      type: 'genre',
      apply(state) { state.genreLv = 4; }
    },
    {
      id: 'undying_lv5', icon: '⏱️', title: '临界喂养 Lv.5',
      desc: '主冲击进入短暂蓄势：蓄势期新增护壳的一部分计入额外消耗（最多最大护壳20%），提高冲击伤害与半径（最多+25%）。',
      type: 'genre',
      apply(state) { state.genreLv = 5; }
    },
    {
      id: 'undying_lv6', icon: '☠️', title: '死潮回流 Lv.6',
      desc: '主冲击每真实击杀一个敌人，减少剩余冷却0.12秒（每次主冲击最多0.6秒）。',
      type: 'genre',
      apply(state) { state.genreLv = 6; }
    },
    {
      id: 'undying_lv7', icon: '✦', title: '不灭盛宴 Lv.7',
      desc: '一次主冲击及余波收集至少3份余烬资源后进入盛宴4秒：恢复转护壳+25%，主冲击额外释放4道尖瓣裂光（25%伤害）。',
      type: 'genre',
      apply(state) { state.genreLv = 7; }
    },
  ],

  // Genre 3: Causal Echo（因果残响 · 因果节点版本）
  3: [
    null, // lv1 = starting level, no card
    {
      id: 'causal_lv2', icon: '⏳', title: '残响留痕 Lv.2',
      desc: '命中后有25%概率在命中位置生成因果节点：450ms后弱化复现该次攻击，并等待后续事件进入（记录事件标签，累积反应）。',
      type: 'genre',
      apply(state) { state.genreLv = 2; }
    },
    {
      id: 'causal_lv3', icon: '🎭', title: '双重回放 Lv.3',
      desc: '一个节点可同时记录两个不同事件标签，双标签组合（HIT+CRIT、HIT+FREEZE、HIT+LINK 等）触发强化脉冲。',
      type: 'genre',
      apply(state) { state.genreLv = 3; }
    },
    {
      id: 'causal_lv4', icon: '🔮', title: '机制复现 Lv.4',
      desc: '公共机制在流派3中生成对应类型的因果节点：冰封→冰封节点（冰裂）、爆炸→爆裂节点、闪电→闪电节点、连线→因果连线、死亡阴影→死亡回响节点。',
      type: 'genre',
      apply(state) { state.genreLv = 4; }
    },
    {
      id: 'causal_lv5', icon: '🔄', title: '因果转化 Lv.5',
      desc: '根据两个事件标签的组合决定转化结果：HIT+FREEZE→冰裂、LINK+LINK→长链、EXPLOSION+HIT→碎片爆发、DEATH_SHADOW+HIT→死亡节点提前临界。',
      type: 'genre',
      apply(state) { state.genreLv = 5; }
    },
    {
      id: 'causal_lv6', icon: '🔗', title: '连锁回声 Lv.6',
      desc: '白蚀爆裂影响至少3个敌人后，下一条因果链触发速度提高（连锁等级最多3层，4秒无新反应后清空）。',
      type: 'genre',
      apply(state) { state.genreLv = 6; }
    },
    {
      id: 'causal_lv7', icon: '💫', title: '残响崩解 Lv.7',
      desc: '节点完成反应后留下裂口残留（约500ms），向附近目标传播一次弱化 RUPTURE；死亡回响节点可继承死者最近的公共机制标签。',
      type: 'genre',
      apply(state) { state.genreLv = 7; }
    },
  ],

  // Genre 4: Shadow Ricochet（不息的暗影 · 弹射流：蓄能回弹 / 雷霆化路线）
  4: [
    null, // lv1 = starting level, no card（开局即有弹球 + 蓄能回弹基础机制）
    {
      id: 'ricochet_lv2', icon: '🔮', title: '快速蓄能 Lv.2',
      desc: '蓄能间隔4.5秒→3.8秒，召回时间550ms→480ms；弹球上限3→4、半径16→18的等级成长保持，不新增球数。',
      type: 'genre',
      apply(state) { state.genreLv = 2; }
    },
    {
      id: 'ricochet_lv3', icon: '⚡', title: '磁轨校准 Lv.3',
      desc: '蓄能球发射速度+15%（1.1→1.15倍），自动瞄准最大偏转角≤18°；首次有效碰撞产生一次小型方向脉冲（36px、20%伤害）。',
      type: 'genre',
      apply(state) { state.genreLv = 3; }
    },
    {
      id: 'ricochet_lv4', icon: '🎯', title: '过载电弧 Lv.4',
      desc: '弹球上限4→5的等级成长保持；蓄能球首次有效命中后进入过载2秒：之后每次有效碰撞放出短电弧（25%伤害、80~100ms麻痹），最多3次，不递归。',
      type: 'genre',
      apply(state) { state.genreLv = 4; }
    },
    {
      id: 'ricochet_lv5', icon: '❄️', title: '磁场回流 Lv.5',
      desc: '蓄能球有效碰撞位置生成短暂磁场（58px、0.7秒、每0.35秒12%伤害）；普通弹球进入获得导电2秒（2次碰撞，伤害+25%、麻痹100ms）。',
      type: 'genre',
      apply(state) { state.genreLv = 5; }
    },
    {
      id: 'ricochet_lv6', icon: '💥', title: '雷核觉醒 Lv.6',
      desc: '蓄能球升级为雷核：速度×1.8（上限1100），碰撞附带120ms麻痹，最多14次有效碰撞或2.6秒后结束，结束时放出小型电弧（30%伤害）。',
      type: 'genre',
      apply(state) { state.genreLv = 6; }
    },
    {
      id: 'ricochet_lv7', icon: '🌀', title: '雷霆闪电球 Lv.7',
      desc: '蓄能球升级为雷霆闪电球：速度×2.1（上限1250）、碰撞伤害×1.2并麻痹160ms；24次有效碰撞或2.8秒后爆炸（1.5倍伤害），生成125px电磁场2.4秒（每0.35秒18%伤害）强化普通弹球。',
      type: 'genre',
      apply(state) { state.genreLv = 7; }
    },
  ],
};

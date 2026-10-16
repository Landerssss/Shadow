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
      return `玩家最大血量提高${rollTieredPct(next)}%。`;
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
      return `击杀敌人时回复${rollLowPct()}%最大生命。`;
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
    descFn() {
      return '同时朝三个方向发射子弹';
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
      return '普通小怪、射手、声波怪移动速度加快，血量降低25%。';
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
    id:    'buff_freeze',
    icon:  '❄️',
    title: '暗影冰封',
    desc:  '怪物受三次攻击后，在十秒内移速降低90%。',
    type:  'buff',
    oneTime: true,
    mechColor: '#3c8cff',  // 蓝色
    apply(state) { state.freezeEnabled = true; }
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
};

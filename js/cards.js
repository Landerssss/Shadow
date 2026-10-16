// ─── CARD SELECTION SYSTEM ────────────────────────────────────────────────────
const Cards = {
  // 根据当前 state.genreLv 取出待选的流派卡（流派专属）
  _getPendingGenreCard(state) {
    const arr = GENRE_CARDS[state.genre];
    const maxLv = arr.length; // 选完后 genreLv = arr.length（如 echo lv6 → genreLv=6）
    if (state.genreLv >= maxLv) return null;
    return arr[state.genreLv] || null; // genreLv=0 → null；genreLv=1 → lv2；...；genreLv=5 → lv6
  },

  // 从未选的 oneTime BUFF 池中随机抽 1 张（机制卡）
  _pickMechanismCard(state) {
    const picked = state.pickedOneTimeBuffs;
    const playerLv = state.player ? state.player.level : 1;
    const mechPool = BUFFS.filter(b =>
      b.type !== 'genre' && b.oneTime && !picked.has(b.id) &&
      (!b.unlockLevel || playerLv >= b.unlockLevel)
    );
    if (mechPool.length === 0) return null;
    return mechPool[Math.floor(Math.random() * mechPool.length)];
  },

  // 通用卡池：非流派、非 oneTime
  _pickCommonCard(state) {
    const playerLv = state.player ? state.player.level : 1;
    const commonPool = BUFFS.filter(b =>
      b.type !== 'genre' && !b.oneTime &&
      (!b.unlockLevel || playerLv >= b.unlockLevel)
    );
    if (commonPool.length === 0) return null;
    return commonPool[Math.floor(Math.random() * commonPool.length)];
  },

  // Generate cards for level-up selection
  // 出现规则：
  //   主角 < 10 级：3 张；>= 10 级：4 张
  //   第 1 张：流派卡（未选完时强制）；第 2 张：机制卡（从 oneTime 池随机）
  //   剩余：从通用池随机（不重复）
  generate(state) {
    const pool = [];
    const usedIds = new Set();

    // 第 1 张：流派卡
    const genreCard = Cards._getPendingGenreCard(state);
    if (genreCard) {
      pool.push(genreCard);
      usedIds.add(genreCard.id);
    }

    // 第 2 张：机制卡
    const mechCard = Cards._pickMechanismCard(state);
    if (mechCard) {
      pool.push(mechCard);
      usedIds.add(mechCard.id);
    }

    // 目标张数：10 级前 3 张，10 级后 4 张
    const playerLv = state.player ? state.player.level : 1;
    const target = playerLv >= 10 ? 4 : 3;

    // 补足通用卡
    const commonPool = BUFFS.filter(b =>
      b.type !== 'genre' && !b.oneTime && !usedIds.has(b.id) &&
      (!b.unlockLevel || playerLv >= b.unlockLevel)
    );
    const shuffled = Utils.shuffle(commonPool);
    for (let i = 0; i < shuffled.length && pool.length < target; i++) {
      pool.push(shuffled[i]);
      usedIds.add(shuffled[i].id);
    }

    return pool;
  },

  // 卡片 UI 分类：流派 / 机制 / 通用
  _classify(card) {
    if (card.type === 'genre') return 'genre';
    if (card.oneTime)         return 'mech';
    return 'buff';
  },

  _label(cls) {
    if (cls === 'genre') return '流派专属';
    if (cls === 'mech')  return '机制';
    return '通用';
  },

  // Show the level-up UI
  show(state, onSelect) {
    const cards = this.generate(state);
    const container = document.getElementById('levelup-cards');
    container.innerHTML = '';

    for (const card of cards) {
      const desc = card.descFn ? card.descFn(state) : card.desc;
      const cls  = Cards._classify(card);
      const el = document.createElement('div');
      el.className = 'lv-card ' + cls;
      // 机制卡专属色（覆盖默认金色）
      if (cls === 'mech' && card.mechColor) {
        el.classList.add('mech-custom');
        el.style.setProperty('--mech-c', card.mechColor);
        el.style.borderColor = card.mechColor;
        el.style.boxShadow  = `0 0 18px ${card.mechColor}77, 0 0 36px ${card.mechColor}33`;
      }
      el.innerHTML = `
        <div class="lv-card-icon">${card.icon}</div>
        <div class="lv-card-title">${card.title}</div>
        <div class="lv-card-desc">${desc}</div>
        <div class="lv-card-type ${cls}">${Cards._label(cls)}</div>
      `;
      el.onclick = () => {
        if (card.oneTime) {
          state.pickedOneTimeBuffs.add(card.id);
        }
        card.apply(state);
        onSelect();
      };
      container.appendChild(el);
    }

    // Show screen
    document.getElementById('screen-levelup').classList.add('active');
  },

  hide() {
    document.getElementById('screen-levelup').classList.remove('active');
  }
};

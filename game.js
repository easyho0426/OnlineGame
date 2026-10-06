// 게임 규칙 전체 (서버에서만 실행). 그리기 코드는 없음.
const S = require('./public/shared.js');
const {
  COLS, ROWS, CELL, waypoints, spawnPos, DIFFICULTY, TOWER_DEFS, DIR_SEQUENCE,
  MAX_TIER, TIER_LABEL, cellBuildable, cellCenter, applyTierStats
} = S;

function createGame(difficulty) {
  const state = {};
  let nextId = 1;

  function reset(diff) {
    if (!DIFFICULTY[diff]) diff = 'easy';
    const d = DIFFICULTY[diff];
    Object.assign(state, {
      difficulty: diff, money: d.startMoney, life: d.startLife,
      wave: 0, maxWave: 100, score: 0, speed: 1,
      gameOver: false, victory: false, waveActive: false,
      spawnQueue: [], spawnTimer: 0,
      towers: [], enemies: [], projectiles: [],
      cellMap: new Map(), events: []
    });
  }
  reset(difficulty);

  // ---------- 적 ----------
  function enemyStatsFor(type, wave) {
    const d = DIFFICULTY[state.difficulty];
    let base;
    if (type === 'basic')     base = { hp: 32 + wave * 9,  speed: 62,  reward: 8,  color: '#35d07f', r: 9,  label: '' };
    else if (type === 'fast') base = { hp: 20 + wave * 6,  speed: 108, reward: 11, color: '#ffe066', r: 7,  label: '' };
    else if (type === 'tank') base = { hp: 100 + wave * 24, speed: 38,  reward: 22, color: '#b478ff', r: 12, label: '' };
    else if (type === 'boss') base = { hp: 420 + wave * 70, speed: 34,  reward: 90, color: '#ff5c7a', r: 16, label: 'BOSS' };
    else                      base = { hp: 30, speed: 60, reward: 8, color: '#35d07f', r: 9, label: '' };
    return {
      hp: Math.round(base.hp * d.hpMult),
      speed: base.speed * d.speedMult,
      reward: Math.max(3, Math.round(base.reward * d.rewardMult)),
      color: base.color, r: base.r, label: base.label
    };
  }

  class Enemy {
    constructor(type, wave) {
      const s = enemyStatsFor(type, wave);
      this.id = nextId++;
      this.type = type;
      this.hp = s.hp; this.maxHp = s.hp;
      this.baseSpeed = s.speed;
      this.reward = s.reward; this.color = s.color; this.r = s.r; this.label = s.label;
      this.wpIndex = 0;
      this.x = spawnPos.x; this.y = spawnPos.y;
      this.slowTimer = 0; this.slowFactor = 0.5;
      this.alive = true; this.reachedCore = false;
    }
    update(dt) {
      if (!this.alive) return;
      let spd = this.baseSpeed;
      if (this.slowTimer > 0) { spd *= this.slowFactor; this.slowTimer -= dt; }
      const target = waypoints[this.wpIndex + 1];
      if (!target) { this.reachedCore = true; this.alive = false; return; }
      const dx = target.x - this.x, dy = target.y - this.y;
      const dist = Math.hypot(dx, dy);
      const step = spd * dt;
      if (step >= dist) { this.x = target.x; this.y = target.y; this.wpIndex++; }
      else { this.x += dx / dist * step; this.y += dy / dist * step; }
    }
  }

  // ---------- 투사체 ----------
  class Projectile {
    constructor(tower, target) {
      this.id = nextId++;
      this.x = tower.x; this.y = tower.y;
      this.target = target; this.owner = tower;
      this.speed = 420;
      this.damage = tower.damage;
      this.color = tower.def.projColor;
      this.splash = tower.def.splash;
      this.slow = tower.slowAmt !== undefined ? tower.slowAmt : tower.def.slow;
      this.dead = false;
    }
    update(dt) {
      if (!this.target || !this.target.alive) { this.dead = true; return; }
      const dx = this.target.x - this.x, dy = this.target.y - this.y;
      const dist = Math.hypot(dx, dy);
      const step = this.speed * dt;
      if (step >= dist || dist < 6) { this.hit(); this.dead = true; return; }
      this.x += dx / dist * step; this.y += dy / dist * step;
    }
    hit() {
      const t = this.target;
      if (this.splash > 0) {
        state.enemies.forEach(e => {
          if (!e.alive) return;
          if (Math.hypot(e.x - this.x, e.y - this.y) <= this.splash) {
            if (damageEnemy(e, this.damage)) this.owner.kills++;
          }
        });
      } else {
        if (damageEnemy(t, this.damage)) this.owner.kills++;
        if (this.slow > 0) { t.slowTimer = 1.1; t.slowFactor = 1 - this.slow; }
      }
      state.events.push({ x: this.x, y: this.y, color: this.color, n: 4 });
    }
  }

  function pointSegDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - x1, py - y1);
    let tt = ((px - x1) * dx + (py - y1) * dy) / len2;
    tt = Math.max(0, Math.min(1, tt));
    return Math.hypot(px - (x1 + dx * tt), py - (y1 + dy * tt));
  }

  // ---------- 타워 ----------
  class Tower {
    constructor(typeKey, r, c) {
      const def = TOWER_DEFS[typeKey];
      this.id = nextId++;
      this.typeKey = typeKey; this.def = def;
      this.r = r; this.c = c;
      this.x = c * CELL + CELL / 2; this.y = r * CELL + CELL / 2;
      this.range = def.range || 0;
      this.damage = def.damage;
      this.fireRate = def.fireRate || 0;
      this.cooldown = 0; this.kills = 0;
      this.totalSpent = def.cost; this.tier = 1;
      if (def.kind === 'laser') { this.dir = { dc: 1, dr: 0 }; this.beamSegments = []; }
      if (def.kind === 'mirror') { this.orientation = '/'; }
      applyTierStats(this);
    }
    findTarget() {
      let best = null, bestProgress = -1;
      for (const e of state.enemies) {
        if (!e.alive) continue;
        if (Math.hypot(e.x - this.x, e.y - this.y) <= this.range && e.wpIndex > bestProgress) {
          bestProgress = e.wpIndex; best = e;
        }
      }
      return best;
    }
    rotate() {
      if (this.def.kind === 'laser') {
        const idx = DIR_SEQUENCE.findIndex(d => d.dc === this.dir.dc && d.dr === this.dir.dr);
        this.dir = DIR_SEQUENCE[(idx + 1) % DIR_SEQUENCE.length];
      } else if (this.def.kind === 'mirror') {
        this.orientation = this.orientation === '/' ? '\\' : '/';
      }
    }
    computeBeam() {
      const segments = [];
      let r = this.r, c = this.c, dr = this.dir.dr, dc = this.dir.dc;
      let x = this.x, y = this.y, bounces = 0;
      while (bounces <= 10) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= ROWS || nc >= COLS) {
          let ex = x, ey = y;
          if (dc !== 0) ex = dc > 0 ? COLS * CELL : 0;
          if (dr !== 0) ey = dr > 0 ? ROWS * CELL : 0;
          segments.push({ x1: x, y1: y, x2: ex, y2: ey });
          break;
        }
        const center = cellCenter(nr, nc);
        segments.push({ x1: x, y1: y, x2: center.x, y2: center.y });
        x = center.x; y = center.y; r = nr; c = nc;
        const mir = state.cellMap.get(nr + '_' + nc);
        if (mir && mir.typeKey === 'mirror') {
          let ndc, ndr;
          if (mir.orientation === '/') { ndc = -dr; ndr = -dc; } else { ndc = dr; ndr = dc; }
          dc = ndc; dr = ndr; bounces++;
        }
      }
      return segments;
    }
    update(dt) {
      if (this.def.kind === 'mirror') return;
      if (this.def.kind === 'laser') {
        this.beamSegments = this.computeBeam();
        const dmg = this.damage * dt;
        state.enemies.forEach(e => {
          if (!e.alive) return;
          for (const s of this.beamSegments) {
            if (pointSegDist(e.x, e.y, s.x1, s.y1, s.x2, s.y2) <= e.r + 5) {
              if (damageEnemy(e, dmg)) this.kills++;
              break;
            }
          }
        });
        return;
      }
      this.cooldown -= dt * 1000;
      if (this.cooldown <= 0) {
        const target = this.findTarget();
        if (target) { state.projectiles.push(new Projectile(this, target)); this.cooldown = this.fireRate; }
      }
    }
  }

  function damageEnemy(e, dmg) {
    if (!e.alive) return false;
    e.hp -= dmg;
    if (e.hp <= 0) {
      e.alive = false;
      state.money += e.reward;
      state.score += e.reward * 3;
      state.events.push({ x: e.x, y: e.y, color: e.color, n: 10 });
      return true;
    }
    return false;
  }

  // ---------- 웨이브 ----------
  function buildWave(wave) {
    const d = DIFFICULTY[state.difficulty];
    const list = [];
    const count = Math.min(6 + Math.floor(wave * 1.15 * d.countMult), 170);
    for (let i = 0; i < count; i++) {
      let type = 'basic';
      const roll = Math.random();
      if (wave >= 3 && roll < 0.28) type = 'fast';
      if (wave >= 5 && roll > 0.8) type = 'tank';
      list.push(type);
    }
    if (wave % 10 === 0) list.push('boss');
    return list;
  }

  // ---------- 명령 처리 (클라이언트가 보낸 값은 전부 검증) ----------
  const isInt = (n) => Number.isInteger(n);
  const findTower = (id) => state.towers.find(t => t.id === id);

  function mergeTowers(a, b) {
    const merged = new Tower(a.typeKey, b.r, b.c);
    merged.tier = a.tier + 1;
    applyTierStats(merged);
    merged.totalSpent = a.totalSpent + b.totalSpent;
    merged.kills = a.kills + b.kills;
    if (merged.def.kind === 'laser') merged.dir = b.dir;
    if (merged.def.kind === 'mirror') merged.orientation = b.orientation;
    state.towers = state.towers.filter(t => t !== a && t !== b);
    state.towers.push(merged);
    return { selectId: merged.id, toast: `${merged.def.name} ${TIER_LABEL[merged.tier - 1]}단계로 합체!` };
  }

  function canMerge(a, b) {
    return a && b && a !== b && a.typeKey === b.typeKey && a.tier === b.tier && a.tier < MAX_TIER;
  }

  function handleCommand(cmd) {
    if (!cmd || typeof cmd.type !== 'string') return { error: '잘못된 명령' };

    if (cmd.type === 'restart') { reset(cmd.difficulty); return { ok: true }; }
    if (state.gameOver || state.victory) return { error: '게임이 끝났습니다' };

    switch (cmd.type) {
      case 'place': {
        const def = TOWER_DEFS[cmd.tower];
        if (!def) return { error: '알 수 없는 노드' };
        if (!isInt(cmd.r) || !isInt(cmd.c)) return { error: '잘못된 위치' };
        if (!cellBuildable(cmd.r, cmd.c)) return { error: '회로 위에는 설치할 수 없습니다' };
        if (state.towers.some(t => t.r === cmd.r && t.c === cmd.c)) return { error: '이미 노드가 있는 칸입니다' };
        if (state.money < def.cost) return { error: '자금이 부족합니다' };
        state.money -= def.cost;
        state.towers.push(new Tower(cmd.tower, cmd.r, cmd.c));
        return { ok: true };
      }
      case 'move': {
        const tower = findTower(cmd.id);
        if (!tower) return { error: '노드를 찾을 수 없습니다' };
        if (!isInt(cmd.r) || !isInt(cmd.c) || cmd.r < 0 || cmd.c < 0 || cmd.r >= ROWS || cmd.c >= COLS) return { error: '잘못된 위치' };
        if (cmd.r === tower.r && cmd.c === tower.c) return { ok: true };
        const target = state.towers.find(t => t !== tower && t.r === cmd.r && t.c === cmd.c);
        if (target) {
          if (canMerge(tower, target)) return mergeTowers(tower, target);
          return { error: '다른 노드가 있는 칸입니다' };
        }
        if (!cellBuildable(cmd.r, cmd.c)) return { error: '회로 위로는 이동할 수 없습니다' };
        tower.r = cmd.r; tower.c = cmd.c;
        tower.x = cmd.c * CELL + CELL / 2; tower.y = cmd.r * CELL + CELL / 2;
        return { selectId: tower.id, toast: '노드를 이동했습니다' };
      }
      case 'merge': {
        const a = findTower(cmd.a), b = findTower(cmd.b);
        if (!canMerge(a, b)) return { error: '합칠 수 없는 조합입니다' };
        return mergeTowers(a, b);
      }
      case 'sell': {
        const t = findTower(cmd.id);
        if (!t) return { error: '노드를 찾을 수 없습니다' };
        state.money += Math.floor(t.totalSpent * 0.55);
        state.towers = state.towers.filter(x => x !== t);
        return { ok: true };
      }
      case 'rotate': {
        const t = findTower(cmd.id);
        if (!t) return { error: '노드를 찾을 수 없습니다' };
        t.rotate();
        return { ok: true };
      }
      case 'startWave': {
        if (state.waveActive || state.wave >= state.maxWave) return { error: '지금은 시작할 수 없습니다' };
        state.wave++;
        state.spawnQueue = buildWave(state.wave);
        state.spawnTimer = 0;
        state.waveActive = true;
        return { ok: true };
      }
      case 'speed': {
        state.speed = state.speed === 1 ? 2 : (state.speed === 2 ? 3 : 1);
        return { ok: true };
      }
      case 'clearAll': {
        if (state.towers.length === 0) return { error: '삭제할 노드가 없습니다' };
        let refund = 0;
        state.towers.forEach(t => refund += Math.floor(t.totalSpent * 0.55));
        state.money += refund;
        state.towers = [];
        return { toast: `모든 노드를 삭제했습니다 (+${refund})` };
      }
      default:
        return { error: '알 수 없는 명령' };
    }
  }

  // ---------- 매 틱 업데이트 ----------
  function update(rawDt) {
    if (state.gameOver || state.victory) return;
    const dt = rawDt * state.speed;

    if (state.waveActive && state.spawnQueue.length) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) {
        state.enemies.push(new Enemy(state.spawnQueue.shift(), state.wave));
        state.spawnTimer = 0.5;
      }
    }

    state.cellMap.clear();
    state.towers.forEach(t => state.cellMap.set(t.r + '_' + t.c, t));

    state.enemies.forEach(e => {
      e.update(dt);
      if (e.reachedCore) state.life -= e.type === 'boss' ? 5 : (e.type === 'tank' ? 3 : 1);
    });
    state.enemies = state.enemies.filter(e => e.alive);

    state.towers.forEach(t => t.update(dt));
    state.projectiles.forEach(p => p.update(dt));
    state.projectiles = state.projectiles.filter(p => !p.dead);

    if (state.life <= 0) { state.life = 0; state.gameOver = true; return; }

    if (state.waveActive && state.spawnQueue.length === 0 && state.enemies.every(e => !e.alive)) {
      state.waveActive = false;
      state.money += 15 + state.wave * 2;
      if (state.wave >= state.maxWave) state.victory = true;
    }
  }

  // ---------- 클라이언트로 보낼 데이터 (순수 JSON) ----------
  const rd = (n) => Math.round(n * 10) / 10;
  function snapshot() {
    const events = state.events; state.events = [];
    return {
      difficulty: state.difficulty, money: state.money, life: state.life,
      wave: state.wave, maxWave: state.maxWave, score: state.score, speed: state.speed,
      waveActive: state.waveActive, gameOver: state.gameOver, victory: state.victory,
      towers: state.towers.map(t => ({
        id: t.id, typeKey: t.typeKey, r: t.r, c: t.c, x: t.x, y: t.y, tier: t.tier,
        range: t.range, damage: t.damage, kills: t.kills, totalSpent: t.totalSpent,
        dir: t.dir, orientation: t.orientation, beam: t.beamSegments
      })),
      enemies: state.enemies.filter(e => e.alive).map(e => ({
        id: e.id, x: rd(e.x), y: rd(e.y), hp: Math.round(e.hp), maxHp: e.maxHp,
        r: e.r, color: e.color, label: e.label
      })),
      projectiles: state.projectiles.map(p => ({ id: p.id, x: rd(p.x), y: rd(p.y), color: p.color })),
      events
    };
  }

  return { handleCommand, update, snapshot };
}

module.exports = { createGame };

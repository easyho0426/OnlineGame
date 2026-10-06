// 서버(game.js)와 브라우저(index.html)가 같이 쓰는 상수/규칙
(function (root) {
  const COLS = 16, ROWS = 10, CELL = 45;

  const pathCells = [
    [1,0],[1,1],[1,2],[1,3],[1,4],
    [2,4],[3,4],[4,4],[5,4],[6,4],
    [6,5],[6,6],[6,7],[6,8],
    [5,8],[4,8],[3,8],[2,8],[1,8],
    [1,9],[1,10],[1,11],
    [2,11],[3,11],[4,11],[5,11],[6,11],[7,11],
    [7,12],[7,13],[7,14],[7,15]
  ];
  const pathSet = new Set(pathCells.map(([r, c]) => r + '_' + c));
  const waypoints = pathCells.map(([r, c]) => ({ x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 }));
  const coreCell = pathCells[pathCells.length - 1];
  const corePos = { x: coreCell[1] * CELL + CELL / 2, y: coreCell[0] * CELL + CELL / 2 };
  const spawnPos = waypoints[0];

  function cellCenter(r, c) { return { x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 }; }
  function cellBuildable(r, c) {
    if (r < 0 || c < 0 || r >= ROWS || c >= COLS) return false;
    return !pathSet.has(r + '_' + c);
  }

  const DIFFICULTY = {
    easy:   { label:'쉬움',   hpMult:1.0,  speedMult:1.0,  rewardMult:1.0,  countMult:1.0,  startMoney:150, startLife:20 },
    normal: { label:'보통',   hpMult:1.4,  speedMult:1.08, rewardMult:0.95, countMult:1.15, startMoney:130, startLife:16 },
    hard:   { label:'어려움', hpMult:1.85, speedMult:1.16, rewardMult:0.85, countMult:1.3,  startMoney:110, startLife:12 }
  };

  const TOWER_DEFS = {
    pulse:  { name:'펄스 노드', icon:'◆', cost:50,  range:95,  fireRate:420,  damage:9,  color:'#2dd4ff', projColor:'#8fe9ff', splash:0,  slow:0,    kind:'attack', desc:'빠른 연사, 낮은 피해' },
    cannon: { name:'캐넌 노드', icon:'●', cost:110, range:105, fireRate:950,  damage:30, color:'#ffb020', projColor:'#ffd27a', splash:38, slow:0,    kind:'attack', desc:'범위 피해, 느린 연사' },
    sniper: { name:'스나이퍼 노드', icon:'▲', cost:160, range:170, fireRate:1300, damage:55, color:'#b478ff', projColor:'#dcc2ff', splash:0, slow:0, kind:'attack', desc:'긴 사거리, 높은 피해' },
    frost:  { name:'프로스트 노드', icon:'❄', cost:85, range:90, fireRate:700, damage:4, color:'#35d0c7', projColor:'#a8fff5', splash:0, slow:0.45, kind:'attack', desc:'적 이동속도 감소' },
    laser:  { name:'레이저 노드', icon:'⌁', cost:75, damage:7, color:'#ff3d81', kind:'laser', desc:'경로를 지나는 모든 적에게 지속 피해 (약함, 광역)' },
    mirror: { name:'거울', icon:'/', cost:35, damage:0, color:'#9fd8ff', kind:'mirror', desc:'레이저의 궤도를 90도로 반사' }
  };

  const DIR_SEQUENCE = [ {dc:1,dr:0}, {dc:0,dr:1}, {dc:-1,dr:0}, {dc:0,dr:-1} ];

  const MAX_TIER = 5;
  const TIER_DMG_MULT   = [1, 2.2, 4, 7, 12];
  const TIER_RANGE_MULT = [1, 1.15, 1.3, 1.45, 1.6];
  const TIER_FIRE_MULT  = [1, 0.85, 0.72, 0.6, 0.5];
  const TIER_LABEL = ['I','II','III','IV','V'];

  function applyTierStats(t) {
    const idx = Math.max(0, Math.min(MAX_TIER - 1, t.tier - 1));
    if (t.def.kind === 'attack') {
      t.damage = t.def.damage * TIER_DMG_MULT[idx];
      t.range = (t.def.range || 0) * TIER_RANGE_MULT[idx];
      t.fireRate = (t.def.fireRate || 0) * TIER_FIRE_MULT[idx];
      if (t.def.slow) t.slowAmt = Math.min(0.8, t.def.slow + (t.tier - 1) * 0.08);
    } else if (t.def.kind === 'laser') {
      t.damage = t.def.damage * TIER_DMG_MULT[idx];
    }
  }

  const Shared = {
    COLS, ROWS, CELL, pathCells, pathSet, waypoints, corePos, spawnPos,
    cellCenter, cellBuildable, DIFFICULTY, TOWER_DEFS, DIR_SEQUENCE,
    MAX_TIER, TIER_LABEL, applyTierStats
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Shared;
  else root.Shared = Shared;
})(typeof window !== 'undefined' ? window : globalThis);

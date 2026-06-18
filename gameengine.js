const TILE = 40;
const MAP_SIZES = { small: [13, 11], medium: [17, 13], large: [21, 15] };
const PALETTE = [
  { color: '#3b82f6', name: 'Pommi-Pekka' },
  { color: '#ef4444', name: 'Dynamiitti-Doris' },
  { color: '#22c55e', name: 'Rajahde-Riku' },
  { color: '#a855f7', name: 'Tuhotar Tiina' },
  { color: '#f59e0b', name: 'Kraatteri-Kalle' },
  { color: '#06b6d4', name: 'Sytytin-Sini' },
  { color: '#ec4899', name: 'Paukku-Paavo' },
  { color: '#84cc16', name: 'Liekki-Lotta' },
  { color: '#14b8a6', name: 'Kapina-Kasperi' },
  { color: '#eab308', name: 'Miina-Milla' },
  { color: '#6366f1', name: 'Tikittava-Teemu' },
];
const PREFIXES = ['Pommi', 'Dynamiitti', 'Rajahde', 'Paukku', 'Kraatteri', 'Sytytin', 'Miina', 'Liekki', 'TNT', 'Atomi'];
const ABILITY_KEYS = ['shield', 'haamu', 'invis', 'speed', 'light', 'atomic', 'laser', 'timebomb'];
const START_COUNT = 2;
const EMPTY = 0, HARD = 1, SOFT = 2;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIR_VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const BOMB_FUSE = 2.8, FLAME_TIME = 0.5, FLAME_STEP = 0.03;
const TIMEBOMB_FUSE = 15, LASER_FUSE = 2.5, LASER_TIME = 5;
const ATOMIC_FUSE = 4.0, ATOMIC_TIME = 1.0;
const LIGHT_FUSE = 1.0, BLACKOUT_TIME = 5;
const SUDDEN_INTERVAL = 0.6;
const SHIELD_TIME = 8, PHASE_TIME = 8, INVIS_TIME = 8, SPEEDBOOST_TIME = 6, SPEEDBOOST_MULT = 1.7;
const RESPAWN_DELAY = 2.0, RESPAWN_INVULN = 3.0;
const SOFT_PROB = 0.82, POWERUP_PROB = 0.34;
const RANGE_CAP = 6, BOMB_CAP = 6;
const HALF = 20, COLL_EPS = 0.8;
const HUMAN_SPEED = 3.7;
const DIFF = {
  easy: { hesitate: 0.35, bombSoft: 0.5, bombAttack: 0.15, speed: 3.0 },
  normal: { hesitate: 0.12, bombSoft: 0.8, bombAttack: 0.5, speed: 3.6 },
  hard: { hesitate: 0.0, bombSoft: 1.0, bombAttack: 0.9, speed: 4.3 },
};

function freshAbilities() {
  const out = {};
  for (const key of ABILITY_KEYS) out[key] = START_COUNT;
  return out;
}

function randomPrefix() {
  return PREFIXES[(Math.random() * PREFIXES.length) | 0];
}

function createGame(settings = {}) {
  let mapSize = MAP_SIZES[settings.mapSize] ? settings.mapSize : 'small';
  let difficulty = DIFF[settings.difficulty] ? settings.difficulty : 'normal';
  let numBots = Math.max(0, Math.min(9, Number(settings.numBots ?? 2) | 0));
  const playerNames = [
    cleanName(settings.playerNames && settings.playerNames[0], 'Pelaaja'),
    cleanName(settings.playerNames && settings.playerNames[1], 'Kaveri'),
  ];

  let COLS = 13, ROWS = 11, W = COLS * TILE, H = ROWS * TILE;
  let grid = [], powerups = {}, bombs = [], flames = [], players = [], lights = [];
  let running = true, gameOver = false, shake = 0, tick = 0, elapsed = 0;
  let sudden = false, spiralOrder = [], spiralIdx = 0, suddenTimer = 0, rockFx = [], suddenBanner = 0;
  const humanDirs = [[], []];
  const req = { bomb: [false, false] };
  for (const key of ABILITY_KEYS) req[key] = [false, false];

  const key = (x, y) => `${x},${y}`;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;
  const center = (g) => g * TILE + TILE / 2;
  const centerCell = (e) => ({
    x: Math.max(0, Math.min(COLS - 1, Math.floor(e.px / TILE))),
    y: Math.max(0, Math.min(ROWS - 1, Math.floor(e.py / TILE))),
  });

  function cleanName(name, fallback) {
    const out = String(name || '').trim().slice(0, 14);
    return out || fallback;
  }

  function buildSnapshot() {
    return {
      tick, serverTime: elapsed, COLS, ROWS,
      grid: grid.map((r) => [...r]),
      players: players.map((p) => ({
        id: p.id, px: p.px, py: p.py, color: p.color, name: p.name,
        isBot: p.isBot, alive: p.alive, moving: p.moving, dir: p.dir,
        kills: p.kills, deaths: p.deaths, speed: p.speed, baseSpeed: p.baseSpeed,
        maxBombs: p.maxBombs, range: p.range, speedLvl: p.speedLvl, bombsActive: p.bombsActive,
        shieldTimer: p.shieldTimer, phaseTimer: p.phaseTimer, invisTimer: p.invisTimer,
        speedTimer: p.speedTimer, respawnTimer: p.respawnTimer, invuln: p.invuln, anim: p.anim,
        abilities: { ...(p.abilities || {}) }, firstname: p.firstname, totalScore: p.totalScore,
      })),
      bombs: bombs.map((b) => ({
        gx: b.gx, gy: b.gy, fuse: b.fuse, range: b.range, kind: b.kind,
        oi: b.owner ? players.indexOf(b.owner) : -1,
      })),
      flames: flames.map((f) => ({
        gx: f.gx, gy: f.gy, delay: f.delay, life: f.life, maxLife: f.maxLife,
        kind: f.kind, destroysBlock: f.destroysBlock,
      })),
      powerups: { ...powerups },
      sudden, suddenBanner, gameOver, shake,
      lights: lights.map((L) => ({ oi: players.indexOf(L.owner), t: L.t })),
      rockFx: [...rockFx],
      gameOverTitle: gameOver ? 'Peli paattyi' : null,
      gameOverMsg: null,
    };
  }

  function setInput(playerIndex, input = {}) {
    if (playerIndex !== 0 && playerIndex !== 1) return;
    const dirs = Array.isArray(input.dirs) ? input.dirs.filter((d) => DIR_VEC[d]) : [];
    humanDirs[playerIndex] = dirs.slice(-4);
    if (input.bomb) req.bomb[playerIndex] = true;
    if (Array.isArray(input.abilities)) {
      for (const ability of input.abilities) if (req[ability]) req[ability][playerIndex] = true;
    }
  }

  function clearSpawn(cx, cy) {
    grid[cy][cx] = EMPTY;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (inBounds(nx, ny) && grid[ny][nx] !== HARD) grid[ny][nx] = EMPTY;
    }
  }

  function generateSpawns(n) {
    const cands = [];
    for (let y = 1; y <= ROWS - 2; y += 2) for (let x = 1; x <= COLS - 2; x += 2) cands.push({ x, y });
    const chosen = [{ x: 1, y: 1 }];
    while (chosen.length < n && chosen.length < cands.length) {
      let best = null, bestD = -1;
      for (const c of cands) {
        if (chosen.some((s) => s.x === c.x && s.y === c.y)) continue;
        let md = Infinity;
        for (const s of chosen) md = Math.min(md, Math.abs(s.x - c.x) + Math.abs(s.y - c.y));
        if (md > bestD) { bestD = md; best = c; }
      }
      if (!best) break;
      chosen.push(best);
    }
    return chosen.slice(0, n);
  }

  function buildBoard() {
    [COLS, ROWS] = MAP_SIZES[mapSize];
    W = COLS * TILE; H = ROWS * TILE;
    grid = []; powerups = {}; bombs = []; flames = []; lights = [];
    sudden = false; spiralOrder = []; spiralIdx = 0; suddenTimer = 0; rockFx = []; suddenBanner = 0;
    for (let y = 0; y < ROWS; y++) {
      grid[y] = [];
      for (let x = 0; x < COLS; x++) {
        if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1) grid[y][x] = HARD;
        else if (x % 2 === 0 && y % 2 === 0) grid[y][x] = HARD;
        else grid[y][x] = Math.random() < SOFT_PROB ? SOFT : EMPTY;
      }
    }
    const total = Math.min(2 + numBots, PALETTE.length);
    const spawns = generateSpawns(total);
    for (const s of spawns) clearSpawn(s.x, s.y);
    players = [];
    for (let i = 0; i < spawns.length; i++) {
      const isBot = i >= 2;
      const first = isBot ? null : playerNames[i];
      const name = isBot ? PALETTE[i].name : `${randomPrefix()}-${first}`;
      players.push({
        id: i, px: center(spawns[i].x), py: center(spawns[i].y),
        color: PALETTE[i].color, name, isBot, firstname: first,
        abilities: isBot ? {} : freshAbilities(), totalScore: isBot ? null : 0,
        alive: true, moving: false, dir: 'down', kills: 0, deaths: 0,
        speed: isBot ? DIFF[difficulty].speed : HUMAN_SPEED,
        baseSpeed: isBot ? DIFF[difficulty].speed : HUMAN_SPEED,
        maxBombs: 1, range: 2, speedLvl: 0, bombsActive: 0,
        shieldTimer: 0, phaseTimer: 0, invisTimer: 0, speedTimer: 0,
        respawnTimer: 0, invuln: 0, anim: 0, targetCell: null,
      });
    }
  }

  const bombAt = (x, y) => bombs.some((b) => b.gx === x && b.gy === y);
  const flameAt = (x, y) => flames.some((f) => f.gx === x && f.gy === y && f.delay <= 0 && f.life > 0);

  function cellSolid(e, cx, cy) {
    if (!inBounds(cx, cy)) return true;
    if (grid[cy][cx] !== EMPTY) return true;
    const b = bombs.find((bb) => bb.gx === cx && bb.gy === cy);
    if (!b) return false;
    if (e.phaseTimer > 0) return false;
    if (b.pass && b.pass.has(e.id)) return false;
    return true;
  }

  function hitsWall(e, px, py) {
    const minx = Math.floor((px - HALF + COLL_EPS) / TILE), maxx = Math.floor((px + HALF - COLL_EPS) / TILE);
    const miny = Math.floor((py - HALF + COLL_EPS) / TILE), maxy = Math.floor((py + HALF - COLL_EPS) / TILE);
    for (let cy = miny; cy <= maxy; cy++) for (let cx = minx; cx <= maxx; cx++) if (cellSolid(e, cx, cy)) return true;
    return false;
  }

  function stepForward(e, ux, uy, dist) {
    let moved = 0;
    while (moved < dist - 1e-6) {
      const s = Math.min(1, dist - moved), nx = e.px + ux * s, ny = e.py + uy * s;
      if (!hitsWall(e, nx, ny)) { e.px = nx; e.py = ny; moved += s; } else break;
    }
    return moved > 0;
  }

  function moveDir(e, dir, dist) {
    const [ux, uy] = DIR_VEC[dir];
    if (stepForward(e, ux, uy, dist)) return;
    if (ux !== 0) {
      const lane = Math.round((e.py - TILE / 2) / TILE) * TILE + TILE / 2;
      const d = lane - e.py;
      if (d !== 0) {
        const m = Math.sign(d) * Math.min(dist, Math.abs(d));
        if (!hitsWall(e, e.px, e.py + m)) { e.py += m; if (Math.abs(lane - e.py) < 0.6) e.py = lane; stepForward(e, ux, uy, dist); }
      }
    } else {
      const lane = Math.round((e.px - TILE / 2) / TILE) * TILE + TILE / 2;
      const d = lane - e.px;
      if (d !== 0) {
        const m = Math.sign(d) * Math.min(dist, Math.abs(d));
        if (!hitsWall(e, e.px + m, e.py)) { e.px += m; if (Math.abs(lane - e.px) < 0.6) e.px = lane; stepForward(e, ux, uy, dist); }
      }
    }
  }

  function overlapTile(e, gx, gy) {
    return e.px + HALF > gx * TILE && e.px - HALF < (gx + 1) * TILE &&
      e.py + HALF > gy * TILE && e.py - HALF < (gy + 1) * TILE;
  }

  function passSet(cx, cy) {
    const s = new Set();
    for (const e of players) if (e.alive && overlapTile(e, cx, cy)) s.add(e.id);
    return s;
  }

  function placeBomb(p, cx, cy) {
    if (p.bombsActive >= p.maxBombs || bombAt(cx, cy) || grid[cy][cx] !== EMPTY) return false;
    bombs.push({ gx: cx, gy: cy, fuse: BOMB_FUSE, range: p.range, owner: p, done: false, pass: passSet(cx, cy), countsToLimit: true, kind: 'normal' });
    p.bombsActive++;
    return true;
  }

  function plantSpecial(p, cx, cy, kind, fuse) {
    if (bombAt(cx, cy) || grid[cy][cx] !== EMPTY) return false;
    bombs.push({ gx: cx, gy: cy, fuse, range: p.range, owner: p, done: false, pass: passSet(cx, cy), countsToLimit: false, kind });
    return true;
  }

  function plantSuddenBomb(x, y) {
    bombs.push({ gx: x, gy: y, fuse: BOMB_FUSE, range: 2, owner: null, done: false, pass: passSet(x, y), countsToLimit: false, kind: 'normal' });
  }

  function addFlame(x, y, destroys, delay, kind, life, owner) {
    const L = life || FLAME_TIME;
    flames.push({ gx: x, gy: y, delay: delay || 0, life: L, maxLife: L, destroysBlock: !!destroys, kind: kind || 'normal', owner: owner || null });
  }

  function detonate(b) {
    if (b.kind === 'laser') explodeLaser(b);
    else if (b.kind === 'atomic') explodeAtomic(b);
    else if (b.kind === 'light') explodeLight(b);
    else explodeBomb(b);
  }

  function explodeBomb(b) {
    b.done = true;
    addFlame(b.gx, b.gy, false, 0, 'normal', FLAME_TIME, b.owner);
    for (const [dx, dy] of DIRS) {
      for (let d = 1; d <= b.range; d++) {
        const cx = b.gx + dx * d, cy = b.gy + dy * d;
        if (!inBounds(cx, cy) || grid[cy][cx] === HARD) break;
        const isSoft = grid[cy][cx] === SOFT;
        addFlame(cx, cy, isSoft, d * FLAME_STEP, 'normal', FLAME_TIME, b.owner);
        const ob = bombs.find((o) => !o.done && o.gx === cx && o.gy === cy);
        if (ob) { ob.fuse = 0; break; }
        if (isSoft) break;
        if (powerups[key(cx, cy)]) { delete powerups[key(cx, cy)]; break; }
      }
    }
    if (b.owner && b.countsToLimit) b.owner.bombsActive = Math.max(0, b.owner.bombsActive - 1);
    shake = Math.min(9, shake + 5);
  }

  function explodeLaser(b) {
    b.done = true;
    addFlame(b.gx, b.gy, false, 0, 'laser', LASER_TIME, b.owner);
    for (const [dx, dy] of DIRS) {
      let d = 1;
      while (true) {
        const cx = b.gx + dx * d, cy = b.gy + dy * d;
        if (!inBounds(cx, cy) || grid[cy][cx] === HARD) break;
        if (grid[cy][cx] === SOFT) grid[cy][cx] = EMPTY;
        const ob = bombs.find((o) => !o.done && o.gx === cx && o.gy === cy);
        if (ob) ob.fuse = 0;
        addFlame(cx, cy, false, d * 0.02, 'laser', LASER_TIME, b.owner);
        d++;
      }
    }
    shake = Math.min(9, shake + 5);
  }

  function explodeAtomic(b) {
    b.done = true;
    const r = b.range;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) > r) continue;
      const cx = b.gx + dx, cy = b.gy + dy;
      if (!inBounds(cx, cy) || cx === 0 || cy === 0 || cx === COLS - 1 || cy === ROWS - 1) continue;
      if (grid[cy][cx] !== EMPTY) grid[cy][cx] = EMPTY;
      const ob = bombs.find((o) => !o.done && o.gx === cx && o.gy === cy);
      if (ob) ob.fuse = 0;
      addFlame(cx, cy, false, Math.max(Math.abs(dx), Math.abs(dy)) * FLAME_STEP, 'atomic', ATOMIC_TIME, b.owner);
    }
    shake = Math.min(13, shake + 11);
  }

  function explodeLight(b) {
    b.done = true;
    if (b.owner) lights.push({ owner: b.owner, t: BLACKOUT_TIME });
    shake = Math.min(6, shake + 2);
  }

  function maybeSpawnPowerup(x, y) {
    if (grid[y][x] !== EMPTY || Math.random() >= POWERUP_PROB) return;
    powerups[key(x, y)] = Math.random() < 0.5 ? 'fire' : 'bomb';
  }

  function anySoft() {
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (grid[y][x] === SOFT) return true;
    return false;
  }

  function makeSpiral(x0, y0, x1, y1) {
    const o = [];
    while (x0 <= x1 && y0 <= y1) {
      for (let x = x0; x <= x1; x++) o.push([x, y0]);
      for (let y = y0 + 1; y <= y1; y++) o.push([x1, y]);
      if (y0 < y1) for (let x = x1 - 1; x >= x0; x--) o.push([x, y1]);
      if (x0 < x1) for (let y = y1 - 1; y >= y0 + 1; y--) o.push([x0, y]);
      x0++; y0++; x1--; y1--;
    }
    return o;
  }

  function startSudden() {
    sudden = true; spiralIdx = 0; suddenTimer = 0.7; suddenBanner = 2.2;
    for (const p of players) if (!p.alive) p.respawnTimer = 0;
    spiralOrder = makeSpiral(1, 1, COLS - 2, ROWS - 2);
  }

  function fillRock(x, y) {
    grid[y][x] = HARD;
    delete powerups[key(x, y)];
    const bi = bombs.findIndex((b) => b.gx === x && b.gy === y);
    if (bi >= 0) {
      const b = bombs[bi];
      if (b.owner && b.countsToLimit) b.owner.bombsActive = Math.max(0, b.owner.bombsActive - 1);
      bombs.splice(bi, 1);
    }
    rockFx.push({ x, y, t: 0.3 });
    shake = Math.min(9, shake + 2);
  }

  function occupiedByPlayer(x, y) {
    for (const p of players) if (p.alive) {
      const c = centerCell(p);
      if (c.x === x && c.y === y) return true;
    }
    return false;
  }

  function projectBlast(b, set) {
    if (b.kind === 'light') return;
    if (b.kind === 'atomic') {
      const r = b.range;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) <= r && inBounds(b.gx + dx, b.gy + dy)) set.add(key(b.gx + dx, b.gy + dy));
      }
      return;
    }
    set.add(key(b.gx, b.gy));
    for (const [dx, dy] of DIRS) {
      for (let d = 1; d <= (b.kind === 'laser' ? 99 : b.range); d++) {
        const cx = b.gx + dx * d, cy = b.gy + dy * d;
        if (!inBounds(cx, cy) || grid[cy][cx] === HARD) break;
        set.add(key(cx, cy));
        if (b.kind !== 'laser' && grid[cy][cx] === SOFT) break;
      }
    }
  }

  function buildDanger() {
    const s = new Set();
    for (const f of flames) s.add(key(f.gx, f.gy));
    for (const b of bombs) projectBlast(b, s);
    return s;
  }

  function bfs(start, isGoal, passable) {
    const q = [start], came = {}, seen = {};
    seen[key(start.x, start.y)] = true;
    while (q.length) {
      const c = q.shift();
      if (isGoal(c)) {
        const path = [];
        let cur = c;
        while (cur) { path.unshift(cur); cur = came[key(cur.x, cur.y)]; }
        return path;
      }
      for (const [dx, dy] of DIRS) {
        const nx = c.x + dx, ny = c.y + dy, kk = key(nx, ny);
        if (!inBounds(nx, ny) || seen[kk] || !passable(nx, ny)) continue;
        seen[kk] = true; came[kk] = { x: c.x, y: c.y }; q.push({ x: nx, y: ny });
      }
    }
    return null;
  }

  function adjacentToSoft(x, y) {
    for (const [dx, dy] of DIRS) if (inBounds(x + dx, y + dy) && grid[y + dy][x + dx] === SOFT) return true;
    return false;
  }

  const basicPowerupAt = (x, y) => powerups[key(x, y)] === 'fire' || powerups[key(x, y)] === 'bomb';
  const visibleEnemies = (p) => players.filter((e) => e.alive && e !== p && !(e.invisTimer > 0));

  function lineClearToEnemy(p, cur, range) {
    for (const e of visibleEnemies(p)) {
      const ec = centerCell(e);
      if (ec.x === cur.x) {
        const dist = Math.abs(ec.y - cur.y), s = Math.sign(ec.y - cur.y);
        if (dist >= 1 && dist <= range) {
          let blocked = false;
          for (let d = 1; d < dist; d++) if (grid[cur.y + s * d][cur.x] !== EMPTY) blocked = true;
          if (!blocked) return true;
        }
      } else if (ec.y === cur.y) {
        const dist = Math.abs(ec.x - cur.x), s = Math.sign(ec.x - cur.x);
        if (dist >= 1 && dist <= range) {
          let blocked = false;
          for (let d = 1; d < dist; d++) if (grid[cur.y][cur.x + s * d] !== EMPTY) blocked = true;
          if (!blocked) return true;
        }
      }
    }
    return false;
  }

  function hasEscape(p, cur) {
    const sim = buildDanger();
    projectBlast({ gx: cur.x, gy: cur.y, range: p.range, kind: 'normal' }, sim);
    const path = bfs(cur, (c) => !sim.has(key(c.x, c.y)), (x, y) => grid[y][x] === EMPTY && !bombAt(x, y) && !flameAt(x, y));
    return !!(path && path.length > 1);
  }

  function botDecide(p, cur, danger) {
    const diff = DIFF[difficulty];
    const notSolid = (x, y) => grid[y][x] === EMPTY && !bombAt(x, y);
    p.targetCell = null;
    if (danger.has(key(cur.x, cur.y))) {
      const path = bfs(cur, (c) => !danger.has(key(c.x, c.y)), (x, y) => notSolid(x, y) && !flameAt(x, y));
      if (path && path.length > 1) p.targetCell = path[1];
      return;
    }
    if (p.bombsActive < p.maxBombs && !bombAt(cur.x, cur.y)) {
      let want = false;
      if (adjacentToSoft(cur.x, cur.y)) want = Math.random() < diff.bombSoft;
      else if (lineClearToEnemy(p, cur, p.range)) want = Math.random() < diff.bombAttack;
      if (want && hasEscape(p, cur)) { placeBomb(p, cur.x, cur.y); return; }
    }
    if (Math.random() < diff.hesitate) return;
    const passable = (x, y) => notSolid(x, y) && !danger.has(key(x, y));
    let path = bfs(cur, (c) => basicPowerupAt(c.x, c.y), passable);
    if (!path) path = bfs(cur, (c) => adjacentToSoft(c.x, c.y), passable);
    if (!path) {
      const en = visibleEnemies(p);
      path = bfs(cur, (c) => en.some((e) => { const ec = centerCell(e); return ec.x === c.x && ec.y === c.y; }), passable);
    }
    if (path && path.length > 1) p.targetCell = path[1];
  }

  function steerBot(p, dt) {
    const tx = center(p.targetCell.x), ty = center(p.targetCell.y);
    const dx = tx - p.px, dy = ty - p.py;
    let dir = null;
    if (Math.abs(dx) > Math.abs(dy)) { if (Math.abs(dx) > 0.5) dir = dx > 0 ? 'right' : 'left'; }
    else if (Math.abs(dy) > 0.5) dir = dy > 0 ? 'down' : 'up';
    if (dir) { p.dir = dir; moveDir(p, dir, p.speed * TILE * dt); }
    if (Math.abs(tx - p.px) < 2 && Math.abs(ty - p.py) < 2) { p.px = tx; p.py = ty; p.targetCell = null; }
  }

  function botThink(p, dt, danger) {
    const cur = centerCell(p);
    const targetBad = p.targetCell && (grid[p.targetCell.y][p.targetCell.x] !== EMPTY || bombAt(p.targetCell.x, p.targetCell.y));
    if (!p.targetCell || danger.has(key(cur.x, cur.y)) || targetBad) botDecide(p, cur, danger);
    if (p.targetCell) { steerBot(p, dt); p.moving = true; } else p.moving = false;
  }

  function respawnPlayer(p) {
    const safe = [];
    for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
      if (grid[y][x] === EMPTY && !bombAt(x, y) && !flameAt(x, y) && !occupiedByPlayer(x, y)) safe.push({ x, y });
    }
    if (!safe.length) { p.respawnTimer = 0.4; return; }
    let best = safe[0], bd = -1;
    for (const c of safe) {
      let md = Infinity;
      for (const q of players) if (q.alive) {
        const qc = centerCell(q);
        md = Math.min(md, Math.abs(qc.x - c.x) + Math.abs(qc.y - c.y));
      }
      if (md === Infinity) md = 999;
      if (md > bd) { bd = md; best = c; }
    }
    p.px = center(best.x); p.py = center(best.y);
    p.alive = true; p.moving = false; p.targetCell = null; p.bombsActive = 0;
    p.maxBombs = 1; p.range = 2; p.respawnTimer = 0; p.invuln = RESPAWN_INVULN;
  }

  function endGame() {
    gameOver = true;
    running = false;
  }

  function update(dt) {
    if (!running || gameOver) return;
    dt = Math.max(0, Math.min(0.05, dt || 0));
    elapsed += dt;
    tick++;

    for (const f of flames) {
      if (f.delay > 0) { f.delay -= dt; continue; }
      f.life -= dt;
      if (f.life <= 0 && f.destroysBlock && grid[f.gy][f.gx] === SOFT) { grid[f.gy][f.gx] = EMPTY; maybeSpawnPowerup(f.gx, f.gy); }
    }
    flames = flames.filter((f) => f.delay > 0 || f.life > 0);
    for (const b of bombs) b.fuse -= dt;
    let pending = bombs.filter((b) => b.fuse <= 0 && !b.done);
    while (pending.length) {
      for (const b of pending) if (!b.done) detonate(b);
      pending = bombs.filter((b) => b.fuse <= 0 && !b.done);
    }
    bombs = bombs.filter((b) => !b.done);
    for (const b of bombs) if (b.pass) for (const id of [...b.pass]) {
      const e = players.find((p) => p.id === id);
      if (!e || !e.alive || !overlapTile(e, b.gx, b.gy)) b.pass.delete(id);
    }
    for (const L of lights) L.t -= dt;
    lights = lights.filter((L) => L.t > 0 && L.owner.alive);
    if (!sudden && running && !anySoft()) startSudden();
    if (sudden) {
      suddenTimer -= dt;
      if (suddenTimer <= 0) {
        while (spiralIdx < spiralOrder.length && grid[spiralOrder[spiralIdx][1]][spiralOrder[spiralIdx][0]] === HARD) spiralIdx++;
        if (spiralIdx < spiralOrder.length) {
          const [x, y] = spiralOrder[spiralIdx];
          if (occupiedByPlayer(x, y)) { if (!bombAt(x, y)) plantSuddenBomb(x, y); suddenTimer = 0.3; }
          else if (bombAt(x, y)) suddenTimer = 0.2;
          else { fillRock(x, y); spiralIdx++; suddenTimer = SUDDEN_INTERVAL; }
        }
      }
    }
    for (const r of rockFx) r.t -= dt;
    rockFx = rockFx.filter((r) => r.t > 0);
    if (suddenBanner > 0) suddenBanner -= dt;
    for (const p of players) {
      if (p.shieldTimer > 0) p.shieldTimer = Math.max(0, p.shieldTimer - dt);
      if (p.phaseTimer > 0) p.phaseTimer = Math.max(0, p.phaseTimer - dt);
      if (p.invisTimer > 0) p.invisTimer = Math.max(0, p.invisTimer - dt);
      if (p.speedTimer > 0) p.speedTimer = Math.max(0, p.speedTimer - dt);
    }

    const danger = buildDanger();
    for (const p of players) {
      if (!p.alive) continue;
      if (p.isBot) botThink(p, dt, danger);
      else {
        const dirs = humanDirs[p.id] || [];
        const dir = dirs[dirs.length - 1];
        if (dir) { p.dir = dir; const mult = p.speedTimer > 0 ? SPEEDBOOST_MULT : 1; moveDir(p, dir, p.speed * mult * TILE * dt); p.moving = true; }
        else p.moving = false;
      }
      if (p.moving) p.anim += dt;
    }

    for (let hi = 0; hi < 2; hi++) {
      const p = players[hi]; if (!p) continue;
      const ab = p.abilities || {};
      if (req.bomb[hi]) { req.bomb[hi] = false; if (p.alive) { const c = centerCell(p); placeBomb(p, c.x, c.y); } }
      if (req.shield[hi]) { req.shield[hi] = false; if (p.alive && p.shieldTimer <= 0 && ab.shield > 0) { p.shieldTimer = SHIELD_TIME; ab.shield--; } }
      if (req.haamu[hi]) { req.haamu[hi] = false; if (p.alive && p.phaseTimer <= 0 && ab.haamu > 0) { p.phaseTimer = PHASE_TIME; ab.haamu--; } }
      if (req.invis[hi]) { req.invis[hi] = false; if (p.alive && p.invisTimer <= 0 && ab.invis > 0) { p.invisTimer = INVIS_TIME; ab.invis--; } }
      if (req.speed[hi]) { req.speed[hi] = false; if (p.alive && p.speedTimer <= 0 && ab.speed > 0) { p.speedTimer = SPEEDBOOST_TIME; ab.speed--; } }
      if (req.light[hi]) { req.light[hi] = false; if (p.alive && ab.light > 0) { const c = centerCell(p); if (plantSpecial(p, c.x, c.y, 'light', LIGHT_FUSE)) ab.light--; } }
      if (req.atomic[hi]) { req.atomic[hi] = false; if (p.alive && ab.atomic > 0) { const c = centerCell(p); if (plantSpecial(p, c.x, c.y, 'atomic', ATOMIC_FUSE)) ab.atomic--; } }
      if (req.laser[hi]) { req.laser[hi] = false; if (p.alive && ab.laser > 0) { const c = centerCell(p); if (plantSpecial(p, c.x, c.y, 'laser', LASER_FUSE)) ab.laser--; } }
      if (req.timebomb[hi]) { req.timebomb[hi] = false; if (p.alive && ab.timebomb > 0) { const c = centerCell(p); if (plantSpecial(p, c.x, c.y, 'timebomb', TIMEBOMB_FUSE)) ab.timebomb--; } }
    }

    for (const p of players) {
      if (!p.alive) continue;
      const c = centerCell(p), kk = key(c.x, c.y), t = powerups[kk];
      if (!t) continue;
      delete powerups[kk];
      if (t === 'fire' && p.range < RANGE_CAP) p.range++;
      else if (t === 'bomb' && p.maxBombs < BOMB_CAP) p.maxBombs++;
    }
    for (const p of players) {
      if (!p.alive || p.invuln > 0 || p.shieldTimer > 0) continue;
      const c = centerCell(p);
      const f = flames.find((ff) => ff.gx === c.x && ff.gy === c.y && ff.delay <= 0 && ff.life > 0);
      if (f) {
        p.alive = false; p.moving = false; p.deaths++;
        if (f.owner && f.owner !== p) f.owner.kills++;
        if (!sudden) p.respawnTimer = RESPAWN_DELAY;
      }
    }
    for (const p of players) {
      if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);
      if (!p.alive && p.respawnTimer > 0) { p.respawnTimer -= dt; if (p.respawnTimer <= 0) respawnPlayer(p); }
    }
    if (players.filter((p) => p.alive || p.respawnTimer > 0).length <= 1) endGame();
    if (shake > 0.1) shake *= 0.86; else shake = 0;
  }

  buildBoard();

  return {
    update,
    setInput,
    snapshot: buildSnapshot,
    get gameOver() { return gameOver; },
  };
}

module.exports = { createGame };

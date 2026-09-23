'use strict';

/* =========================================================================
   PAMBU — Neon Snake
   -------------------------------------------------------------------------
   Part 1 : pure game logic  (runs in Node for tests, and in the browser)
   Part 2 : browser layer    (canvas rendering, input, audio) — only loaded
                              when `window` exists.
   ========================================================================= */

/* ========================== PART 1 : LOGIC ============================== */

const COLS = 21;
const ROWS = 21;

const START_SPEED_MS = 150; // ms per tick at level 1
const MIN_SPEED_MS = 65; // fastest the game will ever run
const SPEED_STEP_MS = 7; // how much faster each level-up makes it
const FOODS_PER_LEVEL = 4; // eat this many to level up
const POINTS_PER_FOOD = 10;

const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** Cells that are not occupied by the snake, in row-major order. */
function freeCells(game) {
  const taken = new Set(game.snake.map((c) => c.x + ',' + c.y));
  const out = [];
  for (let y = 0; y < game.rows; y++) {
    for (let x = 0; x < game.cols; x++) {
      if (!taken.has(x + ',' + y)) out.push({ x, y });
    }
  }
  return out;
}

/** Place food on a uniformly-random free cell. Returns the cell, or null if the
 *  board is completely full (snake has won). */
function spawnFood(game) {
  const free = freeCells(game);
  if (free.length === 0) {
    game.food = null;
    game.status = 'won';
    return null;
  }
  // Clamp so a rand() of exactly 1.0 can never index past the end.
  const idx = Math.min(Math.floor(game.rand() * free.length), free.length - 1);
  game.food = free[idx];
  return game.food;
}

function createGame(rand) {
  const rng = typeof rand === 'function' ? rand : Math.random;
  const midY = Math.floor(ROWS / 2);
  const game = {
    cols: COLS,
    rows: ROWS,
    // head first
    snake: [
      { x: 5, y: midY },
      { x: 4, y: midY },
      { x: 3, y: midY },
    ],
    dir: 'right',
    pendingDir: 'right',
    food: null,
    score: 0,
    foods: 0,
    speed: START_SPEED_MS,
    status: 'ready', // ready | running | paused | over | won
    ticks: 0,
    rand: rng,
  };
  spawnFood(game);
  return game;
}

function levelOf(game) {
  return Math.floor(game.foods / FOODS_PER_LEVEL) + 1;
}

/** Queue a direction change. Reversing into your own neck is rejected so a
 *  single stray keypress can never instantly kill a run. */
function turn(game, dir) {
  if (!DIRS[dir]) return false;
  if (game.snake.length > 1 && OPPOSITE[dir] === game.dir) return false;
  game.pendingDir = dir;
  return true;
}

function start(game) {
  if (game.status === 'over' || game.status === 'won') return false;
  game.status = 'running';
  return true;
}

function pause(game) {
  if (game.status !== 'running') return false;
  game.status = 'paused';
  return true;
}

function resume(game) {
  if (game.status !== 'paused') return false;
  game.status = 'running';
  return true;
}

/** Advance the simulation by one cell. Safe to call in any status — it simply
 *  no-ops unless the game is running. */
function tick(game) {
  if (game.status !== 'running') {
    return { moved: false, ate: false, died: false };
  }

  game.dir = game.pendingDir;
  game.ticks += 1;

  const d = DIRS[game.dir];
  const head = game.snake[0];
  const nx = head.x + d.x;
  const ny = head.y + d.y;

  // Wall = death.
  if (nx < 0 || ny < 0 || nx >= game.cols || ny >= game.rows) {
    game.status = 'over';
    return { moved: false, ate: false, died: true };
  }

  const ate = !!game.food && nx === game.food.x && ny === game.food.y;

  // The tail cell is vacated this same tick, so running into it is legal
  // (unless we grow, in which case it stays put and kills us).
  const body = ate ? game.snake : game.snake.slice(0, -1);
  if (body.some((c) => c.x === nx && c.y === ny)) {
    game.status = 'over';
    return { moved: false, ate: false, died: true };
  }

  game.snake.unshift({ x: nx, y: ny });

  if (ate) {
    game.score += POINTS_PER_FOOD;
    game.foods += 1;
    game.speed = Math.max(
      MIN_SPEED_MS,
      START_SPEED_MS - (levelOf(game) - 1) * SPEED_STEP_MS,
    );
    spawnFood(game);
  } else {
    game.snake.pop();
  }

  return { moved: true, ate, died: false };
}

const logic = {
  COLS,
  ROWS,
  START_SPEED_MS,
  MIN_SPEED_MS,
  SPEED_STEP_MS,
  FOODS_PER_LEVEL,
  POINTS_PER_FOOD,
  DIRS,
  OPPOSITE,
  freeCells,
  spawnFood,
  createGame,
  levelOf,
  turn,
  start,
  pause,
  resume,
  tick,
};

/* Node (tests) */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = logic;
}

/* ======================== PART 2 : BROWSER ============================== */

if (typeof window !== 'undefined') {
  const L = logic;

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');

  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const levelEl = document.getElementById('level');
  const lengthEl = document.getElementById('length');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayBody = document.getElementById('overlay-body');
  const overlayHint = document.getElementById('overlay-hint');
  const soundBtn = document.getElementById('sound-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const stage = document.getElementById('stage');

  const BEST_KEY = 'pambu.best';

  /* Safari private mode throws on localStorage access. The game must survive
     that — a lost high score is fine, a crashed gameOver() is not. */
  const store = {
    get(k, fallback) {
      try {
        const v = localStorage.getItem(k);
        return v === null || v === undefined ? fallback : v;
      } catch (_) {
        return fallback;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, String(v));
      } catch (_) {
        /* storage unavailable — carry on in-memory */
      }
    },
  };

  let game = L.createGame();
  let best = Number(store.get(BEST_KEY, 0)) || 0;
  let muted = store.get('pambu.muted', '0') === '1';
  let lastTick = 0;
  let particles = [];
  let shake = 0;
  let cell = 0;

  /* --------------------------- audio ---------------------------------- */
  let audioCtx = null;

  /**
   * iOS/Android start an AudioContext suspended and only let it resume inside
   * a user gesture. Call this from every gesture handler so sound actually
   * works on phones, not just on desktop.
   */
  function unlockAudio() {
    if (muted) return;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      audioCtx = audioCtx || new Ctor();
      if (audioCtx.state === 'suspended' && audioCtx.resume) {
        const p = audioCtx.resume();
        if (p && p.catch) p.catch(() => {});
      }
    } catch (_) {
      /* audio is a nicety, never a failure */
    }
  }

  function beep(freq, dur, type, gain) {
    if (muted) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type || 'square';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(gain || 0.05, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      osc.connect(g).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + dur);
    } catch (_) {
      /* audio is a nicety, never a failure */
    }
  }

  const sfx = {
    eat: () => {
      beep(660, 0.07, 'square', 0.05);
      setTimeout(() => beep(990, 0.08, 'square', 0.04), 55);
    },
    die: () => {
      beep(220, 0.18, 'sawtooth', 0.06);
      setTimeout(() => beep(110, 0.3, 'sawtooth', 0.05), 120);
    },
    turn: () => beep(420, 0.03, 'triangle', 0.02),
    level: () => {
      beep(523, 0.08, 'triangle', 0.05);
      setTimeout(() => beep(784, 0.12, 'triangle', 0.05), 90);
    },
  };

  /* --------------------------- sizing --------------------------------- */
  function resize() {
    const wrap = canvas.parentElement;
    const size = Math.min(wrap.clientWidth, wrap.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cell = size / game.cols;
  }

  /* -------------------------- particles -------------------------------- */
  function burst(cx, cy, color) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.6 + Math.random() * 2.4;
      particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        color,
      });
    }
  }

  /* --------------------------- rendering ------------------------------- */
  function drawBoard() {
    const w = cell * game.cols;
    ctx.clearRect(0, 0, w, w);

    ctx.fillStyle = '#07070f';
    ctx.fillRect(0, 0, w, w);

    ctx.strokeStyle = 'rgba(0,229,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 1; i < game.cols; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cell, 0);
      ctx.lineTo(i * cell, w);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * cell);
      ctx.lineTo(w, i * cell);
      ctx.stroke();
    }
  }

  function drawFood(t) {
    if (!game.food) return;
    const pulse = 1 + Math.sin(t / 180) * 0.12;
    const cx = (game.food.x + 0.5) * cell;
    const cy = (game.food.y + 0.5) * cell;
    const r = (cell * 0.32) * pulse;

    ctx.save();
    ctx.shadowColor = '#ff2d95';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#ff2d95';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSnake(t) {
    const n = game.snake.length;
    for (let i = n - 1; i >= 0; i--) {
      const seg = game.snake[i];
      const p = n === 1 ? 0 : i / (n - 1);
      const pad = cell * (0.06 + p * 0.1);
      const x = seg.x * cell + pad;
      const y = seg.y * cell + pad;
      const s = cell - pad * 2;

      const isHead = i === 0;
      const hue = 175 - p * 45;
      ctx.save();
      ctx.shadowColor = 'hsl(' + hue + ',100%,60%)';
      ctx.shadowBlur = isHead ? 22 : 12 - p * 8;
      ctx.fillStyle = isHead
        ? '#7dfff0'
        : 'hsl(' + hue + ',95%,' + (58 - p * 22) + '%)';
      roundRect(x, y, s, s, cell * 0.3);
      ctx.fill();
      ctx.restore();

      if (isHead) drawEyes(seg, s);
    }
  }

  function drawEyes(head, s) {
    const d = L.DIRS[game.dir];
    const cx = head.x * cell + cell / 2;
    const cy = head.y * cell + cell / 2;
    // eyes sit perpendicular to travel direction, nudged forward
    const px = d.y, py = d.x;
    const off = cell * 0.17;
    const fwd = cell * 0.15;
    const r = cell * 0.085;
    ctx.fillStyle = '#06121a';
    [[1, -1], [-1, 1]].forEach(([a, b]) => {
      ctx.beginPath();
      ctx.arc(
        cx + px * off * a + d.x * fwd,
        cy + py * off * b + d.y * fwd,
        r,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    });
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawParticles() {
    particles = particles.filter((p) => p.life > 0);
    particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.life -= 0.035;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, cell * 0.09 * p.life + 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  /* ----------------------------- HUD ----------------------------------- */
  function syncHud() {
    scoreEl.textContent = game.score;
    bestEl.textContent = Math.max(best, game.score);
    levelEl.textContent = L.levelOf(game);
    lengthEl.textContent = game.snake.length;
    soundBtn.textContent = muted ? '🔇' : '🔊';
    soundBtn.setAttribute('aria-pressed', String(!muted));
    pauseBtn.textContent = game.status === 'paused' ? '▶' : '⏸';
  }

  function showOverlay(title, body, hint) {
    overlayTitle.textContent = title;
    overlayBody.textContent = body;
    overlayHint.textContent = hint;
    overlay.hidden = false;
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  /* --------------------------- game flow -------------------------------- */
  function reset() {
    game = L.createGame();
    particles = [];
    shake = 0;
    lastTick = performance.now();
    syncHud();
    showOverlay('பாம்பு', 'Neon Snake — food ah thinnu, wall la mottaama.', 'SPACE / TAP to start');
  }

  function begin() {
    L.start(game);
    lastTick = performance.now();
    hideOverlay();
    syncHud();
  }

  /** Space / tap-to-play: start a fresh run, restarting if the last one ended. */
  function startOrRestart() {
    if (game.status === 'over' || game.status === 'won') reset();
    begin();
  }

  /** Pause <-> resume, keeping the overlay and the pause button in sync. */
  function togglePauseUI(hint) {
    if (game.status === 'ready') { begin(); return; }
    if (game.status === 'over' || game.status === 'won') return;

    if (game.status === 'running') {
      L.pause(game);
      showOverlay('⏸ Paused', 'Score ' + game.score, hint || 'SPACE to resume');
    } else {
      L.resume(game);
      lastTick = performance.now();
      hideOverlay();
    }
    syncHud();
  }

  function gameOver() {
    shake = 14;
    sfx.die();
    const head = game.snake[0];
    burst((head.x + 0.5) * cell, (head.y + 0.5) * cell, '#ff2d95');
    if (game.score > best) {
      best = game.score;
      store.set(BEST_KEY, best);
    }
    syncHud();
    const won = game.status === 'won';
    showOverlay(
      won ? '🏆 Board Full!' : '💀 Game Over',
      'Score ' + game.score + '  ·  Length ' + game.snake.length + '  ·  Best ' + best,
      'SPACE / TAP to play again',
    );
  }

  /* ----------------------------- loop ---------------------------------- */
  function frame(now) {
    requestAnimationFrame(frame);

    if (game.status === 'running' && now - lastTick >= game.speed) {
      const before = L.levelOf(game);
      const res = L.tick(game);
      lastTick = now;
      syncHud();

      if (res.died) {
        gameOver();
      } else if (res.ate) {
        sfx.eat();
        burst((game.snake[0].x + 0.5) * cell, (game.snake[0].y + 0.5) * cell, '#7dfff0');
        if (L.levelOf(game) > before) sfx.level();
      }
      if (game.status === 'won') gameOver();
    }

    if (shake > 0) {
      shake *= 0.86;
      const jx = (Math.random() - 0.5) * shake;
      const jy = (Math.random() - 0.5) * shake;
      canvas.style.transform = 'translate(' + jx + 'px,' + jy + 'px)';
    } else {
      canvas.style.transform = '';
    }

    drawBoard();
    drawFood(now);
    drawSnake(now);
    drawParticles();
  }

  /* ---------------------------- input ---------------------------------- */
  const KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    W: 'up', S: 'down', A: 'left', D: 'right',
  };

  function press(dir) {
    if (game.status === 'ready') begin();
    if (game.status !== 'running') return;
    if (L.turn(game, dir)) sfx.turn();
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      unlockAudio();
      if (game.status === 'ready' || game.status === 'over' || game.status === 'won') {
        startOrRestart();
      } else {
        togglePauseUI();
      }
      return;
    }
    if (e.key === 'r' || e.key === 'R') { unlockAudio(); reset(); begin(); return; }
    if (e.key === 'm' || e.key === 'M') { toggleSound(); return; }

    const dir = KEYMAP[e.key];
    if (dir) {
      e.preventDefault();
      unlockAudio();
      press(dir);
    }
  });

  /* ------------------------ touch: D-pad ------------------------------- */
  document.querySelectorAll('[data-dir]').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      unlockAudio();
      press(btn.dataset.dir);
    });
    // long-press must not open the iOS copy/callout menu
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  /* ------------------------ touch: swipe ------------------------------- *
   * Listeners sit on the whole stage, not just the canvas, so the swipe
   * target is as large as possible on a phone.
   *
   * A short swipe is deliberately NOT a pause gesture: sub-threshold
   * flicks are common on touchscreens and pausing a live run by accident
   * is worse than ignoring the input. Use the ⏸ button to pause.        */
  const SWIPE_PX = 24;
  let touchStart = null;

  stage.addEventListener('touchstart', (e) => {
    unlockAudio();
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });

  stage.addEventListener('touchend', (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    touchStart = null;

    if (Math.abs(dx) < SWIPE_PX && Math.abs(dy) < SWIPE_PX) {
      if (game.status === 'ready' || game.status === 'over' || game.status === 'won') {
        if (game.status !== 'ready') reset();
        begin();
      }
      return; // running or paused: a tap does nothing
    }
    press(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  }, { passive: true });

  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  /* --------------------------- buttons --------------------------------- */
  overlay.addEventListener('click', () => {
    unlockAudio();
    if (game.status === 'paused') { togglePauseUI(); return; }
    startOrRestart();
  });

  pauseBtn.addEventListener('click', () => {
    unlockAudio();
    togglePauseUI('TAP ▶ to resume');
  });

  function toggleSound() {
    muted = !muted;
    store.set('pambu.muted', muted ? '1' : '0');
    syncHud();
    if (!muted) { unlockAudio(); sfx.turn(); }
  }
  soundBtn.addEventListener('click', toggleSound);

  /* Re-measure whenever the stage box changes. On phones that happens on
     rotation AND whenever the browser URL bar collapses/expands, which a
     plain window resize listener does not always catch. */
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 60));
  if (window.ResizeObserver) {
    new window.ResizeObserver(resize).observe(stage);
  }

  /* Console handle — handy for poking at the game in devtools, and used by
     the browser smoke test in test/browser.smoke.test.js. */
  window.PAMBU = {
    logic: L,
    get state() { return game; },
    reset,
    begin,
  };

  /* ----------------------------- boot ---------------------------------- */
  resize();
  reset();
  requestAnimationFrame(frame);
}

'use strict';

/**
 * Minimal DOM stub for loading game.js outside a browser.
 *
 * Node's test runner gives each test FILE its own process, so each suite can
 * install a differently-configured stub (throwing localStorage, a working
 * AudioContext, ...) without leaking into the others.
 */

const path = require('node:path');

const GAME_PATH = path.join(__dirname, '..', '..', 'pambu', 'game.js');

function installDom(options) {
  const opts = options || {};

  /* -------------------------- canvas 2d stub -------------------------- */
  const ctxLog = [];
  const ctx = {
    __log: ctxLog,
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    shadowColor: '', shadowBlur: 0, globalAlpha: 1, font: '', textAlign: '',
  };
  for (const m of [
    'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath',
    'moveTo', 'lineTo', 'stroke', 'fill', 'arc', 'arcTo',
    'save', 'restore', 'setTransform', 'translate', 'scale', 'drawImage',
  ]) {
    ctx[m] = () => ctxLog.push(m);
  }

  /* ---------------------------- elements ------------------------------ */
  const elements = {};
  function el(id) {
    return {
      id,
      textContent: '',
      hidden: false,
      style: {},
      dataset: {},
      listeners: {},
      addEventListener(type, fn) {
        (this.listeners[type] || (this.listeners[type] = [])).push(fn);
      },
      setAttribute(k, v) { this['attr:' + k] = v; },
      getAttribute(k) { return this['attr:' + k]; },
      getContext: () => ctx,
      parentElement: { clientWidth: 600, clientHeight: 600 },
      clientWidth: 600,
      clientHeight: 600,
    };
  }

  const windowListeners = {};

  /* --------------------------- localStorage --------------------------- */
  const store = {};
  let storageOps = 0;
  const localStorageStub = opts.localStorageThrows
    ? {
        getItem() { storageOps++; throw new Error('SecurityError: storage disabled'); },
        setItem() { storageOps++; throw new Error('QuotaExceededError: storage full'); },
      }
    : {
        getItem: (k) => { storageOps++; return k in store ? store[k] : null; },
        setItem: (k, v) => { storageOps++; store[k] = String(v); },
      };

  /* --------------------------- AudioContext --------------------------- */
  let audioResumeCalls = 0;
  let audioCtorCalls = 0;
  const audioContexts = [];
  class StubAudioContext {
    constructor() {
      audioCtorCalls++;
      this.state = 'suspended'; // exactly how iOS starts it
      this.currentTime = 0;
      this.destination = {};
      audioContexts.push(this);
    }
    resume() {
      audioResumeCalls++;
      this.state = 'running';
      return Promise.resolve();
    }
    createOscillator() {
      return {
        type: '', frequency: { value: 0 },
        connect(target) { return target; }, start() {}, stop() {},
      };
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect(target) { return target; },
      };
    }
  }

  /* ------------------------------ window ------------------------------ */
  globalThis.window = {
    devicePixelRatio: 1,
    addEventListener(type, fn) {
      (windowListeners[type] || (windowListeners[type] = [])).push(fn);
    },
    AudioContext: opts.audioContext ? StubAudioContext : undefined,
    webkitAudioContext: undefined,
  };

  globalThis.document = {
    getElementById: (id) => elements[id] || (elements[id] = el(id)),
    querySelectorAll: (sel) =>
      sel === '[data-dir]'
        ? ['up', 'left', 'down', 'right'].map((d) => {
            const b = el('btn-' + d);
            b.dataset.dir = d;
            elements['btn-' + d] = b;
            return b;
          })
        : [],
  };

  globalThis.localStorage = localStorageStub;

  /* --------------------------- frame clock ---------------------------- */
  const rafQueue = [];
  globalThis.requestAnimationFrame = (fn) => {
    rafQueue.push(fn);
    return rafQueue.length;
  };

  // Start safely ahead of game.js's own performance.now() baseline so every
  // frame is guaranteed to be past the tick threshold.
  let clock = performance.now() + 5000;

  /* ---------------------------- test helpers -------------------------- */
  return {
    elements,
    windowListeners,
    store,
    ctxLog,

    loadGame() {
      delete require.cache[require.resolve(GAME_PATH)];
      require(GAME_PATH);
      return globalThis.window.PAMBU;
    },

    /** Run n animation frames, advancing the virtual clock one tick each. */
    frames(n, dt) {
      const step = dt === undefined ? 200 : dt;
      for (let i = 0; i < n; i++) {
        const fn = rafQueue.shift();
        if (!fn) throw new Error('frame did not re-register with requestAnimationFrame');
        clock += step;
        fn(clock);
      }
      return clock;
    },

    key(k, code) {
      (windowListeners.keydown || []).forEach((fn) =>
        fn({ key: k, code: code || '', preventDefault() {} }),
      );
    },

    click(id) {
      const node = elements[id];
      if (!node) throw new Error('no such element: ' + id);
      (node.listeners.click || []).forEach((fn) => fn({}));
    },

    pointerDown(id) {
      const node = elements[id];
      if (!node) throw new Error('no such element: ' + id);
      (node.listeners.pointerdown || []).forEach((fn) => fn({ preventDefault() {} }));
    },

    swipe(from, to) {
      const node = elements.stage;
      if (!node) throw new Error('stage element was never looked up');
      // game.js reads clientX/clientY off the Touch objects, so the stub has
      // to supply exactly that shape or the deltas come out NaN.
      const touch = (p) => ({ clientX: p.x, clientY: p.y });
      (node.listeners.touchstart || []).forEach((fn) => fn({ touches: [touch(from)] }));
      (node.listeners.touchend || []).forEach((fn) => fn({ changedTouches: [touch(to)] }));
    },

    tap(at) { this.swipe(at, at); },

    audioContexts,
    get audioResumeCalls() { return audioResumeCalls; },
    get audioCtorCalls() { return audioCtorCalls; },
    get storageOps() { return storageOps; },
  };
}

module.exports = { installDom };

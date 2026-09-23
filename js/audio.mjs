/**
 * FIRE ZONE — audio.
 *
 * Everything is synthesised with the WebAudio API: no audio files, so the
 * whole game stays a handful of text files. The engine is a pair of detuned
 * sawtooths through a lowpass, pitched by revs; guns and blasts are shaped
 * noise bursts.
 */

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;

  // engine graph
  let engOscA = null, engOscB = null, engFilter = null, engGain = null;
  let windGain = null;
  let noiseBuf = null;

  function makeNoise() {
    const len = Math.floor(ctx.sampleRate * 1.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Must be called from a user gesture on iOS/Android. */
  function unlock() {
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return false;
      if (!ctx) {
        ctx = new Ctor();
        master = ctx.createGain();
        master.gain.value = 0.55;
        master.connect(ctx.destination);
        noiseBuf = makeNoise();
        buildEngine();
        buildWind();
      }
      if (ctx.state === 'suspended' && ctx.resume) {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function buildEngine() {
    engFilter = ctx.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 700;
    engFilter.Q.value = 6;

    engGain = ctx.createGain();
    engGain.gain.value = 0;

    engOscA = ctx.createOscillator();
    engOscA.type = 'sawtooth';
    engOscB = ctx.createOscillator();
    engOscB.type = 'square';
    engOscB.detune.value = -12;

    engOscA.connect(engFilter);
    engOscB.connect(engFilter);
    engFilter.connect(engGain);
    engGain.connect(master);
    engOscA.start();
    engOscB.start();
  }

  function buildWind() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 500;
    f.Q.value = 0.7;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    src.connect(f);
    f.connect(windGain);
    windGain.connect(master);
    src.start();
  }

  /** Called every frame with normalised revs 0..1 and speed 0..1. */
  function engine(revs, speedNorm, throttle) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const hz = 42 + revs * 190;
    engOscA.frequency.setTargetAtTime(hz, t, 0.05);
    engOscB.frequency.setTargetAtTime(hz * 0.5, t, 0.05);
    engFilter.frequency.setTargetAtTime(420 + revs * 2100, t, 0.08);
    const g = 0.045 + revs * 0.075 + (throttle > 0 ? 0.03 : 0);
    engGain.gain.setTargetAtTime(g, t, 0.08);
    windGain.gain.setTargetAtTime(speedNorm * 0.05, t, 0.2);
  }

  function noiseBurst(dur, freq, q, gain, type = 'lowpass') {
    if (!ctx || muted) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone(freq, dur, type, gain, slideTo) {
    if (!ctx || muted) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  return {
    unlock,
    engine,
    shot() {
      noiseBurst(0.13, 1900, 0.8, 0.30, 'highpass');
      tone(180, 0.09, 'square', 0.14, 60);
    },
    enemyShot(dist) {
      const v = Math.max(0.04, 1 - dist / 70);
      noiseBurst(0.11, 1300, 0.9, 0.16 * v, 'highpass');
    },
    explosion(power = 1) {
      noiseBurst(0.85, 220, 0.5, 0.5 * power, 'lowpass');
      tone(90, 0.6, 'sine', 0.32 * power, 28);
      noiseBurst(0.3, 3000, 0.6, 0.16 * power, 'highpass');
    },
    hit() { tone(1400, 0.05, 'square', 0.10); },
    headshot() { tone(2100, 0.08, 'square', 0.13, 1200); },
    hurt() { tone(150, 0.2, 'sawtooth', 0.16, 70); },
    pickup() { tone(660, 0.1, 'triangle', 0.12, 990); },
    reload() {
      tone(420, 0.05, 'square', 0.08);
      setTimeout(() => tone(300, 0.06, 'square', 0.08), 140);
      setTimeout(() => tone(620, 0.05, 'square', 0.09), 900);
    },
    ui() { tone(880, 0.04, 'triangle', 0.07); },
    win() {
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.14), i * 130));
    },
    lose() {
      [392, 330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'sawtooth', 0.13), i * 160));
    },
    setMuted(m) {
      muted = m;
      if (master) master.gain.value = m ? 0 : 0.55;
    },
    get muted() { return muted; },
    get ready() { return !!ctx; },
  };
}

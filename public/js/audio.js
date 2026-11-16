// CABO audio: a small synth engine for a "felt card table" sound world.
//
//  • Effects are built from filtered noise (paper slides, flicks, felt thumps)
//    and soft mallets / bells tuned to D major pentatonic, so every cue sits
//    in the same key as the music and nothing clashes.
//  • Music ("Felt & Lamplight") is generated live: a warm pad, a soft bass and
//    a sparse electric-piano melody that wanders but never repeats exactly.
//    Quiet by design; it dips under important effects and pauses when the
//    tab is hidden.
//  • No audio files: everything is synthesized with the Web Audio API.
//
// Settings: sound (effects on), sfxVol, music (on), musicVol — all persisted.

const Sound = (() => {
  if (Settings.get('music') === undefined) Settings.set('music', true);
  if (Settings.get('musicVol') === undefined) Settings.set('musicVol', 0.5);
  if (Settings.get('sfxVol') === undefined) Settings.set('sfxVol', 0.8);

  let ac = null, master, sfxBus, musicBus, musicDuck, musicTone, verb, noiseBuf;
  let unlocked = false;

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  // perceptual volume curve
  const vcurve = (v) => Math.max(0, Math.min(1, v)) ** 2;

  function init() {
    if (ac) return ac;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ac = new AC({ latencyHint: 'interactive' }); } catch (e) { return null; }
    master = ac.createGain(); master.gain.value = 1.7;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.25;
    master.connect(comp); comp.connect(ac.destination);

    // shared room reverb (generated impulse: soft, darkish, ~2.6s)
    verb = ac.createConvolver();
    verb.buffer = makeIR(2.6);
    const verbOut = ac.createGain(); verbOut.gain.value = 0.9;
    verb.connect(verbOut); verbOut.connect(master);

    sfxBus = ac.createGain(); sfxBus.gain.value = vcurve(Settings.get('sfxVol'));
    sfxBus.connect(master);
    const sfxSend = ac.createGain(); sfxSend.gain.value = 0.16;
    sfxBus.connect(sfxSend); sfxSend.connect(verb);

    musicBus = ac.createGain(); musicBus.gain.value = 0;
    musicDuck = ac.createGain(); musicDuck.gain.value = 1;
    musicTone = ac.createBiquadFilter(); musicTone.type = 'lowpass'; musicTone.frequency.value = 3400; musicTone.Q.value = 0.3;
    musicBus.connect(musicDuck); musicDuck.connect(musicTone); musicTone.connect(master);
    const musicSend = ac.createGain(); musicSend.gain.value = 0.5;
    musicTone.connect(musicSend); musicSend.connect(verb);

    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ac;
  }

  function makeIR(sec) {
    const len = Math.floor(ac.sampleRate * sec);
    const buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // one-pole lowpass on the noise so the tail is warm, not hissy
        lp += (Math.random() * 2 - 1 - lp) * (0.55 - 0.4 * t);
        d[i] = lp * Math.pow(1 - t, 3.2) * (i < 80 ? i / 80 : 1);
      }
    }
    return buf;
  }

  // ── building blocks ──
  function envGain(t, attack, peak, decay, dest) {
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest);
    return g;
  }
  function panTo(p, dest) {
    if (!ac.createStereoPanner) return dest;
    const pn = ac.createStereoPanner(); pn.pan.value = p; pn.connect(dest); return pn;
  }
  // filtered noise burst — the "paper/felt" family
  function noise(t, o) {
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.f0, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + (o.attack || 0.005) + o.dur);
    f.Q.value = o.q == null ? 0.9 : o.q;
    const out = envGain(t, o.attack || 0.005, o.gain, o.dur, panTo(o.pan || 0, o.dest || sfxBus));
    src.connect(f); f.connect(out);
    const off = Math.random() * 1.5;
    src.start(t, off); src.stop(t + (o.attack || 0.005) + o.dur + 0.05);
  }
  function tone(f, t, o) {
    const osc = ac.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + (o.glide || o.dur));
    if (o.detune) osc.detune.value = o.detune;
    let dest = panTo(o.pan || 0, o.dest || sfxBus);
    if (o.lp) { const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.lp; lp.connect(dest); dest = lp; }
    const g = envGain(t, o.attack || 0.005, o.gain, o.dur, dest);
    osc.connect(g); osc.start(t); osc.stop(t + (o.attack || 0.005) + o.dur + 0.05);
  }
  // soft wooden mallet (marimba-ish: fundamental + a quick 4th partial + tiny click)
  function mallet(f, t, v, o = {}) {
    const dest = o.dest || sfxBus, pan = o.pan || 0;
    tone(f, t, { gain: v, attack: 0.003, dur: o.dur || 0.9, dest, pan });
    tone(f * 3.98, t, { gain: v * 0.16, attack: 0.002, dur: 0.18, dest, pan });
    tone(f * 2, t, { gain: v * 0.08, attack: 0.002, dur: 0.35, dest, pan, type: 'triangle' });
    noise(t, { type: 'highpass', f0: 3500, dur: 0.012, gain: v * 0.25, dest, pan });
  }
  // warm bell (inharmonic partials, long tail)
  function bell(f, t, v, o = {}) {
    const parts = [[1, 1, 3.4], [2, 0.42, 2.2], [2.76, 0.3, 1.6], [4.07, 0.16, 1.0], [5.43, 0.09, 0.6]];
    parts.forEach(([r, a, d]) => tone(f * r, t, { gain: v * a, attack: 0.004, dur: d, dest: o.dest || sfxBus, pan: o.pan || 0 }));
  }
  // electric piano (2-op FM), used by the music and a couple of cues
  function ep(f, t, v, o = {}) {
    const car = ac.createOscillator(), mod = ac.createOscillator(), mg = ac.createGain();
    car.frequency.value = f; mod.frequency.value = f * (o.ratio || 1);
    mg.gain.setValueAtTime(f * (o.index || 1.1), t);
    mg.gain.exponentialRampToValueAtTime(f * 0.08, t + 1.4);
    mod.connect(mg); mg.connect(car.frequency);
    const dur = o.dur || 2.8;
    const g = envGain(t, 0.012, v, dur, panTo(o.pan || 0, o.dest || sfxBus));
    car.connect(g);
    car.start(t); mod.start(t); car.stop(t + dur + 0.1); mod.stop(t + dur + 0.1);
  }
  // card bits
  function slide(t, v = 1, pan = 0) {
    const r = rnd(0.85, 1.2);
    noise(t, { f0: 1500 * r, f1: 4200 * r, q: 0.8, attack: 0.012, dur: 0.11, gain: 0.55 * v, pan });
    noise(t + 0.1, { type: 'highpass', f0: 5000, dur: 0.012, gain: 0.1 * v, pan });
  }
  function place(t, v = 1, pan = 0) {
    noise(t, { type: 'lowpass', f0: 1600, f1: 500, q: 0.7, attack: 0.003, dur: 0.07, gain: 0.5 * v, pan });
    tone(rnd(100, 125), t, { f1: 52, glide: 0.1, gain: 0.32 * v, attack: 0.003, dur: 0.12, pan });
  }
  function flick(t, v = 1, pan = 0) {
    noise(t, { type: 'highpass', f0: rnd(2600, 3200), dur: 0.025, gain: 0.3 * v, pan });
    noise(t + 0.018, { f0: 1300, q: 1.2, dur: 0.05, gain: 0.14 * v, pan });
  }
  function whoosh(t, f0, f1, dur, v) {
    noise(t, { f0, f1, q: 1.4, attack: dur * 0.45, dur: dur * 0.6, gain: v });
  }
  function duck(amount = 0.55, hold = 0.25, rel = 1.4) {
    if (!musicDuck) return;
    const t = ac.currentTime, g = musicDuck.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(amount, t + 0.05);
    g.setValueAtTime(amount, t + 0.05 + hold);
    g.linearRampToValueAtTime(1, t + 0.05 + hold + rel);
  }

  // D major pentatonic, by octave
  const N = { D4: 293.66, E4: 329.63, Fs4: 369.99, A4: 440, B4: 493.88, D5: 587.33, E5: 659.25, Fs5: 739.99, A5: 880, B5: 987.77, D6: 1174.66, E6: 1318.51, Fs6: 1479.98, A6: 1760, A3: 220, Fs3: 185, G3: 196, D3: 146.83 };

  const CUES = {
    tap(t) { tone(rnd(820, 900), t, { gain: 0.045, attack: 0.001, dur: 0.03 }); noise(t, { type: 'highpass', f0: 3200, dur: 0.008, gain: 0.05 }); },
    draw(t) { slide(t); },
    deal(t) { for (let i = 0; i < 8; i++) slide(t + i * 0.06, 0.75 - i * 0.04, i % 2 ? 0.35 : -0.35); },
    discard(t) { slide(t, 0.6); place(t + 0.09); },
    swap(t) { slide(t, 0.8, -0.45); slide(t + 0.08, 0.8, 0.45); place(t + 0.2, 0.8); },
    flip(t) { flick(t); },
    peek(t) { flick(t); mallet(N.A5, t + 0.06, 0.1, { pan: -0.2 }); mallet(N.E6, t + 0.15, 0.08, { pan: 0.2 }); },
    reveal(t) { flick(t); mallet(N.D6, t + 0.05, 0.11); mallet(N.Fs6, t + 0.13, 0.07); noise(t + 0.05, { type: 'highpass', f0: 6500, attack: 0.15, dur: 0.45, gain: 0.04 }); },
    match(t) { place(t, 0.8); [N.D5, N.Fs5, N.A5, N.D6].forEach((f, i) => mallet(f, t + 0.04 + i * 0.065, 0.17 - i * 0.02, { pan: -0.3 + i * 0.2 })); duck(0.6, 0.3); },
    wrong(t) { place(t, 0.7); mallet(N.G3, t + 0.03, 0.22, { dur: 0.5 }); mallet(N.Fs3, t + 0.16, 0.22, { dur: 0.6 }); },
    special(t) { whoosh(t, 280, 2600, 0.42, 0.22); mallet(N.A4, t + 0.24, 0.12, { pan: -0.25 }); mallet(N.E5, t + 0.24, 0.1, { pan: 0.25 }); ep(N.A5, t + 0.3, 0.05, { dur: 1.6 }); },
    skip(t) { whoosh(t, 2400, 500, 0.28, 0.2); mallet(N.B4, t + 0.12, 0.13); mallet(N.Fs4, t + 0.22, 0.12); },
    turn(t) { mallet(N.A4, t, 0.13, { pan: -0.15 }); mallet(N.D5, t + 0.11, 0.15, { pan: 0.15 }); },
    tick(t) { tone(1450, t, { f1: 950, glide: 0.04, gain: 0.11, attack: 0.001, dur: 0.05 }); noise(t, { f0: 2600, q: 2, dur: 0.01, gain: 0.08 }); },
    timeout(t) { place(t); mallet(N.A3, t + 0.02, 0.2, { dur: 0.5 }); mallet(207.65, t + 0.14, 0.18, { dur: 0.7 }); },
    cabo(t) { place(t, 1.1); bell(N.D3, t + 0.02, 0.28); bell(N.A3, t + 0.2, 0.16, { pan: 0.25 }); bell(N.D4, t + 0.38, 0.1, { pan: -0.25 }); duck(0.35, 1.2, 2.5); },
    win(t) { [N.D5, N.Fs5, N.A5, N.D6, N.Fs6].forEach((f, i) => mallet(f, t + i * 0.09, 0.15, { pan: -0.4 + i * 0.2, dur: 1.4 })); ep(N.D4, t + 0.45, 0.09, { dur: 3 }); ep(N.A4, t + 0.45, 0.07, { dur: 3 }); ep(N.Fs5, t + 0.5, 0.06, { dur: 3 }); duck(0.3, 1.5, 3); },
    lose(t) { ep(N.D4, t, 0.09, { dur: 2.5 }); ep(N.A3, t + 0.12, 0.08, { dur: 2.5 }); ep(N.E4, t + 0.3, 0.06, { dur: 2.5 }); duck(0.5, 0.8, 2); },
    score(t) { mallet(pick([N.D6, N.E6, N.A5]), t, 0.06, { pan: rnd(-0.3, 0.3) }); },
    crown(t) { noise(t, { type: 'highpass', f0: 7000, attack: 0.2, dur: 0.6, gain: 0.05 }); mallet(N.A5, t + 0.15, 0.1); mallet(N.D6, t + 0.24, 0.1); mallet(N.A6, t + 0.33, 0.06); },
    open(t) { whoosh(t, 500, 1600, 0.2, 0.07); },
  };

  function play(type) {
    if (!Settings.get('sound')) return;
    const c = init(); if (!c) return;
    if (c.state === 'suspended') c.resume();
    const fn = CUES[type];
    if (!fn) return;
    try { fn(c.currentTime + 0.01); } catch (e) {}
  }

  // ════════════ music: "Felt & Lamplight" ════════════
  // 66 BPM, one chord every two bars, eight-chord loop in D major.
  const BPM = 66, BEAT = 60 / BPM;
  const PROG = [
    { bass: 38, pad: [54, 57, 61, 64] },  // Dmaj9
    { bass: 35, pad: [50, 54, 57, 61] },  // Bm9
    { bass: 43, pad: [54, 57, 59, 62] },  // Gmaj9
    { bass: 40, pad: [55, 59, 62, 66] },  // Em9
    { bass: 42, pad: [54, 57, 62, 64] },  // D/F#
    { bass: 43, pad: [55, 59, 62, 66] },  // Gmaj7
    { bass: 40, pad: [55, 59, 62, 64] },  // Em7
    { bass: 45, pad: [52, 57, 59, 64] },  // Asus2
  ];
  const MEL = [62, 64, 66, 69, 71, 74, 76, 78, 81]; // D major pentatonic
  let musicTimer = null, nextBeat = 0, beatNo = 0, melPos = 4, restBars = 0;

  function padChord(ch, t, dur) {
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.4;
    lp.frequency.setValueAtTime(1300, t);
    lp.frequency.linearRampToValueAtTime(2100, t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(1400, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 2.4);
    g.gain.setValueAtTime(0.05, t + dur - 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 2.2);
    lp.connect(g); g.connect(musicBus);
    ch.pad.forEach((m, i) => {
      [-7, 7].forEach((det) => {
        const o = ac.createOscillator(); o.type = 'triangle';
        o.frequency.value = mtof(m); o.detune.value = det + rnd(-2, 2);
        const pg = ac.createGain(); pg.gain.value = i === 0 ? 0.8 : 0.6;
        o.connect(pg); pg.connect(lp);
        o.start(t); o.stop(t + dur + 2.4);
      });
    });
  }
  function bassNote(m, t, v) {
    tone(mtof(m), t, { gain: v, attack: 0.25, dur: 5.5, dest: musicBus, lp: 400 });
    tone(mtof(m) * 2, t, { gain: v * 0.12, attack: 0.3, dur: 3, dest: musicBus, lp: 600 });
  }
  function melodyStep(t, beatInBar, bar) {
    if (restBars > 0) return;
    const p = beatInBar === 0 ? 0.55 : beatInBar === 2 ? 0.4 : 0.22;
    if (Math.random() > p) return;
    melPos = Math.max(0, Math.min(MEL.length - 1, melPos + pick([-2, -1, -1, 0, 1, 1, 2])));
    const m = MEL[melPos];
    const off = Math.random() < 0.3 ? BEAT / 2 : 0; // a little swing
    ep(mtof(m), t + off, rnd(0.055, 0.085), { dest: musicBus, pan: rnd(-0.35, 0.35), dur: rnd(2.2, 3.4), index: rnd(0.8, 1.3) });
    // an occasional soft answer a third/fifth below
    if (Math.random() < 0.18) ep(mtof(MEL[Math.max(0, melPos - 2)]), t + off + BEAT * 0.5, 0.045, { dest: musicBus, pan: rnd(-0.3, 0.3), dur: 2.4 });
    // and a rare high glint
    if (Math.random() < 0.06) mallet(mtof(m + 12), t + off + BEAT, 0.018, { dest: musicBus, dur: 1.5 });
  }
  function schedule() {
    if (!ac) return;
    while (nextBeat < ac.currentTime + 0.4) {
      const t = nextBeat;
      const bar = Math.floor(beatNo / 4), beatInBar = beatNo % 4;
      const ci = Math.floor(bar / 2) % PROG.length;
      if (beatInBar === 0 && bar % 2 === 0) {
        padChord(PROG[ci], t, BEAT * 8);
        bassNote(PROG[ci].bass, t, 0.07);
        if (restBars > 0) restBars--;
        else if (Math.random() < 0.15) restBars = 1; // breathe now and then
      }
      if (beatInBar === 0 && bar % 2 === 1 && Math.random() < 0.5) bassNote(PROG[ci].bass + 7, t, 0.04);
      melodyStep(t, beatInBar, bar);
      nextBeat += BEAT; beatNo++;
    }
  }
  function startMusic() {
    if (!Settings.get('music') || musicTimer) return;
    const c = init(); if (!c) return;
    if (c.state === 'suspended') c.resume();
    const t = c.currentTime;
    musicBus.gain.cancelScheduledValues(t);
    musicBus.gain.setValueAtTime(musicBus.gain.value, t);
    musicBus.gain.linearRampToValueAtTime(musicLevel(), t + 4);
    nextBeat = t + 0.1; beatNo = 0; melPos = 4; restBars = 1; // pad + bass first, melody joins after
    schedule();
    musicTimer = setInterval(schedule, 120);
  }
  function stopMusic() {
    if (!musicTimer) return;
    clearInterval(musicTimer); musicTimer = null;
    const t = ac.currentTime;
    musicBus.gain.cancelScheduledValues(t);
    musicBus.gain.setValueAtTime(musicBus.gain.value, t);
    musicBus.gain.linearRampToValueAtTime(0, t + 1.2);
  }
  const musicLevel = () => vcurve(Settings.get('musicVol')) * 1.5;

  // ── controls ──
  function setMusic(on) {
    Settings.set('music', !!on);
    if (on) { if (unlocked) startMusic(); } else stopMusic();
  }
  function setEffects(on) { Settings.set('sound', !!on); }
  function setVolume(which, v) {
    Settings.set(which, v);
    if (!ac) return;
    const t = ac.currentTime;
    if (which === 'sfxVol') sfxBus.gain.setTargetAtTime(vcurve(v), t, 0.05);
    if (which === 'musicVol' && musicTimer) { musicBus.gain.cancelScheduledValues(t); musicBus.gain.setTargetAtTime(musicLevel(), t, 0.1); }
  }

  // Browsers only allow audio after a user gesture: start on the first one.
  function unlock() {
    if (unlocked) return;
    const c = init(); if (!c) return;
    unlocked = true;
    if (c.state === 'suspended') c.resume();
    if (Settings.get('music')) startMusic();
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, unlock, { capture: true, passive: true }));

  // Pause everything while the tab is hidden.
  document.addEventListener('visibilitychange', () => {
    if (!ac) return;
    if (document.hidden) ac.suspend();
    else if (unlocked) ac.resume();
  });

  // Soft tick for any button press (cards have their own sounds).
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button, .sb, [role="button"]:not(.card)');
    if (b && !b.disabled && !b.closest('[data-nosfx]')) play('tap');
  }, true);

  return { play, setMusic, setEffects, setVolume, startMusic, stopMusic, isMusicOn: () => !!musicTimer };
})();

// ── audio controls UI (top-bar popover, home screen, in-game menu) ──
function audioControlsHTML() {
  const m = Settings.get('music'), s = Settings.get('sound');
  return `<div class="au-wrap" data-nosfx>
    <div class="au-row${m ? '' : ' off'}">
      <button class="au-tog" data-au="music" aria-pressed="${m}" aria-label="Music ${m ? 'on' : 'off'}">${m ? '🎵' : '🔇'}</button>
      <div class="au-main"><div class="au-lab">Music <small>Felt &amp; Lamplight · soft lounge</small></div>
      <input class="au-range" type="range" min="0" max="100" value="${Math.round(Settings.get('musicVol') * 100)}" data-auv="musicVol" aria-label="Music volume"></div>
    </div>
    <div class="au-row${s ? '' : ' off'}">
      <button class="au-tog" data-au="sound" aria-pressed="${s}" aria-label="Sound effects ${s ? 'on' : 'off'}">${s ? '🔊' : '🔈'}</button>
      <div class="au-main"><div class="au-lab">Effects <small>Cards, powers &amp; cues</small></div>
      <input class="au-range" type="range" min="0" max="100" value="${Math.round(Settings.get('sfxVol') * 100)}" data-auv="sfxVol" aria-label="Effects volume"></div>
    </div>
  </div>`;
}
function bindAudioControls(root) {
  if (!root) return;
  const refresh = () => {
    const box = root.querySelector('.au-wrap');
    if (box) { box.outerHTML = audioControlsHTML(); bindAudioControls(root); }
    updateSoundBtn();
  };
  root.querySelectorAll('[data-au]').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.au === 'music') Sound.setMusic(!Settings.get('music'));
      else { Sound.setEffects(!Settings.get('sound')); if (Settings.get('sound')) Sound.play('turn'); }
      refresh();
    };
  });
  root.querySelectorAll('[data-auv]').forEach((r) => {
    r.oninput = () => {
      const k = r.dataset.auv, v = r.value / 100;
      Sound.setVolume(k, v);
      // dragging a slider up turns that channel back on
      if (k === 'musicVol' && v > 0 && !Settings.get('music')) { Sound.setMusic(true); refresh(); }
      if (k === 'sfxVol' && v > 0 && !Settings.get('sound')) { Sound.setEffects(true); refresh(); }
    };
    r.onchange = () => { if (r.dataset.auv === 'sfxVol') Sound.play('match'); };
  });
}
function openAudioPanel(anchor) {
  const pop = document.getElementById('audio-pop');
  if (!pop) return;
  if (pop.classList.contains('show')) { closeAudioPanel(); return; }
  pop.innerHTML = '<div class="au-title">Sound</div>' + audioControlsHTML();
  bindAudioControls(pop);
  const root = document.getElementById('scale-root').getBoundingClientRect();
  const r = anchor.getBoundingClientRect();
  pop.classList.add('show');
  // line up with the button's right edge, but always stay fully on screen
  const w = pop.offsetWidth;
  const left = Math.max(8, Math.min(r.right - root.left - w, root.width - w - 8));
  pop.style.top = (r.bottom - root.top + 8) + 'px';
  pop.style.left = left + 'px';
  pop.style.right = 'auto';
  Sound.play('open');
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  function outside(e) {
    if (pop.contains(e.target) || anchor.contains(e.target)) return;
    closeAudioPanel();
    document.removeEventListener('pointerdown', outside, true);
  }
  pop._outside = outside;
}
function closeAudioPanel() {
  const pop = document.getElementById('audio-pop');
  if (!pop) return;
  pop.classList.remove('show');
  if (pop._outside) document.removeEventListener('pointerdown', pop._outside, true);
}

// Motion-graphics layer: short, screen-space effects drawn above the table.
// Everything is positioned from element rects at call time and lives in a
// fixed overlay, so effects survive the table re-rendering underneath them.
const FX = (function () {
  let layer = null;
  let marker = null;
  let markerTarget = null;
  let markerLabel = '';
  let timer = null;        // { deadline, total, mine }
  let timerKey = null;
  let timerTick = null;
  let lastSec = null;

  function L() {
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'fx-layer';
      document.body.appendChild(layer);
    }
    return layer;
  }
  const off = () => REDUCED_MOTION;
  function node(x) {
    if (!x) return null;
    if (typeof x !== 'string') return x;
    return document.getElementById(x) || document.querySelector(x);
  }
  function box(x) {
    const e = node(x);
    if (!e || !e.isConnected) return null;
    const r = e.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, r };
  }
  function add(cls, html, x, y) {
    const d = document.createElement('div');
    d.className = 'fx ' + cls;
    d.innerHTML = html;
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    L().appendChild(d);
    return d;
  }
  function later(d, ms) { setTimeout(() => d.remove(), ms); }

  // Icon (optionally with a caption) that pops up and floats away.
  function pop(target, icon, opts = {}) {
    const c = box(target);
    if (!c || off()) return;
    const y = opts.at === 'center' ? c.y : c.r.top + 6;
    const d = add('fx-pop ' + (opts.tone || ''), `<span><i>${icon}</i>${opts.text ? `<em>${esc(opts.text)}</em>` : ''}</span>`, c.x, y);
    later(d, 1500);
  }

  // A big rubber stamp that slams onto a target.
  function stamp(target, text, tone, opts = {}) {
    const c = box(target);
    if (!c || off()) return;
    if (opts.dim) {
      const dim = add('fx-dim', '', c.r.left, c.r.top);
      dim.style.width = c.r.width + 'px'; dim.style.height = c.r.height + 'px';
      later(dim, 1600);
    }
    const d = add('fx-stamp ' + (tone || ''), `<span>${esc(text)}</span>`, c.x, c.y);
    if (opts.small) d.classList.add('small');
    later(d, 1600);
    shake(target, 6);
  }

  // Particle burst.
  function burst(target, tone, n = 16) {
    const c = box(target);
    if (!c || off()) return;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      const dist = 40 + Math.random() * 50;
      const p = add('fx-part ' + (tone || ''), '', c.x, c.y);
      p.style.setProperty('--dx', Math.cos(a) * dist + 'px');
      p.style.setProperty('--dy', Math.sin(a) * dist + 'px');
      p.style.animationDelay = Math.random() * 80 + 'ms';
      later(p, 1000);
    }
  }

  // Expanding ring (shockwave) around a target.
  function ring(target, tone, count = 1) {
    const c = box(target);
    if (!c || off()) return;
    for (let i = 0; i < count; i++) {
      const d = add('fx-ring ' + (tone || ''), '', c.x, c.y);
      const s = Math.max(c.r.width, c.r.height) * 1.1;
      d.style.width = s + 'px'; d.style.height = s + 'px';
      d.style.animationDelay = i * 260 + 'ms';
      later(d, 900 + i * 260);
    }
  }

  // An icon travelling along an arc from one element to another, with a
  // comet tail. Resolves when it arrives.
  function beam(from, to, icon, opts = {}) {
    return new Promise((res) => {
      const a = box(from), b = box(to);
      if (!a || !b || off()) { res(); return; }
      const lift = opts.lift != null ? opts.lift : 70;
      const mx = (a.x + b.x) / 2, my = Math.min(a.y, b.y) - lift;
      const kf = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x;
        const y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y;
        kf.push({ transform: `translate(${x - a.x}px,${y - a.y}px) scale(${1 + Math.sin(t * Math.PI) * 0.45})` });
      }
      const dur = opts.duration || 700;
      for (let g = 6; g >= 0; g--) {
        const d = add('fx-beam ' + (opts.tone || '') + (g ? ' ghost' : ''), g ? '<b></b>' : `<span>${icon}</span>`, a.x, a.y);
        if (g) d.style.setProperty('--g', g);
        const an = d.animate(kf, { duration: dur, delay: g * 32, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'both' });
        an.onfinish = () => { d.remove(); if (!g) res(); };
      }
    });
  }

  function shake(target, amp = 8) {
    const e = node(target);
    if (!e || off() || !e.animate) return;
    e.animate([
      { transform: 'translateX(0)' }, { transform: `translateX(-${amp}px) rotate(-1deg)` },
      { transform: `translateX(${amp}px) rotate(1deg)` }, { transform: `translateX(-${amp * 0.6}px)` },
      { transform: `translateX(${amp * 0.4}px)` }, { transform: 'translateX(0)' },
    ], { duration: 480, easing: 'ease-out' });
  }

  // Pile reacts to a card landing on it: thump + little dust puff.
  function thump(target) {
    const e = node(target);
    if (!e || off() || !e.animate) return;
    e.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.1) rotate(-3deg)' }, { transform: 'scale(.97) rotate(1deg)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
    burst(target, 'dust', 10);
  }

  // A card being picked up and tilted towards the viewer (peeking).
  function lift(target) {
    const e = node(target);
    if (!e || off() || !e.animate) return;
    e.animate([
      { transform: 'none' },
      { transform: 'perspective(500px) translateY(-16px) rotateX(22deg) scale(1.1)', offset: 0.22 },
      { transform: 'perspective(500px) translateY(-16px) rotateX(18deg) scale(1.1)', offset: 0.8 },
      { transform: 'none' },
    ], { duration: 1700, easing: 'cubic-bezier(.3,.7,.3,1)' });
  }

  // Score number that floats up out of a player's hand.
  function floatNum(target, text, tone, delay = 0) {
    setTimeout(() => {
      const c = box(target);
      if (!c || off()) return;
      const d = add('fx-num ' + (tone || ''), `<span>${esc(text)}</span>`, c.x, c.y);
      later(d, 2200);
    }, delay);
  }

  // Crown dropping onto the winner.
  function crown(target, delay = 0) {
    setTimeout(() => {
      const c = box(target);
      if (!c || off()) return;
      const d = add('fx-crown', '<span>👑</span>', c.x, c.r.top);
      later(d, 2600);
      ring(target, 'gold', 2);
    }, delay);
  }

  // Glowing frame that glides to whoever's turn it is.
  function placeMarker() {
    if (!marker) return;
    const c = box(markerTarget);
    if (!c) { marker.style.opacity = '0'; return; }
    marker.style.opacity = '1';
    marker.style.left = c.r.left - 4 + 'px';
    marker.style.top = c.r.top - 4 + 'px';
    marker.style.width = c.r.width + 8 + 'px';
    marker.style.height = c.r.height + 8 + 'px';
  }
  // timer: { deadline, total } — draws a draining ring around the frame
  // (green → amber → red) and a seconds counter on the tag.
  function turnMarker(target, label, mine, t) {
    if (!marker) {
      marker = document.createElement('div');
      marker.className = 'fx-marker';
      marker.innerHTML = '<svg class="fx-mk-ring" preserveAspectRatio="none"><rect class="bg" x="2" y="2" rx="14" ry="14" pathLength="100"/><rect class="fg" x="2" y="2" rx="14" ry="14" pathLength="100"/></svg><span class="fx-mk-tag"></span>';
      L().appendChild(marker);
      window.addEventListener('resize', placeMarker);
      const g = document.getElementById('game');
      if (g) g.addEventListener('scroll', placeMarker, { passive: true });
    }
    markerTarget = target;
    markerLabel = label || '';
    marker.classList.toggle('mine', !!mine);
    if (off()) marker.classList.add('static');
    placeMarker();
    setTimer(t && t.deadline && t.total ? { deadline: t.deadline, total: t.total, mine: !!mine } : null);
  }
  function setTimer(t) {
    const key = t ? t.deadline + ':' + t.total : null;
    const fg = marker.querySelector('rect.fg');
    marker.classList.toggle('timed', !!t);
    if (key !== timerKey) {
      timerKey = key; timer = t; lastSec = null;
      if (t) {
        const left = Math.max(0, t.deadline - Date.now());
        fg.style.transition = 'none';
        fg.style.strokeDashoffset = String(100 - (100 * left) / t.total);
        void fg.getBoundingClientRect();
        fg.style.transition = `stroke-dashoffset ${left}ms linear`;
        fg.style.strokeDashoffset = '100';
      }
    }
    clearInterval(timerTick);
    if (timer) { timerTick = setInterval(tickTimer, 250); tickTimer(); }
    else updateTag(null);
  }
  function tickTimer() {
    if (!timer || !marker) return;
    const secs = Math.max(0, Math.ceil((timer.deadline - Date.now()) / 1000));
    const frac = (timer.deadline - Date.now()) / timer.total;
    marker.classList.toggle('warn', frac <= 1 / 3 && secs > 5);
    marker.classList.toggle('crit', secs <= 5);
    updateTag(secs);
    if (secs !== lastSec) {
      if (timer.mine && secs <= 5 && secs > 0) { sfx('tick'); if (secs === 5) { try { if (navigator.vibrate && Settings.get('sound')) navigator.vibrate([60, 60, 60]); } catch (e) {} } }
      lastSec = secs;
    }
    if (secs <= 0) clearInterval(timerTick);
  }
  function updateTag(secs) {
    const tag = marker.querySelector('.fx-mk-tag');
    tag.innerHTML = esc(markerLabel) + (secs != null ? ` <b>${secs}s</b>` : '');
  }
  function hideMarker() {
    markerTarget = null;
    if (marker) { marker.style.opacity = '0'; clearInterval(timerTick); timer = null; timerKey = null; marker.classList.remove('timed', 'warn', 'crit'); }
  }

  // Power used: icon erupts from the card with a burst.
  function power(cardTarget, seatTarget, rank) {
    const pw = POWERS[rank];
    if (!pw) return;
    burst(cardTarget, 'power', 18);
    ring(cardTarget, 'power');
    pop(cardTarget, pw.icon, { text: pw.name, tone: 'power', at: 'center' });
    if (seatTarget) setTimeout(() => pop(seatTarget, pw.icon, { tone: 'power' }), 120);
  }

  function clear() { if (layer) layer.querySelectorAll('.fx:not(.fx-marker)').forEach((d) => d.remove()); }

  return { pop, stamp, burst, ring, beam, shake, lift, thump, floatNum, crown, turnMarker, hideMarker, power, clear };
})();

// End-of-round flourish: each player's score floats out of their hand and
// a crown drops onto the winner(s). Returns how long it takes.
function revealFX(seatNodeFn, scores, winners) {
  if (REDUCED_MOTION) return 0;
  scores.forEach((s, i) => FX.floatNum(seatNodeFn(i), `${s} pts`, winners.includes(i) ? 'gold' : '', 300 + i * 220));
  const t = 300 + scores.length * 220 + 200;
  winners.forEach((i) => FX.crown(seatNodeFn(i), t));
  return t + 900;
}

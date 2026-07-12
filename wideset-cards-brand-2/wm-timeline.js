/**
 * WM — Wide Motion timeline runtime (dependency-free)
 *
 * Every animation in a wide-motion HTML file MUST be driven by this engine.
 * Why: the engine is fully deterministic and seekable — the renderer steps it
 * frame-by-frame (WM.seek(t)) so the exported MP4 is PERFECTLY smooth at any
 * fps, regardless of machine speed. Never use free-running CSS animations,
 * setInterval, or un-seekable rAF loops for anything that must appear in the video.
 *
 * Contract with the renderer (scripts/render.mjs):
 *   window.WM.duration  -> total ms
 *   window.WM.seek(t)   -> synchronously paint state at time t (ms)
 *   window.WM.play()    -> live preview in the browser (rAF-driven)
 */
(function () {
  // ---------- Easing (the "perfect smooth" palette) ----------
  const c = (x1, y1, x2, y2) => {
    // cubic-bezier solver
    const A = (a, b) => 1 - 3 * b + 3 * a, B = (a, b) => 3 * b - 6 * a, C = (a) => 3 * a;
    const calc = (t, a, b) => ((A(a, b) * t + B(a, b)) * t + C(a)) * t;
    const slope = (t, a, b) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);
    return (x) => {
      if (x <= 0) return 0; if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) {
        const s = slope(t, x1, x2); if (s === 0) break;
        t -= (calc(t, x1, x2) - x) / s;
      }
      return calc(t, y1, y2);
    };
  };
  const Easings = {
    linear: (t) => t,
    // Signature cinematic ease — slow in, long silky out. Default for camera.
    cinematic: c(0.65, 0, 0.05, 1),
    // Apple-style UI ease for elements entering/moving.
    smooth: c(0.4, 0, 0.2, 1),
    out: c(0.16, 1, 0.3, 1),        // expo-ish out — cards, reveals
    in: c(0.7, 0, 0.84, 0),
    inOut: c(0.87, 0, 0.13, 1),     // dramatic zoom hits
    // Critically-damped-ish spring approximation (no overshoot jitter).
    spring: (t) => 1 - Math.exp(-6.5 * t) * Math.cos(7 * t * Math.PI * 0.32) * (1 - t),
    softSpring: (t) => { const p = 1 - Math.pow(1 - t, 3); const o = Math.sin(t * Math.PI * 2.2) * Math.pow(1 - t, 3) * 0.12; return p + o; },
  };

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (t) => Math.max(0, Math.min(1, t));

  // ---------- Track model ----------
  const tracks = [];   // {start, dur, ease, apply(p), hold}
  let total = 0;

  function tween(opts) {
    const { at = 0, dur = 600, ease = 'smooth', apply } = opts;
    const fn = typeof ease === 'function' ? ease : (Easings[ease] || Easings.smooth);
    tracks.push({ start: at, dur, ease: fn, apply });
    total = Math.max(total, at + dur);
    return at + dur;
  }

  // Numeric/style helpers ------------------------------------------------
  const $ = (sel) => (typeof sel === 'string' ? document.querySelector(sel) : sel);

  function style(sel, at, dur, props, ease) {
    // props: { transform: [from, to] as template fns or strings with {t}, opacity: [0,1], ... }
    const el = $(sel);
    return tween({
      at, dur, ease,
      apply(p) {
        if (!el) return;
        for (const k in props) {
          const v = props[k];
          if (Array.isArray(v) && typeof v[0] === 'number') {
            el.style[k] = String(lerp(v[0], v[1], p));
          } else if (typeof v === 'function') {
            el.style[k] = v(p, lerp);
          }
        }
      },
    });
  }

  // Camera: animates a single wrapper (#camera) with scale/translate/rotate.
  // Keyframes: [{t: ms, x, y, scale, rx, ry, rz}] — interpolated with given ease per segment.
  function camera(keyframes, target = '#camera', ease = 'cinematic') {
    const el = $(target);
    const kfs = keyframes.slice().sort((a, b) => a.t - b.t);
    const end = kfs[kfs.length - 1].t;
    tracks.push({
      start: 0, dur: end, ease: Easings.linear,
      apply(pRaw, tAbs) {
        if (!el) return;
        const t = tAbs;
        let i = 0;
        while (i < kfs.length - 1 && t > kfs[i + 1].t) i++;
        const a = kfs[i], b = kfs[Math.min(i + 1, kfs.length - 1)];
        const seg = b.t === a.t ? 1 : clamp01((t - a.t) / (b.t - a.t));
        const e = (typeof (b.ease || ease) === 'function') ? (b.ease || ease) : (Easings[b.ease || ease] || Easings.cinematic);
        const p = e(seg);
        const g = (k, d = 0) => lerp(a[k] ?? d, b[k] ?? a[k] ?? d, p);
        const s = g('scale', 1), x = g('x'), y = g('y'), rx = g('rx'), ry = g('ry'), rz = g('rz');
        el.style.transform =
          `translate3d(${x}px, ${y}px, 0) scale(${s}) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`;
      },
    });
    total = Math.max(total, end);
    return end;
  }

  // Typewriter into an element (uses textContent; caret via CSS class .wm-caret)
  function type(sel, at, text, cps = 28, ease = 'linear') {
    const el = $(sel);
    const dur = (text.length / cps) * 1000;
    return tween({
      at, dur, ease,
      apply(p) { if (el) el.textContent = text.slice(0, Math.round(text.length * p)); },
    });
  }

  // Fake cursor: move #wm-cursor to element/point, then click ripple.
  function cursorTo(sel, at, dur = 700, ease = 'smooth', offset = { x: 0, y: 0 }) {
    const cur = $('#wm-cursor');
    let from = null;
    return tween({
      at, dur, ease,
      apply(p) {
        if (!cur) return;
        const target = $(sel);
        if (!target) return;
        const r = target.getBoundingClientRect();
        const cr = cur.getBoundingClientRect();
        if (from === null || p === 0) from = { x: parseFloat(cur.dataset.x || cr.x), y: parseFloat(cur.dataset.y || cr.y) };
        const tx = r.x + r.width / 2 + offset.x, ty = r.y + r.height / 2 + offset.y;
        const x = lerp(from.x, tx, p), y = lerp(from.y, ty, p);
        cur.style.transform = `translate(${x}px, ${y}px)`;
        if (p === 1) { cur.dataset.x = tx; cur.dataset.y = ty; }
      },
    });
  }

  function click(sel, at) {
    // press: cursor dips + ripple + target gets .wm-active for 240ms
    const cur = $('#wm-cursor');
    tween({
      at, dur: 240, ease: 'out',
      apply(p) {
        if (cur) cur.style.scale = String(1 - 0.25 * Math.sin(p * Math.PI));
        const target = $(sel);
        if (target) target.classList.toggle('wm-active', p > 0 && p < 1);
      },
    });
    return at + 240;
  }

  // Stagger helper: run fn(el, index, startTime) over a NodeList with gap ms.
  function stagger(selector, at, gap, fn) {
    const els = document.querySelectorAll(selector);
    els.forEach((el, i) => fn(el, i, at + i * gap));
    return at + Math.max(0, els.length - 1) * gap;
  }

  // Draw an SVG path (charts). Requires stroke-dasharray prepared by engine.
  function drawPath(sel, at, dur = 1200, ease = 'cinematic') {
    const el = $(sel);
    let len = 0;
    return tween({
      at, dur, ease,
      apply(p) {
        if (!el) return;
        if (!len) { len = el.getTotalLength(); el.style.strokeDasharray = len; }
        el.style.strokeDashoffset = String(len * (1 - p));
      },
    });
  }

  // Count-up numbers
  function count(sel, at, dur, from, to, fmt = (n) => Math.round(n).toLocaleString('en-US')) {
    const el = $(sel);
    return tween({ at, dur, ease: 'cinematic', apply(p) { if (el) el.textContent = fmt(lerp(from, to, p)); } });
  }

  // ---------- Seek / play ----------
  function seek(t) {
    for (const tr of tracks) {
      const local = (t - tr.start) / tr.dur;
      const p = tr.ease(clamp01(local));
      // Always apply: before start -> p=0 state, after end -> p=1 (holds final state)
      tr.apply(p, Math.max(0, Math.min(t, tr.start + tr.dur)) , t);
    }
    // camera tracks receive absolute time as 2nd arg (they ignore p)
    document.documentElement.style.setProperty('--wm-t', String(t));
  }

  let raf = null;
  function play(loop = false) {
    cancelAnimationFrame(raf);
    const t0 = performance.now();
    const step = (now) => {
      let t = now - t0;
      if (t >= WM.duration) { seek(WM.duration); if (loop) return play(loop); return; }
      seek(t);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  window.WM = {
    get duration() { return total; },
    set duration(v) { total = v; },
    Easings, tween, style, camera, type, cursorTo, click, stagger, drawPath, count,
    seek, play,
  };
})();

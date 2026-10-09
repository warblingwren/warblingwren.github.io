// =============================================================================
// guitar.js — realistic guitar fretboard (pure JS + inline SVG)
// Renders into the <div> named by opts.target (set in dashboard.js). Data: DATA/guitar_tuning.json
//
// Layout: low E (string 6) on top, string 1 at the bottom. Open-string column at the
// left (headstock side), bone nut, then frets 1…24 (wide screens) or a 12-fret window
// (narrow screens) that slides up the neck with ‹ › buttons.
// Fret spacing is "softened realistic": frets narrow toward the body like a real neck,
// but less steeply, so high frets stay wide enough for chord dots.
// =============================================================================
//
// SYNC POINT (note_ref format): 'C#4' style, '#' only (no flats) —
//   must match DATA/guitar_tuning.json, DATA/piano_tuning.json and piano-audio.js noteToMidi
// SYNC POINT (narrow-screen query): opts.mobileQuery must match the 768px breakpoint in
//   www/css/guitar.css (same breakpoint as piano.js / piano.css)
// =============================================================================

import { OCTAVE_FAMILIES, textOn, stickyTargetFor } from './piano.js';

const NOTE_RE = /^([A-G])(#?)([0-8])$/;
// Progression dots use the piano's colours: hue = octave family of the dot's actual pitch,
// shade = scale degree, tonic darkest. 1/3/5/7 = 900/700/500/300, the same shades the piano
// uses for root/3rd/5th/7th (SYNC: ROLE_SHADES in piano.js); 2/4/6 fall in between.
const DEGREE_SHADES = ['900', '800', '700', '600', '500', '400', '300'];
const HEX_RE = /^#[0-9a-f]{6}$/i;
// SYNC: --gf-css-version in www/css/guitar.css. Bump both together when the markup/CSS contract changes.
const CSS_VERSION = 5;
const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SVG_NS = 'http://www.w3.org/2000/svg';

// string gauges (thousandths of an inch, light set) -> drawn thickness; 4–6 are wound
const GAUGE = { 1: 10, 2: 13, 3: 17, 4: 26, 5: 36, 6: 46 };
const SINGLE_INLAYS = new Set([3, 5, 7, 9, 15, 17, 19, 21]);
const DOUBLE_INLAYS = new Set([12, 24]);

const noteToMidi = (note) => {
  const m = NOTE_RE.exec(note);
  return m ? (Number(m[3]) + 1) * 12 + SEMITONE[m[1]] + (m[2] ? 1 : 0) : null;
};
const midiToNote = (midi) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
const pretty = (n) => n.replace('#', '♯');
const pitchName = (note) => pretty(note.replace(/\d+$/, ''));

let uidSeq = 0;

// DOM-clobbering guard: only a real <div>; waits for a late element instead of failing
const getHost = (target) => {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  return el instanceof HTMLDivElement ? el : null;
};
function waitForHost(target, timeoutMs = 5000) {
  const now = getHost(target);
  if (now || typeof target !== 'string') return Promise.resolve(now);
  return new Promise((resolve) => {
    const obs = new MutationObserver(() => {
      const el = getHost(target);
      if (el) { obs.disconnect(); clearTimeout(timer); resolve(el); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(() => { obs.disconnect(); resolve(getHost(target)); }, timeoutMs);
  });
}

// Keep only well-formed tunings; strings ordered 6 -> 1 (top -> bottom)
function validateTunings(json) {
  if (!json || !Array.isArray(json.tunings)) throw new Error('guitar-fretboard: invalid tuning JSON');
  const count = Number.isInteger(json.total_strings) ? json.total_strings : 6;
  const valid = [];
  const quarantined = [];
  for (const t of json.tunings) {
    const strings = Array.isArray(t?.open_strings) ? t.open_strings : [];
    const ok = typeof t?.name === 'string' && t.name.trim() !== ''
      && strings.length === count
      && strings.every((s) => Number.isInteger(s?.string) && s.string >= 1 && s.string <= count
        && typeof s.note_ref === 'string' && NOTE_RE.test(s.note_ref))
      && new Set(strings.map((s) => s.string)).size === count;
    if (!ok) { quarantined.push(t); continue; }
    valid.push({
      name: t.name,
      alias: typeof t.alias === 'string' ? t.alias : '',
      description: typeof t.description === 'string' ? t.description : '',
      strings: strings
        .map((s) => ({ string: s.string, note: s.note_ref, midi: noteToMidi(s.note_ref) }))
        .sort((a, b) => b.string - a.string),
    });
  }
  if (quarantined.length) console.warn('guitar-fretboard: quarantined tunings', quarantined);
  if (!valid.length) throw new Error('guitar-fretboard: no valid tunings');
  return valid;
}

/**
 * @param {object}  opts
 * @param {string|HTMLDivElement} opts.target  container id or element (required — ids live in index.html / dashboard.js)
 * @param {string}  opts.dataUrl      tuning file (default 'DATA/guitar_tuning.json')
 * @param {object}  opts.data         tuning JSON already loaded (skips the fetch)
 * @param {string}  opts.tuning       initial tuning name (default 'Standard', else the first)
 * @param {number}  opts.frets        frets on wide screens (default 24)
 * @param {number}  opts.mobileFrets  frets on narrow screens (default 12)
 * @param {string}  opts.mobileQuery  narrow-screen media query (default '(max-width: 768px)')
 * @param {number}  opts.shiftStep    frets moved per ‹ › click on narrow screens (default 3)
 * @param {number}  opts.taper        fret narrowing: 0 = equal widths, 1 = true scale length (default 0.5)
 * @param {object}  opts.piano        API returned by renderPianoKeyboard: dot colours use its octave colours
 *                                    (optional; without it the same default families are read from colors.js)
 * @param {object}  opts.progressions API returned by renderCircleProgressions (optional; its 'progression:change'
 *                                    events are also picked up from document)
 * @param {string}  opts.overlay      initial progression overlay: 'root' | 'relative' (default 'root')
 * @param {boolean} opts.sticky       pin the fretboard to the top of the window while scrolling (default true);
 *                                    with opts.piano it takes over from the pinned keyboard, pushing it up
 * @returns {Promise<object|null>} API (null if the container is missing):
 *   element, tunings(), tuning(), setTuning(name), noteAt(string, fret),
 *   positionsOf(noteOrPitchClass), range(), shiftFrets(dir), showFrets(fromFret),
 *   setOverlay(panel), overlay(), focusChord(name|null), showPositions(list, {title}), clearPositions(),
 *   maxFret, isCompact(), destroy()
 * Emits on the container (bubbling): 'guitar:tuning'   detail {name, alias, strings:[{string, note}]}
 *                                    'guitar:overlay'  detail {panel, key, chord, notes:[spelled]}
 *                                    'guitar:rerender' detail {from, to, compact}
 */
export async function renderGuitarFretboard(opts = {}, legacyOpts = {}) {
  // Called as renderGuitarFretboard({ target, ... }) like the other render functions.
  // Older form renderGuitarFretboard(target, { ... }) still works. No default id: the caller names it.
  const legacy = typeof opts === 'string' || opts instanceof HTMLElement;
  const target = legacy ? opts : opts?.target;
  if (legacy) opts = legacyOpts ?? {};
  if (!target) {
    console.error('guitar-fretboard: opts.target is required (the id of the fretboard <div>) — fretboard not shown');
    return null;
  }
  const {
    dataUrl = 'DATA/guitar_tuning.json',
    data = null,
    tuning: startTuning = 'Standard',
    frets = 24,
    mobileFrets = 12,
    mobileQuery = '(max-width: 768px)',
    shiftStep = 3,
    taper = 0.5,
    progressions = null,
    piano = null,
    overlay: startOverlay = 'root',
    sticky = true,
  } = opts;

  const container = await waitForHost(target);
  if (!container) {
    console.error(`guitar-fretboard: no <div> with id "${target}" — fretboard not shown`);
    return null;
  }

  let json = data;
  if (!json) {
    const res = await fetch(dataUrl, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`guitar-fretboard: ${res.status} loading ${dataUrl}`);
    json = await res.json();
  }
  const tunings = validateTunings(json);

  // Version checks: say exactly which file is out of step instead of failing silently
  const cssVersion = parseFloat(getComputedStyle(container).getPropertyValue('--gf-css-version'));
  if (cssVersion !== CSS_VERSION) {
    console.warn(`guitar-fretboard: www/css/guitar.css is ${Number.isFinite(cssVersion) ? `version ${cssVersion}` : 'missing or an older version'}; `
      + `guitar.js expects version ${CSS_VERSION} — dropdown and dot styles may be wrong`);
  }
  if (progressions && typeof progressions.state !== 'function') {
    console.warn('guitar-fretboard: the progressions object has no state() — www/js/circle-o-5ths.js is older than guitar.js; '
      + 'the progression overlay stays unavailable until it is updated');
  }
  let current = tunings.find((t) => t.name === startTuning) ?? tunings[0];

  const maxFrets = Math.max(1, Math.min(24, Math.floor(frets)));
  const winFrets = Math.max(1, Math.min(maxFrets, Math.floor(mobileFrets)));
  const mql = window.matchMedia(mobileQuery);
  let winStart = 0;                                  // first fret line of the narrow window (0 = nut)
  const clampStart = (s) => Math.max(0, Math.min(maxFrets - winFrets, s));
  const uid = `gf${++uidSeq}`;

  container.classList.add('gf');
  const emit = (type, detail) => container.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  // --- static chrome: [status · All C G Am … · progression ▾ tuning ▾] / [‹ Frets 1–12 ›] / board ----
  const top = document.createElement('div');
  top.className = 'gf-top';
  const status = document.createElement('div');
  status.className = 'gf-status';
  status.setAttribute('aria-live', 'polite');
  const select = document.createElement('select');
  select.className = 'gf-select gf-tuning';
  select.setAttribute('aria-label', 'Guitar tuning');
  for (const t of tunings) {
    const opt = document.createElement('option');
    opt.value = t.name;
    opt.textContent = t.alias && t.alias !== t.name ? `${t.name} (${pretty(t.alias)})` : t.name;
    if (t.description) opt.title = t.description;
    select.append(opt);
  }
  select.value = current.name;
  select.addEventListener('change', () => api.setTuning(select.value));

  // Progression overlay: Root – C major / Relative – A minor (always one of the two)
  const progSelect = document.createElement('select');
  progSelect.className = 'gf-select gf-prog';
  progSelect.setAttribute('aria-label', 'Show progression notes on the fretboard');
  const PANELS = ['root', 'relative'];
  for (const v of PANELS) {
    const opt = document.createElement('option');
    opt.value = v;
    progSelect.append(opt);
  }
  progSelect.addEventListener('change', () => api.setOverlay(progSelect.value));

  // Chord badges: All + each chord of the progression once; a chord shows only its tones
  const badges = document.createElement('div');
  badges.className = 'gf-badges';
  badges.setAttribute('role', 'group');
  badges.setAttribute('aria-label', 'Show one chord of the progression');

  const selects = document.createElement('div');
  selects.className = 'gf-selects';
  selects.append(progSelect, select);
  top.append(status, badges, selects);

  const controls = document.createElement('div');
  controls.className = 'gf-controls';
  const mkShift = (dir, text, aria) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gf-shift';
    b.textContent = text;
    b.setAttribute('aria-label', aria);
    b.addEventListener('click', () => api.shiftFrets(dir));
    return b;
  };
  const prevBtn = mkShift(-1, '‹', 'Move down the neck');
  const nextBtn = mkShift(1, '›', 'Move up the neck');
  const rangeEl = document.createElement('span');
  rangeEl.className = 'gf-range';
  rangeEl.setAttribute('aria-live', 'polite');
  controls.append(prevBtn, rangeEl, nextBtn);

  const stage = document.createElement('div');
  stage.className = 'gf-stage';
  container.replaceChildren(top, controls, stage);

  // --- geometry ---------------------------------------------------------------
  const cssNum = (name, fallback) => {
    const v = parseFloat(getComputedStyle(container).getPropertyValue(name));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };

  function layout() {
    const compact = mql.matches;
    const from = compact ? clampStart(winStart) : 0;
    const count = compact ? winFrets : maxFrets;
    const W = Math.max(240, Math.floor(stage.clientWidth));
    const gapBody = cssNum('--gf-string-gap', 30);   // string spacing (parallel edges, even height)
    const gapNut = gapBody;                          // no neck taper: keeps the board level end to end
    const openCol = cssNum('--gf-open-col', 40);
    const nutW = from === 0 ? 9 : 0;
    const padT = 10;
    const numRow = 22;
    const x0 = openCol + nutW;                       // fret line `from`
    const x1 = W - 4;                                // last fret line
    // softened scale length: width of fret k ∝ 2^(-taper·(k-1)/12)
    const r = 2 ** (-taper / 12);
    const widths = [];
    for (let k = from + 1; k <= from + count; k++) widths.push(r ** (k - 1));
    const sum = widths.reduce((a, b) => a + b, 0);
    const fretX = new Map([[from, x0]]);
    let x = x0;
    widths.forEach((w, i) => { x += (w / sum) * (x1 - x0); fretX.set(from + i + 1, x); });
    const gapAt = (fretNum) => gapNut + (gapBody - gapNut) * (fretNum / 24);
    const cy = padT + 3 * gapBody;
    const xAtFret = (fretNum) => fretX.get(fretNum);
    // y of string row i (0 = top = string 6) at a horizontal position, interpolated along the neck
    const yAt = (i, px) => {
      const t = Math.max(0, Math.min(1, (px - x0) / (x1 - x0)));
      const g = gapAt(from) + (gapAt(from + count) - gapAt(from)) * t;
      return cy + (i - 2.5) * g;
    };
    const edge = (px, sign) => {
      const t = Math.max(0, Math.min(1, (px - x0) / (x1 - x0)));
      const g = gapAt(from) + (gapAt(from + count) - gapAt(from)) * t;
      return cy + sign * 3 * g;
    };
    const H = cy + 3 * gapBody + 6 + numRow;
    return { compact, from, to: from + count, count, W, H, openCol, nutW, x0, x1, cy, gapBody, fretX, xAtFret, yAt, edge, numRow };
  }

  // --- drawing ----------------------------------------------------------------
  const svgEl = (tag, attrs = {}, cls) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    if (cls) n.setAttribute('class', cls);
    return n;
  };
  const stop = (offset, cls) => svgEl('stop', { offset }, cls);

  function defs(L) {
    const d = svgEl('defs');
    const wood = svgEl('linearGradient', { id: `${uid}-wood`, x1: 0, y1: 0, x2: 0, y2: 1 });
    wood.append(stop('0', 'gf-c-wood-edge'), stop('0.18', 'gf-c-wood'), stop('0.82', 'gf-c-wood'), stop('1', 'gf-c-wood-edge'));
    const fret = svgEl('linearGradient', { id: `${uid}-fret`, x1: 0, y1: 0, x2: 1, y2: 0 });
    fret.append(stop('0', 'gf-c-fret-dark'), stop('0.45', 'gf-c-fret-light'), stop('1', 'gf-c-fret-dark'));
    const nut = svgEl('linearGradient', { id: `${uid}-nut`, x1: 0, y1: 0, x2: 1, y2: 0 });
    nut.append(stop('0', 'gf-c-nut-shade'), stop('0.35', 'gf-c-nut'), stop('1', 'gf-c-nut-shade'));
    const pearl = svgEl('radialGradient', { id: `${uid}-pearl`, cx: '0.38', cy: '0.35', r: '0.75' });
    pearl.append(stop('0', 'gf-c-pearl'), stop('0.7', 'gf-c-pearl-mid'), stop('1', 'gf-c-pearl-shade'));
    // wood grain: stretched fractal noise, tinted dark, multiplied over the gradient
    const grain = svgEl('filter', { id: `${uid}-grain`, x: 0, y: 0, width: 1, height: 1 });
    grain.append(
      svgEl('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.0035 0.22', numOctaves: 3, seed: 11 }),
      svgEl('feColorMatrix', { type: 'matrix', values: '0 0 0 0 0.08  0 0 0 0 0.04  0 0 0 0 0.02  0 0 0 -2.2 1.35' }),
    );
    const clip = svgEl('clipPath', { id: `${uid}-board` });
    clip.append(boardPolygon(L));
    d.append(wood, fret, nut, pearl, grain, clip);
    return d;
  }

  function boardPolygon(L, cls) {
    const xs = L.x0 - L.nutW;
    const pts = [[xs, L.edge(L.x0, -1)], [L.x1, L.edge(L.x1, -1)], [L.x1, L.edge(L.x1, 1)], [xs, L.edge(L.x0, 1)]];
    return svgEl('polygon', { points: pts.map((p) => p.map((n) => n.toFixed(2)).join(',')).join(' ') }, cls);
  }

  function draw() {
    const L = layout();
    const svg = svgEl('svg', {
      width: L.W, height: L.H, viewBox: `0 0 ${L.W} ${L.H}`, role: 'img',
      'aria-label': `Guitar fretboard, ${current.name} tuning, frets ${L.from} to ${L.to}`,
    }, 'gf-svg');
    svg.append(defs(L));

    // fingerboard: wood + grain + binding
    const board = boardPolygon(L, 'gf-board');
    board.setAttribute('fill', `url(#${uid}-wood)`);
    const grain = svgEl('rect', { x: 0, y: 0, width: L.W, height: L.H, filter: `url(#${uid}-grain)`, 'clip-path': `url(#${uid}-board)` }, 'gf-grain');
    const xs = L.x0 - L.nutW;
    const bindTop = svgEl('line', { x1: xs, y1: L.edge(L.x0, -1), x2: L.x1, y2: L.edge(L.x1, -1) }, 'gf-binding');
    const bindBot = svgEl('line', { x1: xs, y1: L.edge(L.x0, 1), x2: L.x1, y2: L.edge(L.x1, 1) }, 'gf-binding');
    svg.append(board, grain);

    // inlays (between fret wires)
    for (let k = L.from + 1; k <= L.to; k++) {
      if (!SINGLE_INLAYS.has(k) && !DOUBLE_INLAYS.has(k)) continue;
      const cx = (L.xAtFret(k - 1) + L.xAtFret(k)) / 2;
      const w = L.xAtFret(k) - L.xAtFret(k - 1);
      const rad = Math.min(L.gapBody * 0.27, w * 0.2);
      // double dots sit between strings 5–4 and 3–2 (rows 1.5 and 3.5), like a real 12th fret
      const ys = DOUBLE_INLAYS.has(k) ? [L.yAt(1.5, cx), L.yAt(3.5, cx)] : [L.cy];
      for (const y of ys) {
        const dot = svgEl('circle', { cx: cx.toFixed(2), cy: y.toFixed(2), r: rad.toFixed(2), fill: `url(#${uid}-pearl)` }, 'gf-inlay');
        svg.append(dot);
      }
    }

    // fret wires (the line at L.from is the nut when from = 0)
    for (let k = L.from; k <= L.to; k++) {
      if (k === 0) continue;
      const x = L.xAtFret(k);
      const y1 = L.edge(x, -1);
      const y2 = L.edge(x, 1);
      svg.append(
        svgEl('rect', { x: (x + 1.5).toFixed(2), y: y1.toFixed(2), width: 2.5, height: (y2 - y1).toFixed(2) }, 'gf-fret-shadow'),
        svgEl('rect', { x: (x - 1.5).toFixed(2), y: (y1 - 0.5).toFixed(2), width: 3, height: (y2 - y1 + 1).toFixed(2), rx: 1, fill: `url(#${uid}-fret)` }, 'gf-fret'),
      );
    }
    if (L.from === 0) {
      const y1 = L.edge(L.x0, -1) - 1;
      const y2 = L.edge(L.x0, 1) + 1;
      svg.append(svgEl('rect', { x: (L.x0 - L.nutW).toFixed(2), y: y1.toFixed(2), width: L.nutW, height: (y2 - y1).toFixed(2), rx: 1.5, fill: `url(#${uid}-nut)` }, 'gf-nut'));
    }
    svg.append(bindTop, bindBot);

    // strings: shadow, body, highlight; wound strings get a winding texture
    current.strings.forEach((s, i) => {
      const gauge = GAUGE[s.string] ?? 20;
      const w = 0.8 + (gauge / 46) * 2.6;
      const wound = gauge >= 24;
      const ya = L.yAt(i, L.x0);
      const sx = (L.openCol / 2 - 2).toFixed(2);          // strings start under the open-note circle
      const yb = L.yAt(i, L.x1);
      // level across the open column, then along the (slightly widening) neck
      const line = (cls, dy, sw, extra = {}) => svgEl('polyline', {
        points: `${sx},${(ya + dy).toFixed(2)} ${L.x0},${(ya + dy).toFixed(2)} ${L.x1},${(yb + dy).toFixed(2)}`,
        fill: 'none', 'stroke-width': sw.toFixed(2), ...extra,
      }, cls);
      svg.append(line('gf-string-shadow', w * 0.9 + 1, w));
      svg.append(line(wound ? 'gf-string gf-string--wound' : 'gf-string', 0, w));
      if (wound) svg.append(line('gf-winding', 0, w, { 'stroke-dasharray': '0.9 1.1' }));
      svg.append(line('gf-string-hi', -w * 0.22, Math.max(0.5, w * 0.35)));
    });

    // progression overlay: every position of every progression tone in the visible frets
    const ov = overlayNotes();
    svg.classList.toggle('gf-has-overlay', Boolean(ov));
    if (ov) {
      const layer = svgEl('g', {}, 'gf-marks');
      current.strings.forEach((s, i) => {
        for (let f = L.from + 1; f <= L.to; f++) {
          const n = ov.custom ? ov.custom.get(`${s.string}:${f}`) : ov.notes.get((s.midi + f) % 12);
          if (!n) continue;
          const xl = L.xAtFret(f - 1);
          const xr = L.xAtFret(f);
          const cx = (xl + xr) / 2;
          const r = Math.max(7, Math.min(13, L.gapBody * 0.42, (xr - xl) / 2 - 2));
          layer.append(dotEl(cx, L.yAt(i, cx), r, n, s, f, ov));
        }
      });
      svg.append(layer);
    }

    // open-string column: note name of each open string (a dot instead when it is a progression tone)
    current.strings.forEach((s, i) => {
      const y = L.yAt(i, L.x0);
      const r = Math.min(13, L.gapBody * 0.42);
      const n = ov?.custom ? ov.custom.get(`${s.string}:0`) : ov?.notes.get(s.midi % 12);
      if (n) { svg.append(dotEl(L.openCol / 2 - 2, y, r, n, s, 0, ov)); return; }
      const g = svgEl('g', {}, 'gf-open');
      const title = svgEl('title');
      title.textContent = `String ${s.string}: ${pretty(s.note)}`;
      const c = svgEl('circle', { cx: (L.openCol / 2 - 2).toFixed(2), cy: y.toFixed(2), r: r.toFixed(2) }, 'gf-open-dot');
      const t = svgEl('text', { x: (L.openCol / 2 - 2).toFixed(2), y: y.toFixed(2), 'text-anchor': 'middle', 'dominant-baseline': 'central' }, 'gf-open-text');
      t.textContent = pitchName(s.note);
      g.append(title, c, t);
      svg.append(g);
    });

    // fret numbers under the board
    const ny = L.cy + 3 * L.gapBody + 6 + L.numRow / 2 + 2;
    for (let k = L.from + 1; k <= L.to; k++) {
      const cx = (L.xAtFret(k - 1) + L.xAtFret(k)) / 2;
      const strong = SINGLE_INLAYS.has(k) || DOUBLE_INLAYS.has(k);
      const t = svgEl('text', { x: cx.toFixed(2), y: ny.toFixed(2), 'text-anchor': 'middle', 'dominant-baseline': 'central' }, strong ? 'gf-num gf-num--inlay' : 'gf-num');
      t.textContent = String(k);
      svg.append(t);
    }

    stage.replaceChildren(svg);
    return L;
  }

  // --- progression overlay ----------------------------------------------------------
  // Source: the progression panels' own chords (circle-o-5ths.js state / 'progression:change'),
  // never recomputed here.
  let progState = progressions?.state?.() ?? null;
  let overlayPanel = PANELS.includes(startOverlay) ? startOverlay : 'root';
  let focusName = null;                              // chord badge shown alone (null = All)
  const LETTERS = 'CDEFGAB';
  // scale degree 1–7 from letter names, so raised/lowered notes keep their degree (G♯ in A minor = 7)
  const degreeOf = (spelled, tonic) => ((LETTERS.indexOf(spelled[0]) - LETTERS.indexOf(tonic[0]) + 7) % 7) + 1;

  const ROLE_NAMES = ['root', '3rd', '5th', '7th'];
  const panelState = () => progState?.[overlayPanel] ?? null;
  // The progression's root chord: the chord built on the key's tonic (I / i), else its first chord
  const tonicChordName = () => {
    const st = panelState();
    const list = uniqueChords(st);
    const onTonic = list.find((c) => (c.tones ?? []).some((t, i) => (Number.isInteger(t.rank) ? t.rank : i) === 0 && t.pc === st?.key?.tonicPc));
    return (onTonic ?? list[0])?.name ?? null;
  };
  const uniqueChords = (st) => {
    const seen = new Map();
    for (const c of st?.chords ?? []) if (c && typeof c.name === 'string' && !seen.has(c.name)) seen.set(c.name, c);
    return [...seen.values()];
  };

  // Exact positions from the guitar chord panels (a chord shape, an octave shape, every place of one tone)
  let custom = null;                                 // {title, positions: Map 'string:fret' -> note}
  function overlayNotes() {
    const st = panelState();
    if (custom) return { st, custom: custom.positions, notes: new Map(), ringPc: custom.ringPc, chord: custom.chord ?? null };
    if (!st || !Array.isArray(st.chords)) return null;

    // One chord: only its tones, shaded by chord role like the piano (root 900, 3rd 700, 5th 500, 7th 300
    // = scale shades 1/3/5/7), white ring on the chord's root
    const chord = focusName ? uniqueChords(st).find((c) => c.name === focusName) : null;
    if (chord) {
      const notes = new Map();
      (chord.tones ?? []).forEach((t, i) => {
        if (!Number.isInteger(t.pc) || typeof t.spelled !== 'string' || notes.has(t.pc)) return;
        const rank = Math.min(Number.isInteger(t.rank) ? t.rank : i, 3);
        notes.set(t.pc, { pc: t.pc, spelled: t.spelled, degree: 1 + 2 * rank, rank, interval: t.interval ?? '', chords: [chord.name] });
      });
      const rootTone = (chord.tones ?? []).find((t, i) => (Number.isInteger(t.rank) ? t.rank : i) === 0);
      return { st, notes, ringPc: rootTone?.pc ?? null, chord };
    }

    const notes = new Map();                         // pc -> {pc, spelled, degree, chords}
    for (const c of st.chords) {
      for (const t of c.tones ?? []) {
        if (!Number.isInteger(t.pc) || typeof t.spelled !== 'string') continue;
        if (!notes.has(t.pc)) notes.set(t.pc, { pc: t.pc, spelled: t.spelled, degree: degreeOf(t.spelled, st.key.tonic), chords: [] });
        const n = notes.get(t.pc);
        if (!n.chords.includes(c.name)) n.chords.push(c.name);
      }
    }
    const ringPc = st.rootChord?.rootPc;
    // the root chord's root is always shown (ringed), even if the progression never plays it
    if (Number.isInteger(ringPc) && !notes.has(ringPc) && typeof st.rootChord.rootName === 'string') {
      notes.set(ringPc, { pc: ringPc, spelled: st.rootChord.rootName, degree: degreeOf(st.rootChord.rootName, st.key.tonic), chords: [] });
    }
    return { st, notes, ringPc, chord: null };
  }

  // octave -> shade lookup, taken from the piano when given so the two always match
  const octaveShades = (() => {
    const fromPiano = piano?.octaveColors?.();
    if (fromPiano instanceof Map && fromPiano.size) return fromPiano;
    const pal = globalThis.material_colors;
    const map = new Map();
    // DOM-clobbering guard: an element with id="material_colors" is not a plain object
    if (!pal || Object.getPrototypeOf(pal) !== Object.prototype) return map;
    OCTAVE_FAMILIES.forEach((fam, octave) => {
      map.set(octave, { family: fam, shade: (sh) => (HEX_RE.test(pal[fam]?.[sh] ?? '') ? pal[fam][sh] : '') });
    });
    return map;
  })();
  const dotColor = (midi, degree) => octaveShades.get(Math.floor(midi / 12) - 1)?.shade(DEGREE_SHADES[degree - 1]) || '';

  function dotEl(cx, cy, r, n, s, fret, ov) {
    const root = n.pc === ov.ringPc;
    const g = svgEl('g', {}, `gf-dot gf-deg-${n.degree}${root ? ' is-root' : ''}`);
    const color = dotColor(s.midi + fret, n.degree);
    if (color) {                                     // else the CSS fallback shades apply
      g.style.setProperty('--gf-dot-bg', color);
      g.style.setProperty('--gf-dot-fg', textOn(color));
    }
    const title = svgEl('title');
    const where = `${pretty(midiToNote(s.midi + fret))}, ${fret === 0 ? `string ${s.string} open` : `string ${s.string}, fret ${fret}`}`;
    const inChords = n.chords.length ? ` · in ${n.chords.join(', ')}` : '';
    title.textContent = ov.custom || ov.chord
      ? `${n.spelled} (${ROLE_NAMES[n.rank] ?? ''}${ov.chord ? ` of ${ov.chord.name}` : ''}${n.interval ? `, ${n.interval}` : ''}) · ${where}`
      : `${n.spelled} (degree ${n.degree}${root ? ', root' : ''}) · ${where}${inChords}`;
    const c = svgEl('circle', { cx: cx.toFixed(2), cy: cy.toFixed(2), r: r.toFixed(2) }, 'gf-dot-c');
    const t = svgEl('text', {
      x: cx.toFixed(2), y: cy.toFixed(2), 'text-anchor': 'middle', 'dominant-baseline': 'central',
      'font-size': Math.min(12, r * 0.95).toFixed(1),
    }, 'gf-dot-t');
    t.textContent = n.spelled;
    g.append(title, c, t);
    return g;
  }

  function refreshProgOptions() {
    const label = { root: 'Root', relative: 'Relative' };
    [...progSelect.options].forEach((o) => {
      const st = progState?.[o.value];
      o.textContent = st ? `${label[o.value]} – ${st.key.name}` : `${label[o.value]} progression`;
      o.title = st ? `${st.title} – ${st.key.name}` : '';
    });
    // no relative panel on the page -> fall back to the root progression
    if (progState && !progState[overlayPanel]) overlayPanel = progState.root ? 'root' : overlayPanel;
    progSelect.value = overlayPanel;
  }

  // Chord badges (same look as the progression panels' sequence badges)
  function renderBadges() {
    const chords = uniqueChords(panelState());
    if (focusName && !chords.some((c) => c.name === focusName)) focusName = null;   // chord left the progression
    const mk = (text, name, aria) => {
      const b = document.createElement('button');
      b.type = 'button';
      const on = !custom && focusName === name;
      b.className = `gf-badge${name === null ? ' gf-badge--all' : ''}${on ? ' is-active' : ''}`;
      b.textContent = text;
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', aria);
      b.addEventListener('click', () => api.focusChord(name === null || (!custom && focusName === name) ? null : name));
      return b;
    };
    badges.replaceChildren(...(chords.length
      ? [mk('All', null, 'Show every tone of the progression'), ...chords.map((c) => mk(c.name, c.name, `Show only the tones of ${c.name}`))]
      : []));
    badges.hidden = !chords.length;
  }

  const emitOverlay = () => {
    const ov = overlayNotes();
    emit('guitar:overlay', { panel: overlayPanel, key: ov?.st.key.name ?? null, chord: ov?.chord?.name ?? null,
      notes: ov ? [...ov.notes.values()].map((n) => n.spelled) : [] });
  };

  let warnedOldEvent = false;
  const onProgression = (e) => {
    const d = e.detail;
    if (!d || !('root' in d)) {
      if (!warnedOldEvent) {
        warnedOldEvent = true;
        console.warn("guitar-fretboard: 'progression:change' carries no chords — www/js/circle-o-5ths.js is older than guitar.js");
      }
      return;
    }
    const before = uniqueChords(panelState()).map((c) => c.name).join('|');
    progState = { root: d.root ?? null, relative: d.relative ?? null };
    refreshProgOptions();
    // a new chord set (other key or progression) starts again from All
    if (uniqueChords(panelState()).map((c) => c.name).join('|') !== before) { focusName = null; custom = null; }
    renderBadges();
    render();
  };
  document.addEventListener('progression:change', onProgression);

  let lastRange = null;
  function render() {
    const L = draw();
    container.classList.toggle('gf-compact', L.compact);
    controls.hidden = !L.compact;
    prevBtn.disabled = L.from <= 0;
    nextBtn.disabled = L.to >= maxFrets;
    rangeEl.textContent = `Frets ${L.from + 1} – ${L.to}`;
    const st = panelState();
    if (custom?.title) {
      status.textContent = custom.title;             // e.g. "C · first position" / "C in octave 3"
      status.title = custom.title;
    } else if (st) {
      status.textContent = `${st.key.name} · ${st.progression.name}`;
      status.title = `${st.title}: ${st.chords.map((c) => c.name).join(' – ')}`;
    } else {
      status.textContent = current.strings.map((s) => pitchName(s.note)).join(' ');   // low -> high (name is in the dropdown)
      status.title = current.description;
    }
    const key = `${L.from}-${L.to}-${L.compact}`;
    if (key !== lastRange) {
      lastRange = key;
      emit('guitar:rerender', { from: L.from, to: L.to, compact: L.compact });
    }
  }

  // redraw on width changes (coalesced to one per frame) and on the narrow/wide switch
  let raf = 0;
  let lastWidth = 0;
  const ro = new ResizeObserver(() => {
    const w = Math.floor(stage.clientWidth);
    if (w === lastWidth) return;
    lastWidth = w;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(render);
  });
  const onMedia = () => render();
  mql.addEventListener('change', onMedia);

  // --- public API -------------------------------------------------------------
  const api = {
    element: container,
    version: CSS_VERSION,
    tunings: () => tunings.map((t) => ({ name: t.name, alias: t.alias, description: t.description })),
    tuning: () => ({ name: current.name, alias: current.alias, description: current.description,
      strings: current.strings.map((s) => ({ string: s.string, note: s.note })) }),
    setTuning(name) {
      const t = tunings.find((x) => x.name === name);
      if (!t) { console.warn(`guitar-fretboard: unknown tuning "${name}"`); return false; }
      if (t === current) return true;
      current = t;
      select.value = t.name;
      custom = null;                                 // string/fret positions belong to the old tuning
      renderBadges();
      render();
      emit('guitar:tuning', api.tuning());
      return true;
    },
    /** Note at a string (1–6) and fret (0 = open), e.g. noteAt(6, 3) -> 'G2' in Standard. */
    noteAt(string, fret) {
      const s = current.strings.find((x) => x.string === string);
      return s && Number.isInteger(fret) && fret >= 0 && fret <= maxFrets ? midiToNote(s.midi + fret) : null;
    },
    /** Every position of a note ('G3' = that exact pitch) or pitch class (0–11) on the neck. */
    positionsOf(noteOrPc) {
      const exact = typeof noteOrPc === 'string' ? noteToMidi(noteOrPc) : null;
      const pc = typeof noteOrPc === 'number' ? ((noteOrPc % 12) + 12) % 12 : null;
      const out = [];
      for (const s of current.strings) {
        for (let f = 0; f <= maxFrets; f++) {
          const m = s.midi + f;
          if ((exact !== null && m === exact) || (pc !== null && m % 12 === pc)) out.push({ string: s.string, fret: f, note: midiToNote(m) });
        }
      }
      return out;
    },
    range: () => {
      const compact = mql.matches;
      const from = compact ? clampStart(winStart) : 0;
      return { from, to: from + (compact ? winFrets : maxFrets), compact };
    },
    shiftFrets(dir) {
      const next = clampStart(winStart + Math.sign(dir) * Math.max(1, shiftStep));
      if (next === winStart) return;
      winStart = next;
      if (mql.matches) render();
    },
    /** Narrow screens: show the window starting at this fret line (0 = nut). */
    showFrets(fromFret) {
      winStart = clampStart(Math.floor(fromFret) || 0);
      if (mql.matches) render();
    },
    /** Progression overlay: 'root' | 'relative' (always one of the two). Shows that progression's root chord. */
    setOverlay(panel) {
      if (!PANELS.includes(panel)) { console.warn(`guitar-fretboard: overlay must be 'root' or 'relative', not "${panel}"`); return false; }
      if (progState && !progState[panel]) { console.warn(`guitar-fretboard: no ${panel} progression on the page`); return false; }
      overlayPanel = panel;
      custom = null;
      focusName = tonicChordName();                  // other panel: start on its root chord (cleaner than All)
      progSelect.value = panel;
      renderBadges();
      render();
      emitOverlay();
      return true;
    },
    /** Show only one chord's tones (its name as on the badge), or null for All. */
    focusChord(name) {
      const next = name && uniqueChords(panelState()).some((c) => c.name === name) ? name : null;
      if (name && !next) console.warn(`guitar-fretboard: "${name}" is not in the ${overlayPanel} progression`);
      focusName = next;
      custom = null;
      renderBadges();
      render();
      emitOverlay();
      return next;
    },
    overlay() {
      const ov = overlayNotes();
      return { panel: overlayPanel, key: ov?.st.key.name ?? null, chord: ov?.chord?.name ?? null, ringPc: ov?.ringPc ?? null,
        notes: ov ? [...ov.notes.values()].map((n) => ({ ...n, chords: [...n.chords] })) : [] };
    },
    /**
     * Show exact positions (from the guitar chord panels): [{string 1–6, fret, spelled, rank, interval?}].
     * Colours: the piano's octave colour of each sounding pitch at its chord-role shade; rank 0 gets the ring.
     * Narrow screens move the 12-fret window so the shape is in view.
     */
    showPositions(list, { title = '', chord = null } = {}) {
      const positions = new Map();
      let ringPc = null;
      for (const p of list ?? []) {
        const s = current.strings.find((x) => x.string === p.string);
        if (!s || !Number.isInteger(p.fret) || p.fret < 0 || p.fret > maxFrets) continue;
        const rank = Math.min(Math.max(Number(p.rank) || 0, 0), 3);
        const pc = (s.midi + p.fret) % 12;
        if (rank === 0) ringPc = pc;
        positions.set(`${p.string}:${p.fret}`, { pc, spelled: String(p.spelled ?? pitchName(midiToNote(s.midi + p.fret))), degree: 1 + 2 * rank, rank, interval: p.interval ?? '', chords: [] });
      }
      custom = { positions, ringPc, chord: chord ? { name: String(chord) } : null, title };
      const frets = [...positions.keys()].map((k) => Number(k.split(':')[1])).filter((f) => f > 0);
      if (frets.length && mql.matches) {
        const lo = Math.min(...frets); const hi = Math.max(...frets);
        if (lo <= clampStart(winStart) || hi > clampStart(winStart) + winFrets) winStart = clampStart(lo - 1);
      }
      renderBadges();
      render();
      if (title) status.textContent = title;
      emit('guitar:positions', { title, count: positions.size });
      return positions.size;
    },
    clearPositions() {
      if (!custom) return;
      custom = null;
      renderBadges();
      render();
    },
    get maxFret() { return maxFrets; },
    isCompact: () => mql.matches,
    destroy() {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      stickyEl?.classList.remove('gf-sticky');
      document.removeEventListener('progression:change', onProgression);
      ro.disconnect();
      cancelAnimationFrame(raf);
      mql.removeEventListener('change', onMedia);
      container.replaceChildren();
      container.classList.remove('gf', 'gf-compact');
    },
  };

  refreshProgOptions();
  focusName = progState ? tonicChordName() : null;   // page load: the root progression's root chord (C), badge lit
  renderBadges();
  render();
  lastWidth = Math.floor(stage.clientWidth);
  ro.observe(stage);

  // --- sticky: the fretboard pins to the top of the window; as it scrolls up to the pinned piano it
  // pushes the keyboard up (the keyboard's bottom edge follows the fretboard's top edge) and takes over.
  // Scrolling back down reverses it. Same climbing rule as the piano (stickyTargetFor in piano.js).
  let stickyEl = null;
  let raf2 = 0;
  const pianoSticky = piano?.stickyElement?.() ?? null;
  const pianoTop = piano?.stickyTop?.() ?? 0;
  function onScroll() {
    cancelAnimationFrame(raf2);
    raf2 = requestAnimationFrame(() => {
      if (!stickyEl || !pianoSticky) return;
      const gTop = stickyEl.getBoundingClientRect().top;
      const h = pianoSticky.offsetHeight;
      piano.setStickyTop(Math.min(pianoTop, gTop - h));   // keyboard bottom never overlaps the fretboard
    });
  }
  if (sticky) {
    stickyEl = stickyTargetFor(container);
    if (pianoSticky && (stickyEl === pianoSticky || stickyEl.contains(pianoSticky) || pianoSticky.contains(stickyEl))) {
      console.warn('guitar-fretboard: the fretboard and the piano share one sticky element — put them in separate rows to hand off');
    } else {
      stickyEl.classList.add('gf-sticky');
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll, { passive: true });
      onScroll();
    }
  }
  return api;
}

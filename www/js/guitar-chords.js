// =============================================================================
// guitar-chords.js — guitar versions of the progression panels and chord panels
//
// Same layout as the piano panels (circle-o-5ths.js / piano-chords.js, same CSS classes), with a
// guitar chord diagram (first position, ultimate-guitar style) instead of the one-octave keyboard,
// and guitar octave rows. Clicks drive the fretboard only (silent):
//   chord badge / diagram -> that first-position shape on the fretboard
//   tone circle           -> every place that tone occurs on the neck
//   octave row label      -> one playable shape of the chord in that octave; a row dot -> that note
// Shapes are computed for the fretboard's current tuning and checked for playability; a chord or
// octave with no playable shape is never drawn.
//
// Data: the progression panels' own chords (renderCircleProgressions state() / 'progression:change')
// and the chord panels ('chord:panels' / currentPanels) — never recomputed here.
// Colours: the piano's octave colour of each sounding pitch at its chord-role shade
// (piano.roleColor) — the same colours as the fretboard's dots.
// =============================================================================

import { midiToNote, noteToMidi } from './piano-audio.js';
import { textOn } from './piano.js';
import { currentPanels } from './piano-chords.js';

export const VERSION = 1;
const SVG_NS = 'http://www.w3.org/2000/svg';

// --- playability ------------------------------------------------------------------------------
// strings: open-string MIDI numbers, lowest string first. frets: per string, -1 = muted, 0 = open.
export function fingersFor(frets) {
  const fretted = frets.map((f, i) => ({ f, i })).filter((x) => x.f > 0);
  if (!fretted.length) return { fingers: 0, barre: null };
  const minF = Math.min(...fretted.map((x) => x.f));
  const atMin = fretted.filter((x) => x.f === minF).map((x) => x.i);
  if (atMin.length >= 2) {
    const a = atMin[0];
    const z = atMin[atMin.length - 1];
    let ok = true;
    for (let i = a; i <= z; i++) if (!(frets[i] >= minF)) ok = false;   // an open or muted string under the barre: impossible
    const withBarre = 1 + fretted.filter((x) => x.f > minF).length;
    if (ok && withBarre < fretted.length) return { fingers: withBarre, barre: { fret: minF, from: a, to: z } };
  }
  return { fingers: fretted.length, barre: null };
}

/**
 * A shape is playable when: no muted string sits between sounding strings; at least 3 strings sound
 * (and at least as many as the chord has notes); every chord tone sounds (a four-note chord may drop
 * its perfect 5th, as guitarists do) and nothing else does; the root is the lowest note; fretted notes
 * span at most 4 frets; at most 4 fingers are needed (one barre counts as one finger).
 */
export function checkShape(frets, strings, tones, { maxSpan = 3, maxFingers = 4 } = {}) {
  const sounding = frets.map((f, i) => (f >= 0 ? i : -1)).filter((i) => i >= 0);
  if (sounding.length < Math.max(3, new Set(tones.map((t) => t.pc)).size)) return null;
  for (let i = sounding[0]; i <= sounding[sounding.length - 1]; i++) if (frets[i] < 0) return null;
  const midis = sounding.map((i) => strings[i] + frets[i]);
  const pcs = new Set(midis.map((m) => m % 12));
  const omittable = tones.length === 4 ? tones.find((t) => t.rank === 2 && t.semitones === 7) : null;
  let omitted = false;
  for (const t of tones) {
    if (pcs.has(t.pc)) continue;
    if (t === omittable) { omitted = true; continue; }
    return null;
  }
  for (const pc of pcs) if (!tones.some((t) => t.pc === pc)) return null;
  const root = tones.find((t) => t.rank === 0);
  if (!root || Math.min(...midis) % 12 !== root.pc) return null;
  const fr = frets.filter((f) => f > 0);
  if (fr.length && Math.max(...fr) - Math.min(...fr) > maxSpan) return null;
  const { fingers, barre } = fingersFor(frets);
  if (fingers > maxFingers) return null;
  return {
    frets: [...frets], fingers, barre, omitted,
    unisons: midis.length - new Set(midis).size,
    sounding: sounding.length,
    low: fr.length ? Math.min(...fr) : 0,
    high: fr.length ? Math.max(...fr) : 0,
  };
}

// First position: within frets 0–4 when possible; then more strings, fewer fingers, open strings,
// smaller stretch; drop unusual doublings and omitted 5ths last.
export function scoreShape(s) {
  const opens = s.frets.filter((f) => f === 0).length;
  const span = s.high - s.low;
  const pos = s.high <= 4 ? 0 : 20 + s.low * 3;
  return pos + s.low * 1.5 + s.fingers + span * 1.5 + (span === 3 ? 2 : 0) - s.sounding * 2 - opens * 0.5
    + (s.barre ? 1 : 0) + s.unisons * 2.5 + (s.omitted ? 3 : 0);
}

export function firstPositionShape(strings, tones, { maxFret = 15 } = {}) {
  const pcs = new Set(tones.map((t) => t.pc));
  const options = strings.map((s) => {
    const o = [-1];
    for (let f = 0; f <= maxFret; f++) if (pcs.has((s + f) % 12)) o.push(f);
    return o;
  });
  let best = null;
  let bestScore = Infinity;
  const cur = new Array(strings.length);
  (function walk(i) {
    if (i === strings.length) {
      const shape = checkShape(cur, strings, tones);
      if (shape) { const sc = scoreShape(shape); if (sc < bestScore) { best = shape; bestScore = sc; } }
      return;
    }
    for (const f of options[i]) {
      if (f > 0) {
        const fr = cur.slice(0, i).filter((x) => x > 0);
        if (fr.length && Math.max(...fr, f) - Math.min(...fr, f) > 3) continue;
      }
      cur[i] = f;
      walk(i + 1);
    }
  })(0);
  return best;
}

/**
 * One playable shape of exactly these pitches (root-position close voicing in one octave):
 * one note per string on adjacent strings, low to high, fretted notes within 4 frets.
 * The lowest, most compact fingering wins. null when the guitar cannot play it.
 */
export function octaveShape(strings, midis, { maxFret = 24 } = {}) {
  const sorted = [...midis].sort((a, b) => a - b);
  let best = null;
  for (let start = 0; start + sorted.length <= strings.length; start++) {
    const frets = sorted.map((m, k) => m - strings[start + k]);
    if (frets.some((f) => f < 0 || f > maxFret)) continue;
    const fr = frets.filter((f) => f > 0);
    const span = fr.length ? Math.max(...fr) - Math.min(...fr) : 0;
    if (span > 3) continue;
    const score = span * 2 + (fr.length ? Math.max(...fr) : 0) * 0.5;
    if (!best || score < best.score) {
      const full = strings.map((_, i) => (i >= start && i < start + sorted.length ? frets[i - start] : -1));
      best = { frets: full, score };
    }
  }
  return best;
}

// --- module --------------------------------------------------------------------------------------
const getHost = (id) => {
  const el = id ? document.getElementById(id) : null;
  return el instanceof HTMLElement && !(el instanceof HTMLFormElement) ? el : null;
};
function waitForHost(id, timeoutMs = 5000) {
  const now = getHost(id);
  if (now || !id) return Promise.resolve(now);
  return new Promise((resolve) => {
    const obs = new MutationObserver(() => {
      const el = getHost(id);
      if (el) { obs.disconnect(); clearTimeout(timer); resolve(el); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(() => { obs.disconnect(); resolve(getHost(id)); }, timeoutMs);
  });
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const svgEl = (tag, attrs = {}, cls) => {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (cls) n.setAttribute('class', cls);
  return n;
};

/**
 * @param {object} opts
 * @param {object} opts.guitar          API returned by renderGuitarFretboard (tuning, showPositions)
 * @param {object} opts.piano           API returned by renderPianoKeyboard (octave colours)
 * @param {object} opts.progressions    API returned by renderCircleProgressions (state())
 * @param {string} opts.target          root progressions container id (required)
 * @param {string} opts.relativeTarget  relative progressions container id (omit = not shown)
 * @param {string} opts.dataTarget      root chord panel container id (omit = not shown)
 * @param {string} opts.relativeDataTarget relative chord panel container id (omit = not shown)
 * No default ids: every element id is named by the caller (dashboard.js), matching index.html.
 * @returns {Promise<{refresh, destroy}|null>}
 * Emits on document: 'guitar-chords:show' detail {title}
 */
export async function renderGuitarProgressions(opts = {}) {
  const { guitar, piano, progressions, target = null, relativeTarget = null, dataTarget = null, relativeDataTarget = null } = opts;
  if (!guitar || !piano) throw new TypeError('guitar-chords: guitar and piano are required');
  if (!target) {
    console.error('guitar-chords: opts.target is required (the id of the root guitar progressions element) — guitar progressions not shown');
    return null;
  }
  for (const [name, v] of [['relativeTarget', relativeTarget], ['dataTarget', dataTarget], ['relativeDataTarget', relativeDataTarget]]) {
    if (!v) console.warn(`guitar-chords: opts.${name} not given — that panel is not shown`);
  }
  const [host, relHost, dataHost, relDataHost] = await Promise.all([target, relativeTarget, dataTarget, relativeDataTarget].map((id) => (id ? waitForHost(id) : null)));
  if (!host) {
    console.error(`guitar-chords: no element with id "${target}" (opts.target) — guitar progressions not shown`);
    return null;
  }
  [[relativeTarget, relHost], [dataTarget, dataHost], [relativeDataTarget, relDataHost]].forEach(([id, h]) => {
    if (id && !h) console.warn(`guitar-chords: no element with id "${id}" — that panel is not shown`);
  });
  if (typeof progressions?.state !== 'function') {
    console.warn('guitar-chords: the progressions object has no state() — www/js/circle-o-5ths.js is older than guitar-chords.js');
  }

  const strings = () => guitar.tuning().strings.map((s) => noteToMidi(s.note));   // lowest string first
  const stringNo = (i) => strings().length - i;                                     // index 0 -> string 6
  const maxFret = () => guitar.maxFret ?? 24;

  // --- shapes for one chord (cached per tuning) ---------------------------------------------------
  const cache = new Map();
  function shapeOf(chord) {
    const tun = strings().join(',');
    const key = `${tun}|${chord.name}|${chord.tones.map((t) => t.pc).join(',')}`;
    if (!cache.has(key)) cache.set(key, firstPositionShape(strings(), chord.tones));
    return cache.get(key);
  }
  // sounding notes of a shape, each with its chord tone
  function voicing(shape, chord) {
    const st = strings();
    return shape.frets.map((f, i) => {
      if (f < 0) return null;
      const midi = st[i] + f;
      const tone = chord.tones.find((t) => t.pc === midi % 12);
      return { i, string: stringNo(i), fret: f, midi, note: midiToNote(midi), ...tone };
    }).filter(Boolean);
  }
  const colourOf = (note, rank) => piano.roleColor(note, rank) || '#555';

  // --- active states ------------------------------------------------------------------------------
  const roots = [];
  const clearActive = () => roots.forEach((r) => {
    r.querySelectorAll('.is-active').forEach((n) => n.classList.remove('is-active'));
    r.querySelectorAll('.card.border-primary').forEach((n) => n.classList.remove('border-primary'));
  });
  function show(list, title, chordName, activate = []) {
    clearActive();
    for (const n of activate) n?.classList.add('is-active');
    guitar.showPositions(list, { title, chord: chordName });
    document.dispatchEvent(new CustomEvent('guitar-chords:show', { detail: { title } }));
  }
  // the fretboard's own header controls take over: clear the panels' active marks
  const onOverlay = () => clearActive();
  guitar.element.addEventListener('guitar:overlay', onOverlay);

  // --- chord diagram (ultimate-guitar style): strings vertical, low string left ------------------------
  function diagram(chord, shape, onClick) {
    if (!shape) {
      const none = el('div', 'gd-none', 'No playable first-position shape in this tuning');
      return none;
    }
    const btn = el('button', 'gd');
    btn.type = 'button';
    const v = voicing(shape, chord);
    btn.setAttribute('aria-label', `${chord.name} chord shape: ${shape.frets.map((f) => (f < 0 ? 'x' : f)).join(' ')} — show on the fretboard`);
    btn.title = `${chord.name}: ${shape.frets.map((f) => (f < 0 ? 'x' : f)).join('')}`;
    const n = shape.frets.length;
    const base = shape.high <= 4 ? 1 : shape.low;                 // first fret row shown
    const W = 150; const X0 = 27; const DX = (W - X0 - 15) / (n - 1);
    const Y0 = 30; const DY = 26; const ROWS = 4;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${Y0 + ROWS * DY + 8}`, role: 'img', 'aria-hidden': 'true' }, 'gd-svg');
    const x = (i) => X0 + i * DX;
    const y = (f) => Y0 + (f - base + 0.5) * DY;
    // frets + strings
    for (let r = 0; r <= ROWS; r++) svg.append(svgEl('line', { x1: x(0), y1: Y0 + r * DY, x2: x(n - 1), y2: Y0 + r * DY }, 'gd-fret'));
    for (let i = 0; i < n; i++) svg.append(svgEl('line', { x1: x(i), y1: Y0, x2: x(i), y2: Y0 + ROWS * DY }, 'gd-string'));
    if (base === 1) svg.append(svgEl('rect', { x: x(0) - 1.5, y: Y0 - 4, width: x(n - 1) - x(0) + 3, height: 5, rx: 1 }, 'gd-nut'));
    else {
      const t = svgEl('text', { x: x(0) - 8, y: y(base), 'text-anchor': 'end', 'dominant-baseline': 'central' }, 'gd-base');
      t.textContent = `${base}fr`;
      svg.append(t);
    }
    // barre behind the dots
    if (shape.barre) {
      svg.append(svgEl('rect', { x: x(shape.barre.from) - 9, y: y(shape.barre.fret) - 8, width: x(shape.barre.to) - x(shape.barre.from) + 18, height: 16, rx: 8 }, 'gd-barre'));
    }
    // muted / open markers above the nut, fretted dots on the frets
    shape.frets.forEach((f, i) => {
      if (f < 0) {
        const t = svgEl('text', { x: x(i), y: Y0 - 14, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, 'gd-mute');
        t.textContent = '×';
        svg.append(t);
      }
    });
    for (const s of v) {
      const colour = colourOf(s.note, s.rank);
      const cy = s.fret === 0 ? Y0 - 14 : y(s.fret);
      const r = s.fret === 0 ? 8 : 10;
      const g = svgEl('g', {}, `gd-dot${s.rank === 0 ? ' is-root' : ''}`);
      g.append(svgEl('circle', { cx: x(s.i), cy, r, fill: colour }, 'gd-dot-c'));
      const t = svgEl('text', { x: x(s.i), cy, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: textOn(colour) }, 'gd-dot-t');
      t.setAttribute('font-size', s.fret === 0 ? '8' : '9.5');
      t.textContent = s.spelled;
      g.append(t);
      svg.append(g);
    }
    btn.append(svg);
    btn.addEventListener('click', () => onClick(btn));
    return btn;
  }

  // --- chord section pieces -------------------------------------------------------------------------
  function shapeList(chord, shape) {
    return voicing(shape, chord).map((s) => ({ string: s.string, fret: s.fret, spelled: s.spelled, rank: s.rank, interval: s.interval }));
  }
  function toneCircles(chord, shape, label, card) {
    const row = el('div', 'cd-tones');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', `${chord.name} chord tones`);
    const v = shape ? voicing(shape, chord) : [];
    for (const t of chord.tones) {
      const item = el('div', 'cd-tone');
      const btn = el('button', `cd-circle${t.rank === 0 ? ' is-root' : ''}`, t.spelled);
      btn.type = 'button';
      btn.setAttribute('aria-label', `Show every ${t.spelled} (${t.interval} of ${chord.name}) on the fretboard`);
      // colour: the tone's lowest sounding pitch in the shape (as on the fretboard); octave 3 if the shape drops it
      const sounding = v.filter((s) => s.pc === t.pc).sort((a, b) => a.midi - b.midi)[0];
      const colour = colourOf(sounding ? sounding.note : midiToNote(48 + t.pc), t.rank);
      btn.style.setProperty('--cd-circle-bg', colour);
      btn.style.setProperty('--cd-circle-fg', textOn(colour));
      btn.addEventListener('click', () => {
        const st = strings();
        const list = [];
        st.forEach((open, i) => { for (let f = 0; f <= maxFret(); f++) if ((open + f) % 12 === t.pc) list.push({ string: stringNo(i), fret: f, spelled: t.spelled, rank: t.rank, interval: t.interval }); });
        show(list, `${label} · ${t.spelled} (${t.interval})`, chord.name, [btn, card]);
        card?.classList.add('border-primary');
      });
      item.append(el('div', 'cd-degree', t.interval), btn);
      row.append(item);
    }
    return row;
  }
  // Octave rows: only octaves with a playable shape; label -> that shape, dot -> that one note
  function octaveRows(chord, label, card) {
    const wrapEl = el('div', 'cd-octaves');
    wrapEl.setAttribute('role', 'group');
    wrapEl.setAttribute('aria-label', `${chord.name} in each octave on the guitar`);
    const st = strings();
    const octaveColors = piano.octaveColors();
    for (let oct = 1; oct <= 7; oct++) {
      const rootMidi = (oct + 1) * 12 + chord.rootPc;
      const voiced = chord.tones.map((t) => ({ ...t, midi: rootMidi + t.semitones, note: midiToNote(rootMidi + t.semitones) }));
      const shape = octaveShape(st, voiced.map((t) => t.midi), { maxFret: maxFret() });
      if (!shape) continue;
      const pos = shape.frets.map((f, i) => (f < 0 ? null : { i, string: stringNo(i), fret: f, midi: st[i] + f })).filter(Boolean);
      const at = (t) => pos.find((p) => p.midi === t.midi);
      const pill = el('div', 'cd-octave-pill');
      pill.setAttribute('role', 'group');
      pill.setAttribute('aria-label', `${chord.name} in octave ${oct}`);
      const oc = octaveColors.get(oct);
      if (oc) pill.style.setProperty('--cd-octave-bg', oc.light);
      const lab = el('button', 'cd-octave-label', `${chord.rootName}${oct}`);
      lab.type = 'button';
      lab.setAttribute('aria-label', `Show ${chord.name} in octave ${oct} on the fretboard: ${voiced.map((t) => t.note).join(', ')}`);
      lab.addEventListener('click', () => {
        show(voiced.map((t) => ({ string: at(t).string, fret: at(t).fret, spelled: t.spelled, rank: t.rank, interval: t.interval })),
          `${chord.name} · octave ${oct}`, chord.name, [pill, card]);
        card?.classList.add('border-primary');
      });
      pill.append(lab);
      for (const t of voiced) {
        const b = el('button', 'cd-octave-note');
        b.type = 'button';
        const p = at(t);
        b.title = `${t.interval}: ${t.note} — string ${p.string}, fret ${p.fret}`;
        b.setAttribute('aria-label', `Show ${t.spelled} (${t.interval}) — ${t.note} on string ${p.string}, fret ${p.fret}`);
        const dot = el('span', `cd-octave-dot${t.rank === 0 ? ' is-root' : ''}`, t.spelled);
        const colour = colourOf(t.note, t.rank);
        dot.style.setProperty('--cd-dot-bg', colour);
        dot.style.setProperty('--cd-dot-fg', textOn(colour));
        b.append(dot);
        b.addEventListener('click', () => {
          show([{ string: p.string, fret: p.fret, spelled: t.spelled, rank: t.rank, interval: t.interval }],
            `${t.spelled}${oct} (${t.interval}) · string ${p.string}, fret ${p.fret}`, chord.name, [b, card]);
          card?.classList.add('border-primary');
        });
        pill.append(b);
      }
      wrapEl.append(pill);
    }
    if (!wrapEl.children.length) wrapEl.append(el('div', 'gd-none', 'No playable octave shapes in this tuning'));
    return wrapEl;
  }
  // badge + tones + diagram + octave rows (cards and chord panels share it)
  function chordBody(chord, label, card) {
    const shape = shapeOf(chord);
    const showShape = (trigger) => {
      if (!shape) return;
      show(shapeList(chord, shape), `${chord.name} · first position`, chord.name, [trigger, card]);
      card?.classList.add('border-primary');
    };
    const badge = el('button', 'cd-name', chord.name);
    badge.type = 'button';
    badge.setAttribute('aria-label', `Show the ${chord.name} shape on the fretboard`);
    badge.addEventListener('click', () => showShape(badge));
    return { badge, showShape, parts: [toneCircles(chord, shape, label, card), diagram(chord, shape, showShape), octaveRows(chord, label, card)] };
  }

  // --- progression panels (same markup as circle-o-5ths.js) -----------------------------------------
  function buildPanel(hostEl, variant) {
    const wrap = el('div', variant === 'relative' ? 'cp cp--relative cp--guitar' : 'cp cp--guitar');
    const title = variant === 'relative' ? el('div', 'cp-title') : null;
    const head = el('div', 'cp-head');
    const keyBox = el('div', 'cp-key');
    const controls = el('div', 'cp-controls');
    const note = el('div', 'cp-note');
    note.hidden = true;
    const seq = el('div', 'cp-roman');
    seq.setAttribute('role', 'group');
    seq.setAttribute('aria-label', 'Chosen progression chords');
    const desc = el('div', 'cp-desc');
    const cards = el('div', 'row cp-cards');
    head.append(keyBox, controls);
    if (title) wrap.append(title);
    wrap.append(head, note, seq, desc, cards);
    hostEl.append(wrap);
    roots.push(wrap);
    new ResizeObserver(() => layoutCards(cards)).observe(cards);
    return { wrap, title, keyBox, controls, note, seq, desc, cards };
  }
  function layoutCards(cards) {
    const cols = [...cards.children];
    if (!cols.length) return;
    const tones = Number(cards.dataset.tones) || 3;
    const minCol = Math.max(200, 125 + 34 * tones);   // diagram width / octave rows (SYNC: .cd--compact sizes)
    const perRow = Math.max(1, Math.min(cols.length, Math.floor(cards.clientWidth / minCol)));
    const pct = `${100 / perRow}%`;
    for (const c of cols) { c.style.flex = `0 0 ${pct}`; c.style.maxWidth = pct; }
  }
  function renderPanel(panel, st) {
    if (!st) return;
    if (panel.title) panel.title.textContent = `${st.title} Progression`;
    const kv = (cls, label, value) => { const row = el('div', cls); row.append(el('span', 'cp-kv-label', label), el('span', 'cp-kv-value', value)); return row; };
    panel.keyBox.replaceChildren(kv('cp-key-name', 'Key:', st.key.name), kv('cp-key-signature', 'Signature:', st.signature ?? ''));
    // controls: "Progression" (static) + the badge chord ("Relative Minor: Am" / "Root Chord: C")
    const box = el('div', 'cp-choose');
    box.append(el('span', 'cp-choose-text', 'Progression'), el('div', 'cp-static', st.progression.name));
    const items = [box];
    if (st.badge) {
      const row = el('div', 'cp-rel');
      const b = el('button', 'cp-rel-badge', st.badge.chord.name);
      b.type = 'button';
      b.setAttribute('aria-label', `Show the ${st.badge.chord.name} shape on the fretboard`);
      b.addEventListener('click', () => {
        const shape = shapeOf(st.badge.chord);
        if (shape) show(shapeList(st.badge.chord, shape), `${st.badge.chord.name} · first position`, st.badge.chord.name, [b]);
      });
      row.append(el('span', 'cp-rel-label', st.badge.label), b);
      items.push(row);
    }
    panel.controls.replaceChildren(...items);
    panel.note.textContent = st.note ?? '';
    panel.note.hidden = !st.note;
    panel.desc.textContent = st.description ?? '';
    // cards
    panel.cards.replaceChildren();
    panel.cards.dataset.tones = String(Math.max(...st.chords.map((c) => c.tones.length)));
    const shows = [];
    st.chords.forEach((chord) => {
      const col = el('div', 'col-12 mb-3 cp-col');
      const card = el('div', 'card h-100 cp-card');
      const body = el('div', 'card-body cd cd--compact');
      const rn = el('span', 'cp-card-roman', chord.roman);
      const label = `${st.title} ${chord.roman}: ${chord.name}`;
      const { badge, showShape, parts } = chordBody(chord, label, card);
      body.append(rn, badge, ...parts);
      card.append(body);
      col.append(card);
      panel.cards.append(col);
      shows.push(showShape);
    });
    layoutCards(panel.cards);
    // sequence badges, in order (every bar for bar-based forms)
    panel.seq.replaceChildren();
    st.sequence.order.forEach((idx, i) => {
      const chord = st.chords[idx];
      if (!chord) return;
      if (i > 0) { const sep = el('span', 'cp-seq-sep', st.sequence.bars ? '|' : '–'); sep.setAttribute('aria-hidden', 'true'); panel.seq.append(sep); }
      const b = el('button', 'cp-seq-badge', chord.name);
      b.type = 'button';
      b.setAttribute('aria-label', `${st.sequence.bars ? `Bar ${i + 1}: ` : ''}show the ${chord.name} shape on the fretboard`);
      b.addEventListener('click', () => shows[idx](b));
      panel.seq.append(b);
    });
  }

  // --- chord panels (same markup as piano-chords.js) ------------------------------------------------
  function chordPanel(hostEl, relative) {
    if (!hostEl) return null;
    hostEl.classList.add('cd-host');
    const panel = el('div', relative ? 'cd cd-relative cd--guitar' : 'cd cd--guitar');
    hostEl.append(panel);
    roots.push(panel);
    return panel;
  }
  function renderChordPanel(panel, info, title) {
    if (!panel) return;
    panel.replaceChildren();
    panel.hidden = !info;
    if (!info) return;
    const chord = { name: info.name, rootName: info.rootName, rootPc: info.root,
      tones: info.tones.map((t) => ({ pc: t.pc, spelled: t.spelled, rank: t.rank, interval: t.degree, semitones: t.semitones })) };
    const { badge, parts } = chordBody(chord, `${title} Chord ${chord.name}`, null);
    panel.append(el('div', 'cd-title', title), badge, ...parts);
  }

  // --- wiring ----------------------------------------------------------------------------------------
  const rootPanel = buildPanel(host, 'root');
  const relPanel = relHost ? buildPanel(relHost, 'relative') : null;
  const dataPanel = chordPanel(dataHost, false);
  const relDataPanel = chordPanel(relDataHost, true);
  let progState = progressions?.state?.() ?? null;
  let panels = currentPanels();

  function refresh() {
    if (progState) {
      renderPanel(rootPanel, progState.root);
      if (relPanel) renderPanel(relPanel, progState.relative);
    }
    if (panels) {
      renderChordPanel(dataPanel, panels.root, 'Root Chord');
      renderChordPanel(relDataPanel, panels.minor, panels.relation === 'major' ? 'Relative Major' : 'Relative Minor');
    }
  }
  const onProgression = (e) => { if (e.detail && 'root' in e.detail) { progState = { root: e.detail.root, relative: e.detail.relative }; refresh(); } };
  const onPanels = (e) => { panels = e.detail; refresh(); };
  const onTuning = () => { cache.clear(); refresh(); };          // shapes belong to the tuning
  document.addEventListener('progression:change', onProgression);
  document.addEventListener('chord:panels', onPanels);
  guitar.element.addEventListener('guitar:tuning', onTuning);
  refresh();

  return {
    refresh,
    destroy() {
      document.removeEventListener('progression:change', onProgression);
      document.removeEventListener('chord:panels', onPanels);
      guitar.element.removeEventListener('guitar:tuning', onTuning);
      guitar.element.removeEventListener('guitar:overlay', onOverlay);
      roots.forEach((r) => r.remove());
    },
  };
}

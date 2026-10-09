// =============================================================================
// guitar-chords.js — guitar versions of the progression panels and chord panels
//
// Same layout as the piano panels (circle-o-5ths.js / piano-chords.js, same CSS classes), with a
// guitar chord diagram (ultimate-guitar style) instead of the one-octave keyboard. Clicks drive the
// fretboard only (silent):
//   chord badge / sequence badge -> every occurrence of the chord's tones on the neck, exactly like the
//                                   fretboard's own header badges (role shades, ring on the root)
//   tone circle                  -> every place that tone occurs on the neck
//   diagram                      -> the voicing in the diagram, on the fretboard
//   octave rows [C3 (C)(E)(G)…]  -> one row per octave of the voicing's lowest note; label = that voicing on
//                                   the fretboard and in the diagram, a circle = that one note
//   1 —●— N slider under a row   -> that octave's voicings, nut to high frets: drag, click the rail,
//                                   or tap 1 / N to step back / forward (arrow keys too)
// Voicings are computed for the fretboard's current tuning and checked for playability (checkShape);
// nothing unplayable is ever drawn.
//
// Data: the progression panels' own chords (renderCircleProgressions state() / 'progression:change')
// and the chord panels ('chord:panels' / currentPanels) — never recomputed here.
// Colours: the piano's octave colour of each sounding pitch at its chord-role shade
// (piano.roleColor) — the same colours as the fretboard's dots.
// =============================================================================

import { midiToNote, noteToMidi } from './piano-audio.js';
import { textOn } from './piano.js';
import { currentPanels } from './piano-chords.js';

export const VERSION = 4;                 // 4: one voicing row + small slider per octave; 3: neck order; 2: playableShapes
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

// every per-string fret choice in the chord's pitch classes; fretted notes kept within maxSpan
function walkShapes(strings, tones, maxFret, visit, maxSpan = 3) {
  const pcs = new Set(tones.map((t) => t.pc));
  const options = strings.map((s) => {
    const o = [-1];
    for (let f = 0; f <= maxFret; f++) if (pcs.has((s + f) % 12)) o.push(f);
    return o;
  });
  const cur = new Array(strings.length);
  (function walk(i, lo, hi) {
    if (i === strings.length) { const shape = checkShape(cur, strings, tones, { maxSpan }); if (shape) visit(shape); return; }
    for (const f of options[i]) {
      let nlo = lo; let nhi = hi;
      if (f > 0) { nlo = Math.min(lo, f); nhi = Math.max(hi, f); if (nhi - nlo > maxSpan) continue; }
      cur[i] = f;
      walk(i + 1, nlo, nhi);
    }
  })(0, Infinity, -Infinity);
}

export function firstPositionShape(strings, tones, { maxFret = 15 } = {}) {
  let best = null;
  let bestScore = Infinity;
  walkShapes(strings, tones, maxFret, (shape) => { const sc = scoreShape(shape); if (sc < bestScore) { best = shape; bestScore = sc; } });
  return best;
}

/**
 * Every playable voicing of the chord on the neck (checkShape rules), root in the bass.
 * Each shape also carries bass (MIDI of the lowest sounding note) and octave (its octave number).
 * Order: along the neck — by the lowest fretted fret (open-only shapes first), then the highest, then
 * scoreShape — so the list runs from the nut up the fretboard.
 */
export function playableShapes(strings, tones, { maxFret = 24 } = {}) {
  const out = [];
  walkShapes(strings, tones, maxFret, (shape) => {
    const bass = Math.min(...shape.frets.map((f, i) => (f >= 0 ? strings[i] + f : Infinity)));
    out.push({ ...shape, bass, octave: Math.floor(bass / 12) - 1, score: scoreShape(shape) });
  });
  return out.sort((a, b) => a.low - b.low || a.high - b.high || a.score - b.score);
}

/**
 * (Kept for API stability; the panels now use playableShapes.)
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

  // --- voicings of one chord (cached per tuning) -------------------------------------------------
  // {list: playableShapes (bass, then score), start: index of the first-position shape (best score)}
  const cache = new Map();
  function shapesOf(chord) {
    const tun = strings().join(',');
    const key = `${tun}|${maxFret()}|${chord.name}|${chord.tones.map((t) => t.pc).join(',')}`;
    if (!cache.has(key)) {
      const list = playableShapes(strings(), chord.tones, { maxFret: maxFret() });
      let start = 0;
      list.forEach((sh, i) => { if (sh.score < list[start].score) start = i; });
      cache.set(key, { list, start });
    }
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
  const fretText = (shape) => shape.frets.map((f) => (f < 0 ? 'x' : f)).join(' ');
  function diagram(chord, shape, onClick, meta = '') {
    const btn = el('button', 'gd');
    btn.type = 'button';
    const v = voicing(shape, chord);
    btn.setAttribute('aria-label', `${chord.name} chord shape${meta ? ` (${meta})` : ''}: ${fretText(shape)} — show on the fretboard`);
    btn.title = `${chord.name}: ${fretText(shape)}`;
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
  // Every occurrence of the chord's tones on the neck — the same action as the fretboard's header badge.
  // The fretboard's own focusChord is used when the chord is in its current progression (or in the
  // panel's own progression, which the fretboard then switches to), so its header badge lights too;
  // otherwise (a chord-data chord outside both progressions) the same picture via showPositions.
  function showEverywhere(chord, prog, activate, card) {
    const inProg = (p) => p && (progState?.[p]?.chords ?? []).some((c) => c.name === chord.name);
    const now = guitar.overlay?.().panel ?? null;
    const use = typeof guitar.focusChord === 'function' ? [now, prog].find(inProg) : null;
    if (use) {
      if (use !== now) guitar.setOverlay(use);
      guitar.focusChord(chord.name);               // emits 'guitar:overlay' -> clearActive()
      clearActive();
      for (const n of activate) n?.classList.add('is-active');
      document.dispatchEvent(new CustomEvent('guitar-chords:show', { detail: { title: chord.name } }));
    } else {
      const st = strings();
      const list = [];
      for (const t of chord.tones) {
        st.forEach((open, i) => { for (let f = 0; f <= maxFret(); f++) if ((open + f) % 12 === t.pc) list.push({ string: stringNo(i), fret: f, spelled: t.spelled, rank: t.rank, interval: t.interval }); });
      }
      show(list, `${chord.name} · every position`, chord.name, activate);
    }
    card?.classList.add('border-primary');
  }

  // Voicing browser: the diagram (click = show it on the fretboard), then one piano-style row per octave
  // [C3 (C)(E)(G)(C)(E)] — the octave of the voicing's lowest note — each with its own small 1 … N slider
  // right under it when that octave has more than one voicing (drag, click the rail, tap 1 / N to step).
  // Voicings in an octave run from the nut up the neck (playableShapes order). A row label or a slider
  // move shows that voicing on the fretboard and in the diagram.
  function voicings(chord, label, card) {
    const { list, start } = shapesOf(chord);
    const box = el('div', 'gv');
    if (!list.length) {
      box.append(el('div', 'gd-none', 'No playable shape of this chord in this tuning'));
      return box;
    }
    const slot = el('div', 'gv-diagram');
    const rows = el('div', 'cd-octaves gv-octaves');      // same component as the piano octave rows
    rows.setAttribute('role', 'group');
    rows.setAttribute('aria-label', `${chord.name} voicings in each octave on the guitar`);
    const octaveColors = piano.octaveColors();
    const posOf = (s) => ({ string: s.string, fret: s.fret, spelled: s.spelled, rank: s.rank, interval: s.interval });
    const where = (s) => (s.fret === 0 ? `string ${s.string} open` : `string ${s.string}, fret ${s.fret}`);

    let diag = null;
    let diagShape = null;
    let diagPill = () => null;                            // the row currently drawn in the diagram
    let diagTitle = '';
    function showShape(sh, title, trigger, pillEl) {
      show(voicing(sh, chord).map(posOf), title, chord.name, [trigger, diag, pillEl, card]);
      card?.classList.add('border-primary');
    }
    function setDiagram(sh, title, pillFn) {
      diagShape = sh; diagTitle = title; diagPill = pillFn;
      diag = diagram(chord, sh, (btn) => showShape(diagShape, diagTitle, btn, diagPill()), title);
      slot.replaceChildren(diag);
    }

    // one piano-style pill for a voicing: label = lowest note, one circle per sounding string (low -> high)
    function buildPill(sh, oct, onLabel) {
      const v = voicing(sh, chord).sort((x, y) => x.midi - y.midi || x.i - y.i);
      const pill = el('div', 'cd-octave-pill');
      pill.setAttribute('role', 'group');
      const oc = octaveColors.get(oct);
      if (oc) pill.style.setProperty('--cd-octave-bg', oc.light);
      const lab = el('button', 'cd-octave-label', `${chord.rootName}${oct}`);
      lab.type = 'button';
      lab.title = `${chord.name}: ${fretText(sh)}`;
      lab.setAttribute('aria-label', `Show ${chord.name} in octave ${oct} on the fretboard: ${fretText(sh)}`);
      if (onLabel) lab.addEventListener('click', () => onLabel(lab));
      pill.append(lab);
      for (const s of v) {
        const b = el('button', 'cd-octave-note');
        b.type = 'button';
        b.title = `${s.interval}: ${s.note} — ${where(s)}`;
        b.setAttribute('aria-label', `Show ${s.spelled} (${s.interval}) — ${s.note} on ${where(s)}`);
        const dot = el('span', `cd-octave-dot${s.rank === 0 ? ' is-root' : ''}`, s.spelled);
        const colour = colourOf(s.note, s.rank);
        dot.style.setProperty('--cd-dot-bg', colour);
        dot.style.setProperty('--cd-dot-fg', textOn(colour));
        b.append(dot);
        if (onLabel) {
          b.addEventListener('click', () => {
            show([posOf(s)], `${s.note} (${s.interval} of ${chord.name}) · ${where(s)}`, chord.name, [b, card]);
            card?.classList.add('border-primary');
          });
        }
        pill.append(b);
      }
      return pill;
    }

    // small slider: [1] —●— [N]; the rail is the 44px touch target, the visible track and thumb are small
    function slider(n, name, getIdx, onChange) {
      const wrap = el('div', 'gv-slider');
      const first = el('button', 'gv-end', '1');
      const last = el('button', 'gv-end', String(n));
      first.type = 'button'; last.type = 'button';
      first.setAttribute('aria-label', `Previous ${name} voicing`);
      last.setAttribute('aria-label', `Next ${name} voicing`);
      const rail = el('div', 'gv-rail');
      rail.tabIndex = 0;
      rail.setAttribute('role', 'slider');
      rail.setAttribute('aria-label', `${name} voicing`);
      rail.setAttribute('aria-valuemin', '1');
      rail.setAttribute('aria-valuemax', String(n));
      const track = el('div', 'gv-track');
      const fill = el('div', 'gv-fill');
      const thumb = el('div', 'gv-thumb');
      track.append(fill);
      rail.append(track, thumb);
      wrap.append(first, rail, last);
      const set = () => {
        const i = getIdx();
        const pct = `${(i / (n - 1)) * 100}%`;
        thumb.style.left = pct;
        fill.style.width = pct;
        rail.setAttribute('aria-valuenow', String(i + 1));
        rail.setAttribute('aria-valuetext', `voicing ${i + 1} of ${n}`);
        rail.title = `${name}: voicing ${i + 1} of ${n}`;
        first.disabled = i === 0;
        last.disabled = i === n - 1;
      };
      const go = (i, live) => { const j = Math.min(n - 1, Math.max(0, i)); if (j !== getIdx() || !live) onChange(j, live); set(); };
      first.addEventListener('click', () => go(getIdx() - 1, false));
      last.addEventListener('click', () => go(getIdx() + 1, false));
      const at = (x) => { const r = track.getBoundingClientRect(); return Math.round(Math.min(1, Math.max(0, r.width ? (x - r.left) / r.width : 0)) * (n - 1)); };
      rail.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        rail.setPointerCapture?.(e.pointerId);
        rail.classList.add('is-dragging');
        go(at(e.clientX), false);
      });
      rail.addEventListener('pointermove', (e) => { if (rail.classList.contains('is-dragging')) go(at(e.clientX), true); });
      const end = (e) => { rail.classList.remove('is-dragging'); rail.releasePointerCapture?.(e.pointerId); };
      rail.addEventListener('pointerup', end);
      rail.addEventListener('pointercancel', end);
      rail.addEventListener('keydown', (e) => {
        const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 }[e.key];
        if (step) go(getIdx() + step, false);
        else if (e.key === 'Home') go(0, false);
        else if (e.key === 'End') go(n - 1, false);
        else return;
        e.preventDefault();
      });
      set();
      return wrap;
    }

    // group by the octave of the lowest note (neck order kept inside each octave)
    const groups = new Map();
    for (const sh of list) { if (!groups.has(sh.octave)) groups.set(sh.octave, []); groups.get(sh.octave).push(sh); }
    for (const [oct, shapes] of [...groups].sort((a, b) => a[0] - b[0])) {
      const n = shapes.length;
      const best = shapes.reduce((bi, sh, i) => (sh.score < shapes[bi].score ? i : bi), 0);
      let idx = shapes.includes(list[start]) ? shapes.indexOf(list[start]) : best;
      const block = el('div', 'gv-octave');
      const row = el('div', 'gv-voicing');
      // a hidden copy of the octave's widest voicing shares the grid cell: constant row size, the slider never moves
      const widest = shapes.reduce((a, b) => (b.sounding > a.sounding ? b : a), shapes[0]);
      let pill = null;
      let raf = 0;
      const title = () => `${chord.name} · ${chord.rootName}${oct} · voicing ${idx + 1} of ${n} · ${fretText(shapes[idx])}`;
      const toDiagramAndBoard = (trigger) => {
        setDiagram(shapes[idx], title(), () => pill);
        showShape(shapes[idx], title(), trigger, pill);
      };
      const render = () => {
        pill = buildPill(shapes[idx], oct, (lab) => toDiagramAndBoard(lab));
        pill.setAttribute('aria-label', `${chord.name} in octave ${oct}, voicing ${idx + 1} of ${n}`);
        const ghost = buildPill(widest, oct, null);
        ghost.classList.add('gv-ghost');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.inert = true;
        ghost.querySelectorAll('button').forEach((x) => { x.tabIndex = -1; });
        row.replaceChildren(pill, ghost);
      };
      render();
      block.append(row);
      if (n > 1) {
        block.append(slider(n, `${chord.rootName}${oct}`, () => idx, (i, live) => {
          idx = i;
          render();
          if (live) { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => toDiagramAndBoard(null)); } else toDiagramAndBoard(null);
        }));
      }
      rows.append(block);
      if (shapes.includes(list[start])) setDiagram(list[start], title(), () => pill);
    }
    box.append(slot, rows);
    return box;
  }

  // badge + tones + voicing browser (cards and chord panels share it)
  function chordBody(chord, label, card, prog) {
    const { list, start } = shapesOf(chord);
    const showAll = (trigger) => showEverywhere(chord, prog, [trigger, card], card);
    const badge = el('button', 'cd-name', chord.name);
    badge.type = 'button';
    badge.setAttribute('aria-label', `Show every ${chord.name} tone on the fretboard`);
    badge.addEventListener('click', () => showAll(badge));
    return { badge, showAll, parts: [toneCircles(chord, list[start] ?? null, label, card), voicings(chord, label, card)] };
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
    return { wrap, variant, title, keyBox, controls, note, seq, desc, cards };
  }
  function layoutCards(cards) {
    const cols = [...cards.children];
    if (!cols.length) return;
    const tones = Number(cards.dataset.tones) || 3;
    // a six-string voicing row on one line: label + 6 circles + card padding (SYNC: .cd--compact octave sizes)
    const minCol = Math.max(200, 125 + 34 * tones, 290);
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
      b.setAttribute('aria-label', `Show every ${st.badge.chord.name} tone on the fretboard`);
      // the badge chord belongs to the other panel (Root Chord C in the relative panel, and vice versa)
      b.addEventListener('click', () => showEverywhere(st.badge.chord, panel.variant === 'relative' ? 'root' : 'relative', [b], null));
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
      const { badge, showAll, parts } = chordBody(chord, label, card, panel.variant);
      body.append(rn, badge, ...parts);
      card.append(body);
      col.append(card);
      panel.cards.append(col);
      shows.push(showAll);
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
      b.setAttribute('aria-label', `${st.sequence.bars ? `Bar ${i + 1}: ` : ''}show every ${chord.name} tone on the fretboard`);
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
  function renderChordPanel(panel, info, title, prog) {
    if (!panel) return;
    panel.replaceChildren();
    panel.hidden = !info;
    if (!info) return;
    const chord = { name: info.name, rootName: info.rootName, rootPc: info.root,
      tones: info.tones.map((t) => ({ pc: t.pc, spelled: t.spelled, rank: t.rank, interval: t.degree, semitones: t.semitones })) };
    const { badge, parts } = chordBody(chord, /Chord$/.test(title) ? `${title} ${chord.name}` : `${title} Chord ${chord.name}`, null, prog);
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
      renderChordPanel(dataPanel, panels.root, 'Root Chord', 'root');
      renderChordPanel(relDataPanel, panels.minor, panels.relation === 'major' ? 'Relative Major' : 'Relative Minor', 'relative');
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

// =============================================================================
// piano-keyboard.js — data-driven piano renderer
// Source of truth: DATA/piano_tuning.json (layout) — keys sorted by piano_key_index
// Desktop: full range (default A0–C8). Responsive (<= breakpoint): N octaves + octave shift.
// =============================================================================
//
// SYNC POINT (note_ref -> sample filename): '#' -> 's'   e.g. 'C#4' -> 'Cs4'
//   Must match: Python backend (future), any Jinja template, DATA/piano/*.m4a
//
// SYNC POINT (breakpoint): opts.mobileQuery must match the responsive
//   @media rule at the end of www/css/piano-keyboard.css
// =============================================================================

const NOTE_RE = /^[A-G]#?[0-8]$/;
const COLORS = new Set(['white', 'black']);

export const noteToFileStem = (note) => note.replace('#', 's');
const octaveOf = (note) => Number(note.slice(-1));

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const pitchClassOf = (note) => (PC[note[0]] + (note[1] === '#' ? 1 : 0)) % 12;

// Played-key shade by position in the octave (C = root = darkest … B = 7th = lightest).
// Black keys take the shade of the scale degree directly below them.
//                   C     C#    D     D#    E     F     F#    G     G#    A     A#    B
const DEGREE_SHADES = ['900', '900', '800', '800', '700', '600', '600', '500', '500', '400', '400', '300'];
const DARK_SHADES = new Set(['900', '800', '700', '600']); // white label text on these

// Octave color families (index = scientific octave 0–8). Interleaved around the
// hue wheel so adjacent octaves never share a neighbouring hue.
// SYNC POINT: family keys must exist in www/js/colors.js (material_colors)
export const OCTAVE_FAMILIES = [
  'red', 'teal', 'amber', 'indigo', 'lightgreen', 'pink', 'cyan', 'orange', 'purple',
];
const HEX_RE = /^#[0-9a-f]{6}$/i;

function resolvePalette(palette) {
  // colors.js is a classic script: `var material_colors` -> window.material_colors
  const p = palette ?? globalThis.material_colors;
  // DOM-clobbering guard: an element with id="material_colors" is not a plain object
  if (!p || Object.getPrototypeOf(p) !== Object.prototype) {
    console.warn('piano-keyboard: material_colors unavailable — octave colors disabled');
    return null;
  }
  return p;
}

function buildOctaveColors(palette, families, lightShade, accentShade) {
  const map = new Map();
  if (!palette) return map;
  families.forEach((fam, octave) => {
    const light = palette[fam]?.[lightShade];
    const accent = palette[fam]?.[accentShade];
    if (HEX_RE.test(light ?? '') && HEX_RE.test(accent ?? '')) {
      // shade(s): validated lookup of any shade in this family ('' if invalid)
      const shade = (s) => (HEX_RE.test(palette[fam]?.[s] ?? '') ? palette[fam][s] : '');
      map.set(octave, { family: fam, light, accent, shade });
    } else {
      console.warn(`piano-keyboard: invalid color family '${fam}' for octave ${octave}`);
    }
  });
  return map;
}

function resolveContainer(target) {
  // DOM-clobbering guard: accept only a real HTMLDivElement
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (!(el instanceof HTMLDivElement)) {
    throw new TypeError(`piano-keyboard: #${target} is not a <div>`);
  }
  return el;
}

function validateLayout(json) {
  if (!json || !Array.isArray(json.layout)) throw new Error('piano-keyboard: invalid layout JSON');
  const valid = [];
  const quarantined = [];
  for (const k of json.layout) {
    const ok =
      k && Number.isInteger(k.piano_key_index) &&
      typeof k.note_ref === 'string' && NOTE_RE.test(k.note_ref) &&
      COLORS.has(k.color);
    (ok ? valid : quarantined).push(k);
  }
  if (quarantined.length) console.warn('piano-keyboard: quarantined keys', quarantined);
  // Defensive sort — source array is not guaranteed ordered
  return valid.sort((a, b) => a.piano_key_index - b.piano_key_index);
}

function sliceRange(all, from, to) {
  const lo = all.findIndex((k) => k.note_ref === from);
  const hi = all.findIndex((k) => k.note_ref === to);
  if (lo < 0 || hi < 0 || lo > hi) throw new RangeError(`piano-keyboard: bad range ${from}–${to}`);
  // Range must not start on a black key (no white key to anchor it)
  const start = all[lo].color === 'black' ? lo - 1 : lo;
  return all.slice(Math.max(0, start), hi + 1);
}

/**
 * Render a piano keyboard.
 * @param {string|HTMLDivElement} target  container id or element (default 'piano-keyboard')
 * @param {object}  opts
 * @param {string}  opts.dataUrl        layout JSON url
 * @param {object}  opts.layout         pre-loaded layout JSON (skips fetch)
 * @param {string}  opts.from           desktop lowest note (default 'A0')
 * @param {string}  opts.to             desktop highest note (default 'C8')
 * @param {'c'|'all'|'none'} opts.labels key labels (default 'c')
 * @param {string}  opts.scrollTo       desktop: note to center; responsive: starting octave (default 'C4')
 * @param {number}  opts.mobileOctaves  octaves shown in responsive mode (default 2)
 * @param {string}  opts.mobileQuery    responsive media query (default '(max-width: 768px)')
 * @param {boolean} opts.octaveColors   tint keys by octave (default true)
 * @param {string[]} opts.octaveFamilies material_colors family per octave 0–8
 * @param {string}  opts.octaveShade    light shade for white keys (default '100')
 * @param {string}  opts.accentShade    shade for black-key stripe (default '300')
 * @param {string}  opts.chordShade     shade for chord-tone keys (default '700')
 * Last played key stays colored (octave family, darker toward the root) until the next key.
 * @param {object}  opts.palette        palette override (default window.material_colors)
 * @returns {Promise<object>} API: highlight, clear, shiftOctave, isCompact, keys(), octaveColors(),
 *          showChord(pitchClasses), clearChord(), lastPlayed(), clearPlayed(), destroy
 * Emits on container: 'piano:press' / 'piano:release'  detail {note, index, file}
 *                     'piano:rerender'                 detail {from, to, compact}
 */
export async function renderPianoKeyboard(target = 'piano-keyboard', opts = {}) {
  const {
    dataUrl = 'DATA/piano_tuning.json',
    layout = null,
    from = 'A0',
    to = 'C8',
    labels = 'c',
    scrollTo = 'C4',
    mobileOctaves = 2,
    mobileQuery = '(max-width: 768px)',
    octaveColors = true,
    octaveFamilies = OCTAVE_FAMILIES,
    octaveShade = '100',
    accentShade = '300',
    chordShade = '700',
    palette = null,
  } = opts;

  const octaveColorMap = octaveColors
    ? buildOctaveColors(resolvePalette(palette), octaveFamilies, octaveShade, accentShade)
    : new Map();

  const container = resolveContainer(target);

  let json = layout;
  if (!json) {
    const res = await fetch(dataUrl, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`piano-keyboard: ${res.status} loading ${dataUrl}`);
    json = await res.json();
  }

  const all = validateLayout(json);
  const noteSet = new Set(all.map((k) => k.note_ref));

  // Valid compact start octaves: C{o} .. C{o+mobileOctaves} must exist in layout
  const compactOctaves = [];
  for (let o = 0; o <= 8; o++) {
    if (noteSet.has(`C${o}`) && noteSet.has(`C${o + mobileOctaves}`)) compactOctaves.push(o);
  }
  if (!compactOctaves.length) throw new RangeError('piano-keyboard: layout too small for mobileOctaves');
  const clampOctave = (o) =>
    Math.min(Math.max(o, compactOctaves[0]), compactOctaves[compactOctaves.length - 1]);

  const mql = window.matchMedia(mobileQuery);
  let compactOctave = clampOctave(octaveOf(scrollTo));
  let keyMap = new Map();
  let scroller = null;
  const highlights = new Map(); // note -> Set(cls)  (persist across re-renders)
  const pressed = new Set();
  let lastPlayed = null;        // note_ref of the last key played (persists across re-renders)
  let chordPCs = new Set();     // pitch classes of the displayed chord

  container.classList.add('pk');

  // --- events ---------------------------------------------------------------
  const emit = (type, detail) =>
    container.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
  const keyDetail = (btn) => ({
    note: btn.dataset.note,
    index: Number(btn.dataset.index),
    file: btn.dataset.file,
  });

  const press = (btn) => {
    if (!btn || pressed.has(btn)) return;
    pressed.add(btn);
    btn.classList.add('is-pressed');
    if (lastPlayed) keyMap.get(lastPlayed)?.classList.remove('is-played');
    lastPlayed = btn.dataset.note;
    btn.classList.add('is-played');
    emit('piano:press', keyDetail(btn));
  };
  const release = (btn) => {
    if (!btn || !pressed.has(btn)) return;
    pressed.delete(btn);
    btn.classList.remove('is-pressed');
    emit('piano:release', keyDetail(btn));
  };
  const releaseAll = () => [...pressed].forEach(release);
  const keyFrom = (e) => {
    const t = e.target;
    return t instanceof Element ? t.closest('.pk-key') : null;
  };

  const onPointerDown = (e) => {
    const btn = keyFrom(e);
    if (!btn) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (btn.hasPointerCapture?.(e.pointerId)) btn.releasePointerCapture(e.pointerId); // allow glissando
    press(btn);
  };
  const onPointerUp = (e) => release(keyFrom(e));
  const onPointerOver = (e) => {
    if (e.buttons & 1) press(keyFrom(e)); // glissando while held
  };
  const onKeyDown = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
      e.preventDefault();
      press(keyFrom(e));
    }
  };
  const onKeyUp = (e) => {
    if (e.key === 'Enter' || e.key === ' ') release(keyFrom(e));
  };
  const onContextMenu = (e) => e.preventDefault();

  // --- builders -------------------------------------------------------------
  function buildKey(k, whiteIdx) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `pk-key pk-${k.color}`;
    // data-* only — no id/name attributes (DOM clobbering)
    btn.dataset.note = k.note_ref;
    btn.dataset.index = String(k.piano_key_index);
    btn.dataset.file = noteToFileStem(k.note_ref);
    btn.setAttribute('aria-label', k.note_ref);
    if (k.color === 'black') btn.style.setProperty('--pk-pos', String(whiteIdx));

    const octave = octaveOf(k.note_ref);
    btn.dataset.octave = String(octave);
    const oc = octaveColorMap.get(octave);
    if (oc) {
      btn.style.setProperty('--pk-oct', oc.light);
      btn.style.setProperty('--pk-oct-accent', oc.accent);

      const pc = pitchClassOf(k.note_ref);
      btn.dataset.pc = String(pc);
      const playedShade = DEGREE_SHADES[pc];
      const played = oc.shade(playedShade);
      const chord = oc.shade(chordShade);
      if (played) btn.style.setProperty('--pk-played', played);
      if (chord) btn.style.setProperty('--pk-chord', chord);
      if (DARK_SHADES.has(playedShade)) btn.dataset.playedDark = '1';
      if (DARK_SHADES.has(chordShade)) btn.dataset.chordDark = '1';
    } else {
      btn.dataset.pc = String(pitchClassOf(k.note_ref));
    }

    const isC = /^C\d$/.test(k.note_ref);
    if (labels === 'all' || (labels === 'c' && isC)) {
      const lbl = document.createElement('span');
      lbl.className = 'pk-label';
      lbl.textContent = k.note_ref;
      btn.append(lbl);
    }
    for (const cls of highlights.get(k.note_ref) ?? []) btn.classList.add(cls);
    if (k.note_ref === lastPlayed) btn.classList.add('is-played');
    if (chordPCs.has(Number(btn.dataset.pc))) btn.classList.add('is-chord');
    return btn;
  }

  function buildControls() {
    const bar = document.createElement('div');
    bar.className = 'pk-controls';

    const mk = (dir, text, aria) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pk-shift';
      b.dataset.dir = String(dir);
      b.textContent = text;
      b.setAttribute('aria-label', aria);
      b.disabled = clampOctave(compactOctave + dir) === compactOctave;
      b.addEventListener('click', () => api.shiftOctave(dir));
      return b;
    };

    const range = document.createElement('span');
    range.className = 'pk-range';
    range.setAttribute('aria-live', 'polite');
    range.textContent = `C${compactOctave} – C${compactOctave + mobileOctaves}`;

    bar.append(mk(-1, '‹', 'Octave down'), range, mk(1, '›', 'Octave up'));
    return bar;
  }

  function render() {
    releaseAll();
    const compact = mql.matches;
    const rFrom = compact ? `C${compactOctave}` : from;
    const rTo = compact ? `C${compactOctave + mobileOctaves}` : to;
    const keys = sliceRange(all, rFrom, rTo);
    const whiteCount = keys.filter((k) => k.color === 'white').length;

    container.replaceChildren();
    container.classList.toggle('pk-compact', compact);

    if (compact) container.append(buildControls());

    scroller = document.createElement('div');
    scroller.className = 'pk-scroll';

    const board = document.createElement('div');
    board.className = 'pk-board';
    board.setAttribute('role', 'group');
    board.setAttribute('aria-label', `Piano keyboard ${rFrom} to ${rTo}`);
    board.style.setProperty('--pk-white-count', String(whiteCount));

    keyMap = new Map();
    let whiteIdx = 0;
    for (const k of keys) {
      if (k.color === 'white') whiteIdx += 1;
      const btn = buildKey(k, whiteIdx);
      board.append(btn);
      keyMap.set(k.note_ref, btn);
    }

    board.addEventListener('pointerdown', onPointerDown);
    board.addEventListener('pointerup', onPointerUp);
    board.addEventListener('pointercancel', onPointerUp);
    board.addEventListener('pointerout', onPointerUp);
    board.addEventListener('pointerover', onPointerOver);
    board.addEventListener('keydown', onKeyDown);
    board.addEventListener('keyup', onKeyUp);
    board.addEventListener('contextmenu', onContextMenu);

    scroller.append(board);
    container.append(scroller);

    if (!compact) {
      const anchor = keyMap.get(scrollTo);
      if (anchor) {
        requestAnimationFrame(() => {
          scroller.scrollLeft = anchor.offsetLeft - (scroller.clientWidth - anchor.offsetWidth) / 2;
        });
      }
    }

    emit('piano:rerender', { from: rFrom, to: rTo, compact });
  }

  const onMediaChange = () => render();
  mql.addEventListener('change', onMediaChange);
  window.addEventListener('blur', releaseAll);

  // --- public API -----------------------------------------------------------
  const api = {
    keys: () => keyMap,
    isCompact: () => mql.matches,
    octaveColors: () => new Map(octaveColorMap), // octave -> {family, light, accent} (for legends)
    showChord(pitchClasses) {
      // A chord replaces the last played key; it keeps color only if it is a chord tone
      if (lastPlayed) keyMap.get(lastPlayed)?.classList.remove('is-played');
      lastPlayed = null;
      chordPCs = new Set(pitchClasses.map((p) => ((Number(p) % 12) + 12) % 12));
      for (const btn of keyMap.values()) {
        btn.classList.toggle('is-chord', chordPCs.has(Number(btn.dataset.pc)));
      }
    },
    clearChord() {
      chordPCs = new Set();
      for (const btn of keyMap.values()) btn.classList.remove('is-chord');
    },
    lastPlayed: () => lastPlayed,
    clearPlayed() {
      if (lastPlayed) keyMap.get(lastPlayed)?.classList.remove('is-played');
      lastPlayed = null;
    },
    highlight(notes, cls = 'is-highlight') {
      for (const n of notes) {
        if (!highlights.has(n)) highlights.set(n, new Set());
        highlights.get(n).add(cls);
        keyMap.get(n)?.classList.add(cls);
      }
    },
    clear(cls = 'is-highlight') {
      for (const [n, set] of highlights) {
        set.delete(cls);
        if (!set.size) highlights.delete(n);
      }
      for (const btn of keyMap.values()) btn.classList.remove(cls);
    },
    shiftOctave(dir) {
      const next = clampOctave(compactOctave + Math.sign(dir));
      if (next === compactOctave) return;
      compactOctave = next;
      if (mql.matches) render();
    },
    destroy() {
      releaseAll();
      mql.removeEventListener('change', onMediaChange);
      window.removeEventListener('blur', releaseAll);
      container.replaceChildren();
      container.classList.remove('pk', 'pk-compact');
    },
  };

  render();
  return api;
}

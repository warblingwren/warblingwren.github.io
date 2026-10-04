// =============================================================================
// piano.js — data-driven piano renderer
// Source of truth: DATA/piano_tuning.json (layout) — keys sorted by piano_key_index
// Desktop: full range (default A0–C8). Responsive (<= breakpoint): N octaves + octave shift.
// =============================================================================
//
// SYNC POINT (note_ref -> sample filename): '#' -> 's'   e.g. 'C#4' -> 'Cs4'
//   Must match: Python backend (future), any Jinja template, DATA/piano/*.m4a
//
// SYNC POINT (breakpoint): opts.mobileQuery must match the responsive
//   @media rule at the end of www/css/piano.css
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

// Chord-role shades (rank = position in the chord): root darkest, stepping lighter
//   rank 0 root, 1 = 3rd/2nd/4th, 2 = 5th, 3 = 7th/6th
export const ROLE_SHADES = ['900', '700', '500', '300'];

// Readable text color on a hex background (WCAG relative luminance)
export function textOn(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '');
  if (!m) return '#fff';
  const lin = (v) => { const c = parseInt(v, 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]);
  return L > 0.4 ? '#1d1d1f' : '#fff';
}

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
 *          showChord(pitchClasses), clearChord(), markNotes(list), clearMarks(),
 *          notesWithPitchClass(pc), roleColor(note, rank),
 *          lastPlayed(), clearPlayed(), destroy
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
  const marks = new Map();      // note -> {label, badge}  (played chord tones)
  let rail = null;              // badge row under the keys

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
    if (marks.size) { marks.clear(); refreshMarks(); } // single key replaces the sounding chord's marks
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
    // key center in white-key units — used to place degree badges under the key
    btn.dataset.center = String(k.color === 'white' ? whiteIdx - 0.5 : whiteIdx);

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

  // --- marks: note-name label on the key + degree badge below it -------------
  // Role color for a key: its octave family at the chord-role shade
  function roleColor(note, rank) {
    const oc = octaveColorMap.get(octaveOf(note));
    return oc?.shade(ROLE_SHADES[Math.min(Math.max(rank, 0), ROLE_SHADES.length - 1)]) || '';
  }

  function refreshMarks() {
    for (const btn of keyMap.values()) {
      btn.classList.remove('is-marked', 'is-tone');
      btn.querySelector('.pk-mark-label')?.remove();
      btn.querySelector('.pk-key-badge')?.remove();
      btn.style.removeProperty('--pk-tone');
      btn.style.removeProperty('--pk-mark-bg');
      btn.style.removeProperty('--pk-mark-fg');
    }
    if (!rail) return;
    rail.replaceChildren();
    for (const [note, mark] of marks) {
      const btn = keyMap.get(note);
      if (!btn) continue; // outside the visible range
      const color = roleColor(note, mark.rank);
      const fg = textOn(color);

      if (mark.label) {
        btn.classList.add('is-marked');
        // black keys render the label in a role-colored circle (see .pk-black .pk-mark-label)
        if (color) {
          btn.style.setProperty('--pk-mark-bg', color);
          btn.style.setProperty('--pk-mark-fg', fg);
        }
        const lbl = document.createElement('span');
        lbl.className = 'pk-mark-label';
        lbl.textContent = mark.label;
        btn.append(lbl);
      }

      if (mark.fill && color) {
        btn.classList.add('is-tone');
        btn.style.setProperty('--pk-tone', color);
      }

      if (mark.badge && mark.root && btn.classList.contains('pk-black')) {
        // root on a black key: R circle sits on the key, above the note-name circle
        const kb = document.createElement('span');
        kb.className = 'pk-key-badge';
        kb.textContent = mark.badge;
        if (color) {
          kb.style.setProperty('--pk-badge-bg', color);
          kb.style.setProperty('--pk-badge-fg', fg);
        }
        btn.append(kb);
      } else if (mark.badge) {
        const badge = document.createElement('span');
        badge.className = `pk-badge${mark.root ? ' is-root' : ''}`;
        badge.textContent = mark.badge;
        badge.setAttribute('aria-label', `${note} ${mark.badge}`);
        badge.style.setProperty('--pk-center', btn.dataset.center);
        if (color) {
          badge.style.setProperty('--pk-badge-bg', color);
          badge.style.setProperty('--pk-badge-fg', fg);
        }
        rail.append(badge);
      }
    }
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

    rail = document.createElement('div');
    rail.className = 'pk-rail';
    rail.setAttribute('aria-hidden', 'true');
    rail.style.setProperty('--pk-white-count', String(whiteCount));

    scroller.append(board, rail);
    container.append(scroller);
    refreshMarks();

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
    /**
     * @param {{note:string, label?:string, badge?:string, rank?:number, root?:boolean, fill?:boolean}[]} list
     *   label: text on the key (black keys: in a role-colored circle)
     *   badge: degree circle below the key     rank: chord role 0=root … 3=7th (sets shade)
     *   root: white-bordered badge             fill: color the key itself with the role shade
     */
    markNotes(list) {
      marks.clear();
      for (const m of list) {
        marks.set(m.note, {
          label: m.label ? String(m.label) : '',
          badge: m.badge ? String(m.badge) : '',
          rank: Number.isInteger(m.rank) ? m.rank : 0,
          root: Boolean(m.root),
          fill: Boolean(m.fill),
        });
      }
      refreshMarks();
    },
    // Every layout note (visible or not) with this pitch class, e.g. 0 -> ['C1', … 'C8']
    notesWithPitchClass: (pc) => all.filter((k) => pitchClassOf(k.note_ref) === ((pc % 12) + 12) % 12).map((k) => k.note_ref),
    roleColor,
    clearMarks() {
      marks.clear();
      refreshMarks();
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

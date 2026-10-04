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
 * @returns {Promise<object>} API: highlight, clear, shiftOctave, isCompact, keys(), destroy
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
  } = opts;

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

    const isC = /^C\d$/.test(k.note_ref);
    if (labels === 'all' || (labels === 'c' && isC)) {
      const lbl = document.createElement('span');
      lbl.className = 'pk-label';
      lbl.textContent = k.note_ref;
      btn.append(lbl);
    }
    for (const cls of highlights.get(k.note_ref) ?? []) btn.classList.add(cls);
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
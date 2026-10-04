// =============================================================================
// chord-controls.js — major chord buttons below the piano keyboard
// Click: highlights root/3rd/5th in every octave (piano.showChord) and plays the
// root-position triad. Click the active chord again to clear it.
// =============================================================================

import { midiToNote } from './piano-audio.js';

// Major triad = root + 4 semitones (major 3rd) + 7 semitones (perfect 5th)
export const MAJOR_TRIAD = [0, 4, 7];

// Display names use the conventional major-key spelling
export const MAJOR_CHORDS = [
  { name: 'C', root: 0 },
  { name: 'D♭', root: 1 },
  { name: 'D', root: 2 },
  { name: 'E♭', root: 3 },
  { name: 'E', root: 4 },
  { name: 'F', root: 5 },
  { name: 'F♯', root: 6 },
  { name: 'G', root: 7 },
  { name: 'A♭', root: 8 },
  { name: 'A', root: 9 },
  { name: 'B♭', root: 10 },
  { name: 'B', root: 11 },
];

/**
 * @param {object} opts
 * @param {object} opts.piano       API returned by renderPianoKeyboard
 * @param {object} opts.audio       API returned by createPianoAudio
 * @param {string} opts.after       id of the piano container; controls are inserted below it (default 'piano-keyboard')
 * @param {number} opts.octave      octave of the played chord root (default 4)
 * @param {number} opts.strumMs     delay between chord tones, 0 = simultaneous (default 0)
 * @param {number} opts.velocity    chord volume 0–1 (default 0.7)
 * @returns {{select:Function, clear:Function, destroy:Function, element:HTMLDivElement}}
 * Emits on the controls element: 'chord:select' detail {name, root, notes} | 'chord:clear'
 */
export function renderChordControls(opts = {}) {
  const {
    piano,
    audio,
    after = 'piano-keyboard',
    octave = 4,
    strumMs = 0,
    velocity = 0.7,
  } = opts;

  if (!piano || !audio) throw new TypeError('chord-controls: piano and audio are required');

  // DOM-clobbering guard: anchor must be a real <div>
  const anchor = document.getElementById(after);
  if (!(anchor instanceof HTMLDivElement)) throw new TypeError(`chord-controls: #${after} is not a <div>`);

  const wrap = document.createElement('div');
  wrap.className = 'cc';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Major chords');

  const title = document.createElement('div');
  title.className = 'cc-title';
  title.textContent = 'Major chords';

  const grid = document.createElement('div');
  grid.className = 'cc-grid';

  let active = null;      // active button
  let sounding = [];      // notes of the chord currently ringing

  const stopSounding = () => {
    sounding.forEach((n) => audio.release(n));
    sounding = [];
  };

  const clear = () => {
    active?.classList.remove('is-active');
    active?.setAttribute('aria-pressed', 'false');
    active = null;
    stopSounding();
    piano.clearChord();
    wrap.dispatchEvent(new CustomEvent('chord:clear', { bubbles: true }));
  };

  const select = (chord, btn) => {
    if (active === btn) return clear();
    active?.classList.remove('is-active');
    active?.setAttribute('aria-pressed', 'false');
    active = btn;
    btn.classList.add('is-active');
    btn.setAttribute('aria-pressed', 'true');

    const pcs = MAJOR_TRIAD.map((i) => (chord.root + i) % 12);
    piano.showChord(pcs);

    stopSounding();
    const rootMidi = (octave + 1) * 12 + chord.root;
    const notes = MAJOR_TRIAD.map((i) => midiToNote(rootMidi + i));
    notes.forEach((n, i) => {
      if (strumMs > 0) setTimeout(() => audio.play(n, velocity), i * strumMs);
      else audio.play(n, velocity);
    });
    sounding = notes;

    wrap.dispatchEvent(
      new CustomEvent('chord:select', { bubbles: true, detail: { name: chord.name, root: chord.root, notes } }),
    );
  };

  for (const chord of MAJOR_CHORDS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cc-btn';
    btn.dataset.root = String(chord.root);
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', `${chord.name} major`);
    btn.textContent = chord.name;
    btn.addEventListener('click', () => select(chord, btn));
    grid.append(btn);
  }

  wrap.append(title, grid);
  anchor.insertAdjacentElement('afterend', wrap);

  return {
    element: wrap,
    select: (name) => {
      const i = MAJOR_CHORDS.findIndex((c) => c.name === name);
      if (i >= 0) select(MAJOR_CHORDS[i], grid.children[i]);
    },
    clear,
    destroy() {
      clear();
      wrap.remove();
    },
  };
}

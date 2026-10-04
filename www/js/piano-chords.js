// =============================================================================
// chord-controls.js — major chord buttons
// Click: highlights root/3rd/5th in every octave (piano.showChord), plays the
// root-position triad, labels the played keys with their spelled note names and
// puts a scale-degree badge (R, 3, 5) under each. Clicking the same chord re-strikes it.
// =============================================================================

import { midiToNote } from './piano-audio.js';

// Major triad = root + 4 semitones (major 3rd) + 7 semitones (perfect 5th)
// letters: letter steps above the root letter (3rd = 2 letters up, 5th = 4 letters up)
export const MAJOR_TRIAD = [
  { semis: 0, letters: 0 },
  { semis: 4, letters: 2 },
  { semis: 7, letters: 4 },
];

// Scale-degree badge text by semitones above the root
export const DEGREE_LABELS = {
  0: 'R', 1: '♭2', 2: '2', 3: '♭3', 4: '3', 5: '4', 6: '♭5',
  7: '5', 8: '♯5', 9: '6', 10: '♭7', 11: '7',
};

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

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACC = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };

// Spell a chord tone from the chord's root name, e.g. ('D♭', 4, 2) -> 'F'
export function spellTone(rootName, semis, letterSteps) {
  const rootLetter = rootName[0];
  const rootPc = (LETTER_PC[rootLetter] + (rootName.includes('♯') ? 1 : rootName.includes('♭') ? -1 : 0) + 12) % 12;
  const letter = LETTERS[(LETTERS.indexOf(rootLetter) + letterSteps) % 7];
  const target = (rootPc + semis) % 12;
  let diff = (target - LETTER_PC[letter] + 12) % 12;
  if (diff > 6) diff -= 12;
  return letter + (ACC[diff] ?? '');
}

/**
 * @param {object} opts
 * @param {object} opts.piano       API returned by renderPianoKeyboard
 * @param {object} opts.audio       API returned by createPianoAudio
 * @param {string} opts.target      id of a <div> to render INTO (e.g. a Bootstrap column). Takes precedence over `after`.
 * @param {string} opts.after       id of the piano container; used only when `target` is not given (default 'piano-keyboard')
 * @param {number} opts.octave      octave of the played chord root (default 4)
 * @param {number} opts.strumMs     delay between chord tones, 0 = simultaneous (default 0)
 * @param {number} opts.velocity    chord volume 0–1 (default 0.7)
 * @returns {{select:Function, clear:Function, destroy:Function, element:HTMLDivElement}}
 * Emits on the controls element: 'chord:select' detail {name, root, notes, spelled} | 'chord:clear'
 */
export function renderChordControls(opts = {}) {
  const {
    piano,
    audio,
    target = null,
    after = 'piano-keyboard',
    octave = 4,
    strumMs = 0,
    velocity = 0.7,
  } = opts;

  if (!piano || !audio) throw new TypeError('chord-controls: piano and audio are required');

  // DOM-clobbering guard: host must be a real <div>
  const hostId = target ?? after;
  const host = document.getElementById(hostId);
  if (!(host instanceof HTMLDivElement)) throw new TypeError(`chord-controls: #${hostId} is not a <div>`);

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

  const clear = () => {
    active?.classList.remove('is-active');
    active?.setAttribute('aria-pressed', 'false');
    active = null;
    audio.stopAll();
    piano.clearChord();
    piano.clearMarks();
    wrap.dispatchEvent(new CustomEvent('chord:clear', { bubbles: true }));
  };

  // Clicking the same chord again re-strikes it from the beginning
  const select = (chord, btn) => {
    active?.classList.remove('is-active');
    active?.setAttribute('aria-pressed', 'false');
    active = btn;
    btn.classList.add('is-active');
    btn.setAttribute('aria-pressed', 'true');

    piano.showChord(MAJOR_TRIAD.map((t) => (chord.root + t.semis) % 12));

    const rootMidi = (octave + 1) * 12 + chord.root;
    const notes = MAJOR_TRIAD.map((t) => midiToNote(rootMidi + t.semis));
    const spelled = MAJOR_TRIAD.map((t) => spellTone(chord.name, t.semis, t.letters));

    piano.markNotes(notes.map((note, i) => ({
      note,
      label: spelled[i],
      badge: DEGREE_LABELS[MAJOR_TRIAD[i].semis],
    })));

    audio.playChord(notes, velocity, strumMs);

    wrap.dispatchEvent(new CustomEvent('chord:select', {
      bubbles: true,
      detail: { name: chord.name, root: chord.root, notes, spelled },
    }));
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
  if (target) host.append(wrap);                     // inside the given column
  else host.insertAdjacentElement('afterend', wrap); // directly below the piano

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

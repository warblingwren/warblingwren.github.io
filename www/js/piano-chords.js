// =============================================================================
// piano-chords.js — chord buttons: Major, Major 7th, Minor, Minor 7th
// Click: highlights the chord tones in every octave (piano.showChord), plays the
// root-position chord, labels the played keys with their spelled note names and
// puts a scale-degree badge under each. Clicking the same chord re-strikes it.
// =============================================================================

import { midiToNote } from './piano-audio.js';

// semis = semitones above the root; letters = letter steps above the root letter
const R = { semis: 0, letters: 0 };
const M3 = { semis: 4, letters: 2 };
const m3 = { semis: 3, letters: 2 };
const P5 = { semis: 7, letters: 4 };
const M7 = { semis: 11, letters: 6 };
const m7 = { semis: 10, letters: 6 };

export const MAJOR_TRIAD = [R, M3, P5];
export const MAJOR_7TH = [R, M3, P5, M7];
export const MINOR_TRIAD = [R, m3, P5];
export const MINOR_7TH = [R, m3, P5, m7];

// Scale-degree badge text by semitones above the root
export const DEGREE_LABELS = {
  0: 'R', 1: '♭2', 2: '2', 3: '♭3', 4: '3', 5: '4', 6: '♭5',
  7: '5', 8: '♯5', 9: '6', 10: '♭7', 11: '7',
};

// Conventional root spellings: major keys favour flats, minor keys follow their key signatures
const MAJOR_ROOTS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MINOR_ROOTS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];

// tone: 'major' groups share the dark panel, 'minor' groups the lighter panel
export const CHORD_GROUPS = [
  { id: 'major',  title: 'Major chords',     tone: 'major', suffix: '',     quality: 'major',  intervals: MAJOR_TRIAD, roots: MAJOR_ROOTS },
  { id: 'maj7',   title: 'Major 7th chords', tone: 'major', suffix: 'maj7', quality: 'major 7th', intervals: MAJOR_7TH, roots: MAJOR_ROOTS },
  { id: 'minor',  title: 'Minor chords',     tone: 'minor', suffix: 'm',    quality: 'minor',  intervals: MINOR_TRIAD, roots: MINOR_ROOTS },
  { id: 'min7',   title: 'Minor 7th chords', tone: 'minor', suffix: 'm7',   quality: 'minor 7th', intervals: MINOR_7TH, roots: MINOR_ROOTS },
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
 *          select('C'), select('Cmaj7'), select('Cm'), select('Cm7')
 * Emits on the controls element: 'chord:select' detail {name, quality, root, notes, spelled} | 'chord:clear'
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

  if (!piano || !audio) throw new TypeError('piano-chords: piano and audio are required');

  // DOM-clobbering guard: host must be a real <div>
  const hostId = target ?? after;
  const host = document.getElementById(hostId);
  if (!(host instanceof HTMLDivElement)) throw new TypeError(`piano-chords: #${hostId} is not a <div>`);

  const wrap = document.createElement('div');
  wrap.className = 'cc';

  let active = null;                 // active button (one across all groups)
  const byName = new Map();          // chord name -> {chord, btn}

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

    const { intervals } = chord;
    piano.showChord(intervals.map((t) => (chord.root + t.semis) % 12));

    const rootMidi = (octave + 1) * 12 + chord.root;
    const notes = intervals.map((t) => midiToNote(rootMidi + t.semis));
    const spelled = intervals.map((t) => spellTone(chord.rootName, t.semis, t.letters));

    piano.markNotes(notes.map((note, i) => ({
      note,
      label: spelled[i],
      badge: DEGREE_LABELS[intervals[i].semis],
    })));

    audio.playChord(notes, velocity, strumMs);

    wrap.dispatchEvent(new CustomEvent('chord:select', {
      bubbles: true,
      detail: { name: chord.name, quality: chord.quality, root: chord.root, notes, spelled },
    }));
  };

  for (const group of CHORD_GROUPS) {
    const section = document.createElement('div');
    section.className = `cc-group cc-group--${group.tone}`;
    section.dataset.group = group.id;
    section.setAttribute('role', 'group');
    section.setAttribute('aria-label', group.title);

    const title = document.createElement('div');
    title.className = 'cc-title';
    title.textContent = group.title;

    const grid = document.createElement('div');
    grid.className = 'cc-grid';

    group.roots.forEach((rootName, root) => {
      const chord = {
        name: `${rootName}${group.suffix}`,
        rootName,
        root,
        quality: group.quality,
        intervals: group.intervals,
      };
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cc-btn';
      btn.dataset.root = String(root);
      btn.dataset.group = group.id;
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label', `${rootName} ${group.quality}`);
      btn.textContent = chord.name;
      btn.addEventListener('click', () => select(chord, btn));
      grid.append(btn);
      byName.set(chord.name, { chord, btn });
    });

    section.append(title, grid);
    wrap.append(section);
  }

  if (target) host.append(wrap);                     // inside the given column
  else host.insertAdjacentElement('afterend', wrap); // directly below the piano

  return {
    element: wrap,
    select: (name) => {
      const entry = byName.get(name);
      if (entry) select(entry.chord, entry.btn);
    },
    clear,
    destroy() {
      clear();
      wrap.remove();
    },
  };
}

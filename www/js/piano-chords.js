// =============================================================================
// piano-chords.js — chord buttons + chord detail panel
//
// Chord button click:
//   • highlights the chord tones in every octave (piano.showChord)
//   • plays the root-position chord (root in `octave`)
//   • labels the played keys with spelled note names; degree circle under each
//   • root circle (white ring) under EVERY occurrence of the root
//   • renders the chord name + tone circles into #chord-data (if present)
//   Clicking the same chord again re-strikes it.
// Tone circle click (#chord-data): plays that tone alone and highlights every
//   key where it occurs, colored by its role in the chord.
//
// Color = chord role: root darkest → 3rd → 5th → 7th lightest (piano.js ROLE_SHADES)
// =============================================================================

import { midiToNote } from './piano-audio.js';
import { textOn } from './piano.js';

// semis = semitones above root; letters = letter steps above root letter; label = degree text
const R   = { semis: 0,  letters: 0, label: 'R' };
const M2  = { semis: 2,  letters: 1, label: '2' };
const m3  = { semis: 3,  letters: 2, label: '♭3' };
const M3  = { semis: 4,  letters: 2, label: '3' };
const P4  = { semis: 5,  letters: 3, label: '4' };
const d5  = { semis: 6,  letters: 4, label: '♭5' };
const P5  = { semis: 7,  letters: 4, label: '5' };
const A5  = { semis: 8,  letters: 4, label: '♯5' };
const M6  = { semis: 9,  letters: 5, label: '6' };
const d7  = { semis: 9,  letters: 6, label: '𝄫7' };
const m7  = { semis: 10, letters: 6, label: '♭7' };
const M7  = { semis: 11, letters: 6, label: '7' };

// Conventional root spellings per chord family
const MAJOR_ROOTS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MINOR_ROOTS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];
const DIM_ROOTS   = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

// Sections alternate panel tone; each group is one row of 12 chord buttons
export const CHORD_SECTIONS = [
  { id: 'major', tone: 'dark', groups: [
    { id: 'major', title: 'Major chords',     suffix: '',     quality: 'major',     intervals: [R, M3, P5],     roots: MAJOR_ROOTS },
    { id: 'maj7',  title: 'Major 7th chords', suffix: 'maj7', quality: 'major 7th', intervals: [R, M3, P5, M7], roots: MAJOR_ROOTS },
  ] },
  { id: 'minor', tone: 'light', groups: [
    { id: 'minor', title: 'Minor chords',     suffix: 'm',    quality: 'minor',     intervals: [R, m3, P5],     roots: MINOR_ROOTS },
    { id: 'min7',  title: 'Minor 7th chords', suffix: 'm7',   quality: 'minor 7th', intervals: [R, m3, P5, m7], roots: MINOR_ROOTS },
  ] },
  { id: 'diminished', tone: 'dark', groups: [
    { id: 'dim',   title: 'Diminished chords',      suffix: 'dim',  quality: 'diminished',      intervals: [R, m3, d5],     roots: DIM_ROOTS },
    { id: 'dim7',  title: 'Diminished 7th chords',  suffix: 'dim7', quality: 'diminished 7th',  intervals: [R, m3, d5, d7], roots: DIM_ROOTS },
    { id: 'm7b5',  title: 'Half-diminished chords', suffix: 'm7♭5', quality: 'half-diminished', intervals: [R, m3, d5, m7], roots: DIM_ROOTS },
  ] },
  { id: 'augmented-dominant', tone: 'light', groups: [
    { id: 'aug',   title: 'Augmented chords',     suffix: 'aug',  quality: 'augmented',     intervals: [R, M3, A5],     roots: MAJOR_ROOTS },
    { id: 'aug7',  title: 'Augmented 7th chords', suffix: 'aug7', quality: 'augmented 7th', intervals: [R, M3, A5, m7], roots: MAJOR_ROOTS },
    { id: 'dom7',  title: 'Dominant 7th chords',  suffix: '7',    quality: 'dominant 7th',  intervals: [R, M3, P5, m7], roots: MAJOR_ROOTS },
  ] },
  { id: 'suspended-sixth', tone: 'dark', groups: [
    { id: 'sus2',  title: 'Suspended 2nd chords', suffix: 'sus2', quality: 'suspended 2nd', intervals: [R, M2, P5],     roots: MAJOR_ROOTS },
    { id: 'sus4',  title: 'Suspended 4th chords', suffix: 'sus4', quality: 'suspended 4th', intervals: [R, P4, P5],     roots: MAJOR_ROOTS },
    { id: 'maj6',  title: 'Major 6th chords',     suffix: '6',    quality: 'major 6th',     intervals: [R, M3, P5, M6], roots: MAJOR_ROOTS },
    { id: 'min6',  title: 'Minor 6th chords',     suffix: 'm6',   quality: 'minor 6th',     intervals: [R, m3, P5, M6], roots: MINOR_ROOTS },
  ] },
];

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACC = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };

// Spell a chord tone from the chord's root name, e.g. ('C', 9, 6) -> 'B𝄫'
export function spellTone(rootName, semis, letterSteps) {
  const rootLetter = rootName[0];
  const rootPc = (LETTER_PC[rootLetter] + (rootName.includes('♯') ? 1 : rootName.includes('♭') ? -1 : 0) + 12) % 12;
  const letter = LETTERS[(LETTERS.indexOf(rootLetter) + letterSteps) % 7];
  const target = (rootPc + semis) % 12;
  let diff = (target - LETTER_PC[letter] + 12) % 12;
  if (diff > 6) diff -= 12;
  return letter + (ACC[diff] ?? '');
}

const getDiv = (id) => {
  // DOM-clobbering guard: must be a real <div>
  const el = id ? document.getElementById(id) : null;
  return el instanceof HTMLDivElement ? el : null;
};

// Chord detail host: any real element (div, section, …) — looked up at use time
const getHost = (id) => {
  const el = id ? document.getElementById(id) : null;
  return el instanceof HTMLElement && !(el instanceof HTMLFormElement) ? el : null;
};

/**
 * @param {object} opts
 * @param {object} opts.piano       API returned by renderPianoKeyboard
 * @param {object} opts.audio       API returned by createPianoAudio
 * @param {string} opts.target      id of a <div> to render the buttons INTO. Takes precedence over `after`.
 * @param {string} opts.after       id of the piano container; used only when `target` is not given (default 'piano-keyboard')
 * @param {string} opts.dataTarget  id of the chord detail element (default 'chord-data'); looked up on every chord click
 * @param {number} opts.octave      octave of the played chord root (default 4)
 * @param {number} opts.strumMs     delay between chord tones, 0 = simultaneous (default 0)
 * @param {number} opts.velocity    chord volume 0–1 (default 0.7)
 * @returns {{select:Function, clear:Function, destroy:Function, element:HTMLDivElement}}
 *          select('C'), select('Cdim7'), select('Bm7♭5') …
 * Emits on the controls element: 'chord:select' detail {name, quality, root, notes, spelled}
 *                                'chord:tone'   detail {chord, note, spelled, degree} | 'chord:clear'
 */
export function renderChordControls(opts = {}) {
  const {
    piano,
    audio,
    target = null,
    after = 'piano-keyboard',
    dataTarget = 'chord-data',
    octave = 4,
    strumMs = 0,
    velocity = 0.7,
  } = opts;

  if (!piano || !audio) throw new TypeError('piano-chords: piano and audio are required');

  const hostId = target ?? after;
  const host = getDiv(hostId);
  if (!host) throw new TypeError(`piano-chords: #${hostId} is not a <div>`);
  let warnedNoData = false;

  const wrap = document.createElement('div');
  wrap.className = 'cc';

  const panel = document.createElement('div');   // chord detail panel (inside #chord-data)
  panel.className = 'cd';
  panel.hidden = true;

  let active = null;                 // active chord button (one across all groups)
  let activeChord = null;
  const byName = new Map();          // chord name -> {chord, btn}

  const emit = (type, detail) => wrap.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  // --- chord voicing ---------------------------------------------------------
  function voice(chord) {
    const rootMidi = (octave + 1) * 12 + chord.root;
    return chord.intervals.map((t, rank) => ({
      rank,
      note: midiToNote(rootMidi + t.semis),
      pc: (chord.root + t.semis) % 12,
      spelled: spellTone(chord.rootName, t.semis, t.letters),
      degree: t.label,
    }));
  }

  // Played tones: label + degree circle. Root: circle under every occurrence.
  function chordMarks(tones) {
    const list = tones.map((t) => ({ note: t.note, label: t.spelled, badge: t.degree, rank: t.rank, root: t.rank === 0 }));
    const played = new Set(tones.map((t) => t.note));
    for (const n of piano.notesWithPitchClass(tones[0].pc)) {
      if (!played.has(n)) list.push({ note: n, badge: 'R', rank: 0, root: true });
    }
    return list;
  }

  function showChordOnKeys(tones) {
    piano.showChord(tones.map((t) => t.pc));
    piano.markNotes(chordMarks(tones));
  }

  // --- chord detail panel ------------------------------------------------------
  function renderPanel(chord, tones) {
    // Resolve #chord-data on every click so it works even if the element is added after render
    const dataHost = getHost(dataTarget);
    if (!dataHost) {
      if (!warnedNoData) console.warn(`piano-chords: #${dataTarget} not found — chord detail panel not shown`);
      warnedNoData = true;
      return;
    }
    if (panel.parentElement !== dataHost) dataHost.append(panel);
    panel.replaceChildren();
    panel.hidden = false;

    // Chord name badge: click re-highlights the whole chord on the keyboard
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'cd-name';
    name.textContent = chord.name;
    name.setAttribute('aria-label', `Play ${chord.name} and highlight it on the keyboard`);
    name.addEventListener('click', () => {
      panel.querySelectorAll('.cd-circle.is-active').forEach((b) => b.classList.remove('is-active'));
      showChordOnKeys(tones);
      audio.playChord(tones.map((t) => t.note), velocity, strumMs); // re-strike from the beginning
    });

    const row = document.createElement('div');
    row.className = 'cd-tones';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', `${chord.name} chord tones`);

    for (const t of tones) {
      const item = document.createElement('div');
      item.className = 'cd-tone';

      const deg = document.createElement('div');
      deg.className = 'cd-degree';
      deg.textContent = t.degree;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cd-circle${t.rank === 0 ? ' is-root' : ''}`;
      btn.textContent = t.spelled;
      btn.setAttribute('aria-label', `Play ${t.spelled} (${t.degree})`);
      const color = piano.roleColor(t.note, t.rank);
      if (color) {
        btn.style.setProperty('--cd-circle-bg', color);
        btn.style.setProperty('--cd-circle-fg', textOn(color));
      }
      btn.addEventListener('click', () => playTone(chord, t, btn));

      item.append(deg, btn);
      row.append(item);
    }
    panel.append(name, row);
  }

  // Single tone: play it alone, highlight every key where it occurs in its role color
  function playTone(chord, t, btn) {
    panel.querySelectorAll('.cd-circle.is-active').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');

    piano.clearChord();
    piano.clearPlayed(); // a key played on the piano loses its color unless it is this tone
    piano.markNotes(piano.notesWithPitchClass(t.pc).map((n) => ({
      note: n,
      label: t.spelled,
      badge: t.degree,
      rank: t.rank,
      root: t.rank === 0,
      fill: true,
    })));
    audio.play(t.note);
    emit('chord:tone', { chord: chord.name, note: t.note, spelled: t.spelled, degree: t.degree });
  }

  // --- chord selection ---------------------------------------------------------
  const clear = () => {
    active?.classList.remove('is-active');
    active?.setAttribute('aria-pressed', 'false');
    active = null;
    activeChord = null;
    audio.stopAll();
    piano.clearChord();
    piano.clearMarks();
    panel.replaceChildren();
    panel.hidden = true;
    emit('chord:clear');
  };

  // Clicking the same chord again re-strikes it from the beginning
  const select = (chord, btn) => {
    active?.classList.remove('is-active');
    active?.setAttribute('aria-pressed', 'false');
    active = btn;
    activeChord = chord;
    btn.classList.add('is-active');
    btn.setAttribute('aria-pressed', 'true');

    const tones = voice(chord);
    showChordOnKeys(tones);
    renderPanel(chord, tones);
    audio.playChord(tones.map((t) => t.note), velocity, strumMs);

    emit('chord:select', {
      name: chord.name,
      quality: chord.quality,
      root: chord.root,
      notes: tones.map((t) => t.note),
      spelled: tones.map((t) => t.spelled),
    });
  };

  // --- build buttons -----------------------------------------------------------
  for (const section of CHORD_SECTIONS) {
    const sec = document.createElement('div');
    sec.className = `cc-section cc-section--${section.tone}`;
    sec.dataset.section = section.id;

    for (const group of section.groups) {
      const g = document.createElement('div');
      g.className = 'cc-group';
      g.dataset.group = group.id;
      g.setAttribute('role', 'group');
      g.setAttribute('aria-label', group.title);

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

      g.append(title, grid);
      sec.append(g);
    }
    wrap.append(sec);
  }

  if (target) host.append(wrap);                     // inside the given column
  else host.insertAdjacentElement('afterend', wrap); // directly below the piano

  return {
    element: wrap,
    select: (name) => {
      const entry = byName.get(name);
      if (entry) select(entry.chord, entry.btn);
    },
    active: () => activeChord?.name ?? null,
    clear,
    destroy() {
      clear();
      wrap.remove();
      panel.remove();
    },
  };
}

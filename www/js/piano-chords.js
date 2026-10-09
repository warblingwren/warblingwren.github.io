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

import { midiToNote, noteToMidi } from './piano-audio.js';
import { textOn } from './piano.js';

// Version handshake. Bump both together when the markup/CSS contract changes.
//   VERSION      — read by circle-o-5ths.js, which warns if this file is older than it expects
//   --cc-css-version in www/css/piano-chords.css — checked below
export const VERSION = 5;
const CSS_VERSION = 5;

// Small SVG builder (no innerHTML: works under strict Content-Security-Policy / Trusted Types)
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgIcon(children, size = 20) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', focusable: 'false' })) {
    svg.setAttribute(k, String(v));
  }
  for (const [tag, attrs] of children) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    svg.append(n);
  }
  return svg;
}

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

// Sections become <optgroup>s in the chord-type dropdown; each group is one row of 12 chord buttons
export const CHORD_SECTIONS = [
  { id: 'major', title: 'Major', groups: [
    { id: 'major', title: 'Major chords',     suffix: '',     quality: 'major',     intervals: [R, M3, P5],     roots: MAJOR_ROOTS },
    { id: 'maj7',  title: 'Major 7th chords', suffix: 'maj7', quality: 'major 7th', intervals: [R, M3, P5, M7], roots: MAJOR_ROOTS },
  ] },
  { id: 'minor', title: 'Minor', groups: [
    { id: 'minor', title: 'Minor chords',     suffix: 'm',    quality: 'minor',     intervals: [R, m3, P5],     roots: MINOR_ROOTS },
    { id: 'min7',  title: 'Minor 7th chords', suffix: 'm7',   quality: 'minor 7th', intervals: [R, m3, P5, m7], roots: MINOR_ROOTS },
  ] },
  { id: 'diminished', title: 'Diminished', groups: [
    { id: 'dim',   title: 'Diminished chords',      suffix: 'dim',  quality: 'diminished',      intervals: [R, m3, d5],     roots: DIM_ROOTS },
    { id: 'dim7',  title: 'Diminished 7th chords',  suffix: 'dim7', quality: 'diminished 7th',  intervals: [R, m3, d5, d7], roots: DIM_ROOTS },
    { id: 'm7b5',  title: 'Half-diminished chords', suffix: 'm7♭5', quality: 'half-diminished', intervals: [R, m3, d5, m7], roots: DIM_ROOTS },
  ] },
  { id: 'augmented-dominant', title: 'Augmented & dominant', groups: [
    { id: 'aug',   title: 'Augmented chords',     suffix: 'aug',  quality: 'augmented',     intervals: [R, M3, A5],     roots: MAJOR_ROOTS },
    { id: 'aug7',  title: 'Augmented 7th chords', suffix: 'aug7', quality: 'augmented 7th', intervals: [R, M3, A5, m7], roots: MAJOR_ROOTS },
    { id: 'dom7',  title: 'Dominant 7th chords',  suffix: '7',    quality: 'dominant 7th',  intervals: [R, M3, P5, m7], roots: MAJOR_ROOTS },
  ] },
  { id: 'suspended-sixth', title: 'Suspended & 6th', groups: [
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

/**
 * Octave rows: one rounded rectangle per octave 1–7 where the whole chord fits on the 88 keys
 * (A0 = MIDI 21 … C8 = 108). Rectangle = the root octave's light tint; circles = chord-role colors.
 *   label button  -> plays the full chord in that octave, highlights exactly those keys
 *   circle button -> plays that single note in that octave, highlights that key
 * Shared by #chord-data (piano-chords.js) and the progression cards (circle-o-5ths.js).
 * @param {object} o
 * @param {object} o.piano, o.audio
 * @param {string} o.name       chord name, e.g. 'A'
 * @param {string} o.rootName   spelled root, e.g. 'A'
 * @param {number} o.rootPc     root pitch class 0–11
 * @param {{rank:number, semitones:number, spelled:string, degree:string}[]} o.tones
 * @param {Function} [o.onSelect]  called before an item becomes active (clear other active states)
 * @param {Function} [o.emit]      (type, detail) => void
 * @returns {HTMLDivElement}
 */
export function renderOctaveRows(o) {
  const { piano, audio, name, rootName, rootPc, tones, onSelect = () => {}, emit = () => {},
    statusLabel = name,
    velocity = 0.7, strumMs = 0 } = o;

  const wrapEl = document.createElement('div');
  wrapEl.className = 'cd-octaves';
  wrapEl.setAttribute('role', 'group');
  wrapEl.setAttribute('aria-label', `${name} in each octave`);
  const octaveColors = piano.octaveColors();

  const highlight = (list) => {
    piano.clearChord();
    piano.clearPlayed();
    piano.markNotes(list.map((t) => ({
      note: t.note, label: t.spelled, badge: t.degree, rank: t.rank, root: t.rank === 0, fill: true,
    })));
  };

  for (let oct = 1; oct <= 7; oct++) {
    const rootMidi = (oct + 1) * 12 + rootPc;
    const midis = tones.map((t) => rootMidi + t.semitones);
    if (midis[0] < 21 || midis[midis.length - 1] > 108) continue;
    const voiced = tones.map((t, i) => ({ ...t, note: midiToNote(midis[i]) }));

    const pill = document.createElement('div');
    pill.className = 'cd-octave-pill';
    pill.setAttribute('role', 'group');
    pill.setAttribute('aria-label', `${name} in octave ${oct}`);
    const oc = octaveColors.get(oct);
    if (oc) pill.style.setProperty('--cd-octave-bg', oc.light);

    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'cd-octave-label';
    label.textContent = `${rootName}${oct}`;
    label.setAttribute('aria-label', `Play ${name} in octave ${oct}: ${voiced.map((t) => t.note).join(', ')}`);
    label.addEventListener('click', () => {
      onSelect();
      pill.classList.add('is-active');
      highlight(voiced);
      audio.playChord(voiced.map((t) => t.note), velocity, strumMs);
      piano.setStatus?.(`${statusLabel} · Octave ${oct}`);
      emit('chord:octave', { chord: name, octave: oct, notes: voiced.map((t) => t.note) });
    });
    pill.append(label);

    for (const t of voiced) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cd-octave-note';
      btn.title = `${t.degree}: ${t.note}`;
      btn.setAttribute('aria-label', `Play ${t.spelled} (${t.degree}) — ${t.note}`);

      const dot = document.createElement('span');
      dot.className = `cd-octave-dot${t.rank === 0 ? ' is-root' : ''}`;
      dot.textContent = t.spelled;
      const color = piano.roleColor(t.note, t.rank);
      if (color) {
        dot.style.setProperty('--cd-dot-bg', color);
        dot.style.setProperty('--cd-dot-fg', textOn(color));
      }
      btn.append(dot);
      btn.addEventListener('click', () => {
        onSelect();
        btn.classList.add('is-active');
        highlight([t]);
        audio.play(t.note);
        piano.setStatus?.(`${statusLabel} · ${t.spelled}${t.note.slice(-1)} (${t.degree})`);
        emit('chord:octave-note', { chord: name, octave: oct, note: t.note, spelled: t.spelled, degree: t.degree });
      });
      pill.append(btn);
    }
    wrapEl.append(pill);
  }
  return wrapEl;
}

// Relative chord shown in #minor-chord-data.
// Major-family chords -> relative minor (root a minor 3rd down); minor-family -> relative major.
// Diminished chords -> the minor chord of the key they naturally belong to (same rule as the
// progressions in circle-o-5ths.js — SYNC):
//   dim / m7♭5 = vii° / viiø7 of the major key a half step up -> that key's relative minor (G♯dim -> F♯m)
//   dim7       = vii°7 of the minor key a half step up        -> that minor key's tonic   (F♯dim7 -> Gm7)
const LEADING_TONE_HOME = { dim: { mode: 'major', quality: 'minor' }, m7b5: { mode: 'major', quality: 'min7' },
  dim7: { mode: 'minor', quality: 'min7' } };
const RELATIVE = {
  major: 'minor', maj7: 'min7', dom7: 'min7', maj6: 'min7', aug: 'minor', aug7: 'min7', sus2: 'minor', sus4: 'minor',
  minor: 'major', min7: 'maj7', min6: 'major',
};
const MINOR_FAMILY = new Set(['minor', 'min7', 'min6']);

export function relativeChord(chord) {
  const home = LEADING_TONE_HOME[chord.group];
  if (home) {
    const group = CHORD_SECTIONS.flatMap((sec) => sec.groups).find((g) => g.id === home.quality);
    const tonicPc = (chord.root + 1) % 12;
    let rootName;
    let root;
    if (home.mode === 'major') {
      const tonic = spellTone(chord.rootName, 1, 1);    // major key a half step up: G♯ -> A
      rootName = spellTone(tonic, 9, 5);                // its relative minor:         A -> F♯
      root = (tonicPc + 9) % 12;
    } else {
      rootName = MINOR_ROOTS[tonicPc];                  // conventional minor-key spelling (C♯, not D♭)
      root = tonicPc;
    }
    return {
      title: 'Relative Minor',
      chord: { name: `${rootName}${group.suffix}`, rootName, root, group: group.id, quality: group.quality, intervals: group.intervals },
    };
  }
  const targetId = RELATIVE[chord.group];
  if (!targetId) return null;
  const group = CHORD_SECTIONS.flatMap((sec) => sec.groups).find((g) => g.id === targetId);
  const toMajor = MINOR_FAMILY.has(chord.group);
  // relative minor: 9 semitones / 5 letters up (= minor 3rd down); relative major: 3 semitones / 2 letters up
  const rootName = toMajor ? spellTone(chord.rootName, 3, 2) : spellTone(chord.rootName, 9, 5);
  return {
    title: toMajor ? 'Relative Major' : 'Relative Minor',
    chord: {
      name: `${rootName}${group.suffix}`,
      rootName,
      root: (chord.root + (toMajor ? 3 : 9)) % 12,
      group: group.id,
      quality: group.quality,
      intervals: group.intervals,
    },
  };
}

// Last chords displayed in #root-chord-data / #minor-chord-data (read by circle-o-5ths.js)
let lastPanels = null;
export const currentPanels = () => lastPanels;

function chordInfo(c) {
  return {
    name: c.name,
    rootName: c.rootName,
    root: c.root,
    group: c.group,
    tones: c.intervals.map((t, rank) => ({
      rank, semitones: t.semis, pc: (c.root + t.semis) % 12, spelled: spellTone(c.rootName, t.semis, t.letters), degree: t.label,
    })),
  };
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

// --- one-octave chord diagram ----------------------------------------------------
// Same colours as the large keyboard (piano.keyColors / piano.roleColor): octave-tinted white keys,
// chord keys in the octave's chord shade, note name on each chord key (black keys: in a circle
// shaded by chord role). Display only.
// Window: always exactly one octave with all 5 black keys and clean white-key edges — C–B (2+3)
// or F–E (3+2). The chord is shown as voiced when it fits one of them; otherwise the fewest
// possible tones move by an octave (an inversion), so every chord tone is always in view.
const WHITE_PCS = new Set([0, 2, 4, 5, 7, 9, 11]);
const WINDOW_STARTS = [0, 5];                            // C–B and F–E: the only octaves with 5 whole black keys

/**
 * @param {number[]} midis  voiced chord tones
 * @returns {{start:number, end:number, notes:number[]}}  window (start..end inclusive) + tone positions inside it
 */
export function miniWindow(midis) {
  const lo = Math.min(...midis);
  const hi = Math.max(...midis);
  const centre = (lo + hi) / 2;
  let best = null;
  for (const pcStart of WINDOW_STARTS) {
    const first = lo - ((((lo - pcStart) % 12) + 12) % 12);   // window start at or below the lowest tone
    for (const start of [first - 12, first, first + 12]) {
      const notes = midis.map((m) => start + ((((m - start) % 12) + 12) % 12));
      const moved = notes.filter((n, i) => n !== midis[i]).length;
      const off = Math.abs(start + 5.5 - centre);
      if (!best || moved < best.moved || (moved === best.moved && off < best.off - 1e-9)) {
        best = { start, end: start + 11, notes, moved, off };
      }
    }
  }
  return { start: best.start, end: best.end, notes: best.notes };
}

/**
 * @param {object} o
 * @param {object} o.piano   API returned by renderPianoKeyboard (colours)
 * @param {string} o.name    chord name, for the accessible label
 * @param {{note:string, spelled:string, rank:number}[]} o.tones  voiced chord tones, e.g. C4 E4 G4
 * @returns {HTMLDivElement}
 */
export function renderMiniKeyboard(o) {
  const { piano, name, tones } = o;
  const wrap = document.createElement('div');
  wrap.className = 'mk';
  const voiced = tones.map((t) => ({ t, m: noteToMidi(t.note) })).filter((x) => x.m !== null);
  if (!voiced.length) return wrap;
  const { start, end, notes } = miniWindow(voiced.map((x) => x.m));
  const toneByMidi = new Map(voiced.map((x, i) => [notes[i], x.t]));   // position in the window -> tone
  // like the large keyboard: every key of a chord pitch class is shaded, chord tones are labelled
  const chordPcs = new Set(notes.map((m) => m % 12));
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', `${name} on the keyboard: ${tones.map((t) => t.spelled).join(' ')}`);

  const board = document.createElement('div');
  board.className = 'mk-board';
  let whiteIdx = 0;
  for (let m = start; m <= end; m++) {
    const pc = m % 12;
    const white = WHITE_PCS.has(pc);
    if (white) whiteIdx += 1;
    const note = midiToNote(m);
    const key = document.createElement('div');
    key.className = `mk-key mk-${white ? 'white' : 'black'}`;
    key.dataset.note = note;                          // data-* only (no id/name: DOM clobbering)
    if (!white) key.style.setProperty('--mk-pos', String(whiteIdx));   // sits on the line after white key #whiteIdx
    const kc = piano?.keyColors?.(note);
    if (kc) {
      key.style.setProperty('--mk-oct', kc.light);
      key.style.setProperty('--mk-oct-accent', kc.accent);
    }
    if (chordPcs.has(pc)) {
      key.classList.add('is-chord');
      if (kc?.chord) {
        key.style.setProperty('--mk-chord', kc.chord);
        key.style.setProperty('--mk-chord-fg', kc.chordFg);
      }
    }
    const t = toneByMidi.get(m);
    if (t) {
      const role = piano?.roleColor?.(note, t.rank);
      if (role) key.style.setProperty('--mk-mark-bg', role);
      // label text: same rule as the large keyboard (chord-key text colour wins on black keys too)
      const lbl = document.createElement('span');
      lbl.className = 'mk-label';
      lbl.textContent = t.spelled;
      key.append(lbl);
    }
    board.append(key);
  }
  board.style.setProperty('--mk-white-count', String(whiteIdx));
  wrap.append(board);
  return wrap;
}

/**
 * @param {object} opts
 * @param {object} opts.piano       API returned by renderPianoKeyboard
 * @param {object} opts.audio       API returned by createPianoAudio
 * @param {string} opts.target      id of a <div> to render the buttons INTO. Takes precedence over `after`.
 * @param {string} opts.after       id of the piano container; used only when `target` is not given
 * @param {string} opts.dataTarget  id of the root chord element; looked up on every chord click (omit = not shown)
 * @param {string} opts.relativeTarget id of the relative minor/major element (omit = not shown)
 * No default ids: every element id is named by the caller (dashboard.js), matching index.html.
 * @param {number} opts.octave      octave of the played chord root (default 3)
 * @param {number} opts.strumMs     delay between chord tones, 0 = simultaneous (default 0)
 * @param {number} opts.velocity    chord volume 0–1 (default 0.7)
 * @returns {{select:Function, random:Function, clear:Function, destroy:Function, element:HTMLDivElement}}
 *          select('C'), select('Cdim7'), select('Bm7♭5') …   random(): the Random button's action
 *          showType('maj7') switches the button row (dropdown values = group ids)
 * Emits on the controls element: 'chord:select' detail {name, quality, group, rootName, root, notes, spelled}
 *                                'chord:type'   detail {type, title}
 *                                'chord:tone'   detail {chord, note, spelled, degree} | 'chord:clear'
 *                                'chord:octave' detail {chord, octave, notes}
 * Dispatches on document: 'chord:panels' detail {selected, root, minor} — the chords shown in the two panels
 *                         'chord:random' detail {name} — Random button, sent just before that chord is selected
 *                                        (circle-o-5ths.js picks a random progression on it)
 *                                'chord:octave-note' detail {chord, octave, note, spelled, degree}
 */
export function renderChordControls(opts = {}) {
  const {
    piano,
    audio,
    target = null,
    after = null,
    dataTarget = null,
    relativeTarget = null,
    octave = 3,                                      // C3: a fuller piano tone (SYNC: circle-o-5ths.js default)
    strumMs = 0,
    velocity = 0.7,
  } = opts;

  if (!piano || !audio) throw new TypeError('piano-chords: piano and audio are required');

  const hostId = target ?? after;
  if (!hostId) throw new TypeError('piano-chords: opts.target (or opts.after) is required — the id of the chord controls <div>');
  const host = getDiv(hostId);
  if (!host) throw new TypeError(`piano-chords: #${hostId} is not a <div>`);
  const cssVersion = parseFloat(getComputedStyle(host).getPropertyValue('--cc-css-version'));
  if (cssVersion !== CSS_VERSION) {
    console.warn(`piano-chords: www/css/piano-chords.css is ${Number.isFinite(cssVersion) ? `version ${cssVersion}` : 'missing or an older version'}; `
      + `piano-chords.js expects version ${CSS_VERSION} — chord controls may be styled wrongly`);
  }
  if (!dataTarget) console.warn('piano-chords: opts.dataTarget not given — root chord panel not shown');
  if (!relativeTarget) console.warn('piano-chords: opts.relativeTarget not given — relative chord panel not shown');
  let warnedNoData = false;
  let warnedNoRel = false;

  const wrap = document.createElement('div');
  wrap.className = 'cc';

  const panel = document.createElement('div');   // root chord panel (inside #root-chord-data)
  panel.className = 'cd';
  panel.hidden = true;

  const relPanel = document.createElement('div'); // relative minor/major panel (inside #minor-chord-data)
  relPanel.className = 'cd cd-relative';
  relPanel.hidden = true;

  let activeChord = null;
  const byName = new Map();          // chord name -> chord

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
  // #root-chord-data always holds the selected chord (the one shown on the keyboard).
  // #minor-chord-data holds its relative: relative minor for major-family / diminished chords,
  // relative major for minor-family chords (Fm -> A♭, titled "Relative Major").
  function panelChords(chord) {
    const rel = relativeChord(chord);
    return {
      rootChord: chord,
      minorChord: rel?.chord ?? null,
      relTitle: rel?.title ?? 'Relative Minor',
      relation: rel?.title === 'Relative Major' ? 'major' : 'minor',
    };
  }

  function renderPanel(chord, tones) {
    publishPanels(chord);
    // Resolve #chord-data on every click so it works even if the element is added after render
    if (!dataTarget) return;                         // not requested (warned once at start)
    const dataHost = getHost(dataTarget);
    if (!dataHost) {
      if (!warnedNoData) console.warn(`piano-chords: no element with id "${dataTarget}" (opts.dataTarget) — root chord panel not shown`);
      warnedNoData = true;
      return;
    }
    dataHost.classList.add('cd-host');               // host becomes a column the panel fills
    if (panel.parentElement !== dataHost) dataHost.append(panel);
    const relHost = relativeTarget ? getHost(relativeTarget) : null;
    relHost?.classList.add('cd-host');
    if (relHost && relPanel.parentElement !== relHost) relHost.append(relPanel);
    if (relativeTarget && !relHost && !warnedNoRel) {
      console.warn(`piano-chords: no element with id "${relativeTarget}" (opts.relativeTarget) — relative chord panel not shown`);
      warnedNoRel = true;
    }
    panel.replaceChildren();
    panel.hidden = false;

    const { rootChord, minorChord, relTitle } = panelChords(chord);

    panel.append(...chordSection(rootChord, tones, 'Root Chord'));

    relPanel.replaceChildren();
    relPanel.hidden = !minorChord;
    if (minorChord) relPanel.append(...chordSection(minorChord, voice(minorChord), relTitle));
  }

  // The two chords shown in #root-chord-data and #minor-chord-data are the single source of truth
  // for the progression panels (circle-o-5ths.js reads them via currentPanels / 'chord:panels').
  function publishPanels(chord) {
    const { rootChord, minorChord, relation } = panelChords(chord);
    // relation: 'minor' = #minor-chord-data holds a relative minor, 'major' = a relative major
    lastPanels = { selected: chordInfo(chord), root: chordInfo(rootChord), minor: minorChord ? chordInfo(minorChord) : null, relation };
    document.dispatchEvent(new CustomEvent('chord:panels', { detail: lastPanels }));
  }

  // Title + chord badge + tone circles + octave rows (same layout for root and relative chord)
  function chordSection(chord, tones, title) {
    // keyboard indicator text for anything clicked in this section
    const label = `${title} Chord ${chord.name}`;          // 'Root Chord Fm' / 'Relative Major Chord A♭'
    const heading = document.createElement('div');
    heading.className = 'cd-title';
    heading.textContent = title;

    // Chord name badge: click plays and re-highlights the whole chord on the keyboard
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'cd-name';
    name.textContent = chord.name;
    name.setAttribute('aria-label', `Play ${chord.name} and highlight it on the keyboard`);
    name.addEventListener('click', () => {
      clearPanelActive();
      showChordOnKeys(tones);
      piano.setStatus(label);
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
      btn.addEventListener('click', () => playTone(chord, t, btn, label));

      item.append(deg, btn);
      row.append(item);
    }
    // one-octave diagram of the chord, under the tone circles
    const mini = renderMiniKeyboard({ piano, name: chord.name, tones });
    return [heading, name, row, mini, renderOctaves(chord, label)];
  }

  const clearPanelActive = () =>
    [panel, relPanel].forEach((el) => el.querySelectorAll('.is-active').forEach((b) => b.classList.remove('is-active')));

  // --- octave rows (shared builder, see renderOctaveRows below) -----------------
  // Single tone: play it alone, highlight every key where it occurs in its role color
  function playTone(chord, t, btn, label) {
    clearPanelActive();
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
    piano.setStatus(`${label} · ${t.spelled} (${t.degree})`);
    emit('chord:tone', { chord: chord.name, note: t.note, spelled: t.spelled, degree: t.degree });
  }

  function renderOctaves(chord, label) {
    return renderOctaveRows({
      piano, audio, velocity, strumMs,
      name: chord.name,
      rootName: chord.rootName,
      rootPc: chord.root,
      tones: chord.intervals.map((t, rank) => ({
        rank,
        semitones: t.semis,
        spelled: spellTone(chord.rootName, t.semis, t.letters),
        degree: t.label,
      })),
      onSelect: clearPanelActive,
      emit,
      statusLabel: label,
    });
  }

  // --- chord data (all types, built once) -----------------------------------------
  const groups = CHORD_SECTIONS.flatMap((sec) => sec.groups);
  const chordsByGroup = new Map();   // group id -> chord[]
  for (const group of groups) {
    const list = group.roots.map((rootName, root) => ({
      name: `${rootName}${group.suffix}`,
      rootName,
      root,
      group: group.id,
      quality: group.quality,
      intervals: group.intervals,
    }));
    chordsByGroup.set(group.id, list);
    for (const chord of list) byName.set(chord.name, chord);
  }

  // --- chord selection ---------------------------------------------------------
  const markButtons = () => {
    for (const b of grid.children) {
      const isActive = activeChord && b.dataset.group === activeChord.group && Number(b.dataset.root) === activeChord.root;
      // same root, different type: outlined to show the matching root
      const isRelated = activeChord && !isActive && Number(b.dataset.root) === activeChord.root;
      b.classList.toggle('is-active', Boolean(isActive));
      b.classList.toggle('is-related', Boolean(isRelated));
      b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }
  };

  const clear = () => {
    activeChord = null;
    markButtons();
    audio.stopAll();
    piano.clearChord();
    piano.clearMarks();
    piano.clearStatus();
    panel.replaceChildren();
    panel.hidden = true;
    relPanel.replaceChildren();
    relPanel.hidden = true;
    emit('chord:clear');
  };

  // A single key played on the keyboard clears every active state shown here
  document.addEventListener('piano:press', () => clearPanelActive());

  // Clicking the same chord again re-strikes it from the beginning
  const select = (chord) => {
    if (chord.group !== typeSelect.value) showType(chord.group);
    activeChord = chord;
    markButtons();

    const tones = voice(chord);
    showChordOnKeys(tones);
    piano.setStatus(`Root Chord ${chord.name}`);
    renderPanel(chord, tones);
    audio.playChord(tones.map((t) => t.note), velocity, strumMs);

    emit('chord:select', {
      name: chord.name,
      quality: chord.quality,
      group: chord.group,        // chord-type id (SYNC: circle_of_fifths.json chord_qualities)
      rootName: chord.rootName,  // spelled root, e.g. 'D♭'
      root: chord.root,
      notes: tones.map((t) => t.note),
      spelled: tones.map((t) => t.spelled),
    });
  };

  // --- build: one panel = chord-type dropdown + one row of 12 buttons ------------
  const box = document.createElement('div');
  box.className = 'cc-group';
  box.setAttribute('role', 'group');

  const typeSelect = document.createElement('select');
  typeSelect.className = 'cc-type';
  typeSelect.setAttribute('aria-label', 'Chord type');
  for (const sec of CHORD_SECTIONS) {
    const og = document.createElement('optgroup');
    og.label = sec.title;
    for (const group of sec.groups) {
      const opt = document.createElement('option');
      opt.value = group.id;
      opt.textContent = group.title;
      og.append(opt);
    }
    typeSelect.append(og);
  }

  const grid = document.createElement('div');
  grid.className = 'cc-grid';

  // Swap the button row for a chord type; the current chord stays on the keyboard
  function showType(groupId) {
    const group = groups.find((g) => g.id === groupId) ?? groups[0];
    typeSelect.value = group.id;
    box.dataset.group = group.id;
    box.setAttribute('aria-label', group.title);
    grid.replaceChildren();
    for (const chord of chordsByGroup.get(group.id)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cc-btn';
      btn.dataset.root = String(chord.root);
      btn.dataset.group = group.id;
      btn.setAttribute('aria-label', `${chord.rootName} ${group.quality}`);
      btn.textContent = chord.name;
      btn.addEventListener('click', () => select(chord));
      grid.append(btn);
    }
    markButtons();
    emit('chord:type', { type: group.id, title: group.title });
  }

  typeSelect.addEventListener('change', () => showType(typeSelect.value));

  // Random: any chord of any type (never the one already showing) + a random progression.
  // 'chord:random' goes out first so the progressions switch before the chord redraws them.
  const all = [...chordsByGroup.values()].flat();
  function random() {
    const pool = all.filter((c) => c !== activeChord);
    const chord = pool[Math.floor(Math.random() * pool.length)];
    document.dispatchEvent(new CustomEvent('chord:random', { detail: { name: chord.name } }));
    select(chord);
    return chord.name;
  }
  const randomBtn = document.createElement('button');
  randomBtn.type = 'button';
  randomBtn.className = 'cc-random';
  randomBtn.setAttribute('aria-label', 'Random chord and progression');
  randomBtn.title = 'Random chord and progression';
  // dice icon + label, built as DOM nodes (no innerHTML)
  const pip = (cx, cy) => ['circle', { cx, cy, r: 1.6, fill: 'currentColor' }];
  const randomLabel = document.createElement('span');
  randomLabel.textContent = 'Random';
  randomBtn.append(
    svgIcon([['rect', { x: 3, y: 3, width: 18, height: 18, rx: 4, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }],
      pip(8, 8), pip(16, 8), pip(12, 12), pip(8, 16), pip(16, 16)]),
    randomLabel,
  );
  randomBtn.addEventListener('click', random);

  const head = document.createElement('div');       // [chord type ▾] [🎲 Random]
  head.className = 'cc-head';
  head.append(typeSelect, randomBtn);
  box.append(head, grid);
  wrap.append(box);
  showType('major'); // default: Major chords

  if (target) host.append(wrap);                     // inside the given column
  else host.insertAdjacentElement('afterend', wrap); // directly below the piano

  // Default on page load: C, selected everywhere (button, keyboard, chord panels -> progressions and
  // guitar follow via 'chord:panels'), without sound — browsers block audio before a user gesture.
  const defaultChord = byName.get('C');
  if (defaultChord) {
    activeChord = defaultChord;
    markButtons();
    const tones = voice(defaultChord);
    showChordOnKeys(tones);
    piano.setStatus(`Root Chord ${defaultChord.name}`);
    renderPanel(defaultChord, tones);
  }

  return {
    element: wrap,
    select: (name) => {
      const chord = byName.get(name);
      if (chord) select(chord);
    },
    random,
    showType,
    active: () => activeChord?.name ?? null,
    clear,
    destroy() {
      clear();
      wrap.remove();
      panel.remove();
      relPanel.remove();
    },
  };
}

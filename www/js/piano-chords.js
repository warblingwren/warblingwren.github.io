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
 * @param {string} opts.dataTarget  id of the root chord element (default 'root-chord-data'); looked up on every chord click
 * @param {string} opts.relativeTarget id of the relative minor/major element (default 'minor-chord-data')
 * @param {number} opts.octave      octave of the played chord root (default 4)
 * @param {number} opts.strumMs     delay between chord tones, 0 = simultaneous (default 0)
 * @param {number} opts.velocity    chord volume 0–1 (default 0.7)
 * @returns {{select:Function, clear:Function, destroy:Function, element:HTMLDivElement}}
 *          select('C'), select('Cdim7'), select('Bm7♭5') …
 *          showType('maj7') switches the button row (dropdown values = group ids)
 * Emits on the controls element: 'chord:select' detail {name, quality, group, rootName, root, notes, spelled}
 *                                'chord:type'   detail {type, title}
 *                                'chord:tone'   detail {chord, note, spelled, degree} | 'chord:clear'
 *                                'chord:octave' detail {chord, octave, notes}
 *                                'chord:octave-note' detail {chord, octave, note, spelled, degree}
 */
export function renderChordControls(opts = {}) {
  const {
    piano,
    audio,
    target = null,
    after = 'piano-keyboard',
    dataTarget = 'root-chord-data',
    relativeTarget = 'minor-chord-data',
    octave = 4,
    strumMs = 0,
    velocity = 0.7,
  } = opts;

  if (!piano || !audio) throw new TypeError('piano-chords: piano and audio are required');

  const hostId = target ?? after;
  const host = getDiv(hostId);
  if (!host) throw new TypeError(`piano-chords: #${hostId} is not a <div>`);
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
  function renderPanel(chord, tones) {
    // Resolve #chord-data on every click so it works even if the element is added after render
    const dataHost = getHost(dataTarget) ?? getHost('root-chord-data');
    if (!dataHost) {
      if (!warnedNoData) console.warn(`piano-chords: #${dataTarget} not found — chord detail panel not shown`);
      warnedNoData = true;
      return;
    }
    dataHost.classList.add('cd-host');               // host becomes a column the panel fills
    if (panel.parentElement !== dataHost) dataHost.append(panel);
    const relHost = getHost(relativeTarget) ?? getHost('minor-chord-data');
    relHost?.classList.add('cd-host');
    if (relHost && relPanel.parentElement !== relHost) relHost.append(relPanel);
    if (!relHost && !warnedNoRel) {
      console.warn(`piano-chords: #${relativeTarget} not found — relative chord panel not shown`);
      warnedNoRel = true;
    }
    panel.replaceChildren();
    panel.hidden = false;

    // #root-chord-data always holds the major side, #minor-chord-data the minor side.
    // Minor chord selected (e.g. Am): its relative major (C) goes in the root panel, Am in the minor panel.
    const rel = relativeChord(chord);
    const minorSelected = rel?.title === 'Relative Major';
    const rootChord = minorSelected ? rel.chord : chord;
    const minorChord = minorSelected ? chord : rel?.chord;

    panel.append(...chordSection(rootChord, minorSelected ? voice(rootChord) : tones, 'Root Chord'));

    relPanel.replaceChildren();
    relPanel.hidden = !minorChord;
    if (minorChord) relPanel.append(...chordSection(minorChord, voice(minorChord), 'Relative Minor'));
  }

  // Title + chord badge + tone circles + octave rows (same layout for root and relative chord)
  function chordSection(chord, tones, title) {
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
    return [heading, name, row, renderOctaves(chord)];
  }

  const clearPanelActive = () =>
    [panel, relPanel].forEach((el) => el.querySelectorAll('.is-active').forEach((b) => b.classList.remove('is-active')));

  // --- octave rows (shared builder, see renderOctaveRows below) -----------------
  // Single tone: play it alone, highlight every key where it occurs in its role color
  function playTone(chord, t, btn) {
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
    emit('chord:tone', { chord: chord.name, note: t.note, spelled: t.spelled, degree: t.degree });
  }

  function renderOctaves(chord) {
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
    panel.replaceChildren();
    panel.hidden = true;
    relPanel.replaceChildren();
    relPanel.hidden = true;
    emit('chord:clear');
  };

  // Clicking the same chord again re-strikes it from the beginning
  const select = (chord) => {
    if (chord.group !== typeSelect.value) showType(chord.group);
    activeChord = chord;
    markButtons();

    const tones = voice(chord);
    showChordOnKeys(tones);
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

  box.append(typeSelect, grid);
  wrap.append(box);
  showType('major'); // default: Major chords

  if (target) host.append(wrap);                     // inside the given column
  else host.insertAdjacentElement('afterend', wrap); // directly below the piano

  // Default #chord-data to C major (matches the progressions' default key).
  // Display only: the keyboard and the chord buttons stay untouched until a chord is clicked.
  const defaultChord = byName.get('C');
  if (defaultChord) renderPanel(defaultChord, voice(defaultChord));

  return {
    element: wrap,
    select: (name) => {
      const chord = byName.get(name);
      if (chord) select(chord);
    },
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

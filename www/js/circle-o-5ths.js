// =============================================================================
// circle-o-5ths.js — chord progressions driven by the circle of fifths
//
// Reads DATA/circle_of_fifths.json (keys, chords) and DATA/progressions.json
// (genre progressions) — both static, pre-generated — and listens for
// 'chord:select' from the chord controls. The selected chord sets the key:
//   major-family chord (major, maj7, 7, aug, sus, 6) -> major key on that root
//   minor-family chord (m, m7, m6, dim, dim7, m7♭5)  -> minor key on that root
// A genre-grouped dropdown picks a progression; each chord is shown as a card
// with a clickable chord badge (highlight + play the chord) and clickable tone
// circles (play one tone, highlight every key where it occurs).
// Cards only drive the piano — they never change #chord-data or the chord controls.
//
// SYNC POINT: chord quality ids come from circle_of_fifths.json `chord_qualities`
//   and must match the group ids in www/js/piano-chords.js.
// =============================================================================

import { midiToNote } from './piano-audio.js';
import { textOn } from './piano.js';

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACC_OFFSET = { '': 0, '♯': 1, '♭': -1, '𝄪': 2, '𝄫': -2 };
const ACC = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };

const pcOf = (name) => (LETTER_PC[name[0]] + (ACC_OFFSET[name.slice(1)] ?? 0) + 12) % 12;

// Spell the note `semis` semitones and `letters` letter-steps above `root`
export function spell(root, semis, letters) {
  const letter = LETTERS[(LETTERS.indexOf(root[0]) + letters) % 7];
  let diff = (pcOf(root) + semis - LETTER_PC[letter] + 24) % 12;
  if (diff > 6) diff -= 12;
  return letter + (ACC[diff] ?? '');
}

function validateCircle(data) {
  const ok = data && Array.isArray(data.positions) && data.positions.length === 12
    && data.lookup && Array.isArray(data.lookup.major_by_pc) && Array.isArray(data.lookup.minor_by_pc)
    && data.chord_qualities;
  if (!ok) throw new Error('circle-o-5ths: invalid circle_of_fifths.json');
  return data;
}

function validateProgressions(data, qualities) {
  const ok = data && Array.isArray(data.progressions) && Array.isArray(data.genres) && data.defaults;
  if (!ok) throw new Error('circle-o-5ths: invalid progressions.json');
  // quarantine progressions whose chord qualities the circle does not know
  const valid = data.progressions.filter((p) => Array.isArray(p.steps) && p.steps.every((s) => qualities[s.quality]));
  if (valid.length !== data.progressions.length) {
    console.warn('circle-o-5ths: skipped progressions with unknown chord qualities',
      data.progressions.filter((p) => !valid.includes(p)).map((p) => p.id));
  }
  return { ...data, progressions: valid };
}

/**
 * Circle-of-fifths query helpers (usable without the UI).
 * @param {object} circleData       parsed circle_of_fifths.json
 * @param {object} progressionData  parsed progressions.json (optional)
 */
export function createCircle(circleData, progressionData = { genres: [], defaults: {}, progressions: [] }) {
  validateCircle(circleData);
  const { positions, lookup, chord_qualities: qualities } = circleData;
  const prog = validateProgressions(progressionData, qualities);

  // Key on a tonic: mode 'major' | 'minor'. Picks the enharmonic spelling that matches rootName.
  function key(mode, tonicPc, rootName = null) {
    const pos = lookup[`${mode}_by_pc`][((tonicPc % 12) + 12) % 12];
    const p = positions[pos];
    let side = p[mode];
    let signature = p.signature;
    if (p.enharmonic && rootName && p.enharmonic[mode].tonic === rootName) {
      side = p.enharmonic[mode];
      signature = p.enharmonic.signature;
    }
    return { mode, position: pos, tonic: side.tonic, tonicPc: side.tonic_pc, name: side.name,
      scale: side.scale, diatonic: side.diatonic, signature, neighbors: p.neighbors };
  }

  const familyOf = (quality) => qualities[quality]?.family ?? 'major';

  // One progression step resolved in a key -> chord with spelled tones
  function resolveStep(k, step) {
    const d = k.diatonic[step.degree - 1];
    let source = null;
    if (d && d.semitones === step.semitones) source = d;
    else if (d?.harmonic && pcOf(d.harmonic.root) === (k.tonicPc + step.semitones) % 12) source = d.harmonic;

    const rootName = source ? source.root : spell(k.tonic, step.semitones, step.degree - 1);
    const q = qualities[step.quality];
    // Prefer the pre-spelled chord from the data file when the quality matches
    const pre = source && [source.triad, source.seventh].find((c) => c.quality === step.quality);
    const tones = q.intervals.map((iv, i) => ({
      rank: i,
      semitones: iv.semitones,
      degree: iv.label,
      spelled: pre ? pre.tones[i].name : spell(rootName, iv.semitones, iv.letters),
      pc: (pcOf(rootName) + iv.semitones) % 12,
    }));
    return {
      roman: step.roman,
      name: rootName + q.suffix,
      rootName,
      rootPc: pcOf(rootName),
      quality: step.quality,
      qualityName: q.name,
      function: d && d.semitones === step.semitones ? d.function : null,
      tones,
    };
  }

  const progressions = (mode) => prog.progressions.filter((p) => p.mode === mode);
  const progression = (id) => prog.progressions.find((p) => p.id === id) ?? null;

  return {
    data: circleData,
    genres: prog.genres,
    defaults: prog.defaults,
    key,
    familyOf,
    resolveStep,
    progressions,
    progression,
    resolve: (k, prog) => prog.steps.map((s) => resolveStep(k, s)),
    neighbors: (k) => ({
      dominant: key('major', positions[k.neighbors.clockwise].major.tonic_pc),
      subdominant: key('major', positions[k.neighbors.counterclockwise].major.tonic_pc),
    }),
  };
}

const getHost = (id) => {
  const el = id ? document.getElementById(id) : null;
  return el instanceof HTMLElement && !(el instanceof HTMLFormElement) ? el : null;
};

const sigText = (s) => (s.count === 0 ? 'none (no sharps or flats)'
  : `${s.count} ${s.type === 'sharps' ? '♯' : '♭'} (${s.accidentals.join(' ')})`);

/**
 * @param {object} opts
 * @param {object} opts.piano       API returned by renderPianoKeyboard
 * @param {object} opts.audio       API returned by createPianoAudio
 * @param {string} opts.target      id of the container element (default 'circle-progressions')
 * @param {string} opts.dataUrl     circle data file (default 'DATA/circle_of_fifths.json')
 * @param {string} opts.progressionsUrl progressions data file (default 'DATA/progressions.json')
 * @param {number} opts.octave      octave of each progression chord's root (default 4)
 * @param {number} opts.velocity    chord volume 0–1 (default 0.7)
 * @param {number} opts.strumMs     delay between chord tones (default 0)
 * @returns {Promise<{circle, setKey, select, element}>}
 * Emits on the container: 'progression:change' {key, progression} | 'progression:chord' {roman, name} | 'progression:tone'
 */
export async function renderCircleProgressions(opts = {}) {
  const {
    piano,
    audio,
    target = 'circle-progressions',
    dataUrl = 'DATA/circle_of_fifths.json',
    progressionsUrl = 'DATA/progressions.json',
    octave = 4,
    velocity = 0.7,
    strumMs = 0,
  } = opts;

  if (!piano || !audio) throw new TypeError('circle-o-5ths: piano and audio are required');
  const host = getHost(target);
  if (!host) throw new TypeError(`circle-o-5ths: #${target} not found`);

  const load = async (url) => {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error(`circle-o-5ths: ${r.status} loading ${url}`);
    return r.json();
  };
  const [circleData, progressionData] = await Promise.all([load(dataUrl), load(progressionsUrl)]);
  const circle = createCircle(circleData, progressionData);

  let currentKey = circle.key('major', 0, 'C');   // default until a chord is selected
  let currentProg = circle.progression(circle.defaults.major);

  // --- DOM -------------------------------------------------------------------
  const wrap = document.createElement('div');
  wrap.className = 'cp';

  const head = document.createElement('div');
  head.className = 'cp-head';

  const keyLabel = document.createElement('div');
  keyLabel.className = 'cp-key';

  const select = document.createElement('select');
  select.className = 'cc-type cp-select';          // same look as the chord-type dropdown
  select.setAttribute('aria-label', 'Progression');

  const roman = document.createElement('div');
  roman.className = 'cp-roman';

  const desc = document.createElement('div');
  desc.className = 'cp-desc';

  const cards = document.createElement('div');
  cards.className = 'row cp-cards';               // Bootstrap grid: one column per card

  head.append(keyLabel, select);
  wrap.append(head, roman, desc, cards);
  host.append(wrap);

  const emit = (type, detail) => wrap.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  // --- piano actions (never touch #chord-data) -------------------------------
  const voice = (chord) => {
    const rootMidi = (octave + 1) * 12 + chord.rootPc;
    return chord.tones.map((t) => ({ ...t, note: midiToNote(rootMidi + t.semitones) }));
  };

  const clearActive = () => {
    cards.querySelectorAll('.is-active').forEach((el) => el.classList.remove('is-active'));
    cards.querySelectorAll('.card.border-primary').forEach((el) => el.classList.remove('border-primary'));
  };

  function playChord(chord, card, badge) {
    clearActive();
    card.classList.add('is-active', 'border-primary');
    badge.classList.add('is-active');
    const tones = voice(chord);
    piano.clearPlayed();
    piano.showChord(tones.map((t) => t.pc));
    const played = new Set(tones.map((t) => t.note));
    const marks = tones.map((t) => ({ note: t.note, label: t.spelled, badge: t.degree, rank: t.rank, root: t.rank === 0 }));
    for (const n of piano.notesWithPitchClass(chord.rootPc)) {
      if (!played.has(n)) marks.push({ note: n, badge: 'R', rank: 0, root: true });
    }
    piano.markNotes(marks);
    audio.playChord(tones.map((t) => t.note), velocity, strumMs);
    emit('progression:chord', { roman: chord.roman, name: chord.name, notes: tones.map((t) => t.note) });
  }

  function playTone(chord, t, card, btn) {
    clearActive();
    card.classList.add('is-active', 'border-primary');
    btn.classList.add('is-active');
    piano.clearChord();
    piano.clearPlayed();
    piano.markNotes(piano.notesWithPitchClass(t.pc).map((n) => ({
      note: n, label: t.spelled, badge: t.degree, rank: t.rank, root: t.rank === 0, fill: true,
    })));
    audio.play(t.note);
    emit('progression:tone', { chord: chord.name, note: t.note, spelled: t.spelled, degree: t.degree });
  }

  // --- rendering -------------------------------------------------------------
  function renderSelect() {
    select.replaceChildren();
    const list = circle.progressions(currentKey.mode);
    for (const genre of circle.genres) {
      const items = list.filter((p) => p.genre === genre);
      if (!items.length) continue;
      const og = document.createElement('optgroup');
      og.label = genre;
      for (const p of items) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        og.append(opt);
      }
      select.append(og);
    }
    select.value = currentProg.id;
  }

  function renderCards() {
    keyLabel.replaceChildren();
    const kv = (cls, label, value) => {
      const rowEl = document.createElement('div');
      rowEl.className = cls;
      const l = document.createElement('span');
      l.className = 'cp-kv-label';
      l.textContent = label;
      const v = document.createElement('span');
      v.className = 'cp-kv-value';
      v.textContent = value;
      rowEl.append(l, v);
      return rowEl;
    };
    const keyName = currentKey.name;
    keyLabel.append(
      kv('cp-key-name', 'Key:', keyName),
      kv('cp-key-signature', 'Signature:', sigText(currentKey.signature)),
    );

    roman.textContent = currentProg.roman;
    desc.textContent = currentProg.description || '';

    cards.replaceChildren();
    const chords = circle.resolve(currentKey, currentProg);
    // Bootstrap columns: 1 per row on phones, 2 on small screens, all on one row from lg up
    const lg = chords.length <= 4 ? `col-lg-${12 / chords.length}` : 'col-lg';
    for (const chord of chords) {
      const tones = voice(chord);

      const col = document.createElement('div');
      col.className = `col-12 col-sm-6 ${lg} mb-3`;

      // Bootstrap card; body uses the same .cd-* layout as #chord-data, compact size
      const card = document.createElement('div');
      card.className = 'card h-100 cp-card';

      const body = document.createElement('div');
      body.className = 'card-body cd cd--compact';

      const rn = document.createElement('span');
      rn.className = 'cp-card-roman';
      rn.textContent = chord.roman;
      rn.setAttribute('aria-label', `Position ${chord.roman} in the progression`);

      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'cd-name';
      badge.textContent = chord.name;
      badge.setAttribute('aria-label', `Play ${chord.name} (${chord.roman}) and highlight it on the keyboard`);
      badge.addEventListener('click', () => playChord(chord, card, badge));

      const row = document.createElement('div');
      row.className = 'cd-tones';
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
        btn.setAttribute('aria-label', `Play ${t.spelled} (${t.degree} of ${chord.name})`);
        const color = piano.roleColor(t.note, t.rank);
        if (color) {
          btn.style.setProperty('--cd-circle-bg', color);
          btn.style.setProperty('--cd-circle-fg', textOn(color));
        }
        btn.addEventListener('click', () => playTone(chord, t, card, btn));
        item.append(deg, btn);
        row.append(item);
      }

      body.append(rn, badge, row);
      card.append(body);
      col.append(card);
      cards.append(col);
    }
    emit('progression:change', { key: currentKey.name, progression: currentProg.id });
  }

  function setKey(mode, tonicPc, rootName) {
    currentKey = circle.key(mode, tonicPc, rootName);
    if (currentProg.mode !== mode) currentProg = circle.progression(circle.defaults[mode]);
    renderSelect();
    renderCards();
  }

  select.addEventListener('change', () => {
    currentProg = circle.progression(select.value) ?? currentProg;
    renderCards();
  });

  // Follow the chord controls: the selected chord sets the key
  const onChordSelect = (e) => {
    const d = e.detail;
    if (!d || typeof d.root !== 'number') return;
    setKey(circle.familyOf(d.group), d.root, d.rootName);
  };
  document.addEventListener('chord:select', onChordSelect);

  renderSelect();
  renderCards();

  return {
    element: wrap,
    circle,
    setKey,
    select: (id) => {
      const p = circle.progression(id);
      if (p && p.mode === currentKey.mode) { currentProg = p; select.value = id; renderCards(); }
    },
    destroy() {
      document.removeEventListener('chord:select', onChordSelect);
      wrap.remove();
    },
  };
}

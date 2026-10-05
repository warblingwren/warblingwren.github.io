// =============================================================================
// circle-o-5ths.js — chord progressions driven by the circle of fifths
//
// Renders into #root-circle-progressions and #minor-circle-progressions.
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
import { renderOctaveRows, currentPanels } from './piano-chords.js';

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

  // Relative key: major -> relative minor (6th degree), minor -> relative major (3rd degree).
  // Spelled from the current tonic so enharmonic keys stay consistent (G♭ major -> E♭ minor).
  function relativeKey(k) {
    return k.mode === 'major'
      ? key('minor', (k.tonicPc + 9) % 12, spell(k.tonic, 9, 5))
      : key('major', (k.tonicPc + 3) % 12, spell(k.tonic, 3, 2));
  }

  // Tonic triad of a key, as a resolved chord
  const tonicChord = (k) => resolveStep(k, k.mode === 'minor'
    ? { roman: 'i', degree: 1, semitones: 0, quality: 'minor' }
    : { roman: 'I', degree: 1, semitones: 0, quality: 'major' });

  const SEVENTH_ROMAN = { min7: '7', dom7: '7', maj7: 'maj7', dim7: '7' };
  const seventhRoman = (roman, quality) => (quality === 'm7b5'
    ? `${roman.replace('°', '')}ø7`
    : roman + (SEVENTH_ROMAN[quality] ?? '7'));

  // Re-voice a progression's scale degrees in another key, using that key's diatonic chords.
  // Triads stay triads, sevenths stay sevenths. In a minor key a major/dominant V uses the
  // harmonic-minor V so the cadence still pulls home.
  function translate(p, toKey) {
    const steps = p.steps.map((st) => {
      const d = toKey.diatonic[st.degree - 1];
      const seventh = qualities[st.quality].intervals.length === 4;
      const useHarmonic = toKey.mode === 'minor' && st.degree === 5 && d.harmonic
        && qualities[st.quality].family === 'major';
      const src = useHarmonic ? d.harmonic : d;
      const chord = seventh ? src.seventh : src.triad;
      return {
        roman: seventh ? seventhRoman(src.roman, chord.quality) : src.roman,
        degree: st.degree,
        semitones: (pcOf(src.root) - toKey.tonicPc + 12) % 12,
        quality: chord.quality,
      };
    });
    const roman = Array.isArray(p.bars)
      ? p.bars.map((b) => steps[b].roman).join(' | ')
      : steps.map((st) => st.roman).join(' – ');
    return { ...p, mode: toKey.mode, steps, roman };
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
    relativeKey,
    tonicChord,
    translate,
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

// Resolve a container by id, trying each candidate in order. If none exists yet (script ran
// before the element was parsed or added), wait for the DOM — up to timeoutMs — instead of failing.
function waitForHost(ids, timeoutMs = 5000) {
  const find = () => ids.map(getHost).find(Boolean) ?? null;
  const now = find();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const obs = new MutationObserver(() => {
      const el = find();
      if (el) { obs.disconnect(); clearTimeout(timer); resolve(el); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(() => { obs.disconnect(); resolve(find()); }, timeoutMs);
  });
}

const sigText = (s) => (s.count === 0 ? 'none (no sharps or flats)'
  : `${s.count} ${s.type === 'sharps' ? '♯' : '♭'} (${s.accidentals.join(' ')})`);

/**
 * Root progressions + relative (minor/major) progressions.
 * @param {object} opts
 * @param {object} opts.piano          API returned by renderPianoKeyboard
 * @param {object} opts.audio          API returned by createPianoAudio
 * @param {string} opts.target         root progressions container id (default 'root-circle-progressions')
 * @param {string} opts.relativeTarget relative progressions container id (default 'minor-circle-progressions'; skipped if absent)
 * @param {string} opts.dataUrl        circle data file (default 'DATA/circle_of_fifths.json')
 * @param {string} opts.progressionsUrl progressions data file (default 'DATA/progressions.json')
 * @param {number} opts.octave         octave of each progression chord's root (default 4)
 * @param {number} opts.velocity       chord volume 0–1 (default 0.7)
 * @param {number} opts.strumMs        delay between chord tones (default 0)
 * @returns {Promise<{circle, setKey, select, element, relativeElement, destroy}|null>}  null if the root container is missing
 * Emits (bubbling): 'progression:change' {key, relativeKey, progression}
 *                   'progression:chord' {roman, name, notes} | 'progression:tone' {chord, note, spelled, degree}
 */
export async function renderCircleProgressions(opts = {}) {
  const {
    piano,
    audio,
    target = 'root-circle-progressions',
    relativeTarget = 'minor-circle-progressions',
    dataUrl = 'DATA/circle_of_fifths.json',
    progressionsUrl = 'DATA/progressions.json',
    octave = 4,
    velocity = 0.7,
    strumMs = 0,
  } = opts;

  if (!piano || !audio) throw new TypeError('circle-o-5ths: piano and audio are required');

  // Containers: the requested id, falling back to the standard id; waits if not in the DOM yet.
  const ROOT_ID = 'root-circle-progressions';
  const MINOR_ID = 'minor-circle-progressions';
  const [host, relHost] = await Promise.all([
    waitForHost([...new Set([target, ROOT_ID])]),
    waitForHost([...new Set([relativeTarget, MINOR_ID])]),
  ]);
  if (!host) {
    console.error(`circle-o-5ths: no element with id "${target}"${target !== ROOT_ID ? ` or "${ROOT_ID}"` : ''} — progressions not shown`);
    return null;
  }
  if (!relHost) console.warn(`circle-o-5ths: no element with id "${relativeTarget}" — relative progressions not shown`);

  const load = async (url) => {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error(`circle-o-5ths: ${r.status} loading ${url}`);
    return r.json();
  };
  const [circleData, progressionData] = await Promise.all([load(dataUrl), load(progressionsUrl)]);
  const circle = createCircle(circleData, progressionData);

  // #root-circle-progressions always shows the major key, #minor-circle-progressions its relative minor.
  // A minor chord selection (e.g. Am) sets the pair from the minor side (A minor + C major).
  let majorKey = circle.key('major', 0, 'C');     // default until a chord is selected
  let minorKey = circle.relativeKey(majorKey);
  let currentProg = circle.progression(circle.defaults.major);

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // --- shared piano actions (cards never touch the chord-data panels) ---------
  const panels = [];
  const clearActive = () => panels.forEach((w) => {
    w.querySelectorAll('.is-active').forEach((n) => n.classList.remove('is-active'));
    w.querySelectorAll('.card.border-primary').forEach((n) => n.classList.remove('border-primary'));
  });
  const emitFrom = (node) => (type, detail) => node.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  const voice = (chord) => {
    const rootMidi = (octave + 1) * 12 + chord.rootPc;
    return chord.tones.map((t) => ({ ...t, note: midiToNote(rootMidi + t.semitones) }));
  };

  function playChord(chord, card, trigger, emit, label) {
    clearActive();
    card?.classList.add('is-active', 'border-primary');
    trigger.classList.add('is-active');
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
    piano.setStatus(label ?? chord.name);
    emit('progression:chord', { roman: chord.roman, name: chord.name, notes: tones.map((t) => t.note) });
  }

  function playTone(chord, t, card, btn, emit, label) {
    clearActive();
    card.classList.add('is-active', 'border-primary');
    btn.classList.add('is-active');
    piano.clearChord();
    piano.clearPlayed();
    piano.markNotes(piano.notesWithPitchClass(t.pc).map((n) => ({
      note: n, label: t.spelled, badge: t.degree, rank: t.rank, root: t.rank === 0, fill: true,
    })));
    audio.play(t.note);
    piano.setStatus(`${label} · ${t.spelled} (${t.degree})`);
    emit('progression:tone', { chord: chord.name, note: t.note, spelled: t.spelled, degree: t.degree });
  }

  // --- panel builder (root + relative share the same layout) -------------------
  function buildPanel(hostEl, variant) {
    const wrap = el('div', variant === 'relative' ? 'cp cp--relative' : 'cp');
    const emit = emitFrom(wrap);
    const title = variant === 'relative' ? el('div', 'cp-title') : null;
    const head = el('div', 'cp-head');
    const keyBox = el('div', 'cp-key');
    const controls = el('div', 'cp-controls');
    const roman = el('div', 'cp-roman');              // chord badges of the chosen progression, in order
    roman.setAttribute('role', 'group');
    roman.setAttribute('aria-label', 'Chosen progression chords');
    const desc = el('div', 'cp-desc');
    const note = el('div', 'cp-note');                 // why the key differs from the chord (dim chords)
    note.hidden = true;
    const cards = el('div', 'row cp-cards');           // Bootstrap grid: one column per card
    head.append(keyBox, controls);
    if (title) wrap.append(title);
    wrap.append(head, note, roman, desc, cards);
    hostEl.append(wrap);
    panels.push(wrap);
    new ResizeObserver(() => layoutCards(cards)).observe(cards);
    const label = variant === 'relative' ? 'Relative Minor Progression' : 'Root Progression';
    return { wrap, emit, title, keyBox, controls, note, roman, desc, cards, label };
  }

  function renderKeyBox(box, k) {
    const kv = (cls, label, value) => {
      const row = el('div', cls);
      row.append(el('span', 'cp-kv-label', label), el('span', 'cp-kv-value', value));
      return row;
    };
    box.replaceChildren(
      kv('cp-key-name', 'Key:', k.name),
      kv('cp-key-signature', 'Signature:', sigText(k.signature)),
    );
  }

  function renderCards(panel, k, prog) {
    const { cards, emit } = panel;
    cards.replaceChildren();
    const chords = circle.resolve(k, prog);
    // Bootstrap columns: 1 per row on phones, 2 on small screens, all on one row from lg up
    cards.dataset.tones = String(Math.max(...chords.map((c) => c.tones.length)));
    const items = [];                                        // one per step: {chord, card, label}
    for (const chord of chords) {
      const tones = voice(chord);
      const col = el('div', 'col-12 mb-3 cp-col');           // width set by layoutCards()
      const card = el('div', 'card h-100 cp-card');           // Bootstrap card
      const body = el('div', 'card-body cd cd--compact');     // #chord-data layout, compact

      const rn = el('span', 'cp-card-roman', chord.roman);
      rn.setAttribute('aria-label', `Position ${chord.roman} in the progression`);

      const badge = el('button', 'cd-name', chord.name);
      badge.type = 'button';
      badge.setAttribute('aria-label', `Play ${chord.name} (${chord.roman}) and highlight it on the keyboard`);
      // keyboard indicator, e.g. "Root Progression IV: F" / "Relative Minor Progression iv: Dm"
      const label = `${panel.label} ${chord.roman}: ${chord.name}`;
      badge.addEventListener('click', () => playChord(chord, card, badge, emit, label));

      const row = el('div', 'cd-tones');
      for (const t of tones) {
        const item = el('div', 'cd-tone');
        const btn = el('button', `cd-circle${t.rank === 0 ? ' is-root' : ''}`, t.spelled);
        btn.type = 'button';
        btn.setAttribute('aria-label', `Play ${t.spelled} (${t.degree} of ${chord.name})`);
        const color = piano.roleColor(t.note, t.rank);
        if (color) {
          btn.style.setProperty('--cd-circle-bg', color);
          btn.style.setProperty('--cd-circle-fg', textOn(color));
        }
        btn.addEventListener('click', () => playTone(chord, t, card, btn, emit, label));
        item.append(el('div', 'cd-degree', t.degree), btn);
        row.append(item);
      }

      // Octave rows (same component as #root-chord-data): label plays the chord, circles single notes
      const octaves = renderOctaveRows({
        piano, audio, velocity, strumMs,
        name: chord.name,
        rootName: chord.rootName,
        rootPc: chord.rootPc,
        tones: chord.tones,
        onSelect: () => { clearActive(); card.classList.add('is-active', 'border-primary'); },
        statusLabel: label,
        emit,
      });

      body.append(rn, badge, row, octaves);
      card.append(body);
      col.append(card);
      cards.append(col);
      items.push({ chord, card, label });
    }
    layoutCards(cards);
    return items;
  }

  // Chosen progression as chord badges (the roman numerals are in the dropdown).
  // Bar-based forms (blues) show every bar, separated by '|'; others by '–'.
  // Each badge is exactly the chord on its card and plays it the same way.
  function renderSequence(panel, prog, items) {
    const box = panel.roman;
    box.replaceChildren();
    const bars = Array.isArray(prog.bars);
    const order = bars ? prog.bars : items.map((_, i) => i);
    order.forEach((stepIdx, i) => {
      const item = items[stepIdx];
      if (!item) return;
      if (i > 0) {
        const sep = el('span', 'cp-seq-sep', bars ? '|' : '–');
        sep.setAttribute('aria-hidden', 'true');
        box.append(sep);
      }
      const { chord, card, label } = item;
      const b = el('button', 'cp-seq-badge', chord.name);
      b.type = 'button';
      b.setAttribute('aria-label', `${bars ? `Bar ${i + 1}: ` : ''}play ${chord.name} (${chord.roman}) and highlight it on the keyboard`);
      b.addEventListener('click', () => playChord(chord, card, b, panel.emit, label));
      box.append(b);
    });
  }

  // Bootstrap columns sized to the panel's own width (not the screen): as many cards per row
  // as fit without squeezing the octave rows, all on one row when there is room.
  // SYNC: per-card width estimate matches .cd--compact octave sizes in circle-o-5ths.css
  function layoutCards(cards) {
    const cols = [...cards.children];
    if (!cols.length) return;
    const tones = Number(cards.dataset.tones) || 3;
    const minCol = 125 + 34 * tones;                     // card padding + octave label + note circles
    const perRow = Math.max(1, Math.min(cols.length, Math.floor(cards.clientWidth / minCol)));
    const pct = `${100 / perRow}%`;
    for (const c of cols) { c.style.flex = `0 0 ${pct}`; c.style.maxWidth = pct; }
  }

  // --- root panel: key box | "Choose a progression" + "Relative Minor:" badge ---
  const root = buildPanel(host, 'root');

  const select = el('select', 'cc-type cp-select');   // same look as the chord-type dropdown
  const choose = el('label', 'cp-choose');            // label wraps the select (no id needed)
  choose.append(el('span', 'cp-choose-text', 'Choose a progression'), select);

  const relRow = el('div', 'cp-rel');
  const relLabel = el('span', 'cp-rel-label');
  const relBadge = el('button', 'cp-rel-badge');
  relBadge.type = 'button';
  relRow.append(relLabel, relBadge);
  root.controls.append(choose, relRow);

  let relChord = null;
  relBadge.addEventListener('click', () => {
    if (relChord) playChord(relChord, null, relBadge, root.emit, `Relative Minor Chord ${relChord.name}`);
  });

  // --- relative panel: title, key box, static progression label ----------------
  const rel = relHost ? buildPanel(relHost, 'relative') : null;
  let relProgName = null;
  let rootBadge = null;
  let rootChordRef = null;
  if (rel) {
    const box = el('div', 'cp-choose');
    relProgName = el('div', 'cp-static');
    box.append(el('span', 'cp-choose-text', 'Progression'), relProgName);

    // "Root Chord:" + badge (mirror of the "Relative Minor:" badge in the root panel)
    const rootRow = el('div', 'cp-rel');
    rootBadge = el('button', 'cp-rel-badge');
    rootBadge.type = 'button';
    rootRow.append(el('span', 'cp-rel-label', 'Root Chord:'), rootBadge);
    rootBadge.addEventListener('click', () => {
      if (rootChordRef) playChord(rootChordRef, null, rootBadge, rel.emit, `Root Chord ${rootChordRef.name}`);
    });

    rel.controls.append(box, rootRow);
  }

  // Dropdown lists every progression (major and minor), grouped by genre.
  // Each progression is shown natively in the panel of its own mode and translated in the other.
  function renderSelect() {
    select.replaceChildren();
    for (const genre of circle.genres) {
      const items = [...circle.progressions('major'), ...circle.progressions('minor')].filter((p) => p.genre === genre);
      if (!items.length) continue;
      const og = document.createElement('optgroup');
      og.label = genre;
      for (const p of items) {
        const tag = p.mode === 'minor' && !/minor/i.test(p.name) ? ' (minor)' : '';
        const opt = el('option', null, p.name + tag);
        opt.value = p.id;
        og.append(opt);
      }
      select.append(og);
    }
    select.value = currentProg.id;
  }

  const nativeKey = () => (currentProg.mode === 'minor' ? minorKey : majorKey);
  const progIn = (k) => (currentProg.mode === k.mode ? currentProg : circle.translate(currentProg, k));
  const descIn = (k) => (currentProg.mode === k.mode
    ? currentProg.description || ''
    : `The same scale degrees as ${currentProg.name} in ${nativeKey().name}, played in ${k.name}.`);

  function render() {
    for (const pnl of [root, rel]) {
      if (!pnl) continue;
      pnl.note.textContent = keyNote;
      pnl.note.hidden = !keyNote;
    }

    // root panel: major key
    const rootProg = progIn(majorKey);
    renderKeyBox(root.keyBox, majorKey);
    root.desc.textContent = descIn(majorKey);
    renderSequence(root, rootProg, renderCards(root, majorKey, rootProg));

    // "Relative Minor:" = exactly the chord in #minor-chord-data
    relChord = panelMinor ? asBadgeChord(panelMinor, 'i') : { ...circle.tonicChord(minorKey), roman: 'i' };
    relLabel.textContent = 'Relative Minor:';
    relBadge.textContent = relChord.name;
    relBadge.setAttribute('aria-label', `Play the relative minor chord ${relChord.name} and highlight it on the keyboard`);

    // minor panel: relative minor key
    if (rel) {
      const minorProg = progIn(minorKey);
      rel.title.textContent = 'Relative Minor Progression';
      renderKeyBox(rel.keyBox, minorKey);
      relProgName.textContent = currentProg.name;
      // "Root Chord:" = exactly the chord in #root-chord-data
      rootChordRef = panelRoot ? asBadgeChord(panelRoot, 'I') : { ...circle.tonicChord(majorKey), roman: 'I' };
      rootBadge.textContent = rootChordRef.name;
      rootBadge.setAttribute('aria-label', `Play the root chord ${rootChordRef.name} and highlight it on the keyboard`);
      rel.desc.textContent = descIn(minorKey);
      renderSequence(rel, minorProg, renderCards(rel, minorKey, minorProg));
    }

    root.emit('progression:change', { key: majorKey.name, relativeKey: minorKey.name, progression: currentProg.id });
  }

  // Key a selected chord belongs to.
  //   Diminished chords don't define a key of their own, so they go to the key they naturally
  //   sit in: dim / m7♭5 = vii° / viiø7 of the major key a half step up (G♯dim -> A major);
  //   dim7 = vii°7 of the harmonic-minor key a half step up (G♯dim7 -> A minor).
  //   Augmented chords fit several keys equally, so the key stays on the chord the user chose.
  //   Everything else: major-family -> major key on its root, minor-family -> minor key on its root.
  const LEADING_TONE = { dim: ['major', 'vii°'], m7b5: ['major', 'viiø7'], dim7: ['minor', 'vii°7'] };
  // Conventional minor-key spellings — SYNC: MINOR_ROOTS in piano-chords.js (G♯ minor, not A♭ minor)
  const MINOR_KEY_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];
  let keyNote = '';
  function homeKeyOf(d) {
    const lt = LEADING_TONE[d.group];
    if (lt) {
      const [mode, roman] = lt;
      const tonicPc = (d.root + 1) % 12;                 // a half step up: G♯ -> A
      const tonicName = mode === 'minor' ? MINOR_KEY_NAMES[tonicPc] : spell(d.rootName, 1, 1);
      const k = circle.key(mode, tonicPc, tonicName);
      return { mode, tonicPc: k.tonicPc, tonicName: k.tonic, note: `${d.name} is the ${roman} chord of ${k.name}.` };
    }
    if (d.group === 'aug' || d.group === 'aug7') {
      return { mode: 'major', tonicPc: d.root, tonicName: d.rootName,
        note: `${d.name} fits several keys; showing the key of ${d.rootName}, the chord you chose.` };
    }
    return { mode: circle.familyOf(d.group), tonicPc: d.root, tonicName: d.rootName, note: '' };
  }

  // Set the key pair from a chord root: mode 'major' -> that major key + its relative minor,
  // mode 'minor' -> that minor key + its relative major.
  function setKey(mode, tonicPc, rootName) {
    const k = circle.key(mode, tonicPc, rootName);
    if (k.mode === 'major') { majorKey = k; minorKey = circle.relativeKey(k); }
    else { minorKey = k; majorKey = circle.relativeKey(k); }
    render();
  }

  select.addEventListener('change', () => {
    currentProg = circle.progression(select.value) ?? currentProg;
    render();
  });

  // Follow the chord-data panels: their two chords are used exactly, never recomputed.
  //   #minor-chord-data chord -> "Relative Minor:" badge + the minor progression's key (same root)
  //   #root-chord-data chord  -> "Root Chord:" badge
  //   selected chord          -> the root progression's key (home key for diminished chords)
  let panelRoot = null;
  let panelMinor = null;
  const asBadgeChord = (c, roman) => ({ name: c.name, rootName: c.rootName, rootPc: c.root, tones: c.tones, roman });

  function applyPanels(p) {
    if (!p?.selected) return;
    panelRoot = p.root;
    panelMinor = p.minor;
    const home = homeKeyOf(p.selected);
    keyNote = home.note;
    const homeKey = circle.key(home.mode, home.tonicPc, home.tonicName);
    majorKey = homeKey.mode === 'major' ? homeKey : circle.relativeKey(homeKey);
    minorKey = panelMinor ? circle.key('minor', panelMinor.root, panelMinor.rootName) : circle.relativeKey(majorKey);
    render();
  }
  const onPanels = (e) => applyPanels(e.detail);
  // A single key played on the keyboard clears every active card/badge here
  const onKeyPress = () => clearActive();
  document.addEventListener('piano:press', onKeyPress);
  document.addEventListener('chord:panels', onPanels);

  renderSelect();
  if (currentPanels()) applyPanels(currentPanels());   // panels rendered before this module loaded
  else render();

  return {
    element: root.wrap,
    relativeElement: rel?.wrap ?? null,
    circle,
    setKey,
    select: (id) => {
      const p = circle.progression(id);
      if (p) { currentProg = p; select.value = id; render(); }
    },
    destroy() {
      document.removeEventListener('chord:panels', onPanels);
      document.removeEventListener('piano:press', onKeyPress);
      panels.forEach((w) => w.remove());
    },
  };
}

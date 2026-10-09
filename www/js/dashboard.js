import './colors.js';
import { renderPianoKeyboard } from './piano.js';
import { createPianoAudio } from './piano-audio.js';
import { renderChordControls } from './piano-chords.js';
import { renderCircleProgressions } from './circle-o-5ths.js';
import { renderGuitarFretboard } from './guitar.js';
import { renderGuitarProgressions } from './guitar-chords.js';

// Element ids — the ONLY place the JavaScript names them. SYNC: must match index.html.
const IDS = {
  chordControls: 'root-chords',
  progressionSelector: 'progression-selector',
  piano: 'piano-keyboard',
  rootChordData: 'piano-root-chord-data',
  minorChordData: 'piano-minor-chord-data',
  rootProgressions: 'piano-root-circle-progressions',
  minorProgressions: 'piano-minor-circle-progressions',
  guitar: 'guitar-fretboard',
  guitarRootProgressions: 'guitar-root-circle-progressions',
  guitarRootChordData: 'guitar-root-chord-data',
  guitarMinorProgressions: 'guitar-minor-circle-progressions',
  guitarMinorChordData: 'guitar-minor-chord-data',
};

// Octave chords are played and drawn in (C3 = a fuller tone); the keyboard opens on the same octave
const CHORD_OCTAVE = 3;

const piano = await renderPianoKeyboard({ target: IDS.piano, dataUrl: 'DATA/piano_tuning.json', scrollTo: `C${CHORD_OCTAVE}`, mobileOctaves: 2, mobileQuery: '(max-width: 768px)' });
const audio = createPianoAudio({ baseUrl: 'DATA/piano/', ext: 'mp3', missing: ['A0', 'A#0', 'B0'] });
piano.element.addEventListener('piano:press',   (e) => audio.play(e.detail.note));
piano.element.addEventListener('piano:release', (e) => audio.release(e.detail.note));
const chords = renderChordControls({ piano, audio, target: IDS.chordControls, dataTarget: IDS.rootChordData, relativeTarget: IDS.minorChordData, octave: CHORD_OCTAVE });
const progressions = await renderCircleProgressions({ piano, audio, target: IDS.rootProgressions, relativeTarget: IDS.minorProgressions, selectorTarget: IDS.progressionSelector, octave: CHORD_OCTAVE });
const guitar = await renderGuitarFretboard({ target: IDS.guitar, dataUrl: 'DATA/guitar_tuning.json', piano, progressions });
const guitarChords = await renderGuitarProgressions({ guitar, piano, progressions, target: IDS.guitarRootProgressions, dataTarget: IDS.guitarRootChordData, relativeTarget: IDS.guitarMinorProgressions, relativeDataTarget: IDS.guitarMinorChordData });

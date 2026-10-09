import './colors.js';
import { renderPianoKeyboard } from './piano.js';
import { createPianoAudio } from './piano-audio.js';
import { renderChordControls } from './piano-chords.js';
import { renderCircleProgressions } from './circle-o-5ths.js';
import { renderGuitarFretboard } from './guitar.js';

// Element ids — the ONLY place the JavaScript names them. SYNC: must match index.html.
const IDS = {
  chordControls: 'root-chords',
  progressionSelector: 'progression-selector',
  piano: 'piano-keyboard',
  pianoRootChordData: 'piano-root-chord-data',
  pianoMinorChordData: 'piano-minor-chord-data',
  pianoRootProgressions: 'piano-root-circle-progressions',
  pianoMinorProgressions: 'piano-minor-circle-progressions',
  guitar: 'guitar-fretboard',
};

const piano = await renderPianoKeyboard({ 
  target: IDS.piano, 
  dataUrl: 'DATA/piano_tuning.json', 
  scrollTo: 'C3', 
  mobileOctaves: 2, 
  mobileQuery: '(max-width: 768px)' 
});

const audio = createPianoAudio({ 
  baseUrl: 'DATA/piano/', 
  ext: 'mp3', 
  missing: ['A0', 'A#0', 'B0'] 
});

piano.element.addEventListener('piano:press', (e) => audio.play(e.detail.note));
piano.element.addEventListener('piano:release', (e) => audio.release(e.detail.note));

const chords = renderChordControls({ 
  piano, audio, 
  target: IDS.chordControls, 
  dataTarget: IDS.pianoRootChordData, 
  relativeTarget: 
  IDS.pianoMinorChordData 
});

const progressions = await renderCircleProgressions({ 
  piano, audio, 
  target: IDS.pianoRootProgressions, 
  relativeTarget: IDS.pianoMinorProgressions, 
  selectorTarget: IDS.progressionSelector 
});

const guitar = await renderGuitarFretboard({ 
  target: IDS.guitar, 
  dataUrl: 'DATA/guitar_tuning.json', 
  piano, 
  progressions 
});

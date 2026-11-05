import './colors.js';
import { renderPianoKeyboard } from './piano.js';
import { createPianoAudio } from './piano-audio.js';
import { createGuitarAudio } from './guitar-audio.js';
import { renderChordControls } from './piano-chords.js';
import { renderCircleProgressions, renderCircleOfFifths } from './circle-o-5ths.js';
import { renderGuitarFretboard } from './guitar.js';
import { renderGuitarProgressions } from './guitar-chords.js';
import { createShareState, registerAppState, renderShareButton } from './share.js';

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
  pianoRootCircle: 'piano-root-circle',       // circle of fifths above the root / relative chord panels
  pianoMinorCircle: 'piano-minor-circle',
  guitarRootCircle: 'guitar-root-circle',
  guitarMinorCircle: 'guitar-minor-circle',
  share: 'share-modal',                 // share button + share modal (bottom of the page)
  static: 'static',                     // plain-HTML C major page for search engines + the no-script message
};

// With JavaScript running, the interactive page replaces the plain-HTML version: empty #static first, before
// anything renders, so the two never show together. DOM-clobbering guard: only a real <div> is emptied.
const staticEl = document.getElementById(IDS.static);
if (staticEl instanceof HTMLDivElement) staticEl.replaceChildren();

// Octave chords are played and drawn in (C3 = a fuller tone); the keyboard opens on the same octave
const CHORD_OCTAVE = 3;

const piano = await renderPianoKeyboard({ target: IDS.piano, dataUrl: 'DATA/piano_tuning.json', scrollTo: `C${CHORD_OCTAVE}`, mobileOctaves: 2, mobileQuery: '(max-width: 768px)' });
const audio = createPianoAudio({ baseUrl: 'DATA/piano/', ext: 'mp3', missing: ['A0', 'A#0', 'B0'] });
piano.element.addEventListener('piano:press',   (e) => audio.play(e.detail.note));
piano.element.addEventListener('piano:release', (e) => audio.release(e.detail.note));
const chords = renderChordControls({ piano, audio, target: IDS.chordControls, dataTarget: IDS.rootChordData, relativeTarget: IDS.minorChordData, octave: CHORD_OCTAVE });
const progressions = await renderCircleProgressions({ piano, audio, target: IDS.rootProgressions, relativeTarget: IDS.minorProgressions, selectorTarget: IDS.progressionSelector, octave: CHORD_OCTAVE });
const guitar = await renderGuitarFretboard({ target: IDS.guitar, dataUrl: 'DATA/guitar_tuning.json', piano, progressions });
const guitarAudio = createGuitarAudio({ baseUrl: 'DATA/guitar/', ext: 'mp3' });
guitar.element.addEventListener('guitar:press', (e) => guitarAudio.play(e.detail.note));
const guitarChords = await renderGuitarProgressions({ guitar, piano, audio: guitarAudio, progressions, target: IDS.guitarRootProgressions, dataTarget: IDS.guitarRootChordData, relativeTarget: IDS.guitarMinorProgressions, relativeDataTarget: IDS.guitarMinorChordData });

// Circles of fifths (read-only): root circles draw the root progression larger and outline the relative one;
// relative circles the reverse. Piano and guitar circles are identical (same progression state).
const circles = [
  [IDS.pianoRootCircle, 'root'], [IDS.pianoMinorCircle, 'relative'],
  [IDS.guitarRootCircle, 'root'], [IDS.guitarMinorCircle, 'relative'],
].map(([target, panel]) => (progressions ? renderCircleOfFifths({ target, progressions, panel }) : null));

// Permalinks: a shared link (?v=1&chord=…&prog=…) restores the chord, progression and voicings; from then on
// the address bar follows every change, so the URL is always the link to share (www/js/share.js)
const share = createShareState();
registerAppState(share, { chords, progressions, guitar, guitarChords });
share.restore();
share.start();
renderShareButton({
  target: IDS.share,
  getUrl: share.url,
  getSummary: () => [chords.active(), progressions?.state()?.root?.progression?.name].filter(Boolean).join(' · '),
});

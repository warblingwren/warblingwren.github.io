# Warbling Wren

**The Musician's Companion: piano and guitar chords side by side, with the theory behind them.**

**Live site: [warblingwren.com](https://warblingwren.com)**

Warbling Wren is a free music app and reference for every musician at every stage, from learning your first chord to composing your own songs. It shows each chord on a full piano keyboard and a guitar fretboard at the same time, plays it so you can hear it, and shows how it fits into the progressions and keys that songs are built from.

This repository holds the source of the site, which is published with GitHub Pages.

## What's on the site

### The interactive app

The app is on the [home page](https://warblingwren.com).

- **An 88-key piano:** every chord shown from A0 to C8 and played with real piano samples.
- **A 24-fret guitar fretboard:** the same chord on the neck, strummed. It works in 16 tunings, including Standard, Drop D, DADGAD, the open tunings and New Standard. Every shape is recalculated for the tuning, and only playable shapes are shown.
- **Colors that mean something:** each octave has its own color family. Within a chord, the root is darkest, then the 3rd and the 5th, with the 7th lightest. The piano and the guitar use the same colors.
- **14 chord types on all 12 roots:**
  - major, minor, sus2, sus4, diminished and augmented;
  - dominant 7th, major 7th, minor 7th, diminished 7th, half-diminished and augmented 7th;
  - major 6th and minor 6th.
- **24 chord progressions:** across Blues, Jazz, Country, Bluegrass, Rock & Roll, Folk and Pop, played in the key of the chord you pick.
- **Scales on the fretboard:** the notes of the key mapped across the whole neck, shaded by scale degree.
- **The relative key and the circle of fifths:** the same progression in the relative major or minor, and where both keys sit on the circle.
- **Voicings:** play a chord in any octave on the piano, and step through guitar shapes from the nut up the neck.
- **Sharing:** the address bar always holds a link to exactly what you're looking at. The share button copies it or shows a QR code.

### The chord reference

There's one page for every chord type and progression, with the progression played from all 12 roots. For each root you get:
- the chords and their Roman numerals;
- the chord tones;
- a piano keyboard and a guitar chord diagram;
- the relative key;
- the circle of fifths.

Each section links to the same chord and progression in the app. The reference pages load fast, print cleanly and work without JavaScript. Open them from the chord reference menu on the home page.

### Music theory pages

Plain-language guides that explain what the app and the reference show. Most are written in three parts, from beginner to professional.

- **Chord Functions:** why some chords feel like home, some feel like away and some pull you back.
- **Root Motion:** how the distance between chords shapes the sound of a progression.
- **The Circle of Fifths:** how to read it and use it at the instrument.
- **Cadences:** how phrases end.
- **How Chord Progressions Are Related:** rotations, substitutions, parallel keys and more.
- **Glossary:** every term used on the site, with chord cards and links into the app.

## How to use it

### The app

1. **Pick a chord:** choose a chord type, then tap a root. The chord lights up on the piano and the guitar, and you hear it.
2. **Hear the parts:** tap a note to hear it on its own and see everywhere it appears.
3. **Change the voicing:** pick a different octave on the piano, or slide through the guitar shapes.
4. **Choose a progression:** pick a genre and a progression. Each chord gets its own card to play.
5. **Read the scale:** follow the shaded dots up and down the fretboard to practise the key's scale in every position.
6. **Try the relative key:** hear the same progression in the relative major or minor.
7. **Retune:** switch guitar tunings and every shape is recalculated.
8. **Share:** copy the link or use the share button. Whoever opens it sees and hears what you set up.

### The reference

1. **Open the menu:** the chord reference menu on the home page is grouped by genre.
2. **Pick a progression and a chord type.**
3. **Jump to your key:** use the contents at the top of the page.
4. **Go deeper:** tap **Customize Voicing** to open that section in the app.

## How the site is built

- **One set of data files** drives the whole site: keys and chords, progressions, guitar tunings, piano notes and the glossary. The app, the reference pages and the theory pages all read the same files, so a chord looks and sounds the same everywhere.
- **The interactive app** is plain JavaScript in the browser, with no framework and no account.
- **The reference pages** are generated from the data files by a Python script (`build_reference.py`, which has its own README) and published as static pages.
- **The site** is built by Jekyll on GitHub Pages. The reference menu and the glossary are written by Liquid directly from the data files, so editing a data file updates them on the next build.

## About

Warbling Wren is made by Matt, a computer scientist, guitarist and piano student, who wanted one place that shows piano and guitar chords together and makes theory fun to learn. You can read the full story on the [About page](https://warblingwren.com/about/).

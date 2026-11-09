# Checkin

Checkin is a local, single-page evening journal with a calendar. Select today or an earlier day, then use **All goals done** to record 100% in one click. Open **Add details or set a score** to record any score from 0 to 100, add a note, or write and tick off individual goals. The score is your overall assessment and is independent of the checklist. The one-click action marks any listed goals done.

## Run locally

With Node.js installed, run:

```sh
npm start
```

Open [Checkin](http://127.0.0.1:4173) in your desktop browser. There are no dependencies to install. Keep using the same address and browser profile to access your history. The entries and sound preference are stored in that browser's local storage. Clearing its site data removes those entries.

The opening scene animates when the page loads. Saving a new or changed score triggers a random celebration with sound on by default. Motion follows your system's reduced-motion setting. To clear a day, remove its details, uncheck **Include a score**, and save.

## Source layout

- `dist/index.html`, `styles.css`, and the SVG assets define the UI and artwork.
- `dist/app.js` manages the editor, storage, and navigation.
- `dist/calendar.js` handles local calendar dates and day tiles.
- `dist/celebration.js` renders effects and synthesizes audio.
- `server.mjs` serves the static files on loopback.

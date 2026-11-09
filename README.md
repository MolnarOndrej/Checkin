# Checkin

Checkin is a local, single-page evening journal with a calendar. Select today or an earlier day, add or reuse a goal, and choose **Worked on it** or **Done**. Minutes are optional. Use **Log what I did** to save. The moonlit trail lights up for dates with recorded work, and the weekly summary shows how many days you worked on each goal.

Use **Plan the next session** to write when you’ll start and what could make the work enjoyable. Checkin shows the latest plan on today’s check-in until you log more work or save a newer plan. **Notes or daily score** holds optional reflection, your overall score, and the **All goals done** shortcut.

## Run locally

With Node.js installed, run:

```sh
npm start
```

Open [Checkin](http://127.0.0.1:4173) in your desktop browser. There are no dependencies to install. Keep using the same address and browser profile to access your history. The entries and sound preference are stored in that browser's local storage. Clearing its site data removes those entries.

The opening scene animates when the page loads. Logging work on a goal for the first time on a given date triggers a celebration with sound on by default. Motion follows your system’s reduced-motion setting. To clear a day, remove its goals, note, and plan, uncheck **Include a score**, and save.

## Source layout

- `dist/index.html`, `styles.css`, and the SVG assets define the UI and artwork.
- `dist/app.js` manages the editor, storage, and navigation.
- `dist/calendar.js` handles local calendar dates and day tiles.
- `dist/celebration.js` renders effects and synthesizes audio.
- `server.mjs` serves the static files on loopback.

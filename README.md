# Checkin

Checkin is a local, single-page evening journal with a calendar. Select today or an earlier day and use **Add or find an activity** to enter a new activity or pick a pinned or recent one. Choose **Worked on it** or **Done** and add a measurement if you like. Use **Save check-in** to save. The moonlit trail lights up for dates with recorded work, and the weekly summary under the calendar shows how many days you worked on each activity.

Pin recurring activities in **Activities** to keep them in the check-in suggestions. Use the pencil icon to open an activity’s next step, optional fallback, and pickup note. Plans stay with their activity until you edit, finish, or dismiss them. Pin an activity again to see its plan after unpinning it. The **Previous plan** link opens a dated plan from an earlier version for editing while you stay on the selected day.

Use the sliders icon next to an activity to open **Activity settings**. Start with minutes or choose a custom unit such as laps, sets, or pages. You can log minutes alongside a custom unit. For running, set **Meters per unit** to 400 for 400-meter laps, and adjust it in an individual check-in when you run a different track. Checkin calculates distance and, when you also log minutes, pace. Existing check-ins keep the unit and distance per unit you saved with them.

In the same settings, add a **Goal** for days worked, amount logged, or minutes logged. Choose one week, repeating Monday–Sunday weeks, or an inclusive date range. Each worked day counts once for a days goal, even with blank measurements. Distance goals combine compatible units and counts with a saved distance per unit. A lap goal counts recorded laps. Use the calendar to see goal progress for a different period. End an ongoing goal to create a replacement while keeping its past progress.

Open **Notes & score** for an optional reflection and overall score. **Mark all done + set score to 100%** fills in the changes for you to review and save.

## Run locally

With Node.js installed, run:

```sh
npm start
```

Open [Checkin](http://127.0.0.1:4173) in your desktop browser. There are no dependencies to install. Keep using the same address and browser profile to access your history. Entries, activity settings, goals, and the sound preference are stored in that browser’s local storage. Clearing its site data removes them.

Open **Backup & restore** below the dashboard to download a JSON file with saved check-ins, activity settings, goals, plans, and pickup notes. The file contains your notes in plain text. Choose that file in another Checkin browser profile to preview what can be restored. **Restore missing records** adds missing days and activities and keeps any already saved for the same date or activity name.

The opening scene animates when the page loads. Logging work on an activity for the first time on a given date triggers a celebration with sound on by default. Motion follows your system’s reduced-motion setting. To clear a day, remove its activities, empty its notes and score, and save. If the day has a saved plan, empty it in the dated **Previous plan** dialog and save the plan as well.

## Source layout

- `dist/index.html`, `styles.css`, and the SVG assets define the UI and artwork.
- `dist/app.js` manages the editor, storage, and navigation.
- `dist/pinned-goals.js` manages activity records, pinning, and plans.
- `dist/activity-row.js`, `dist/tracking.js`, and `dist/measurements.js` handle daily measurements, activity settings, and goal progress.
- `dist/backup.js` handles backup downloads and restore.
- `dist/calendar.js` handles local calendar dates and day tiles.
- `dist/celebration.js` renders effects and synthesizes audio.
- `server.mjs` serves the static files on loopback.

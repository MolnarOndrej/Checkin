# Checkin

Checkin is a local, single-page evening journal with a calendar. Select today or an earlier day and use **Add or find a goal** to enter a new goal or pick a pinned or recent one. Choose **Worked on it** or **Done** and add minutes if you like. Use **Save check-in** to save. The moonlit trail lights up for dates with recorded work, and the weekly summary under the calendar shows how many days you worked on each goal.

Pin recurring goals in the **Goals** panel to keep them in the check-in’s goal suggestions. Use the pencil icon next to a goal to open its next step, optional fallback, and pickup note. Plans stay with their own goals until you edit, finish, or dismiss them. Unpinning hides the goal and its details. Pin it again to bring them back. The **Previous plan** link opens a dated plan from an earlier version for editing while you stay on the selected day.

Open **Notes & score** for an optional reflection and overall score. **Mark all done + set score to 100%** fills in the changes for you to review and save.

## Run locally

With Node.js installed, run:

```sh
npm start
```

Open [Checkin](http://127.0.0.1:4173) in your desktop browser. There are no dependencies to install. Keep using the same address and browser profile to access your history. Entries, pinned goals, and the sound preference are stored in that browser’s local storage. Clearing its site data removes them.

Open **Backup & restore** below the dashboard to download a JSON file with saved check-ins and goal records, including plans and pickup notes for unpinned goals. The file contains your notes in plain text. Choose that file in another Checkin browser profile to preview what can be restored. **Restore missing records** adds missing days and goals and keeps any already saved for the same date or goal name.

The opening scene animates when the page loads. Logging work on a goal for the first time on a given date triggers a celebration with sound on by default. Motion follows your system’s reduced-motion setting. To clear a day, remove its goals, empty its notes and score, and save. If the day has a saved plan, empty it in the dated **Previous plan** dialog and save the plan as well.

## Source layout

- `dist/index.html`, `styles.css`, and the SVG assets define the UI and artwork.
- `dist/app.js` manages the editor, storage, and navigation.
- `dist/pinned-goals.js` manages pinned goals and their plans.
- `dist/backup.js` handles backup downloads and restore.
- `dist/calendar.js` handles local calendar dates and day tiles.
- `dist/celebration.js` renders effects and synthesizes audio.
- `server.mjs` serves the static files on loopback.

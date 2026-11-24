# Checkin

Checkin is a local activity log centered on a daily timeline. Swipe or drag left and right to browse, or tab to the timeline and use the arrow keys. Select a dot to open the day's activity. The timeline opens on today.

Use the top-right icon to create an activity measured in minutes or a custom unit. On today or a past day, select **+** to log a value. Select a saved row to edit or remove it. You can save one value per activity per day.

A day's dot rises with the number and values of its activities. Days that stand out against the previous seven days glow more strongly. Removing an activity from the manager deletes its logs and keeps their anonymous contribution to the graph. Motion follows your system's reduced-motion setting.

## Run locally

With Node.js 24 installed, run `npm start` and open [Checkin](http://127.0.0.1:4173). Keep using the same address and browser profile. Checkin stores its activity list and logs in the browser.

The server serves `dist/` directly. Run `npm test` with Chrome or Edge installed. The browser test uses a separate server and temporary browser profile.
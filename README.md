# Checkin

Checkin is a local activity log centered on a daily timeline. Swipe or drag left and right to browse, or tab to the timeline and use the arrow keys. Select a dot to open the day's activity. The timeline opens on today.

Use the top-right icon to manage activities measured in minutes or a custom unit. If the list is empty, it opens the **Add activity** form. Select today or a past day to log a value. If the day has no logs, the logging form opens automatically once you have an activity to choose from. Select **+** to log another activity, or select a saved row to edit or remove it. You can save one value per activity per day.

A day's dot rises with the number and values of its activities. Days that stand out against the previous seven days glow more strongly. Removing an activity from the manager deletes its logs and keeps their anonymous contribution to the graph. Motion follows your system's reduced-motion setting.

## Timeline effects

| Effect | Motion |
| --- | --- |
| Daybreak Sweep | A wide glow travels left to right. |
| Backlight Sweep | A compact glow travels right to left. |
| Crossing Lights | Two glows approach each other and pass through. |
| Over Under | A ribbon weaves above and below the curve. |
| Sky Ribbon | A ribbon enters from above or below, touches a random dot, and heads toward the farther edge. |
| Split Pulse | A glow splits at a dot into a ripple that fades at the end nodes. Both lights fade back in there and continue outward. |
| Skipping Sparks | A dotted arc hops between dates. |
| Twin Ribbons | Two strands braid around the curve. |
| Beacon Landing | A glow streaks in, blooms above or below the busiest visible dot, and lands before following the curve. |

**Drawer Loop** is the detour around an open day drawer or log editor. **Color Trail** is the fading tint left by a passing glow. **Save Ripple** is the short pulse from a saved log.

## Run locally

With Node.js 26.13.1 LTS installed, run `npm start` and open [Checkin](http://127.0.0.1:4173). Keep using the same address and browser profile. Checkin stores its activity list and logs in the browser.

The server serves `dist/` directly. Run `npm test` with Node.js 26 and Chrome or Edge installed. The browser test uses a separate server and temporary browser profile.

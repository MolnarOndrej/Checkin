# Local Checkin server

- Reserve `127.0.0.1:4173` for the user's Checkin session. Start it with `npm start` from a regular Windows terminal and leave the terminal open while using the app. Use the same address and browser profile to access saved entries.
- For browser tests and smoke checks, set `PORT` to a different free port for the test process. Stop that server when the check finishes, including on failure. Leave the user's server running.

## Source and saved data

- Edit `dist/` directly. It contains the checked-in source that `server.mjs` serves. No build step or dependency installation is required. Add any new browser assets to the server's allowlist.
- Use synthetic entries on the test port and leave the user's site data alone. If storage keys or entry formats change, verify that existing entries still load.

## Automated tests

- Run `npm test` with Node.js 24 and an installed Chrome or Edge. Run `npm run test:unit` for calendar checks without a browser, or `npm run test:browser` for the browser smoke test alone.
- The smoke test starts Checkin with `PORT=0`, uses a temporary headless browser profile, and cleans up both processes and the profile. Set `CHECKIN_BROWSER` to the executable path if Chrome or Edge is installed outside its usual location.
- If the sandbox blocks browser startup, run the unit tests inside the sandbox and use the `npm run test:browser` approval for the browser test.
- Extend the suite in `test/` for new or changed behavior. Assert visible results and verify saved entries after reloading when persistence matters.

## Git workflow

- After each implementation, run the relevant checks, commit the changes for that task, and push the commit to the branch's remote.

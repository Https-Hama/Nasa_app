# HUMAN.exe Human Observatory 2.0

A polished local browser demo with one 3D space-combat mission, hand and leg controls, post-flight memory and attention tasks, and detailed camera-observation reports with day-to-day comparison.

## Play

Double-click **START_HUMAN_EXE.cmd**. Node.js 22 or newer is required. The included production build runs locally without internet; keep the launcher window open. The game is served at localhost, usually port 4173.

## One continuous journey

1. Save your name before your first mission. On a later visit, confirm the remembered player, choose a saved name or add a new player.
2. Optionally enable camera controls and, separately, face and body observations. You can play with just your shoulders, arms and hands visible.
3. Complete the optional relaxed 30-second close-up face check. Follow its live framing and calibration guidance, then recalibrate your controls if you move.
4. Fly a two-minute orbital defense mission against enemy drones and asteroids. Legs are optional.
5. Repeat a newly randomized pattern that grows from three to five directions, then complete eight shuffled go/no-go attention trials.
6. Review the report and compare with earlier sessions. Progress, partial results and completed reports save automatically to the selected player. After the flight and mind check finish, Gemini automatically adds a written review of the completed mission summary.

## Mission health

A saved player name is required before play. HUMAN.exe remembers the last selected player in this browser and asks you to confirm that name on a new visit. Choose another saved name or enter a new name when someone else is playing. It remembers the browser's selected profile; it does not identify people from their faces. Select the player name in the top right to rename the current profile, switch players or add another player.

Each profile has its own check-ins, diagnosis notes, face-check archive, partial and completed mission reports, and preferences. Naming the original **Local player** keeps records saved before profiles were added. Profiles organize data in one browser, and anyone using that browser can switch between them.

Open **Mission health** to log resting pulse, temperature in °C, sleep, mood and blood pressure. Pick a date to view or edit that day's check-in or record a clinician-confirmed diagnosis. The dashboard combines these entries with comparable movement and cognitive results from measured missions.

Trend flags use changes from a personal baseline to suggest rechecks and questions for a clinician. NASA's [sleep and performance research](https://humanresearchroadmap.nasa.gov/risks/risk.aspx?i=100) informs the choice of signals. The [American Heart Association guidance](https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings/monitoring-your-blood-pressure-at-home) is the separate source for the very-high blood pressure warning. A clinician confirms diagnoses.

Gemini is optional. Both `npm run dev` and the local launcher read server-only Gemini configuration from the project’s ignored `.env.local` file. Set `GEMINI_API_KEY` there and optionally `GEMINI_MODEL` (default `gemini-3.5-flash-lite`), then restart the server. A process environment key takes priority over file settings; `GOOGLE_API_KEY` is also supported. Keep the key out of frontend code and variables prefixed with `VITE_`. Open the localhost URL printed by the app server so `/api/health-suggestions` is available; a static-only server cannot provide Gemini suggestions. You can also set `GEMINI_API_KEY` in the server process environment before running `node scripts/launch.mjs`. To enter a replacement key without showing it on screen or putting it in command history, use PowerShell:

```powershell
$env:GEMINI_API_KEY = Read-Host -Prompt 'Gemini API key' -MaskInput
try { node scripts/launch.mjs } finally { Remove-Item Env:GEMINI_API_KEY }
```

Choose **Use Gemini suggestions** in the review section. The server sends the same generic question bank for every request. The browser uses the returned ranking to choose questions locally. Check-in readings and reports are never part of that generic-question request. Automatic mission reviews are a separate endpoint: they send only anonymous derived mission measurements and task results, including a quality-gated previous comparison where available. Player names, video, raw landmarks, diagnosis notes and manual health check-ins are excluded. The feature falls back to local questions without a key or connection.

## Controls

- For portrait or seated play, keep your shoulders, arms and both hands visible during the two-second neutral calibration. Your hips and legs can remain outside the frame. Recalibrate after changing distance or position.
- Move the left hand to steer/aim; extend the right arm at shoulder height to fire. Both arms overhead activate the shield and take priority over firing.
- Complete a knee lift-and-lower cycle to boost; squat and stand to trigger evasive duck. Legs require hips, knees and ankles in view.
- Keyboard: WASD/arrows aim, J fires, Space shields, Shift boosts, C ducks, P pauses.
- Memory: arrows or tiles; with body control, aim toward a direction and extend the arm to confirm. Attention: Space, Respond button, or arm extension for cyan GO; withhold on orange WAIT.

Brief tracking gaps clear stale controls without pausing play. Sustained loss temporarily pauses the active task, which resumes automatically when tracking returns. Losing window focus alone does not pause. A hidden tab, manual pause or navigation to another panel requires you to resume; camera failure restores keyboard controls.

## Reports

Face observations include approximate blink activity, eye-closure geometry, long closures, mouth openings and head roll. The separate face check gives live guidance when the face is too small, absent or poorly lit and shows open-eye calibration progress. Completed and early face checks save independently of launching a mission. Body observations include shoulder-normalized wrist travel, completed leg actions, shield events, upper-body displacement and coverage. Portrait play can record hand observations while unavailable leg measurements remain empty. Task results describe pattern recall and attention responses.

The memory sequence is randomized for each new check and grows through rounds of three, four and five directions. The focus task shuffles eight cues while keeping the same GO/WAIT mix each time. Mission progress saves every five seconds, after task inputs and when the page is hidden or left. An interrupted mission remains available as a partial report rather than restarting automatically after a reload. Finishing a mission updates its existing progress record.

Measurements are withheld when calibration, frame rate or coverage is inadequate. A close-up face check is important because full-body camera framing may make the face too small. Comparable reports need matching task protocols, input mode, session duration and usable camera evidence. Partial tasks and mixed input cannot create misleading deltas. Baghdad calendar dates label same-day and previous-day comparisons.

The **Demo preview** contains two clearly marked fictional records. It never enters measured history. This is a camera-observation demo, not a medical diagnostic tool; it does not infer disease, emotion, identity, vital signs, muscle health or bone density from appearance. A clinician needs appropriate clinical evidence to diagnose a condition.

## Privacy

The app automatically stores daily check-ins, diagnosis notes, face-check summaries, partial and completed mission summaries, and preferences under the selected player in browser storage on this device. Use the same browser profile and exact localhost address, including the port, to reopen them. A different address or browser has separate storage. Browser storage is not an encrypted medical record system.

Mission health exports the selected player's combined check-in, mission-report and face-check history. Export a backup before clearing site data. Mission health can delete individual check-ins; Health journal can delete saved mission reports. If saving fails, the app displays a warning: keep the page open, retry saving or export the available records before leaving. Video, images and raw landmarks stay out of stored records. Automatic Gemini mission reviews send anonymous derived mission summaries to Google and save the generated review with the local report. Turn Automatic Gemini mission reviews off in Preferences to keep future summaries local; the measured report still saves. Camera controls and observation consent remain separate choices.

## NASA research basis

The app loads `public/data/nasa-reference.json` and includes a visible **NASA basis** view. It uses the three official NASA resources listed for the Space Apps challenge *Create Health Monitoring Software for Astronauts on Space Missions*:

- [5 Hazards of Human Spaceflight](https://www.nasa.gov/hrp/hazards/) frames why repeatable self-monitoring matters on long missions.
- [Risks of Human Spaceflight](https://www.nasa.gov/hrp/risks/) informs the separation of body, cognitive and evidence-quality observations.
- [Ongoing HRP Research in Space](https://www.nasa.gov/hrp/ongoing-hrp-research/) informs the longitudinal, repeat-measurement approach and its limitations.

NASA resources provide scientific context, not diagnostic thresholds. Session measurements are generated locally by the user, and the prototype is not endorsed or medically validated by NASA.

## Development

Run npm install, npm run assets, and npm run dev. npm test runs the meaningful unit suite; npm run build creates dist. The current entry point is src/app-v2.js. Runtime libraries, OpenCV, pose/face models, WASM, React Bits and the custom mission artwork are bundled locally. Third-party notices and artwork prompts are included.

See PLAY_GUIDE.md and VERIFICATION.md for operation and testing limits. The existing ZIP files are retained as earlier snapshots. Run this workspace source or its rebuilt dist to use the current portrait, profile and saving fixes.

## Vercel deployment

The repository includes the Node function `api/health-suggestions.js` and `vercel.json`; deploy the repository root with `npm run build` and output directory `dist`. Vite's local middleware is not part of the static build, so uploading `dist` by itself does not deploy the Gemini API.

In the Vercel project, set `GEMINI_API_KEY` for the Production environment (and Preview if needed), then redeploy. The server function reads the runtime environment; the key never enters the browser bundle. `GEMINI_MODEL` is optional. The production site `https://nasa-app-ashy.vercel.app` is explicitly allowed; Vercel's deployment, branch and production URLs are also allowed when its system environment variables are available. For additional custom domains, set `APP_ORIGIN` to their HTTPS origins separated by commas. Requests still require the same host/origin and accept no player data.

## Automatic mission review and charts

When a measured mission finishes, its report appears immediately and Gemini reviews the collected flight, memory, focus and usable camera summaries in the background. Missing and partial evidence stays explicit. The written review contains a session summary, strengths, observations, practical next steps and limitations; it is not a medical assessment. The generated review is saved/exported with the player report and restored on reload. An unavailable API leaves the local report intact with a retry button. Older completed reports can request a review manually. Fictional previews never upload data.

Reports include animated task accuracy bars, outcome stacks, camera-coverage rings and quality-gated hand-travel bars. Exact values and explanations remain accessible, missing measurements show N/A, and reduced-motion preferences disable entry animation. Existing comparable-session trend lines also animate.

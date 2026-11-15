# HUMAN.exe Human Observatory v2 verification

Verified on 14 November 2026 in this Windows workspace.

## Meaningful automated checks

The current Node suite has 122 passing tests covering pose confidence/calibration and body controls, hand aiming/fire/shield priority, complete knee/squat cycles, real combat projectile damage, enemy kills, shield blocks, boost/duck physics, bounded waves and resource disposal. Observation tests cover aspect-correct facial geometry, an open-eye baseline, approximate completed blink/closure/mouth events, missing or distant faces, poor lighting, inadequate frame rates, actual coverage denominators, paused/gapped evidence, body motion normalization and consent cancellation. Report tests cover strict derived-data whitelisting, same-day and previous-day Baghdad labels, quality gates, actual face-check duration, complete versus skipped task comparisons, mixed input, null evidence, and separation of demo records from measured history. Mental-task tests include playback input rejection, increasing memory rounds, false alarms/misses, stimulus deadlines and pause timing.

The production browser journey on localhost4173 verifies one core game, actual React Bits elements, explicit observation opt-in, a visibly fictional yesterday/today demo, report export without saving demo data, keyboard weapon fire, pause, all three memory rounds, all eight attention trials, a saved measured report with unavailable camera data instead of fabricated values, measured export/deletion, guide navigation, tablet/phone layout and mobile report layout without horizontal overflow. It completed with zero page/console errors. The combat renderer smoke separately recorded a real simulated drone kill and verified duck hitbox/render alignment.

## Camera runtime

OpenCV, MediaPipe WASM and both local landmark models are bundled in the production build. Frames pass through actual OpenCV preprocessing before inference. A real CPU face-model initialization test on a blank local-origin page loaded in approximately1.53seconds, inferred a no-person frame as zero faces and closed the model. The initial combined runtime stalled because the legacy OpenCV build left its self-returning runtime in the global Module variable, which MediaPipe treats as new-runtime configuration. The implementation now clears only that foreign configuration, serializes initialization, defaults face inference to CPU with fallback, and suspends background 3D while loading/checking. Real isolated OpenCV→face initialization then passed in approximately0.79seconds; OpenCV matrix and frame processing still worked after face teardown.

The completed production camera workflow report is retained under verification/v2-camera-check.json. It passed with the face model initializing in6.9seconds and397actual OpenCV-processed face detections during a full30-second check. The synthetic camera contained no person, so face metrics correctly remained null with zero valid seconds. Consent withdrawal closed the model, stopped inference/callbacks, ended the check and restored Launch while leaving the camera controls available. Disconnect ended the camera track. There were zero page/console errors, external requests or uploads. This verifies implementation behavior, not accuracy for a person.

## Limits and interpretation

No real person has performed the updated camera sequence on the intended webcam. Comfortable portrait/full-body ranges, lighting robustness, body diversity and real hardware frame rates still require a hardware playtest. Player identity is selected through saved browser profiles; biometric identity recognition is not implemented. Camera blink counts and movement metrics are approximate geometry. Quality thresholds are engineering sampling checks, not clinical cutoffs.

The interface reports observations and task results, never diagnoses, emotion, identity, vital signs or a clinical health score. The optional demo is clearly fictional throughout the view and export and never mixes with measured records. First-time users must save a name. Returning users confirm the remembered browser profile or choose/add a player. Reports and face checks belong to that selected profile; no face-based identity recognition is performed.

The Vite production build succeeds with the existing advisory for the approximately525kB uncompressed Three.js vendor chunk (approximately136kB compressed). The earlier ZIP releases and verification evidence are retained separately; run the workspace source or rebuilt dist for the current fixes.

## Portrait controls and persistence update

The regression suite now covers shoulder-and-hand portrait calibration with hips and legs outside the frame, arm fire/shield controls, immediate readiness callback ordering, and leg-action cancellation when legs disappear. Face calibration exposes current frame guidance and baseline progress while preserving the separate close-up check during flight. Face summaries are archived even when no mission follows; only whitelisted derived fields are stored.

Memory sessions draw random opening directions and grow to four/five directions; incorrect answers replay the same sequence. Attention shuffles six GO and two WAIT cues. New task protocols remain separate from the earlier fixed patterns, and partial tasks cannot enter completed-task comparisons. Shoulder-based body measurements use a new body protocol so older torso-anchor values are not compared as identical measurements.

The updated browser journey passed against development port 5173 with zero errors: required player naming, automatic partial flight saves, a persistent report ID through memory/focus, all three observed random patterns, eight focus cues, completed report restoration after reload, export/deletion and responsive layouts. The profile browser suite separately verified first-name enforcement, returning-player confirmation, duplicate-name rejection, missing-active-player recovery, legacy data preservation and isolation between players.

Mission checkpoints save every five seconds, on task responses/transitions and on page hiding/leaving. Reloaded partial records remain labeled as progress and do not resume a departed mission. Storage failures keep the in-memory result available with a visible Retry saving action. The original local-player keys remain intact; additional players use separate storage namespaces. Use the same browser profile and exact address, including port, to reopen saved data.

The rebuilt production app also passed the complete nine-check browser journey on port 4173 with zero page/console errors. A separate nine-check recovery integration used controlled camera callbacks with the real app/game: short gaps never paused, sustained loss resumed automatically, manual takeover and hidden tabs prevented automatic resume, explicit Resume re-armed recovery, and blur alone left play running. It also verified independent face-check persistence/reload/export and a simulated final-report storage failure followed by successful Retry saving under the same report ID. These controlled camera checks verify application behavior, not live-person tracking accuracy.

## Gemini suggestions configuration update — 15 November 2026

The Node suite now has 159 passing tests. Added coverage verifies local dotenv precedence, process-environment aliases, request restrictions, safe API error messages, upstream timeouts, invalid output, caching and concurrent requests, and frontend handling of static HTML responses instead of API JSON. Both development and production server entry points use the shared server-only configuration loader.

The live Mission health browser check passed on development port 5173: the actual button returned HTTP 200 and displayed three approved suggestions with zero page errors. The production build succeeds. The supplied key was verified directly against Gemini without sending player data or printing the key. A scan confirmed that the generated browser build does not contain it; requests for /.env.local returned 403 in development and 404 through the production launcher.

The same live Mission health button check also passed through the rebuilt production launcher on port 4173: HTTP 200, three approved suggestions, and zero page errors. The temporary production verification server was stopped; the corrected development server remains running on port 5173.

## Hosted Vercel endpoint update — 15 November 2026

The deployed production URL returned HTTP 404 for /api/health-suggestions because the earlier endpoint existed only inside the local Vite/launcher servers. Added a dedicated Node API function plus Vercel build/function configuration, with a 30-second runtime budget. Hosted requests require an exact trusted HTTPS origin matching the request host; localhost remains supported for local play. Runtime Gemini configuration reads hosting environment variables only, without local dotenv files. The frontend now gives deployment-specific guidance for a missing hosted API.

All 180 Node tests and the production Vite build pass, including same-origin hosted acceptance, origin/host/body rejection, public HTTP rejection, preview URLs, production origin fallback, missing runtime configuration, generic-only provider input and preserved local behavior. Live deployment verification follows the GitHub push.

## Automatic Gemini mission reviews and animated reports — 15 November 2026

The Node suite has 238 passing tests. The complete browser journey passed ten checks with zero page/console errors: finishing all flight/memory/focus tasks automatically issued one anonymous review request, saved the generated review with the same report ID, and restored it after reload. Demo records never requested a review. Existing export/deletion and mobile flows also passed.

A separate real-provider browser check returned HTTP 200 and displayed the generated review, four animated chart cards and explicit N/A for missing camera measurements. Hover/focus explanations, reduced-motion animation suppression, 390px layout, exact saved review restoration and immediate export containing the asynchronously generated review all passed with zero page errors. Screenshots are retained in artifacts/mission-review-desktop.png and artifacts/mission-review-mobile.png. The test used synthetic mission data in an isolated browser profile.

The new /api/mission-review endpoint uses the existing server-only key. It accepts at most 32KB of JSON, canonicalizes a fixed anonymous numeric summary, applies camera/task evidence gates, strips identities/notes/raw camera data and rejects incomplete session stages. A completed mission may retain explicitly partial/skipped task results. Gemini receives the canonical session summary and only comparable prior metrics. The generated review is bounded, sanitized, escaped, saved and included in exports. Cache/concurrent work is bounded and provider errors remain explicit.

Automatic reviews are enabled by default for newly finished missions and can be disabled in Preferences. The product now discloses that derived mission summaries are sent to Gemini; names, raw camera data, manual check-ins and diagnosis notes remain excluded. This supersedes older verification notes that described the generic Mission health question-bank endpoint as the only AI request. That original endpoint remains available and still sends only its generic bank.

## Post-mission health follow-ups and spacecraft exercises — 15 November 2026

The updated local clone passes all 251 Node tests and `npm run build`. Added tests were observed failing before implementation. They cover evidence-gated health cards, conditional dark-circle advice, complete versus partial task follow-ups, valid/applicable model selections, resistance/aerobic exercise coverage, old saved reviews and saved/export-ready selections. The production build retains the existing Three.js bundle-size advisory.

`node scripts/browser-check-mission-health.mjs` runs a real Chromium browser and the real mission-review HTTP handler, replacing only Google's external response with a controlled fixture. It passed pending/ready rendering, four applicable health cards, two equipment-specific exercise cards, opening follow-up details, exact review reload/export, a 390px mobile layout without horizontal overflow, provider-failure/disabled/legacy local guidance, and demo/partial exclusions. The browser recorded zero page errors. Screenshots and the machine-readable result are saved under `artifacts/mission-health-*.png` and `artifacts/mission-health-verification.json`. These use synthetic mission data in an isolated browser profile.

The existing `scripts/browser-check-v2.mjs` production journey also passed all ten checks: actual flight completion, three observed randomized memory rounds, eight focus trials, one automatic review request, saving under the same mission ID, reload, export/deletion and tablet/phone layouts, with zero page/console errors. Its response fixture now includes the new health/exercise selections.

No live Gemini credential is configured in this clone. These runs verify the request schema, handler, response validation and browser flow using controlled provider responses; they do not verify a live Gemini response or medical accuracy. Camera geometry still does not measure dark circles or establish a diagnosis, and spacecraft exercise workloads require a crew-approved plan.

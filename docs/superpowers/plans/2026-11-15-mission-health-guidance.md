# Mission Health Guidance Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan in the current checkout. Steps use checkbox syntax.

**Goal:** Add actionable health checks, recovery advice and spacecraft exercise suggestions to completed mission reports.

**Architecture:** A shared catalog produces evidence-grounded cards from the existing sanitized mission payload. Gemini returns whitelisted selections alongside its existing review. The report renders the same catalog locally while generation is unavailable and preserves new selections through storage/export.

**Tech Stack:** Existing JavaScript, Node test runner, Vite, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-15-mission-health-guidance-design.md`

## Global Constraints

- Keep names, notes, images and raw landmarks out of the Gemini request.
- Do not diagnose fatigue, disease, strength loss or dark circles from camera geometry or game scores.
- Retain older reviews and show local guidance during provider failure.
- Only completed measured missions receive health cards.
- Spacecraft workloads and restraints follow crew-approved exercise plans.

## Review Focus

- Missing/low-quality face or leg samples remain unavailable in the displayed evidence.
- Partial cognitive tasks cannot trigger claims of cognitive impairment.
- Unknown or inapplicable model selections cannot reach saved/displayed guidance.
- Old reviews and disabled/error states still show useful local guidance.
- New health selections survive saved report reload and JSON export; mobile layout has no overflow.

### Task 1: Catalog and response contract

Files: create `src/mission-health-guidance.js`, `tests/mission-health-guidance.test.js`; modify `src/mission-review-schema.js`, `scripts/gemini-mission-review.mjs`, `src/mission-review-client.js`, and corresponding tests.

- [x] Write failing tests for evidence gates, conditional dark-circle guidance, new provider contract, allowed selections, legacy reviews and persistence.
- [x] Run the focused tests and confirm missing behavior fails.
- [x] Implement `buildMissionHealthGuidance(mission, review)` and bounded `healthChecks`/`spaceExercises` selections. Require applicable checks and both resistance/aerobic options for new provider responses; retain legacy storage compatibility.
- [x] Run the focused tests and full `npm test`.

### Task 2: Report integration and verification

Files: modify `src/mission-review-ui.js`, `src/mission-review.css`, `tests/mission-review-ui.test.js`, `README.md`; add a deterministic browser check.

- [x] Write failing rendering tests for health checks/actions, exercise equipment, local fallback and demo/partial exclusions.
- [x] Add report cards with source links and responsive styles; document the behavior and measurement limits.
- [x] Run `npm test` and `npm run build`.
- [x] Verify successful generation, persistence/export, API failure and mobile layout in a real browser with a controlled provider response; inspect screenshots.

Execution note: the fresh clone is the isolated checkout; implementation proceeds under the user's explicit request without an extra approval gate. Changes remain local for review.

Verification: 251 unit tests pass; production build passes. The new browser check passed generation, pending/error/disabled/legacy guidance, exact reload/export, 390px layout and demo/partial exclusions with zero page errors. The existing complete flight/memory/focus browser journey passed all ten checks on the production build with zero page/console errors. Independent code review identified an outdated full-mission response fixture; it was updated and the full browser journey verified the correction. No live Gemini key is configured in this clone, so provider responses were controlled fixtures.

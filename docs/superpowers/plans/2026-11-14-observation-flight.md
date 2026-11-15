# Observation Flight Implementation Plan

> Agent workers use subagent-driven-development or executing-plans for their owned tasks.

**Goal:** One combat flight followed by mental challenges and source-separated face/body longitudinal observations.

**Architecture:** Existing Three.js engine and OpenCV capture gain isolated gesture, face-observation and report modules. Main interface coordinates consent, standardized face check, flight, cognitive tasks and detailed longitudinal reports.

**Tech Stack:** existing JavaScript, Three.js, MediaPipe, OpenCV, React Bits and Vite.

**Spec:** docs/superpowers/specs/2026-11-14-observation-flight-design.md

## Constraints and review focus
- No fabricated diagnoses, clinical scores or emotion/identity/physiology inference.
- Synthetic examples stay separate and visibly labeled.
- Low sampling, distant faces, dropouts and paused time produce missing evidence.
- No raw video or landmarks stored; explicit observation consent distinct from camera controls.
- Real enemies, projectiles and cooldowns; one core game followed by two cognitive tasks.
- Session comparisons require matching protocol/mode/duration and metric-specific quality.

## Tasks
- [x] Face observer and meaningful observation-metric tests.
- [x] Hand/leg gesture controls and combat simulation/renderer tests.
- [x] Longitudinal report model, sanitization, synthetic separation and comparison tests.
- [x] Single-game interface, body-camera integration, mental tasks and polished reports.
- [x] Production/browser/camera verification, documentation and versioned final package.

# Post-mission health guidance

Extend the existing automatic Gemini mission review with health follow-ups, recovery actions and spacecraft exercise options after every completed measured mission. Keep the current mission summary and local saving/export flow.

Use the existing anonymous, quality-gated measurements. Every health card separates the recorded evidence, possible explanations, checks to make, immediate actions and when to contact a clinician or crew medical officer. Eye closures and task errors prompt a self-check; they do not diagnose fatigue or illness. Under-eye pigmentation is not measured, so dark-circle guidance must be conditional and explicitly say so.

Approaches considered: unrestricted generated medical prose is difficult to validate; a prompt-only change would still be rejected by the current response filter. The implementation choice is a source-backed guidance catalog, with Gemini selecting and ordering applicable follow-ups and actual microgravity exercises through a structured response. The app renders vetted instructions with the actual recorded evidence. No new personal data or images are uploaded.

Include sleep/alertness and eye-comfort guidance, plus focus or movement follow-ups when supported. Include resistance and aerobic exercise options using ARED, CEVIS and a harnessed T2 treadmill, with approved restraints and crew-prescribed workloads. Do not invent sets, resistance, diagnoses, medication or fitness clearance from gameplay.

Guidance remains available locally if Gemini is loading, disabled or unavailable. Legacy saved reviews remain readable. New reviews must contain the new selections; malformed or inapplicable selections fail safely. Fictional previews and unfinished missions must not receive personalized health guidance.

Sources: NASA Astronaut Exercise and Exercise Overview; NIH Healthy Sleep; National Eye Institute Healthy Vision Tips; Mayo Clinic Dark Circles Under Eyes. Show source links with the guidance.

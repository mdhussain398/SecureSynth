# SecureSynth documentation

Everything written about the project lives here, grouped by what you're trying to do. If you only read one thing, read the [project report](report/PROJECT_REPORT.md).

## Understand the system

| Document | What it covers |
|---|---|
| [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) | Components, request flows, the data model and session modes |
| [architecture/SECURESYNTH_3.md](architecture/SECURESYNTH_3.md) | Version 3.0: Ghost Banking control, evidence vault, correlation, SOC metrics, summaries, reporting |
| [architecture/THREAT_MODEL.md](architecture/THREAT_MODEL.md) | Assets, attackers, trust boundaries, controls and what's out of scope |
| [architecture/API.md](architecture/API.md) | Endpoint reference generated from the running backend's OpenAPI schema |
| [architecture/API_CONTRACT.md](architecture/API_CONTRACT.md) | The frontend and backend contract (v1.2.0) |

## Features in depth

| Document | What it covers |
|---|---|
| [features/GHOST_BANKING.md](features/GHOST_BANKING.md) | The isolated synthetic bank for contained sessions, and why it ships switched off |
| [features/INCIDENT_RECOVERY.md](features/INCIDENT_RECOVERY.md) | How an analyst restores a genuine customer who was restricted |

## Results and honesty

| Document | What it covers |
|---|---|
| [evaluation/EVALUATION_PROTOCOL.md](evaluation/EVALUATION_PROTOCOL.md) | The protocol, written down before the final results were seen |
| [evaluation/EVALUATION.md](evaluation/EVALUATION.md) | The frozen held-out results for all three approaches |
| [evaluation/KNOWN_LIMITATIONS.md](evaluation/KNOWN_LIMITATIONS.md) | Every limitation we know about, in one place |

## Present and demo

| Document | What it covers |
|---|---|
| [presentation/SecureSynth_Deck.pptx](presentation/SecureSynth_Deck.pptx) | The presentation deck (PDF copy alongside) |
| [presentation/SPEAKER_NOTES.md](presentation/SPEAKER_NOTES.md) | The talk script and timing |
| [presentation/JUDGE_QA.md](presentation/JUDGE_QA.md) | Likely questions and short answers |
| [presentation/FALLBACK_STORYBOARD.md](presentation/FALLBACK_STORYBOARD.md) | The backup recording plan if the live demo fails |
| [presentation/brief](presentation/brief) | The deck's planning files: audience, outline, per-slide plan, checkup report |
| [presentation/tools](presentation/tools) | `build_hig_deck.js` rebuilds this deck from the brief; `build_deck.py` fills the official competition template |
| [guides/DEMO.md](guides/DEMO.md) | The 10-minute demo script, offline checklist and troubleshooting |

## Report

[report/PROJECT_REPORT.md](report/PROJECT_REPORT.md) is the source. `PROJECT_REPORT.docx`, `.html` and `.pdf` are generated from it by [report/tools/build_report.py](report/tools/build_report.py), and the charts in `report/figures/` come from [report/tools/charts.py](report/tools/charts.py).

## Project records

| Document | What it covers |
|---|---|
| [project/TEAM.md](project/TEAM.md) | Who did what |
| [project/RESOURCES.md](project/RESOURCES.md) | Libraries, fonts, licences and AI assistance |
| [project/SUBMISSION_CHECKLIST.md](project/SUBMISSION_CHECKLIST.md) | Pre-submission and on-the-day checks |
| [project/PROGRESS_LOG.md](project/PROGRESS_LOG.md) | The build log, with test evidence |
| [project/planning](project/planning) | The original design and implementation plan |

## Handoffs

Notes written when work moved between people or machines. They're historical, so some details have since changed.

- [handoffs/SECURESYNTH_3_HANDOFF.md](handoffs/SECURESYNTH_3_HANDOFF.md): the 3.0 release
- [handoffs/MAC2_HANDOFF.md](handoffs/MAC2_HANDOFF.md): moving the project to a second machine
- [handoffs/FRONTEND_HANDOFF.md](handoffs/FRONTEND_HANDOFF.md): the frontend design system
- [handoffs/TEAM_HANDOFF.md](handoffs/TEAM_HANDOFF.md): the checkpoint before the frontend redesign

## Screenshots

- [screenshots/app](screenshots/app): current screenshots of every page, taken from the running app on 26 November 2026
- [screenshots/presentation](screenshots/presentation): stills used in the fallback recording
- [screenshots/brand](screenshots/brand): the logo sheet
- [screenshots/archive](screenshots/archive): older captures from earlier designs, kept for the handoff notes that reference them

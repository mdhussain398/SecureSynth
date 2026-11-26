# Presentation checkup

Rendered deck: `docs/presentation/SecureSynth_Deck.pptx`, exported to PDF by Microsoft PowerPoint and checked page by page against `slide_plan.json`. Structure checked with the pptx skill's `validate.py` (passed).

## Round 1 (status: iterate)

| Slide | Finding | Fix |
|---|---|---|
| 4 | Outcome pills wrapped onto two lines; the descriptions were longer than the pill | Shortened to "Carries on", "Trusted device decides", "Session restricted"; 15 pt, no wrap |
| 7 | Title wrapped to two lines and collided with the chart legend | Title shortened to "More caught, far fewer bothered" (also updated in the plan) |
| 9 | Two stage descriptions wrapped and crowded the next row | Descriptions shortened and the text box widened |
| 10 | The last explanation line ran into "Tamper-evident, not immutable." | Explanation box made taller; the closing line moved down |
| 13 | "5.61 ms" broke across two lines | Stat size 44 pt with wrapping off |

## Round 2 (status: pass)

Every slide carries one claim the speaker can say out loud, matches its outline row in `ast_outline.md`, and has speaker notes from `speaker_intent.md`. No text overflow, overlap or broken numbers remain in the PowerPoint render. Round 3 was not needed.

## Known caveats

- The deck uses Helvetica Neue. It is on every Mac; Windows substitutes Arial, which is slightly narrower, so nothing should overflow there.
- Slide 12's still comes from the earlier recorded live run; every other screenshot was captured on 26 November 2026.

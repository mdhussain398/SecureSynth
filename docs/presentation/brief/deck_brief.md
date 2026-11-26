# Deck brief

## Audience
AVISHKAR'26 judges: a mix of security people, ML people and bankers or product folk. They have seen many fraud-detection demos that end in a dashboard and a big accuracy number. They know OTPs can be phished. They have about 10 minutes for us, plus 2 for questions, and they will ask how the numbers were produced.

## What they believe walking in
- "Two-factor login already solves account takeover, mostly."
- "ML fraud demos are black boxes with suspiciously perfect results."
- "Another hackathon team built a pretty console."

## What we want them to believe walking out
- A correct OTP proves someone has the credentials, not that the customer is present, and that gap is real.
- SecureSynth closes much of it with far less customer friction than static rules, and we can show exactly how each decision was made.
- The numbers were produced honestly: pre-registered protocol, frozen model, one scoring run, and we say where it fails.
- The team thought about what happens after a block (containment, evidence, investigation, reporting, recovery), and handled the risky parts (Ghost Banking, complaints) with restraint.

## Core tension
Catching more takeovers usually means challenging more genuine customers. Our claim is that personal baselines break that trade-off, but not completely, and not for familiar-device hijacks.

## Success criteria
- Each slide moves the room one step; none is just decoration.
- Every number on a slide traces to docs/evaluation/EVALUATION.md.
- A judge could repeat our one-line claim after the talk: "possession isn't presence".
- The limitations slide is shown, not skipped.

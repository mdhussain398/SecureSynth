# Two-minute fallback recording: storyboard (**RECORDING PENDING**)

**Status:**
- **Not yet recorded.** This Mac has no `ffmpeg`, and a screen recording needs a person at the keyboard.
- This storyboard is the script for recording it. Until it exists, the fallback is the deck's slide 5 screenshots plus `docs/screenshots/presentation/`.

## How to record (about 5 minutes, any team member)
**Setup:**
- Lab → **Reset demo**.
- The analyst is signed in and device-approved.
- Chrome is full screen at 100% zoom.
- Notifications are off.
- The authenticator and the credentials file are **never** on screen.

**Record:**
1. Press **⌘⇧5**, choose *Record Selected Portion* (1920×1080), and start.
2. Follow the shots below; speak the narration or add captions later.
3. Save as `submission/SecureSynth_fallback_2min.mov` (gitignored).

## Shots (2:00)
| # | Time | Screen | Narration (spoken or caption) |
|---|---|---|---|
| 1 | 0:00–0:10 | `/` landing: the orb and "Your identity. Beyond passwords." | "SecureSynth: risk-based authentication that keeps checking after sign-in. Synthetic data, real engine." |
| 2 | 0:10–0:30 | `/judge` → *Normal customer* → **R** | "A genuine customer pays ₹2,500 from a familiar device: allowed, no friction." |
| 3 | 0:30–1:00 | *Takeover despite password + TOTP* → **R** | "The attacker has the password and a valid OTP. SecureSynth still blocks at sign-in (risk index ≈99, not a probability); the payee add and transfer get 403; the balance is unchanged." |
| 4 | 1:00–1:20 | *Suspicious activity after a legitimate login* → **R** | "A genuine sign-in, then unusual behaviour: step-up and restriction. Authentication is not a single gate." |
| 5 | 1:20–1:40 | *Genuine traveller* → **R** | "A real traveller is asked once on their trusted device, approves, and the payment completes." |
| 6 | 1:40–2:00 | **Esc** → Command Centre; hover a signal | "Every decision is explained: ML index, deviations, policy points. On our synthetic test: 91.3% of takeovers intervened, 5.2% of genuine sessions interrupted." |

## Stills (real captures, already available)
| File | What it shows |
|---|---|
| `docs/screenshots/presentation/judge-mode-takeover-blocked.jpg` | Shot 3: Blocked 99.1, ₹96,200 unchanged |
| `docs/screenshots/presentation/command-centre-block.jpg` | Shot 6: Ravi, BLOCK 99.5 |
| `docs/screenshots/presentation/trusted-device-approval.jpg` | Shot 5: number matching on the trusted device |

## Checklist after recording
- [ ] Exactly 2:00 or less; audio level checked.
- [ ] No credentials, TOTP codes or the credentials file visible.
- [ ] Copied to the presentation laptop's desktop and to a USB stick.
- [ ] Change the status line at the top of this file from **RECORDING PENDING** to *recorded* (with the date).

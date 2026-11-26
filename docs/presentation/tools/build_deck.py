"""Populate the official AVISHKAR'26 template with SecureSynth content.

The template is read, never modified; the result is saved under a new name. Every template shape (branding, logo,
section headings, progress bar, footer, slide numbers) is kept; content is added inside the template's panels as
editable text, native shapes and a native chart. Metrics are read from the frozen evaluation report.

Usage (documentation tooling; needs python-pptx):
    python docs/presentation/tools/build_deck.py <template.pptx> <out.pptx>
"""
import json
import sys
from pathlib import Path

from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LABEL_POSITION, XL_LEGEND_POSITION
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt
from lxml import etree

ROOT = Path(__file__).resolve().parents[3]
REPORT = json.loads((ROOT / "backend/artifacts/eval_report.json").read_text())
A = {a["name"]: a for a in REPORT["approaches"]}
ST, SS = A["static_rules"], A["securesynth"]

WHITE = RGBColor(0xFF, 0xFF, 0xFF)
SOFT = RGBColor(0xD9, 0xCF, 0xD1)      # secondary text on the template's dark panels
MUTED = RGBColor(0xA8, 0x98, 0x9B)
RED = RGBColor(0xD6, 0x1F, 0x2B)        # template accent
BOX = RGBColor(0x2A, 0x14, 0x17)        # template inner surface
LINE = RGBColor(0x5A, 0x3A, 0x3E)       # template outline
BLUE = RGBColor(0x5B, 0x8C, 0xFF)       # Synth Core accent, used sparingly
AMBER = RGBColor(0xF7, 0x90, 0x09)
GREY = RGBColor(0x8A, 0x8F, 0x99)
FONT = "Arial"

from decimal import Decimal, ROUND_HALF_UP
pct = lambda v: f"{(Decimal(str(v)) * 100).quantize(Decimal('0.1'), ROUND_HALF_UP)}%"  # half-up, matching the report
crore = lambda p: f"₹{p / 100 / 1e7:.2f} cr"
lakh = lambda p: f"₹{p / 100 / 1e5:.1f} lakh"


def text(slide, x, y, w, h, paras, size=13, color=WHITE, anchor=MSO_ANCHOR.TOP, align=PP_ALIGN.LEFT, space=4, name=None):
    """paras: list of paragraphs; each is a str or a list of (text, {bold, color, size}) runs, or a dict
    {"runs": [...], "bullet": True|"1."...}."""
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    if name:
        tb.name = name
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    for i, para in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.space_after = Pt(space)
        bullet = None
        if isinstance(para, dict):
            bullet, para = para.get("bullet"), para["runs"]
        if isinstance(para, str):
            para = [(para, {})]
        for t, o in para:
            r = p.add_run()
            r.text = t
            f = r.font
            f.name = FONT
            f.size = Pt(o.get("size", size))
            f.bold = o.get("bold", False)
            f.color.rgb = o.get("color", color)
        if bullet:
            pPr = p._p.get_or_add_pPr()
            pPr.set("marL", str(Inches(0.24)))
            pPr.set("indent", str(-Inches(0.24)))
            clr = etree.SubElement(pPr, qn("a:buClr"))
            etree.SubElement(clr, qn("a:srgbClr")).set("val", "D61F2B")
            etree.SubElement(pPr, qn("a:buFont")).set("typeface", "Arial")
            if bullet is True:
                etree.SubElement(pPr, qn("a:buChar")).set("char", "•")
            else:
                etree.SubElement(pPr, qn("a:buAutoNum")).set("type", "arabicPeriod")
    return tb


def box(slide, x, y, w, h, fill=BOX, line=LINE, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.12, name=None):
    s = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    if name:
        s.name = name
    if fill is None:
        s.fill.background()
    else:
        s.fill.solid(); s.fill.fore_color.rgb = fill
    if line is None:
        s.line.fill.background()
    else:
        s.line.color.rgb = line; s.line.width = Pt(1)
    s.shadow.inherit = False
    if shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        s.adjustments[0] = radius
    s.text_frame.text = ""
    return s


def label_in(shape, paras, size=11, color=WHITE, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, pad=0.06):
    tf = shape.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Inches(pad)
    tf.margin_top = tf.margin_bottom = Inches(0.03)
    tf.vertical_anchor = anchor
    for i, para in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        if isinstance(para, str):
            para = [(para, {})]
        for t, o in para:
            r = p.add_run(); r.text = t
            r.font.name = FONT; r.font.size = Pt(o.get("size", size)); r.font.bold = o.get("bold", False)
            r.font.color.rgb = o.get("color", color)


def arrow(slide, x1, y1, x2, y2, color=MUTED):
    c = slide.shapes.add_connector(1, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    c.line.color.rgb = color; c.line.width = Pt(1.25)
    ln = c.line._get_or_add_ln()
    tail = etree.SubElement(ln, qn("a:tailEnd")); tail.set("type", "triangle"); tail.set("w", "med"); tail.set("len", "med")
    return c


def set_run_text(shape, new):
    """Replace a template text box's text while keeping its formatting (first run's rPr)."""
    p = shape.text_frame.paragraphs[0]
    runs = p.runs
    runs[0].text = new
    for r in runs[1:]:
        r._r.getparent().remove(r._r)


def brand_tag(slide):
    """Restrained product accent: the Synth Core mark and name, top right under the template's progress bar."""
    slide.shapes.add_picture(str(ROOT / "frontend/public/brand/synth-core-dark-1024.png"), Inches(11.05), Inches(1.28), Inches(0.36), Inches(0.36))
    text(slide, 11.45, 1.33, 1.3, 0.3, [[("SecureSynth", {"bold": True, "size": 12})]], name="Brand tag")


def notes(slide, body):
    slide.notes_slide.notes_text_frame.text = body.strip()


def by_text(slide, needle):
    return next(s for s in slide.shapes if s.has_text_frame and s.text_frame.text.strip() == needle)


def build(template, out):
    prs = Presentation(template)
    s1, s2, s3, s4, s5, s6, s7 = prs.slides
    ss_i, st_i = SS["intervention"], ST["intervention"]
    ssp, stp = SS["prevention"], ST["prevention"]

    # ---------- 1 · Project presentation ----------
    for lbl, val, sz in [
        ("TEAM ID", "AV26-50F33FD4DE", 15),
        ("TEAM NAME", "The_Terminators", 15),
        ("DOMAIN", "AI in Cyber Security and FinTech", 13),
        ("PROBLEM STATEMENT NO.", "24 · Risk-Based Authentication and Account Takeover Detection", 11),
        ("TEAM MEMBERS", "Mohammed Hussain · Ayman Ahmed\nSamruddh HS · Syed Nihal Mudassir", 11),
    ]:
        t = by_text(s1, lbl)
        y = t.top / 914400 + 0.36
        text(s1, 9.15, y, 3.15, 0.46, [[(line, {"bold": sz >= 13, "size": sz})] for line in val.split("\n")], space=0, name=f"Value · {lbl}")
    s1.shapes.add_picture(str(ROOT / "frontend/public/brand/synth-core-dark-1024.png"), Inches(0.72), Inches(6.12), Inches(0.62), Inches(0.62))
    text(s1, 1.42, 6.14, 6.4, 0.36, [[("SecureSynth", {"bold": True, "size": 22})]], name="Project name")
    text(s1, 1.42, 6.5, 6.6, 0.3, [[("Continuous, explainable defence against account takeover", {"size": 12, "color": SOFT})]], name="Project tagline")
    notes(s1, f"""
SPEAKER A: Mohammed Hussain · about 0:40
• Good morning. We are The_Terminators, team AV26-50F33FD4DE, from Adichunchanagiri Institute of Technology.
• Our problem is Statement 24: risk-based authentication and account takeover detection, in the domain AI in Cyber Security and FinTech.
• Our project is SecureSynth. The logo is two glass ribbons around a shield: who the customer says they are, and how they behave.
• One sentence to remember: a correct password and a correct OTP are not proof that the customer is present.
• Hand-off: "Let me show you why that matters."
Team: Mohammed Hussain, Ayman Ahmed, Samruddh HS, Syed Nihal Mudassir.
""")

    # ---------- 2 · Problem understanding ----------
    brand_tag(s2)
    text(s2, 0.9, 2.78, 1.6, 0.6, [[("0 / 367", {"bold": True, "size": 28, "color": RED})]])
    text(s2, 0.9, 3.38, 1.65, 0.9, [[("takeovers stopped by password + TOTP alone", {"size": 11, "color": SOFT})]])
    text(s2, 2.7, 2.8, 3.6, 1.5, [
        "Phishing kits relay the one-time code in real time, SIM swaps redirect it, and hijackers take over a live session.",
        [("The bank sees correct credentials.", {"bold": True})],
    ], size=13)
    text(s2, 7.12, 2.78, 1.6, 0.6, [[(pct(st_i["fpr"]), {"bold": True, "size": 28, "color": RED})]])
    text(s2, 7.12, 3.38, 1.65, 0.9, [[("of genuine sessions interrupted by static rules", {"size": 11, "color": SOFT})]])
    text(s2, 8.92, 2.8, 3.6, 1.5, [
        "Sign-in is treated as a one-time gate, and global rules judge every customer by one yardstick.",
        [(f"{pct(ST['traveller_restriction_rate'])} of genuine travellers are interrupted.", {"bold": True})],
    ], size=13)
    text(s2, 0.9, 5.17, 5.4, 1.5, [
        {"bullet": "1.", "runs": "Catch takeovers after a correct password and OTP"},
        {"bullet": "1.", "runs": "Without blocking travellers and new phones"},
        {"bullet": "1.", "runs": "Explain every decision to analysts"},
        {"bullet": "1.", "runs": "Learn new behaviour without being poisoned"},
    ], size=13, space=5)
    text(s2, 7.12, 5.17, 2.0, 1.5, [
        [("Who", {"bold": True, "color": RED, "size": 12})],
        "Customers", "Fraud analysts", "The bank",
    ], size=13, space=4)
    text(s2, 9.2, 5.17, 3.35, 1.5, [
        [("Success, fixed before results", {"bold": True, "color": RED, "size": 12})],
        {"bullet": True, "runs": "Recall above static rules"},
        {"bullet": True, "runs": "Genuine interruption ≤ 5% (target)"},
        {"bullet": True, "runs": "Block FPR ≤ 0.5% (target)"},
        {"bullet": True, "runs": "Every decision enforced server-side"},
    ], size=12, space=3)
    notes(s2, f"""
SPEAKER A: Mohammed Hussain · about 1:00
• Problem: attackers no longer need to break the password. Phishing kits relay the OTP in real time, SIM swaps redirect it, and session hijackers act after a genuine sign-in.
• Evidence from our synthetic evaluation: password + TOTP alone intervened in 0 of {A['password_totp']['intervention']['fn']} takeovers.
• Root cause: authentication is treated as a single gate. The usual fix, static global rules, judges everyone by the same yardstick: {pct(st_i['fpr'])} of genuine sessions and {pct(ST['traveller_restriction_rate'])} of genuine travellers were interrupted.
• Our four challenges, in priority order, and the success criteria we fixed in a pre-registered protocol before we saw any results (targets: intervention FPR ≤ 5%, block FPR ≤ 0.5%).
• Stakeholders: customers (lose money or get blocked), analysts (need explanations), the bank (fraud loss and friction).
• Hand-off to Speaker B: "So how do we keep checking without punishing genuine customers?"
""")

    # ---------- 3 · Approach & innovation ----------
    brand_tag(s3)
    for n, (head, body) in enumerate([
        ("SIGN IN", "Password (Argon2id) + TOTP with replay protection"),
        ("ASSESS", "15 personal deviations → Isolation Forest + policy points"),
        ("DECIDE", "ALLOW · STEP-UP · BLOCK, enforced by the backend"),
        ("VERIFY", "Trusted-device number match; learn only what is verified"),
    ], 1):
        set_run_text(by_text(s3, f"STEP {n}"), f"STEP {n} · {head}")
        x = [0.6, 3.66, 6.72, 9.79][n - 1]
        text(s3, x + 0.16, 3.52, 2.42, 0.7, [body], size=12, anchor=MSO_ANCHOR.MIDDLE)
    text(s3, 0.9, 5.07, 5.4, 1.65, [
        {"bullet": True, "runs": [("Personalised: ", {"bold": True}), ("deviations from this customer, not global thresholds", {})]},
        {"bullet": True, "runs": [("Continuous: ", {"bold": True}), ("risk at sign-in, payee add and every transfer", {})]},
        {"bullet": True, "runs": [("Bound approval: ", {"bold": True}), ("challenge tied to session, operation and payload hash", {})]},
        {"bullet": True, "runs": [("Safe adaptation: ", {"bold": True}), ("only verified behaviour is learned, after 2 clean sessions + 24 h; rollback", {})]},
    ], size=12.5, space=5)
    text(s3, 7.12, 5.07, 5.4, 1.65, [
        {"bullet": True, "runs": "Synthetic data only, disclosed on every screen"},
        {"bullet": True, "runs": "Fully offline: no paid APIs, no AI calls at runtime"},
        {"bullet": True, "runs": "Model frozen (SHA-256) before one-time test scoring"},
        {"bullet": True, "runs": "Risk index is a rarity percentile, never a probability"},
        {"bullet": True, "runs": "Customers never see scores; Ghost Banking off until mentor approval"},
    ], size=12.5, space=4)
    notes(s3, """
SPEAKER B: Ayman Ahmed · about 1:00
• Four stages. (1) Authenticate: Argon2id password and a genuine TOTP with replay protection; the session token rotates after TOTP.
• (2) Assess: at sign-in, payee add and every transfer we compute 15 deviations from THIS customer's trusted baseline — device, hour, city, distance, travel speed, amount, frequency, payee age, speed to act and more — score them with an Isolation Forest, and add transparent policy points.
• (3) Decide: score = 0.8 × ML index + policy points. Step-up at 77.73, block at 89.1 — thresholds chosen on validation data only. The backend enforces the decision; the browser only displays it.
• (4) Verify and adapt: step-up goes to a separately enrolled trusted device with number matching. The challenge is single-use, expires in 120 s and is bound to the session, the operation and a hash of the payload.
• Innovation: personalisation (02:00 is normal for a night-shift worker, rare for a 9-to-5 customer), continuous assessment, bound approvals, and a baseline that an attacker cannot train — new behaviour sits in a candidate profile and is promoted only after verification, two clean sessions and 24 hours; blocked sessions void their contributions; every change can be rolled back.
• Constraints: synthetic data only; offline; frozen model; the risk index is NOT a fraud probability; Ghost Banking is built and tested but stays off until a mentor approves it, because it deceives the session holder.
""")

    # ---------- 4 · Architecture & tech stack (editable diagram) ----------
    brand_tag(s4)
    b = box(s4, 0.9, 2.78, 6.6, 0.62, name="Browser")
    label_in(b, [[("Browser · React 19 + TypeScript", {"bold": True, "size": 12})],
                 [("Customer portal · Trusted device · Command Centre · Judge Mode", {"size": 10.5, "color": SOFT})]])
    arrow(s4, 4.2, 3.42, 4.2, 3.68)
    text(s4, 4.32, 3.44, 3.0, 0.24, [[("cookie + CSRF · /api JSON", {"size": 10, "color": MUTED})]])
    api = box(s4, 0.9, 3.7, 6.6, 2.0, fill=RGBColor(0x1E, 0x0D, 0x10), name="FastAPI service")
    text(s4, 1.05, 3.76, 4.0, 0.24, [[("FastAPI · Python 3.12", {"bold": True, "size": 11, "color": SOFT})]])
    for i, (h, d) in enumerate([("Authentication", "Argon2id · TOTP · sessions"), ("Banking ledger", "atomic conditional debit"), ("Enforcement", "modes · bound challenges")]):
        c = box(s4, 1.05 + i * 2.15, 4.04, 2.0, 0.62, name=h)
        label_in(c, [[(h, {"bold": True, "size": 11})], [(d, {"size": 9.5, "color": SOFT})]])
    steps = [("Features", "15 deviations", LINE), ("Isolation Forest", "rarity 0–100", BLUE), ("Policy points", "transparent rules", LINE), ("Decision", "0.8·ML + points", RED)]
    for i, (h, d, ln) in enumerate(steps):
        c = box(s4, 1.05 + i * 1.6, 4.86, 1.4, 0.7, line=ln, name=f"Engine · {h}")
        label_in(c, [[(h, {"bold": True, "size": 10.5})], [(d, {"size": 9.5, "color": SOFT})]])
        if i < 3:
            arrow(s4, 2.45 + i * 1.6, 5.21, 2.65 + i * 1.6, 5.21)
    arrow(s4, 4.2, 5.72, 4.2, 5.92)
    for i, (h, d) in enumerate([("4 SQLite stores (WAL)", "bank · ghost · evidence vault · demo reports"), ("Frozen model", "iforest-v1-956f432a · SHA-256 manifest")]):
        c = box(s4, 0.9 + i * 3.35, 5.94, 3.25, 0.7, line=BLUE if i else LINE, name=h)
        label_in(c, [[(h, {"bold": True, "size": 11})], [(d, {"size": 9.5, "color": SOFT})]])
    text(s4, 8.4, 2.8, 4.1, 1.75, [
        [("React + TypeScript  ", {"bold": True}), ("typed API contract", {"color": SOFT})],
        [("FastAPI + Pydantic  ", {"bold": True}), ("checks every route", {"color": SOFT})],
        [("Isolation Forest  ", {"bold": True}), ("no fraud labels needed", {"color": SOFT})],
        [("SQLite (WAL)  ", {"bold": True}), ("offline, atomic, zero setup", {"color": SOFT})],
        [("Argon2id · PyOTP · Fernet  ", {"bold": True}), ("proven primitives", {"color": SOFT})],
    ], size=12, space=6)
    for i, (big, small) in enumerate([("165", "backend tests passing"), ("6/6", "frozen hashes match"), (f"{SS['latency_ms']['p95']:.2f} ms", "p95 decision (in-process)"), ("0", "external services at run time")]):
        x, y = 8.4 + (i % 2) * 2.1, 5.4 + (i // 2) * 0.66
        text(s4, x, y, 2.0, 0.34, [[(big, {"bold": True, "size": 18, "color": RED if i == 0 else WHITE})]])
        text(s4, x, y + 0.33, 2.0, 0.28, [[(small, {"size": 10, "color": SOFT})]])
    notes(s4, f"""
SPEAKER B: Ayman Ahmed · about 1:00
• One React app talks to one FastAPI service; every decision is computed and enforced on the server. (Point top to bottom.)
• Browser: customer portal, trusted-device simulator, the analyst Command Centre and Judge Mode — React 19 + TypeScript, sharing a typed API contract (v1.2.0) with the backend.
• FastAPI: authentication (Argon2id, TOTP with replay protection, rotating sessions, CSRF and Origin checks), an idempotent ledger where a transfer is one atomic conditional debit, and enforcement of session modes and bound challenges.
• Risk engine: features → Isolation Forest (scikit-learn, 300 trees; unsupervised, so it needs no fraud labels) → transparent policy points → decision.
• Storage: four separate SQLite stores (protected bank, Ghost Banking, encrypted evidence vault, demo complaints); startup refuses to run if two share a file. The model is frozen and every scoring file is pinned by SHA-256.
• Why these choices: offline, reproducible, zero external services, well-known security primitives.
• Evidence: 165 backend tests pass; 6/6 frozen hashes match; p95 decision latency {SS['latency_ms']['p95']:.2f} ms in-process on one laptop (excludes network and database).
• Hand-off to Speaker C: "Let's see it working."
""")

    # ---------- 5 · Implementation & working logic ----------
    brand_tag(s5)
    flow = [("Request", "cookie · CSRF · idempotency key"), ("Checks", "session mode · Origin · payee owner"),
            ("Features", "15 deviations from past history"), ("Score", "0.8 × ML + policy points"),
            ("Enforce + audit", "debit · challenge · 403; logged")]
    for i, (h, d) in enumerate(flow):
        c = box(s5, 0.85 + i * 2.39, 2.74, 2.25, 0.56, shape=MSO_SHAPE.CHEVRON if i else MSO_SHAPE.PENTAGON, line=RED if i == 4 else LINE, name=f"Flow · {h}")
        label_in(c, [[(h, {"bold": True, "size": 13})]], pad=0.22)
        text(s5, 0.85 + i * 2.39, 3.4, 2.1, 0.5, [[(d, {"size": 11.5, "color": SOFT})]], align=PP_ALIGN.CENTER)
    shots = [("app/console-04-incidents.jpg", 2.16, "Incidents · analyst decisions"),
             ("presentation/judge-mode-takeover-blocked.jpg", 2.16, "Judge Mode · balance unchanged"),
             ("presentation/trusted-device-approval.jpg", 0.74, "Trusted device")]
    x = 0.85
    for f, w, cap in shots:
        pic = s5.shapes.add_picture(str(ROOT / "docs/screenshots" / f), Inches(x), Inches(4.84), Inches(w))
        pic.line.color.rgb = LINE; pic.line.width = Pt(0.75)
        h = pic.height / 914400
        text(s5, x, 4.84 + h + 0.05, w if w > 1 else w + 0.3, 0.26, [[(cap, {"size": 10, "color": SOFT})]])
        x += w + 0.1
    text(s5, 7.12, 4.85, 5.4, 1.85, [
        {"bullet": True, "runs": [("Backend enforcement: ", {"bold": True}), ("a restricted session gets 403 on payee add and transfer", {})]},
        {"bullet": True, "runs": [("Explainable: ", {"bold": True}), ("ML index, deviations, policy points and decision shown separately", {})]},
        {"bullet": True, "runs": [("After a block: ", {"bold": True}), ("evidence vault, incident workspace, correlation graph, cybercrime report", {})]},
        {"bullet": True, "runs": [("Judge Mode: ", {"bold": True}), ("11 Lab scenarios run live through the real API", {})]},
        {"bullet": True, "runs": [("Customers ", {"bold": True}), ("see calm messages, never scores", {})]},
    ], size=12, space=4)
    notes(s5, """
SPEAKER C: Samruddh HS · about 0:45 on the slide, then LIVE DEMO about 3:15
• Data flow for one transfer: the browser sends the session cookie, a CSRF header and an idempotency key; the backend checks the session mode, Origin and payee ownership; the engine builds features only from history BEFORE the event, scores it, stores the full assessment, and enforces — debit, a bound challenge, or 403 — and every step goes to the audit log.
• Screenshots are real, captured from the running product: the incident queue where analysts decide what happens after a block, Judge Mode with the protected balance unchanged, and the trusted-device approval with number matching.
• After a block (SecureSynth 3.0): the session is restricted (or contained in Ghost Banking if approved), evidence is collected into an encrypted, hash-chained vault, and analysts work the case in an investigation workspace and a correlation graph, prepare a cybercrime complaint (demo destination by default), and restore a genuine customer through a fresh verified sign-in.

LIVE DEMO (switch to the browser; Judge Mode at /judge, analyst already signed in; demo reset beforehand)
1. Normal customer → Run live (R): ALLOW; asha pays ₹2,500 with no friction. (~0:40)
2. Takeover despite password + TOTP → Run live: correct password, valid OTP, still BLOCKED at the TOTP step (≈99); payee add and transfer get 403; ravi's ₹96,200 unchanged. Say: "Correct password. Correct OTP. Still not the customer." (~1:00)
3. Suspicious activity after a legitimate login: sign-in ALLOWED, then payee add → STEP-UP and restriction. "Authentication is not a single gate." (~0:40)
4. Genuine traveller: STEP-UP → approved on the trusted device → ₹2,500 completes. "Low friction for real customers." (~0:40)
5. Esc → Command Centre: point at the four explanation panels. (~0:15)
Fallbacks: if a run stalls, press "Show all steps"; if the network/laptop fails, play the 2-minute fallback recording.
""")

    # ---------- 6 · Results & outcomes ----------
    brand_tag(s6)
    cd = CategoryChartData()
    cd.categories = ["Recall", "Precision", "F1", "Genuine sessions\ninterrupted"]
    p100 = lambda v: float((Decimal(str(v)) * 100).quantize(Decimal("0.1"), ROUND_HALF_UP))
    cd.add_series("Static global rules", [p100(st_i[k]) for k in ("recall", "precision", "f1", "fpr")])
    cd.add_series("SecureSynth", [p100(ss_i[k]) for k in ("recall", "precision", "f1", "fpr")])
    gf = s6.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(0.8), Inches(2.72), Inches(5.55), Inches(2.85), cd)
    gf.name = "Detection chart (from eval_report.json)"
    ch = gf.chart
    ch.font.name = FONT; ch.font.size = Pt(11); ch.font.color.rgb = SOFT
    ch.has_legend = True; ch.legend.position = XL_LEGEND_POSITION.TOP; ch.legend.include_in_layout = False
    ch.legend.font.size = Pt(11); ch.legend.font.color.rgb = WHITE
    va = ch.value_axis; va.maximum_scale = 100; va.minimum_scale = 0; va.major_unit = 25; va.has_major_gridlines = True
    va.major_gridlines.format.line.color.rgb = RGBColor(0x3A, 0x22, 0x26); va.tick_labels.number_format = '0"%"'; va.tick_labels.number_format_is_linked = False
    va.format.line.fill.background(); va.tick_labels.font.size = Pt(10); va.tick_labels.font.color.rgb = MUTED
    ca = ch.category_axis; ca.tick_labels.font.size = Pt(10.5); ca.tick_labels.font.color.rgb = SOFT; ca.format.line.color.rgb = LINE
    plot = ch.plots[0]; plot.gap_width = 60; plot.overlap = -10
    # no chart-area frame or fill: the template panel is the frame
    cs = ch._chartSpace
    for parent in (cs, cs.find(qn("c:chart")).find(qn("c:plotArea"))):
        spPr = parent.find(qn("c:spPr"))
        if spPr is None:
            spPr = etree.Element(qn("c:spPr"))
            if parent is cs:  # schema order: c:chart, then c:spPr
                cs.find(qn("c:chart")).addnext(spPr)
            else:            # plotArea: c:spPr after the axes, before c:extLst
                ext = parent.find(qn("c:extLst"))
                (ext.addprevious(spPr) if ext is not None else parent.append(spPr))
        for child in list(spPr):
            spPr.remove(child)
        etree.SubElement(spPr, qn("a:noFill"))
        etree.SubElement(etree.SubElement(spPr, qn("a:ln")), qn("a:noFill"))
    for ser, col in zip(plot.series, [GREY, RED]):
        ser.format.fill.solid(); ser.format.fill.fore_color.rgb = col
        ser.data_labels.show_value = True; ser.data_labels.number_format = '0.0"%"'; ser.data_labels.number_format_is_linked = False
        ser.data_labels.position = XL_LABEL_POSITION.OUTSIDE_END; ser.data_labels.font.size = Pt(10); ser.data_labels.font.color.rgb = WHITE
    for i, (big, small) in enumerate([("165 / 165", "backend tests"), ("6 / 6", "live scenarios verified"), (f"{SS['latency_ms']['p95']:.2f} ms", "p95 decision latency")]):
        text(s6, 0.9 + i * 1.85, 5.68, 1.8, 0.34, [[(big, {"bold": True, "size": 17, "color": WHITE})]])
        text(s6, 0.9 + i * 1.85, 6.0, 1.8, 0.26, [[(small, {"size": 10, "color": SOFT})]])
    d = REPORT["dataset"]
    text(s6, 0.9, 6.33, 5.45, 0.4, [[(f"Synthetic test population: {d['customers']} customers, {d['sessions_test']:,} sessions, {d['attacks_test']} takeovers; frozen model scored once. Not real-world validation.", {"size": 9.5, "color": MUTED})]])
    text(s6, 7.12, 2.78, 5.45, 3.95, [
        [("Resolved", {"bold": True, "color": RED, "size": 12})],
        {"bullet": True, "runs": f"Traveller friction: {pct(ST['traveller_restriction_rate'])} → {pct(SS['traveller_restriction_rate'])} interrupted"},
        {"bullet": True, "runs": f"SIM swap and OTP relay: {SS['per_family_recall']['A']:.0%} recall; held-out low-and-slow: {pct(SS['per_family_recall']['D'])}"},
        {"bullet": True, "runs": "Too-easy v1 data (100% recall) withdrawn; v2 protocol pre-registered"},
        {"bullet": True, "runs": "Baseline poisoning: only verified behaviour is learned"},
        [("Still open, disclosed", {"bold": True, "color": RED, "size": 12})],
        {"bullet": True, "runs": f"Static rules prevent a little more money: {crore(stp['attack_value_prevented_paise'])} vs {crore(ssp['attack_value_prevented_paise'])}"},
        {"bullet": True, "runs": f"We delay far less genuine money ({crore(ssp['legit_value_delayed_paise'])} vs {crore(stp['legit_value_delayed_paise'])}) but block more outright ({lakh(ssp['legit_value_blocked_paise'])} vs {lakh(stp['legit_value_blocked_paise'])})"},
        {"bullet": True, "runs": f"Familiar-device hijack recall {pct(SS['per_family_recall']['C'])}; block FPR {SS['block_only']['fpr']:.2%} vs 0.5% target"},
    ], size=12, space=4)
    notes(s6, f"""
SPEAKER D: Syed Nihal Mudassir · about 1:30
• Method: protocol pre-registered; model frozen; a fresh synthetic population ({d['customers']} customers, {d['sessions_test']:,} sessions, {d['attacks_test']} takeovers) scored once. All three approaches ran on identical sessions.
• Headline: SecureSynth intervened in {pct(ss_i['recall'])} of takeovers vs {pct(st_i['recall'])} for static rules, while interrupting {pct(ss_i['fpr'])} of genuine sessions vs {pct(st_i['fpr'])}. Precision {pct(ss_i['precision'])} vs {pct(st_i['precision'])}; F1 {pct(ss_i['f1'])} vs {pct(st_i['f1'])}.
• Travellers: {pct(SS['traveller_restriction_rate'])} interrupted vs {pct(ST['traveller_restriction_rate'])}. New-device sessions: {pct(SS['new_device_restriction_rate'])} vs {pct(ST['new_device_restriction_rate'])}.
• Be explicit about what we do NOT claim: static rules prevent slightly MORE attack money in total ({crore(stp['attack_value_prevented_paise'])} vs our {crore(ssp['attack_value_prevented_paise'])}) by challenging almost everyone. We delay far less genuine money ({crore(ssp['legit_value_delayed_paise'])} vs {crore(stp['legit_value_delayed_paise'])}) but block more genuine money outright ({lakh(ssp['legit_value_blocked_paise'])} vs {lakh(stp['legit_value_blocked_paise'])}).
• Weakness: a hijack on the customer's own familiar device — recall {pct(SS['per_family_recall']['C'])}. Block FPR drifted to {SS['block_only']['fpr']:.2%} against a 0.5% validation target.
• The risk index is a rarity percentile plus policy points — never a fraud probability. All of this is synthetic: it shows the method works on our data, not real-world performance.
• Engineering: 165/165 backend tests, all six live scenarios verified, p95 {SS['latency_ms']['p95']:.2f} ms in-process.
""")

    # ---------- 7 · Impact, scalability & next steps ----------
    brand_tag(s7)
    text(s7, 0.9, 2.78, 5.4, 1.25, [
        {"bullet": True, "runs": "Step-up only when behaviour is unusual for this customer"},
        {"bullet": True, "runs": "Continuous checks where takeovers drain accounts: payees and transfers"},
        {"bullet": True, "runs": "Analysts can explain, override and roll back every decision"},
        {"bullet": True, "runs": "Every incident keeps encrypted, tamper-evident evidence"},
    ], size=12.5, space=4)
    text(s7, 7.12, 2.78, 5.4, 1.25, [
        {"bullet": True, "runs": "Stateless API and scorer scale out; PostgreSQL, TLS, KMS keys"},
        {"bullet": True, "runs": "Real trusted-device app with attestation; payee and mule-risk signals"},
        {"bullet": True, "runs": "Anchor the evidence ledger outside the system"},
        {"bullet": True, "runs": "First: validate on consented, labelled bank data"},
    ], size=12.5, space=4)
    text(s7, 0.9, 4.86, 8.6, 0.7, [[("A correct password and OTP prove possession, not presence. SecureSynth keeps checking, explains every decision, and asks the real customer when it is unsure.", {"size": 14, "bold": True})]], anchor=MSO_ANCHOR.MIDDLE)
    text(s7, 9.75, 4.82, 2.75, 0.4, [[(f"{pct(ss_i['recall'])}  ·  {pct(ss_i['fpr'])}", {"size": 18, "bold": True, "color": RED})]], align=PP_ALIGN.RIGHT)
    text(s7, 9.55, 5.2, 2.95, 0.4, [[("takeovers intervened · genuine interrupted (synthetic)", {"size": 9.5, "color": SOFT})]], align=PP_ALIGN.RIGHT)
    notes(s7, f"""
SPEAKER D: Syed Nihal Mudassir · about 1:00, then all four for Q&A
• Impact: banks can stop asking every customer for more friction and instead step up only when behaviour is unusual for that customer — and keep checking at the moments that matter: payee adds and transfers.
• Scalability: the API and the scorer are stateless and scale horizontally. Production needs PostgreSQL, distributed rate limiting, TLS everywhere, KMS/HSM-managed keys, a real trusted-device app with attestation, and payee and mule-account risk signals for the familiar-device case.
• Honest next step: validate on real, consented, labelled bank data with fairness and drift monitoring before making any real-world claim.
• Close: "A correct password and OTP prove possession, not presence. SecureSynth keeps checking, explains every decision, and asks the real customer when it is unsure. Thank you."
• Q&A: see docs/presentation/JUDGE_QA.md. Route questions: frontend → C, backend/security → B, ML/evaluation → D, product/limitations → A.
""")

    prs.save(out)
    print("saved", out)


if __name__ == "__main__":
    t, o = sys.argv[1:3]
    assert Path(t).resolve() != Path(o).resolve(), "never overwrite the template"
    build(t, o)

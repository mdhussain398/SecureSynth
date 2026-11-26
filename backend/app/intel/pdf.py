"""Minimal, dependency-free PDF writer (standard Helvetica fonts, A4, automatic page breaks and word wrap).
Enough for a readable incident report; no images, no external libraries."""
import textwrap


def _esc(s: str) -> str:
    s = s.replace("₹", "INR ").replace("—", "-").replace("–", "-").replace("→", "->").replace("·", "-").replace("×", "x")
    s = s.replace("‘", "'").replace("’", "'").replace("“", '"').replace("”", '"').replace("…", "...")
    s = s.encode("latin-1", "replace").decode("latin-1")
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def render(title: str, blocks: list[tuple[str, str]], footer: str) -> bytes:
    """blocks: (style, text) with style in h1 | h2 | p | mono | small | warn."""
    W, H, M = 595, 842, 50
    styles = {"h1": ("F2", 17, 22, 70), "h2": ("F2", 12, 18, 88), "p": ("F1", 9.5, 13, 104), "mono": ("F3", 8, 11, 112),
              "small": ("F1", 8, 11, 120), "warn": ("F2", 9.5, 13, 100)}
    pages, cur, y = [], [], H - M

    def newpage():
        nonlocal cur, y
        if cur:
            pages.append(cur)
        cur, y = [], H - M

    def line(font, size, text, color=(0.06, 0.09, 0.16)):
        nonlocal y
        if y < M + 30:
            newpage()
        cur.append(f"BT /{font} {size} Tf {color[0]} {color[1]} {color[2]} rg {M} {y:.1f} Td ({_esc(text)}) Tj ET")
        y -= styles_lh

    for style, text in [("h1", title)] + blocks:
        font, size, lh, width = styles[style]
        styles_lh = lh
        if style in ("h1", "h2"):
            y -= 6
        color = (0.75, 0.06, 0.28) if style == "warn" else (0.06, 0.09, 0.16)
        for para in (text or "").split("\n"):
            for chunk in (textwrap.wrap(para, width) or [""]):
                line(font, size, chunk, color)
        if style in ("h1", "h2"):
            y -= 2
    newpage()
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", None,
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"]
    kids = []
    n = len(pages)
    for i, ops in enumerate(pages):
        ops = ops + [f"BT /F1 7.5 Tf 0.4 0.44 0.5 rg {M} 28 Td ({_esc(footer)} - page {i + 1} of {n}) Tj ET",
                     f"0.0 0.36 1.0 RG 1.2 w {M} {H - 34} m {W - M} {H - 34} l S",
                     f"BT /F2 9 Tf 0.0 0.24 0.67 rg {M} {H - 28} Td (SecureSynth) Tj ET"]
        stream = "\n".join(ops).encode("latin-1")
        objs.append(f"<< /Length {len(stream)} >>\nstream\n".encode("latin-1") + stream + b"\nendstream")
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {W} {H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> "
                    f"/Contents {len(objs)} 0 R >>")
        kids.append(f"{len(objs)} 0 R")
    objs[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {n} >>"
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, o in enumerate(objs, start=1):
        offsets.append(len(out))
        body = o if isinstance(o, bytes) else o.encode("latin-1")
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)

"""Build PROJECT_REPORT.html (for the PDF) and PROJECT_REPORT.docx from PROJECT_REPORT.md.

Needs `markdown` and `python-docx` (documentation tooling only, not product dependencies):
    python docs/report/tools/build_report.py docs/report/PROJECT_REPORT.md
The PDF is printed from the HTML by headless Chrome (see docs/handoffs/MAC2_HANDOFF.md).
"""
import re
import sys
from pathlib import Path

import markdown
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

GRAPHITE = RGBColor(0x10, 0x18, 0x28)
INK3 = RGBColor(0x4A, 0x54, 0x66)
ELECTRIC = RGBColor(0x00, 0x47, 0xCC)

CSS = """
@page { size: A4; margin: 18mm 17mm 20mm; }
body { font-family: -apple-system, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif; color: #101828; font-size: 10.2pt; line-height: 1.5; }
h1 { font-family: -apple-system, "SF Pro Display", "Helvetica Neue", sans-serif; font-size: 24pt; font-weight: 700; line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 6pt; }
h2 { font-family: -apple-system, "SF Pro Display", "Helvetica Neue", sans-serif; font-size: 15pt; font-weight: 700; letter-spacing: -0.01em; margin: 22pt 0 6pt; break-after: avoid; }
h3 { font-size: 11.5pt; margin: 14pt 0 4pt; break-after: avoid; }
p { margin: 0 0 7pt; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9pt; break-inside: avoid; }
th, td { border-bottom: 1px solid #E3E7ED; padding: 4pt 6pt; text-align: left; vertical-align: top; }
th { color: #4A5466; font-weight: 600; border-bottom: 1.5px solid #C0C7D1; }
blockquote { margin: 8pt 0; padding: 9pt 12pt; background: #F5F7FA; border-radius: 10px; color: #344054; }
blockquote p { margin: 0; }
code { font-family: Menlo, monospace; font-size: 8.6pt; background: #F2F4F7; padding: 0 3px; border-radius: 3px; }
pre { background: #F5F7FA; padding: 8pt; border-radius: 6px; font-size: 8.6pt; }
img { border-radius: 8px;  max-width: 100%; display: block; margin: 8pt auto 2pt; break-inside: avoid; }
p:has(> img) + p > em:only-child { color: #4A5466; }
em { color: #344054; }
hr { border: 0; border-top: 1px solid #E3E7ED; margin: 12pt 0; }
a { color: #0047CC; text-decoration: none; }
.brand { display: flex; align-items: center; gap: 10pt; margin-bottom: 10pt; color: #4A5466; font-size: 9pt; }
.brand img { width: 34pt; margin: 0; }
"""


LIST = re.compile(r"^(\s*)(- |\d+\. )")


def normalise_lists(text: str) -> str:
    """Python-Markdown needs a blank line before a list and 4-space nesting; the source uses 2-3 spaces."""
    out, prev = [], ""
    for ln in text.splitlines():
        m = LIST.match(ln)
        if m:
            ln = ("    " if m.group(1) else "") + ln.lstrip()
            if prev.strip() and not LIST.match(prev) and not prev.startswith("    "):
                out.append("")
        out.append(ln)
        prev = ln
    return "\n".join(out) + "\n"


def build_html(md_path: Path) -> Path:
    text = normalise_lists(md_path.read_text())
    body = markdown.markdown(text, extensions=["tables", "fenced_code"])
    logo = (md_path.parent.parent.parent / "frontend/public/brand/synth-core-light-256.png").resolve()
    head = f'<div class="brand"><img src="file://{logo}" alt=""><span>SecureSynth · Technical report · AVISHKAR\'26 · Problem 24</span></div>'
    html = f'<!doctype html><html><head><meta charset="utf-8"><title>SecureSynth technical report</title><style>{CSS}</style></head><body>{head}{body}</body></html>'
    out = md_path.with_suffix(".html")
    out.write_text(html)
    return out


# ---------- DOCX ----------
INLINE = re.compile(r"(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\))")


def add_inline(par, text, bold=False, color=None, size=None):
    for part in INLINE.split(text):
        if not part:
            continue
        b, it, mono = bold, False, False
        if part.startswith("**") and part.endswith("**"):
            part, b = part[2:-2], True
        elif part.startswith("`") and part.endswith("`"):
            part, mono = part[1:-1], True
        elif part.startswith("[") and "](" in part:
            label, url = re.match(r"\[([^\]]+)\]\(([^)]+)\)", part).groups()
            part = label if label == url else f"{label} ({url})"
        elif part.startswith("*") and part.endswith("*") and len(part) > 2:
            part, it = part[1:-1], True
        run = par.add_run(part)
        run.bold, run.italic = b, it
        if mono:
            run.font.name = "Menlo"; run.font.size = Pt(8.5)
        if color is not None:
            run.font.color.rgb = color
        if size is not None:
            run.font.size = Pt(size)


def shade(cell, hex_fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd"); shd.set(qn("w:val"), "clear"); shd.set(qn("w:color"), "auto"); shd.set(qn("w:fill"), hex_fill)
    tcPr.append(shd)


def build_docx(md_path: Path) -> Path:
    doc = Document()
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Cm(21), Cm(29.7)
    sec.left_margin = sec.right_margin = Cm(1.8); sec.top_margin = Cm(1.8); sec.bottom_margin = Cm(2)
    st = doc.styles["Normal"]; st.font.name = "Helvetica Neue"; st.font.size = Pt(10); st.font.color.rgb = GRAPHITE
    for name, size in (("Heading 1", 22), ("Heading 2", 14), ("Heading 3", 11.5)):
        h = doc.styles[name]; h.font.name = "Helvetica Neue"; h.font.size = Pt(size); h.font.color.rgb = GRAPHITE; h.font.bold = True

    logo = md_path.parent.parent.parent / "frontend/public/brand/synth-core-light-256.png"
    if logo.exists():
        p = doc.add_paragraph(); p.add_run().add_picture(str(logo), width=Cm(1.4))
        add_inline(p, "   SecureSynth · Technical report · AVISHKAR'26 · Problem 24", color=INK3, size=8.5)

    lines = md_path.read_text().splitlines()
    i = 0
    while i < len(lines):
        ln = lines[i]
        if not ln.strip() or ln.strip() == "---":
            i += 1; continue
        if ln.startswith("```"):
            j = i + 1; code = []
            while j < len(lines) and not lines[j].startswith("```"):
                code.append(lines[j]); j += 1
            p = doc.add_paragraph(); r = p.add_run("\n".join(code)); r.font.name = "Menlo"; r.font.size = Pt(8.5)
            i = j + 1; continue
        m = re.match(r"^(#{1,3}) (.*)", ln)
        if m:
            h = doc.add_heading('', level=len(m.group(1))); add_inline(h, m.group(2)); i += 1; continue
        m = re.match(r"^!\[([^\]]*)\]\(([^)]+)\)", ln)
        if m:
            img = (md_path.parent / m.group(2)).resolve()
            if img.exists():
                p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                p.add_run().add_picture(str(img), width=Cm(16.5))
            i += 1; continue
        if ln.startswith(">"):
            buf = []
            while i < len(lines) and lines[i].startswith(">"):
                buf.append(lines[i].lstrip("> ").strip()); i += 1
            t = doc.add_table(rows=1, cols=1); c = t.rows[0].cells[0]; shade(c, "F5F7FA")
            add_inline(c.paragraphs[0], " ".join(buf))
            doc.add_paragraph(); continue
        if ln.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-+:?", c) for c in cells):
                    rows.append(cells)
                i += 1
            ncol = max(len(r) for r in rows)
            t = doc.add_table(rows=len(rows), cols=ncol); t.style = "Table Grid"; t.alignment = WD_TABLE_ALIGNMENT.CENTER
            for r, row in enumerate(rows):
                for c in range(ncol):
                    cell = t.cell(r, c); cell.text = ""
                    add_inline(cell.paragraphs[0], row[c] if c < len(row) else "", bold=(r == 0), size=8.5,
                               color=INK3 if r == 0 else None)
                    if r == 0:
                        shade(cell, "F2F4F7")
            doc.add_paragraph(); continue
        m = re.match(r"^(\s*)(- |\d+\. )(.*)", ln)
        if m:
            style = "List Bullet" if m.group(2) == "- " else "List Number"
            if len(m.group(1)) >= 2:
                style += " 2"
            p = doc.add_paragraph(style=style); add_inline(p, m.group(3)); i += 1; continue
        # paragraph (merge soft-wrapped lines)
        buf = [ln.strip()]; i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#|\||>|!\[|```|\s*- |\s*\d+\. )", lines[i]):
            buf.append(lines[i].strip()); i += 1
        p = doc.add_paragraph(); add_inline(p, " ".join(buf))
    out = md_path.with_suffix(".docx")
    doc.save(out)
    return out


if __name__ == "__main__":
    md = Path(sys.argv[1]).resolve()
    print("html:", build_html(md))
    print("docx:", build_docx(md))

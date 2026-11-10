"""보고서 .md → .docx 변환 + 학술 보고서 서식 적용.

사용법:
    python3 R/10_build_docx.py                 # output/보고서_*.md 전부
    python3 R/10_build_docx.py output/보고서_03_보강분석_결과.md

내용(문장·수치·강조)은 건드리지 않고 서식만 정한다.
- 본문: 바탕 / Times New Roman 10.5pt, 줄간격 1.45
- 제목: 맑은 고딕 굵게, 검정 (Word 기본 파란 제목 제거)
- 표: 위·머리행 아래·맨 아래 가로선 3개만, 세로선 없음, 9pt
      첫 열 왼쪽 정렬·숫자 열 가운데 정렬, 내용 길이에 맞춘 열 너비
- A4, 여백 25mm, 쪽 번호 아래 가운데
- 표의 ✅/⚠ 이모지는 Word본에서 제외(옆 글자와 뜻이 같음). .md 원문은 그대로
"""
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Mm, Pt, RGBColor

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "output" / "docx"

BODY_KO, BODY_LATIN = "바탕", "Times New Roman"
HEAD_KO, HEAD_LATIN = "맑은 고딕", "Arial"
INK = RGBColor(0x1A, 0x1A, 0x1A)
MUTED = RGBColor(0x55, 0x55, 0x55)

PAGE_W, MARGIN = 210, 25
TEXT_W_MM = PAGE_W - 2 * MARGIN


# ---------- 공통 유틸 ----------
def set_fonts(target, ko, latin):
    """style 또는 run의 한글/영문 글꼴 지정."""
    target.font.name = latin
    rpr = target.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.insert(0, rfonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs"):
        rfonts.set(qn(attr), latin)
    rfonts.set(qn("w:eastAsia"), ko)
    for attr in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
        rfonts.attrib.pop(qn(attr), None)


def para_format(pf, size_before=0, size_after=0, line=1.45):
    pf.space_before = Pt(size_before)
    pf.space_after = Pt(size_after)
    pf.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    pf.line_spacing = line


def border_el(tag, sz, color="1A1A1A", val="single"):
    el = OxmlElement(f"w:{tag}")
    el.set(qn("w:val"), val)
    el.set(qn("w:sz"), str(sz))  # 1/8 pt
    el.set(qn("w:space"), "0")
    el.set(qn("w:color"), color)
    return el


def text_width(s):
    """동아시아 전각 문자는 2, 나머지는 1로 센 표시 폭."""
    return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in s)


def em_width(s):
    """글자별 대략 폭(em). 바탕/Times New Roman 기준 추정치."""
    w = 0.0
    for ch in s:
        if unicodedata.east_asian_width(ch) in "WF":
            w += 1.0
        elif ch in ".,;:'|!":
            w += 0.27
        elif ch in " ()[]{}":
            w += 0.33
        elif ch.isupper():
            w += 0.68
        elif ch.islower():
            w += 0.47
        else:
            w += 0.5
    return w


NOSTART = tuple(".,;:)]}%")   # 한글 줄바꿈 규칙상 줄 맨 앞에 올 수 없는 글자
NOEND = tuple("([{")


def unbreakable_chunks(t):
    """실제로 줄이 바뀔 수 있는 지점(공백)만으로 자른 덩어리."""
    chunks = []
    for w in t.split():
        if chunks and (w.startswith(NOSTART) or chunks[-1].endswith(NOEND)):
            chunks[-1] += " " + w
        else:
            chunks.append(w)
    return chunks or [""]


NUMERIC = re.compile(r"^[\s\d.,:;=<>≤≥±\-−–()\[\]%*†‡pPdfΔχ²ⁿ/]+$")


def is_numeric(s):
    s = s.strip()
    return bool(s) and bool(NUMERIC.match(s)) and any(c.isdigit() for c in s)


# ---------- 스타일 ----------
def style_document(doc):
    # pandoc이 만든 스타일 이름("Heading 1")은 python-docx 조회 규칙과 달라 직접 색인
    st = {s.name: s for s in doc.styles}

    for name in ("Normal", "Body Text", "First Paragraph", "Compact"):
        if name not in st:
            continue
        s = st[name]
        set_fonts(s, BODY_KO, BODY_LATIN)
        s.font.size = Pt(10.5)
        s.font.color.rgb = INK
        after = 3 if name == "Compact" else 7
        para_format(s.paragraph_format, 0, after, 1.45)
        s.paragraph_format.first_line_indent = None

    heads = {
        "Title": (17, 0, 4),
        "Heading 1": (17, 0, 4),
        "Heading 2": (12.5, 20, 7),
        "Heading 3": (10.5, 14, 5),
    }
    for name, (size, before, after) in heads.items():
        if name not in st:
            continue
        s = st[name]
        set_fonts(s, HEAD_KO, HEAD_LATIN)
        s.font.size = Pt(size)
        s.font.bold = True
        s.font.italic = False
        s.font.color.rgb = INK
        para_format(s.paragraph_format, before, after, 1.25)
        s.paragraph_format.keep_with_next = True

    # 문서 제목: 아래 가는 선 하나 (이 보고서 묶음의 유일한 장식)
    for name in ("Title", "Heading 1"):
        if name in st:
            ppr = st[name].element.get_or_add_pPr()
            pbdr = OxmlElement("w:pBdr")
            bottom = border_el("bottom", 8)
            bottom.set(qn("w:space"), "6")
            pbdr.append(bottom)
            ppr.append(pbdr)
            st[name].paragraph_format.space_after = Pt(14)

    if "Table" in st:
        set_fonts(st["Table"], BODY_KO, BODY_LATIN)


def tighten_lists(doc):
    """pandoc 기본 글머리표 들여쓰기(0.5in)를 본문에 맞게 줄인다."""
    numbering = doc.part.numbering_part.element
    for lvl in numbering.iter(qn("w:lvl")):
        depth = int(lvl.get(qn("w:ilvl")))
        ind = lvl.find(qn("w:pPr") + "/" + qn("w:ind"))
        if ind is None:
            continue
        ind.set(qn("w:left"), str(300 + depth * 300))
        ind.set(qn("w:hanging"), "220")


def style_page(doc):
    for sec in doc.sections:
        sec.page_width, sec.page_height = Mm(210), Mm(297)
        sec.left_margin = sec.right_margin = Mm(MARGIN)
        sec.top_margin, sec.bottom_margin = Mm(25), Mm(22)
        footer = sec.footer.paragraphs[0]
        footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = footer.add_run()
        for kind, text in (("begin", None), (None, " PAGE "), ("end", None)):
            if kind:
                fc = OxmlElement("w:fldChar")
                fc.set(qn("w:fldCharType"), kind)
                run._r.append(fc)
            else:
                it = OxmlElement("w:instrText")
                it.set(qn("xml:space"), "preserve")
                it.text = text
                run._r.append(it)
        run.font.size = Pt(9)
        run.font.color.rgb = MUTED
        set_fonts(run, BODY_KO, BODY_LATIN)


# ---------- 표 ----------
def style_table(table):
    rows = table.rows
    ncols = len(table.columns)
    body = rows[1:]

    # 열별 정렬: 본문 셀의 70% 이상이 숫자면 가운데
    centered = []
    for c in range(ncols):
        vals = [r.cells[c].text for r in body if r.cells[c].text.strip()]
        share = sum(is_numeric(v) for v in vals) / len(vals) if vals else 0
        centered.append(c > 0 and share >= 0.7)

    # 열 너비: 쪼갤 수 없는 덩어리가 들어갈 최소 폭을 먼저 확보하고,
    # 남는 폭은 각 열이 한 줄로 들어가는 데 모자란 만큼 비례 배분
    PAD = 3.2  # 셀 좌우 여백 + 여유(mm)
    minw, pref = [], []
    for c in range(ncols):
        cells = [r.cells[c].text for r in rows]
        minw.append(max(em_width(ch) for t in cells for ch in unbreakable_chunks(t)))
        body_w = max([em_width(r.cells[c].text) for r in body] or [2])
        head = rows[0].cells[c].text.strip()
        head_w = em_width(head) if em_width(head) <= 5 else em_width(head) * 0.55
        pref.append(max(body_w, head_w, minw[-1]))

    for font_pt in (9, 8.5, 8, 7.5):
        to_mm = lambda em, f=font_pt: em * f * 0.3528 + PAD
        if sum(map(to_mm, minw)) <= TEXT_W_MM:
            break
    if sum(map(to_mm, pref)) <= TEXT_W_MM:
        widths = [to_mm(u) for u in pref]
        widths = [w * TEXT_W_MM / sum(widths) for w in widths]
    else:
        base = [to_mm(u) for u in minw]
        spare = max(TEXT_W_MM - sum(base), 0)
        need = [max(to_mm(pu) - b, 0) for pu, b in zip(pref, base)]
        tot = sum(need) or 1
        widths = [b + spare * n / tot for b, n in zip(base, need)]

    tbl = table._tbl
    tblpr = tbl.tblPr
    for tag in ("w:tblStyle", "w:tblBorders", "w:tblW", "w:tblLayout", "w:tblLook"):
        el = tblpr.find(qn(tag))
        if el is not None:
            tblpr.remove(el)
    tblw = OxmlElement("w:tblW")
    tblw.set(qn("w:w"), str(int(TEXT_W_MM * 56.7)))
    tblw.set(qn("w:type"), "dxa")
    tblpr.append(tblw)
    borders = OxmlElement("w:tblBorders")
    borders.append(border_el("top", 10))
    borders.append(border_el("bottom", 10))
    for tag in ("left", "right", "insideH", "insideV"):
        borders.append(border_el(tag, 0, val="nil"))
    tblpr.append(borders)
    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "fixed")
    tblpr.append(layout)
    mar = OxmlElement("w:tblCellMar")
    for side, v in (("top", 40), ("bottom", 40), ("left", 80), ("right", 80)):
        m = OxmlElement(f"w:{side}")
        m.set(qn("w:w"), str(v))
        m.set(qn("w:type"), "dxa")
        mar.append(m)
    tblpr.append(mar)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER

    grid = tbl.tblGrid
    for gc, w in zip(grid.findall(qn("w:gridCol")), widths):
        gc.set(qn("w:w"), str(int(w * 56.7)))

    for ri, row in enumerate(rows):
        trpr = row._tr.get_or_add_trPr()
        if ri == 0:
            hdr = OxmlElement("w:tblHeader")
            trpr.append(hdr)
        cant = OxmlElement("w:cantSplit")
        trpr.append(cant)
        for ci, cell in enumerate(row.cells):
            cell.width = Mm(widths[ci])
            tcpr = cell._tc.get_or_add_tcPr()
            va = OxmlElement("w:vAlign")
            va.set(qn("w:val"), "bottom" if ri == 0 else "center")
            tcpr.append(va)
            if ri == 0:
                tb = OxmlElement("w:tcBorders")
                tb.append(border_el("bottom", 6))
                tcpr.append(tb)
            for p in cell.paragraphs:
                para_format(p.paragraph_format, 0, 0, 1.2)
                p.alignment = (
                    WD_ALIGN_PARAGRAPH.CENTER if centered[ci] else WD_ALIGN_PARAGRAPH.LEFT
                )
                for run in p.runs:
                    run.font.size = Pt(font_pt)
                    set_fonts(run, BODY_KO, BODY_LATIN)
                    if ri == 0:
                        run.font.color.rgb = INK

    # 짧은 표는 한 쪽에 모아 둔다(마지막 행 제외 다음 행과 붙이기)
    if len(rows) <= 16:
        for row in rows[:-1]:
            for cell in row.cells:
                for p in cell.paragraphs:
                    p.paragraph_format.keep_with_next = True

    # 표를 소개하는 바로 앞 단락은 표와 같은 쪽에
    prv = tbl.getprevious()
    if prv is not None and prv.tag == qn("w:p"):
        ppr = prv.get_or_add_pPr()
        if ppr.find(qn("w:keepNext")) is None:
            ppr.append(OxmlElement("w:keepNext"))

    # 표 바로 다음 단락에 여백
    nxt = tbl.getnext()
    if nxt is not None and nxt.tag == qn("w:p"):
        ppr = nxt.get_or_add_pPr()
        sp = ppr.find(qn("w:spacing"))
        if sp is None:
            sp = OxmlElement("w:spacing")
            ppr.append(sp)
        sp.set(qn("w:before"), "160")


# ---------- 실행 ----------
def build(md_path: Path):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / (md_path.stem + ".docx")
    text = md_path.read_text(encoding="utf-8")
    # 표의 ✅/⚠ 는 바로 옆 '일치'/'불일치' 글자와 뜻이 겹치는 장식이라 Word본에서만 뺀다
    text = re.sub(r"(✅|⚠\ufe0f?)\s*", "", text)
    subprocess.run(
        ["pandoc", "-f", "gfm", "-t", "docx", "-o", str(out)],
        input=text.encode("utf-8"),
        check=True,
    )
    doc = Document(str(out))
    style_document(doc)
    style_page(doc)
    tighten_lists(doc)
    for t in doc.tables:
        style_table(t)
    doc.core_properties.title = md_path.stem
    doc.save(str(out))
    return out


if __name__ == "__main__":
    targets = [Path(a) for a in sys.argv[1:]] or sorted((ROOT / "output").glob("보고서_*.md"))
    for md in targets:
        print("→", build(md.resolve()).relative_to(ROOT))

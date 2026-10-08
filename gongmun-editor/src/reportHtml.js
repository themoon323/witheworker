// 보고서를 HTML로 그린다 (미리보기·인쇄용). 한글(HWPX)과 같은 서식 규칙(report.js)을 쓴다.
import {
  computeHeadingMarkers, blockStyle, blockIndent, itemSymbol, symbolWidth, parseInline, tocEntries,
} from './report.js';
import { reportHeaderText } from './reportHwpx.js';

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function fontStack(name, role) {
  const fallback = {
    body: '"휴먼명조", "HCR Batang", "함초롬바탕", "Batang", "바탕", "Noto Serif KR", serif',
    head: '"HY헤드라인M", "HYHeadLine M", "HY견고딕", "Malgun Gothic", "맑은 고딕", "Noto Sans KR", sans-serif',
    sub: '"HY중고딕", "HYGothic-Medium", "Malgun Gothic", "맑은 고딕", "Noto Sans KR", sans-serif',
  }[role];
  return `"${name}", ${fallback}`;
}

function roleOf(font, fonts) {
  if (font === fonts.head) return 'head';
  if (font === fonts.sub) return 'sub';
  return 'body';
}

function inlineHtml(text) {
  return parseInline(text).map((p) => {
    let h = escHtml(p.text).replace(/\n/g, '<br>');
    if (p.bold) h = `<b>${h}</b>`;
    if (p.underline) h = `<u>${h}</u>`;
    return h;
  }).join('');
}

function styleAttr(st, fonts, extra = '') {
  const role = roleOf(st.font, fonts);
  const weight = role === 'head' ? 'font-weight:800;' : st.bold ? 'font-weight:700;' : '';
  return `font-family:${escHtml(fontStack(st.font, role))};font-size:${st.size}pt;${weight}${extra}`;
}

// 본문만 (편집기 화면에서도 쓴다). 반환: 쪽(page) 단위 HTML 조각 배열
export function reportPagesHtml(doc) {
  const s = doc.settings;
  const f = s.fonts;
  const body = s.size;
  const hm = computeHeadingMarkers(doc.blocks);
  const pages = [[]];
  const push = (html) => pages[pages.length - 1].push(html);
  const em = (n, size = body) => `${(n * size).toFixed(2)}pt`;

  if (doc.meta.cover) {
    push(`<div class="r-cover"><div class="r-cover-title" style="${styleAttr({ font: f.head, size: 26 }, f)}">${inlineHtml(doc.meta.title)}</div>`
      + (doc.meta.subtitle ? `<div style="${styleAttr({ font: f.sub, size: 17 }, f)}">${inlineHtml(doc.meta.subtitle)}</div>` : '')
      + `<div class="r-cover-foot">${doc.meta.date ? `<div style="${styleAttr({ font: f.sub, size: 16 }, f)}">${inlineHtml(doc.meta.date)}</div>` : ''}`
      + `${doc.meta.dept ? `<div style="${styleAttr({ font: f.head, size: 18 }, f)}">${inlineHtml(doc.meta.dept)}</div>` : ''}</div></div>`);
    pages.push([]);
  }
  if (doc.meta.toc) {
    push(`<div class="r-toc-title" style="${styleAttr({ font: f.head, size: 20 }, f)}">목&nbsp;&nbsp;&nbsp;차</div>`);
    for (const e of tocEntries(doc.blocks)) {
      const st = e.level === 1 ? { font: f.head, size: body + 1 } : { font: f.body, size: body };
      push(`<div class="r-line" style="${styleAttr(st, f, `margin-left:${em(e.level === 1 ? 2 : 3.5)};margin-top:${e.level === 1 ? 10 : 3}pt`)}"><span class="r-mk" style="min-width:${em(e.level === 1 ? 1.5 : 1.2)}">${escHtml(e.marker)}</span><span class="r-tx">${escHtml(e.text)}</span></div>`);
    }
    pages.push([]);
  }
  if (!doc.meta.cover) {
    push(`<div class="r-title" style="${styleAttr({ font: f.head, size: 22 }, f)}">${inlineHtml(doc.meta.title) || '&nbsp;'}</div>`);
    if (doc.meta.subtitle) push(`<div class="r-subtitle" style="${styleAttr({ font: f.sub, size: body }, f)}">${inlineHtml(doc.meta.subtitle)}</div>`);
    const metaLine = [doc.meta.date, doc.meta.dept].filter(Boolean).join('  ');
    if (metaLine) push(`<div class="r-meta" style="${styleAttr({ font: f.sub, size: body - 2 }, f)}">${escHtml(metaLine)}</div>`);
  }

  for (const b of doc.blocks) {
    const st = blockStyle(b, s);
    const left = em(blockIndent(b, s));
    const top = `margin-top:${st.prev}pt;`;
    switch (b.type) {
      case 'pagebreak':
        pages.push([]);
        break;
      case 'heading':
        push(`<div class="r-line r-h${b.level}" data-id="${b.id}" style="${styleAttr(st, f, `${top}margin-bottom:${st.next}pt`)}"><span class="r-mk" style="min-width:${em(symbolWidth(hm.get(b.id)) + 0.5, st.size)}">${escHtml(hm.get(b.id))}</span><span class="r-tx">${inlineHtml(b.text)}</span></div>`);
        break;
      case 'item': {
        const sym = itemSymbol(b.level, s.symbols);
        push(`<div class="r-line r-i${b.level}" data-id="${b.id}" style="${styleAttr(st, f, `${top}margin-left:${left}`)}"><span class="r-mk" style="min-width:${em(symbolWidth(sym) + 0.5)}">${escHtml(sym)}</span><span class="r-tx">${inlineHtml(b.text)}</span></div>`);
        break;
      }
      case 'para':
        push(`<p class="r-para" data-id="${b.id}" style="${styleAttr(st, f, `${top}margin-left:${left}`)}">${inlineHtml(b.text)}</p>`);
        break;
      case 'note':
        push(`<div class="r-line r-note" data-id="${b.id}" style="${styleAttr(st, f, `${top}margin-left:${left}`)}"><span class="r-mk" style="min-width:${em(1.5, st.size)}">※</span><span class="r-tx">${inlineHtml(b.text)}</span></div>`);
        break;
      case 'box': {
        const lines = b.lines.map((t) => {
          const m = /^([□o○ㅇ\-·※]|\d+[.)])\s+(.*)$/.exec(t);
          return m ? `<div class="r-line"><span class="r-mk" style="min-width:${em(symbolWidth(m[1]) + 0.5, st.size)}">${escHtml(m[1])}</span><span class="r-tx">${inlineHtml(m[2])}</span></div>` : `<div>${inlineHtml(t)}</div>`;
        }).join('');
        push(`<div class="r-box" data-id="${b.id}" style="${styleAttr(st, f, top)}">${b.title ? `<div class="r-box-title"><b>${inlineHtml(b.title)}</b></div>` : ''}${lines}</div>`);
        break;
      }
      case 'table': {
        const cap = b.caption ? `<div class="r-caption" style="${styleAttr({ font: f.sub, size: st.size, bold: true }, f, top)}">${inlineHtml(b.caption)}</div>` : '';
        const unit = b.unit ? `<div class="r-unit" style="${styleAttr({ font: f.sub, size: st.size - 1 }, f)}">${inlineHtml(b.unit)}</div>` : '';
        const rows = b.rows.map((r, ri) => `<tr${b.header && ri === 0 ? ' class="r-th"' : ''}>${r.map((t) => {
          const short = symbolWidth(t) <= 8 && !t.includes('\n');
          return `<td style="text-align:${b.header && ri === 0 ? 'center' : short ? 'center' : 'left'}">${inlineHtml(t)}</td>`;
        }).join('')}</tr>`).join('');
        push(`<div class="r-table" data-id="${b.id}" style="margin-left:${left}">${cap}${unit}<table style="${styleAttr(st, f, b.caption || b.unit ? 'margin-top:2pt' : top)}">${rows}</table></div>`);
        break;
      }
      default:
        break;
    }
  }
  return pages.map((p) => p.join(''));
}

export const REPORT_CSS = `
.r-page { position: relative; width: 210mm; min-height: 297mm; background: #fff; color: #000; box-sizing: border-box; margin: 0 auto 10mm; word-break: keep-all; overflow-wrap: anywhere; }
.r-header { position: absolute; top: 10mm; right: 20mm; left: 20mm; text-align: right; }
.r-footer { position: absolute; bottom: 8mm; left: 0; right: 0; text-align: center; }
.r-line { display: flex; align-items: baseline; }
.r-mk { flex: none; white-space: pre; }
.r-tx { flex: 1; min-width: 0; text-align: justify; }
.r-para { margin: 0; text-align: justify; }
.r-title { text-align: center; border-top: 0.5mm solid #000; border-bottom: 0.5mm solid #000; padding: 5pt 0; margin-bottom: 4pt; line-height: 1.2; }
.r-subtitle { text-align: center; margin-bottom: 2pt; }
.r-meta { text-align: right; margin-bottom: 8pt; }
.r-box { border: 0.12mm solid #000; background: #f2f2f2; padding: 4pt 6pt; margin-left: 0.5em; margin-right: 0.5em; line-height: 1.25; }
.r-box-title { text-align: center; }
.r-caption { text-align: center; }
.r-unit { text-align: right; }
.r-table table { width: 100%; border-collapse: collapse; line-height: 1.2; }
.r-table td { border: 0.12mm solid #000; padding: 1.4pt 3pt; vertical-align: middle; }
.r-table tr.r-th td { background: #e7e6e6; border-bottom-width: 0.4mm; font-weight: 700; }
.r-cover { text-align: center; padding-top: 75mm; }
.r-cover-title { border-top: 0.5mm solid #000; border-bottom: 0.5mm solid #000; padding: 6pt 0; margin-bottom: 10pt; line-height: 1.2; }
.r-cover-foot { margin-top: 95mm; display: flex; flex-direction: column; gap: 8pt; }
.r-toc-title { text-align: center; margin-bottom: 16pt; }
`;

// 단독 HTML 문서 (명령줄 변환기의 미리보기)
export function reportToHtml(doc) {
  const s = doc.settings;
  const m = s.margins;
  const header = reportHeaderText(doc);
  const pages = reportPagesHtml(doc);
  const lh = s.lineHeight / 100;
  const sheets = pages.map((html, i) => {
    const showChrome = !(doc.meta.cover && i === 0);
    return `<section class="r-page" style="padding:${m.top + m.header}mm ${m.right}mm ${m.bottom + m.footer}mm ${m.left}mm;line-height:${lh}">`
      + (showChrome && header ? `<div class="r-header" style="font-family:${escHtml(fontStack(s.fonts.sub, 'sub'))};font-size:14pt">${escHtml(header)}</div>` : '')
      + html
      + (showChrome && s.pageNumber ? `<div class="r-footer" style="font-family:${escHtml(fontStack(s.fonts.sub, 'sub'))};font-size:11pt">- ${i + 1} -</div>` : '')
      + '</section>';
  }).join('\n');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escHtml(doc.meta.title)}</title>
<style>body{margin:0;padding:10mm 0;background:#e5e7eb;font-family:serif}${REPORT_CSS}@media print{body{background:#fff;padding:0}.r-page{margin:0;page-break-after:always}}</style></head>
<body>${sheets}</body></html>`;
}

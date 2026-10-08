// 보고서·제안서를 한글 문서(HWPX)로 내보낸다.
import {
  computeHeadingMarkers, blockStyle, blockIndent, itemSymbol, symbolWidth, parseInline, stripInline, defaultHeader, tocEntries,
} from './report.js';
import { Styles, Writer, sectionRun, packHwpx, tableXml, mm } from './hwpxCore.js';

const PT = 100; // 1pt = 100 HWPUNIT
const THIN = '0.12 mm';

export function reportHeaderText(doc) {
  const h = (doc.meta.header || '').trim();
  if (h === '없음') return '';
  return h || defaultHeader(doc.meta);
}

export function reportToPlainText(doc) {
  const hm = computeHeadingMarkers(doc.blocks);
  const sy = doc.settings.symbols;
  const out = [stripInline(doc.meta.title)];
  if (doc.meta.subtitle) out.push(stripInline(doc.meta.subtitle));
  for (const b of doc.blocks) {
    const ind = ' '.repeat(Math.round(blockIndent(b, doc.settings) * 2));
    if (b.type === 'heading') out.push(`${hm.get(b.id)} ${stripInline(b.text)}`);
    else if (b.type === 'item') out.push(`${ind}${itemSymbol(b.level, sy)} ${stripInline(b.text)}`);
    else if (b.type === 'para') out.push(`${ind}${stripInline(b.text)}`);
    else if (b.type === 'note') out.push(`${ind}※ ${stripInline(b.text)}`);
    else if (b.type === 'box') out.push(...[b.title, ...b.lines].filter(Boolean).map(stripInline));
    else if (b.type === 'table') out.push(...b.rows.map((r) => r.map(stripInline).join(' | ')));
  }
  return out.join('\n');
}

// 칸 너비: 글자 수에 비례하되 너무 좁거나 넓지 않게
function columnWidths(rows, total) {
  const cols = rows[0].length;
  const need = Array.from({ length: cols }, (_, c) => Math.max(2, ...rows.map((r) => Math.max(...String(r[c] ?? '').split('\n').map((l) => symbolWidth(stripInline(l)))))));
  const capped = need.map((n) => Math.min(n, 30));
  const sum = capped.reduce((a, b) => a + b, 0);
  let widths = capped.map((n) => Math.max(total * 0.08, (total * n) / sum));
  const k = total / widths.reduce((a, b) => a + b, 0);
  widths = widths.map((x) => Math.floor(x * k));
  widths[cols - 1] += total - widths.reduce((a, b) => a + b, 0);
  return widths;
}

export function buildReportSection(doc, styles) {
  const s = doc.settings;
  const f = s.fonts;
  const body = s.size;
  const em = body * PT;
  const line = s.lineHeight;
  const w = new Writer(styles, { line });
  const contentWidth = mm(210 - s.margins.left - s.margins.right);
  const hm = computeHeadingMarkers(doc.blocks);
  const ch = (st, extra = {}) => styles.char({ size: st.size, font: st.font, bold: !!st.bold, ...extra });
  const runs = (text, st) => parseInline(text).filter((p) => p.text).map((p) => ({ char: ch(st, { bold: !!(st.bold || p.bold), underline: !!p.underline }), text: p.text }));
  let pendingBreak = false;
  let lead = null; // 첫 문단 앞에 붙일 쪽 설정 run
  const P = (opt, rs) => {
    const all = lead ? [lead, ...rs] : rs;
    lead = null;
    w.p(opt, all.length ? all : [{ char: ch({ size: body, font: f.body }), text: '' }], { pageBreak: pendingBreak });
    pendingBreak = false;
  };

  // 쪽 설정, 머리말, 쪽 번호
  const headerText = reportHeaderText(doc);
  const small = { size: 11, font: f.sub };
  lead = sectionRun(styles, {
    margins: s.margins,
    char: ch({ size: body, font: f.body }),
    hideFirst: !!doc.meta.cover,
    header: headerText ? { align: 'RIGHT', runs: [{ char: ch({ size: 14, font: f.sub }), text: headerText }] } : null,
    footer: s.pageNumber ? { align: 'CENTER', runs: [{ char: ch(small), text: '- ' }, { char: ch(small), pageNumber: true }, { char: ch(small), text: ' -' }] } : null,
  });

  const titleBox = styles.border({ top: '0.5 mm', bottom: '0.5 mm' });

  // 표지
  if (doc.meta.cover) {
    P({ align: 'CENTER', prev: mm(75) }, []);
    P({ align: 'CENTER', border: titleBox, borderTop: 6 * PT, borderBottom: 6 * PT, line: 120, prev: 0, next: 10 * PT }, runs(doc.meta.title, { size: 26, font: f.head }));
    if (doc.meta.subtitle) P({ align: 'CENTER', next: 6 * PT }, runs(doc.meta.subtitle, { size: 17, font: f.sub }));
    P({ align: 'CENTER', prev: mm(95) }, doc.meta.date ? runs(doc.meta.date, { size: 16, font: f.sub }) : []);
    if (doc.meta.dept) P({ align: 'CENTER', prev: 8 * PT }, runs(doc.meta.dept, { size: 18, font: f.head }));
    pendingBreak = true;
  }

  // 목차
  if (doc.meta.toc) {
    const entries = tocEntries(doc.blocks);
    P({ align: 'CENTER', next: 16 * PT }, runs('목   차', { size: 20, font: f.head }));
    for (const e of entries) {
      if (e.level === 1) P({ prev: 10 * PT, left: 2 * em, hang: 1.5 * em }, [{ char: ch({ size: body + 1, font: f.head }), text: `${e.marker}\t${e.text}` }]);
      else P({ prev: 3 * PT, left: 3.5 * em, hang: 1.2 * em }, [{ char: ch({ size: body, font: f.body }), text: `${e.marker}\t${e.text}` }]);
    }
    pendingBreak = true;
  }

  // 제목 (표지가 없을 때)
  if (!doc.meta.cover) {
    P({ align: 'CENTER', border: titleBox, borderTop: 5 * PT, borderBottom: 5 * PT, line: 120, next: 4 * PT }, runs(doc.meta.title, { size: 22, font: f.head }));
    if (doc.meta.subtitle) P({ align: 'CENTER', next: 2 * PT }, runs(doc.meta.subtitle, { size: body, font: f.sub }));
    const metaLine = [doc.meta.date, doc.meta.dept].filter(Boolean).join('  ');
    if (metaLine) P({ align: 'RIGHT', next: 8 * PT }, runs(metaLine, { size: body - 2, font: f.sub }));
  }

  for (const b of doc.blocks) {
    const st = blockStyle(b, s);
    const left = blockIndent(b, s) * em;
    switch (b.type) {
      case 'pagebreak':
        pendingBreak = true;
        break;
      case 'heading': {
        const marker = hm.get(b.id);
        const hang = (symbolWidth(marker) + 0.5) * st.size * PT;
        P({ left: 0, hang, prev: st.prev * PT, next: st.next * PT, keepNext: true }, [{ char: ch(st), text: `${marker}\t` }, ...runs(b.text, st)]);
        break;
      }
      case 'item': {
        const sym = itemSymbol(b.level, s.symbols);
        const hang = (symbolWidth(sym) + 0.5) * em;
        P({ left, hang, prev: st.prev * PT }, [{ char: ch(st), text: `${sym}\t` }, ...runs(b.text, st)]);
        break;
      }
      case 'para':
        P({ left, prev: st.prev * PT }, runs(b.text, st));
        break;
      case 'note':
        P({ left, hang: 1.5 * st.size * PT, prev: st.prev * PT }, [{ char: ch(st), text: '※\t' }, ...runs(b.text, st)]);
        break;
      case 'box': {
        const border = styles.border({ top: THIN, bottom: THIN, left: THIN, right: THIN }, '#F2F2F2');
        const lines = [...(b.title ? [{ title: true, text: b.title }] : []), ...b.lines.map((t) => ({ text: t }))];
        lines.forEach((ln, k) => {
          const opt = { border, connect: true, borderSide: 6 * PT, borderTop: k === 0 ? 4 * PT : 0, borderBottom: k === lines.length - 1 ? 4 * PT : 0, prev: k === 0 ? st.prev * PT : 0, left: 0.5 * em, right: 0.5 * em, line: 125 };
          if (ln.title) { P({ ...opt, align: 'CENTER' }, runs(ln.text, { ...st, bold: true })); return; }
          const m = /^([□o○ㅇ\-·※]|\d+[.)])\s+(.*)$/.exec(ln.text);
          if (m) P({ ...opt, hang: (symbolWidth(m[1]) + 0.5) * st.size * PT }, [{ char: ch(st), text: `${m[1]}\t` }, ...runs(m[2], st)]);
          else P(opt, runs(ln.text, st));
        });
        break;
      }
      case 'table': {
        if (pendingBreak) P({}, []);
        if (b.caption) P({ align: 'CENTER', prev: st.prev * PT, next: 2 * PT, keepNext: true }, runs(b.caption, { size: st.size, font: f.sub, bold: true }));
        if (b.unit) P({ align: 'RIGHT', keepNext: true, prev: b.caption ? 0 : st.prev * PT }, runs(b.unit, { size: st.size - 1, font: f.sub }));
        const width = contentWidth - Math.round(left);
        const colWidths = columnWidths(b.rows, width);
        const cell = styles.border({ top: THIN, bottom: THIN, left: THIN, right: THIN });
        const headCell = styles.border({ top: THIN, bottom: '0.4 mm', left: THIN, right: THIN }, '#E7E6E6');
        const center = styles.para({ align: 'CENTER', line: 120 });
        const leftP = styles.para({ align: 'LEFT', line: 120 });
        const rowHeights = b.rows.map((r) => {
          const lines = Math.max(1, ...r.map((t, c) => String(t).split('\n').reduce((n, l) => n + Math.max(1, Math.ceil((symbolWidth(stripInline(l)) * st.size * PT) / Math.max(1, colWidths[c] - 600))), 0)));
          return Math.round(lines * st.size * PT * 1.25 + 282);
        });
        const rows = b.rows.map((r, ri) => r.map((t) => {
          const header = b.header && ri === 0;
          const short = symbolWidth(stripInline(t)) <= 8 && !t.includes('\n');
          return { runs: runs(t, header ? { ...st, font: f.sub, bold: true } : st), header, border: header ? headCell : cell, para: header || short ? center : leftP };
        }));
        tableXml(w, {
          rows, colWidths, rowHeights, borderId: cell, repeatHeader: b.header,
          para: styles.para({ align: 'LEFT', left, line: 100, prev: b.caption || b.unit ? 2 * PT : st.prev * PT, next: 3 * PT }),
          char: ch(st), margin: { l: 300, r: 300, t: 141, b: 141 },
        });
        break;
      }
      default:
        break;
    }
  }
  if (lead) P({}, []);
  return w.xml();
}

export function buildReportHwpx(doc, now = new Date()) {
  const styles = new Styles();
  const section = buildReportSection(doc, styles);
  return packHwpx({ header: styles.header(), section, title: stripInline(doc.meta.title), preview: reportToPlainText(doc), now });
}

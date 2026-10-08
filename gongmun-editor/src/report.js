// 보고서·제안서 문서 모델과 서식 규칙
// 형식 기준: 공공보고서 작성 기준(대통령비서실 「보고서 품질향상 연구팀」 표준 기반)
//   A4, 여백 위·아래 15mm·좌우 20mm(머리말·꼬리말 10mm), 본문 명조 15pt, 제목 22pt, 줄간격 130%,
//   제목·중간목차 고딕(헤드라인), 참고·수치 중고딕 13pt, 머리말 오른쪽 정렬.
// 항목 체계: 장 Ⅰ. → 절 1. → 1) / 항목 □ → o → - → · / 주석 ※
import { uid } from './model.js';

export const DEFAULT_SYMBOLS = ['□', 'o', '-', '·'];

export function reportSettings() {
  return {
    fonts: { body: '휴먼명조', head: 'HY헤드라인M', sub: 'HY중고딕' },
    size: 15,
    lineHeight: 130,
    margins: { top: 15, bottom: 15, left: 20, right: 20, header: 10, footer: 10 },
    symbols: [...DEFAULT_SYMBOLS],
    indent: 1, // 항목 수준마다 들여 쓰는 폭(본문 글자 크기 기준 글자 수)
    pageNumber: true,
  };
}

export function blankReport() {
  return {
    version: 1,
    kind: 'report',
    meta: { title: '', subtitle: '', date: '', dept: '', header: '', cover: false, toc: false },
    blocks: [],
    settings: reportSettings(),
  };
}

export const rblock = {
  heading: (level, text) => ({ id: uid(), type: 'heading', level, text }),
  item: (level, text) => ({ id: uid(), type: 'item', level, text }),
  para: (level, text) => ({ id: uid(), type: 'para', level, text }),
  note: (level, text) => ({ id: uid(), type: 'note', level, text }),
  box: (title, lines) => ({ id: uid(), type: 'box', title, lines }),
  table: (rows, { caption = '', unit = '', level = 0, header = true } = {}) => ({ id: uid(), type: 'table', rows, caption, unit, level, header }),
  pagebreak: () => ({ id: uid(), type: 'pagebreak' }),
};

const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', 'Ⅺ', 'Ⅻ'];

export function headingMarker(level, n) {
  if (level === 1) return `${ROMAN[n - 1] || n}.`;
  if (level === 2) return `${n}.`;
  return `${n})`;
}

export function itemSymbol(level, symbols = DEFAULT_SYMBOLS) {
  return symbols[Math.min(level, symbols.length) - 1] || symbols[symbols.length - 1];
}

// 장·절 번호 계산. 반환: Map(id → 'Ⅰ.' 등)
export function computeHeadingMarkers(blocks) {
  const c = [0, 0, 0, 0];
  const out = new Map();
  for (const b of blocks) {
    if (b.type !== 'heading') continue;
    c[b.level] += 1;
    for (let l = b.level + 1; l <= 3; l++) c[l] = 0;
    out.set(b.id, headingMarker(b.level, c[b.level]));
  }
  return out;
}

// 블록 종류별 서식. 화면 미리보기와 HWPX가 함께 쓴다. 크기는 pt, 간격은 pt.
export function blockStyle(b, settings) {
  const s = settings;
  const body = s.size;
  const f = s.fonts;
  switch (b.type) {
    case 'heading':
      if (b.level === 1) return { font: f.head, size: body + 2, prev: 18, next: 6, keepNext: true };
      if (b.level === 2) return { font: f.head, size: body, prev: 12, next: 3, keepNext: true };
      return { font: f.sub, size: body, prev: 8, next: 2, keepNext: true, bold: true };
    case 'item':
      return [
        null,
        { font: f.head, size: body, prev: 10 },
        { font: f.body, size: body, prev: 6 },
        { font: f.body, size: body, prev: 3 },
        { font: f.body, size: body - 1, prev: 2 },
      ][Math.min(b.level, 4)];
    case 'para':
      return { font: f.body, size: body, prev: 6 };
    case 'note':
      return { font: f.sub, size: body - 2, prev: 3 };
    case 'box':
      return { font: f.sub, size: body - 1, prev: 8 };
    case 'table':
      return { font: f.body, size: body - 2, prev: 6 };
    default:
      return { font: f.body, size: body, prev: 0 };
  }
}

// 왼쪽 들여쓰기(본문 글자 수). 항목은 수준마다 settings.indent 글자씩, 문단·주석은 앞 항목의 내용 위치에 맞춘다.
export function blockIndent(b, settings) {
  const step = Number(settings.indent ?? 1);
  if (b.type === 'item') return (b.level - 1) * step;
  if (b.type === 'para' || b.type === 'note' || b.type === 'table') return b.level ? contentIndent(b.level, settings) : 0;
  return 0;
}

// 전각 문자는 1자, 반각 문자는 0.5자로 센 폭
export function symbolWidth(s) {
  let w = 0;
  for (const ch of s) w += /[\u0000-ÿ‐-‧]/.test(ch) ? 0.5 : 1;
  return w;
}

// 수준 level 항목의 내용(기호 다음 글자)이 시작하는 위치
export function contentIndent(level, settings) {
  const step = Number(settings.indent ?? 1);
  return (level - 1) * step + symbolWidth(itemSymbol(level, settings.symbols)) + 0.5;
}

// '**굵게**', '<u>밑줄</u>'을 조각으로 나눈다. 반환: [{ text, bold, underline }]
export function parseInline(text) {
  const out = [];
  const re = /\*\*(.+?)\*\*|<u>(.+?)<\/u>/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ text: m[1], bold: true });
    else out.push({ text: m[2], underline: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text: '' }];
}

export function stripInline(text) {
  return parseInline(text).map((p) => p.text).join('');
}

// 기본 머리말: ('26. 10. 8., 보고서 제목, 부서명)
export function defaultHeader(meta) {
  const m = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?$/.exec((meta.date || '').trim());
  const d = m ? `'${m[1].slice(2)}. ${Number(m[2])}. ${Number(m[3])}.` : meta.date;
  const parts = [d, stripInline(meta.title || ''), meta.dept].map((x) => (x || '').trim()).filter(Boolean);
  return parts.length ? `(${parts.join(', ')})` : '';
}

// 같은 상위 항목 아래 항목이 하나뿐인 곳 (장·절 제목에서 묶음을 새로 시작한다)
export function singleItemGroups(blocks) {
  const groups = [];
  const open = [null, null, null, null, null, null];
  const close = (from) => { for (let l = from; l < open.length; l++) open[l] = null; };
  for (const b of blocks) {
    if (b.type === 'heading' || b.type === 'pagebreak') { close(1); continue; }
    if (b.type !== 'item') continue;
    const lv = Math.min(b.level, 5);
    close(lv + 1);
    if (!open[lv]) { open[lv] = []; groups.push({ level: lv, ids: open[lv] }); }
    open[lv].push(b.id);
  }
  return groups.filter((g) => g.ids.length === 1);
}

// 목차 항목 (장·절)
export function tocEntries(blocks) {
  const markers = computeHeadingMarkers(blocks);
  return blocks.filter((b) => b.type === 'heading' && b.level <= 2).map((b) => ({ level: b.level, marker: markers.get(b.id), text: stripInline(b.text) }));
}

export function normalizeReport(raw) {
  const base = blankReport();
  if (!raw || typeof raw !== 'object') return base;
  const doc = {
    ...base,
    meta: { ...base.meta, ...(raw.meta || {}) },
    settings: { ...base.settings, ...(raw.settings || {}), fonts: { ...base.settings.fonts, ...(raw.settings?.fonts || {}) }, margins: { ...base.settings.margins, ...(raw.settings?.margins || {}) } },
  };
  const str = (v) => String(v ?? '');
  doc.blocks = (Array.isArray(raw.blocks) ? raw.blocks : []).map((b) => {
    const level = Math.max(0, Math.min(5, Number(b?.level) || 0));
    switch (b?.type) {
      case 'heading': return { id: b.id || uid(), type: 'heading', level: Math.max(1, Math.min(3, level || 1)), text: str(b.text) };
      case 'item': return { id: b.id || uid(), type: 'item', level: Math.max(1, level || 1), text: str(b.text) };
      case 'para': case 'note': return { id: b.id || uid(), type: b.type, level, text: str(b.text) };
      case 'box': return { id: b.id || uid(), type: 'box', title: str(b.title), lines: (b.lines || []).map(str) };
      case 'table': return { id: b.id || uid(), type: 'table', rows: (b.rows || [['']]).map((r) => r.map(str)), caption: str(b.caption), unit: str(b.unit), level, header: b.header !== false };
      case 'pagebreak': return { id: b.id || uid(), type: 'pagebreak' };
      default: return null;
    }
  }).filter(Boolean);
  return doc;
}

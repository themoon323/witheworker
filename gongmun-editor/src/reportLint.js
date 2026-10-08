// 보고서·제안서 검사: 공문과 같은 표기 검사(날짜·시각·금액·쌍점·순화어)에
// 공공보고서 작성 기준의 문장·구성 규칙을 더한다.
import { checkText } from './lint.js';
import { singleItemGroups, stripInline, computeHeadingMarkers, itemSymbol } from './report.js';

export function reportTextFields(doc) {
  const out = [
    { loc: { kind: 'meta', field: 'title' }, text: doc.meta.title },
    { loc: { kind: 'meta', field: 'subtitle' }, text: doc.meta.subtitle },
    { loc: { kind: 'meta', field: 'date' }, text: doc.meta.date },
  ];
  for (const b of doc.blocks) {
    if (b.type === 'heading' || b.type === 'item' || b.type === 'para' || b.type === 'note') out.push({ loc: { kind: 'block', blockId: b.id }, text: b.text });
    else if (b.type === 'box') {
      if (b.title) out.push({ loc: { kind: 'boxTitle', blockId: b.id }, text: b.title });
      b.lines.forEach((t, i) => out.push({ loc: { kind: 'boxLine', blockId: b.id, index: i }, text: t }));
    } else if (b.type === 'table') {
      if (b.caption) out.push({ loc: { kind: 'caption', blockId: b.id }, text: b.caption });
      b.rows.forEach((row, r) => row.forEach((t, c) => out.push({ loc: { kind: 'cell', blockId: b.id, r, c }, text: t })));
    }
  }
  return out;
}

export function getReportText(doc, loc) {
  const b = loc.blockId ? doc.blocks.find((x) => x.id === loc.blockId) : null;
  switch (loc.kind) {
    case 'meta': return doc.meta[loc.field] ?? '';
    case 'block': return b?.text ?? '';
    case 'boxTitle': return b?.title ?? '';
    case 'boxLine': return b?.lines?.[loc.index] ?? '';
    case 'caption': return b?.caption ?? '';
    case 'cell': return b?.rows?.[loc.r]?.[loc.c] ?? '';
    default: return '';
  }
}

export function setReportText(doc, loc, text) {
  const b = loc.blockId ? doc.blocks.find((x) => x.id === loc.blockId) : null;
  switch (loc.kind) {
    case 'meta': doc.meta[loc.field] = text; break;
    case 'block': if (b) b.text = text; break;
    case 'boxTitle': if (b) b.title = text; break;
    case 'boxLine': if (b) b.lines[loc.index] = text; break;
    case 'caption': if (b) b.caption = text; break;
    case 'cell': if (b) b.rows[loc.r][loc.c] = text; break;
    default: break;
  }
}

export function applyReportFix(doc, issue) {
  if (issue.fix?.type !== 'replace') return false;
  const text = getReportText(doc, issue.loc);
  const [s, e] = issue.range;
  if (text.slice(s, e) !== issue.found) return false;
  setReportText(doc, issue.loc, text.slice(0, s) + issue.fix.text + text.slice(e));
  return true;
}

const SYMBOL_PREFIX = /^([□■o○ㅇ◦\-–·∙※])\s+/;

export function lintReport(doc) {
  const issues = [];
  const push = (i) => issues.push(i);
  if (!stripInline(doc.meta.title).trim()) push({ loc: { kind: 'meta', field: 'title' }, severity: 'error', rule: 'required', message: '제목을 입력하십시오. 제목만 보고 전체 내용을 알 수 있게 씁니다.' });
  if (!doc.blocks.some((b) => b.type !== 'pagebreak')) push({ loc: { kind: 'meta', field: 'title' }, severity: 'error', rule: 'required', message: '본문이 비어 있습니다.' });
  if (!doc.meta.date) push({ loc: { kind: 'meta', field: 'date' }, severity: 'info', rule: 'required', message: '작성 날짜를 넣으면 머리말과 제목 아래에 표시됩니다.' });

  for (const f of reportTextFields(doc)) {
    if (!f.text) continue;
    checkText(f.text, f.loc, (i) => { if (i.rule !== 'tone') push(i); });
  }

  for (const b of doc.blocks) {
    if (!('text' in b)) continue;
    const loc = { kind: 'block', blockId: b.id };
    const plain = stripInline(b.text);
    if (!plain.trim() && b.type !== 'para') push({ loc, severity: 'warn', rule: 'empty', message: '내용이 빈 줄입니다.' });
    // 기호를 손으로 한 번 더 쓴 경우
    if (b.type === 'item' || b.type === 'note') {
      const m = SYMBOL_PREFIX.exec(b.text);
      if (m) push({ loc, severity: 'warn', rule: 'double-symbol', message: `'${m[1]}' 기호를 직접 입력했습니다. 기호는 수준에 따라 자동으로 붙습니다.`, range: [0, m[0].length], found: m[0], fix: { type: 'replace', text: '' } });
    }
    // 한 문장은 2~3줄을 넘기지 않는다 (본문 15pt 한 줄은 약 40자)
    for (const sent of plain.split(/(?<=[.?!다음함임됨])\s+/)) {
      if (sent.length > 130) {
        push({ loc, severity: 'info', rule: 'long-sentence', message: `한 문장이 ${sent.length}자입니다. 2~3줄(약 120자) 안으로 나누면 읽기 쉽습니다.` });
        break;
      }
    }
    // 능동형으로
    const pm = /(추진|시행|실시|개최|완료|마련|구축|운영|검토|확정|수립)(되었음|되었다|되었으며|되어짐|되어졌)/.exec(b.text);
    if (pm) {
      // 능동형으로 바꾸려면 주어도 바꿔야 하므로('사업이 추진되었음' → '○○과가 사업을 추진하였음') 자동으로 고치지 않는다.
      push({ loc, severity: 'info', rule: 'passive', message: `'${pm[0]}' → 주체를 밝혀 능동형으로 쓰면 책임 소재가 분명해집니다. 예) '○○과가 …을 ${pm[1]}하였음'`, range: [pm.index, pm.index + pm[0].length], found: pm[0] });
    }
  }

  const symbols = doc.settings.symbols;
  // 장·절 아래 □ 하나는 흔한 구성이므로 o 이하만 짚는다.
  for (const g of singleItemGroups(doc.blocks).filter((x) => x.level >= 2)) {
    push({ loc: { kind: 'block', blockId: g.ids[0] }, severity: 'info', rule: 'single-item', message: `'${itemSymbol(g.level, symbols)}' 항목이 하나뿐입니다. 항목이 하나면 기호를 붙이지 않거나 위 항목에 합칩니다.` });
  }
  // 장 제목이 하나뿐인 경우
  const h1 = doc.blocks.filter((b) => b.type === 'heading' && b.level === 1);
  if (h1.length === 1) push({ loc: { kind: 'block', blockId: h1[0].id }, severity: 'info', rule: 'single-item', message: '장(Ⅰ.)이 하나뿐입니다. 장 구분 없이 쓰거나 둘 이상으로 나눕니다.' });

  const order = { error: 0, warn: 1, info: 2 };
  issues.forEach((it, i) => { it.id = `r${i}`; });
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}

// 사람이 읽을 위치 설명 (명령줄·편집기 공용)
export function reportWhere(doc, loc) {
  const hm = computeHeadingMarkers(doc.blocks);
  if (loc.kind === 'meta') return { title: '제목', subtitle: '부제', date: '날짜' }[loc.field] || '머리 정보';
  const idx = doc.blocks.findIndex((b) => b.id === loc.blockId);
  let chapter = '';
  for (let i = idx; i >= 0; i--) {
    const b = doc.blocks[i];
    if (b.type === 'heading') { chapter = `${hm.get(b.id)} ${stripInline(b.text).slice(0, 14)}`; break; }
  }
  const b = doc.blocks[idx];
  const kind = { heading: '제목', item: `${itemSymbol(b?.level || 1, doc.settings.symbols)} 항목`, para: '문단', note: '※ 주석', box: '참고 박스', table: '표' }[b?.type] || '본문';
  const cell = loc.kind === 'cell' ? ` ${loc.r + 1}행 ${loc.c + 1}열` : '';
  return `${chapter ? `${chapter} › ` : ''}${kind}${cell} (${idx + 1}번째 줄)`;
}

// 공문서 검사기: 행정업무운영 편람의 작성 기준에 맞는지 점검하고 고칠 말을 제안한다.
import { isValidDate, formatDate, weekdayOf, formatAmount, to24Hour, formatTime, withCommas } from './format.js';
import { parseMarker, siblingGroups, LEVEL_NAMES } from './numbering.js';
import { findGlossaryTerms } from './glossary.js';

// 심각도: error(필수 요소 누락·명백한 오류), warn(표기 기준 위반), info(권장)

// 문서 안에서 검사할 텍스트 위치를 모두 나열한다.
export function textFields(doc) {
  const out = [
    { loc: { kind: 'title' }, text: doc.title },
    { loc: { kind: 'recipient' }, text: doc.recipient.to },
  ];
  if (doc.recipient.via) out.push({ loc: { kind: 'via' }, text: doc.recipient.via });
  for (const b of doc.blocks) {
    if (b.type === 'item') out.push({ loc: { kind: 'block', blockId: b.id }, text: b.text });
    else b.rows.forEach((row, r) => row.forEach((cell, c) => out.push({ loc: { kind: 'cell', blockId: b.id, r, c }, text: cell })));
  }
  doc.attachments.forEach((a, i) => out.push({ loc: { kind: 'attachment', index: i }, text: a }));
  return out;
}

export function locKey(loc) {
  switch (loc.kind) {
    case 'block': return `block:${loc.blockId}`;
    case 'cell': return `cell:${loc.blockId}:${loc.r}:${loc.c}`;
    case 'attachment': return `attachment:${loc.index}`;
    case 'meta': return `meta:${loc.field}`;
    default: return loc.kind;
  }
}

export function getText(doc, loc) {
  switch (loc.kind) {
    case 'title': return doc.title;
    case 'recipient': return doc.recipient.to;
    case 'via': return doc.recipient.via;
    case 'block': return doc.blocks.find((b) => b.id === loc.blockId)?.text ?? '';
    case 'cell': return doc.blocks.find((b) => b.id === loc.blockId)?.rows?.[loc.r]?.[loc.c] ?? '';
    case 'attachment': return doc.attachments[loc.index] ?? '';
    default: return '';
  }
}

export function setText(doc, loc, text) {
  switch (loc.kind) {
    case 'title': doc.title = text; break;
    case 'recipient': doc.recipient.to = text; break;
    case 'via': doc.recipient.via = text; break;
    case 'block': { const b = doc.blocks.find((x) => x.id === loc.blockId); if (b) b.text = text; break; }
    case 'cell': { const b = doc.blocks.find((x) => x.id === loc.blockId); if (b) b.rows[loc.r][loc.c] = text; break; }
    case 'attachment': doc.attachments[loc.index] = text; break;
    default: break;
  }
}

// 고치기 적용. 성공하면 true
export function applyFix(doc, issue) {
  const fix = issue.fix;
  if (!fix) return false;
  if (fix.type === 'replace') {
    const text = getText(doc, issue.loc);
    const [s, e] = issue.range;
    if (text.slice(s, e) !== issue.found) return false;
    setText(doc, issue.loc, text.slice(0, s) + fix.text + text.slice(e));
    return true;
  }
  if (fix.type === 'setLevel') {
    const b = doc.blocks.find((x) => x.id === issue.loc.blockId);
    if (!b) return false;
    b.level = fix.level;
    if (fix.stripPrefix) b.text = b.text.slice(fix.stripPrefix);
    return true;
  }
  if (fix.type === 'set') {
    fix.apply(doc);
    return true;
  }
  return false;
}

const DATE_RE = /(\d{4})\s*(년|[.\-/])\s*(\d{1,2})\s*(?:월|[.\-/])\s*(\d{1,2})(?:\s*일|\.)?/g;
const MONTH_RE = /(\d{4})\s*년\s*(\d{1,2})\s*월(?!\s*\d)/g;
const SHORT_DATE_RE = /(?<![\d.])(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;
const WEEKDAY_RE = /(\d{4})\. (\d{1,2})\. (\d{1,2})\.\s*\(([일월화수목금토])\)/g;
const MERIDIEM_TIME_RE = /(오전|오후)\s*(\d{1,2})\s*시(?!간)(?:\s*(\d{1,2})\s*분|\s*(반))?/g;
const TIME_RE = /(?<![\d:])(\d{1,2})\s*시(?!간)(?:\s*(\d{1,2})\s*분|\s*(반))?(?=[\s,.~부까에]|$)/g;
const AMOUNT_RE = /(금\s*)?(\d{1,3}(?:,\d{3})+|\d{4,})\s*원(?!\s*\(\s*금)/g;

function overlaps(ranges, s, e) {
  return ranges.some(([a, b]) => s < b && e > a);
}

export function checkText(text, loc, push) {
  if (!text) return;
  const taken = [];
  const add = (issue) => {
    taken.push(issue.range);
    push({ loc, ...issue });
  };

  // 날짜: 2026. 10. 7.
  for (const m of text.matchAll(DATE_RE)) {
    const [whole, ys, sep, ms, ds] = m;
    if (sep !== '년' && sep !== '.' && sep !== '-' && sep !== '/') continue;
    const y = Number(ys), mo = Number(ms), d = Number(ds);
    const s = m.index, e = s + whole.length;
    if (y < 1900 || y > 2199) continue;
    if (!isValidDate(y, mo, d)) {
      add({ severity: 'error', rule: 'date-invalid', message: `존재하지 않는 날짜입니다: ${whole.trim()}`, range: [s, e], found: whole });
      continue;
    }
    const canon = formatDate(y, mo, d);
    if (whole !== canon) {
      add({ severity: 'warn', rule: 'date-format', message: `날짜는 '${canon}'처럼 숫자와 온점으로 표기합니다.`, range: [s, e], found: whole, fix: { type: 'replace', text: canon } });
    } else {
      taken.push([s, e]);
    }
  }
  for (const m of text.matchAll(MONTH_RE)) {
    const s = m.index, e = s + m[0].length;
    if (overlaps(taken, s, e)) continue;
    const canon = `${Number(m[1])}. ${Number(m[2])}.`;
    add({ severity: 'warn', rule: 'date-format', message: `연·월은 '${canon}'처럼 표기합니다.`, range: [s, e], found: m[0], fix: { type: 'replace', text: canon } });
  }
  for (const m of text.matchAll(SHORT_DATE_RE)) {
    const s = m.index, e = s + m[0].length;
    if (overlaps(taken, s, e)) continue;
    const canon = `${Number(m[1])}. ${Number(m[2])}.`;
    add({ severity: 'info', rule: 'date-format', message: `월·일은 '${canon}'처럼 표기합니다. 연도가 분명하지 않으면 연도도 적습니다.`, range: [s, e], found: m[0], fix: { type: 'replace', text: canon } });
  }
  // 요일 확인
  for (const m of text.matchAll(WEEKDAY_RE)) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (!isValidDate(y, mo, d)) continue;
    const real = weekdayOf(y, mo, d);
    if (real !== m[4]) {
      const wd = m[0].lastIndexOf('(');
      const s = m.index + wd, e = m.index + m[0].length;
      push({ loc, severity: 'error', rule: 'weekday', message: `${formatDate(y, mo, d)}은 ${real}요일입니다.`, range: [s, e], found: m[0].slice(wd), fix: { type: 'replace', text: `(${real})` } });
    }
  }

  // 시간: 24시각제, 쌍점
  for (const m of text.matchAll(MERIDIEM_TIME_RE)) {
    const h = Number(m[2]);
    if (h < 1 || h > 12) continue;
    const min = m[4] ? 30 : Number(m[3] || 0);
    const s = m.index, e = s + m[0].length;
    const canon = formatTime(to24Hour(m[1], h), min);
    add({ severity: 'warn', rule: 'time-format', message: `시각은 24시각제로 '${canon}'처럼 표기합니다.`, range: [s, e], found: m[0], fix: { type: 'replace', text: canon } });
  }
  for (const m of text.matchAll(TIME_RE)) {
    const s = m.index, e = s + m[0].length;
    if (overlaps(taken, s, e)) continue;
    const h = Number(m[1]);
    const min = m[3] ? 30 : Number(m[2] || 0);
    if (h > 24 || min > 59) continue;
    const canon = formatTime(h, min);
    add({ severity: 'warn', rule: 'time-format', message: `시각은 시·분 글자 없이 쌍점으로 '${canon}'처럼 표기합니다.`, range: [s, e], found: m[0], fix: { type: 'replace', text: canon } });
  }

  // 금액: 금113,560원(금일십일만삼천오백육십원)
  for (const m of text.matchAll(AMOUNT_RE)) {
    const s = m.index, e = s + m[0].length;
    if (overlaps(taken, s, e)) continue;
    const digits = m[2].replace(/,/g, '');
    if (loc.kind === 'cell') {
      if (!m[2].includes(',') && digits.length >= 4) {
        add({ severity: 'info', rule: 'amount-comma', message: '금액은 세 자리마다 쉼표를 찍습니다.', range: [s, e], found: m[0], fix: { type: 'replace', text: `${m[1] || ''}${withCommas(digits)}원` } });
      }
      continue;
    }
    const canon = formatAmount(digits);
    add({ severity: 'info', rule: 'amount-format', message: `금액은 '${canon}'처럼 한글을 함께 적습니다.`, range: [s, e], found: m[0], fix: { type: 'replace', text: canon } });
  }

  // 쌍점: 앞은 붙이고 뒤는 띄운다. (관련: ○○)
  for (const m of text.matchAll(/([^\s\d:])(\s+):(?!\/\/)/g)) {
    const s = m.index + 1, e = s + m[2].length + 1;
    add({ severity: 'warn', rule: 'colon-space', message: "쌍점(:)은 앞말에 붙여 씁니다. 예) '관련: '", range: [s, e], found: m[2] + ':', fix: { type: 'replace', text: ':' } });
  }
  for (const m of text.matchAll(/([가-힣a-zA-Z)]):(?=[가-힣a-zA-Z(○「])/g)) {
    const s = m.index + 1, e = s + 1;
    add({ severity: 'info', rule: 'colon-space', message: '쌍점(:) 뒤는 한 칸 띄웁니다.', range: [s, e], found: ':', fix: { type: 'replace', text: ': ' } });
  }
  // 물결표: 기간을 나타낼 때 앞뒤를 붙여 쓴다.
  for (const m of text.matchAll(/\s+~\s*|\s*~\s+/g)) {
    const s = m.index, e = s + m[0].length;
    add({ severity: 'warn', rule: 'tilde-space', message: '기간을 나타내는 물결표(~)는 앞뒤를 붙여 씁니다.', range: [s, e], found: m[0], fix: { type: 'replace', text: '~' } });
  }
  // 겹친 띄어쓰기
  for (const m of text.matchAll(/(?<=\S) {2,}(?=\S)/g)) {
    const s = m.index, e = s + m[0].length;
    add({ severity: 'info', rule: 'double-space', message: '띄어쓰기가 두 칸 이상입니다.', range: [s, e], found: m[0], fix: { type: 'replace', text: ' ' } });
  }
  // 명령조
  for (const m of text.matchAll(/(할 것|하기 바람|요망함?)\.?$/g)) {
    const s = m.index, e = s + m[0].length;
    if (overlaps(taken, s, e)) continue;
    add({ severity: 'info', rule: 'tone', message: "명령조보다 '~하시기 바랍니다', '~하여 주시기 바랍니다'처럼 정중하게 씁니다.", range: [s, e], found: m[0] });
  }
  // 행정용어 순화
  for (const hit of findGlossaryTerms(text)) {
    if (overlaps(taken, hit.start, hit.end)) continue;
    add({
      severity: hit.info ? 'info' : 'warn', rule: 'plain-language',
      message: `'${hit.found}' → '${hit.to.join("', '")}'(으)로 순화하여 쓸 수 있습니다.`,
      range: [hit.start, hit.end], found: hit.found, fix: { type: 'replace', text: hit.replacement },
    });
  }
}

export function lintDoc(doc) {
  const issues = [];
  const push = (i) => issues.push(i);
  const internal = doc.kind === 'internal';

  // 필수 요소
  if (!doc.title.trim()) push({ loc: { kind: 'title' }, severity: 'error', rule: 'required', message: '제목을 입력하십시오.' });
  if (!internal && !doc.org.name.trim()) push({ loc: { kind: 'meta', field: 'org.name' }, severity: 'error', rule: 'required', message: '행정기관명을 입력하십시오.' });
  if (!doc.recipient.to.trim()) {
    push({ loc: { kind: 'recipient' }, severity: 'error', rule: 'required', message: internal ? "내부결재 문서는 수신란에 '내부결재'라고 적습니다." : '수신자를 입력하십시오.' });
  } else if (!internal) {
    const to = doc.recipient.to.trim();
    if (to !== '수신자 참조' && /[,，、]/.test(to)) {
      push({ loc: { kind: 'recipient' }, severity: 'warn', rule: 'recipients', message: "수신자가 둘 이상이면 수신란에 '수신자 참조'라고 적고, 결문의 수신자란에 수신자를 모두 적습니다.",
        fix: { type: 'set', apply: (d) => { d.recipient.list = to.split(/\s*[,，、]\s*/).filter(Boolean); d.recipient.to = '수신자 참조'; } } });
    }
    if (to === '수신자 참조' && !doc.recipient.list.some((x) => x.trim())) {
      push({ loc: { kind: 'meta', field: 'recipient.list' }, severity: 'error', rule: 'recipients', message: "'수신자 참조'로 적었으면 결문의 수신자 목록을 입력하십시오." });
    }
  }
  if (internal && doc.recipient.to.trim() && doc.recipient.to.trim() !== '내부결재') {
    push({ loc: { kind: 'recipient' }, severity: 'warn', rule: 'recipients', message: "내부결재 문서의 수신란에는 '내부결재'라고 적습니다.", fix: { type: 'set', apply: (d) => { d.recipient.to = '내부결재'; } } });
  }
  if (!internal && !doc.sender.name.trim()) push({ loc: { kind: 'meta', field: 'sender.name' }, severity: 'error', rule: 'required', message: '발신명의(예: ○○시장)를 입력하십시오.' });
  if (!doc.enforce.dept.trim()) push({ loc: { kind: 'meta', field: 'enforce.dept' }, severity: 'warn', rule: 'required', message: '생산등록번호의 처리과명을 입력하십시오.' });
  if (!internal && !doc.contact.phone.trim()) push({ loc: { kind: 'meta', field: 'contact.phone' }, severity: 'warn', rule: 'required', message: '전화번호를 입력하십시오.' });
  if (!internal && !doc.contact.address.trim()) push({ loc: { kind: 'meta', field: 'contact.address' }, severity: 'info', rule: 'required', message: '우편번호와 도로명주소를 입력하십시오.' });
  if (doc.contact.disclosure !== '공개' && !doc.contact.disclosureReason) {
    push({ loc: { kind: 'meta', field: 'contact.disclosure' }, severity: 'warn', rule: 'disclosure', message: `${doc.contact.disclosure}일 때는 정보공개법 제9조제1항의 해당 호를 표시합니다.` });
  }
  if (!doc.approval.drafter.title.trim()) push({ loc: { kind: 'meta', field: 'approval' }, severity: 'warn', rule: 'required', message: '기안자의 직위(직급)를 입력하십시오.' });
  if (!doc.approval.approver.title.trim()) push({ loc: { kind: 'meta', field: 'approval' }, severity: 'warn', rule: 'required', message: '결재권자의 직위(직급)를 입력하십시오.' });

  // 본문
  const items = doc.blocks.filter((b) => b.type === 'item');
  if (!items.some((b) => b.text.trim()) && !doc.blocks.some((b) => b.type === 'table')) {
    push({ loc: { kind: 'block', blockId: doc.blocks[0]?.id }, severity: 'error', rule: 'required', message: '본문을 입력하십시오.' });
  }
  for (const b of items) {
    const pm = parseMarker(b.text);
    if (!pm) continue;
    const prefixLen = b.text.length - pm.text.length;
    if (!b.level) {
      push({ loc: { kind: 'block', blockId: b.id }, severity: 'warn', rule: 'manual-marker', message: `항목 기호 '${pm.marker}'를 직접 입력했습니다. 자동 번호 항목(${LEVEL_NAMES[pm.level]})으로 바꾸면 번호와 들여쓰기가 자동으로 맞춰집니다.`,
        range: [0, prefixLen], found: b.text.slice(0, prefixLen), fix: { type: 'setLevel', level: pm.level, stripPrefix: prefixLen } });
    } else {
      push({ loc: { kind: 'block', blockId: b.id }, severity: 'warn', rule: 'manual-marker', message: '항목 기호가 겹쳐 있습니다. 직접 입력한 기호를 지웁니다.',
        range: [0, prefixLen], found: b.text.slice(0, prefixLen), fix: { type: 'replace', text: '' } });
    }
  }
  for (const g of siblingGroups(doc.blocks)) {
    if (g.ids.length !== 1) continue;
    const id = g.ids[0];
    push({ loc: { kind: 'block', blockId: id }, severity: 'info', rule: 'single-item', message: '하나의 항목만 있으면 항목 기호를 붙이지 않습니다.',
      fix: g.level === 1 ? { type: 'setLevel', level: 0 } : undefined });
  }
  for (let i = 0; i < doc.attachments.length; i++) {
    const a = doc.attachments[i].trim();
    if (!a) continue;
    if (!/(\d+\s*(부|매|권|개|건|점|장|식|책|철)|사본)\.?$/.test(a)) {
      push({ loc: { kind: 'attachment', index: i }, severity: 'warn', rule: 'attachment-qty', message: "붙임에는 첨부물의 명칭과 수량을 적습니다. 예) '○○ 계획서 1부.'" });
    }
  }

  for (const f of textFields(doc)) checkText(f.text, f.loc, push);

  const order = { error: 0, warn: 1, info: 2 };
  issues.forEach((it, i) => { it.id = `i${i}`; });
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { amountToHangul, formatAmount, formatDate, formatDateWithWeekday, to24Hour, formatTime } from '../src/format.js';
import { markerFor, computeMarkers, parseMarker, hangulSeq, siblingGroups } from '../src/numbering.js';
import { lintDoc, applyFix } from '../src/lint.js';
import { blankDoc, item, table, normalizeDoc, TEMPLATES } from '../src/model.js';
import { parsePlainDocument } from '../src/importText.js';
import { endMark, attachmentLines, footerInfo } from '../src/layout.js';
import { findGlossaryTerms } from '../src/glossary.js';
import { crc32 } from '../src/zip.js';

test('금액 한글 표기 (편람 예시)', () => {
  assert.equal(amountToHangul(113560), '일십일만삼천오백육십');
  assert.equal(formatAmount('113,560'), '금113,560원(금일십일만삼천오백육십원)');
  assert.equal(amountToHangul(3000000), '삼백만');
  assert.equal(amountToHangul(100000000), '일억');
  assert.equal(amountToHangul(1200034005), '일십이억삼만사천오');
  assert.equal(amountToHangul(0), '영');
});

test('날짜·시간 표기', () => {
  assert.equal(formatDate(2026, 10, 7), '2026. 10. 7.');
  assert.equal(formatDateWithWeekday(2026, 10, 7), '2026. 10. 7.(수)');
  assert.equal(formatTime(to24Hour('오후', 3), 20), '15:20');
  assert.equal(formatTime(to24Hour('오전', 12), 0), '0:00');
  assert.equal(formatTime(to24Hour('오후', 12), 30), '12:30');
});

test('항목 기호 8단계', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((l) => markerFor(l, 1)), ['1.', '가.', '1)', '가)', '(1)', '(가)', '①', '㉮']);
  assert.equal(markerFor(2, 14), '하.');
  assert.equal(markerFor(2, 15), '거.');
  assert.equal(markerFor(7, 21), '㉑');
  assert.equal(markerFor(8, 3), '㉰');
  assert.equal(hangulSeq(29), '고');
});

test('하위 항목 번호는 상위 항목이 바뀌면 다시 시작', () => {
  const blocks = [item(1, 'a'), item(2, 'b'), item(2, 'c'), item(1, 'd'), item(2, 'e'), item(3, 'f')];
  const m = computeMarkers(blocks);
  assert.deepEqual(blocks.map((b) => m.get(b.id)), ['1.', '가.', '나.', '2.', '가.', '1)']);
  const groups = siblingGroups(blocks);
  assert.deepEqual(groups.map((g) => g.ids.length), [2, 2, 1, 1]);
});

test('항목 기호 읽기', () => {
  assert.deepEqual(parseMarker('1. 관련: 총무과-123'), { level: 1, marker: '1', text: '관련: 총무과-123' });
  assert.equal(parseMarker('  가. 일시')?.level, 2);
  assert.equal(parseMarker('1) 기간')?.level, 3);
  assert.equal(parseMarker('나) 대상')?.level, 4);
  assert.equal(parseMarker('(2) 내용')?.level, 5);
  assert.equal(parseMarker('(다) 내용')?.level, 6);
  assert.equal(parseMarker('② 내용')?.level, 7);
  assert.equal(parseMarker('㉯ 내용')?.level, 8);
  assert.equal(parseMarker('2026. 10. 7. 회의'), null);
  assert.equal(parseMarker('1.5배 증가'), null);
  assert.equal(parseMarker('각) 내용'), null);
});

function lintOne(text) {
  const doc = blankDoc();
  doc.title = '제목';
  doc.recipient.to = '○○시장';
  doc.blocks = [item(0, text)];
  return lintDoc(doc).filter((i) => i.loc.kind === 'block');
}

function fixAll(text, rule) {
  const doc = blankDoc();
  doc.blocks = [item(0, text)];
  // 뒤에서부터 고쳐야 앞 범위가 어긋나지 않는다.
  const issues = lintDoc(doc).filter((i) => i.rule === rule && i.loc.kind === 'block').sort((a, b) => b.range[0] - a.range[0]);
  for (const i of issues) applyFix(doc, i);
  return doc.blocks[0].text;
}

test('검사: 날짜 표기', () => {
  assert.equal(fixAll('2026년 10월 7일까지 제출', 'date-format'), '2026. 10. 7.까지 제출');
  assert.equal(fixAll('기한 2026.10.07 18:00', 'date-format'), '기한 2026. 10. 7. 18:00');
  assert.equal(fixAll('기한 2026-10-07', 'date-format'), '기한 2026. 10. 7.');
  assert.equal(lintOne('2026. 10. 7.까지').filter((i) => i.rule.startsWith('date')).length, 0);
  assert.ok(lintOne('2026. 2. 30.').some((i) => i.rule === 'date-invalid'));
  assert.ok(lintOne('전화 044-205-2404').every((i) => !i.rule.startsWith('date')));
});

test('검사: 요일 불일치', () => {
  const issues = lintOne('일시: 2026. 10. 7.(목) 14:00');
  const wd = issues.find((i) => i.rule === 'weekday');
  assert.ok(wd);
  assert.equal(wd.fix.text, '(수)');
});

test('검사: 시각 24시각제', () => {
  assert.equal(fixAll('오후 3시 20분에 개최', 'time-format'), '15:20에 개최');
  assert.equal(fixAll('오전 10시부터', 'time-format'), '10:00부터');
  assert.equal(fixAll('14시 30분까지', 'time-format'), '14:30까지');
  assert.equal(lintOne('3시간 동안').filter((i) => i.rule === 'time-format').length, 0);
});

test('검사: 금액·쌍점·물결표', () => {
  assert.equal(fixAll('예산 113,560원 집행', 'amount-format'), '예산 금113,560원(금일십일만삼천오백육십원) 집행');
  assert.equal(lintOne('금113,560원(금일십일만삼천오백육십원)').filter((i) => i.rule === 'amount-format').length, 0);
  assert.equal(fixAll('관련 : 총무과-123', 'colon-space'), '관련: 총무과-123');
  assert.equal(lintOne('일시: 14:30').filter((i) => i.rule === 'colon-space').length, 0);
  assert.equal(fixAll('2026. 10. 7. ~ 10. 9.', 'tilde-space'), '2026. 10. 7.~10. 9.');
});

test('검사: 순화어', () => {
  assert.equal(fixAll('금번 회의는 익일 개최', 'plain-language'), '이번 회의는 다음 날 개최');
  assert.equal(fixAll('적극 추진토록 하시기 바랍니다.', 'plain-language'), '적극 추진하도록 하시기 바랍니다.');
  assert.equal(findGlossaryTerms('그토록 바라던').length, 0);
  assert.equal(findGlossaryTerms('상기하다').length, 0);
});

test('검사: 직접 입력한 항목 기호를 자동 항목으로', () => {
  const doc = blankDoc();
  doc.blocks = [item(0, '가. 일시: 2026. 10. 7.')];
  const issue = lintDoc(doc).find((i) => i.rule === 'manual-marker');
  applyFix(doc, issue);
  assert.equal(doc.blocks[0].level, 2);
  assert.equal(doc.blocks[0].text, '일시: 2026. 10. 7.');
});

test('검사: 수신자가 여럿이면 수신자 참조', () => {
  const doc = blankDoc();
  doc.title = 't';
  doc.recipient.to = '○○구청장, ○○군수';
  const issue = lintDoc(doc).find((i) => i.rule === 'recipients');
  applyFix(doc, issue);
  assert.equal(doc.recipient.to, '수신자 참조');
  assert.deepEqual(doc.recipient.list, ['○○구청장', '○○군수']);
});

test('끝 표시 위치', () => {
  const doc = blankDoc();
  doc.blocks = [item(1, 'a'), item(1, 'b'), item(1, '')];
  assert.deepEqual(endMark(doc), { kind: 'block', blockId: doc.blocks[1].id });
  const t = table([['구분', '내용'], ['1', 'x'], ['', '']]);
  doc.blocks.push(t);
  assert.deepEqual(endMark(doc), { kind: 'table-blank', blockId: t.id, row: 2 });
  t.rows[2] = ['2', 'y'];
  assert.deepEqual(endMark(doc), { kind: 'table-below', blockId: t.id });
  doc.attachments = ['계획서 1부', ''];
  assert.deepEqual(endMark(doc), { kind: 'attachment', index: 0 });
});

test('붙임 표기와 결문', () => {
  const doc = blankDoc();
  doc.attachments = ['계획서 1부', '서식 1부.'];
  assert.deepEqual(attachmentLines(doc).map((a) => `${a.marker} ${a.text}`), ['1. 계획서 1부.', '2. 서식 1부.']);
  doc.attachments = ['계획서 1부'];
  assert.equal(attachmentLines(doc)[0].marker, '');
  doc.enforce = { dept: '총무과', serial: '1234', date: '2026-10-07' };
  doc.contact.disclosure = '부분공개';
  doc.contact.disclosureReason = '6호(개인정보)';
  const f = footerInfo(doc);
  assert.equal(f.enforce, '총무과-1234 (2026. 10. 7.)');
  assert.equal(f.disclosure, '부분공개(6)');
});

test('붙여넣은 공문 텍스트 구조화', () => {
  const text = [
    '수신  ○○도지사(○○과장)',
    '(경유)',
    '제목  ○○ 자료 제출',
    '',
    '1. 관련: ○○과-123(2026. 9. 1.)',
    '2. 위 호와 관련하여 다음과 같이 제출합니다.',
    '  가. 제출 자료: ○○ 현황',
    '  나. 제출 기한: 2026. 10. 20.',
    '',
    '붙임  1. ○○ 현황 1부.  2. ○○ 서식 1부.  끝.',
  ].join('\n');
  const r = parsePlainDocument(text);
  assert.equal(r.to, '○○도지사(○○과장)');
  assert.equal(r.title, '○○ 자료 제출');
  assert.deepEqual(r.blocks.map((b) => [b.level, b.text]), [
    [1, '관련: ○○과-123(2026. 9. 1.)'],
    [1, '위 호와 관련하여 다음과 같이 제출합니다.'],
    [2, '제출 자료: ○○ 현황'],
    [2, '제출 기한: 2026. 10. 20.'],
  ]);
  assert.deepEqual(r.attachments, ['○○ 현황 1부.', '○○ 서식 1부.']);
  assert.ok(r.endFound);
});

test('본문 끝의 끝. 제거', () => {
  const r = parsePlainDocument('1. 첫째입니다.\n2. 둘째입니다.  끝.');
  assert.equal(r.blocks[1].text, '둘째입니다.');
  assert.ok(r.endFound);
});

test('저장 문서 정규화와 서식', () => {
  const d = normalizeDoc({ title: 'x', blocks: [{ type: 'item', level: 12, text: 'a' }, { type: 'bogus' }] });
  assert.equal(d.blocks.length, 1);
  assert.equal(d.blocks[0].level, 8);
  assert.equal(d.settings.margins.top, 30);
  for (const t of TEMPLATES) {
    const doc = t.make();
    assert.ok(doc.blocks.length > 0, t.id);
    assert.ok(Array.isArray(lintDoc(doc)));
  }
});

test('CRC32', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')).toString(16), 'cbf43926');
});

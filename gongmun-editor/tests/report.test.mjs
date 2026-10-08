import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { markdownToReport } from '../src/markdown.js';
import { computeHeadingMarkers, itemSymbol, parseInline, defaultHeader, contentIndent, reportSettings, singleItemGroups, rblock, normalizeReport } from '../src/report.js';
import { lintReport, applyReportFix } from '../src/reportLint.js';
import { buildReportHwpx, reportHeaderText } from '../src/reportHwpx.js';
import { reportToHtml } from '../src/reportHtml.js';
import { renderedToRaw, shiftBlock, applyTypeCode, nextBlockAfter } from '../src/reportEditor.js';
import { findGlossaryTerms } from '../src/glossary.js';

const kinds = (doc) => doc.blocks.map((b) => (b.type === 'item' || b.type === 'heading' ? `${b.type[0]}${b.level}` : b.type[0]));

test('머리 정보와 제목', () => {
  const { doc } = markdownToReport('---\n제목: 사업 계획\n날짜: 2026. 10. 8.\n부서: 기획과\n표지: 예\n목차: 아니오\n기호: □ ○ - ·\n---\n## 개요\n- 내용');
  assert.equal(doc.meta.title, '사업 계획');
  assert.equal(doc.meta.cover, true);
  assert.equal(doc.meta.toc, false);
  assert.deepEqual(doc.settings.symbols, ['□', '○', '-', '·']);
  assert.equal(defaultHeader(doc.meta), "('26. 10. 8., 사업 계획, 기획과)");
});

test('# 제목이 하나면 문서 제목, ## 장 / ### 절, 손으로 단 번호는 뺀다', () => {
  const { doc } = markdownToReport('# 보고서 제목\n\n## Ⅰ. 개요\n### 1. 배경\n#### 가. 세부\n## 2. 현황');
  assert.equal(doc.meta.title, '보고서 제목');
  assert.deepEqual(kinds(doc), ['h1', 'h2', 'h3', 'h1']);
  assert.deepEqual(doc.blocks.map((b) => b.text), ['개요', '배경', '세부', '현황']);
  const m = computeHeadingMarkers(doc.blocks);
  assert.deepEqual(doc.blocks.map((b) => m.get(b.id)), ['Ⅰ.', '1.', '1)', 'Ⅱ.']);
});

test('# 제목이 여럿이면 장으로 쓴다', () => {
  const { doc } = markdownToReport('# 개요\n- a\n# 현황\n## 세부');
  assert.deepEqual(kinds(doc), ['h1', 'i1', 'h1', 'h2']);
});

test('일반 마크다운 목록: 깊이에 따라 □ o - ·', () => {
  const { doc } = markdownToReport('## 개요\n- 첫째\n  - 둘째\n    - 셋째\n      - 넷째\n- 다시 첫째');
  assert.deepEqual(kinds(doc), ['h1', 'i1', 'i2', 'i3', 'i4', 'i1']);
  assert.deepEqual([1, 2, 3, 4].map((l) => itemSymbol(l, reportSettings().symbols)), ['□', 'o', '-', '·']);
});

test('보고서식 기호를 직접 쓴 문서: 기호를 따른다', () => {
  const { doc } = markdownToReport('□ 추진 배경\n  o 첫째 내용\n   - 세부 내용\n    · 아주 세부\n※ 자료: 통계청\nㅇ 둘째 내용');
  assert.deepEqual(kinds(doc), ['i1', 'i2', 'i3', 'i4', 'n', 'i2']);
  assert.deepEqual(doc.blocks.map((b) => b.text), ['추진 배경', '첫째 내용', '세부 내용', '아주 세부', '자료: 통계청', '둘째 내용']);
});

test('표 제목·단위, 참고 박스, 쪽 나눔, 문단 잇기', () => {
  const md = [
    '첫 줄은', '이어지는 문단입니다.', '',
    '<표 1> 연도별 현황', '(단위: 명)', '| 구분 | 2025 |', '|---|---:|', '| 인구 | 1,000 |', '',
    '> **요청 사항**', '> 결정하여 주시기 바랍니다.', '',
    '<!-- 쪽나눔 -->', '마지막',
  ].join('\n');
  const { doc } = markdownToReport(md);
  assert.deepEqual(kinds(doc), ['p', 't', 'b', 'p', 'p']);
  assert.equal(doc.blocks[0].text, '첫 줄은 이어지는 문단입니다.');
  assert.equal(doc.blocks[1].caption, '<표 1> 연도별 현황');
  assert.equal(doc.blocks[1].unit, '(단위: 명)');
  assert.deepEqual(doc.blocks[1].rows, [['구분', '2025'], ['인구', '1,000']]);
  assert.equal(doc.blocks[2].title, '요청 사항');
  assert.deepEqual(doc.blocks[2].lines, ['결정하여 주시기 바랍니다.']);
  assert.equal(doc.blocks[3].type, 'pagebreak');
});

test('인라인: 굵게·밑줄은 살리고 링크·코드는 글자만', () => {
  const { doc } = markdownToReport('- **핵심** 내용은 <u>밑줄</u>, [누리집](https://x.kr), `코드`');
  assert.equal(doc.blocks[0].text, '**핵심** 내용은 <u>밑줄</u>, 누리집, 코드');
  assert.deepEqual(parseInline(doc.blocks[0].text).map((p) => [p.text, !!p.bold, !!p.underline]), [
    ['핵심', true, false], [' 내용은 ', false, false], ['밑줄', false, true], [', 누리집, 코드', false, false],
  ]);
});

test('들여쓰기: 문단·주석은 앞 항목 내용에 맞춘다', () => {
  const s = reportSettings();
  assert.equal(contentIndent(1, s), 1.5); // □ + 반 칸
  assert.equal(contentIndent(2, s), 2); // 한 칸 들여 o + 반 칸
});

test('검사: 금액 속 금일은 순화 대상이 아니다, 능동형 고치기', () => {
  assert.equal(findGlossaryTerms('금1,200,000,000원(금일십이억원)').length, 0);
  assert.equal(findGlossaryTerms('금일 회의').length, 1);
  const { doc } = markdownToReport('# t\n## 개요\n- 사업이 추진되었음\n  - 하나뿐인 하위 항목\n- 2026년 10월 8일 시행');
  const issues = lintReport(doc);
  const passive = issues.find((i) => i.rule === 'passive');
  assert.equal(passive.found, '추진되었음');
  assert.equal(applyReportFix(doc, passive), false, '주어가 바뀌어야 하므로 자동으로 고치지 않는다');
  const date = issues.find((i) => i.rule === 'date-format');
  assert.ok(applyReportFix(doc, date));
  assert.equal(doc.blocks.at(-1).text, '2026. 10. 8. 시행');
  assert.ok(issues.some((i) => i.rule === 'single-item' && /'o'/.test(i.message)));
  assert.ok(!issues.some((i) => i.rule === 'single-item' && /'□'/.test(i.message)));
  assert.ok(issues.some((i) => i.rule === 'date-format'));
});

test('항목이 하나뿐인 묶음은 장·절에서 새로 센다', () => {
  const blocks = [rblock.heading(1, 'a'), rblock.item(1, 'x'), rblock.item(2, 'y'), rblock.heading(1, 'b'), rblock.item(2, 'z'), rblock.item(2, 'w')];
  assert.deepEqual(singleItemGroups(blocks).map((g) => g.level), [1, 2]);
});

function unzip(bytes) {
  const files = {};
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  while (dv.getUint32(p, true) === 0x04034b50) {
    const size = dv.getUint32(p + 18, true);
    const n = dv.getUint16(p + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + n));
    files[name] = new TextDecoder().decode(bytes.subarray(p + 30 + n, p + 30 + n + size));
    p += 30 + n + size;
  }
  return files;
}

test('보고서 HWPX: 글꼴·머리말·쪽 번호·표지·쪽 나눔·굵게', () => {
  const { doc } = markdownToReport(readFileSync(new URL('./fixtures/sample-proposal.md', import.meta.url), 'utf8'));
  const files = unzip(buildReportHwpx(doc, new Date(2026, 9, 8)));
  const header = files['Contents/header.xml'];
  const sec = files['Contents/section0.xml'];
  for (const [list, el] of [['charProperties', 'charPr'], ['paraProperties', 'paraPr'], ['borderFills', 'borderFill']]) {
    const cnt = Number(new RegExp(`<hh:${list} itemCnt="(\\d+)"`).exec(header)[1]);
    assert.equal(cnt, (header.match(new RegExp(`<hh:${el} id=`, 'g')) || []).length, list);
  }
  // 휴먼명조·HY헤드라인M·HY중고딕이 7개 언어 글꼴 목록 모두에 들어가야 한다.
  for (const face of ['휴먼명조', 'HY헤드라인M', 'HY중고딕']) assert.equal((header.match(new RegExp(`face="${face}"`, 'g')) || []).length, 7, face);
  assert.equal((header.match(/fontCnt="5"/g) || []).length, 7);
  const charIds = new Set([...header.matchAll(/<hh:charPr id="(\d+)"/g)].map((m) => m[1]));
  for (const m of sec.matchAll(/charPrIDRef="(\d+)"/g)) assert.ok(charIds.has(m[1]), m[1]);
  const borderIds = new Set([...header.matchAll(/<hh:borderFill id="(\d+)"/g)].map((m) => m[1]));
  for (const m of sec.matchAll(/borderFillIDRef="(\d+)"/g)) assert.ok(borderIds.has(m[1]), `border ${m[1]}`);
  // 여백 위 15mm(4252)·머리말 10mm(2835), 머리말 글, 쪽 번호, 표지 쪽 감추기
  assert.match(sec, /<hp:margin header="2835" footer="2835" gutter="0" left="5669" right="5669" top="4252" bottom="4252"\/>/);
  assert.match(sec, /<hp:header id="1" applyPageType="BOTH">.*\('26\. 10\. 8\., ○○시 청년 일자리 정책 개선 제안, ○○연구소\)/);
  assert.match(sec, /<hp:autoNum num="1" numType="PAGE">/);
  assert.match(sec, /hideFirstHeader="1" hideFirstFooter="1"/);
  assert.ok((sec.match(/pageBreak="1"/g) || []).length >= 2, '표지·목차 뒤 쪽 나눔');
  assert.match(sec, /<hp:t>□<hp:tab leader="NONE" type="LEFT"\/><\/hp:t>/);
  assert.match(sec, /<hp:t>Ⅱ\.<hp:tab leader="NONE" type="LEFT"\/><\/hp:t>/);
  assert.match(sec, /<hp:tbl [^>]*rowCnt="4" colCnt="4"/);
  assert.match(header, /<hh:bold\/>/);
  assert.match(header, /connect="1"/); // 참고 박스
});

test('보고서 HTML 미리보기와 머리말 끄기', () => {
  const { doc } = markdownToReport('---\n제목: t\n머리말: 없음\n---\n## 개요\n- a\n- b');
  assert.equal(reportHeaderText(doc), '');
  const html = reportToHtml(doc);
  assert.match(html, /Ⅰ\./);
  assert.match(html, /r-page/);
  assert.equal(normalizeReport(JSON.parse(JSON.stringify(doc))).blocks.length, doc.blocks.length);
});

test('편집기: 굵게 표시 위치 변환, 수준 옮기기, 다음 줄 종류', () => {
  const t = '앞 **굵게** 뒤 <u>밑줄</u>';
  // 화면 글: '앞 굵게 뒤 밑줄'
  assert.equal(renderedToRaw(t, 0), 0);
  assert.equal(renderedToRaw(t, 2), 2); // 경계에서는 꾸밈 기호 바깥(앞)에 둔다
  assert.equal(t.slice(renderedToRaw(t, 3)), '게** 뒤 <u>밑줄</u>'); // '굵' 다음
  assert.equal(t.slice(renderedToRaw(t, 5)), '뒤 <u>밑줄</u>');
  assert.equal(t.slice(renderedToRaw(t, 8)), '줄</u>');
  const b = rblock.item(1, 'x');
  shiftBlock(b, 1); assert.equal(b.level, 2);
  shiftBlock(b, -1); shiftBlock(b, -1); assert.deepEqual([b.type, b.level], ['heading', 3]);
  assert.equal(shiftBlock(rblock.heading(1, 'x'), -1), false);
  const n = rblock.item(2, 'x'); applyTypeCode(n, 'n'); assert.deepEqual([n.type, n.level], ['note', 2]);
  assert.deepEqual([nextBlockAfter(rblock.heading(2, 'h'), '').type, nextBlockAfter(rblock.heading(2, 'h'), '').level], ['item', 1]);
});

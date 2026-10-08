import test from 'node:test';
import assert from 'node:assert/strict';
import { itemsToLines, linesToText } from '../src/pdfText.js';
import { parsePlainDocument } from '../src/importText.js';
import { normalizeAiResult, docFromAi, buildUserPrompt, buildSamplePrompt, AI_SCHEMA } from '../src/ai.js';
import { buildHwpx, buildSectionXml } from '../src/hwpx.js';
import { Styles } from '../src/hwpxCore.js';
import { blankDoc, item, table, TEMPLATES } from '../src/model.js';
import { HEADER_XML } from '../src/hwpxTemplate.js';

// PDF 좌표 흉내: 한 줄에 여러 조각, y는 위로 갈수록 크다.
function frag(str, x, y, size = 10) {
  return { str, x, y, w: [...str].reduce((n, ch) => n + (/[\u0000-ÿ]/.test(ch) ? 0.5 : 1), 0) * size, size };
}

test('PDF 조각을 줄로 묶고 띄어쓰기를 살린다', () => {
  const lines = itemsToLines([frag('수신', 50, 700), frag('○○도지사(○○과장)', 90, 700), frag('제목', 50, 684), frag('자료', 90, 684), frag('제출', 113, 684)]);
  assert.deepEqual(lines.map((l) => l.text), ['수신 ○○도지사(○○과장)', '제목 자료 제출']);
});

test('끊긴 줄은 잇고, 항목 기호 줄과 짧은 줄 뒤에서는 문단을 나눈다', () => {
  const W = 400; // 본문 오른쪽 끝
  const full = (s, x, y) => ({ ...frag(s, x, y), w: W - x });
  const page = itemsToLines([
    frag('수신', 50, 800), frag('○○시장', 90, 800),
    frag('제목', 50, 784), frag('○○ 협조 요청', 90, 784),
    full('1. 위 호와 관련하여 우리 시에서는 ○○ 사업을 추진하고 있으며 사업의', 50, 760),
    frag('원활한 추진을 위하여 협조를 요청합니다.', 62, 744),
    frag('가. 기한: 2026. 10. 20.', 60, 728),
    frag('- 1 -', 220, 40),
  ]);
  const text = linesToText([page]);
  assert.equal(text, [
    '수신 ○○시장',
    '제목 ○○ 협조 요청',
    '1. 위 호와 관련하여 우리 시에서는 ○○ 사업을 추진하고 있으며 사업의 원활한 추진을 위하여 협조를 요청합니다.',
    '  가. 기한: 2026. 10. 20.',
  ].join('\n'));
  const parsed = parsePlainDocument(text);
  assert.equal(parsed.to, '○○시장');
  assert.deepEqual(parsed.blocks.map((b) => b.level), [1, 2]);
});

test('공문 전체: 기관명은 빼고, 끝. 뒤의 결문은 본문에 넣지 않는다', () => {
  const r = parsePlainDocument([
    '시민이 행복한 ○○', '○○시', '수신 ○○도지사(○○과장)', '(경유)', '제목 자료 제출',
    '1. 자료를 제출합니다.  끝.', '○○시장', '주무관 홍길동 팀장 김철수', '시행 총무과-1234 (2026. 10. 7.)',
  ].join('\n'));
  assert.equal(r.org, '○○시');
  assert.deepEqual(r.blocks.map((b) => b.text), ['자료를 제출합니다.']);
  assert.ok(r.endFound);
});

test('AI 응답 정규화', () => {
  const r = normalizeAiResult({
    kind: 'external', title: '자료 제출 요청.', recipient: '수신자 참조', recipientList: ['○○구청장', ' ', '○○군수'],
    blocks: [{ level: 1, text: '관련: ○○' }, { level: 3, text: '너무 깊은 항목' }, { level: 9, text: 'x' }, { level: 1, text: '' }, { level: 1, text: '마지막  끝.' }],
    attachments: ['서식 1부'], notes: ['기한 확인'],
  });
  assert.equal(r.title, '자료 제출 요청');
  assert.deepEqual(r.recipientList, ['○○구청장', '○○군수']);
  assert.deepEqual(r.blocks.map((b) => b.level), [1, 2, 3, 1]);
  assert.equal(r.blocks.at(-1).text, '마지막');
  assert.deepEqual(r.attachments, ['서식 1부.']);
  assert.throws(() => normalizeAiResult({ blocks: [] }));
  assert.throws(() => normalizeAiResult('문자열'));
});

test('AI 결과로 문서 만들기: 결문 정보는 이어 쓴다', () => {
  const base = blankDoc();
  base.org.name = '○○군';
  base.contact.phone = '055-000-0000';
  base.enforce.serial = '99';
  const doc = docFromAi(normalizeAiResult({
    kind: 'external', title: 't', recipient: '○○구청장', recipientList: ['a', 'b'],
    blocks: [{ level: 1, text: 'x' }, { level: 1, text: 'y' }], attachments: [], notes: [],
  }), base);
  assert.equal(doc.org.name, '○○군');
  assert.equal(doc.contact.phone, '055-000-0000');
  assert.equal(doc.enforce.serial, '');
  assert.equal(doc.recipient.to, '수신자 참조');
  const internal = docFromAi(normalizeAiResult({ kind: 'internal', title: 't', recipient: '', recipientList: [], blocks: [{ level: 0, text: 'x' }], attachments: [], notes: [] }), base);
  assert.equal(internal.recipient.to, '내부결재');
});

test('AI 프롬프트와 스키마', () => {
  const doc = blankDoc();
  const p = buildUserPrompt({ draft: '회의 메모', purpose: '협조 요청', doc, today: new Date(2026, 9, 7) });
  assert.match(p, /2026\. 10\. 7\.\(수\)/);
  assert.match(p, /<<<\n회의 메모\n>>>/);
  assert.match(buildSamplePrompt({ draft: 'x', doc }), /JSON 객체 하나/);
  // 구조화 출력 스키마: 모든 객체에 additionalProperties: false, required 전부
  const check = (s) => {
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
      Object.values(s.properties).forEach(check);
    }
    if (s.type === 'array') check(s.items);
  };
  check(AI_SCHEMA);
});

function unzipStored(bytes) {
  // zipStore로 만든 무압축 ZIP을 읽는다 (테스트용).
  const files = {};
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const order = [];
  while (dv.getUint32(p, true) === 0x04034b50) {
    const size = dv.getUint32(p + 18, true);
    const nameLen = dv.getUint16(p + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nameLen));
    const start = p + 30 + nameLen;
    files[name] = new TextDecoder().decode(bytes.subarray(start, start + size));
    order.push(name);
    p = start + size;
  }
  return { files, order };
}

test('HWPX 패키지 구성', () => {
  const doc = TEMPLATES.find((t) => t.id === 'internal-plan').make();
  const { files, order } = unzipStored(buildHwpx(doc, new Date(2026, 9, 7)));
  assert.equal(order[0], 'mimetype');
  assert.equal(files.mimetype, 'application/hwp+zip');
  for (const f of ['version.xml', 'Contents/header.xml', 'Contents/section0.xml', 'Contents/content.hpf', 'META-INF/container.xml', 'settings.xml']) assert.ok(files[f], f);
  const header = files['Contents/header.xml'];
  const sec = files['Contents/section0.xml'];
  // 머리 정보의 개수(itemCnt)가 실제 항목 수와 맞아야 한글이 연다.
  for (const [list, el] of [['charProperties', 'charPr'], ['paraProperties', 'paraPr'], ['borderFills', 'borderFill']]) {
    const cnt = Number(new RegExp(`<hh:${list} itemCnt="(\\d+)"`).exec(header)[1]);
    const actual = (header.match(new RegExp(`<hh:${el} id=`, 'g')) || []).length;
    assert.equal(cnt, actual, list);
  }
  // 본문이 참조하는 글자·문단 모양 번호가 모두 머리 정보에 있어야 한다.
  const charIds = new Set([...header.matchAll(/<hh:charPr id="(\d+)"/g)].map((m) => m[1]));
  const paraIds = new Set([...header.matchAll(/<hh:paraPr id="(\d+)"/g)].map((m) => m[1]));
  for (const m of sec.matchAll(/charPrIDRef="(\d+)"/g)) assert.ok(charIds.has(m[1]), `charPr ${m[1]}`);
  for (const m of sec.matchAll(/paraPrIDRef="(\d+)"/g)) assert.ok(paraIds.has(m[1]), `paraPr ${m[1]}`);
  // 여백(위 30mm), 항목 기호와 탭, 표, 끝 표시, 글꼴
  assert.match(sec, /<hp:margin header="0" footer="0" gutter="0" left="5669" right="4252" top="8504" bottom="4252"\/>/);
  assert.match(sec, /<hp:t>1\.<hp:tab leader="NONE" type="LEFT"\/>교육 개요<\/hp:t>/);
  assert.match(sec, /<hp:tbl [^>]*rowCnt="3" colCnt="4"/);
  assert.match(sec, /교육 세부 계획 1부\.  끝\.<\/hp:t>/);
  assert.match(header, /face="바탕"/);
  assert.match(files['Contents/content.hpf'], /<opf:title>2026년 ○○ 교육 운영 계획<\/opf:title>/);
});

test('HWPX: 특수문자 이스케이프와 줄바꿈', () => {
  const doc = blankDoc();
  doc.title = 'A&B <협조>';
  doc.blocks = [item(1, '첫 줄\n둘째 줄'), item(1, 'x'), table([['a', 'b'], ['', '']])];
  doc.blocks[2].rows[1] = ['', ''];
  doc.blocks[2].rows.push(['', '']);
  doc.blocks[2].rows[1][0] = '값';
  const sec = buildSectionXml(doc, new Styles());
  assert.match(sec, /A&amp;B &lt;협조&gt;/);
  assert.match(sec, /첫 줄<hp:lineBreak\/>둘째 줄/);
  assert.match(sec, /이하 빈칸/);
  assert.ok(HEADER_XML.includes('<hh:head'));
});

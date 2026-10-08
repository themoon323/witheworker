// 브라우저 점검 3: 보고서·제안서 모드
// node tests/e2e-report.mjs [결과 저장 폴더]   (먼저 node build.mjs)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch {
  playwright = require(join(execSync('npm root -g').toString().trim(), 'playwright'));
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = process.argv[2] || mkdtempSync(join(tmpdir(), 'gongmun-e2e-report-'));
const url = pathToFileURL(join(root, 'dist/gongmun-editor.html')).href;

function sse(text) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  return ev('message_start', { message: { id: 'msg_t', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } })
    + ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
    + ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } })
    + ev('content_block_stop', { index: 0 })
    + ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } })
    + ev('message_stop', {});
}

const browser = await playwright.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const marks = () => page.$$eval('#body .r-mk', (els) => els.map((e) => e.textContent));
const blockTexts = () => page.$$eval('#body .blk [data-key^="rb:"]', (els) => els.map((e) => e.textContent));
let step = 'start';

try {
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // 1. 처음에는 보고서 모드
  step = 'default report';
  await page.waitForSelector('#sheet.report');
  assert.ok(await page.evaluate(() => document.body.classList.contains('mode-report')));
  assert.equal(await page.$eval('[data-key="r:meta:title"]', (e) => e.textContent), '○○ 추진 현황 보고');
  assert.ok(await page.$eval('#btn-docx', (e) => getComputedStyle(e).display === 'none'), '보고서 모드에서는 DOCX 숨김');
  const firstMarks = await marks();
  assert.equal(firstMarks[0], 'Ⅰ.');
  assert.ok(firstMarks.includes('□') && firstMarks.includes('o'));
  await page.screenshot({ path: join(outDir, 'r1-default.png') });

  // 2. 빈 보고서에서 직접 쓰기: Enter, Tab, Shift+Tab, 종류 바꾸기
  step = 'typing';
  await page.evaluate(() => {
    // 문서를 가볍게: 본문을 한 줄만 남긴다
  });
  await page.click('#btn-new');
  await page.click('[data-template="r-basic"]');
  await page.click('[data-key="r:meta:title"]');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('2026년 청년 일자리 사업 추진 계획');
  // 첫 장 제목으로 가서 본문 끝에 새 줄들
  const lastItem = (await page.$$('#body .r-i2 .r-tx')).at(-1);
  await lastItem.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('2026년 10월 8일 착수 예정');
  await page.keyboard.press('Tab');
  let texts = await blockTexts();
  let ms = await marks();
  const idx = texts.indexOf('2026년 10월 8일 착수 예정');
  assert.ok(idx > 0, texts.join('|'));
  assert.equal((await page.$$eval('#body .blk', (els) => els.map((e) => e.className)))[idx].includes('r-i3'), true, 'Tab → - 항목');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  assert.ok((await page.$$eval('#body .blk', (els) => els.map((e) => e.className)))[idx].includes('r-i1'), 'Shift+Tab 두 번 → □');
  // 종류 고르기: 장 제목
  await page.selectOption('#sel-level', 'h1');
  ms = await marks();
  assert.ok(ms.filter((m) => /^[ⅠⅡⅢⅣⅤ]\./.test(m)).length >= 5, ms.join(' '));
  await page.selectOption('#sel-level', 'i2');

  // 3. 마크다운 붙여넣기
  step = 'paste md';
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '## 추가 장\n- 첫째 항목\n  - 세부 항목\n  - 또 다른 세부\n\n<표 1> 일정\n| 단계 | 기간 |\n|---|---|\n| 착수 | 1개월 |');
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  texts = await blockTexts();
  assert.ok(texts.includes('추가 장') && texts.includes('세부 항목'), texts.join('|'));
  assert.ok(await page.$('#body .r-table [data-key^="rcap:"]'));
  assert.equal(await page.$eval('#body .r-table [data-key^="rcap:"]', (e) => e.textContent), '<표 1> 일정');

  // 4. 박스·쪽 나눔 넣기
  step = 'insert';
  await (await page.$$('#body .r-i1 .r-tx')).at(0).click();
  await page.click('#btn-box');
  await page.keyboard.type('□ 예산 확보가 선행되어야 함');
  assert.ok(await page.$('#body .r-box'));
  await (await page.$$('#body .r-i1 .r-tx')).at(1).click();
  await page.click('#btn-break');
  assert.equal((await page.$$('#body .r-break')).length, 1);

  // 5. 검사: 날짜 표기, 고치기
  step = 'lint';
  await page.waitForTimeout(400);
  const msgs = await page.$$eval('#issues .issue .msg', (els) => els.map((e) => e.textContent));
  assert.ok(msgs.some((m) => /2026\. 10\. 8\./.test(m)), msgs.join('\n'));
  await page.click('#btn-fix-all');
  await page.waitForTimeout(300);
  assert.ok((await blockTexts()).includes('2026. 10. 8. 착수 예정'));

  // 6. 문서 정보: 표지·목차·기호
  step = 'panel';
  await page.click('[data-tab="rinfo"]');
  await page.check('#f-r-cover');
  await page.check('#f-r-toc');
  assert.ok(await page.$('#sheet .r-cover'));
  const toc = await page.$$eval('#sheet .r-toc .r-tx', (els) => els.map((e) => e.textContent));
  assert.ok(toc.includes('추가 장'), toc.join('|'));
  await page.click('[data-symbols="□ ○ - ·"]');
  assert.ok((await marks()).includes('○'));
  await page.fill('#f-r-dept', '청년정책과');
  assert.match(await page.$eval('#sheet .r-header', (e) => e.textContent), /청년정책과/);
  await page.screenshot({ path: join(outDir, 'r2-edited.png'), fullPage: true });

  // 7. 한글(HWPX) 내보내기
  step = 'hwpx';
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-hwpx')]);
  const bytes = readFileSync(await dl.path());
  assert.equal(bytes.subarray(30, 38).toString(), 'mimetype');
  const body = bytes.toString('utf8');
  assert.ok(body.includes('face="HY헤드라인M"') && body.includes('hideFirstHeader="1"') && body.includes('청년정책과'));
  writeFileSync(join(outDir, 'report.hwpx'), bytes);

  // 8. 되돌리기
  step = 'undo';
  await page.click('#btn-undo');
  await page.click('#btn-undo');
  assert.ok(!(await page.$eval('#sheet .r-header', (e) => e.textContent)).includes('청년정책과'));

  // 9. .md 파일 열기
  step = 'open md';
  await page.setInputFiles('#file-open', join(root, 'tests/fixtures/sample-proposal.md'));
  await page.waitForFunction(() => document.querySelector('[data-key="r:meta:title"]')?.textContent === '○○시 청년 일자리 정책 개선 제안');
  assert.ok(await page.$('#sheet .r-cover'));

  // 9-2. 굵게: 편집하지 않을 때는 굵게 보이고, 커서가 들어가면 원문(**)을 편집한다
  step = 'bold';
  const boldKey = await page.$eval('#body [data-rich]', (e) => e.dataset.key);
  const sel = `[data-key="${boldKey}"]`;
  assert.equal(await page.$eval(sel, (e) => e.querySelector('b')?.textContent), '제안 요지');
  await page.click(sel);
  assert.match(await page.$eval(sel, (e) => e.textContent), /^\*\*제안 요지\*\*/);
  await page.click('[data-key="r:meta:title"]');
  assert.equal(await page.$eval(sel, (e) => e.querySelector('b')?.textContent), '제안 요지');
  // Ctrl+B로 선택한 글 굵게
  const plainKey = await page.$$eval('#body .r-i2 [data-key^="rb:"]', (els) => els.find((e) => !e.dataset.rich).dataset.key);
  await page.click(`[data-key="${plainKey}"]`);
  await page.keyboard.press('Home');
  await page.keyboard.down('Shift');
  for (let k = 0; k < 2; k++) await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await page.keyboard.press('Control+b');
  assert.match(await page.$eval(`[data-key="${plainKey}"]`, (e) => e.textContent), /^\*\*..\*\*/);

  // 10. AI로 보고서 작성 (가짜 응답)
  step = 'ai report';
  let seen = null;
  await page.route('https://api.anthropic.com/**', async (route) => {
    seen = JSON.parse(route.request().postData());
    const md = '---\n제목: 청년 정책 원탁회의 결과 보고\n날짜: 2026. 10. 8.\n---\n> **요청 사항**\n> 결과를 참고하여 주시기 바랍니다.\n\n## 회의 개요\n□ 참석: 청년 30명\n## 논의 결과\n□ 주거 지원 확대 요구\n  o 월세 지원 대상 확대\n  o 청년 공공임대 공급';
    await route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'access-control-allow-origin': '*' }, body: sse(JSON.stringify({ markdown: md, notes: ['참석자 수를 확인하십시오.'] })) });
  });
  await page.click('#btn-import');
  assert.equal(await page.$eval('#import-ai', (e) => e.textContent), 'AI로 보고서 작성');
  await page.fill('#import-text', '어제 청년 30명 원탁회의. 주거 얘기 많았음. 월세 지원 대상 넓혀 달라, 공공임대 늘려 달라.');
  await page.selectOption('#ai-purpose', '결과 보고서');
  await page.fill('#ai-key', 'sk-ant-test');
  await page.click('#import-ai');
  await page.waitForSelector('#dlg-notes[open]', { timeout: 30000 });
  assert.match(seen.system, /공공보고서 작성 기준/);
  assert.ok(seen.output_config.format.schema.properties.markdown);
  assert.equal(seen.max_tokens, 32000);
  assert.equal(seen.stream, true);
  assert.match(seen.messages[0].content.at(-1).text, /결과 보고서/);
  await page.click('#dlg-notes button');
  assert.equal(await page.$eval('[data-key="r:meta:title"]', (e) => e.textContent), '청년 정책 원탁회의 결과 보고');
  assert.deepEqual(await marks(), ['Ⅰ.', '□', 'Ⅱ.', '□', 'o', 'o']);
  assert.ok(await page.$('#body .r-box'));
  await page.screenshot({ path: join(outDir, 'r3-ai.png') });

  // 11. 공문으로 바꾸기 → 공문 모드
  step = 'switch to gongmun';
  await page.click('#btn-new');
  await page.click('[data-template="reply"]');
  await page.waitForSelector('#body .blk.item .mk');
  assert.ok(!(await page.evaluate(() => document.body.classList.contains('mode-report'))));
  assert.ok(await page.$eval('#btn-docx', (e) => getComputedStyle(e).display !== 'none'));
  await page.click('#btn-undo');
  await page.waitForSelector('#sheet.report');

  // 12. 좁은 화면
  step = 'mobile';
  await page.setViewportSize({ width: 400, height: 850 });
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `가로 넘침 ${overflow}px`);
  await page.screenshot({ path: join(outDir, 'r4-mobile.png') });

  assert.deepEqual(errors, []);
  console.log(`e2e-report: 모든 점검 통과 (${outDir})`);
} catch (e) {
  console.error(`e2e-report 실패 (${step}):`, e.message);
  console.error('콘솔 오류:', errors);
  await page.screenshot({ path: join(outDir, 'fail.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}

// 브라우저 통합 점검: node tests/e2e.mjs [스크린샷 저장 폴더]
// Playwright가 필요하다 (전역 설치 또는 NODE_PATH로 찾음). 먼저 `node build.mjs`를 실행할 것.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch {
  playwright = require(join(execSync('npm root -g').toString().trim(), 'playwright'));
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const shots = process.argv[2];
const url = pathToFileURL(join(root, 'dist/gongmun-editor.html')).href;

const browser = await playwright.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('#sheet .blk');

const markers = () => page.$$eval('#body .blk.item', (els) => els.map((e) => (e.querySelector('.mk')?.textContent || '') + '|' + e.querySelector('.tx').textContent));
let step = 'initial';
try {
  // 1. 기본 서식(회의 개최 알림)이 열리고 항목 기호가 매겨진다.
  const m0 = await markers();
  assert.ok(m0[0].startsWith('1.|'), m0[0]);
  assert.ok(m0[1].startsWith('가.|'), m0[1]);
  if (shots) await page.screenshot({ path: join(shots, '01-initial.png'), fullPage: false });

  // 2. 새 문서 → 빈 문서
  step = 'new blank';
  await page.click('#btn-new');
  await page.click('[data-template="blank"]');
  await page.click('[data-key="title"]');
  await page.keyboard.type('2026년 하반기 업무 담당자 교육 참석 요청');
  await page.click('[data-key="recipient.to"]');
  await page.keyboard.type('○○구청장, ○○군수');

  // 3. 본문: Enter / Tab으로 항목 구조 만들기
  step = 'outline';
  const first = await page.$('#body .tx');
  await first.click();
  await page.keyboard.type('관련 : 총무과-123(2026년 9월 1일)');
  await page.keyboard.press('Enter');
  await page.keyboard.type('다음과 같이 교육을 실시하오니 참석하여 주시기 바랍니다.');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('일시: 2026. 10. 15.(수) 오후 2시 30분');
  await page.keyboard.press('Enter');
  await page.keyboard.type('장소: ○○교육원');
  await page.keyboard.press('Enter');
  await page.keyboard.type('세부 내용');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('금번 교육은 익일까지 진행');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // 빈 항목에서 Enter → 상위 수준
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.type('교육비 113,560원은 각 기관에서 부담');
  const m1 = await markers();
  // 빈 '2)'에서 Enter → '라.', 다시 Enter → '3.', Shift+Tab → 기호 없는 문단
  assert.deepEqual(m1.map((x) => x.split('|')[0]), ['1.', '2.', '가.', '나.', '다.', '1)', ''], JSON.stringify(m1));

  // 4. 붙임 추가 → '끝.'은 붙임 끝으로
  step = 'attachments';
  await page.click('[data-act="add-att"]');
  await page.keyboard.type('교육 일정표 1부');
  await page.keyboard.press('Enter');
  await page.keyboard.type('참가 신청서');
  const endInAtt = await page.$eval('#atts .tx.is-end', (e) => e.dataset.key);
  assert.equal(endInAtt, 'att:1');

  // 5. 검사 결과
  step = 'lint';
  await page.waitForTimeout(400);
  const rules = await page.$$eval('#issues .issue .msg', (els) => els.map((e) => e.textContent));
  const has = (s) => rules.some((r) => r.includes(s));
  assert.ok(has('수신자 참조'), '수신자 여럿');
  assert.ok(has('쌍점'), '쌍점');
  assert.ok(has('2026. 9. 1.'), '날짜');
  assert.ok(has('15:30') || has('14:30'), '시각');
  assert.ok(has("'금번'"), '순화어');
  assert.ok(has('목') || has('수요일') || has('요일'), '요일');
  assert.ok(has('수량'), '붙임 수량');
  if (shots) await page.screenshot({ path: join(shots, '02-lint.png') });

  // 6. 한꺼번에 고치기
  step = 'fix all';
  await page.click('#btn-fix-all');
  await page.waitForTimeout(400);
  const texts = await markers();
  const joined = texts.join('\n');
  assert.ok(joined.includes('관련: 총무과-123(2026. 9. 1.)'), joined);
  assert.ok(joined.includes('14:30'), joined);
  assert.ok(joined.includes('2026. 10. 15.(목)'), '요일 고침');
  assert.ok(joined.includes('이번 교육은 다음 날까지'), joined);
  const to = await page.$eval('[data-key="recipient.to"]', (e) => e.textContent);
  assert.equal(to, '수신자 참조');
  assert.ok(await page.$('.rcpt-list'), '결문 수신자 목록 표시');

  // 7. 되돌리기
  step = 'undo';
  await page.click('#btn-undo');
  const toAfterUndo = await page.$eval('[data-key="recipient.to"]', (e) => e.textContent);
  assert.equal(toAfterUndo, '○○구청장, ○○군수');
  await page.click('#btn-redo');

  // 8. 여러 줄 붙여넣기 → 자동 구조화
  step = 'paste';
  const lastTx = (await page.$$('#body .tx')).at(-1);
  await lastTx.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    const el = document.activeElement;
    const dt = new DataTransfer();
    dt.setData('text/plain', '4. 기타 사항\n  가. 주차 공간이 부족합니다.\n  나. 대중교통을 이용하여 주시기 바랍니다.');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  const m2 = await markers();
  // 붙여 넣은 '4.'는 자동 번호에 따라 '3.'이 된다.
  assert.ok(m2.some((x) => x.startsWith('3.|기타 사항')), JSON.stringify(m2));
  assert.ok(m2.some((x) => x.startsWith('나.|대중교통')), JSON.stringify(m2));

  // 9. 표 넣기 → 끝 표시는 여전히 붙임에
  step = 'table';
  await page.click('#btn-table');
  await page.keyboard.type('구분');
  assert.ok(await page.$('#body .blk.table'));

  // 10. 결문 정보
  step = 'footer';
  await page.click('[data-tab="footer"]');
  await page.fill('#f-approval\\.drafter\\.name', '홍길동');
  await page.fill('#f-contact\\.phone', '044-000-0000');
  const foot = await page.$eval('#sheet .foot', (e) => e.textContent);
  assert.ok(foot.includes('주무관 홍길동') && foot.includes('044-000-0000'), foot);

  // 11. DOCX 내보내기
  step = 'docx';
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-docx')]);
  // 헤드리스 Chromium은 한글 파일 이름을 'download'로 바꾸므로 이름 대신 내용(ZIP 서명)을 확인한다.
  const docxPath = await dl.path();
  assert.equal(readFileSync(docxPath).subarray(0, 2).toString(), 'PK');
  if (shots) await dl.saveAs(join(shots, 'export.docx'));

  // 12. 자동 저장 후 다시 열기
  step = 'autosave';
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForSelector('#sheet .blk');
  const title = await page.$eval('[data-key="title"]', (e) => e.textContent);
  assert.equal(title, '2026년 하반기 업무 담당자 교육 참석 요청');
  if (shots) {
    await page.screenshot({ path: join(shots, '03-final.png'), fullPage: true });
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: join(shots, 'print.pdf'), format: 'A4', preferCSSPageSize: true });
    await page.emulateMedia({ media: 'screen' });
  }

  // 13. 좁은 화면
  step = 'mobile';
  await page.setViewportSize({ width: 400, height: 850 });
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `가로 넘침 ${overflow}px`);
  if (shots) await page.screenshot({ path: join(shots, '04-mobile.png') });

  assert.deepEqual(errors, []);
  console.log('e2e: 모든 점검 통과');
} catch (e) {
  console.error(`e2e 실패 (${step}):`, e.message);
  console.error('콘솔 오류:', errors);
  if (shots) await page.screenshot({ path: join(shots, 'fail.png'), fullPage: true });
  process.exitCode = 1;
} finally {
  await browser.close();
}

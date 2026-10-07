// 브라우저 점검 2: PDF 불러오기, AI 공문 작성(가짜 응답), HWPX 내보내기, 아티팩트 모드
// node tests/e2e-import.mjs [결과 저장 폴더]   (먼저 node build.mjs)
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
const outDir = process.argv[2] || mkdtempSync(join(tmpdir(), 'gongmun-e2e-'));
const offlineUrl = pathToFileURL(join(root, 'dist/gongmun-editor.html')).href;

const AI_RESULT = {
  kind: 'external',
  title: '2026년 하반기 구·군 담당자 회의 개최 알림',
  recipient: '수신자 참조',
  recipientList: ['○○구청장(○○과장)', '○○군수(○○과장)'],
  blocks: [
    { level: 1, text: '하반기 업무 점검을 위하여 다음과 같이 담당자 회의를 개최하오니 참석하여 주시기 바랍니다.' },
    { level: 2, text: '일시: 2026. 10. 15.(목) 14:00' },
    { level: 2, text: '장소: ○○시청 3층 대회의실' },
    { level: 1, text: '참석자 명단은 2026. 10. 12.(월)까지 전자우편으로 알려 주시기 바랍니다.' },
  ],
  attachments: ['회의 자료 1부'],
  notes: ['참석 대상 기관을 확인하십시오.'],
};

const browser = await playwright.chromium.launch();
const errors = [];
let step = 'start';

async function newPage(ctxOpts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true, ...ctxOpts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${step}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${step}: ${m.text()}`); });
  return page;
}

const markers = (page) => page.$$eval('#body .blk.item', (els) => els.map((e) => (e.querySelector('.mk')?.textContent || '') + '|' + e.querySelector('.tx').textContent));

try {
  // ── 1. 테스트용 PDF 만들기: 편집기의 기본 서식을 A4로 인쇄
  step = 'make pdf';
  const page = await newPage();
  await page.goto(offlineUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#sheet .blk');
  await page.emulateMedia({ media: 'print' });
  const pdfPath = join(outDir, 'source.pdf');
  await page.pdf({ path: pdfPath, format: 'A4', preferCSSPageSize: true });
  await page.emulateMedia({ media: 'screen' });
  const expected = await markers(page);

  // ── 2. PDF 불러오기 → 그대로 구조화
  step = 'pdf import';
  await page.click('#btn-new');
  await page.click('[data-template="blank"]');
  await page.click('#btn-import');
  await page.setInputFiles('#file-pdf', pdfPath);
  await page.waitForFunction(() => /쪽에서 글자를 뽑았습니다/.test(document.querySelector('#pdf-status').textContent), null, { timeout: 30000 });
  const extracted = await page.$eval('#import-text', (e) => e.value);
  writeFileSync(join(outDir, 'extracted.txt'), extracted);
  assert.match(extracted, /제목 2026년 ○○ 업무 담당자 회의 개최 알림/);
  await page.click('#import-plain');
  const title = await page.$eval('[data-key="title"]', (e) => e.textContent);
  assert.equal(title, '2026년 ○○ 업무 담당자 회의 개최 알림');
  const got = await markers(page);
  assert.deepEqual(got, expected, `PDF에서 되살린 항목\n${got.join('\n')}\n기대\n${expected.join('\n')}`);
  const att = await page.$$eval('#atts .att .tx', (els) => els.map((e) => e.textContent));
  assert.deepEqual(att, ['회의 자료 1부.']);

  // ── 3. HWPX 내보내기
  step = 'hwpx';
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-hwpx')]);
  const bytes = readFileSync(await dl.path());
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  assert.equal(bytes.subarray(30, 38).toString(), 'mimetype');
  assert.equal(bytes.subarray(38, 57).toString(), 'application/hwp+zip');
  writeFileSync(join(outDir, 'export.hwpx'), bytes);

  // ── 4. AI 작성 (내려받은 편집기: API 키 + SDK). Anthropic 서버 대신 가짜 응답
  step = 'ai offline';
  let seen = null;
  await page.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    seen = { url: req.url(), headers: req.headers(), body: JSON.parse(req.postData() || '{}') };
    if (req.headers()['x-api-key'] === 'sk-ant-bad') {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: JSON.stringify(AI_RESULT) }], usage: { input_tokens: 10, output_tokens: 10 },
      }),
    });
  });
  await page.click('#btn-import');
  await page.fill('#import-text', '다음 주 목요일 오후 2시 시청 3층 대회의실에서 구군 담당자 회의. 명단은 월요일까지 메일로.');
  await page.selectOption('#ai-purpose', '회의·행사 개최 알림');
  // 키 없이 누르면 안내
  await page.click('#import-ai');
  await page.waitForSelector('#import-error:not([hidden])');
  assert.match(await page.$eval('#import-error', (e) => e.textContent), /API 키를 입력/);
  // 잘못된 키
  await page.fill('#ai-key', 'sk-ant-bad');
  await page.click('#import-ai');
  await page.waitForFunction(() => /API 키가 올바르지 않습니다/.test(document.querySelector('#import-error').textContent), null, { timeout: 30000 });
  // 올바른 키
  await page.fill('#ai-key', 'sk-ant-test');
  await page.click('#import-ai');
  await page.waitForSelector('#dlg-notes[open]', { timeout: 30000 });
  assert.match(seen.url, /\/v1\/messages/);
  assert.equal(seen.headers['x-api-key'], 'sk-ant-test');
  assert.equal(seen.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.match(seen.headers['anthropic-beta'] || '', /server-side-fallback-2026-07-01/);
  assert.equal(seen.body.model, 'claude-opus-5-5');
  assert.equal(seen.body.fallbacks, 'default');
  assert.equal(seen.body.output_config.format.type, 'json_schema');
  assert.equal(seen.body.output_config.effort, 'medium');
  assert.ok(!('betas' in seen.body), 'betas는 헤더로만 가야 한다');
  assert.match(seen.body.messages[0].content.at(-1).text, /회의·행사 개최 알림/);
  assert.match(seen.body.system, /행정업무운영 편람/);
  const notes = await page.$$eval('#notes-list li', (els) => els.map((e) => e.textContent));
  assert.deepEqual(notes, ['참석 대상 기관을 확인하십시오.']);
  await page.click('#dlg-notes button');
  assert.equal(await page.$eval('[data-key="title"]', (e) => e.textContent), AI_RESULT.title);
  assert.deepEqual((await markers(page)).map((x) => x.split('|')[0]), ['1.', '가.', '나.', '2.']);
  assert.equal(await page.$eval('[data-key="recipient.to"]', (e) => e.textContent), '수신자 참조');
  // 되돌리기로 AI 전 문서로
  await page.click('#btn-undo');
  assert.equal(await page.$eval('[data-key="title"]', (e) => e.textContent), '2026년 ○○ 업무 담당자 회의 개최 알림');
  await page.screenshot({ path: join(outDir, 'offline-after-ai.png') });

  // ── 4-2. 스캔 PDF(글자 없는 그림): PDF 파일 자체를 document 블록으로 보낸다
  step = 'scanned pdf';
  const scanPage = await page.context().newPage();
  await scanPage.setContent('<canvas id="c" width="600" height="300"></canvas><script>const x=document.getElementById("c").getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,600,300);x.fillStyle="#000";x.fillRect(40,40,400,20);x.fillRect(40,90,300,20);</script>');
  const scanPdf = join(outDir, 'scanned.pdf');
  await scanPage.pdf({ path: scanPdf, format: 'A4' });
  await scanPage.close();
  await page.click('#btn-import');
  await page.setInputFiles('#file-pdf', scanPdf);
  await page.waitForFunction(() => /스캔 PDF/.test(document.querySelector('#pdf-status').textContent), null, { timeout: 30000 });
  await page.click('#import-ai');
  await page.waitForSelector('#dlg-notes[open]', { timeout: 30000 });
  const doc0 = seen.body.messages[0].content[0];
  assert.equal(doc0.type, 'document');
  assert.equal(doc0.source.media_type, 'application/pdf');
  assert.ok(Buffer.from(doc0.source.data, 'base64').subarray(0, 5).toString() === '%PDF-');
  assert.match(seen.body.messages[0].content[1].text, /함께 보낸 PDF/);
  await page.click('#dlg-notes button');
  await page.context().close();

  // ── 5. 아티팩트 모드: claude.ai 기능(sample, downloads)을 흉내 내고, pdf.js는 CDN 대신 vendor/에서
  step = 'artifact';
  const artifact = readFileSync(join(root, 'dist/artifact.html'), 'utf8');
  const stub = `<script>
    window.__saved = []; window.__prompts = [];
    window.claude = { use: async (name) => {
      if (name === 'downloads') return { save: async (req) => { window.__saved.push({ filename: req.filename, size: req.data.size ?? req.data.length }); return { status: 'saved' }; } };
      if (name === 'sample') {
        const fn = async () => ({ text: '', truncated: false });
        fn.json = async (input, opts) => { window.__prompts.push({ input, images: opts?.images?.length || 0 }); return ${JSON.stringify(AI_RESULT)}; };
        fn.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20000000, mediaTypes: ['image/png'] } });
        return fn;
      }
      return null;
    } };
  </script>`;
  const wrapped = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${stub}${artifact}</body></html>`;
  const artPath = join(outDir, 'artifact-wrapped.html');
  writeFileSync(artPath, wrapped);
  const ap = await newPage();
  await ap.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/*', (route) => {
    const f = route.request().url().split('/').pop();
    route.fulfill({ status: 200, contentType: 'application/javascript', body: readFileSync(join(root, 'vendor', f), 'utf8') });
  });
  await ap.goto(pathToFileURL(artPath).href);
  await ap.waitForSelector('#sheet .blk');
  await ap.waitForFunction(() => !document.querySelector('#btn-hwpx').hidden);
  assert.ok(await ap.$eval('#btn-print', (e) => e.hidden), '아티팩트에서는 인쇄 숨김');
  await ap.click('#btn-hwpx');
  await ap.waitForFunction(() => window.__saved.length === 1);
  const saved = await ap.evaluate(() => window.__saved[0]);
  assert.match(saved.filename, /\.hwpx\.zip$/);
  // PDF → AI(sample)
  await ap.click('#btn-import');
  assert.ok(await ap.$eval('#ai-key', (e) => e.closest('label').hidden), 'API 키 입력 숨김');
  await ap.setInputFiles('#file-pdf', pdfPath);
  await ap.waitForFunction(() => /쪽에서 글자를 뽑았습니다/.test(document.querySelector('#pdf-status').textContent), null, { timeout: 30000 });
  await ap.click('#import-ai');
  await ap.waitForSelector('#dlg-notes[open]');
  const prompt = await ap.evaluate(() => window.__prompts[0]);
  assert.match(prompt.input, /JSON 객체 하나/);
  assert.match(prompt.input, /<<<\n/);
  assert.equal(prompt.images, 0);
  await ap.click('#dlg-notes button');
  assert.equal(await ap.$eval('[data-key="title"]', (e) => e.textContent), AI_RESULT.title);
  await ap.screenshot({ path: join(outDir, 'artifact-after-ai.png') });

  // 좁은 화면에서 대화상자
  await ap.setViewportSize({ width: 400, height: 850 });
  await ap.click('#btn-import');
  const overflow = await ap.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `가로 넘침 ${overflow}px`);
  await ap.screenshot({ path: join(outDir, 'artifact-import-mobile.png') });

  assert.deepEqual(errors.filter((e) => !/Failed to load resource.*401/.test(e)), []);
  console.log(`e2e-import: 모든 점검 통과 (${outDir})`);
} catch (e) {
  console.error(`e2e-import 실패 (${step}):`, e.message);
  console.error('콘솔 오류:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
}

#!/usr/bin/env node
// 마크다운 보고서·제안서를 한글 문서(HWPX)로 바꾼다.
//
//   node scripts/md2hwpx.mjs 보고서.md                 → 보고서.hwpx
//   node scripts/md2hwpx.mjs 보고서.md -o 결과.hwpx --html 미리보기.html --png 미리보기.png
//   node scripts/md2hwpx.mjs 보고서.md --json 문서.json   (편집기에서 열 수 있는 문서 파일)
//   --strict : 검사에서 '오류'가 있으면 파일을 만들지 않는다
//
// 머리 정보와 본문 규칙은 src/markdown.js 맨 위 설명을 본다.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { markdownToReport } from '../src/markdown.js';
import { buildReportHwpx } from '../src/reportHwpx.js';
import { reportToHtml } from '../src/reportHtml.js';
import { lintReport, reportWhere } from '../src/reportLint.js';

const args = process.argv.slice(2);
const opt = { input: null, out: null, html: null, png: null, json: null, strict: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-o' || a === '--out') opt.out = args[++i];
  else if (a === '--html') opt.html = args[++i];
  else if (a === '--png') opt.png = args[++i];
  else if (a === '--json') opt.json = args[++i];
  else if (a === '--strict') opt.strict = true;
  else if (a === '-h' || a === '--help') { console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 10).join('\n')); process.exit(0); }
  else if (!opt.input) opt.input = a;
  else { console.error(`알 수 없는 인자: ${a}`); process.exit(2); }
}
if (!opt.input) { console.error('사용법: node scripts/md2hwpx.mjs 입력.md [-o 출력.hwpx] [--html 파일] [--png 파일] [--json 파일]'); process.exit(2); }

const input = resolve(opt.input);
const out = resolve(opt.out || join(dirname(input), `${basename(input, extname(input))}.hwpx`));
const { doc, warnings } = markdownToReport(readFileSync(input, 'utf8'));
const issues = lintReport(doc);

const counts = { error: 0, warn: 0, info: 0 };
for (const w of warnings) console.log(`[알림] ${w}`);
for (const it of issues) {
  counts[it.severity]++;
  const label = { error: '오류', warn: '표기', info: '권장' }[it.severity];
  const fix = it.fix?.type === 'replace' ? `  ('${it.found}' → '${it.fix.text}')` : '';
  console.log(`[${label}] ${reportWhere(doc, it.loc)}: ${it.message}${fix}`);
}
const heads = doc.blocks.filter((b) => b.type === 'heading').length;
const items = doc.blocks.filter((b) => b.type === 'item').length;
const tables = doc.blocks.filter((b) => b.type === 'table').length;
console.log(`구성: 장·절 ${heads}개, 항목 ${items}개, 표 ${tables}개, 문단 ${doc.blocks.filter((b) => b.type === 'para').length}개`);
console.log(`검사: 오류 ${counts.error}, 표기 ${counts.warn}, 권장 ${counts.info}`);

if (opt.strict && counts.error) { console.error('오류가 있어 파일을 만들지 않았습니다 (--strict).'); process.exit(1); }

writeFileSync(out, buildReportHwpx(doc));
console.log(`한글 문서: ${out}`);
if (opt.json) { writeFileSync(resolve(opt.json), JSON.stringify(doc, null, 2)); console.log(`문서 파일: ${resolve(opt.json)}`); }

if (opt.html || opt.png) {
  const html = reportToHtml(doc);
  const htmlPath = resolve(opt.html || out.replace(/\.hwpx$/, '.preview.html'));
  writeFileSync(htmlPath, html);
  if (opt.html) console.log(`미리보기: ${htmlPath}`);
  if (opt.png) {
    const require = createRequire(import.meta.url);
    let pw;
    try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
    const browser = await pw.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlPath).href);
    await page.screenshot({ path: resolve(opt.png), fullPage: true });
    await browser.close();
    console.log(`미리보기 그림: ${resolve(opt.png)}`);
  }
}

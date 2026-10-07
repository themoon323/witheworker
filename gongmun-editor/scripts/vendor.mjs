// 외부 라이브러리를 vendor/에 준비한다. 결과물은 저장소에 넣어 두므로 빌드에는 인터넷이 필요 없다.
//   vendor/anthropic-sdk.min.js : Claude API 공식 SDK(브라우저용 IIFE, 전역 AnthropicSDK)
//   vendor/pdf.min.js, vendor/pdf.worker.min.js : PDF 글자 추출(pdf.js)
// 실행: npm install && npm run vendor
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, 'vendor');
mkdirSync(out, { recursive: true });

await build({
  stdin: { contents: "export { default as Anthropic } from '@anthropic-ai/sdk';", resolveDir: root, loader: 'js' },
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'AnthropicSDK',
  platform: 'browser',
  target: ['chrome100', 'edge100', 'firefox100', 'safari15'],
  outfile: join(out, 'anthropic-sdk.min.js'),
  legalComments: 'eof',
});

for (const f of ['pdf.min.js', 'pdf.worker.min.js']) {
  copyFileSync(join(root, 'node_modules/pdfjs-dist/build', f), join(out, f));
}
console.log('vendor/ 준비 완료');

// 소스(ES 모듈)를 하나의 HTML 파일로 묶는다. 외부 도구 없이 node만으로 동작한다.
//   dist/gongmun-editor.html : 내려받아 더블클릭으로 여는 오프라인 편집기
//   dist/artifact.html       : 웹 미리보기용(인쇄·파일 내려받기 버튼 숨김)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"];?[ \t]*$/gm;

function modName(file) {
  return `__m_${file.replace(/^.*\/src\//, '').replace(/\.js$/, '').replace(/\W/g, '_')}`;
}

// 의존 순서대로 모듈을 모은다.
function collect(file, seen = new Map(), order = []) {
  if (seen.has(file)) return order;
  seen.set(file, true);
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(IMPORT_RE)) collect(resolve(dirname(file), m[2]), seen, order);
  order.push(file);
  return order;
}

function transform(file) {
  let src = readFileSync(file, 'utf8');
  const exportsList = [];
  src = src.replace(IMPORT_RE, (_, names, from) => {
    const target = modName(resolve(dirname(file), from));
    const binds = names.split(',').map((n) => n.trim()).filter(Boolean).map((n) => n.replace(/\s+as\s+/, ': '));
    return `const { ${binds.join(', ')} } = ${target};`;
  });
  if (/^import\s/m.test(src)) throw new Error(`${file}: 처리하지 못한 import 문이 있습니다.`);
  src = src.replace(/^export\s+(async\s+function\*?|function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm, (_, kw, name) => {
    exportsList.push(name);
    return `${kw} ${name}`;
  });
  if (/^export\s/m.test(src)) throw new Error(`${file}: 처리하지 못한 export 문이 있습니다.`);
  return `const ${modName(file)} = (() => {\n${src}\nreturn { ${exportsList.join(', ')} };\n})();\n`;
}

function bundle() {
  const files = collect(join(root, 'src/app.js'));
  return files.map(transform).join('\n');
}

function build() {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const css = readFileSync(join(root, 'styles.css'), 'utf8');
  // 인라인 스크립트 안에서 '</script'가 나오면 HTML이 끊기므로 막는다.
  const js = bundle().replace(/<\/script/gi, '<\\/script');
  const full = html
    .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}</style>`)
    .replace('<script type="module" src="src/app.js"></script>', () => `<script type="module">\n${js}</script>`);
  if (full.includes('src="src/') || full.includes('href="styles.css"')) throw new Error('index.html 치환에 실패했습니다.');

  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'dist/gongmun-editor.html'), full);

  // 아티팩트(웹 미리보기)는 문서 골격 없이 내용만 둔다.
  const artifact = full
    .replace(/<!doctype html>\s*/i, '')
    .replace(/<html[^>]*>\s*/i, '').replace(/<\/html>\s*/i, '')
    .replace(/<head>\s*/i, '').replace(/<\/head>\s*/i, '')
    .replace(/<meta charset="utf-8">\s*/i, '').replace(/<meta name="viewport"[^>]*>\s*/i, '')
    .replace(/<body>\s*/i, '').replace(/<\/body>\s*/i, '')
    .replace('<script type="module">', '<script>window.GONGMUN_ARTIFACT = true;</script>\n<script type="module">');
  writeFileSync(join(root, 'dist/artifact.html'), artifact);
  console.log(`dist/gongmun-editor.html (${(full.length / 1024).toFixed(1)} KB)`);
  console.log(`dist/artifact.html (${(artifact.length / 1024).toFixed(1)} KB)`);
}

build();

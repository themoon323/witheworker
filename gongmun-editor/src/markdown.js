// 마크다운(.md)을 보고서 모델로 바꾼다.
//
// 머리 정보(선택, 맨 위):
//   ---
//   제목: 2026년 ○○ 사업 추진 계획
//   부제: (선택)
//   날짜: 2026. 10. 8.
//   부서: 정책기획과            (기관·작성도 같은 뜻)
//   머리말: ('26. 10. 8., …)   (생략하면 날짜·제목·부서로 만듦, '없음'이면 넣지 않음)
//   표지: 예                    목차: 예
//   기호: □ o - ·               (항목 기호를 바꿀 때)
//   ---
//
// 본문 규칙:
//   # 제목(문서에 하나뿐일 때) / ## 장(Ⅰ.) / ### 절(1.) / #### 1)
//   - 목록은 깊이에 따라 □ → o → - → ·   (문서에 □·o 기호를 직접 쓴 줄이 있으면 그 기호를 따른다)
//   ※ 로 시작하는 줄은 주석, > 인용은 참고 박스(첫 줄 **참고** 등은 박스 제목)
//   표 바로 앞의 '<표 1> 제목', '(단위: 명)' 줄은 표 제목·단위
//   <!-- 쪽나눔 --> 또는 \newpage 는 쪽 나눔, **굵게**, <u>밑줄</u>
import { blankReport, rblock } from './report.js';

const KEYS = {
  제목: 'title', title: 'title',
  부제: 'subtitle', 부제목: 'subtitle', subtitle: 'subtitle',
  날짜: 'date', 일자: 'date', date: 'date',
  부서: 'dept', 기관: 'dept', 작성: 'dept', 작성자: 'dept', dept: 'dept', author: 'dept',
  머리말: 'header', header: 'header',
  표지: 'cover', cover: 'cover',
  목차: 'toc', toc: 'toc',
  기호: 'symbols', symbols: 'symbols',
  쪽번호: 'pageNumber', 쪽: 'pageNumber', pagenumber: 'pageNumber',
  본문글꼴: 'bodyFont', 제목글꼴: 'headFont', 보조글꼴: 'subFont',
  글자크기: 'size', size: 'size',
};
const YES = /^(예|네|yes|y|true|o|있음|사용|1)$/i;

const SYMBOL_LEVEL = [
  [/^[□■◻]\s+/, 1],
  [/^[o○ㅇ◦●]\s+/, 2],
  [/^[-–]\s+/, 3],
  [/^[·∙ㆍ]\s*/, 4],
];

function explicitSymbol(text) {
  if (/^※\s*/.test(text)) return { note: true, text: text.replace(/^※\s*/, '') };
  for (const [re, level] of SYMBOL_LEVEL) {
    const m = re.exec(text);
    if (m) return { level, text: text.slice(m[0].length) };
  }
  return null;
}

// 인라인 마크다운 정리: 링크·코드·기울임은 글자만 남기고, **굵게**·<u>밑줄</u>은 둔다.
function inline(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, '$1$2')
    .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1$2')
    .replace(/<(?!\/?u>)\/?[a-zA-Z][^>]*>/g, '')
    .replace(/\s+$/, '');
}

// 장·절 제목 앞에 손으로 단 번호는 뺀다 (자동으로 매긴다).
function stripHeadingNumber(text) {
  return text
    .replace(/^제\s*\d+\s*[장절]\s*/, '')
    .replace(/^(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]|[IVX]{1,4}|\d{1,2}(?:\.\d{1,2})*|[가-하])\s*[.)]\s+/, '')
    .trim();
}

function parseTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => inline(c.trim().replace(/\\\|/g, '|')).replace(/<br\s*\/?>/gi, '\n'));
}

const isTableSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const PAGEBREAK = /^\s*(<!--\s*(쪽\s*나눔|pagebreak|page-break)\s*-->|\\newpage|\\pagebreak)\s*$/i;
const CAPTION = /^[<〈《［[【]?\s*(표|그림)\s*\d*(-\d+)?\s*[>〉》］\]】]?\s*/;
const UNIT = /^[(（]?\s*단위\s*[:：]/;

export function markdownToReport(md) {
  const doc = blankReport();
  const warnings = [];
  let lines = md.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');

  // 머리 정보
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (end > 0) {
      for (const l of lines.slice(1, end)) {
        const m = /^\s*([^:：]+?)\s*[:：]\s*(.*)$/.exec(l);
        if (!m) continue;
        const key = KEYS[m[1].replace(/\s+/g, '').toLowerCase()] || KEYS[m[1].replace(/\s+/g, '')];
        const val = m[2].trim().replace(/^["']|["']$/g, '');
        if (!key) { warnings.push(`머리 정보 '${m[1]}'은(는) 알 수 없어 건너뜁니다.`); continue; }
        if (key === 'cover' || key === 'toc') doc.meta[key] = YES.test(val);
        else if (key === 'pageNumber') doc.settings.pageNumber = YES.test(val);
        else if (key === 'symbols') { const sy = val.split(/[\s,]+/).filter(Boolean); if (sy.length) doc.settings.symbols = sy; }
        else if (key === 'bodyFont') doc.settings.fonts.body = val;
        else if (key === 'headFont') doc.settings.fonts.head = val;
        else if (key === 'subFont') doc.settings.fonts.sub = val;
        else if (key === 'size') doc.settings.size = Number(val) || doc.settings.size;
        else doc.meta[key] = val;
      }
      lines = lines.slice(end + 1);
    }
  }

  // '#' 제목이 하나뿐이고 본문보다 먼저 나오면 문서 제목, 아니면 장으로 쓴다.
  const h1 = lines.map((l, i) => [l, i]).filter(([l]) => /^#\s+/.test(l));
  const firstContent = lines.findIndex((l) => l.trim() && !/^#\s+/.test(l));
  const h1IsTitle = h1.length === 1 && (firstContent < 0 || h1[0][1] < firstContent);
  const shift = h1IsTitle || !h1.length ? 1 : 0;

  // 보고서식 기호(□, o)를 직접 쓴 문서인지
  const explicitMode = lines.some((l) => /^\s*(?:[-*+]\s+)?[□■o○ㅇ]\s+\S/.test(l));

  const blocks = doc.blocks;
  let context = 0; // 마지막 항목 수준 (문단·주석 들여쓰기 기준)
  let para = null;
  let listIndents = [];
  const flushPara = () => { para = null; };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { flushPara(); continue; }
    if (PAGEBREAK.test(line)) { flushPara(); blocks.push(rblock.pagebreak()); context = 0; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushPara(); continue; } // 가로줄은 무시

    // 제목
    const hm = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hm) {
      flushPara();
      const text = inline(hm[2].replace(/\s+#+\s*$/, ''));
      if (hm[1].length === 1 && h1IsTitle) {
        if (!doc.meta.title) doc.meta.title = text;
        continue;
      }
      const level = Math.min(3, Math.max(1, hm[1].length - shift));
      blocks.push(rblock.heading(level, stripHeadingNumber(text)));
      context = 0;
      listIndents = [];
      continue;
    }

    // 표
    if (/^\s*\|/.test(line) && isTableSep(lines[i + 1] || '')) {
      flushPara();
      const rows = [parseTableRow(line)];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(parseTableRow(lines[i])); i++; }
      i--;
      const cols = Math.max(...rows.map((r) => r.length));
      rows.forEach((r) => { while (r.length < cols) r.push(''); });
      let caption = '';
      let unit = '';
      // 표 바로 앞 문단이 표 제목·단위면 표로 옮긴다.
      for (let k = 0; k < 2; k++) {
        const prev = blocks[blocks.length - 1];
        if (!prev || prev.type !== 'para') break;
        if (!unit && UNIT.test(prev.text)) { unit = prev.text; blocks.pop(); continue; }
        if (!caption && CAPTION.test(prev.text)) { caption = prev.text; blocks.pop(); continue; }
        break;
      }
      blocks.push(rblock.table(rows, { caption, unit }));
      continue;
    }

    // 참고 박스
    if (/^\s*>/.test(line)) {
      flushPara();
      const boxLines = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { boxLines.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      i--;
      const content = boxLines.map((l) => inline(l.replace(/^\s*[-*+]\s+/, (m) => (explicitMode ? '' : '- ')))).filter((l) => l.trim());
      let title = '';
      const t = /^\*\*(.+)\*\*$/.exec(content[0] || '') || /^[[【<]\s*(참고|요약|핵심|붙임|사례)[^\]】>]*[\]】>]$/.exec(content[0] || '');
      if (t) { title = (t[1] && !/^(참고|요약|핵심|붙임|사례)$/.test(t[1]) ? t[1] : content[0]).replace(/^\*\*|\*\*$/g, ''); content.shift(); }
      blocks.push(rblock.box(title, content));
      continue;
    }

    // 목록
    const lm = /^(\s*)([-*+]|\d{1,2}[.)])\s+(.*)$/.exec(line);
    if (lm) {
      flushPara();
      const indent = lm[1].length;
      while (listIndents.length && indent < listIndents[listIndents.length - 1]) listIndents.pop();
      if (!listIndents.length || indent > listIndents[listIndents.length - 1]) listIndents.push(indent);
      const depth = listIndents.length - 1;
      let text = inline(lm[3]);
      const ex = explicitSymbol(text);
      let level;
      if (ex?.note) { blocks.push(rblock.note(context, ex.text)); continue; }
      if (ex) { level = ex.level; text = ex.text; } else if (explicitMode) {
        // 보고서식 문서에서 '-' 목록은 '-' 항목(3수준)이다.
        level = lm[2] === '-' ? Math.min(4, 3 + depth) : Math.min(4, 2 + depth);
      } else {
        level = Math.min(4, depth + 1);
      }
      blocks.push(rblock.item(level, text));
      context = level;
      // 목록 항목에 이어지는 들여쓴 줄
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*([-*+]|\d{1,2}[.)])\s+/.test(lines[i + 1]) && !/^\s*[|>]/.test(lines[i + 1]) && !explicitSymbol(lines[i + 1].trim())) {
        i++;
        blocks[blocks.length - 1].text += ` ${inline(lines[i].trim())}`;
      }
      continue;
    }

    // 기호를 직접 쓴 줄 (□ …, o …, ※ …)
    const text = inline(line.trim());
    const ex = explicitSymbol(text);
    if (ex?.note) { flushPara(); blocks.push(rblock.note(context, ex.text)); continue; }
    if (ex && (ex.level <= 2 || explicitMode)) {
      flushPara();
      blocks.push(rblock.item(ex.level, ex.text));
      context = ex.level;
      listIndents = [];
      continue;
    }

    // 문단 (줄바꿈으로 나뉜 줄은 한 문단으로 잇는다. 표 제목·단위 줄은 따로 둔다)
    if (para && !CAPTION.test(text) && !UNIT.test(text) && !CAPTION.test(para.text) && !UNIT.test(para.text)) { para.text += ` ${text}`; continue; }
    const level = /^\s{2,}/.test(raw) && context ? context : 0;
    para = rblock.para(level, text);
    blocks.push(para);
    if (!level) context = 0;
    listIndents = [];
  }

  if (/!\[[^\]]*\]\([^)]*\)/.test(md)) warnings.push('그림(이미지)은 아직 넣지 못해 뺐습니다. 한글에서 직접 넣어 주십시오.');
  if (!doc.meta.title) warnings.push('제목이 없습니다. 머리 정보의 제목: 또는 # 제목 줄을 넣으십시오.');
  return { doc, warnings };
}

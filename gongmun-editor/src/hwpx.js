// 공문을 한글 문서(HWPX, OWPML)로 내보낸다.
// 한컴 오피스로 만든 빈 문서의 머리 정보(header.xml)를 바탕으로 글자·문단 모양과 테두리를 덧붙인다.
import { zipStore } from './zip.js';
import { computeMarkers } from './numbering.js';
import { FONTS } from './model.js';
import { textWidthEm } from './docx.js';
import { docToPlainText } from './plaintext.js';
import {
  endMark, attachmentLines, footerInfo, recipientListText, showsRecipientList, indentEm, END_TEXT, BLANK_TEXT,
} from './layout.js';
import {
  HEADER_XML, SECTION_OPEN, SECPR, CONTENT_HPF, VERSION_XML, SETTINGS_XML, CONTAINER_XML, MANIFEST_XML, CONTAINER_RDF,
} from './hwpxTemplate.js';

const HWPUNIT_PER_MM = 7200 / 25.4;
const BASE_FONT = '함초롬바탕'; // 머리 정보에서 글꼴 1번 자리. 고른 글꼴 이름으로 바꾼다.

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // XML 1.0에서 쓸 수 없는 제어 문자는 뺀다.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

const mm = (v) => Math.round(v * HWPUNIT_PER_MM);

// 테두리·배경 (머리 정보에 이미 1, 2번이 있다)
const BORDER = { cell: 3, headCell: 4, titleLine: 5, footTop: 6, footBottom: 7 };

function borderFill(id, sides, fill) {
  const side = (name, s) => `<hh:${name}Border type="${s ? 'SOLID' : 'NONE'}" width="${s || '0.1 mm'}" color="#000000"/>`;
  return `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">`
    + '<hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>'
    + side('left', sides.left) + side('right', sides.right) + side('top', sides.top) + side('bottom', sides.bottom)
    + '<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>'
    + (fill ? `<hc:fillBrush><hc:winBrush faceColor="${fill}" hatchColor="#999999" alpha="0"/></hc:fillBrush>` : '')
    + '</hh:borderFill>';
}

const EXTRA_BORDERS = [
  borderFill(BORDER.cell, { left: '0.12 mm', right: '0.12 mm', top: '0.12 mm', bottom: '0.12 mm' }),
  borderFill(BORDER.headCell, { left: '0.12 mm', right: '0.12 mm', top: '0.12 mm', bottom: '0.12 mm' }, '#E7E6E6'),
  borderFill(BORDER.titleLine, { bottom: '0.12 mm' }),
  borderFill(BORDER.footTop, { top: '0.4 mm' }),
  borderFill(BORDER.footBottom, { bottom: '0.12 mm' }),
];

// 글자 모양·문단 모양을 필요할 때마다 만들어 번호를 매긴다.
class Styles {
  constructor(header) {
    this.charStart = Number(/<hh:charProperties itemCnt="(\d+)"/.exec(header)[1]);
    this.paraStart = Number(/<hh:paraProperties itemCnt="(\d+)"/.exec(header)[1]);
    this.chars = new Map();
    this.paras = new Map();
  }

  char({ size, bold = false, color = '#000000' }) {
    const key = `${size}|${bold}|${color}`;
    if (!this.chars.has(key)) {
      const id = this.charStart + this.chars.size;
      const all = (v) => `hangul="${v}" latin="${v}" hanja="${v}" japanese="${v}" other="${v}" symbol="${v}" user="${v}"`;
      this.chars.set(key, `<hh:charPr id="${id}" height="${Math.round(size * 100)}" textColor="${color}" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="2">`
        + `<hh:fontRef ${all(1)}/><hh:ratio ${all(100)}/><hh:spacing ${all(0)}/><hh:relSz ${all(100)}/><hh:offset ${all(0)}/>`
        + (bold ? '<hh:bold/>' : '')
        + '<hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#C0C0C0" offsetX="10" offsetY="10"/></hh:charPr>');
    }
    return this.charStart + [...this.chars.keys()].indexOf(key);
  }

  // left: 문단 왼쪽 여백, hang: 내어쓰기 폭 (한글은 첫 줄을 왼쪽 여백에 두고 둘째 줄부터 hang만큼 들어간다)
  para({ align = 'JUSTIFY', left = 0, hang = 0, prev = 0, next = 0, line = 160, border = 2, borderTop = 0, borderBottom = 0 }) {
    const v = { align, left: Math.round(left), hang: Math.round(hang), prev: Math.round(prev), next: Math.round(next), line, border, borderTop, borderBottom };
    const key = JSON.stringify(v);
    if (!this.paras.has(key)) {
      const id = this.paraStart + this.paras.size;
      const margin = (k) => `<hh:margin><hc:intent value="${-v.hang * k}" unit="HWPUNIT"/><hc:left value="${v.left * k}" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="${v.prev * k}" unit="HWPUNIT"/><hc:next value="${v.next * k}" unit="HWPUNIT"/></hh:margin>`;
      const spacing = `<hh:lineSpacing type="PERCENT" value="${v.line}" unit="HWPUNIT"/>`;
      // 내어쓰기가 있으면 '내어 쓰기용 자동 탭'(탭 1번)을 써서 기호 뒤 탭이 내용 시작 위치로 가게 한다.
      this.paras.set(key, `<hh:paraPr id="${id}" tabPrIDRef="${v.hang ? 1 : 0}" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0" textDir="LTR">`
        + `<hh:align horizontal="${v.align}" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/>`
        + '<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>'
        + '<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>'
        // 새 형식(HwpUnitChar)은 실제 값, 옛 형식(default)은 두 배 값으로 적는다 (한글이 저장하는 방식).
        + `<hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">${margin(1)}${spacing}</hp:case><hp:default>${margin(2)}${spacing}</hp:default></hp:switch>`
        + `<hh:border borderFillIDRef="${v.border}" offsetLeft="0" offsetRight="0" offsetTop="${v.borderTop}" offsetBottom="${v.borderBottom}" connect="0" ignoreMargin="0"/></hh:paraPr>`);
    }
    return this.paraStart + [...this.paras.keys()].indexOf(key);
  }

  header(base, fontName) {
    let h = base;
    if (fontName && fontName !== BASE_FONT) h = h.split(`face="${BASE_FONT}"`).join(`face="${esc(fontName)}"`);
    h = h.replace(/<hh:borderFills itemCnt="(\d+)">([\s\S]*?)<\/hh:borderFills>/, (_, n, body) => `<hh:borderFills itemCnt="${Number(n) + EXTRA_BORDERS.length}">${body}${EXTRA_BORDERS.join('')}</hh:borderFills>`);
    h = h.replace(/<hh:charProperties itemCnt="(\d+)">([\s\S]*?)<\/hh:charProperties>/, (_, n, body) => `<hh:charProperties itemCnt="${Number(n) + this.chars.size}">${body}${[...this.chars.values()].join('')}</hh:charProperties>`);
    h = h.replace(/<hh:paraProperties itemCnt="(\d+)">([\s\S]*?)<\/hh:paraProperties>/, (_, n, body) => `<hh:paraProperties itemCnt="${Number(n) + this.paras.size}">${body}${[...this.paras.values()].join('')}</hh:paraProperties>`);
    return h;
  }
}

// 탭(\t)과 줄바꿈(\n)을 OWPML 요소로 바꾼 hp:t
function textXml(text) {
  if (!text) return '<hp:t/>';
  const body = String(text).split('\n').map((line) => line.split('\t').map(esc).join('<hp:tab leader="NONE" type="LEFT"/>')).join('<hp:lineBreak/>');
  return `<hp:t>${body}</hp:t>`;
}

export function buildSectionXml(doc, styles) {
  const s = doc.settings;
  const size = Number(s.size) || 12;
  const em = size * 100;
  const line = Number(s.lineHeight) || 160;
  const internal = doc.kind === 'internal';
  const markers = computeMarkers(doc.blocks);
  const mark = endMark(doc);
  const m = s.margins;
  const contentWidth = mm(210 - m.left - m.right);
  const base = styles.char({ size });
  const bold = styles.char({ size, bold: true });
  let pid = 0;
  let objId = 1000;
  const out = [];
  const P = (paraOpt, runs) => {
    const id = pid++;
    const pr = styles.para({ line, ...paraOpt });
    const body = runs.map((r) => (r.raw ? `<hp:run charPrIDRef="${r.char}">${r.raw}</hp:run>` : `<hp:run charPrIDRef="${r.char ?? base}">${textXml(r.text)}</hp:run>`)).join('');
    out.push(`<hp:p id="${id}" paraPrIDRef="${pr}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${body}</hp:p>`);
  };
  const end = `  ${END_TEXT}`;

  // 쪽 설정: A4, 여백(머리말·꼬리말 영역 없이 본문 여백만)
  const secpr = SECPR.replace(/<hp:margin header="\d+" footer="\d+" gutter="\d+" left="\d+" right="\d+" top="\d+" bottom="\d+"\/>/,
    `<hp:margin header="0" footer="0" gutter="0" left="${mm(m.left)}" right="${mm(m.right)}" top="${mm(m.top)}" bottom="${mm(m.bottom)}"/>`);
  const secRun = { char: base, raw: secpr };

  // 두문
  const first = [];
  if (doc.org.slogan) {
    P({ align: 'CENTER' }, [secRun, { char: styles.char({ size: size - 2 }), text: doc.org.slogan }]);
  } else {
    first.push(secRun);
  }
  P({ align: 'CENTER', next: em * 0.8 }, [...first, { char: styles.char({ size: size * 1.6, bold: true }), text: doc.org.name }]);
  const head = 4 * em;
  P({ left: 0, hang: head }, [{ text: `수신\t${doc.recipient.to}` }]);
  P({ left: 0, hang: head }, [{ text: `(경유)\t${doc.recipient.via}` }]);
  P({ left: 0, hang: head, next: em * 0.6, border: BORDER.titleLine, borderBottom: 283 }, [{ char: bold, text: `제목\t${doc.title}` }]);

  // 본문
  for (const b of doc.blocks) {
    if (b.type === 'table') {
      const indent = b.level ? b.level * em : 0;
      out.push(tableParagraph(b, { id: pid++, objId: objId++, styles, line, size, width: contentWidth - indent, indent, mark: mark?.blockId === b.id ? mark : null }));
      if (mark?.kind === 'table-below' && mark.blockId === b.id) P({ left: em }, [{ text: END_TEXT }]);
      continue;
    }
    const isEnd = mark?.kind === 'block' && mark.blockId === b.id;
    if (!b.level) {
      P({}, [{ text: b.text + (isEnd ? end : '') }]);
      continue;
    }
    const marker = markers.get(b.id) || '';
    const hang = (textWidthEm(marker) + 0.5) * em;
    P({ left: indentEm(b.level) * em, hang }, [{ text: `${marker}\t${b.text}${isEnd ? end : ''}` }]);
  }

  // 붙임
  const atts = attachmentLines(doc);
  atts.forEach((a, n) => {
    const label = 3 * em;
    const isEnd = mark?.kind === 'attachment' && mark.index === a.index;
    const text = `${a.marker ? `${a.marker}\t` : ''}${a.text}${isEnd ? end : ''}`;
    const hang = a.marker ? (textWidthEm(a.marker) + 0.5) * em : 0;
    if (n === 0) {
      // '붙임' 다음 2타: 첫 줄은 왼쪽 끝에서 시작하고 둘째 줄부터 붙임 내용에 맞춘다.
      P({ left: 0, hang: label + hang, prev: em * 0.6 }, [{ text: `붙임\t${text}` }]);
    } else {
      P({ left: label, hang }, [{ text }]);
    }
  });

  // 결문
  if (!internal && doc.sender.name) {
    const note = { stamp: '  (인)', omit: '  관인생략', signOmit: '  서명생략' }[doc.sender.seal] || '';
    const runs = [{ char: styles.char({ size: size * 1.5, bold: true }), text: doc.sender.name }];
    if (note) runs.push({ char: styles.char({ size: size - 1, color: doc.sender.seal === 'stamp' ? '#C00000' : '#000000' }), text: note });
    P({ align: 'CENTER', prev: em * 2.5, next: em * 1.2 }, runs);
  } else {
    P({ prev: em * 2 }, [{ text: '' }]);
  }
  if (showsRecipientList(doc)) P({ left: 0, hang: head, next: em * 0.4 }, [{ text: `수신자\t${recipientListText(doc)}` }]);

  const f = footerInfo(doc);
  const small = styles.char({ size: 10 });
  const gap = '    ';
  const lines = [f.signers.join(gap)];
  if (f.cooperators.length) lines.push(`협조자${gap}${f.cooperators.join(gap)}`);
  lines.push(`시행  ${f.enforce}${gap}접수  ${f.receive}`);
  if (!internal) {
    lines.push([f.address, f.homepage].filter(Boolean).join('  /  '));
    const tel = [f.phone ? `전화번호 ${f.phone}` : '', f.fax ? `팩스번호 ${f.fax}` : ''].filter(Boolean).join('  ');
    lines.push([tel, f.email, f.disclosure].filter(Boolean).join('  /  '));
  } else {
    lines.push(f.disclosure);
  }
  lines.forEach((t, i) => {
    const firstLine = i === 0;
    const lastLine = i === lines.length - 1;
    const opt = { align: 'LEFT', line: 150 };
    if (firstLine) Object.assign(opt, { border: BORDER.footTop, borderTop: 283, prev: em * 0.4 });
    if (lastLine) Object.assign(opt, { border: BORDER.footBottom, borderBottom: 283 });
    if (firstLine && lastLine) opt.border = BORDER.footTop;
    P(opt, [{ char: small, text: t }]);
  });

  return `${SECTION_OPEN}${out.join('')}</hs:sec>`;
}

function tableParagraph(b, { id, objId, styles, line, size, width, indent, mark }) {
  const cols = Math.max(...b.rows.map((r) => r.length));
  const colW = Math.floor(width / cols);
  const margin = { l: 510, r: 510, t: 141, b: 141 };
  const blankRow = mark?.kind === 'table-blank' ? mark.row : -1;
  const cellText = styles.char({ size: size * 0.95 });
  const cellBold = styles.char({ size: size * 0.95, bold: true });
  const leftPara = styles.para({ align: 'LEFT', line: 130 });
  const centerPara = styles.para({ align: 'CENTER', line: 130 });
  let totalH = 0;
  let pid = id * 1000;
  const rows = b.rows.map((row, r) => {
    const header = b.header && r === 0;
    const texts = Array.from({ length: cols }, (_, c) => (r === blankRow && c === 0 && !(row[c] || '').trim() ? BLANK_TEXT : row[c] ?? ''));
    const lineCount = Math.max(1, ...texts.map((t) => t.split('\n').length));
    const h = Math.round(lineCount * size * 100 * 1.3 + margin.t + margin.b);
    totalH += h;
    const cells = texts.map((t, c) => {
      const w = c === cols - 1 ? width - colW * (cols - 1) : colW;
      return `<hp:tc name="" header="${header ? 1 : 0}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${header ? BORDER.headCell : BORDER.cell}">`
        + '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">'
        + `<hp:p id="${pid++}" paraPrIDRef="${header ? centerPara : leftPara}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${header ? cellBold : cellText}">${textXml(t)}</hp:run></hp:p>`
        + `</hp:subList><hp:cellAddr colAddr="${c}" rowAddr="${r}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${w}" height="${h}"/><hp:cellMargin left="${margin.l}" right="${margin.r}" top="${margin.t}" bottom="${margin.b}"/></hp:tc>`;
    }).join('');
    return `<hp:tr>${cells}</hp:tr>`;
  }).join('');
  const tbl = `<hp:tbl id="${objId}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="${b.header ? 1 : 0}" rowCnt="${b.rows.length}" colCnt="${cols}" cellSpacing="0" borderFillIDRef="${BORDER.cell}" noAdjust="0">`
    + `<hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${totalH}" heightRelTo="ABSOLUTE" protect="0"/>`
    + '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
    + '<hp:outMargin left="0" right="0" top="0" bottom="0"/>'
    + `<hp:inMargin left="${margin.l}" right="${margin.r}" top="${margin.t}" bottom="${margin.b}"/>${rows}</hp:tbl>`;
  const pr = styles.para({ align: 'LEFT', left: indent, line, prev: 140, next: 140 });
  return `<hp:p id="${id}" paraPrIDRef="${pr}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${cellText}">${tbl}</hp:run><hp:run charPrIDRef="${cellText}"><hp:t/></hp:run></hp:p>`;
}

function contentHpf(doc, now) {
  const iso = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return CONTENT_HPF
    .replace('<opf:title/>', `<opf:title>${esc(doc.title)}</opf:title>`)
    .replace(/(<opf:meta name="creator" content="text">)[^<]*(<\/opf:meta>)/, '$1공문 편집기$2')
    .replace(/(<opf:meta name="lastsaveby" content="text">)[^<]*(<\/opf:meta>)/, '$1공문 편집기$2')
    .replace(/(<opf:meta name="CreatedDate" content="text">)[^<]*(<\/opf:meta>)/, `$1${iso}$2`)
    .replace(/(<opf:meta name="ModifiedDate" content="text">)[^<]*(<\/opf:meta>)/, `$1${iso}$2`)
    .replace(/(<opf:meta name="date" content="text">)[^<]*(<\/opf:meta>)/, '$1$2');
}

export function buildHwpx(doc, now = new Date()) {
  const styles = new Styles(HEADER_XML);
  const section = buildSectionXml(doc, styles);
  const font = (FONTS.find((f) => f.id === doc.settings.font) || FONTS[0]).docx;
  const header = styles.header(HEADER_XML, font);
  return zipStore([
    { name: 'mimetype', data: 'application/hwp+zip' },
    { name: 'version.xml', data: VERSION_XML },
    { name: 'Contents/header.xml', data: header },
    { name: 'Contents/section0.xml', data: section },
    { name: 'Preview/PrvText.txt', data: docToPlainText(doc).slice(0, 1024) },
    { name: 'settings.xml', data: SETTINGS_XML },
    { name: 'META-INF/container.rdf', data: CONTAINER_RDF },
    { name: 'Contents/content.hpf', data: contentHpf(doc, now) },
    { name: 'META-INF/container.xml', data: CONTAINER_XML },
    { name: 'META-INF/manifest.xml', data: MANIFEST_XML },
  ], now);
}

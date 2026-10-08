// HWPX(OWPML) 공통 부품: 글자·문단 모양과 테두리 등록, 글꼴 추가, 쪽 설정·머리말·꼬리말, 패키지 묶기.
// 한컴 오피스로 만든 빈 문서(hwpxTemplate.js)의 머리 정보에 필요한 모양을 덧붙이는 방식이다.
import { zipStore } from './zip.js';
import {
  HEADER_XML, SECTION_OPEN, SECPR, CONTENT_HPF, VERSION_XML, SETTINGS_XML, CONTAINER_XML, MANIFEST_XML, CONTAINER_RDF,
} from './hwpxTemplate.js';

const HWPUNIT_PER_MM = 7200 / 25.4;
export const mm = (v) => Math.round(v * HWPUNIT_PER_MM);

export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // XML 1.0에서 쓸 수 없는 제어 문자는 뺀다.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

// 탭(\t)과 줄바꿈(\n)을 OWPML 요소로 바꾼 hp:t
export function textXml(text) {
  if (!text) return '<hp:t/>';
  const body = String(text).split('\n').map((line) => line.split('\t').map(esc).join('<hp:tab leader="NONE" type="LEFT"/>')).join('<hp:lineBreak/>');
  return `<hp:t>${body}</hp:t>`;
}

const LANGS = ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER'];

// 글자 모양·문단 모양·테두리·글꼴을 필요할 때마다 만들어 번호를 매긴다.
export class Styles {
  constructor(header = HEADER_XML) {
    this.base = header;
    this.charStart = Number(/<hh:charProperties itemCnt="(\d+)"/.exec(header)[1]);
    this.paraStart = Number(/<hh:paraProperties itemCnt="(\d+)"/.exec(header)[1]);
    this.borderStart = Number(/<hh:borderFills itemCnt="(\d+)"/.exec(header)[1]) + 1;
    // 빈 문서의 글꼴: 0번 함초롬돋움, 1번 함초롬바탕. 그 밖의 글꼴은 2번부터 덧붙인다.
    this.baseFonts = ['함초롬돋움', '함초롬바탕'];
    this.extraFonts = [];
    this.chars = new Map();
    this.paras = new Map();
    this.borders = new Map();
    this.renamed = null;
  }

  // 글꼴 1번(함초롬바탕) 자리를 다른 이름으로 바꾼다 (공문의 본문 글꼴).
  renameBaseFont(name) {
    if (name && name !== this.baseFonts[1]) this.renamed = name;
  }

  font(name) {
    if (!name) return 1;
    const base = this.baseFonts.indexOf(name);
    if (base >= 0) return base;
    if (this.renamed === name) return 1;
    let i = this.extraFonts.indexOf(name);
    if (i < 0) { this.extraFonts.push(name); i = this.extraFonts.length - 1; }
    return 2 + i;
  }

  char({ size, bold = false, underline = false, color = '#000000', font = null }) {
    const fontId = this.font(font);
    const key = `${size}|${bold}|${underline}|${color}|${fontId}`;
    if (!this.chars.has(key)) {
      const id = this.charStart + this.chars.size;
      const all = (v) => `hangul="${v}" latin="${v}" hanja="${v}" japanese="${v}" other="${v}" symbol="${v}" user="${v}"`;
      // OWPML 스키마 순서: fontRef, ratio, spacing, relSz, offset, italic, bold, underline, strikeout, outline, shadow
      this.chars.set(key, `<hh:charPr id="${id}" height="${Math.round(size * 100)}" textColor="${color}" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="2">`
        + `<hh:fontRef ${all(fontId)}/><hh:ratio ${all(100)}/><hh:spacing ${all(0)}/><hh:relSz ${all(100)}/><hh:offset ${all(0)}/>`
        + (bold ? '<hh:bold/>' : '')
        + `<hh:underline type="${underline ? 'BOTTOM' : 'NONE'}" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#C0C0C0" offsetX="10" offsetY="10"/></hh:charPr>`);
    }
    return this.charStart + [...this.chars.keys()].indexOf(key);
  }

  // sides: { top, bottom, left, right } 각 '0.12 mm' 같은 굵기, 또는 { width, type }. fill: '#RRGGBB'
  border(sides = {}, fill = null) {
    const key = JSON.stringify([sides, fill]);
    if (!this.borders.has(key)) {
      const id = this.borderStart + this.borders.size;
      const side = (name, s) => {
        const w = typeof s === 'object' && s ? s.width : s;
        const type = typeof s === 'object' && s ? s.type || 'SOLID' : 'SOLID';
        return `<hh:${name}Border type="${w ? type : 'NONE'}" width="${w || '0.1 mm'}" color="#000000"/>`;
      };
      this.borders.set(key, `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">`
        + '<hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>'
        + side('left', sides.left) + side('right', sides.right) + side('top', sides.top) + side('bottom', sides.bottom)
        + '<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>'
        + (fill ? `<hc:fillBrush><hc:winBrush faceColor="${fill}" hatchColor="#999999" alpha="0"/></hc:fillBrush>` : '')
        + '</hh:borderFill>');
    }
    return this.borderStart + [...this.borders.keys()].indexOf(key);
  }

  // left: 문단 왼쪽 여백, hang: 내어쓰기 폭 (한글은 첫 줄을 왼쪽 여백에 두고 둘째 줄부터 hang만큼 들어간다)
  para({
    align = 'JUSTIFY', left = 0, hang = 0, right = 0, prev = 0, next = 0, line = 160,
    border = 2, borderTop = 0, borderBottom = 0, borderSide = 0, keepNext = false, connect = false,
  }) {
    const v = {
      align, left: Math.round(left), hang: Math.round(hang), right: Math.round(right), prev: Math.round(prev), next: Math.round(next),
      line, border, borderTop, borderBottom, borderSide, keepNext, connect,
    };
    const key = JSON.stringify(v);
    if (!this.paras.has(key)) {
      const id = this.paraStart + this.paras.size;
      const margin = (k) => `<hh:margin><hc:intent value="${-v.hang * k}" unit="HWPUNIT"/><hc:left value="${v.left * k}" unit="HWPUNIT"/><hc:right value="${v.right * k}" unit="HWPUNIT"/><hc:prev value="${v.prev * k}" unit="HWPUNIT"/><hc:next value="${v.next * k}" unit="HWPUNIT"/></hh:margin>`;
      const spacing = `<hh:lineSpacing type="PERCENT" value="${v.line}" unit="HWPUNIT"/>`;
      // 내어쓰기가 있으면 '내어 쓰기용 자동 탭'(탭 1번)을 써서 기호 뒤 탭이 내용 시작 위치로 가게 한다.
      this.paras.set(key, `<hh:paraPr id="${id}" tabPrIDRef="${v.hang ? 1 : 0}" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0" textDir="LTR">`
        + `<hh:align horizontal="${v.align}" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/>`
        + `<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="${v.keepNext ? 1 : 0}" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>`
        + '<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>'
        // 새 형식(HwpUnitChar)은 실제 값, 옛 형식(default)은 두 배 값으로 적는다 (한글이 저장하는 방식).
        + `<hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">${margin(1)}${spacing}</hp:case><hp:default>${margin(2)}${spacing}</hp:default></hp:switch>`
        + `<hh:border borderFillIDRef="${v.border}" offsetLeft="${v.borderSide}" offsetRight="${v.borderSide}" offsetTop="${v.borderTop}" offsetBottom="${v.borderBottom}" connect="${v.connect ? 1 : 0}" ignoreMargin="0"/></hh:paraPr>`);
    }
    return this.paraStart + [...this.paras.keys()].indexOf(key);
  }

  header() {
    let h = this.base;
    if (this.renamed) h = h.split(`face="${this.baseFonts[1]}"`).join(`face="${esc(this.renamed)}"`);
    if (this.extraFonts.length) {
      h = h.replace(/<hh:fontface lang="(\w+)" fontCnt="(\d+)">([\s\S]*?)<\/hh:fontface>/g, (whole, lang, n, body) => {
        if (!LANGS.includes(lang)) return whole;
        const extra = this.extraFonts.map((f, i) => `<hh:font id="${2 + i}" face="${esc(f)}" type="TTF" isEmbedded="0"/>`).join('');
        return `<hh:fontface lang="${lang}" fontCnt="${Number(n) + this.extraFonts.length}">${body}${extra}</hh:fontface>`;
      });
    }
    const append = (tag, map) => {
      if (!map.size) return;
      h = h.replace(new RegExp(`<hh:${tag} itemCnt="(\\d+)">([\\s\\S]*?)</hh:${tag}>`), (_, n, body) => `<hh:${tag} itemCnt="${Number(n) + map.size}">${body}${[...map.values()].join('')}</hh:${tag}>`);
    };
    append('borderFills', this.borders);
    append('charProperties', this.chars);
    append('paraProperties', this.paras);
    return h;
  }
}

// 문단 하나를 만드는 도구. runs: [{ char, text } | { char, raw }]
export class Writer {
  constructor(styles, { line = 160 } = {}) {
    this.styles = styles;
    this.line = line;
    this.out = [];
    this.pid = 0;
    this.obj = 1000;
  }

  runsXml(runs) {
    return runs.map((r) => (r.raw ? `<hp:run charPrIDRef="${r.char}">${r.raw}</hp:run>` : `<hp:run charPrIDRef="${r.char}">${textXml(r.text)}</hp:run>`)).join('');
  }

  p(paraOpt, runs, { pageBreak = false } = {}) {
    const pr = this.styles.para({ line: this.line, ...paraOpt });
    this.out.push(`<hp:p id="${this.pid++}" paraPrIDRef="${pr}" styleIDRef="0" pageBreak="${pageBreak ? 1 : 0}" columnBreak="0" merged="0">${this.runsXml(runs)}</hp:p>`);
  }

  raw(xml) {
    this.out.push(xml);
  }

  nextObjId() {
    return this.obj++;
  }

  nextPid() {
    return this.pid++;
  }

  xml() {
    return `${SECTION_OPEN}${this.out.join('')}</hs:sec>`;
  }
}

// 쪽 설정(A4)과 머리말·꼬리말을 담은 run. 첫 문단의 맨 앞에 넣는다.
// margins(mm): { top, bottom, left, right, header, footer }
// header/footer: { runs: [...], align } — footer.pageNumber가 true면 '- 쪽 -' 형태의 자동 쪽 번호
export function sectionRun(styles, { margins, header = null, footer = null, char, hideFirst = false }) {
  const m = margins;
  let secpr = SECPR.replace(/<hp:margin header="\d+" footer="\d+" gutter="\d+" left="\d+" right="\d+" top="\d+" bottom="\d+"\/>/,
    `<hp:margin header="${mm(m.header || 0)}" footer="${mm(m.footer || 0)}" gutter="0" left="${mm(m.left)}" right="${mm(m.right)}" top="${mm(m.top)}" bottom="${mm(m.bottom)}"/>`);
  // 표지가 있으면 첫 쪽에는 머리말·꼬리말(쪽 번호)을 감춘다.
  if (hideFirst) secpr = secpr.replace('hideFirstHeader="0" hideFirstFooter="0"', 'hideFirstHeader="1" hideFirstFooter="1"').replace('hideFirstPageNum="0"', 'hideFirstPageNum="1"');
  const width = mm(210 - m.left - m.right);
  const sub = (kind, part) => {
    const pr = styles.para({ align: part.align || 'CENTER', line: 100 });
    const runs = part.runs.map((r) => (r.pageNumber
      ? `<hp:run charPrIDRef="${r.char}"><hp:ctrl><hp:autoNum num="1" numType="PAGE"><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar="" supscript="0"/></hp:autoNum></hp:ctrl></hp:run>`
      : `<hp:run charPrIDRef="${r.char}">${textXml(r.text)}</hp:run>`)).join('');
    const h = mm(kind === 'header' ? m.header || 10 : m.footer || 10);
    return `<hp:ctrl><hp:${kind} id="${kind === 'header' ? 1 : 2}" applyPageType="BOTH"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${kind === 'header' ? 'TOP' : 'BOTTOM'}" linkListIDRef="0" linkListNextIDRef="0" textWidth="${width}" textHeight="${h}" hasTextRef="0" hasNumRef="0">`
      + `<hp:p paraPrIDRef="${pr}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0" id="${kind === 'header' ? 900001 : 900002}">${runs}</hp:p></hp:subList></hp:${kind}></hp:ctrl>`;
  };
  let raw = secpr;
  if (header) raw += sub('header', header);
  if (footer) raw += sub('footer', footer);
  return { char, raw };
}

export function packHwpx({ header, section, title = '', preview = '', now = new Date() }) {
  const iso = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const hpf = CONTENT_HPF
    .replace('<opf:title/>', `<opf:title>${esc(title)}</opf:title>`)
    .replace(/(<opf:meta name="creator" content="text">)[^<]*(<\/opf:meta>)/, '$1공문 편집기$2')
    .replace(/(<opf:meta name="lastsaveby" content="text">)[^<]*(<\/opf:meta>)/, '$1공문 편집기$2')
    .replace(/(<opf:meta name="CreatedDate" content="text">)[^<]*(<\/opf:meta>)/, `$1${iso}$2`)
    .replace(/(<opf:meta name="ModifiedDate" content="text">)[^<]*(<\/opf:meta>)/, `$1${iso}$2`)
    .replace(/(<opf:meta name="date" content="text">)[^<]*(<\/opf:meta>)/, '$1$2');
  return zipStore([
    { name: 'mimetype', data: 'application/hwp+zip' },
    { name: 'version.xml', data: VERSION_XML },
    { name: 'Contents/header.xml', data: header },
    { name: 'Contents/section0.xml', data: section },
    { name: 'Preview/PrvText.txt', data: String(preview).slice(0, 1024) },
    { name: 'settings.xml', data: SETTINGS_XML },
    { name: 'META-INF/container.rdf', data: CONTAINER_RDF },
    { name: 'Contents/content.hpf', data: hpf },
    { name: 'META-INF/container.xml', data: CONTAINER_XML },
    { name: 'META-INF/manifest.xml', data: MANIFEST_XML },
  ], now);
}

// 표 하나를 문단으로 감싼 XML (글자처럼 취급하는 표).
// rows: [[{ text|runs, char, para, border }]] — 칸마다 문단 모양·글자 모양·테두리 번호
export function tableXml(w, { rows, colWidths, rowHeights, borderId, repeatHeader = false, para, char, margin = { l: 510, r: 510, t: 141, b: 141 } }) {
  const width = colWidths.reduce((a, b) => a + b, 0);
  const height = rowHeights.reduce((a, b) => a + b, 0);
  const id = w.nextPid();
  let cellPid = id * 1000;
  const trs = rows.map((row, r) => `<hp:tr>${row.map((cell, c) => {
    const runs = cell.runs ? w.runsXml(cell.runs) : `<hp:run charPrIDRef="${cell.char}">${textXml(cell.text)}</hp:run>`;
    return `<hp:tc name="" header="${cell.header ? 1 : 0}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${cell.border}">`
      + `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${cell.vAlign || 'CENTER'}" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">`
      + `<hp:p id="${cellPid++}" paraPrIDRef="${cell.para}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${runs}</hp:p>`
      + `</hp:subList><hp:cellAddr colAddr="${c}" rowAddr="${r}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${colWidths[c]}" height="${rowHeights[r]}"/><hp:cellMargin left="${margin.l}" right="${margin.r}" top="${margin.t}" bottom="${margin.b}"/></hp:tc>`;
  }).join('')}</hp:tr>`).join('');
  const tbl = `<hp:tbl id="${w.nextObjId()}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="${repeatHeader ? 1 : 0}" rowCnt="${rows.length}" colCnt="${colWidths.length}" cellSpacing="0" borderFillIDRef="${borderId}" noAdjust="0">`
    + `<hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/>`
    + '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
    + '<hp:outMargin left="0" right="0" top="0" bottom="0"/>'
    + `<hp:inMargin left="${margin.l}" right="${margin.r}" top="${margin.t}" bottom="${margin.b}"/>${trs}</hp:tbl>`;
  w.raw(`<hp:p id="${id}" paraPrIDRef="${para}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${char}">${tbl}</hp:run><hp:run charPrIDRef="${char}"><hp:t/></hp:run></hp:p>`);
}

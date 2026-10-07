// 공문을 DOCX로 내보낸다. 한글(HWP)과 MS 워드에서 모두 열 수 있다.
import { zipStore } from './zip.js';
import { computeMarkers } from './numbering.js';
import { FONTS } from './model.js';
import {
  endMark, attachmentLines, footerInfo, recipientListText, showsRecipientList, indentEm, END_TEXT, BLANK_TEXT,
} from './layout.js';

const MM = 56.6929; // 1mm = 56.69 twips

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 전각 문자는 1자, 반각 문자는 0.5자로 셈한다.
export function textWidthEm(s) {
  let w = 0;
  for (const ch of s) w += /[\u0000-ÿ]/.test(ch) ? 0.5 : 1;
  return w;
}

function run(text, opt = {}) {
  const rPr = [];
  if (opt.bold) rPr.push('<w:b/><w:bCs/>');
  // OOXML 스키마 순서(b → color → sz)를 지켜야 워드에서 오류 없이 열린다.
  if (opt.color) rPr.push(`<w:color w:val="${opt.color}"/>`);
  if (opt.size) rPr.push(`<w:sz w:val="${Math.round(opt.size * 2)}"/><w:szCs w:val="${Math.round(opt.size * 2)}"/>`);
  const pr = rPr.length ? `<w:rPr>${rPr.join('')}</w:rPr>` : '';
  const parts = String(text).split('\n');
  const body = parts.map((p, i) => `${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(p)}</w:t>`).join('');
  return `<w:r>${pr}${body}</w:r>`;
}

const TAB = '<w:r><w:tab/></w:r>';

function para(content, opt = {}) {
  const pPr = [];
  if (opt.border) {
    const b = Object.entries(opt.border).map(([side, sz]) => `<w:${side} w:val="single" w:sz="${sz}" w:space="4" w:color="000000"/>`).join('');
    pPr.push(`<w:pBdr>${b}</w:pBdr>`);
  }
  if (opt.tabs?.length) pPr.push(`<w:tabs>${opt.tabs.map((t) => `<w:tab w:val="left" w:pos="${Math.round(t)}"/>`).join('')}</w:tabs>`);
  if (opt.before || opt.after) pPr.push(`<w:spacing w:before="${Math.round(opt.before || 0)}" w:after="${Math.round(opt.after || 0)}"/>`);
  if (opt.left || opt.hanging) pPr.push(`<w:ind w:left="${Math.round(opt.left || 0)}" w:hanging="${Math.round(opt.hanging || 0)}"/>`);
  if (opt.align) pPr.push(`<w:jc w:val="${opt.align}"/>`);
  if (opt.keepNext) pPr.unshift('<w:keepNext/>');
  return `<w:p>${pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''}${content}</w:p>`;
}

function tableXml(block, em, mark, contentWidth) {
  const cols = Math.max(...block.rows.map((r) => r.length));
  const border = '<w:top w:val="single" w:sz="6" w:color="000000"/><w:left w:val="single" w:sz="6" w:color="000000"/><w:bottom w:val="single" w:sz="6" w:color="000000"/><w:right w:val="single" w:sz="6" w:color="000000"/><w:insideH w:val="single" w:sz="4" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:color="000000"/>';
  const rows = block.rows.map((row, r) => {
    const header = block.header && r === 0;
    const cells = Array.from({ length: cols }, (_, c) => {
      let text = row[c] ?? '';
      if (mark?.kind === 'table-blank' && mark.row === r && c === 0) text = BLANK_TEXT;
      const shade = header ? '<w:shd w:val="clear" w:color="auto" w:fill="E7E6E6"/>' : '';
      return `<w:tc><w:tcPr>${shade}<w:vAlign w:val="center"/></w:tcPr>${para(run(text, { bold: header }), { align: header ? 'center' : undefined })}</w:tc>`;
    }).join('');
    return `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells}</w:tr>`;
  }).join('');
  const ind = block.level ? block.level * em : 0;
  const width = Math.round(contentWidth - ind);
  return `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:tblInd w:w="${Math.round(ind)}" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${`<w:gridCol w:w="${Math.floor(width / cols)}"/>`.repeat(cols)}</w:tblGrid>${rows}</w:tbl>`;
}

export function buildDocumentXml(doc) {
  const s = doc.settings;
  const size = Number(s.size) || 12;
  const em = size * 20; // 전각 1자 = 글자 크기(pt) × 20 twips
  const internal = doc.kind === 'internal';
  const markers = computeMarkers(doc.blocks);
  const mark = endMark(doc);
  const out = [];
  const endRun = run(`  ${END_TEXT}`);

  // 두문
  if (doc.org.slogan) out.push(para(run(doc.org.slogan, { size: size - 2 }), { align: 'center' }));
  if (!internal || doc.org.name) out.push(para(run(doc.org.name, { bold: true, size: size * 1.6 }), { align: 'center', after: em * 0.8 }));
  const head = 4 * em;
  out.push(para(`${run('수신')}${TAB}${run(doc.recipient.to)}`, { left: head, hanging: head, tabs: [head] }));
  out.push(para(`${run('(경유)')}${TAB}${run(doc.recipient.via)}`, { left: head, hanging: head, tabs: [head] }));
  out.push(para(`${run('제목', { bold: true })}${TAB}${run(doc.title, { bold: true })}`, { left: head, hanging: head, tabs: [head], border: { bottom: 6 }, after: em * 0.6 }));

  // 본문
  for (const b of doc.blocks) {
    if (b.type === 'table') {
      out.push(tableXml(b, em, mark?.blockId === b.id ? mark : null, (210 - s.margins.left - s.margins.right) * MM));
      if (mark?.kind === 'table-below' && mark.blockId === b.id) out.push(para(run(END_TEXT), { left: em }));
      else out.push(para('', {}));
      continue;
    }
    const isEnd = mark?.kind === 'block' && mark.blockId === b.id;
    if (!b.level) {
      out.push(para(run(b.text) + (isEnd ? endRun : '')));
      continue;
    }
    const marker = markers.get(b.id) || '';
    const hang = (textWidthEm(marker) + 0.5) * em;
    const left = indentEm(b.level) * em + hang;
    out.push(para(`${run(marker)}${TAB}${run(b.text)}${isEnd ? endRun : ''}`, { left, hanging: hang, tabs: [left] }));
  }

  // 붙임
  const atts = attachmentLines(doc);
  if (atts.length) {
    const label = 3 * em; // '붙임' + 2타
    atts.forEach((a, n) => {
      const hang = a.marker ? (textWidthEm(a.marker) + 0.5) * em : 0;
      const left = label + hang;
      const isEnd = mark?.kind === 'attachment' && mark.index === a.index;
      const lead = n === 0 ? `${run('붙임')}${TAB}` : '';
      const content = `${lead}${a.marker ? `${run(a.marker)}${TAB}` : ''}${run(a.text)}${isEnd ? endRun : ''}`;
      out.push(para(content, { left, hanging: n === 0 ? left : hang, tabs: [label, left], before: n === 0 ? em * 0.6 : 0 }));
    });
  }

  // 결문
  if (!internal && doc.sender.name) {
    const seal = { stamp: '  (인)', omit: '  관인생략', signOmit: '  서명생략' }[doc.sender.seal] || '';
    out.push(para(run(doc.sender.name, { bold: true, size: size * 1.5 }) + (seal ? run(seal, { size: size - 1, color: doc.sender.seal === 'stamp' ? 'C00000' : undefined }) : ''),
      { align: 'center', before: em * 2.5, after: em * 1.2 }));
  } else {
    out.push(para('', { before: em * 2 }));
  }
  if (showsRecipientList(doc)) {
    const label = 4 * em;
    out.push(para(`${run('수신자')}${TAB}${run(recipientListText(doc))}`, { left: label, hanging: label, tabs: [label], after: em * 0.4 }));
  }
  const f = footerInfo(doc);
  const fs = 10;
  const gap = '    ';
  out.push(para(run(f.signers.join(gap), { size: fs }), { border: { top: 18 }, before: em * 0.4 }));
  if (f.cooperators.length) out.push(para(run(`협조자${gap}${f.cooperators.join(gap)}`, { size: fs })));
  out.push(para(run(`시행  ${f.enforce}${gap}접수  ${f.receive}`, { size: fs })));
  if (!internal) {
    out.push(para(run([f.address, f.homepage].filter(Boolean).join('  /  '), { size: fs })));
    const tel = [f.phone ? `전화번호 ${f.phone}` : '', f.fax ? `팩스번호 ${f.fax}` : ''].filter(Boolean).join('  ');
    out.push(para(run([tel, f.email, f.disclosure].filter(Boolean).join('  /  '), { size: fs }), { border: { bottom: 6 } }));
  } else {
    out.push(para(run(f.disclosure, { size: fs }), { border: { bottom: 6 } }));
  }

  const m = s.margins;
  const sect = `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${Math.round(m.top * MM)}" w:right="${Math.round(m.right * MM)}" w:bottom="${Math.round(m.bottom * MM)}" w:left="${Math.round(m.left * MM)}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${out.join('')}${sect}</w:body></w:document>`;
}

function stylesXml(doc) {
  const s = doc.settings;
  const font = (FONTS.find((f) => f.id === s.font) || FONTS[0]).docx;
  const size = Math.round((Number(s.size) || 12) * 2);
  const line = Math.round((Number(s.lineHeight) || 160) / 100 * 240);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${esc(font)}" w:hAnsi="${esc(font)}" w:eastAsia="${esc(font)}" w:cs="${esc(font)}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="${line}" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;
}

export function buildDocx(doc) {
  return zipStore([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'word/document.xml', data: buildDocumentXml(doc) },
    { name: 'word/styles.xml', data: stylesXml(doc) },
  ]);
}

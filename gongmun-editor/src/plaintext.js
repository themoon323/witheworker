// 공문을 일반 텍스트로 바꾼다. 온-나라·한글·메일에 붙여 넣을 때 쓴다.
// 항목은 수준마다 2타(공백 2칸)씩 들여 쓰고, '끝.' 표시를 규정 위치에 붙인다.
import { computeMarkers } from './numbering.js';
import { endMark, attachmentLines, footerInfo, recipientListText, showsRecipientList, END_TEXT, BLANK_TEXT } from './layout.js';

export function docToPlainText(doc, { withFooter = false } = {}) {
  const markers = computeMarkers(doc.blocks);
  const mark = endMark(doc);
  const lines = [];
  if (doc.org.name) lines.push(doc.org.name, '');
  lines.push(`수신  ${doc.recipient.to}`);
  lines.push(`(경유)${doc.recipient.via ? ` ${doc.recipient.via}` : ''}`);
  lines.push(`제목  ${doc.title}`, '');

  for (const b of doc.blocks) {
    if (b.type === 'table') {
      const blankRow = mark?.kind === 'table-blank' && mark.blockId === b.id ? mark.row : -1;
      b.rows.forEach((row, r) => {
        const cells = r === blankRow ? [BLANK_TEXT] : row;
        lines.push(`| ${cells.map((c) => c.replace(/\n/g, ' ')).join(' | ')} |`);
      });
      if (mark?.kind === 'table-below' && mark.blockId === b.id) lines.push(`  ${END_TEXT}`);
      continue;
    }
    const isEnd = mark?.kind === 'block' && mark.blockId === b.id;
    const indent = b.level > 1 ? '  '.repeat(b.level - 1) : '';
    const marker = b.level ? `${markers.get(b.id)} ` : '';
    lines.push(`${indent}${marker}${b.text.replace(/\n/g, ' ')}${isEnd ? `  ${END_TEXT}` : ''}`);
  }

  const atts = attachmentLines(doc);
  if (atts.length) {
    lines.push('');
    atts.forEach((a, n) => {
      const isEnd = mark?.kind === 'attachment' && mark.index === a.index;
      const lead = n === 0 ? '붙임  ' : '      ';
      lines.push(`${lead}${a.marker ? `${a.marker} ` : ''}${a.text}${isEnd ? `  ${END_TEXT}` : ''}`);
    });
  }

  if (withFooter) {
    if (doc.kind !== 'internal' && doc.sender.name) lines.push('', '', doc.sender.name);
    if (showsRecipientList(doc)) lines.push('', `수신자  ${recipientListText(doc)}`);
    const f = footerInfo(doc);
    lines.push('', f.signers.join('   '));
    if (f.cooperators.length) lines.push(`협조자  ${f.cooperators.join('   ')}`);
    lines.push(`시행  ${f.enforce}   접수  ${f.receive}`);
    if (doc.kind !== 'internal') {
      const addr = [f.address, f.homepage].filter(Boolean).join(' / ');
      if (addr) lines.push(addr);
      const tel = [f.phone ? `전화번호 ${f.phone}` : '', f.fax ? `팩스번호 ${f.fax}` : ''].filter(Boolean).join('  ');
      lines.push([tel, f.email, f.disclosure].filter(Boolean).join(' / '));
    }
  }
  return lines.join('\n');
}

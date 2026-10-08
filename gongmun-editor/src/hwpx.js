// 공문을 한글 문서(HWPX, OWPML)로 내보낸다.
import { computeMarkers } from './numbering.js';
import { FONTS } from './model.js';
import { textWidthEm } from './docx.js';
import { docToPlainText } from './plaintext.js';
import {
  endMark, attachmentLines, footerInfo, recipientListText, showsRecipientList, indentEm, END_TEXT, BLANK_TEXT,
} from './layout.js';
import { Styles, Writer, sectionRun, packHwpx, tableXml, mm } from './hwpxCore.js';

const THIN = '0.12 mm';

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
  const B = {
    cell: styles.border({ left: THIN, right: THIN, top: THIN, bottom: THIN }),
    headCell: styles.border({ left: THIN, right: THIN, top: THIN, bottom: THIN }, '#E7E6E6'),
    titleLine: styles.border({ bottom: THIN }),
    footTop: styles.border({ top: '0.4 mm' }),
    footBottom: styles.border({ bottom: THIN }),
  };
  const w = new Writer(styles, { line });
  const P = (opt, runs) => w.p(opt, runs.map((r) => (r.raw ? r : { char: r.char ?? base, text: r.text })));
  const end = `  ${END_TEXT}`;

  // 쪽 설정: A4, 공문 여백(머리말·꼬리말 영역 없음)
  const secRun = sectionRun(styles, { margins: { ...m, header: 0, footer: 0 }, char: base });

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
  P({ left: 0, hang: head, next: em * 0.6, border: B.titleLine, borderBottom: 283 }, [{ char: bold, text: `제목\t${doc.title}` }]);

  // 본문
  for (const b of doc.blocks) {
    if (b.type === 'table') {
      const indent = b.level ? b.level * em : 0;
      gongmunTable(w, b, { styles, size, line, width: contentWidth - indent, indent, mark: mark?.blockId === b.id ? mark : null, B });
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
  attachmentLines(doc).forEach((a, n) => {
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
    const opt = { align: 'LEFT', line: 150 };
    if (i === 0) Object.assign(opt, { border: B.footTop, borderTop: 283, prev: em * 0.4 });
    if (i === lines.length - 1 && i !== 0) Object.assign(opt, { border: B.footBottom, borderBottom: 283 });
    P(opt, [{ char: small, text: t }]);
  });

  return w.xml();
}

function gongmunTable(w, b, { styles, size, width, indent, mark, B }) {
  const cols = Math.max(...b.rows.map((r) => r.length));
  const colW = Math.floor(width / cols);
  const colWidths = Array.from({ length: cols }, (_, c) => (c === cols - 1 ? width - colW * (cols - 1) : colW));
  const blankRow = mark?.kind === 'table-blank' ? mark.row : -1;
  const cellText = styles.char({ size: size * 0.95 });
  const cellBold = styles.char({ size: size * 0.95, bold: true });
  const leftPara = styles.para({ align: 'LEFT', line: 130 });
  const centerPara = styles.para({ align: 'CENTER', line: 130 });
  const rowHeights = [];
  const rows = b.rows.map((row, r) => {
    const header = b.header && r === 0;
    const texts = Array.from({ length: cols }, (_, c) => (r === blankRow && c === 0 && !(row[c] || '').trim() ? BLANK_TEXT : row[c] ?? ''));
    const lineCount = Math.max(1, ...texts.map((t) => t.split('\n').length));
    rowHeights.push(Math.round(lineCount * size * 100 * 1.3 + 282));
    return texts.map((t) => ({ text: t, header, char: header ? cellBold : cellText, para: header ? centerPara : leftPara, border: header ? B.headCell : B.cell }));
  });
  tableXml(w, {
    rows, colWidths, rowHeights, borderId: B.cell, repeatHeader: b.header,
    para: styles.para({ align: 'LEFT', left: indent, line: Number(b.line) || 160, prev: 140, next: 140 }), char: cellText,
  });
}

export function buildHwpx(doc, now = new Date()) {
  const styles = new Styles();
  styles.renameBaseFont((FONTS.find((f) => f.id === doc.settings.font) || FONTS[0]).docx);
  const section = buildSectionXml(doc, styles);
  return packHwpx({ header: styles.header(), section, title: doc.title, preview: docToPlainText(doc), now });
}

// 화면 미리보기와 DOCX 내보내기가 함께 쓰는 공문 배치 규칙
import { formatIsoDate } from './format.js';

// '끝.' 표시 위치
// - 붙임이 있으면 붙임 마지막 줄 끝에 2타 띄우고 '끝.'
// - 본문이 문장으로 끝나면 마지막 문장 끝에 2타 띄우고 '끝.'
// - 표의 마지막 칸까지 작성했으면 표 아래 왼쪽 기본선에서 1자 띄우고 '끝.'
// - 표 중간에서 끝나면 기재 사항 다음 칸에 '이하 빈칸'
export function endMark(doc) {
  const atts = doc.attachments.map((a, i) => [a, i]).filter(([a]) => a.trim());
  if (atts.length) return { kind: 'attachment', index: atts[atts.length - 1][1] };
  for (let i = doc.blocks.length - 1; i >= 0; i--) {
    const b = doc.blocks[i];
    if (b.type === 'table') {
      let lastFilled = -1;
      b.rows.forEach((row, r) => { if (row.some((c) => c.trim())) lastFilled = r; });
      if (lastFilled < 0) continue;
      if (lastFilled < b.rows.length - 1) return { kind: 'table-blank', blockId: b.id, row: lastFilled + 1 };
      return { kind: 'table-below', blockId: b.id };
    }
    if (b.text.trim()) return { kind: 'block', blockId: b.id };
  }
  return null;
}

export const END_TEXT = '끝.';
export const BLANK_TEXT = '이하 빈칸';

// 붙임 목록: 하나면 번호 없이, 둘 이상이면 1. 2. … 을 붙인다. 끝에 온점이 없으면 찍는다.
export function attachmentLines(doc) {
  const atts = doc.attachments.map((a, i) => ({ text: a.trim(), index: i })).filter((a) => a.text);
  return atts.map((a, n) => ({
    index: a.index,
    marker: atts.length > 1 ? `${n + 1}.` : '',
    text: /[.。]$/.test(a.text) ? a.text : `${a.text}.`,
  }));
}

export function disclosureText(contact) {
  if (contact.disclosure === '공개' || !contact.disclosure) return '공개';
  const no = (contact.disclosureReason || '').match(/^\d+/);
  return no ? `${contact.disclosure}(${no[0]})` : contact.disclosure;
}

function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[2]}/${m[3]}` : '';
}

export function personText(p) {
  return [p.title, p.name].map((s) => (s || '').trim()).filter(Boolean).join(' ');
}

// 결문 정보
export function footerInfo(doc) {
  const a = doc.approval;
  const approver = a.approver;
  const approverText = [approver.title, approver.mark, shortDate(approver.date), approver.name]
    .map((s) => (s || '').trim()).filter(Boolean).join(' ');
  const signers = [personText(a.drafter), ...a.reviewers.map(personText), approverText].filter(Boolean);
  const cooperators = a.cooperators.map(personText).filter(Boolean);
  const e = doc.enforce;
  const r = doc.receive;
  const enforceNo = [e.dept, e.serial].filter((s) => s && s.trim()).join('-');
  const receiveNo = [r.dept, r.serial].filter((s) => s && s.trim()).join('-');
  const c = doc.contact;
  return {
    signers,
    cooperators,
    enforce: `${enforceNo}${enforceNo ? ' ' : ''}(${formatIsoDate(e.date)})`,
    receive: `${receiveNo}${receiveNo ? ' ' : ''}(${formatIsoDate(r.date)})`,
    address: [c.zip ? `우 ${c.zip}` : '', c.address].filter(Boolean).join('  '),
    homepage: c.homepage,
    phone: c.phone,
    fax: c.fax,
    email: c.email,
    disclosure: disclosureText(c),
  };
}

export function recipientListText(doc) {
  return doc.recipient.list.map((s) => s.trim()).filter(Boolean).join(', ');
}

export function showsRecipientList(doc) {
  return doc.kind !== 'internal' && doc.recipient.to.trim() === '수신자 참조';
}

// 항목 기호 + 1타 뒤 내용이 시작하는 위치(전각 문자 단위). 들여쓰기 = (수준-1)자
export function indentEm(level) {
  return level > 0 ? level - 1 : 0;
}

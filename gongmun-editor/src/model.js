// 공문서 데이터 모델과 서식(템플릿)
import { todayIso } from './format.js';

export const DOC_VERSION = 1;

let seq = 0;
export function uid(prefix = 'b') {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function item(level, text = '') {
  return { id: uid(), type: 'item', level, text };
}

export function table(rows, level = 0) {
  return { id: uid(), type: 'table', level, header: true, rows };
}

export const FONTS = [
  { id: 'batang', label: '바탕(명조)', css: '"HCR Batang", "함초롬바탕", "휴먼명조", "Batang", "바탕", "Noto Serif KR", serif', docx: '바탕' },
  { id: 'hcr', label: '함초롬바탕', css: '"HCR Batang", "함초롬바탕", "Batang", "Noto Serif KR", serif', docx: '함초롬바탕' },
  { id: 'humanmj', label: '휴먼명조', css: '"휴먼명조", "HCR Batang", "Batang", "Noto Serif KR", serif', docx: '휴먼명조' },
  { id: 'dotum', label: '돋움(고딕)', css: '"HCR Dotum", "함초롬돋움", "Dotum", "돋움", "Malgun Gothic", "Noto Sans KR", sans-serif', docx: '돋움' },
  { id: 'malgun', label: '맑은 고딕', css: '"Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif', docx: '맑은 고딕' },
];

// 정보공개법 제9조제1항 각 호
export const DISCLOSURE_REASONS = [
  '1호(다른 법령상 비밀)', '2호(국가안전보장 등)', '3호(국민의 생명·신체 등)', '4호(재판·수사 등)',
  '5호(감사·감독·검사 등 업무 수행)', '6호(개인정보)', '7호(법인 등의 경영·영업상 비밀)', '8호(부동산 투기 등)',
];

export function blankDoc() {
  return {
    version: DOC_VERSION,
    kind: 'external', // external: 시행문(대외 발송), internal: 내부결재
    org: { slogan: '', name: '○○시' },
    recipient: { to: '', via: '', list: [] },
    title: '',
    blocks: [item(1, '')],
    attachments: [],
    sender: { name: '○○시장', seal: 'omit' }, // seal: 'stamp' 관인 날인 표시, 'omit' 직인생략, 'none' 표시 안 함
    approval: {
      drafter: { title: '주무관', name: '' },
      reviewers: [{ title: '팀장', name: '' }],
      approver: { title: '과장', name: '', mark: '전결', date: '' },
      cooperators: [],
    },
    enforce: { dept: '○○과', serial: '', date: todayIso() },
    receive: { dept: '', serial: '', date: '' },
    contact: {
      zip: '', address: '', homepage: '',
      phone: '', fax: '', email: '',
      disclosure: '공개', disclosureReason: '',
    },
    settings: {
      font: 'batang', size: 12, lineHeight: 160,
      margins: { top: 30, right: 15, bottom: 15, left: 20 },
      weekdayInDates: false,
    },
  };
}

// 저장된 문서를 불러올 때 빠진 필드를 기본값으로 채운다.
export function normalizeDoc(raw) {
  const base = blankDoc();
  if (!raw || typeof raw !== 'object') return base;
  const merge = (def, val) => {
    if (Array.isArray(def)) return Array.isArray(val) ? val : def;
    if (def && typeof def === 'object') {
      const out = {};
      for (const k of Object.keys(def)) out[k] = merge(def[k], val ? val[k] : undefined);
      return out;
    }
    return val === undefined || val === null ? def : val;
  };
  const doc = merge(base, raw);
  doc.blocks = (raw.blocks || []).filter((b) => b && (b.type === 'item' || b.type === 'table')).map((b) => {
    if (b.type === 'table') {
      const rows = Array.isArray(b.rows) && b.rows.length ? b.rows.map((r) => r.map((c) => String(c ?? ''))) : [['', ''], ['', '']];
      return { id: b.id || uid(), type: 'table', level: Number(b.level) || 0, header: b.header !== false, rows };
    }
    return { id: b.id || uid(), type: 'item', level: Math.max(0, Math.min(8, Number(b.level) || 0)), text: String(b.text ?? '') };
  });
  if (!doc.blocks.length) doc.blocks = [item(1, '')];
  doc.attachments = (raw.attachments || []).map((a) => String(a ?? ''));
  doc.recipient.list = (raw.recipient?.list || []).map((a) => String(a ?? ''));
  doc.approval.reviewers = (raw.approval?.reviewers || base.approval.reviewers).map((p) => ({ title: p.title || '', name: p.name || '' }));
  doc.approval.cooperators = (raw.approval?.cooperators || []).map((p) => ({ title: p.title || '', name: p.name || '' }));
  doc.version = DOC_VERSION;
  return doc;
}

function withBody(fields, blocks, attachments = []) {
  const doc = blankDoc();
  Object.assign(doc, fields);
  doc.blocks = blocks;
  doc.attachments = attachments;
  return doc;
}

export const TEMPLATES = [
  {
    id: 'blank',
    name: '빈 문서',
    desc: '처음부터 작성',
    make: () => blankDoc(),
  },
  {
    id: 'cooperation',
    name: '협조 요청',
    desc: '다른 기관에 업무 협조를 요청하는 시행문',
    make: () => withBody({ title: '○○ 사업 추진을 위한 자료 협조 요청', recipient: { to: '○○도지사(○○과장)', via: '', list: [] } }, [
      item(1, '관련: ○○과-1234(2026. 9. 1.)'),
      item(1, '위 호와 관련하여 우리 시에서는 ○○ 사업을 추진하고 있습니다. 사업의 원활한 추진을 위하여 아래와 같이 자료를 요청하오니 협조하여 주시기 바랍니다.'),
      item(2, '요청 자료: ○○ 현황(붙임 서식)'),
      item(2, '제출 기한: 2026. 10. 20.(화)까지'),
      item(2, '제출 방법: 공문 및 전자우편(담당자 전자우편)'),
    ], ['자료 제출 서식 1부.']),
  },
  {
    id: 'submission',
    name: '자료 제출 요청',
    desc: '여러 기관에 같은 자료를 요청 (수신자 참조)',
    make: () => withBody({ title: '2026년 ○○ 실태 조사 자료 제출 요청', recipient: { to: '수신자 참조', via: '', list: ['○○구청장', '○○군수', '○○구청장'] } }, [
      item(1, '관련: 「○○법」 제○조'),
      item(1, '2026년 ○○ 실태 조사를 위하여 다음과 같이 자료를 요청하오니 기한 내에 제출하여 주시기 바랍니다.'),
      item(2, '조사 기준일: 2026. 9. 30.'),
      item(2, '제출 기한: 2026. 10. 23.(금) 18:00까지'),
      item(2, '제출 자료'),
      item(3, '○○ 현황표(붙임 1 서식)'),
      item(3, '○○ 추진 실적(붙임 2 서식)'),
    ], ['○○ 현황표 서식 1부.', '○○ 추진 실적 서식 1부.']),
  },
  {
    id: 'meeting',
    name: '회의·행사 개최 알림',
    desc: '일시·장소·참석 대상을 안내',
    make: () => withBody({ title: '2026년 ○○ 업무 담당자 회의 개최 알림', recipient: { to: '수신자 참조', via: '', list: ['○○구청장(○○과장)', '○○군수(○○과장)'] } }, [
      item(1, '○○ 업무의 효율적 추진을 위하여 다음과 같이 담당자 회의를 개최하오니 참석하여 주시기 바랍니다.'),
      item(2, '일시: 2026. 10. 15.(목) 14:00~16:00'),
      item(2, '장소: ○○시청 3층 대회의실'),
      item(2, '참석 대상: 시·군·구 ○○ 업무 담당자 각 1명'),
      item(2, '주요 내용'),
      item(3, '2026년 ○○ 추진 실적 점검'),
      item(3, '2027년 ○○ 추진 계획 협의'),
      item(1, '참석자 명단은 2026. 10. 12.(월)까지 전자우편으로 알려 주시기 바랍니다.'),
    ], ['회의 자료 1부.']),
  },
  {
    id: 'reply',
    name: '회신',
    desc: '받은 공문에 대한 답변',
    make: () => withBody({ title: '○○ 자료 제출(회신)', recipient: { to: '○○도지사(○○과장)', via: '', list: [] } }, [
      item(1, '관련: ○○도 ○○과-5678(2026. 9. 25.)'),
      item(1, '위 호와 관련하여 우리 시의 ○○ 자료를 붙임과 같이 제출합니다.'),
    ], ['○○ 자료 1부.']),
  },
  {
    id: 'internal-plan',
    name: '계획 보고(내부결재)',
    desc: '사업 계획을 내부결재로 보고',
    make: () => {
      const doc = withBody({ kind: 'internal', title: '2026년 ○○ 교육 운영 계획', recipient: { to: '내부결재', via: '', list: [] } }, [
        item(0, '2026년 ○○ 교육을 다음과 같이 운영하고자 합니다.'),
        item(1, '교육 개요'),
        item(2, '기간: 2026. 11. 2.(월)~11. 6.(금)'),
        item(2, '대상: ○○ 업무 담당 공무원 30명'),
        item(2, '장소: ○○교육원'),
        item(1, '소요 예산: 금3,000,000원(금삼백만원)'),
        item(2, '예산 과목: ○○ 운영 > 일반운영비 > 사무관리비'),
        item(2, '산출 근거: 강사 수당 등(붙임 참조)'),
        item(1, '교육 일정'),
        table([['구분', '시간', '내용', '강사'], ['1일 차', '9:00~12:00', '○○ 제도 이해', '○○과장'], ['2일 차', '13:00~17:00', '○○ 실무 실습', '외부 강사']], 1),
      ], ['교육 세부 계획 1부.']);
      doc.sender.name = '';
      return doc;
    },
  },
];

// 행정용어 순화 목록 (국립국어원·행정안전부 행정용어 순화 자료를 바탕으로 자주 쓰이는 것만 추림)
// pattern이 있으면 정규식으로, 없으면 from 문자열 그대로 찾는다. to는 바꿀 말 후보(첫째가 기본값).

export const GLOSSARY = [
  // 어려운 한자어
  { from: '가일층', to: ['한층 더', '더욱'] },
  { from: '감안하여', to: ['고려하여', '생각하여'] },
  { from: '견양', to: ['서식', '본보기'] },
  { from: '공람', to: ['돌려 봄', '함께 봄'], info: true },
  { from: '구랍', to: ['지난해 12월'] },
  { from: '금번', to: ['이번'] },
  { from: '금일', to: ['오늘'] },
  { from: '명일', to: ['내일'] },
  { from: '작일', to: ['어제'] },
  { from: '익일', to: ['다음 날'] },
  { from: '익월', to: ['다음 달'] },
  { from: '익년', to: ['다음 해'] },
  { from: '당해', to: ['해당', '그'] },
  { from: '만전을 기하', to: ['빈틈없이 하', '최선을 다하'] },
  { from: '별첨', to: ['붙임'] },
  { from: '첨부', to: ['붙임'], pattern: /첨부(?=\s|$|[와과및을를의])/g },
  { from: '불입', to: ['납부', '납입'] },
  { from: '상기', to: ['위'], pattern: /상기(?=\s|의)/g },
  { from: '하기', to: ['아래'], pattern: /(?<![가-힣])하기(?=\s*(?:와|의|사항|내용|참조))/g },
  { from: '시건장치', to: ['잠금장치'] },
  { from: '일응', to: ['우선', '일단'] },
  { from: '제반', to: ['여러', '모든'] },
  { from: '지득', to: ['알게 됨'] },
  { from: '차기', to: ['다음'] },
  { from: '필히', to: ['반드시'] },
  { from: '적의 조치', to: ['알맞게 조치'] },
  { from: '수범사례', to: ['모범 사례'] },
  { from: '시달', to: ['알림', '통보'], info: true },
  { from: '품의', to: ['건의', '여쭘'], info: true },
  { from: '내역', to: ['명세', '내용'], info: true },
  { from: '기 시행', to: ['이미 시행'] },
  { from: '기 통보', to: ['이미 알린'] },
  { from: '기 송부', to: ['이미 보낸'] },
  { from: '~토록', to: ['~하도록'], pattern: /([가-힣])(?<![그이저요])토록/g, replace: (m) => `${m[1]}하도록` },
  { from: '요망', to: ['바랍니다'], pattern: /요망(?:함|합니다)?\.?$/g, replace: () => '바랍니다.' },
  // 외국어·외래어
  { from: 'TF', to: ['전담 조직', '특별 전담 조직'], pattern: /\bTF\b(?:팀)?/g, info: true },
  { from: 'MOU', to: ['업무 협약'], pattern: /\bMOU\b/g, info: true },
  { from: '로드맵', to: ['단계별 이행안', '청사진'], info: true },
  { from: '거버넌스', to: ['민관 협력', '협치'], info: true },
  { from: '매뉴얼', to: ['지침', '설명서'], info: true },
  { from: '가이드라인', to: ['지침', '방침'], info: true },
  { from: '인프라', to: ['기반 시설', '기반'], info: true },
  { from: '컨트롤타워', to: ['지휘 본부', '통제탑'], info: true },
  { from: '벤치마킹', to: ['본따르기', '견주기'], info: true },
  { from: '피드백', to: ['의견', '반응'], info: true },
  { from: '니즈', to: ['수요', '요구'], info: true },
  { from: '이슈', to: ['쟁점', '현안'], info: true },
  { from: '원스톱', to: ['한자리', '통합'], info: true },
  { from: '홈페이지', to: ['누리집'], info: true },
  { from: '스케줄', to: ['일정'], info: true },
  { from: '프로세스', to: ['절차', '과정'], info: true },
  { from: '모니터링', to: ['점검', '관찰'], info: true },
  { from: '리스크', to: ['위험'], info: true },
  { from: '인센티브', to: ['유인책', '성과 보상'], info: true },
  { from: '컨설팅', to: ['상담', '자문'], info: true },
];

// 텍스트에서 순화 대상 낱말을 찾는다. 반환: [{start, end, found, to, info, replacement}]
export function findGlossaryTerms(text) {
  const hits = [];
  for (const entry of GLOSSARY) {
    const re = entry.pattern
      ? new RegExp(entry.pattern.source, entry.pattern.flags.includes('g') ? entry.pattern.flags : entry.pattern.flags + 'g')
      : new RegExp(entry.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    let m;
    while ((m = re.exec(text))) {
      if (m[0] === '') { re.lastIndex++; continue; }
      const replacement = entry.replace ? entry.replace(m) : entry.to[0];
      hits.push({ start: m.index, end: m.index + m[0].length, found: m[0], to: entry.to, info: !!entry.info, replacement });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

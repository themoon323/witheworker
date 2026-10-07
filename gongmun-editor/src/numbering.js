// 항목 구분 기호: 1. → 가. → 1) → 가) → (1) → (가) → ① → ㉮
// 둘째 항목부터는 상위 항목 위치에서 오른쪽으로 2타(한글 1자)씩 옮겨 시작한다.

export const MAX_LEVEL = 8;

export const LEVEL_NAMES = ['문단', '1.', '가.', '1)', '가)', '(1)', '(가)', '①', '㉮'];

// ㄱ ㄴ ㄷ ㄹ ㅁ ㅂ ㅅ ㅇ ㅈ ㅊ ㅋ ㅌ ㅍ ㅎ 의 초성 인덱스
const CHO = [0, 2, 3, 5, 6, 7, 9, 11, 12, 14, 15, 16, 17, 18];
// ㅏ ㅓ ㅗ ㅜ ㅡ ㅣ 의 중성 인덱스 — 가~하 다음에는 거~허, 고~호 … 순으로 이어 쓴다.
const JUNG = [0, 4, 8, 13, 18, 20];

export function hangulSeq(n) {
  const i = n - 1;
  const jung = JUNG[Math.floor(i / CHO.length)];
  if (jung === undefined) return String(n);
  return String.fromCharCode(0xac00 + (CHO[i % CHO.length] * 21 + jung) * 28);
}

const HANGUL_SEQ = Array.from({ length: CHO.length * JUNG.length }, (_, i) => hangulSeq(i + 1));

export function circledNumber(n) {
  if (n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1);
  if (n >= 21 && n <= 35) return String.fromCharCode(0x3251 + n - 21);
  if (n >= 36 && n <= 50) return String.fromCharCode(0x32b1 + n - 36);
  return `(${n})`;
}

export function circledHangul(n) {
  if (n >= 1 && n <= 14) return String.fromCharCode(0x326e + n - 1);
  return `(${hangulSeq(n)})`;
}

export function markerFor(level, n) {
  switch (level) {
    case 1: return `${n}.`;
    case 2: return `${hangulSeq(n)}.`;
    case 3: return `${n})`;
    case 4: return `${hangulSeq(n)})`;
    case 5: return `(${n})`;
    case 6: return `(${hangulSeq(n)})`;
    case 7: return circledNumber(n);
    case 8: return circledHangul(n);
    default: return '';
  }
}

// 문서 본문 블록 배열에서 각 항목의 기호를 계산한다. 반환: Map(id → 기호)
// 상위 항목이 바뀌면 하위 번호는 다시 1부터 시작한다.
export function computeMarkers(blocks) {
  const counters = new Array(MAX_LEVEL + 1).fill(0);
  const markers = new Map();
  for (const b of blocks) {
    if (b.type !== 'item' || !b.level) continue;
    counters[b.level] += 1;
    for (let l = b.level + 1; l <= MAX_LEVEL; l++) counters[l] = 0;
    markers.set(b.id, markerFor(b.level, counters[b.level]));
  }
  return markers;
}

// 같은 상위 항목 아래의 형제 항목 묶음을 돌려준다. (항목이 하나뿐인지 검사할 때 사용)
export function siblingGroups(blocks) {
  const groups = [];
  const open = new Array(MAX_LEVEL + 1).fill(null);
  for (const b of blocks) {
    if (b.type !== 'item' || !b.level) continue;
    for (let l = b.level + 1; l <= MAX_LEVEL; l++) open[l] = null;
    if (!open[b.level]) {
      open[b.level] = [];
      groups.push({ level: b.level, ids: open[b.level] });
    }
    open[b.level].push(b.id);
  }
  return groups;
}

// 한 줄 앞부분의 항목 기호를 읽어 수준과 내용을 나눈다. 기호가 없으면 null.
const PATTERNS = [
  [1, /^(\d{1,3})\.(?:\s+|$)/],
  [2, /^([가-힣])\.(?:\s+|$)/],
  [3, /^(\d{1,3})\)\s*/],
  [4, /^([가-힣])\)\s*/],
  [5, /^\((\d{1,3})\)\s*/],
  [6, /^\(([가-힣])\)\s*/],
  [7, /^([①-⑳㉑-㉟㊱-㊿])\s*/],
  [8, /^([㉮-㉻])\s*/],
];

export function parseMarker(line) {
  const s = line.replace(/^[\s　]+/, '');
  // '2026. 10. 7.'처럼 날짜로 시작하는 줄은 항목 기호로 보지 않는다.
  if (/^\d{4}\.\s*\d{1,2}\./.test(s)) return null;
  for (const [level, re] of PATTERNS) {
    const m = re.exec(s);
    if (!m) continue;
    if ((level === 2 || level === 4 || level === 6) && !HANGUL_SEQ.includes(m[1])) continue;
    return { level, marker: m[1], text: s.slice(m[0].length) };
  }
  return null;
}

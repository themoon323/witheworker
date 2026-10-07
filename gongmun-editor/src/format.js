// 공문서 표기 규칙(행정업무운영 편람)에 맞춘 날짜·시간·금액 변환 함수

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const SMALL_UNITS = ['', '십', '백', '천'];
const BIG_UNITS = ['', '만', '억', '조', '경'];

// 유효한 날짜인지 확인한다.
export function isValidDate(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// 2026. 10. 7. 형식 (연·월·일 글자를 생략하고 온점으로 구분)
export function formatDate(y, m, d) {
  return `${y}. ${m}. ${d}.`;
}

export function weekdayOf(y, m, d) {
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

// 2026. 10. 7.(수)
export function formatDateWithWeekday(y, m, d) {
  return `${formatDate(y, m, d)}(${weekdayOf(y, m, d)})`;
}

// 'YYYY-MM-DD'(input[type=date] 값) → '2026. 10. 7.'
export function formatIsoDate(iso, withWeekday = false) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return withWeekday ? formatDateWithWeekday(y, mo, d) : formatDate(y, mo, d);
}

export function todayIso(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// 24시각제, 시·분 글자를 생략하고 쌍점으로 구분: 15:20
export function formatTime(h, min = 0) {
  return `${h}:${String(min).padStart(2, '0')}`;
}

// 오전/오후 표기를 24시각제 시로 바꾼다.
export function to24Hour(meridiem, h) {
  if (meridiem === '오후') return h === 12 ? 12 : h + 12;
  if (meridiem === '오전') return h === 12 ? 0 : h;
  return h;
}

export function withCommas(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 113560 → '일십일만삼천오백육십' (편람 예시처럼 '일십', '일백', '일천'의 '일'도 적는다)
export function amountToHangul(value) {
  let s = String(value).replace(/[^\d]/g, '').replace(/^0+/, '');
  if (!s) return '영';
  if (s.length > 20) throw new RangeError('금액이 너무 큽니다.');
  const groups = [];
  while (s.length) {
    groups.unshift(s.slice(-4));
    s = s.slice(0, -4);
  }
  let out = '';
  groups.forEach((g, gi) => {
    const big = BIG_UNITS[groups.length - 1 - gi];
    const digits = g.padStart(4, '0');
    let part = '';
    for (let i = 0; i < 4; i++) {
      const d = Number(digits[i]);
      if (d) part += DIGITS[d] + SMALL_UNITS[3 - i];
    }
    if (part) out += part + big;
  });
  return out;
}

// 113560 → '금113,560원(금일십일만삼천오백육십원)'
export function formatAmount(value) {
  const digits = String(value).replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
  if (!digits) return '';
  return `금${withCommas(digits)}원(금${amountToHangul(digits)}원)`;
}

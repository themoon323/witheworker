// PDF에서 뽑은 글자 조각(pdf.js의 textContent 항목)을 줄과 문단으로 되살린다.
// PDF에는 '줄'이나 '문단'이 없고 글자 조각의 좌표만 있으므로, 좌표로 줄을 묶고
// 줄 끝이 오른쪽 끝까지 찼는지·줄 간격·항목 기호를 보고 끊긴 줄을 이어 붙인다.
import { parseMarker } from './numbering.js';

// items: [{ str, x, y, w, size }] (y는 아래에서 위로 커지는 PDF 좌표)
export function itemsToLines(items) {
  const parts = items.filter((it) => it.str && it.str.length).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of parts) {
    const size = it.size || 10;
    let line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(l.size, size) * 0.5);
    if (!line) {
      line = { y: it.y, size, items: [] };
      lines.push(line);
    }
    line.items.push(it);
    line.size = Math.max(line.size, size);
  }
  return lines
    .map((l) => {
      const its = l.items.sort((a, b) => a.x - b.x);
      let text = '';
      let end = null;
      for (const it of its) {
        // 앞 조각 끝과 이 조각 시작 사이가 벌어져 있으면 띄어 쓴다.
        if (end !== null && it.x - end > l.size * 0.15 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
        text += it.str;
        end = it.x + (it.w || 0);
      }
      const trimmed = text.replace(/\s+/g, ' ').trim();
      const leading = its.find((it) => it.str.trim());
      return { text: trimmed, x: leading ? leading.x : its[0].x, right: end ?? its[0].x, y: l.y, size: l.size };
    })
    .filter((l) => l.text)
    .sort((a, b) => b.y - a.y);
}

const PAGE_NUMBER_RE = /^(?:[-–—]\s*\d{1,4}\s*[-–—]|\d{1,4}\s*\/\s*\d{1,4}|\d{1,4})$/;
const LABEL_RE = /^(수\s*신(?:자)?|\(경유\)|제\s*목|붙\s*임|시\s*행|접\s*수|협조자)(\s|$)/;

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// pages: [[line, ...], ...] → 문단마다 한 줄인 텍스트. 항목 기호가 있는 줄은 들여쓰기를 살린다.
export function linesToText(pages) {
  const out = [];
  let prev = null;
  for (const lines of pages) {
    const body = lines.filter((l) => !PAGE_NUMBER_RE.test(l.text));
    if (!body.length) continue;
    const left = Math.min(...body.map((l) => l.x));
    const right = Math.max(...body.map((l) => l.right));
    const gaps = [];
    for (let i = 1; i < body.length; i++) gaps.push(body[i - 1].y - body[i].y);
    const lineGap = median(gaps.filter((g) => g > 0)) || body[0].size * 1.6;
    body.forEach((l, i) => {
      const gap = i ? body[i - 1].y - l.y : 0;
      const startsNew = !prev
        || parseMarker(l.text)
        || LABEL_RE.test(l.text)
        || /^끝\.?$/.test(l.text)
        || gap > lineGap * 1.5
        // 앞줄이 오른쪽 끝까지 차지 않았으면 그 줄에서 문단이 끝난 것으로 본다.
        || prev.right < prev.pageRight - prev.size * 2
        // 가운데 정렬된 줄(기관명·발신명의)은 따로 둔다.
        || (l.x - left > (right - left) * 0.25 && l.right < right - (right - left) * 0.25);
      if (startsNew) {
        const indent = Math.max(0, Math.round((l.x - left) / l.size));
        out.push(`${'  '.repeat(Math.min(indent, 8))}${l.text}`);
      } else {
        // 한글 문서는 보통 어절 단위로 줄을 나누므로 이어 붙일 때 한 칸 띄운다.
        out[out.length - 1] += (/[-‐]$/.test(out[out.length - 1]) ? '' : ' ') + l.text;
      }
      prev = { ...l, pageRight: right };
    });
  }
  return out.join('\n');
}

// pdf.js 문서 객체에서 글자를 뽑는다. 반환: { text, pages, chars }
export async function extractPdfText(pdf) {
  const pages = [];
  let chars = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items.map((it) => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width,
      size: Math.hypot(it.transform[2], it.transform[3]) || it.height || 10,
    }));
    chars += items.reduce((n, it) => n + it.str.trim().length, 0);
    pages.push(itemsToLines(items));
  }
  return { text: linesToText(pages), pages: pdf.numPages, chars };
}

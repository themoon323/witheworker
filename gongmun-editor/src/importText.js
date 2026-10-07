// 한글·워드·메일 등에서 복사한 공문 텍스트를 구조화한다.
// 수신·(경유)·제목·붙임 줄을 알아보고, 항목 기호(1. 가. 1) …)를 읽어 수준을 정한다.
import { parseMarker } from './numbering.js';
import { item } from './model.js';

const END_RE = /\s*끝\.?\s*$/;

function stripEnd(s) {
  return s.replace(END_RE, '');
}

// 줄 단위 텍스트를 본문 블록으로 바꾼다. 기호가 없는 줄은 앞 항목에 이어지는 줄로 본다.
export function linesToBlocks(lines) {
  const blocks = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const pm = parseMarker(line);
    if (pm) {
      blocks.push(item(pm.level, pm.text.trim()));
    } else if (blocks.length && blocks[blocks.length - 1].level > 0 && /^[\s　]{2,}/.test(raw)) {
      // 들여쓴 줄은 앞 항목의 둘째 줄(줄바꿈된 내용)로 합친다.
      const last = blocks[blocks.length - 1];
      last.text = `${last.text} ${line.trim()}`;
    } else {
      blocks.push(item(0, line.trim()));
    }
  }
  return blocks;
}

// 문서 전체 텍스트를 해석한다. 반환: { org?, title?, to?, via?, blocks, attachments, endFound }
export function parsePlainDocument(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = { blocks: [], attachments: [], endFound: false };
  const body = [];
  let i = 0;
  let bodyEnded = false;
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    let m;
    if ((m = /^수\s*신\s*[:：]?\s*(.*)$/.exec(t)) && out.to === undefined) {
      out.to = m[1].trim();
      // 수신 앞의 줄은 기관 표어·행정기관명이다. 본문으로 넣지 않는다.
      const pre = body.map((l) => l.trim()).filter(Boolean);
      if (pre.length && pre[pre.length - 1].length <= 30) out.org = pre[pre.length - 1];
      body.length = 0;
      continue;
    }
    if ((m = /^\(경유\)\s*(.*)$/.exec(t))) { out.via = m[1].trim(); continue; }
    if ((m = /^제\s*목\s*[:：]?\s*(.*)$/.exec(t)) && out.title === undefined) { out.title = m[1].trim(); continue; }
    if (/^붙\s*임(\s|$)/.test(t)) break;
    if (bodyEnded) continue;
    if (END_RE.test(lines[i])) {
      // '끝.' 다음은 발신명의·결문이므로 본문에서 뺀다.
      out.endFound = true;
      bodyEnded = true;
      const rest = stripEnd(lines[i]);
      if (rest.trim()) body.push(rest);
      continue;
    }
    body.push(lines[i]);
  }
  // 붙임
  if (i < lines.length) {
    const first = lines[i].trim().replace(/^붙\s*임\s*/, '');
    const attLines = [first, ...lines.slice(i + 1).map((l) => l.trim())].filter(Boolean);
    for (const l of attLines) {
      if (/^끝\.?$/.test(l)) { out.endFound = true; break; }
      // '1. ○○ 1부.  2. ○○ 1부.'처럼 한 줄에 여러 개가 있을 수 있다.
      const parts = l.split(/\s{2,}(?=\d+\.\s)/);
      for (let p of parts) {
        if (END_RE.test(p)) { out.endFound = true; p = stripEnd(p); }
        const pm = parseMarker(p);
        const name = (pm && pm.level === 1 ? pm.text : p).trim();
        if (name) out.attachments.push(name);
      }
      if (out.endFound) break;
    }
  }
  // 본문 끝의 '끝.' 제거
  for (let j = body.length - 1; j >= 0; j--) {
    if (!body[j].trim()) continue;
    if (END_RE.test(body[j])) { out.endFound = true; body[j] = stripEnd(body[j]); }
    break;
  }
  out.blocks = linesToBlocks(body);
  return out;
}

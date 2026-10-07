// 공문 편집기 화면
import { blankDoc, normalizeDoc, item, table, TEMPLATES, FONTS, DISCLOSURE_REASONS } from './model.js';
import { computeMarkers, MAX_LEVEL, markerFor } from './numbering.js';
import { lintDoc, applyFix, locKey } from './lint.js';
import { endMark, attachmentLines, footerInfo, showsRecipientList, recipientListText, indentEm } from './layout.js';
import { parsePlainDocument } from './importText.js';
import { formatIsoDate, formatAmount, formatTime, todayIso } from './format.js';
import { buildDocx } from './docx.js';
import { docToPlainText } from './plaintext.js';

const ARTIFACT = !!window.GONGMUN_ARTIFACT;
const STORE_KEY = 'gongmun-editor.current';
const HISTORY_LIMIT = 200;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const EDITABLE = (() => {
  try {
    const d = document.createElement('div');
    d.contentEditable = 'plaintext-only';
    return d.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true';
  } catch { return 'true'; }
})();

const state = {
  doc: loadStored() || TEMPLATES.find((t) => t.id === 'meeting').make(),
  past: [],
  future: [],
  issues: [],
  lastTyping: 0,
  lastKey: null, // 마지막으로 편집한 칸 (도구 패널의 '넣기'에 씀)
  lastSel: [0, 0],
  saveTimer: 0,
  lintTimer: 0,
};

// ───────── 저장 ─────────
function loadStored() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? normalizeDoc(JSON.parse(raw)) : null;
  } catch { return null; }
}

function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state.doc));
      const now = new Date();
      $('#save-status').textContent = `자동 저장 ${formatTime(now.getHours(), now.getMinutes())}`;
    } catch {
      $('#save-status').textContent = '';
    }
  }, 400);
}

// ───────── 되돌리기 ─────────
// 바꾸기 직전에 호출한다. 이어서 타자를 치는 동안에는 한 번만 기록한다.
function remember(kind = 'edit') {
  const now = Date.now();
  if (kind === 'typing' && now - state.lastTyping < 1200) { state.lastTyping = now; return; }
  state.lastTyping = kind === 'typing' ? now : 0;
  state.past.push(JSON.stringify(state.doc));
  if (state.past.length > HISTORY_LIMIT) state.past.shift();
  state.future = [];
  updateUndoButtons();
}

function changed({ sheet = false, panel = false } = {}) {
  if (sheet) renderSheet();
  if (panel) syncPanel();
  else refreshDynamic();
  scheduleSave();
  scheduleLint();
}

function undo() {
  if (!state.past.length) return;
  state.future.push(JSON.stringify(state.doc));
  state.doc = normalizeDoc(JSON.parse(state.past.pop()));
  state.lastTyping = 0;
  changed({ sheet: true, panel: true });
  updateUndoButtons();
}

function redo() {
  if (!state.future.length) return;
  state.past.push(JSON.stringify(state.doc));
  state.doc = normalizeDoc(JSON.parse(state.future.pop()));
  state.lastTyping = 0;
  changed({ sheet: true, panel: true });
  updateUndoButtons();
}

function updateUndoButtons() {
  $('#btn-undo').disabled = !state.past.length;
  $('#btn-redo').disabled = !state.future.length;
}

function replaceDoc(doc, message) {
  remember();
  state.doc = normalizeDoc(doc);
  changed({ sheet: true, panel: true });
  if (message) toast(message);
}

// ───────── 편집 칸의 텍스트와 커서 ─────────
function readText(el) {
  let out = '';
  const walk = (node) => {
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) out += ch.data;
      else if (ch.nodeName === 'BR') out += '\n';
      else if (ch.nodeType === 1) { if (ch.nodeName === 'DIV' && out && !out.endsWith('\n')) out += '\n'; walk(ch); }
    }
  };
  walk(el);
  if (el.lastChild && el.lastChild.nodeName === 'BR') out = out.slice(0, -1);
  return out;
}

function writeText(el, text) {
  el.textContent = text;
  // 끝이 줄바꿈이면 빈 줄이 보이도록 <br>을 덧붙인다.
  if (text.endsWith('\n')) el.appendChild(document.createElement('br'));
}

function offsetIn(el, node, nodeOffset) {
  const r = document.createRange();
  r.selectNodeContents(el);
  try { r.setEnd(node, nodeOffset); } catch { return 0; }
  const frag = r.cloneContents();
  const tmp = document.createElement('div');
  tmp.appendChild(frag);
  return readTextRaw(tmp);
}

function readTextRaw(el) {
  let n = 0;
  const walk = (node) => {
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) n += ch.data.length;
      else if (ch.nodeName === 'BR') n += 1;
      else if (ch.nodeType === 1) walk(ch);
    }
  };
  walk(el);
  return n;
}

function getSel(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return [0, 0];
  const r = sel.getRangeAt(0);
  if (!el.contains(r.startContainer)) return [0, 0];
  const s = offsetIn(el, r.startContainer, r.startOffset);
  const e = r.collapsed ? s : offsetIn(el, r.endContainer, r.endOffset);
  return [s, e];
}

function locate(el, offset) {
  let rest = offset;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let last = null;
  while (walker.nextNode()) {
    const t = walker.currentNode;
    if (rest <= t.data.length) return [t, rest];
    rest -= t.data.length;
    last = t;
  }
  return last ? [last, last.data.length] : [el, el.childNodes.length && el.lastChild.nodeName === 'BR' ? el.childNodes.length - 1 : el.childNodes.length];
}

function setSel(el, s, e = s) {
  el.focus({ preventScroll: true });
  const sel = window.getSelection();
  const r = document.createRange();
  const [sn, so] = locate(el, s);
  const [en, eo] = locate(el, e);
  r.setStart(sn, so);
  r.setEnd(en, eo);
  sel.removeAllRanges();
  sel.addRange(r);
}

function focusKey(key, offset = 0, end = offset) {
  const el = $(`[data-key="${CSS.escape(key)}"]`);
  if (!el) return;
  const len = readText(el).length;
  const s = offset === Infinity ? len : Math.min(offset, len);
  const e = end === Infinity ? len : Math.min(end, len);
  setSel(el, s, e);
  el.scrollIntoView({ block: 'nearest' });
}

function caretOnFirstLine(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return true;
  const rect = sel.getRangeAt(0).getClientRects()[0];
  if (!rect) return getSel(el)[0] === 0;
  return rect.top - el.getBoundingClientRect().top < rect.height * 0.8;
}

function caretOnLastLine(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return true;
  const rects = sel.getRangeAt(0).getClientRects();
  const rect = rects[rects.length - 1];
  if (!rect) return getSel(el)[0] === readText(el).length;
  return el.getBoundingClientRect().bottom - rect.bottom < rect.height * 0.8;
}

// ───────── 문서 그리기 ─────────
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.setAttribute('style', v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

function editable(key, text, attrs = {}) {
  const el = h(attrs.tag || 'div', { class: attrs.class, 'data-key': key, 'data-placeholder': attrs.placeholder, contenteditable: EDITABLE, spellcheck: 'false' });
  writeText(el, text || '');
  return el;
}

function fontCss() {
  return (FONTS.find((f) => f.id === state.doc.settings.font) || FONTS[0]).css;
}

function applyPageStyle() {
  const s = state.doc.settings;
  const m = s.margins;
  const sheet = $('#sheet');
  sheet.style.padding = `${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm`;
  sheet.style.fontFamily = fontCss();
  sheet.style.fontSize = `${Number(s.size) || 12}pt`;
  sheet.style.lineHeight = `${(Number(s.lineHeight) || 160) / 100}`;
  $('#page-style').textContent = `@page { size: A4; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }`;
}

function renderSheet() {
  const doc = state.doc;
  const sheet = $('#sheet');
  const active = document.activeElement?.dataset?.key && sheet.contains(document.activeElement)
    ? { key: document.activeElement.dataset.key, sel: getSel(document.activeElement) } : null;
  applyPageStyle();
  sheet.replaceChildren();
  const internal = doc.kind === 'internal';

  sheet.append(editable('org.slogan', doc.org.slogan, { class: 'slogan', placeholder: '기관 표어(선택)' }));
  sheet.append(editable('org.name', doc.org.name, { class: 'org-name', placeholder: '행정기관명' }));
  sheet.append(h('div', { class: 'head-row' }, h('span', { class: 'label', text: '수신' }),
    editable('recipient.to', doc.recipient.to, { class: 'val', tag: 'span', placeholder: internal ? '내부결재' : '수신자명(참조) 또는 수신자 참조' })));
  sheet.append(h('div', { class: 'head-row' }, h('span', { class: 'label', text: '(경유)' }),
    editable('recipient.via', doc.recipient.via, { class: 'val print-hide-empty', tag: 'span', placeholder: '경유 기관이 없으면 비워 둡니다' })));
  sheet.append(h('div', { class: 'head-row title-row' }, h('span', { class: 'label', text: '제목' }),
    editable('title', doc.title, { class: 'val', tag: 'span', placeholder: '문서 내용을 알 수 있도록 간단하고 명확하게' })));

  const body = h('div', { class: 'body', id: 'body' });
  const markers = computeMarkers(doc.blocks);
  const mark = endMark(doc);
  for (const b of doc.blocks) {
    if (b.type === 'table') body.append(renderTable(b, mark));
    else {
      const tx = editable(`block:${b.id}`, b.text, { class: 'tx', placeholder: b === doc.blocks[0] ? '본문을 입력하십시오. Enter: 다음 항목 · Tab: 하위 항목' : '' });
      if (mark?.kind === 'block' && mark.blockId === b.id) tx.classList.add('is-end');
      body.append(h('div', { class: 'blk item', 'data-id': b.id, 'data-level': b.level, style: `--indent:${indentEm(b.level)}` },
        b.level ? h('span', { class: 'mk', text: markers.get(b.id), 'aria-hidden': 'true' }) : null, tx));
    }
  }
  sheet.append(body);

  const atts = h('div', { class: 'atts', id: 'atts' });
  const lines = attachmentLines(doc);
  doc.attachments.forEach((a, i) => {
    const line = lines.find((l) => l.index === i);
    const first = i === 0;
    const tx = editable(`att:${i}`, a, { class: 'tx', placeholder: '첨부물 명칭과 수량 (예: ○○ 계획서 1부)' });
    if (mark?.kind === 'attachment' && mark.index === i) tx.classList.add('is-end');
    atts.append(h('div', { class: 'att', 'data-index': i },
      h('span', { class: 'lbl', text: first ? '붙임' : '' }),
      line?.marker ? h('span', { class: 'mk', text: line.marker }) : null, tx));
  });
  atts.append(h('button', { type: 'button', class: 'add-att', 'data-act': 'add-att', text: doc.attachments.length ? '+ 붙임 추가' : '+ 붙임(첨부물) 추가' }));
  sheet.append(atts);

  if (!internal) {
    const sender = h('div', { class: 'sender' }, editable('sender.name', doc.sender.name, { class: 'name', tag: 'span', placeholder: '발신명의' }));
    const seal = doc.sender.seal;
    if (seal === 'stamp') sender.append(h('span', { class: 'stamp', 'aria-label': '관인 날인 자리', text: '관인' }));
    else if (seal === 'omit') sender.append(h('span', { class: 'seal-note', text: '관인생략' }));
    else if (seal === 'signOmit') sender.append(h('span', { class: 'seal-note', text: '서명생략' }));
    sheet.append(sender);
  } else {
    sheet.append(h('div', { style: 'height:2.5em' }));
  }
  if (showsRecipientList(doc)) {
    sheet.append(h('div', { class: 'rcpt-list' }, h('span', { class: 'label', text: '수신자' }),
      editable('recipient.list', recipientListText(doc), { class: 'val', tag: 'span', placeholder: '수신자를 쉼표로 구분하여 입력' })));
  }
  sheet.append(renderFooter());

  if (active) {
    const el = $(`[data-key="${CSS.escape(active.key)}"]`);
    if (el) setSel(el, ...active.sel);
  }
  markIssues();
  requestAnimationFrame(drawPageGuides);
}

function renderTable(b, mark) {
  const blankRow = mark?.kind === 'table-blank' && mark.blockId === b.id ? mark.row : -1;
  const cols = Math.max(...b.rows.map((r) => r.length));
  const tbody = h('tbody');
  b.rows.forEach((row, r) => {
    const tr = h('tr', { class: b.header && r === 0 ? 'th' : undefined });
    for (let c = 0; c < cols; c++) {
      const td = editable(`cell:${b.id}:${r}:${c}`, row[c] ?? '', { tag: 'td' });
      if (r === blankRow && c === 0 && !(row[c] || '').trim()) td.classList.add('blank-cell');
      tr.append(td);
    }
    tbody.append(tr);
  });
  const ctrl = h('div', { class: 'tbl-ctrl', contenteditable: 'false' },
    ...[['row-add', '행 +'], ['row-del', '행 −'], ['col-add', '열 +'], ['col-del', '열 −'], ['header', '머리행'], ['after', '아래에 항목'], ['tbl-del', '표 삭제']]
      .map(([act, label]) => h('button', { type: 'button', 'data-act': act, 'data-id': b.id, text: label })));
  const wrap = h('div', { class: 'blk table', 'data-id': b.id, style: `--indent:${b.level}` }, ctrl, h('div', { class: 'tbl-wrap' }, h('table', {}, tbody)));
  const frag = document.createDocumentFragment();
  frag.append(wrap);
  if (mark?.kind === 'table-below' && mark.blockId === b.id) frag.append(h('div', { class: 'table-end', text: '끝.' }));
  return frag;
}

function renderFooter() {
  const doc = state.doc;
  const f = footerInfo(doc);
  const internal = doc.kind === 'internal';
  const kv = (k, v) => h('span', {}, h('span', { class: 'k', text: k }), v ? v : h('span', { class: 'empty', text: '(입력)' }));
  const foot = h('div', { class: 'foot', title: '눌러서 결문 정보 편집', 'data-act': 'edit-footer' },
    h('div', { class: 'signers' }, f.signers.length ? f.signers.map((s) => h('span', { text: s })) : h('span', { class: 'empty', text: '결재 라인을 입력하십시오' })));
  if (f.cooperators.length) foot.append(h('div', { class: 'line' }, h('span', {}, h('span', { class: 'k', text: '협조자' }), f.cooperators.join('   '))));
  foot.append(h('div', { class: 'line' }, kv('시행', f.enforce), kv('접수', f.receive)));
  if (!internal) {
    foot.append(h('div', { class: 'line' }, f.address ? h('span', { text: f.address }) : h('span', { class: 'empty', text: '우편번호·주소' }), f.homepage ? h('span', { text: `/ ${f.homepage}` }) : null));
    foot.append(h('div', { class: 'line' }, kv('전화번호', f.phone), f.fax ? kv('팩스번호', f.fax) : null,
      f.email ? h('span', { text: `/ ${f.email}` }) : null, h('span', { text: `/ ${f.disclosure}` })));
  } else {
    foot.append(h('div', { class: 'line' }, h('span', { text: f.disclosure })));
  }
  return foot;
}

// 끝 표시와 붙임 번호처럼 텍스트에 따라 바뀌는 부분만 다시 그린다 (타자 중에는 편집 칸을 건드리지 않는다).
function refreshDynamic() {
  const doc = state.doc;
  const mark = endMark(doc);
  $$('#body .blk.item .tx').forEach((tx) => {
    const id = tx.dataset.key.slice(6);
    tx.classList.toggle('is-end', mark?.kind === 'block' && mark.blockId === id);
  });
  $$('#atts .att .tx').forEach((tx) => {
    const i = Number(tx.dataset.key.slice(4));
    tx.classList.toggle('is-end', mark?.kind === 'attachment' && mark.index === i);
  });
  const lines = attachmentLines(doc);
  $$('#atts .att').forEach((row) => {
    const i = Number(row.dataset.index);
    const line = lines.find((l) => l.index === i);
    const mk = $('.mk', row);
    const want = line?.marker || '';
    if (want && mk) mk.textContent = want;
    else if (want && !mk) row.insertBefore(h('span', { class: 'mk', text: want }), $('.tx', row));
    else if (!want && mk) mk.remove();
  });
  // 표의 '이하 빈칸'/'끝.' 위치
  $$('#body .table-end').forEach((n) => n.remove());
  $$('#body td.blank-cell').forEach((td) => td.classList.remove('blank-cell'));
  if (mark?.kind === 'table-below') {
    const wrap = $(`#body .blk.table[data-id="${CSS.escape(mark.blockId)}"]`);
    wrap?.after(h('div', { class: 'table-end', text: '끝.' }));
  } else if (mark?.kind === 'table-blank') {
    const td = $(`[data-key="${CSS.escape(`cell:${mark.blockId}:${mark.row}:0`)}"]`);
    if (td && !readText(td).trim()) td.classList.add('blank-cell');
  }
  const foot = $('#sheet .foot');
  if (foot) foot.replaceWith(renderFooter());
  requestAnimationFrame(drawPageGuides);
}

// 쪽 나눔 안내선: 인쇄했을 때 쪽이 바뀌는 위치를 화면에 보여 준다.
function drawPageGuides() {
  const sheet = $('#sheet');
  $$('.page-guide', sheet).forEach((g) => g.remove());
  const pxPerMm = 96 / 25.4;
  const m = state.doc.settings.margins;
  const contentPx = (297 - m.top - m.bottom) * pxPerMm;
  const topPx = m.top * pxPerMm;
  const last = sheet.lastElementChild;
  const used = last ? last.offsetTop + last.offsetHeight - topPx : 0;
  const pages = Math.max(1, Math.ceil(used / contentPx));
  for (let p = 1; p < pages; p++) {
    sheet.append(h('div', { class: 'page-guide', style: `top:${topPx + p * contentPx}px` }, h('span', { text: `${p}쪽 끝 · ${p + 1}쪽 시작` })));
  }
  if (pages > 1) sheet.style.minHeight = `${pages * 297}mm`;
  else sheet.style.minHeight = '';
}

function fitZoom() {
  const desk = $('#desk');
  const avail = desk.clientWidth - 32;
  const full = 210 * 96 / 25.4;
  const z = Math.min(1, avail / full);
  $('#sheet-zoom').style.zoom = z < 1 ? String(z) : '';
}

// ───────── 블록 조작 ─────────
const blockIndex = (id) => state.doc.blocks.findIndex((b) => b.id === id);
const blockById = (id) => state.doc.blocks.find((b) => b.id === id);

function keyInfo(key) {
  if (!key) return null;
  const [kind, ...rest] = key.split(':');
  if (kind === 'block') return { kind, id: rest[0] };
  if (kind === 'cell') return { kind, id: rest[0], r: Number(rest[1]), c: Number(rest[2]) };
  if (kind === 'att') return { kind, index: Number(rest[0]) };
  return { kind: 'field', path: key };
}

function currentBlockId() {
  const info = keyInfo(state.lastKey);
  if (!info) return state.doc.blocks[state.doc.blocks.length - 1]?.id;
  if (info.kind === 'block' || info.kind === 'cell') return info.id;
  return null;
}

function setLevel(id, level) {
  const b = blockById(id);
  if (!b) return;
  const lv = Math.max(0, Math.min(MAX_LEVEL, level));
  if (lv === b.level) return;
  remember();
  b.level = lv;
  changed({ sheet: true });
  updateLevelSelect();
}

function moveBlock(id, dir) {
  const i = blockIndex(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.doc.blocks.length) return;
  remember();
  const arr = state.doc.blocks;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  changed({ sheet: true });
}

function insertTable() {
  const id = currentBlockId();
  const i = id ? blockIndex(id) : state.doc.blocks.length - 1;
  const ref = state.doc.blocks[i];
  remember();
  const t = table([['구분', '내용', '비고'], ['', '', ''], ['', '', '']], ref?.type === 'item' ? ref.level : ref?.level || 0);
  state.doc.blocks.splice(i + 1, 0, t);
  changed({ sheet: true });
  focusKey(`cell:${t.id}:1:0`);
}

function tableAction(act, id) {
  const b = blockById(id);
  if (!b) return;
  const info = keyInfo(state.lastKey);
  const r = info?.kind === 'cell' && info.id === id ? info.r : b.rows.length - 1;
  const c = info?.kind === 'cell' && info.id === id ? info.c : 0;
  const cols = Math.max(...b.rows.map((x) => x.length));
  remember();
  let focus = null;
  switch (act) {
    case 'row-add': b.rows.splice(r + 1, 0, new Array(cols).fill('')); focus = `cell:${id}:${r + 1}:0`; break;
    case 'row-del': if (b.rows.length > 1) b.rows.splice(r, 1); break;
    case 'col-add': b.rows.forEach((row) => row.splice(c + 1, 0, '')); focus = `cell:${id}:${r}:${c + 1}`; break;
    case 'col-del': if (cols > 1) b.rows.forEach((row) => row.splice(c, 1)); break;
    case 'header': b.header = !b.header; break;
    case 'after': {
      const nb = item(b.level, '');
      state.doc.blocks.splice(blockIndex(id) + 1, 0, nb);
      focus = `block:${nb.id}`;
      break;
    }
    case 'tbl-del': {
      const i = blockIndex(id);
      state.doc.blocks.splice(i, 1);
      if (!state.doc.blocks.length) state.doc.blocks.push(item(1, ''));
      const prev = state.doc.blocks[Math.max(0, i - 1)];
      if (prev.type === 'item') focus = `block:${prev.id}`;
      break;
    }
    default: break;
  }
  changed({ sheet: true });
  if (focus) focusKey(focus, Infinity);
}

// 여러 줄 텍스트를 붙여 넣으면 항목 기호를 읽어 블록으로 나눈다.
function pasteMultiline(blockId, text, sel) {
  const parsed = parsePlainDocument(text);
  const doc = state.doc;
  remember();
  const msgs = [];
  if (parsed.title !== undefined && !doc.title.trim()) { doc.title = parsed.title; msgs.push('제목'); }
  if (parsed.to !== undefined && !doc.recipient.to.trim()) { doc.recipient.to = parsed.to; msgs.push('수신'); }
  if (parsed.via) doc.recipient.via = parsed.via;
  if (parsed.attachments.length) { doc.attachments = [...doc.attachments.filter((a) => a.trim()), ...parsed.attachments]; msgs.push(`붙임 ${parsed.attachments.length}건`); }
  let lastId = blockId;
  if (parsed.blocks.length) {
    const i = blockIndex(blockId);
    const cur = doc.blocks[i];
    const before = cur.text.slice(0, sel[0]);
    const after = cur.text.slice(sel[1]);
    const incoming = parsed.blocks;
    if (!before.trim()) {
      // 빈 칸이나 맨 앞에서 붙여 넣으면 첫 줄이 현재 항목을 대신한다.
      cur.level = incoming[0].level || cur.level;
      cur.text = incoming[0].text;
      incoming.shift();
    } else {
      cur.text = before;
    }
    doc.blocks.splice(i + 1, 0, ...incoming);
    const last = incoming[incoming.length - 1] || cur;
    if (after) last.text += after;
    lastId = last.id;
    msgs.unshift(`항목 ${parsed.blocks.length}개`);
  }
  changed({ sheet: true });
  focusKey(`block:${lastId}`, Infinity);
  toast(`붙여 넣은 내용을 구조화했습니다: ${msgs.join(', ')}`);
}

function insertAtCaret(el, str) {
  const [s, e] = getSel(el);
  const text = readText(el);
  writeText(el, text.slice(0, s) + str + text.slice(e));
  setSel(el, s + str.length);
  onEditableInput(el, 'edit');
}

// ───────── 입력 처리 ─────────
function setFieldByKey(key, text) {
  const doc = state.doc;
  const info = keyInfo(key);
  if (info.kind === 'block') { const b = blockById(info.id); if (b) b.text = text; return; }
  if (info.kind === 'cell') { const b = blockById(info.id); if (b?.rows[info.r]) b.rows[info.r][info.c] = text; return; }
  if (info.kind === 'att') { doc.attachments[info.index] = text; return; }
  if (key === 'recipient.list') { doc.recipient.list = text.split(/\s*[,，、\n]\s*/).filter(Boolean); return; }
  setPath(doc, key, text);
}

function onEditableInput(el, kind = 'typing') {
  remember(kind);
  const key = el.dataset.key;
  setFieldByKey(key, readText(el));
  if (key.startsWith('org.') || key.startsWith('recipient.') || key === 'title' || key.startsWith('sender.')) syncPanelField(key);
  changed();
}

function handleKeydown(e) {
  const el = e.target.closest?.('[data-key]');
  if (!el || !$('#sheet').contains(el)) return;
  if (e.isComposing || e.keyCode === 229) return; // 한글 조합 중에는 손대지 않는다.
  const key = el.dataset.key;
  const info = keyInfo(key);

  if (info.kind === 'block') return blockKeydown(e, el, info.id);
  if (info.kind === 'cell') return cellKeydown(e, el, info);
  if (info.kind === 'att') return attKeydown(e, el, info.index);

  // 한 줄짜리 머리 칸: Enter는 다음 칸으로
  if (e.key === 'Enter') {
    e.preventDefault();
    const order = ['org.slogan', 'org.name', 'recipient.to', 'recipient.via', 'title'];
    const i = order.indexOf(key);
    if (i >= 0 && i < order.length - 1) focusKey(order[i + 1], Infinity);
    else if (key === 'title') focusKey(`block:${state.doc.blocks.find((b) => b.type === 'item')?.id}`, 0);
  }
}

function blockKeydown(e, el, id) {
  const doc = state.doc;
  const b = blockById(id);
  const i = blockIndex(id);
  const [s, end] = getSel(el);
  const text = readText(el);

  if (e.key === 'Tab') {
    e.preventDefault();
    setLevel(id, b.level + (e.shiftKey ? -1 : 1));
    focusKey(`block:${id}`, s, end);
    return;
  }
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    insertAtCaret(el, '\n');
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    if (!text.trim() && b.level > 0) { // 빈 항목에서 Enter → 상위 수준으로
      setLevel(id, b.level - 1);
      focusKey(`block:${id}`, 0);
      return;
    }
    remember();
    b.text = text.slice(0, s);
    const nb = item(b.level, text.slice(end));
    doc.blocks.splice(i + 1, 0, nb);
    changed({ sheet: true });
    focusKey(`block:${nb.id}`, 0);
    return;
  }
  if (e.key === 'Backspace' && s === 0 && end === 0) {
    const prev = doc.blocks[i - 1];
    if (!text && i > 0) { // 빈 항목 지우기
      e.preventDefault();
      remember();
      doc.blocks.splice(i, 1);
      changed({ sheet: true });
      if (prev.type === 'item') focusKey(`block:${prev.id}`, Infinity);
      else focusKey(`cell:${prev.id}:${prev.rows.length - 1}:0`, Infinity);
      return;
    }
    if (b.level > 0) { e.preventDefault(); setLevel(id, b.level - 1); focusKey(`block:${id}`, 0); return; }
    if (prev?.type === 'item') { // 앞 항목과 합치기
      e.preventDefault();
      remember();
      const join = prev.text.length;
      prev.text += text;
      doc.blocks.splice(i, 1);
      changed({ sheet: true });
      focusKey(`block:${prev.id}`, join);
    }
    return;
  }
  if (e.key === 'Delete' && s === text.length && end === s) {
    const next = doc.blocks[i + 1];
    if (next?.type === 'item') {
      e.preventDefault();
      remember();
      b.text = text + next.text;
      doc.blocks.splice(i + 1, 1);
      changed({ sheet: true });
      focusKey(`block:${id}`, s);
    }
    return;
  }
  if (e.altKey && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    moveBlock(id, e.key === 'ArrowUp' ? -1 : 1);
    focusKey(`block:${id}`, s);
    return;
  }
  if (e.key === 'ArrowUp' && !e.shiftKey && caretOnFirstLine(el)) {
    const prev = doc.blocks[i - 1];
    if (prev?.type === 'item') { e.preventDefault(); focusKey(`block:${prev.id}`, Infinity); }
    else if (!prev) { e.preventDefault(); focusKey('title', Infinity); }
    return;
  }
  if (e.key === 'ArrowDown' && !e.shiftKey && caretOnLastLine(el)) {
    const next = doc.blocks[i + 1];
    if (next?.type === 'item') { e.preventDefault(); focusKey(`block:${next.id}`, 0); }
    else if (next?.type === 'table') { e.preventDefault(); focusKey(`cell:${next.id}:0:0`, 0); }
  }
}

function cellKeydown(e, el, info) {
  const b = blockById(info.id);
  if (!b) return;
  const cols = Math.max(...b.rows.map((r) => r.length));
  if (e.key === 'Tab') {
    e.preventDefault();
    let idx = info.r * cols + info.c + (e.shiftKey ? -1 : 1);
    if (idx < 0) return;
    if (idx >= b.rows.length * cols) { // 마지막 칸에서 Tab → 행 추가
      remember();
      b.rows.push(new Array(cols).fill(''));
      changed({ sheet: true });
      idx = (b.rows.length - 1) * cols;
    }
    focusKey(`cell:${b.id}:${Math.floor(idx / cols)}:${idx % cols}`, 0, Infinity);
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    insertAtCaret(el, '\n');
  }
}

function attKeydown(e, el, index) {
  const doc = state.doc;
  const [s, end] = getSel(el);
  const text = readText(el);
  if (e.key === 'Enter') {
    e.preventDefault();
    remember();
    doc.attachments[index] = text.slice(0, s);
    doc.attachments.splice(index + 1, 0, text.slice(end));
    changed({ sheet: true });
    focusKey(`att:${index + 1}`, 0);
    return;
  }
  if (e.key === 'Backspace' && s === 0 && end === 0 && !text) {
    e.preventDefault();
    remember();
    doc.attachments.splice(index, 1);
    changed({ sheet: true });
    if (index > 0) focusKey(`att:${index - 1}`, Infinity);
    return;
  }
  if (e.key === 'ArrowUp' && caretOnFirstLine(el) && index > 0) { e.preventDefault(); focusKey(`att:${index - 1}`, Infinity); }
  if (e.key === 'ArrowDown' && caretOnLastLine(el) && index < doc.attachments.length - 1) { e.preventDefault(); focusKey(`att:${index + 1}`, 0); }
}

function handlePaste(e) {
  const el = e.target.closest?.('[data-key]');
  if (!el || !$('#sheet').contains(el)) return;
  e.preventDefault();
  const text = (e.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n');
  if (!text) return;
  const info = keyInfo(el.dataset.key);
  const multi = text.replace(/\n+$/, '').includes('\n');
  if (info.kind === 'block' && multi) {
    pasteMultiline(info.id, text, getSel(el));
    return;
  }
  // 한 줄 칸에는 줄바꿈 없이 넣는다.
  const single = info.kind === 'field' ? text.replace(/\s*\n\s*/g, ' ').trim() : text.replace(/\n+$/, '');
  insertAtCaret(el, single);
}

// ───────── 검사 ─────────
function scheduleLint() {
  clearTimeout(state.lintTimer);
  state.lintTimer = setTimeout(runLint, 250);
}

function runLint() {
  state.issues = lintDoc(state.doc);
  renderIssues();
  markIssues();
}

const SEV_LABEL = { error: '오류', warn: '표기', info: '권장' };

function whereLabel(loc) {
  const doc = state.doc;
  switch (loc.kind) {
    case 'title': return '제목';
    case 'recipient': return '수신';
    case 'via': return '(경유)';
    case 'block': {
      const markers = computeMarkers(doc.blocks);
      const b = blockById(loc.blockId);
      if (!b) return '본문';
      const path = [];
      // 상위 항목 기호까지 이어서 보여 준다: 2. > 가.
      let lv = b.level;
      for (let i = blockIndex(b.id); i >= 0 && lv > 0; i--) {
        const x = doc.blocks[i];
        if (x.type === 'item' && x.level && x.level <= lv) { path.unshift(markers.get(x.id)); lv = x.level - 1; }
      }
      return path.length ? `본문 ${path.join(' ')}` : '본문 문단';
    }
    case 'cell': return `표 ${loc.r + 1}행 ${loc.c + 1}열`;
    case 'attachment': return `붙임 ${loc.index + 1}`;
    case 'meta': return { 'org.name': '행정기관명', 'recipient.list': '수신자 목록', 'sender.name': '발신명의', 'enforce.dept': '생산등록번호', 'contact.phone': '연락처', 'contact.address': '연락처', 'contact.disclosure': '공개 구분', approval: '결재 라인' }[loc.field] || '문서 정보';
    default: return '';
  }
}

function renderIssues() {
  const issues = state.issues;
  const counts = { error: 0, warn: 0, info: 0 };
  issues.forEach((i) => { counts[i.severity]++; });
  const badge = $('#issue-count');
  badge.textContent = String(counts.error + counts.warn);
  badge.classList.toggle('has-error', counts.error > 0);
  const summary = $('#check-summary');
  summary.replaceChildren();
  if (!issues.length) summary.append(h('span', { class: 'chip ok', text: '편람 기준에 맞습니다' }));
  for (const sev of ['error', 'warn', 'info']) {
    if (counts[sev]) summary.append(h('span', { class: `chip ${sev}`, text: `${SEV_LABEL[sev]} ${counts[sev]}` }));
  }
  $('#btn-fix-all').disabled = !issues.some((i) => i.fix && i.severity !== 'info');
  const list = $('#issues');
  list.replaceChildren();
  if (!issues.length) {
    list.append(h('li', { class: 'empty-state', text: '고칠 곳이 없습니다. 인쇄하거나 내보내기 전에 결문(결재 라인·연락처)을 한 번 더 확인하십시오.' }));
    return;
  }
  for (const it of issues) {
    const li = h('li', { class: `issue ${it.severity}`, 'data-issue': it.id },
      h('span', { class: 'where', text: `${SEV_LABEL[it.severity]} · ${whereLabel(it.loc)}` }),
      h('span', { class: 'msg', text: it.message }));
    if (it.found && it.fix?.type === 'replace') {
      li.append(h('span', { class: 'found' }, h('mark', { text: it.found.trim().length <= 1 ? it.found.replace(/ /g, '·') : it.found }), ` → ${it.fix.text || '(삭제)'}`));
    }
    const acts = h('div', { class: 'acts' }, h('button', { type: 'button', 'data-goto': it.id, text: '위치 보기' }));
    if (it.fix) acts.append(h('button', { type: 'button', class: 'fix', 'data-fix': it.id, text: '고치기' }));
    li.append(acts);
    list.append(li);
  }
}

function markIssues() {
  $$('#sheet [data-issue]').forEach((n) => n.removeAttribute('data-issue'));
  const rank = { error: 3, warn: 2, info: 1 };
  const worst = new Map();
  for (const it of state.issues) {
    const k = locKey(it.loc);
    if (!worst.has(k) || rank[it.severity] > rank[worst.get(k)]) worst.set(k, it.severity);
  }
  for (const [k, sev] of worst) {
    const [kind, a, r, c] = k.split(':');
    let node = null;
    if (kind === 'block') node = $(`#body .blk[data-id="${CSS.escape(a)}"]`);
    else if (kind === 'cell') node = $(`[data-key="${CSS.escape(`cell:${a}:${r}:${c}`)}"]`);
    else if (kind === 'attachment') node = $(`#atts .att[data-index="${a}"]`);
    if (node) node.setAttribute('data-issue', sev);
  }
}

function keyForLoc(loc) {
  switch (loc.kind) {
    case 'title': return 'title';
    case 'recipient': return 'recipient.to';
    case 'via': return 'recipient.via';
    case 'block': return `block:${loc.blockId}`;
    case 'cell': return `cell:${loc.blockId}:${loc.r}:${loc.c}`;
    case 'attachment': return `att:${loc.index}`;
    default: return null;
  }
}

function gotoIssue(it) {
  if (it.loc.kind === 'meta') {
    const field = it.loc.field;
    const tab = field.startsWith('sender') || field.startsWith('contact') || field === 'approval' ? 'footer' : 'info';
    selectTab(tab);
    const input = document.getElementById(`f-${field}`) || document.getElementById(field);
    input?.focus();
    return;
  }
  const key = keyForLoc(it.loc);
  if (!key) return;
  if (it.range) focusKey(key, it.range[0], it.range[1]);
  else focusKey(key, Infinity);
}

function fixIssue(it) {
  remember();
  const ok = applyFix(state.doc, it);
  if (!ok) { state.past.pop(); toast('문서가 바뀌어 고칠 수 없습니다. 다시 검사합니다.'); runLint(); return; }
  changed({ sheet: true, panel: it.fix.type === 'set' });
  runLint();
}

function fixAll() {
  remember();
  let n = 0;
  const skipped = new Set();
  for (let guard = 0; guard < 300; guard++) {
    const it = lintDoc(state.doc).find((x) => x.fix && x.severity !== 'info' && !skipped.has(`${x.rule}|${locKey(x.loc)}|${x.found}`));
    if (!it) break;
    if (applyFix(state.doc, it)) n++;
    else skipped.add(`${it.rule}|${locKey(it.loc)}|${it.found}`);
  }
  if (!n) { state.past.pop(); return; }
  changed({ sheet: true, panel: true });
  runLint();
  toast(`${n}곳을 고쳤습니다. 마음에 들지 않으면 되돌리기(Ctrl+Z)를 누르십시오.`);
}

// ───────── 패널 ─────────
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}

function selectTab(name) {
  $$('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  $$('.tab-body').forEach((p) => { p.hidden = p.dataset.pane !== name; });
}

function syncPanelField(path) {
  const input = $(`[data-bind="${CSS.escape(path)}"]`);
  if (input && document.activeElement !== input) input.value = getPath(state.doc, path) ?? '';
  if (path === 'recipient.list' || path === 'recipient.to') {
    const ta = $('#f-recipient\\.list');
    if (document.activeElement !== ta) ta.value = state.doc.recipient.list.join('\n');
  }
}

function personRows(container, list, role, path) {
  container.replaceChildren(...list.map((p, i) => h('div', { class: 'person-row' },
    h('span', { class: 'role', text: list.length > 1 ? `${role} ${i + 1}` : role }),
    h('input', { id: `f-${path}.${i}.title`, 'data-bind': `${path}.${i}.title`, 'aria-label': `${role} 직위`, placeholder: '직위', value: p.title }),
    h('input', { id: `f-${path}.${i}.name`, 'data-bind': `${path}.${i}.name`, 'aria-label': `${role} 이름`, placeholder: '이름', value: p.name }),
    h('button', { type: 'button', class: 'del', 'data-del': `${path}.${i}`, 'aria-label': `${role} 삭제`, text: '✕' }))));
}

function syncPanel() {
  const doc = state.doc;
  $$('[data-bind]').forEach((input) => {
    if (input.closest('#reviewers, #cooperators')) return;
    const v = getPath(doc, input.dataset.bind);
    input.value = v ?? '';
  });
  $(`#f-kind-${doc.kind}`).checked = true;
  $('#f-recipient\\.list').value = doc.recipient.list.join('\n');
  personRows($('#reviewers'), doc.approval.reviewers, '검토자', 'approval.reviewers');
  personRows($('#cooperators'), doc.approval.cooperators, '협조자', 'approval.cooperators');
  $('#f-contact\\.disclosureReason').disabled = doc.contact.disclosure === '공개';
  updateUndoButtons();
}

function onPanelInput(e) {
  const t = e.target;
  const doc = state.doc;
  if (t.name === 'kind') {
    remember();
    doc.kind = t.value;
    if (t.value === 'internal' && !doc.recipient.to.trim()) doc.recipient.to = '내부결재';
    if (t.value === 'external' && doc.recipient.to.trim() === '내부결재') doc.recipient.to = '';
    changed({ sheet: true, panel: true });
    return;
  }
  if (t.id === 'f-recipient.list') {
    remember('typing');
    doc.recipient.list = t.value.split('\n').map((s) => s.trim()).filter(Boolean);
    changed({ sheet: true });
    return;
  }
  const path = t.dataset.bind;
  if (!path) return;
  remember(t.tagName === 'SELECT' || t.type === 'date' ? 'edit' : 'typing');
  const value = t.type === 'number' ? (t.value === '' ? getPath(doc, path) : Number(t.value)) : t.value;
  setPath(doc, path, value);
  if (path === 'contact.disclosure') {
    if (value === '공개') doc.contact.disclosureReason = '';
    $('#f-contact\\.disclosureReason').disabled = value === '공개';
    $('#f-contact\\.disclosureReason').value = doc.contact.disclosureReason;
  }
  changed({ sheet: true });
}

// ───────── 파일 ─────────
function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function fileBase() {
  const t = state.doc.title.trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 60);
  return t || '공문';
}

function saveJson() {
  download(`${fileBase()}.gongmun.json`, JSON.stringify(state.doc, null, 2), 'application/json');
  toast('문서 파일로 저장했습니다.');
}

function exportDocx() {
  const bytes = buildDocx(state.doc);
  download(`${fileBase()}.docx`, new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  toast('DOCX로 내보냈습니다. 한글에서 [파일 > 불러오기]로 열 수 있습니다.');
}

function docFromPlain(text) {
  const parsed = parsePlainDocument(text);
  const doc = blankDoc();
  doc.org = { ...state.doc.org };
  doc.sender = { ...state.doc.sender };
  doc.approval = JSON.parse(JSON.stringify(state.doc.approval));
  doc.contact = { ...state.doc.contact };
  doc.enforce = { ...state.doc.enforce, serial: '' };
  doc.settings = JSON.parse(JSON.stringify(state.doc.settings));
  doc.title = parsed.title || '';
  doc.recipient.to = parsed.to || '';
  doc.recipient.via = parsed.via || '';
  doc.blocks = parsed.blocks.length ? parsed.blocks : [item(1, '')];
  doc.attachments = parsed.attachments;
  return doc;
}

async function openFile(file) {
  const text = await file.text();
  if (/\.json$/i.test(file.name) || text.trim().startsWith('{')) {
    try {
      replaceDoc(JSON.parse(text), `'${file.name}'을(를) 열었습니다.`);
    } catch {
      toast('문서 파일을 읽을 수 없습니다. 이 편집기에서 저장한 .json 파일인지 확인하십시오.');
    }
    return;
  }
  replaceDoc(docFromPlain(text), '텍스트를 공문으로 구조화했습니다.');
}

async function copyText() {
  const text = docToPlainText(state.doc);
  try {
    await navigator.clipboard.writeText(text);
    toast('본문을 복사했습니다. 온-나라·한글에 붙여 넣으십시오.');
  } catch {
    const ta = h('textarea', { style: 'position:fixed;left:-9999px' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    toast(ok ? '본문을 복사했습니다.' : '복사하지 못했습니다. 브라우저의 클립보드 권한을 확인하십시오.');
  }
}

// ───────── 도구 패널 ─────────
function updateToolPreviews() {
  const d = $('#tool-date').value;
  $('#tool-date-out').textContent = formatIsoDate(d, $('#tool-weekday').checked);
  const t = $('#tool-time').value;
  const m = /^(\d{2}):(\d{2})/.exec(t);
  $('#tool-time-out').textContent = m ? formatTime(Number(m[1]), Number(m[2])) : '';
  const a = $('#tool-amount').value;
  let amount = '';
  try { amount = formatAmount(a); } catch { amount = '금액이 너무 큽니다'; }
  $('#tool-amount-out').textContent = amount;
}

function insertFromTool(text) {
  if (!text) return;
  let el = state.lastKey ? $(`[data-key="${CSS.escape(state.lastKey)}"]`) : null;
  if (!el) {
    toast('먼저 문서에서 넣을 위치를 누르십시오.');
    return;
  }
  setSel(el, ...state.lastSel);
  insertAtCaret(el, text);
}

// ───────── 기타 화면 ─────────
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

function updateLevelSelect() {
  const info = keyInfo(state.lastKey);
  const sel = $('#sel-level');
  const b = info?.kind === 'block' ? blockById(info.id) : null;
  sel.disabled = !b;
  $('#btn-indent').disabled = !b;
  $('#btn-outdent').disabled = !b;
  if (b) sel.value = String(b.level);
}

function trackFocus() {
  const el = document.activeElement;
  if (el?.dataset?.key && $('#sheet').contains(el)) {
    state.lastKey = el.dataset.key;
    state.lastSel = getSel(el);
    updateLevelSelect();
  }
}

function buildStatic() {
  $('#f-settings\\.font').replaceChildren(...FONTS.map((f) => h('option', { value: f.id, text: f.label })));
  $('#f-contact\\.disclosureReason').replaceChildren(h('option', { value: '', text: '선택' }), ...DISCLOSURE_REASONS.map((r) => h('option', { value: r, text: r })));
  $('#template-grid').replaceChildren(...TEMPLATES.map((t) => h('button', { type: 'button', 'data-template': t.id }, h('b', { text: t.name }), h('span', { text: t.desc }))));
  $('#tool-date').value = todayIso();
  $('#tool-time').value = '14:00';
  $('#tool-amount').value = '113560';
  // 항목 수준 목록에 실제 기호 예시
  $$('#sel-level option').forEach((o) => { const lv = Number(o.value); if (lv) o.textContent = markerFor(lv, 1); });
  if (ARTIFACT) $$('[data-local-only]').forEach((n) => { n.hidden = true; });
}

function bind() {
  const sheet = $('#sheet');
  sheet.addEventListener('input', (e) => {
    const el = e.target.closest('[data-key]');
    if (el) onEditableInput(el);
  });
  sheet.addEventListener('keydown', handleKeydown);
  sheet.addEventListener('paste', handlePaste);
  sheet.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;
    if (a === 'add-att') {
      remember();
      state.doc.attachments.push('');
      changed({ sheet: true });
      focusKey(`att:${state.doc.attachments.length - 1}`);
    } else if (a === 'edit-footer') {
      selectTab('footer');
      $('.panel').scrollIntoView({ block: 'nearest' });
    } else if (act.dataset.id) {
      e.preventDefault();
      tableAction(a, act.dataset.id);
    }
  });
  // 표 조작 버튼을 눌러도 칸의 커서 위치를 잃지 않도록
  sheet.addEventListener('mousedown', (e) => { if (e.target.closest('.tbl-ctrl')) e.preventDefault(); });
  document.addEventListener('selectionchange', trackFocus);
  sheet.addEventListener('focusin', trackFocus);

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const inSheet = $('#sheet').contains(document.activeElement) || document.activeElement === document.body;
    const k = e.key.toLowerCase();
    if (k === 'z' && inSheet) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (k === 'y' && inSheet) { e.preventDefault(); redo(); }
    else if (k === 's' && !ARTIFACT) { e.preventDefault(); saveJson(); }
  });

  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  $('#btn-indent').addEventListener('click', () => { const i = keyInfo(state.lastKey); if (i?.kind === 'block') { setLevel(i.id, blockById(i.id).level + 1); focusKey(state.lastKey, ...state.lastSel); } });
  $('#btn-outdent').addEventListener('click', () => { const i = keyInfo(state.lastKey); if (i?.kind === 'block') { setLevel(i.id, blockById(i.id).level - 1); focusKey(state.lastKey, ...state.lastSel); } });
  $('#sel-level').addEventListener('change', (e) => { const i = keyInfo(state.lastKey); if (i?.kind === 'block') { setLevel(i.id, Number(e.target.value)); focusKey(state.lastKey, ...state.lastSel); } });
  $('#btn-table').addEventListener('click', insertTable);
  for (const id of ['btn-indent', 'btn-outdent', 'btn-table']) $(`#${id}`).addEventListener('mousedown', (e) => e.preventDefault());

  $('#btn-new').addEventListener('click', () => $('#dlg-templates').showModal());
  $('#template-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-template]');
    if (!b) return;
    const t = TEMPLATES.find((x) => x.id === b.dataset.template);
    $('#dlg-templates').close();
    const doc = t.make();
    // 결문(기관·결재·연락처)은 지금 문서의 것을 이어 쓴다.
    const cur = state.doc;
    doc.org = { ...cur.org };
    if (doc.kind === 'external') doc.sender = { ...cur.sender };
    doc.approval = JSON.parse(JSON.stringify(cur.approval));
    doc.contact = { ...cur.contact };
    doc.enforce = { ...cur.enforce, serial: '', date: todayIso() };
    doc.settings = JSON.parse(JSON.stringify(cur.settings));
    replaceDoc(doc, `'${t.name}' 서식으로 새 문서를 시작했습니다.`);
    const first = state.doc.title ? state.doc.blocks.find((x) => x.type === 'item') : null;
    focusKey(first ? `block:${first.id}` : 'title', Infinity);
  });
  $('#btn-import').addEventListener('click', () => { $('#import-text').value = ''; $('#dlg-import').showModal(); $('#import-text').focus(); });
  $('#dlg-import').addEventListener('close', () => {
    if ($('#dlg-import').returnValue !== 'ok') return;
    const text = $('#import-text').value;
    if (text.trim()) replaceDoc(docFromPlain(text), '붙여 넣은 공문을 구조화했습니다. 검사 결과를 확인하십시오.');
  });
  $('#btn-open').addEventListener('click', () => $('#file-open').click());
  $('#file-open').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ''; });
  $('#btn-save').addEventListener('click', saveJson);
  $('#btn-docx').addEventListener('click', exportDocx);
  $('#btn-print').addEventListener('click', () => window.print());
  $('#btn-copy').addEventListener('click', copyText);

  $$('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
  $('.panel').addEventListener('input', onPanelInput);
  $('#btn-add-reviewer').addEventListener('click', () => { remember(); state.doc.approval.reviewers.push({ title: '', name: '' }); changed({ sheet: true, panel: true }); });
  $('#btn-add-cooperator').addEventListener('click', () => { remember(); state.doc.approval.cooperators.push({ title: '', name: '' }); changed({ sheet: true, panel: true }); });
  $('.panel').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      const parts = del.dataset.del.split('.');
      const idx = Number(parts.pop());
      remember();
      getPath(state.doc, parts.join('.')).splice(idx, 1);
      changed({ sheet: true, panel: true });
      return;
    }
    const go = e.target.closest('[data-goto]');
    if (go) { const it = state.issues.find((x) => x.id === go.dataset.goto); if (it) gotoIssue(it); return; }
    const fx = e.target.closest('[data-fix]');
    if (fx) { const it = state.issues.find((x) => x.id === fx.dataset.fix); if (it) fixIssue(it); }
  });
  $('#btn-fix-all').addEventListener('click', fixAll);

  for (const id of ['tool-date', 'tool-weekday', 'tool-time', 'tool-amount']) $(`#${id}`).addEventListener('input', updateToolPreviews);
  $('#tool-date-insert').addEventListener('click', () => insertFromTool($('#tool-date-out').textContent));
  $('#tool-time-insert').addEventListener('click', () => insertFromTool($('#tool-time-out').textContent));
  $('#tool-amount-insert').addEventListener('click', () => insertFromTool(/^금/.test($('#tool-amount-out').textContent) ? $('#tool-amount-out').textContent : ''));

  window.addEventListener('resize', fitZoom);
  if (window.ResizeObserver) new ResizeObserver(fitZoom).observe($('#desk'));
}

function start() {
  buildStatic();
  bind();
  renderSheet();
  syncPanel();
  runLint();
  updateToolPreviews();
  updateLevelSelect();
  fitZoom();
  if (document.fonts?.ready) document.fonts.ready.then(drawPageGuides);
}

start();

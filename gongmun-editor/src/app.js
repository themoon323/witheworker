// 공문 편집기 화면
import { blankDoc, normalizeDoc, item, table, TEMPLATES, FONTS, DISCLOSURE_REASONS } from './model.js';
import { computeMarkers, MAX_LEVEL, markerFor } from './numbering.js';
import { lintDoc, applyFix, locKey } from './lint.js';
import { endMark, attachmentLines, footerInfo, showsRecipientList, recipientListText, indentEm } from './layout.js';
import { parsePlainDocument } from './importText.js';
import { formatIsoDate, formatAmount, formatTime, todayIso } from './format.js';
import { buildDocx } from './docx.js';
import { docToPlainText } from './plaintext.js';
import { buildHwpx } from './hwpx.js';
import { extractPdfText } from './pdfText.js';
import {
  PURPOSES, REPORT_PURPOSES, rewriteWithApi, rewriteWithSample, rewriteReportWithApi, rewriteReportWithSample, docFromAi, AiError,
} from './ai.js';
import { normalizeReport, rblock, stripInline } from './report.js';
import { markdownToReport } from './markdown.js';
import { buildReportHwpx, reportToPlainText } from './reportHwpx.js';
import { createReportEditor, typeOptions } from './reportEditor.js';
import { REPORT_TEMPLATES } from './reportTemplates.js';
import { formatDate } from './format.js';

const ARTIFACT = !!window.GONGMUN_ARTIFACT;
const STORE_KEY = 'gongmun-editor.current';
const KEY_STORE = 'gongmun-editor.apiKey';
const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
// 아티팩트에서 쓰는 claude.ai 기능 (파일 저장, Claude 호출). 없으면 null.
const caps = { downloads: null, sample: null };
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

// 공문(kind: external·internal)과 보고서(kind: report)를 모두 다룬다.
function normalizeAny(raw) {
  if (raw?.kind !== 'report') return normalizeDoc(raw);
  const doc = normalizeReport(raw);
  if (!doc.blocks.length) doc.blocks.push(rblock.item(1, ''));
  return doc;
}

const isReport = () => state.doc.kind === 'report';

function todayText(now = new Date()) {
  return formatDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function freshReport() {
  const doc = REPORT_TEMPLATES[0].make();
  doc.meta.date = todayText();
  return doc;
}

const state = {
  doc: loadStored() || freshReport(),
  past: [],
  future: [],
  issues: [],
  lastTyping: 0,
  lastKey: null, // 마지막으로 편집한 칸 (도구 패널의 '넣기'에 씀)
  lastSel: [0, 0],
  saveTimer: 0,
  lintTimer: 0,
  pdf: null, // 불러온 PDF { name, bytes, pdf, pages, scanned }
};

// 보고서·제안서 모드 (src/reportEditor.js)
const R = createReportEditor({
  state, $, $$, h, editable, readText, writeText, getSel, setSel, focusKey, caretOnFirstLine, caretOnLastLine,
  remember, changed: (o) => changed(o), toast: (m) => toast(m), selectTab: (t) => selectTab(t), insertAtCaret: (el, t) => insertAtCaret(el, t),
  onInput: (el) => onEditableInput(el, 'edit'),
});

// ───────── 저장 ─────────
function loadStored() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? normalizeAny(JSON.parse(raw)) : null;
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
  state.doc = normalizeAny(JSON.parse(state.past.pop()));
  state.lastTyping = 0;
  changed({ sheet: true, panel: true });
  updateUndoButtons();
}

function redo() {
  if (!state.future.length) return;
  state.past.push(JSON.stringify(state.doc));
  state.doc = normalizeAny(JSON.parse(state.future.pop()));
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
  state.doc = normalizeAny(doc);
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

function syncMode() {
  const report = isReport();
  const was = document.body.classList.contains('mode-report');
  document.body.classList.toggle('mode-report', report);
  if (was !== report) {
    // 지금 모드에 없는 탭이 열려 있으면 검사 탭으로
    const cur = $('.tabs [aria-selected="true"]');
    if (cur && cur.dataset.mode && cur.dataset.mode !== (report ? 'report' : 'gongmun')) selectTab('check');
    $('#issues').replaceChildren();
  }
}

function renderSheet() {
  const doc = state.doc;
  const sheet = $('#sheet');
  const active = document.activeElement?.dataset?.key && sheet.contains(document.activeElement)
    ? { key: document.activeElement.dataset.key, sel: getSel(document.activeElement) } : null;
  syncMode();
  sheet.className = 'sheet';
  sheet.removeAttribute('style');
  if (isReport()) {
    sheet.replaceChildren();
    R.render(sheet);
    if (active) {
      const el = $(`[data-key="${CSS.escape(active.key)}"]`);
      if (el) setSel(el, ...active.sel);
    }
    markIssues();
    updateLevelSelect();
    requestAnimationFrame(drawPageGuides);
    return;
  }
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
  if (isReport()) {
    R.refresh();
    requestAnimationFrame(drawPageGuides);
    return;
  }
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
  const sm = state.doc.settings.margins;
  // 보고서는 머리말·꼬리말 영역만큼 본문이 줄어든다.
  const m = isReport() ? { top: sm.top + sm.header, bottom: sm.bottom + sm.footer } : sm;
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
  if (isReport()) { R.setField(key, text); return; }
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
  if (key.startsWith('r:meta:')) syncPanelField(`meta.${key.slice(7)}`);
  else if (!isReport() && (key.startsWith('org.') || key.startsWith('recipient.') || key === 'title' || key.startsWith('sender.'))) syncPanelField(key);
  changed();
}

function handleKeydown(e) {
  const el = e.target.closest?.('[data-key]');
  if (!el || !$('#sheet').contains(el)) return;
  if (e.isComposing || e.keyCode === 229) return; // 한글 조합 중에는 손대지 않는다.
  if (isReport()) { R.keydown(e, el); return; }
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
  if (isReport()) {
    if (R.paste(el, text)) return;
    const k = R.keyInfo(el.dataset.key)?.kind;
    const oneLine = k === 'meta' || k === 'boxTitle' || k === 'caption' || k === 'unit';
    insertAtCaret(el, oneLine ? text.replace(/\s*\n\s*/g, ' ').trim() : text.replace(/\n+$/, ''));
    return;
  }
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
  state.issues = isReport() ? R.lint() : lintDoc(state.doc);
  renderIssues();
  markIssues();
}

const SEV_LABEL = { error: '오류', warn: '표기', info: '권장' };

function whereLabel(loc) {
  if (isReport()) return R.where(loc);
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
  if (!issues.length) summary.append(h('span', { class: 'chip ok', text: isReport() ? '작성 기준에 맞습니다' : '편람 기준에 맞습니다' }));
  for (const sev of ['error', 'warn', 'info']) {
    if (counts[sev]) summary.append(h('span', { class: `chip ${sev}`, text: `${SEV_LABEL[sev]} ${counts[sev]}` }));
  }
  $('#btn-fix-all').disabled = !issues.some((i) => i.fix && i.severity !== 'info');
  const list = $('#issues');
  list.replaceChildren();
  if (!issues.length) {
    list.append(h('li', { class: 'empty-state', text: isReport()
      ? '고칠 곳이 없습니다. 결론이 앞에 있는지, 요청 사항과 정책대상 규모·소요 예산이 빠지지 않았는지 한 번 더 확인하십시오.'
      : '고칠 곳이 없습니다. 인쇄하거나 내보내기 전에 결문(결재 라인·연락처)을 한 번 더 확인하십시오.' }));
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
  if (isReport()) { R.markIssues(state.issues); return; }
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
  if (isReport()) { R.gotoIssue(it); return; }
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
  const ok = isReport() ? R.applyFix(it) : applyFix(state.doc, it);
  if (!ok) { state.past.pop(); toast('문서가 바뀌어 고칠 수 없습니다. 다시 검사합니다.'); runLint(); return; }
  changed({ sheet: true, panel: it.fix.type === 'set' || it.loc.kind === 'meta' });
  runLint();
}

function fixAll() {
  remember();
  let n = 0;
  const skipped = new Set();
  for (let guard = 0; guard < 300; guard++) {
    const all = isReport() ? R.lint() : lintDoc(state.doc);
    const it = all.find((x) => x.fix && x.severity !== 'info' && !skipped.has(`${x.rule}|${JSON.stringify(x.loc)}|${x.found}`));
    if (!it) break;
    if (isReport() ? R.applyFix(it) : applyFix(state.doc, it)) n++;
    else skipped.add(`${it.rule}|${JSON.stringify(it.loc)}|${it.found}`);
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
  syncMode();
  $$('[data-bind]').forEach((input) => {
    if (input.closest('#reviewers, #cooperators')) return;
    const v = getPath(doc, input.dataset.bind);
    if (input.type === 'checkbox') input.checked = !!v;
    else input.value = v ?? '';
  });
  if (isReport()) {
    $('#f-r-symbols').value = doc.settings.symbols.join(' ');
    updateUndoButtons();
    updateLevelSelect();
    return;
  }
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
  if (t.id === 'f-r-symbols') {
    const sy = t.value.split(/[\s,]+/).filter(Boolean);
    if (sy.length) { remember('typing'); doc.settings.symbols = sy; changed({ sheet: true }); }
    return;
  }
  const path = t.dataset.bind;
  if (!path) return;
  remember(t.tagName === 'SELECT' || t.type === 'date' || t.type === 'checkbox' ? 'edit' : 'typing');
  const value = t.type === 'checkbox' ? t.checked : t.type === 'number' ? (t.value === '' ? getPath(doc, path) : Number(t.value)) : t.value;
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

// 파일 저장. 아티팩트에서는 claude.ai의 저장 기능(보는 사람이 확인)을 거친다. 저장했으면 true
async function saveFile(name, data, type) {
  if (!ARTIFACT) {
    download(name, data, type);
    return true;
  }
  if (!caps.downloads) {
    toast('이 화면에서는 파일을 저장할 수 없습니다.');
    return false;
  }
  try {
    await caps.downloads.save({ filename: name, data: data instanceof Uint8Array ? new Blob([data], { type }) : data });
    return true;
  } catch (e) {
    if (e?.code !== 'declined') toast(e?.code === 'rejected_extension' ? '이 형식은 여기서 저장할 수 없습니다.' : '파일을 저장하지 못했습니다.');
    return false;
  }
}

function fileBase() {
  const t = (isReport() ? stripInline(state.doc.meta.title) : state.doc.title).trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 60);
  return t || '공문';
}

async function saveJson() {
  if (await saveFile(`${fileBase()}.gongmun.json`, JSON.stringify(state.doc, null, 2), 'application/json')) toast('문서 파일로 저장했습니다.');
}

async function exportDocx() {
  const bytes = buildDocx(state.doc);
  if (await saveFile(`${fileBase()}.docx`, bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')) {
    toast('DOCX로 내보냈습니다. 워드나 한글에서 열 수 있습니다.');
  }
}

async function exportHwpx() {
  const bytes = isReport() ? buildReportHwpx(state.doc) : buildHwpx(state.doc);
  // 아티팩트의 저장 기능은 .hwpx 확장자를 받지 않아 .zip을 덧붙인다.
  const name = ARTIFACT ? `${fileBase()}.hwpx.zip` : `${fileBase()}.hwpx`;
  if (await saveFile(name, bytes, ARTIFACT ? 'application/zip' : 'application/hwp+zip')) {
    toast(ARTIFACT ? "저장한 파일 이름 끝의 '.zip'을 지우면 한글에서 열립니다." : '한글 문서(HWPX)로 내보냈습니다.');
  }
}

// 보고서 모드: 마크다운·보고서 기호를 읽어 새 보고서를 만든다. 서식 설정과 부서는 지금 문서의 것을 이어 쓴다.
function reportFromText(text) {
  const { doc } = markdownToReport(text);
  const cur = state.doc;
  if (cur.kind === 'report') {
    doc.settings = JSON.parse(JSON.stringify({ ...cur.settings, symbols: doc.settings.symbols }));
    if (!doc.meta.dept) doc.meta.dept = cur.meta.dept;
  }
  if (!doc.meta.date) doc.meta.date = todayText();
  return doc;
}

function docFromPlain(text) {
  if (isReport()) return reportFromText(text);
  const parsed = parsePlainDocument(text);
  const doc = blankDoc();
  doc.org = { ...state.doc.org };
  if (parsed.org && parsed.to !== undefined) doc.org.name = parsed.org;
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

// ───────── 외부 라이브러리 (pdf.js, Claude SDK) ─────────
// 내려받은 편집기에는 파일 안에 들어 있고(type="text/plain"), 개발 중에는 vendor/에서, 아티팩트에서는 CDN에서 불러온다.
const VENDOR = {
  pdfjs: { files: ['pdf.worker.min.js', 'pdf.min.js'], ready: () => globalThis.pdfjsLib },
  sdk: { files: ['anthropic-sdk.min.js'], ready: () => globalThis.AnthropicSDK },
};

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = url;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`${url}을(를) 불러오지 못했습니다.`));
    document.head.append(el);
  });
}

async function ensureVendor(kind) {
  const v = VENDOR[kind];
  if (v.ready()) return v.ready();
  for (const f of v.files) {
    const inline = document.querySelector(`script[type="text/plain"][data-vendor="${f}"]`);
    if (inline) {
      const el = document.createElement('script');
      el.textContent = inline.textContent;
      document.head.append(el);
    } else {
      await loadScript((ARTIFACT && kind === 'pdfjs' ? PDFJS_CDN : 'vendor/') + f);
    }
  }
  if (!v.ready()) throw new Error('라이브러리를 불러오지 못했습니다.');
  return v.ready();
}

// ───────── 초안 가져오기 (PDF·AI) ─────────
const imp = { ctl: null, busy: false };

function showImportError(msg) {
  const el = $('#import-error');
  el.textContent = msg || '';
  el.hidden = !msg;
}

function setImportBusy(busy) {
  imp.busy = busy;
  $('#ai-progress').hidden = !busy;
  for (const id of ['import-plain', 'import-ai', 'btn-pdf']) $(`#${id}`).disabled = busy;
}

function openImport({ keepPdf = false } = {}) {
  if (!keepPdf) clearPdf();
  const list = isReport() ? REPORT_PURPOSES : PURPOSES;
  $('#ai-purpose').replaceChildren(...list.map(([v, label]) => h('option', { value: v, text: label })));
  $('#import-ai').textContent = isReport() ? 'AI로 보고서 작성' : 'AI로 공문 작성';
  $('#dlg-import-title').textContent = isReport() ? '초안 가져오기 (보고서·제안서)' : '초안 가져오기 (공문)';
  $('#import-text').value = '';
  showImportError('');
  setImportBusy(false);
  try { $('#ai-key').value = localStorage.getItem(KEY_STORE) || $('#ai-key').value; $('#ai-remember').checked = !!localStorage.getItem(KEY_STORE); } catch { /* 저장소를 못 쓰면 매번 입력 */ }
  if (!$('#dlg-import').open) $('#dlg-import').showModal();
  $('#import-text').focus();
}

function clearPdf() {
  state.pdf = null;
  $('#pdf-status').textContent = '';
  $('#pdf-status').classList.remove('warn');
  $('#btn-pdf-clear').hidden = true;
}

async function loadPdf(file) {
  showImportError('');
  const status = $('#pdf-status');
  status.classList.remove('warn');
  status.textContent = `'${file.name}' 읽는 중…`;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > 30 * 1024 * 1024) throw new Error('PDF가 30MB보다 큽니다. 필요한 쪽만 나눠서 불러오십시오.');
    const pdfjsLib = await ensureVendor('pdfjs');
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    const res = await extractPdfText(pdf);
    const scanned = res.chars < 30 * res.pages;
    state.pdf = { name: file.name, bytes, pdf, pages: res.pages, scanned };
    $('#import-text').value = res.text;
    $('#btn-pdf-clear').hidden = false;
    if (scanned) {
      status.classList.add('warn');
      status.textContent = `'${file.name}' ${res.pages}쪽: 글자가 거의 없는 스캔 PDF입니다. 'AI로 공문 작성'을 누르면 Claude가 PDF 화면을 직접 읽습니다.`;
    } else {
      status.textContent = `'${file.name}' ${res.pages}쪽에서 글자를 뽑았습니다. 줄이 어긋난 곳이 있으면 고친 뒤 진행하십시오.`;
    }
  } catch (e) {
    state.pdf = null;
    status.textContent = '';
    showImportError(/password/i.test(e?.name || '') ? '암호가 걸린 PDF는 열 수 없습니다.' : `PDF를 읽지 못했습니다. ${e?.message || ''}`);
  }
}

// 스캔 PDF를 쪽 그림으로 바꾼다 (아티팩트에서 Claude에게 보낼 때).
async function renderPdfImages(pdf, max) {
  const blobs = [];
  for (let p = 1; p <= Math.min(pdf.numPages, max); p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    blobs.push(await new Promise((resolve) => canvas.toBlob(resolve, 'image/png')));
  }
  return blobs;
}

function importPlain() {
  const text = $('#import-text').value;
  if (!text.trim()) { showImportError('초안을 붙여 넣거나 PDF를 불러오십시오.'); return; }
  $('#dlg-import').close('plain');
  replaceDoc(docFromPlain(text), '초안을 공문으로 구조화했습니다. 검사 결과를 확인하십시오.');
}

async function importWithAi() {
  const draft = $('#import-text').value;
  const sendPdf = !!state.pdf?.scanned;
  if (!draft.trim() && !sendPdf) { showImportError('초안을 붙여 넣거나 PDF를 불러오십시오.'); return; }
  const purpose = $('#ai-purpose').value;
  showImportError('');
  imp.ctl = new AbortController();
  const { signal } = imp.ctl;
  setImportBusy(true);
  try {
    let result;
    if (ARTIFACT) {
      if (!caps.sample) throw new AiError('unavailable', '이 화면에서는 AI 작성을 쓸 수 없습니다.');
      let images;
      if (sendPdf) {
        const lim = await caps.sample.limits().catch(() => null);
        if (!lim?.images) throw new AiError('images_unavailable', '스캔 PDF는 여기서 보낼 수 없습니다. 내려받은 편집기를 쓰거나 글자를 붙여 넣으십시오.');
        images = await renderPdfImages(state.pdf.pdf, lim.images.maxCount);
      }
      result = isReport()
        ? await rewriteReportWithSample({ sample: caps.sample, draft, purpose, doc: state.doc, images, signal })
        : await rewriteWithSample({ sample: caps.sample, draft, purpose, doc: state.doc, images, signal });
    } else {
      const apiKey = $('#ai-key').value.trim();
      if (!apiKey) throw new AiError('no_key', 'Claude API 키를 입력하십시오. 키는 Claude Console(console.anthropic.com)에서 발급합니다.');
      try {
        if ($('#ai-remember').checked) localStorage.setItem(KEY_STORE, apiKey);
        else localStorage.removeItem(KEY_STORE);
      } catch { /* 저장소를 못 쓰면 기억하지 않는다 */ }
      await ensureVendor('sdk');
      const args = { apiKey, draft, purpose, doc: state.doc, pdfBytes: sendPdf ? state.pdf.bytes : null, signal };
      result = isReport() ? await rewriteReportWithApi(args) : await rewriteWithApi(args);
    }
    if (signal.aborted) return;
    setImportBusy(false);
    $('#dlg-import').close('ai');
    if (isReport()) replaceDoc(reportFromText(result.markdown), 'Claude가 쓴 보고서를 불러왔습니다.');
    else replaceDoc(docFromAi(result, state.doc), 'Claude가 쓴 공문을 불러왔습니다.');
    showNotes(result.notes);
  } catch (e) {
    if (e?.code !== 'cancelled') showImportError(e?.message || 'AI 작성에 실패했습니다.');
  } finally {
    imp.ctl = null;
    setImportBusy(false);
  }
}

function showNotes(notes) {
  const list = $('#notes-list');
  const items = notes.length ? notes : ['따로 짚을 점은 없다고 합니다. 그래도 날짜·금액·수신처를 한 번 더 확인하십시오.'];
  list.replaceChildren(...items.map((n) => h('li', { text: n })));
  $('#dlg-notes').showModal();
}

async function openFile(file) {
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    openImport();
    await loadPdf(file);
    return;
  }
  const text = await file.text();
  if (/\.(md|markdown)$/i.test(file.name)) {
    replaceDoc(reportFromText(text), `'${file.name}'을(를) 보고서로 열었습니다.`);
    return;
  }
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
  const text = isReport() ? reportToPlainText(state.doc) : docToPlainText(state.doc);
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

let levelOptionsSig = '';
function updateLevelSelect() {
  const sel = $('#sel-level');
  const sig = isReport() ? `r:${state.doc.settings.symbols.join('')}` : 'g';
  if (sig !== levelOptionsSig) {
    levelOptionsSig = sig;
    const opts = isReport() ? typeOptions(state.doc.settings.symbols) : [['0', '문단'], ...[1, 2, 3, 4, 5, 6, 7, 8].map((l) => [String(l), markerFor(l, 1)])];
    sel.replaceChildren(...opts.map(([v, label]) => h('option', { value: v, text: label })));
    sel.title = isReport() ? '줄 종류' : '항목 수준';
  }
  if (isReport()) {
    const info = R.keyInfo(state.lastKey);
    const code = info?.kind === 'block' ? R.typeOf(info.id) : '';
    sel.disabled = !code;
    $('#btn-indent').disabled = !code;
    $('#btn-outdent').disabled = !code;
    if (code) sel.value = code;
    return;
  }
  const info = keyInfo(state.lastKey);
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
  const card = (t) => h('button', { type: 'button', 'data-template': t.id }, h('b', { text: t.name }), h('span', { text: t.desc }));
  $('#template-grid').replaceChildren(
    h('h3', { class: 'tpl-group', text: '보고서·제안서' }), ...REPORT_TEMPLATES.map(card),
    h('h3', { class: 'tpl-group', text: '공문 (기안문·시행문)' }), ...TEMPLATES.map(card),
  );
  $('#tool-date').value = todayIso();
  $('#tool-time').value = '14:00';
  $('#tool-amount').value = '113560';
  // 항목 수준 목록에 실제 기호 예시
  $$('#sel-level option').forEach((o) => { const lv = Number(o.value); if (lv) o.textContent = markerFor(lv, 1); });
  $('#ai-purpose').replaceChildren(...PURPOSES.map(([v, label]) => h('option', { value: v, text: label })));
  if (ARTIFACT) {
    $$('[data-local-only]').forEach((n) => { n.hidden = true; });
    // 저장·AI는 claude.ai 기능이 확인된 뒤에 보여 준다.
    $$('[data-needs-save]').forEach((n) => { n.hidden = true; });
    $('#import-ai').hidden = true;
    $('#ai-privacy').textContent = 'AI로 공문 작성을 누르면 초안이 지금 보는 사람의 Claude 계정으로 전송되고 그 사용량이 쓰입니다. 개인정보나 비공개 정보는 지우고 보내십시오.';
  }
}

async function initCapabilities() {
  if (!ARTIFACT) return;
  const use = (name) => (window.claude?.use ? window.claude.use(name).catch(() => null) : Promise.resolve(null));
  const [downloads, sample] = await Promise.all([use('downloads'), use('sample')]);
  caps.downloads = downloads;
  caps.sample = sample;
  $$('[data-needs-save]').forEach((n) => { n.hidden = !downloads; });
  $('#import-ai').hidden = !sample;
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
    if (isReport() && R.click(e)) return;
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
  sheet.addEventListener('focusin', (e) => { if (isReport()) R.focusIn(e.target); trackFocus(); });
  sheet.addEventListener('focusout', (e) => { if (isReport()) R.focusOut(e.target); });

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const inSheet = $('#sheet').contains(document.activeElement) || document.activeElement === document.body;
    const k = e.key.toLowerCase();
    if (k === 'z' && inSheet) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (k === 'y' && inSheet) { e.preventDefault(); redo(); }
    else if (k === 's' && (!ARTIFACT || caps.downloads)) { e.preventDefault(); saveJson(); }
  });

  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  const reportShift = (dir) => { const i = R.keyInfo(state.lastKey); if (i?.kind === 'block') { R.shift(i.id, dir); focusKey(state.lastKey, ...state.lastSel); } };
  $('#btn-indent').addEventListener('click', () => { if (isReport()) { reportShift(1); return; } const i = keyInfo(state.lastKey); if (i?.kind === 'block') { setLevel(i.id, blockById(i.id).level + 1); focusKey(state.lastKey, ...state.lastSel); } });
  $('#btn-outdent').addEventListener('click', () => { if (isReport()) { reportShift(-1); return; } const i = keyInfo(state.lastKey); if (i?.kind === 'block') { setLevel(i.id, blockById(i.id).level - 1); focusKey(state.lastKey, ...state.lastSel); } });
  $('#sel-level').addEventListener('change', (e) => {
    if (isReport()) { const ri = R.keyInfo(state.lastKey); if (ri?.kind === 'block') { R.setType(ri.id, e.target.value); focusKey(state.lastKey, ...state.lastSel); } return; }
    const i = keyInfo(state.lastKey); if (i?.kind === 'block') { setLevel(i.id, Number(e.target.value)); focusKey(state.lastKey, ...state.lastSel); } });
  $('#btn-table').addEventListener('click', () => (isReport() ? R.insertTable() : insertTable()));
  $('#btn-box').addEventListener('click', () => R.insertBox());
  $('#btn-bold').addEventListener('click', () => { const el = state.lastKey && $(`[data-key="${CSS.escape(state.lastKey)}"]`); if (el) { setSel(el, ...state.lastSel); R.toggleBold(el); } });
  $('#btn-break').addEventListener('click', () => R.insertBreak());
  for (const id of ['btn-indent', 'btn-outdent', 'btn-table', 'btn-box', 'btn-break', 'btn-bold']) $(`#${id}`).addEventListener('mousedown', (e) => e.preventDefault());

  $('#btn-new').addEventListener('click', () => $('#dlg-templates').showModal());
  $('#template-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-template]');
    if (!b) return;
    const t = [...REPORT_TEMPLATES, ...TEMPLATES].find((x) => x.id === b.dataset.template);
    $('#dlg-templates').close();
    const doc = t.make();
    const cur = state.doc;
    if (t.kind === 'report') {
      // 서식 설정과 부서는 지금 보고서의 것을 이어 쓴다.
      doc.meta.date = todayText();
      if (cur.kind === 'report') {
        doc.settings = JSON.parse(JSON.stringify(cur.settings));
        if (cur.meta.dept) doc.meta.dept = cur.meta.dept;
      }
      replaceDoc(doc, `'${t.name}' 서식으로 새 문서를 시작했습니다.`);
      focusKey('r:meta:title', Infinity);
      return;
    }
    if (cur.kind === 'report') {
      replaceDoc(doc, `'${t.name}' 서식으로 새 문서를 시작했습니다.`);
      focusKey('title', Infinity);
      return;
    }
    // 결문(기관·결재·연락처)은 지금 문서의 것을 이어 쓴다.
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
  $('#btn-import').addEventListener('click', () => openImport());
  $('#btn-pdf').addEventListener('click', () => $('#file-pdf').click());
  $('#file-pdf').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) loadPdf(f); e.target.value = ''; });
  $('#btn-pdf-clear').addEventListener('click', () => { clearPdf(); $('#import-text').value = ''; });
  $('#import-plain').addEventListener('click', importPlain);
  $('#import-ai').addEventListener('click', importWithAi);
  $('#ai-stop').addEventListener('click', () => imp.ctl?.abort());
  // 대화상자를 닫으면(Esc 포함) 진행 중인 AI 요청도 멈춘다.
  $('#dlg-import').addEventListener('close', () => imp.ctl?.abort());
  $('#btn-open').addEventListener('click', () => $('#file-open').click());
  $('#file-open').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ''; });
  $('#btn-save').addEventListener('click', saveJson);
  $('#btn-docx').addEventListener('click', exportDocx);
  $('#btn-hwpx').addEventListener('click', exportHwpx);
  $('#btn-print').addEventListener('click', () => (isReport() ? R.print() : window.print()));
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
  $$('[data-symbols]').forEach((b) => b.addEventListener('click', () => {
    remember();
    state.doc.settings.symbols = b.dataset.symbols.split(' ');
    changed({ sheet: true, panel: true });
  }));

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
  initCapabilities();
}

start();

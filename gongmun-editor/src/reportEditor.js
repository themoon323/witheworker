// 편집기의 보고서·제안서 모드: A4 화면에서 장·절·항목을 직접 편집한다.
// 기호(Ⅰ. 1. 1) / □ o - · / ※)는 수준에 따라 자동으로 붙고, Tab·Shift+Tab으로 수준을 바꾼다.
import {
  rblock, computeHeadingMarkers, blockStyle, blockIndent, itemSymbol, symbolWidth, tocEntries, normalizeReport, parseInline,
} from './report.js';
import { markdownToReport } from './markdown.js';
import { fontStack, reportToHtml, REPORT_CSS } from './reportHtml.js';
import { reportHeaderText } from './reportHwpx.js';
import { lintReport, applyReportFix, reportWhere } from './reportLint.js';

// Tab으로 내려가는 순서: 장 → 절 → 소제목 → □ → o → - → ·
const LADDER = ['h1', 'h2', 'h3', 'i1', 'i2', 'i3', 'i4'];
const TEXT_TYPES = ['heading', 'item', 'para', 'note'];

export function typeCode(b) {
  if (!b) return '';
  if (b.type === 'heading') return `h${b.level}`;
  if (b.type === 'item') return `i${b.level}`;
  if (b.type === 'para') return 'p';
  if (b.type === 'note') return 'n';
  return '';
}

export function typeOptions(symbols) {
  return [
    ['h1', '장 제목 (Ⅰ.)'], ['h2', '절 제목 (1.)'], ['h3', '소제목 (1))'],
    ['i1', `${itemSymbol(1, symbols)} 항목`], ['i2', `${itemSymbol(2, symbols)} 항목`], ['i3', `${itemSymbol(3, symbols)} 항목`], ['i4', `${itemSymbol(4, symbols)} 항목`],
    ['p', '문단 (서술식)'], ['n', '※ 주석'],
  ];
}

// 블록을 다른 종류로 바꾼다 (글은 그대로).
export function applyTypeCode(b, code) {
  const kind = code[0];
  const level = Number(code.slice(1)) || 0;
  if (kind === 'h') { b.type = 'heading'; b.level = level; return; }
  if (kind === 'i') { b.type = 'item'; b.level = level; return; }
  // 항목을 주석으로 바꾸면 그 항목 내용 위치에 맞춰 들여 쓴다.
  if (kind === 'n') { b.level = b.type === 'item' ? b.level : b.type === 'note' ? b.level : 0; b.type = 'note'; return; }
  if (kind === 'p') { b.type = 'para'; b.level = 0; }
}

// Tab(+1)·Shift+Tab(-1)로 수준을 옮긴다. 바뀌었으면 true
export function shiftBlock(b, dir) {
  if (b.type === 'heading' || b.type === 'item') {
    const i = LADDER.indexOf(typeCode(b));
    const j = Math.max(0, Math.min(LADDER.length - 1, i + dir));
    if (i === j) return false;
    applyTypeCode(b, LADDER[j]);
    return true;
  }
  if (b.type === 'para' || b.type === 'note') {
    const lv = Math.max(0, Math.min(4, b.level + dir));
    if (lv === b.level) return false;
    b.level = lv;
    return true;
  }
  return false;
}

// Enter로 새로 만들 블록: 제목 다음은 □, 나머지는 같은 종류
export function nextBlockAfter(b, text) {
  if (b.type === 'heading') return rblock.item(1, text);
  if (b.type === 'item') return rblock.item(b.level, text);
  if (b.type === 'note') return rblock.note(b.level, text);
  return rblock.para(b.level, text);
}

// 화면에 보이는 글(굵게 표시 적용)의 위치를 원문('**…**', '<u>…</u>' 포함) 위치로 바꾼다.
export function renderedToRaw(text, offset) {
  let shown = 0;
  let raw = 0;
  for (const p of parseInline(text)) {
    const open = p.bold ? 2 : p.underline ? 3 : 0;
    const close = p.bold ? 2 : p.underline ? 4 : 0;
    if (offset <= shown + p.text.length) return raw + open + (offset - shown);
    shown += p.text.length;
    raw += open + p.text.length + close;
  }
  return text.length;
}

const RICH = /\*\*.+?\*\*|<u>.+?<\/u>/;

export function createReportEditor(ctx) {
  const { state, $, $$, h, readText, getSel, setSel, focusKey, caretOnFirstLine, caretOnLastLine, remember, changed, toast } = ctx;

  // 편집하지 않는 칸은 굵게·밑줄을 적용해 보여 주고, 커서가 들어가면 원문으로 바꾼다.
  function richify(el, text) {
    if (!RICH.test(text || '')) { delete el.dataset.rich; return el; }
    el.replaceChildren(...parseInline(text).map((p) => (p.bold ? h('b', { text: p.text }) : p.underline ? h('u', { text: p.text }) : document.createTextNode(p.text))));
    el.dataset.rich = '1';
    return el;
  }
  const editable = (key, text, attrs) => richify(ctx.editable(key, text, attrs), text);

  function getField(key) {
    const info = keyInfo(key);
    const b = info?.id ? blockById(info.id) : null;
    switch (info?.kind) {
      case 'meta': return doc().meta[info.field] ?? '';
      case 'block': return b?.text ?? '';
      case 'boxTitle': return b?.title ?? '';
      case 'boxLines': return b?.lines.join('\n') ?? '';
      case 'caption': return b?.caption ?? '';
      case 'unit': return b?.unit ?? '';
      case 'cell': return b?.rows[info.r]?.[info.c] ?? '';
      default: return '';
    }
  }

  function focusIn(el) {
    if (!el?.dataset?.rich) return;
    const raw = getField(el.dataset.key);
    const sel = window.getSelection();
    const shownOffset = sel.rangeCount && el.contains(sel.anchorNode) ? getSel(el)[0] : null;
    delete el.dataset.rich;
    ctx.writeText(el, raw);
    setSel(el, shownOffset === null ? raw.length : renderedToRaw(raw, shownOffset));
  }

  function focusOut(el) {
    if (!el?.dataset?.key || el.dataset.rich) return;
    if (keyInfo(el.dataset.key)) richify(el, getField(el.dataset.key));
  }

  // 선택한 글을 '**…**'로 감싼다 (굵게).
  function toggleBold(el) {
    if (!el || !keyInfo(el.dataset.key)) return;
    const [s, e] = getSel(el);
    const text = readText(el);
    const sel = text.slice(s, e);
    let next;
    let caret;
    if (/^\*\*.*\*\*$/.test(sel)) { next = text.slice(0, s) + sel.slice(2, -2) + text.slice(e); caret = [s, e - 4]; } else if (text.slice(s - 2, s) === '**' && text.slice(e, e + 2) === '**') { next = text.slice(0, s - 2) + sel + text.slice(e + 2); caret = [s - 2, e - 2]; } else { next = `${text.slice(0, s)}**${sel}**${text.slice(e)}`; caret = sel ? [s, e + 4] : [s + 2, s + 2]; }
    ctx.writeText(el, next);
    setSel(el, ...caret);
    ctx.onInput(el);
  }
  const doc = () => state.doc;
  const blockIndex = (id) => doc().blocks.findIndex((b) => b.id === id);
  const blockById = (id) => doc().blocks.find((b) => b.id === id);

  // 편집 칸 열쇠: r:meta:title, rb:ID(글 블록), rbt:ID(박스 제목), rbl:ID(박스 내용), rcap:ID, runit:ID, rc:ID:행:열
  function keyInfo(key) {
    if (!key) return null;
    const p = key.split(':');
    if (p[0] === 'r' && p[1] === 'meta') return { kind: 'meta', field: p[2] };
    if (p[0] === 'rb') return { kind: 'block', id: p[1] };
    if (p[0] === 'rbt') return { kind: 'boxTitle', id: p[1] };
    if (p[0] === 'rbl') return { kind: 'boxLines', id: p[1] };
    if (p[0] === 'rcap') return { kind: 'caption', id: p[1] };
    if (p[0] === 'runit') return { kind: 'unit', id: p[1] };
    if (p[0] === 'rc') return { kind: 'cell', id: p[1], r: Number(p[2]), c: Number(p[3]) };
    return null;
  }

  function setField(key, text) {
    const info = keyInfo(key);
    if (!info) return;
    const b = info.id ? blockById(info.id) : null;
    switch (info.kind) {
      case 'meta': doc().meta[info.field] = text; break;
      case 'block': if (b) b.text = text; break;
      case 'boxTitle': if (b) b.title = text; break;
      case 'boxLines': if (b) b.lines = text.split('\n'); break;
      case 'caption': if (b) b.caption = text; break;
      case 'unit': if (b) b.unit = text; break;
      case 'cell': if (b?.rows[info.r]) b.rows[info.r][info.c] = text; break;
      default: break;
    }
  }

  // ───────── 그리기 ─────────
  const em = (n, size) => `${(n * size).toFixed(2)}pt`;
  const fontRole = (font) => {
    const f = doc().settings.fonts;
    return font === f.head ? 'head' : font === f.sub ? 'sub' : 'body';
  };
  const fontStyle = (st, extra = '') => {
    const role = fontRole(st.font);
    return `font-family:${fontStack(st.font, role)};font-size:${st.size}pt;${role === 'head' ? 'font-weight:800;' : st.bold ? 'font-weight:700;' : ''}${extra}`;
  };

  function line(b, marker, st, extraStyle) {
    const tx = editable(`rb:${b.id}`, b.text, { class: 'r-tx', placeholder: placeholderFor(b) });
    return h('div', { class: `blk r-line r-${typeCode(b)}`, 'data-id': b.id, style: fontStyle(st, extraStyle) },
      marker ? h('span', { class: 'r-mk', 'aria-hidden': 'true', style: `min-width:${em(symbolWidth(marker) + 0.5, b.type === 'heading' ? st.size : doc().settings.size)}`, text: marker }) : null, tx);
  }

  function placeholderFor(b) {
    if (doc().blocks[0]?.id === b.id) return '내용을 입력하십시오. Enter: 다음 줄 · Tab: 아래 수준 · Shift+Tab: 위 수준';
    return { heading: '제목', item: '', para: '서술식 문단', note: '주석' }[b.type] || '';
  }

  function divider(label, id) {
    return h('div', { class: `r-break${id ? ' blk' : ''}`, 'data-id': id, contenteditable: 'false' },
      h('span', { text: label }), id ? h('button', { type: 'button', 'data-ract': 'del-block', 'data-id': id, text: '삭제' }) : null);
  }

  function render(sheet) {
    const d = doc();
    const s = d.settings;
    const m = s.margins;
    const body = s.size;
    const f = s.fonts;
    sheet.classList.add('report');
    sheet.style.padding = `${m.top + m.header}mm ${m.right}mm ${m.bottom + m.footer}mm ${m.left}mm`;
    sheet.style.fontFamily = fontStack(f.body, 'body');
    sheet.style.fontSize = `${body}pt`;
    sheet.style.lineHeight = `${s.lineHeight / 100}`;
    $('#page-style').textContent = `${REPORT_CSS}\n@page { size: A4; margin: 0; }`;

    const header = reportHeaderText(d);
    sheet.append(h('div', { class: 'r-header ed-chrome', 'data-ract': 'edit-meta', title: '머리말 (문서 정보에서 바꿈)', style: `top:${m.header}mm;left:${m.left}mm;right:${m.right}mm;${fontStyle({ font: f.sub, size: 14 })}`, text: header || '머리말 없음' }));

    if (d.meta.cover) {
      sheet.append(h('div', { class: 'r-cover ed-cover' },
        editable('r:meta:title', d.meta.title, { class: 'r-cover-title', placeholder: '보고서·제안서 제목' }),
        editable('r:meta:subtitle', d.meta.subtitle, { class: 'r-cover-sub', placeholder: '부제(선택)' }),
        h('div', { class: 'r-cover-foot' },
          editable('r:meta:date', d.meta.date, { class: 'r-cover-date', placeholder: '2026. 10. 8.' }),
          editable('r:meta:dept', d.meta.dept, { class: 'r-cover-dept', placeholder: '부서·기관' }))));
      const cv = sheet.lastChild;
      cv.querySelector('.r-cover-title').setAttribute('style', fontStyle({ font: f.head, size: 26 }));
      cv.querySelector('.r-cover-sub').setAttribute('style', fontStyle({ font: f.sub, size: 17 }));
      cv.querySelector('.r-cover-date').setAttribute('style', fontStyle({ font: f.sub, size: 16 }));
      cv.querySelector('.r-cover-dept').setAttribute('style', fontStyle({ font: f.head, size: 18 }));
      sheet.append(divider('표지 끝 · 쪽 나눔'));
    }
    if (d.meta.toc) {
      sheet.append(renderToc());
      sheet.append(divider('목차 끝 · 쪽 나눔'));
    }
    if (!d.meta.cover) {
      const title = editable('r:meta:title', d.meta.title, { class: 'r-title', placeholder: '보고서·제안서 제목' });
      title.setAttribute('style', fontStyle({ font: f.head, size: 22 }));
      const sub = editable('r:meta:subtitle', d.meta.subtitle, { class: 'r-subtitle print-hide-empty', placeholder: '부제(선택)' });
      sub.setAttribute('style', fontStyle({ font: f.sub, size: body }));
      const date = editable('r:meta:date', d.meta.date, { tag: 'span', placeholder: '날짜' });
      const dept = editable('r:meta:dept', d.meta.dept, { tag: 'span', placeholder: '부서' });
      sheet.append(title, sub, h('div', { class: 'r-meta', style: fontStyle({ font: f.sub, size: body - 2 }) }, date, '  ', dept));
    }

    const wrap = h('div', { class: 'r-body', id: 'body' });
    const hm = computeHeadingMarkers(d.blocks);
    for (const b of d.blocks) {
      const st = blockStyle(b, s);
      const left = em(blockIndent(b, s), body);
      const top = `margin-top:${st.prev}pt;`;
      switch (b.type) {
        case 'heading': wrap.append(line(b, hm.get(b.id), st, `${top}margin-bottom:${st.next}pt`)); break;
        case 'item': wrap.append(line(b, itemSymbol(b.level, s.symbols), st, `${top}margin-left:${left}`)); break;
        case 'note': wrap.append(line(b, '※', st, `${top}margin-left:${left}`)); break;
        case 'para': {
          const tx = editable(`rb:${b.id}`, b.text, { class: 'r-tx r-para', placeholder: placeholderFor(b) });
          wrap.append(h('div', { class: 'blk r-p', 'data-id': b.id, style: fontStyle(st, `${top}margin-left:${left}`) }, tx));
          break;
        }
        case 'box': {
          const t = editable(`rbt:${b.id}`, b.title, { class: 'r-box-title', placeholder: '박스 제목(선택) 예: 참고, 요청 사항' });
          const l = editable(`rbl:${b.id}`, b.lines.join('\n'), { class: 'r-box-lines', placeholder: '박스 내용 (줄마다 □, o, - 기호를 써도 됩니다)' });
          wrap.append(h('div', { class: 'blk r-box', 'data-id': b.id, style: fontStyle(st, top) }, boxCtrl(b.id), t, l));
          break;
        }
        case 'table': wrap.append(renderTable(b, st, left, top)); break;
        case 'pagebreak': wrap.append(divider('쪽 나눔', b.id)); break;
        default: break;
      }
    }
    sheet.append(wrap);
  }

  function renderToc() {
    const d = doc();
    const f = d.settings.fonts;
    const body = d.settings.size;
    const box = h('div', { class: 'r-toc ed-chrome', 'data-ract': 'edit-meta', title: '목차는 장·절 제목으로 자동으로 만듭니다' },
      h('div', { class: 'r-toc-title', style: fontStyle({ font: f.head, size: 20 }), text: '목   차' }));
    const entries = tocEntries(d.blocks);
    if (!entries.length) box.append(h('div', { class: 'empty', text: '장·절 제목(Ⅰ., 1.)을 넣으면 목차가 생깁니다.' }));
    for (const e of entries) {
      const st = e.level === 1 ? { font: f.head, size: body + 1 } : { font: f.body, size: body };
      box.append(h('div', { class: 'r-line', style: fontStyle(st, `margin-left:${em(e.level === 1 ? 2 : 3.5, body)};margin-top:${e.level === 1 ? 10 : 3}pt`) },
        h('span', { class: 'r-mk', style: `min-width:${em(e.level === 1 ? 1.5 : 1.2, body)}`, text: e.marker }), h('span', { class: 'r-tx', text: e.text })));
    }
    return box;
  }

  function boxCtrl(id) {
    return h('div', { class: 'tbl-ctrl', contenteditable: 'false' },
      h('button', { type: 'button', 'data-ract': 'after', 'data-id': id, text: '아래에 항목' }),
      h('button', { type: 'button', 'data-ract': 'del-block', 'data-id': id, text: '박스 삭제' }));
  }

  function renderTable(b, st, left, top) {
    const cols = Math.max(...b.rows.map((r) => r.length));
    const tbody = h('tbody');
    b.rows.forEach((row, r) => {
      const tr = h('tr', { class: b.header && r === 0 ? 'r-th' : undefined });
      for (let c = 0; c < cols; c++) tr.append(editable(`rc:${b.id}:${r}:${c}`, row[c] ?? '', { tag: 'td' }));
      tbody.append(tr);
    });
    const ctrl = h('div', { class: 'tbl-ctrl', contenteditable: 'false' },
      ...[['row-add', '행 +'], ['row-del', '행 −'], ['col-add', '열 +'], ['col-del', '열 −'], ['header', '머리행'], ['after', '아래에 항목'], ['del-block', '표 삭제']]
        .map(([act, label]) => h('button', { type: 'button', 'data-ract': act, 'data-id': b.id, text: label })));
    const f = doc().settings.fonts;
    const cap = editable(`rcap:${b.id}`, b.caption, { class: 'r-caption print-hide-empty', placeholder: '<표 1> 표 제목(선택)' });
    cap.setAttribute('style', fontStyle({ font: f.sub, size: st.size, bold: true }, top));
    const unit = editable(`runit:${b.id}`, b.unit, { class: 'r-unit print-hide-empty', placeholder: '(단위: ○)' });
    unit.setAttribute('style', fontStyle({ font: f.sub, size: st.size - 1 }));
    return h('div', { class: 'blk r-table', 'data-id': b.id, style: `margin-left:${left}` }, ctrl, cap, unit,
      h('div', { class: 'tbl-wrap' }, h('table', { style: fontStyle(st, 'margin-top:2pt') }, tbody)));
  }

  // 글자를 치는 동안 바뀌는 부분(목차, 머리말)만 다시 그린다.
  function refresh() {
    const sheet = $('#sheet');
    const toc = $('.r-toc', sheet);
    if (toc) toc.replaceWith(renderToc());
    const hd = $('.r-header', sheet);
    if (hd) hd.textContent = reportHeaderText(doc()) || '머리말 없음';
  }

  // ───────── 블록 조작 ─────────
  function shift(id, dir) {
    const b = blockById(id);
    if (!b) return false;
    remember();
    const ok = shiftBlock(b, dir);
    if (!ok) { state.past.pop(); return false; }
    changed({ sheet: true });
    return true;
  }

  function setType(id, code) {
    const b = blockById(id);
    if (!b || !TEXT_TYPES.includes(b.type) || typeCode(b) === code) return;
    remember();
    applyTypeCode(b, code);
    changed({ sheet: true });
  }

  function currentBlockId() {
    const info = keyInfo(state.lastKey);
    if (info?.id) return info.id;
    return doc().blocks[doc().blocks.length - 1]?.id;
  }

  function insertAfterCurrent(block, focus) {
    const id = currentBlockId();
    const i = id ? blockIndex(id) : doc().blocks.length - 1;
    remember();
    doc().blocks.splice(i + 1, 0, block);
    changed({ sheet: true });
    if (focus) focusKey(focus(block), 0);
  }

  const insertTable = () => insertAfterCurrent(rblock.table([['구분', '내용', '비고'], ['', '', ''], ['', '', '']]), (b) => `rc:${b.id}:1:0`);
  const insertBox = () => insertAfterCurrent(rblock.box('참고', ['']), (b) => `rbl:${b.id}`);
  const insertBreak = () => {
    insertAfterCurrent(rblock.pagebreak());
    toast('쪽 나눔을 넣었습니다. 한글 문서에서 다음 내용이 새 쪽에서 시작합니다.');
  };

  function click(e) {
    const act = e.target.closest('[data-ract]');
    if (!act) return false;
    const a = act.dataset.ract;
    if (a === 'edit-meta') { ctx.selectTab('rinfo'); return true; }
    const id = act.dataset.id;
    const b = blockById(id);
    if (!b) return true;
    e.preventDefault();
    remember();
    let focus = null;
    if (a === 'del-block') {
      const i = blockIndex(id);
      doc().blocks.splice(i, 1);
      const prev = doc().blocks[Math.max(0, i - 1)];
      if (prev && TEXT_TYPES.includes(prev.type)) focus = `rb:${prev.id}`;
    } else if (a === 'after') {
      const nb = rblock.item(1, '');
      doc().blocks.splice(blockIndex(id) + 1, 0, nb);
      focus = `rb:${nb.id}`;
    } else if (b.type === 'table') {
      const info = keyInfo(state.lastKey);
      const r = info?.kind === 'cell' && info.id === id ? info.r : b.rows.length - 1;
      const c = info?.kind === 'cell' && info.id === id ? info.c : 0;
      const cols = Math.max(...b.rows.map((x) => x.length));
      if (a === 'row-add') { b.rows.splice(r + 1, 0, new Array(cols).fill('')); focus = `rc:${id}:${r + 1}:0`; }
      if (a === 'row-del' && b.rows.length > 1) b.rows.splice(r, 1);
      if (a === 'col-add') { b.rows.forEach((row) => row.splice(c + 1, 0, '')); focus = `rc:${id}:${r}:${c + 1}`; }
      if (a === 'col-del' && cols > 1) b.rows.forEach((row) => row.splice(c, 1));
      if (a === 'header') b.header = !b.header;
    }
    changed({ sheet: true });
    if (focus) focusKey(focus, Infinity);
    return true;
  }

  // ───────── 키보드 ─────────
  // 화면 순서대로 이전·다음 편집 칸
  function neighbor(el, dir) {
    const all = $$('#sheet [data-key]');
    const i = all.indexOf(el);
    return all[i + dir] || null;
  }

  function gotoNeighbor(el, dir, atEnd) {
    const n = neighbor(el, dir);
    if (!n) return false;
    focusKey(n.dataset.key, atEnd ? Infinity : 0);
    return true;
  }

  function keydown(e, el) {
    const info = keyInfo(el.dataset.key);
    if (!info) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleBold(el); return; }
    if (info.kind === 'block') return blockKeydown(e, el, info.id);
    if (info.kind === 'cell') return cellKeydown(e, el, info);
    if (info.kind === 'boxLines') {
      if (e.key === 'Enter') { e.preventDefault(); ctx.insertAtCaret(el, '\n'); return; }
      if (e.key === 'ArrowUp' && caretOnFirstLine(el) && gotoNeighbor(el, -1, true)) e.preventDefault();
      if (e.key === 'ArrowDown' && caretOnLastLine(el) && gotoNeighbor(el, 1, false)) e.preventDefault();
      return;
    }
    // 한 줄 칸(제목·날짜·박스 제목·표 제목): Enter는 다음 칸으로
    if (e.key === 'Enter') { e.preventDefault(); gotoNeighbor(el, 1, false); return; }
    if (e.key === 'ArrowDown' && gotoNeighbor(el, 1, false)) e.preventDefault();
    if (e.key === 'ArrowUp' && gotoNeighbor(el, -1, true)) e.preventDefault();
  }

  function blockKeydown(e, el, id) {
    const d = doc();
    const b = blockById(id);
    const i = blockIndex(id);
    const [s, end] = getSel(el);
    const text = readText(el);
    if (e.key === 'Tab') {
      e.preventDefault();
      shift(id, e.shiftKey ? -1 : 1);
      focusKey(`rb:${id}`, s, end);
      return;
    }
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); ctx.insertAtCaret(el, '\n'); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!text.trim()) {
        // 빈 줄에서 Enter: 한 단계 위로 (□ 다음은 문단)
        if (b.type === 'item' && b.level > 1) { shift(id, -1); focusKey(`rb:${id}`, 0); return; }
        if (b.type === 'item' || b.type === 'note') { remember(); applyTypeCode(b, 'p'); changed({ sheet: true }); focusKey(`rb:${id}`, 0); return; }
        if (b.type === 'para') return;
      }
      remember();
      b.text = text.slice(0, s);
      const nb = nextBlockAfter(b, text.slice(end));
      d.blocks.splice(i + 1, 0, nb);
      changed({ sheet: true });
      focusKey(`rb:${nb.id}`, 0);
      return;
    }
    if (e.key === 'Backspace' && s === 0 && end === 0) {
      const prev = d.blocks[i - 1];
      if (!text && d.blocks.length > 1) {
        e.preventDefault();
        remember();
        d.blocks.splice(i, 1);
        changed({ sheet: true });
        if (prev && TEXT_TYPES.includes(prev.type)) focusKey(`rb:${prev.id}`, Infinity);
        else if (prev?.type === 'box') focusKey(`rbl:${prev.id}`, Infinity);
        else if (prev?.type === 'table') focusKey(`rc:${prev.id}:${prev.rows.length - 1}:0`, Infinity);
        return;
      }
      if (prev && TEXT_TYPES.includes(prev.type)) {
        e.preventDefault();
        remember();
        const join = prev.text.length;
        prev.text += text;
        d.blocks.splice(i, 1);
        changed({ sheet: true });
        focusKey(`rb:${prev.id}`, join);
      }
      return;
    }
    if (e.key === 'Delete' && s === text.length && end === s) {
      const next = d.blocks[i + 1];
      if (next && TEXT_TYPES.includes(next.type)) {
        e.preventDefault();
        remember();
        b.text = text + next.text;
        d.blocks.splice(i + 1, 1);
        changed({ sheet: true });
        focusKey(`rb:${id}`, s);
      }
      return;
    }
    if (e.altKey && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const j = i + (e.key === 'ArrowUp' ? -1 : 1);
      if (j < 0 || j >= d.blocks.length) return;
      remember();
      [d.blocks[i], d.blocks[j]] = [d.blocks[j], d.blocks[i]];
      changed({ sheet: true });
      focusKey(`rb:${id}`, s);
      return;
    }
    if (e.key === 'ArrowUp' && !e.shiftKey && caretOnFirstLine(el) && gotoNeighbor(el, -1, true)) { e.preventDefault(); return; }
    if (e.key === 'ArrowDown' && !e.shiftKey && caretOnLastLine(el) && gotoNeighbor(el, 1, false)) e.preventDefault();
  }

  function cellKeydown(e, el, info) {
    const b = blockById(info.id);
    if (!b) return;
    const cols = Math.max(...b.rows.map((r) => r.length));
    if (e.key === 'Tab') {
      e.preventDefault();
      let idx = info.r * cols + info.c + (e.shiftKey ? -1 : 1);
      if (idx < 0) return;
      if (idx >= b.rows.length * cols) {
        remember();
        b.rows.push(new Array(cols).fill(''));
        changed({ sheet: true });
        idx = (b.rows.length - 1) * cols;
      }
      focusKey(`rc:${b.id}:${Math.floor(idx / cols)}:${idx % cols}`, 0, Infinity);
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); ctx.insertAtCaret(el, '\n'); }
  }

  // 여러 줄을 붙여 넣으면 마크다운·보고서 기호를 읽어 블록으로 나눈다.
  function paste(el, text) {
    const info = keyInfo(el.dataset.key);
    if (info?.kind !== 'block' || !text.replace(/\n+$/, '').includes('\n')) return false;
    const { doc: parsed } = markdownToReport(text);
    const d = doc();
    remember();
    if (parsed.meta.title && !d.meta.title) d.meta.title = parsed.meta.title;
    const incoming = parsed.blocks;
    if (!incoming.length) { state.past.pop(); return true; }
    const i = blockIndex(info.id);
    const cur = d.blocks[i];
    const [s] = getSel(el);
    if (!cur.text.trim()) d.blocks.splice(i, 1, ...incoming);
    else {
      const after = cur.text.slice(s);
      cur.text = cur.text.slice(0, s);
      d.blocks.splice(i + 1, 0, ...incoming);
      const last = incoming[incoming.length - 1];
      if (after && 'text' in last) last.text += after;
    }
    changed({ sheet: true });
    const last = incoming[incoming.length - 1];
    if (TEXT_TYPES.includes(last.type)) focusKey(`rb:${last.id}`, Infinity);
    toast(`붙여 넣은 내용을 ${incoming.length}줄로 나눴습니다. 제목·목록·기호를 읽어 수준을 맞췄습니다.`);
    return true;
  }

  // ───────── 검사 ─────────
  function keyForLoc(loc) {
    switch (loc.kind) {
      case 'meta': return `r:meta:${loc.field}`;
      case 'block': return `rb:${loc.blockId}`;
      case 'boxTitle': return `rbt:${loc.blockId}`;
      case 'boxLine': return `rbl:${loc.blockId}`;
      case 'caption': return `rcap:${loc.blockId}`;
      case 'cell': return `rc:${loc.blockId}:${loc.r}:${loc.c}`;
      default: return null;
    }
  }

  function gotoIssue(it) {
    const key = keyForLoc(it.loc);
    if (!key || !$(`[data-key="${CSS.escape(key)}"]`)) {
      ctx.selectTab('rinfo');
      document.getElementById(`f-r-${it.loc.field}`)?.focus();
      return;
    }
    let base = 0;
    if (it.loc.kind === 'boxLine') {
      const b = blockById(it.loc.blockId);
      base = b.lines.slice(0, it.loc.index).reduce((n, l) => n + l.length + 1, 0);
    }
    if (it.range) focusKey(key, base + it.range[0], base + it.range[1]);
    else focusKey(key, Infinity);
  }

  function markIssues(issues) {
    const rank = { error: 3, warn: 2, info: 1 };
    const worst = new Map();
    for (const it of issues) {
      const id = it.loc.blockId;
      if (!id) continue;
      if (!worst.has(id) || rank[it.severity] > rank[worst.get(id)]) worst.set(id, it.severity);
    }
    for (const [id, sev] of worst) $(`#sheet .blk[data-id="${CSS.escape(id)}"]`)?.setAttribute('data-issue', sev);
  }

  // 인쇄·PDF: 머리말·쪽 번호까지 담은 미리보기 문서를 인쇄한다.
  function print() {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.append(frame);
    frame.onload = () => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(() => frame.remove(), 2000);
    };
    frame.srcdoc = reportToHtml(doc());
  }

  return {
    keyInfo, setField, render, refresh, keydown, paste, click, shift, setType, currentBlockId, focusIn, focusOut, toggleBold,
    insertTable, insertBox, insertBreak, lint: () => lintReport(doc()), applyFix: (it) => applyReportFix(doc(), it),
    where: (loc) => reportWhere(doc(), loc), gotoIssue, markIssues, print, typeOf: (id) => typeCode(blockById(id)),
    normalize: normalizeReport,
  };
}

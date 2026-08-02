const editor = document.querySelector('#editor');
const preview = document.querySelector('#preview');
const workspace = document.querySelector('#workspace');
const title = document.querySelector('#document-title');
const saveState = document.querySelector('#save-state');
const cursorState = document.querySelector('#cursor-state');
const wordCount = document.querySelector('#word-count');
const toast = document.querySelector('#toast');
const editorPane = document.querySelector('.editor-pane');
const previewPane = document.querySelector('.preview-pane');
const editorMirror = document.querySelector('#editor-mirror');
const masterScrollbar = document.querySelector('#master-scrollbar');
const masterScrollTrack = document.querySelector('#master-scroll-track');

const initialContent = String.raw`# 欢迎使用 Mori

这是一个安静、轻量的 Markdown 与 TeX 编辑器。

## Markdown

你可以使用 **粗体**、*斜体*、列表、引用、表格和代码块。

> 写下内容，剩下的交给预览。

## TeX

行内公式：$E = mc^2$

块级公式：

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$
`;

const state = {
  filePath: null,
  fileName: '未命名',
  savedContent: '',
  dirty: false,
  mode: 'edit',
  wrap: true,
  syncingScroll: false,
  scrollAnchors: [],
  renderTimer: null,
  scrollTimer: null,
  toastTimer: null
};

const undoHistory = new window.MoriUndoHistory({ limit: 200, mergeDelay: 1000 });
let pendingBeforeInput = null;
let compositionSnapshot = null;
let isComposing = false;

function escapeHtml(value) {
  const span = document.createElement('span');
  span.textContent = value;
  return span.innerHTML;
}

function renderMath(source, displayMode) {
  try {
    return katex.renderToString(source.trim(), {
      displayMode,
      throwOnError: true,
      strict: false,
      trust: false
    });
  } catch (error) {
    return `<span class="math-error" title="${escapeHtml(error.message)}">${escapeHtml(source)}</span>`;
  }
}

marked.use({
  gfm: true,
  breaks: false,
  extensions: [
    {
      name: 'displayMath',
      level: 'block',
      start(source) {
        const match = source.match(/(?:^|\n)\s*(?:\$\$|\\\[)/);
        return match ? match.index : undefined;
      },
      tokenizer(source) {
        const dollar = /^\s*\$\$\s*\n?([\s\S]+?)\n?\s*\$\$(?:\n|$)/.exec(source);
        if (dollar) return { type: 'displayMath', raw: dollar[0], text: dollar[1] };
        const bracket = /^\s*\\\[\s*\n?([\s\S]+?)\n?\s*\\\](?:\n|$)/.exec(source);
        if (bracket) return { type: 'displayMath', raw: bracket[0], text: bracket[1] };
        return undefined;
      },
      renderer(token) {
        return `<div class="math-display">${renderMath(token.text, true)}</div>`;
      }
    },
    {
      name: 'inlineMath',
      level: 'inline',
      start(source) {
        const dollarIndex = source.indexOf('$');
        const bracketIndex = source.indexOf('\\(');
        if (dollarIndex < 0) return bracketIndex < 0 ? undefined : bracketIndex;
        if (bracketIndex < 0) return dollarIndex;
        return Math.min(dollarIndex, bracketIndex);
      },
      tokenizer(source) {
        const dollar = /^\$(?!\s)([^$\n]+?)(?<!\s)\$/.exec(source);
        if (dollar) return { type: 'inlineMath', raw: dollar[0], text: dollar[1] };
        const bracket = /^\\\((.+?)\\\)/.exec(source);
        if (bracket) return { type: 'inlineMath', raw: bracket[0], text: bracket[1] };
        return undefined;
      },
      renderer(token) {
        return renderMath(token.text, false);
      }
    }
  ]
});

function renderPreviewWithAnchors(source) {
  const tokens = marked.lexer(source);
  const fragment = document.createDocumentFragment();
  let sourceOffset = 0;

  tokens.forEach((token) => {
    const sourceStart = sourceOffset;
    sourceOffset += token.raw?.length || 0;
    if (token.type === 'space' || token.type === 'def') return;

    const tokenList = [token];
    tokenList.links = tokens.links;
    const rendered = marked.parser(tokenList);
    const sanitized = DOMPurify.sanitize(rendered, {
      ADD_ATTR: ['class', 'aria-hidden'],
      USE_PROFILES: { html: true }
    });
    const template = document.createElement('template');
    template.innerHTML = sanitized;

    Array.from(template.content.children).forEach((element) => {
      element.dataset.sourceStart = String(sourceStart);
      element.dataset.sourceEnd = String(sourceOffset);
    });
    fragment.append(template.content);
  });

  preview.replaceChildren(fragment);
}

function updatePreview() {
  const source = editor.value;
  if (!source.trim()) {
    preview.innerHTML = '<div class="empty-preview">开始书写，预览会出现在这里</div>';
    scheduleSharedScrollUpdate();
    return;
  }

  renderPreviewWithAnchors(source);

  preview.querySelectorAll('a[href]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const href = link.getAttribute('href');
      if (/^https?:\/\//i.test(href)) {
        event.preventDefault();
        window.desktop.openExternal(href);
      }
    });
  });

  scheduleSharedScrollUpdate();
}

function schedulePreview() {
  window.clearTimeout(state.renderTimer);
  state.renderTimer = window.setTimeout(updatePreview, 90);
}

function setDirty(value) {
  state.dirty = value;
  saveState.textContent = value ? '未保存' : '已保存';
  title.textContent = `${value ? '• ' : ''}${state.fileName}`;
  document.title = `${value ? '• ' : ''}${state.fileName} — Mori Markdown`;
  window.desktop.setDirty(value);
}

function updateEditorHeight() {
  const previousEditorScroll = editorPane.scrollTop;
  const previousMasterScroll = masterScrollbar.scrollTop;
  editor.style.height = 'auto';
  editor.style.height = `${Math.max(editor.scrollHeight, editor.parentElement.clientHeight)}px`;
  editorPane.scrollTop = previousEditorScroll;
  if (state.mode === 'split') masterScrollbar.scrollTop = previousMasterScroll;

  window.requestAnimationFrame(() => {
    if (state.mode === 'split') {
      masterScrollbar.scrollTop = previousMasterScroll;
      syncPanesFromMaster();
    } else if (state.mode === 'edit') {
      editorPane.scrollTop = previousEditorScroll;
    }
  });
  scheduleSharedScrollUpdate();
}

function getScrollRange(element) {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function getMasterScrollRange() {
  return Math.max(0, masterScrollbar.scrollHeight - masterScrollbar.clientHeight);
}

function buildEditorMirror(sourceOffsets) {
  const computed = window.getComputedStyle(editor);
  editorMirror.style.width = `${editor.offsetWidth}px`;
  editorMirror.style.boxSizing = computed.boxSizing;
  editorMirror.style.padding = computed.padding;
  editorMirror.style.fontFamily = computed.fontFamily;
  editorMirror.style.fontSize = computed.fontSize;
  editorMirror.style.fontWeight = computed.fontWeight;
  editorMirror.style.fontStyle = computed.fontStyle;
  editorMirror.style.fontVariant = computed.fontVariant;
  editorMirror.style.fontStretch = computed.fontStretch;
  editorMirror.style.lineHeight = computed.lineHeight;
  editorMirror.style.letterSpacing = computed.letterSpacing;
  editorMirror.style.wordSpacing = computed.wordSpacing;
  editorMirror.style.tabSize = computed.tabSize;
  editorMirror.style.whiteSpace = computed.whiteSpace;
  editorMirror.style.overflowWrap = computed.overflowWrap;
  editorMirror.style.wordBreak = computed.wordBreak;
  editorMirror.replaceChildren();

  const uniqueOffsets = [...new Set(sourceOffsets)].sort((left, right) => left - right);
  let previousOffset = 0;
  uniqueOffsets.forEach((offset) => {
    editorMirror.append(document.createTextNode(editor.value.slice(previousOffset, offset)));
    const marker = document.createElement('span');
    marker.className = 'source-map-anchor';
    marker.dataset.sourceOffset = String(offset);
    marker.textContent = '\u200b';
    editorMirror.append(marker);
    previousOffset = offset;
  });
  editorMirror.append(document.createTextNode(editor.value.slice(previousOffset)));
}

function rebuildScrollAnchors() {
  const mappedElements = Array.from(preview.querySelectorAll('[data-source-start]'));
  if (mappedElements.length === 0) {
    state.scrollAnchors = [];
    return;
  }

  const sourceOffsets = [0, editor.value.length];
  mappedElements.forEach((element) => {
    sourceOffsets.push(Number(element.dataset.sourceStart), Number(element.dataset.sourceEnd));
  });
  buildEditorMirror(sourceOffsets);

  const markerByOffset = new Map(
    Array.from(editorMirror.querySelectorAll('.source-map-anchor')).map((marker) => [
      Number(marker.dataset.sourceOffset),
      marker.offsetTop
    ])
  );
  const anchors = [{ editorY: 0, previewY: 0 }];
  const previewRect = preview.getBoundingClientRect();

  mappedElements.forEach((element) => {
    const sourceStart = Number(element.dataset.sourceStart);
    const sourceEnd = Number(element.dataset.sourceEnd);
    const editorStart = markerByOffset.get(sourceStart);
    const editorEnd = markerByOffset.get(sourceEnd);
    const previewStart = element.getBoundingClientRect().top - previewRect.top;
    if (Number.isFinite(editorStart)) {
      anchors.push({ editorY: editorStart, previewY: previewStart });
    }
    if (Number.isFinite(editorEnd)) {
      anchors.push({
        editorY: editorEnd,
        previewY: previewStart + element.offsetHeight
      });
    }
  });
  anchors.push({ editorY: editor.scrollHeight, previewY: preview.scrollHeight });
  anchors.sort((left, right) => left.editorY - right.editorY || left.previewY - right.previewY);

  const normalized = [];
  anchors.forEach((anchor) => {
    const previous = normalized.at(-1);
    if (previous && Math.abs(previous.editorY - anchor.editorY) < 0.5) {
      previous.previewY = Math.max(previous.previewY, anchor.previewY);
      return;
    }
    normalized.push({
      editorY: anchor.editorY,
      previewY: previous ? Math.max(previous.previewY, anchor.previewY) : anchor.previewY
    });
  });
  state.scrollAnchors = normalized;
}

function mapEditorYToPreviewY(editorY) {
  const anchors = state.scrollAnchors;
  if (anchors.length < 2) {
    const editorHeight = Math.max(1, editor.scrollHeight);
    return (editorY / editorHeight) * preview.scrollHeight;
  }

  if (editorY <= anchors[0].editorY) return anchors[0].previewY;
  if (editorY >= anchors.at(-1).editorY) return anchors.at(-1).previewY;

  let low = 0;
  let high = anchors.length - 1;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (anchors[middle].editorY <= editorY) low = middle;
    else high = middle;
  }

  const start = anchors[low];
  const end = anchors[high];
  const distance = Math.max(1, end.editorY - start.editorY);
  const ratio = (editorY - start.editorY) / distance;
  return start.previewY + (end.previewY - start.previewY) * ratio;
}

function syncPanesFromMaster() {
  if (state.mode !== 'split') return;
  const masterRange = getMasterScrollRange();
  const progress = masterRange > 0 ? masterScrollbar.scrollTop / masterRange : 0;

  state.syncingScroll = true;
  const editorRange = getScrollRange(editorPane);
  const previewRange = getScrollRange(previewPane);
  editorPane.scrollTop = progress * editorRange;

  if (progress <= 0) {
    previewPane.scrollTop = 0;
  } else if (progress >= 1) {
    previewPane.scrollTop = previewRange;
  } else {
    const editorCenter = editorPane.scrollTop + editorPane.clientHeight / 2;
    const previewCenter = mapEditorYToPreviewY(editorCenter);
    previewPane.scrollTop = Math.max(
      0,
      Math.min(previewRange, previewCenter - previewPane.clientHeight / 2)
    );
  }
  window.requestAnimationFrame(() => {
    state.syncingScroll = false;
  });
}

function updateSharedScroll() {
  if (state.mode !== 'split') return;
  const previousScrollTop = masterScrollbar.scrollTop;
  rebuildScrollAnchors();
  const contentRange = getScrollRange(editorPane);
  masterScrollTrack.style.height = `${masterScrollbar.clientHeight + contentRange}px`;
  masterScrollbar.scrollTop = Math.min(previousScrollTop, getMasterScrollRange());
  syncPanesFromMaster();
}

function scheduleSharedScrollUpdate() {
  window.clearTimeout(state.scrollTimer);
  state.scrollTimer = window.setTimeout(updateSharedScroll, 0);
}

function moveMasterScroll(delta) {
  masterScrollbar.scrollTop += delta;
}

function updateStats() {
  const beforeCursor = editor.value.slice(0, editor.selectionStart);
  const lines = beforeCursor.split('\n');
  cursorState.textContent = `行 ${lines.length}，列 ${lines.at(-1).length + 1}`;

  const compact = editor.value.trim();
  const cjk = (compact.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const words = (compact.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').match(/[\p{L}\p{N}_]+(?:['’-][\p{L}\p{N}_]+)*/gu) || []).length;
  wordCount.textContent = `${cjk + words} 字`;
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.classList.add('visible');
  state.toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 1600);
}

function captureEditorSnapshot() {
  return {
    value: editor.value,
    selectionStart: editor.selectionStart,
    selectionEnd: editor.selectionEnd,
    selectionDirection: editor.selectionDirection
  };
}

function refreshAfterEditorChange() {
  const dirty = editor.value !== state.savedContent;
  if (dirty !== state.dirty) setDirty(dirty);
  schedulePreview();
  updateStats();
  updateEditorHeight();
}

function applyHistoryResult(result) {
  if (!result) return;
  const previousEditorScroll = editorPane.scrollTop;
  const previousMasterScroll = masterScrollbar.scrollTop;
  editor.value = result.value;
  editor.setSelectionRange(
    result.selection.start,
    result.selection.end,
    result.selection.direction
  );
  editorPane.scrollTop = previousEditorScroll;
  masterScrollbar.scrollTop = previousMasterScroll;
  refreshAfterEditorChange();
}

function undo() {
  pendingBeforeInput = null;
  applyHistoryResult(undoHistory.undo(editor.value));
}

function redo() {
  pendingBeforeInput = null;
  applyHistoryResult(undoHistory.redo(editor.value));
}

function setContent(content, filePath = null, fileName = '未命名') {
  editor.value = content;
  state.filePath = filePath;
  state.fileName = fileName;
  state.savedContent = content;
  pendingBeforeInput = null;
  compositionSnapshot = null;
  isComposing = false;
  undoHistory.reset();
  setDirty(false);
  updatePreview();
  updateStats();
  updateEditorHeight();
  editor.focus();
  editor.setSelectionRange(0, 0);
}

async function saveDocument(saveAs = false) {
  const result = await window.desktop.saveDocument({
    content: editor.value,
    filePath: state.filePath,
    saveAs
  });

  if (!result.canceled) {
    state.filePath = result.filePath;
    state.fileName = result.name;
    state.savedContent = editor.value;
    undoHistory.breakGroup();
    setDirty(false);
    showToast('已保存');
    return true;
  }
  return false;
}

async function resolveReplacement() {
  const decision = await window.desktop.confirmReplace();
  if (decision === 'save') return saveDocument(false);
  return decision === true;
}

async function newDocument() {
  if (!(await resolveReplacement())) return;
  setContent('', null, '未命名');
}

async function openDocument() {
  if (!(await resolveReplacement())) return;
  const result = await window.desktop.openDocument();
  if (!result.canceled) {
    setContent(result.content, result.filePath, result.name);
    showToast('文档已打开');
  }
}

function setMode(mode) {
  state.mode = mode;
  workspace.className = `workspace mode-${mode}`;
  document.querySelectorAll('.mode-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });
  if (mode !== 'edit') updatePreview();
  if (mode !== 'read') updateEditorHeight();
  if (mode === 'split') scheduleSharedScrollUpdate();
}

editor.addEventListener('beforeinput', (event) => {
  if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
    event.preventDefault();
    if (event.inputType === 'historyUndo') undo();
    else redo();
    return;
  }
  if (isComposing || event.isComposing) return;
  pendingBeforeInput = {
    snapshot: captureEditorSnapshot(),
    inputType: event.inputType
  };
});

editor.addEventListener('input', (event) => {
  if (isComposing || event.isComposing) {
    pendingBeforeInput = null;
  } else if (pendingBeforeInput) {
    undoHistory.record(
      pendingBeforeInput.snapshot,
      captureEditorSnapshot(),
      event.inputType || pendingBeforeInput.inputType
    );
    pendingBeforeInput = null;
  } else {
    undoHistory.breakGroup();
  }
  refreshAfterEditorChange();
});

editor.addEventListener('compositionstart', () => {
  undoHistory.breakGroup();
  pendingBeforeInput = null;
  compositionSnapshot = captureEditorSnapshot();
  isComposing = true;
});

editor.addEventListener('compositionend', () => {
  isComposing = false;
  pendingBeforeInput = null;
  if (compositionSnapshot) {
    undoHistory.record(
      compositionSnapshot,
      captureEditorSnapshot(),
      'insertCompositionText'
    );
  }
  compositionSnapshot = null;
  undoHistory.breakGroup();
  refreshAfterEditorChange();
});

editor.addEventListener('click', updateStats);
editor.addEventListener('keyup', updateStats);
editor.addEventListener('pointerdown', () => undoHistory.breakGroup());
editor.addEventListener('blur', () => undoHistory.breakGroup());

masterScrollbar.addEventListener('scroll', syncPanesFromMaster);

[editorPane, previewPane].forEach((pane) => {
  pane.addEventListener(
    'wheel',
    (event) => {
      if (state.mode !== 'split') return;
      event.preventDefault();
      moveMasterScroll(event.deltaY);
    },
    { passive: false }
  );
});
editor.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  const primaryModifier = (event.ctrlKey || event.metaKey) && !event.altKey;
  if (!isComposing && primaryModifier && key === 'z') {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (!isComposing && primaryModifier && key === 'y') {
    event.preventDefault();
    redo();
    return;
  }

  const navigationKeys = new Set([
    'arrowleft',
    'arrowright',
    'arrowup',
    'arrowdown',
    'home',
    'end',
    'pageup',
    'pagedown'
  ]);
  if (navigationKeys.has(key) || (primaryModifier && key === 'a')) {
    undoHistory.breakGroup();
  }

  if (event.key === 'Tab') {
    event.preventDefault();
    const before = captureEditorSnapshot();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText('  ', start, end, 'end');
    undoHistory.breakGroup();
    undoHistory.record(before, captureEditorSnapshot(), 'insertTab');
    refreshAfterEditorChange();
  }
});

document.querySelector('#new-button').addEventListener('click', newDocument);
document.querySelector('#open-button').addEventListener('click', openDocument);
document.querySelector('#save-button').addEventListener('click', () => saveDocument(false));

document.querySelectorAll('.mode-button').forEach((button) => {
  button.addEventListener('click', () => setMode(button.dataset.mode));
});

document.querySelector('#wrap-button').addEventListener('click', (event) => {
  state.wrap = !state.wrap;
  editor.classList.toggle('nowrap', !state.wrap);
  event.currentTarget.classList.toggle('active', state.wrap);
  updateEditorHeight();
});

document.addEventListener('keydown', (event) => {
  if (!event.ctrlKey) return;
  const key = event.key.toLowerCase();
  if (key === 'n') {
    event.preventDefault();
    newDocument();
  } else if (key === 'o') {
    event.preventDefault();
    openDocument();
  } else if (key === 's') {
    event.preventDefault();
    saveDocument(event.shiftKey);
  } else if (key === '1') {
    event.preventDefault();
    setMode('edit');
  } else if (key === '2') {
    event.preventDefault();
    setMode('split');
  } else if (key === '3') {
    event.preventDefault();
    setMode('read');
  }
});

window.addEventListener('resize', () => {
  updateEditorHeight();
  scheduleSharedScrollUpdate();
});

window.desktop.onSaveBeforeClose(async () => {
  const saved = await saveDocument(false);
  if (saved) window.desktop.closeAfterSave();
});

let externalOpenQueue = Promise.resolve();
window.desktop.onOpenPath((document) => {
  externalOpenQueue = externalOpenQueue.then(async () => {
    if (!(await resolveReplacement())) return;
    setContent(document.content, document.filePath, document.name);
    showToast('文档已打开');
  });
});

setContent(initialContent);

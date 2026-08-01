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
  dirty: false,
  mode: 'edit',
  wrap: true,
  syncingScroll: false,
  renderTimer: null,
  scrollTimer: null,
  toastTimer: null
};

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

function updatePreview() {
  const source = editor.value;
  if (!source.trim()) {
    preview.innerHTML = '<div class="empty-preview">开始书写，预览会出现在这里</div>';
    scheduleSharedScrollUpdate();
    return;
  }

  const rendered = marked.parse(source);
  preview.innerHTML = DOMPurify.sanitize(rendered, {
    ADD_ATTR: ['class', 'aria-hidden'],
    USE_PROFILES: { html: true }
  });

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

function syncPanesFromMaster() {
  if (state.mode !== 'split') return;
  const masterRange = getMasterScrollRange();
  const progress = masterRange > 0 ? masterScrollbar.scrollTop / masterRange : 0;

  state.syncingScroll = true;
  editorPane.scrollTop = progress * getScrollRange(editorPane);
  previewPane.scrollTop = progress * getScrollRange(previewPane);
  window.requestAnimationFrame(() => {
    state.syncingScroll = false;
  });
}

function updateSharedScroll() {
  if (state.mode !== 'split') return;
  const previousScrollTop = masterScrollbar.scrollTop;
  const contentRange = Math.max(getScrollRange(editorPane), getScrollRange(previewPane));
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

function setContent(content, filePath = null, fileName = '未命名') {
  editor.value = content;
  state.filePath = filePath;
  state.fileName = fileName;
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

editor.addEventListener('input', () => {
  if (!state.dirty) setDirty(true);
  schedulePreview();
  updateStats();
  updateEditorHeight();
});

editor.addEventListener('click', updateStats);
editor.addEventListener('keyup', updateStats);

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
  if (event.key === 'Tab') {
    event.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText('  ', start, end, 'end');
    editor.dispatchEvent(new Event('input'));
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

setContent(initialContent);

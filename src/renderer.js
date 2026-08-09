const editor = document.querySelector('#editor');
const preview = document.querySelector('#preview');
const workspace = document.querySelector('#workspace');
const title = document.querySelector('#document-title');
const documentName = document.querySelector('#document-name');
const documentNameInput = document.querySelector('#document-name-input');
const documentExtension = document.querySelector('#document-extension');
const saveState = document.querySelector('#save-state');
const cursorState = document.querySelector('#cursor-state');
const wordCount = document.querySelector('#word-count');
const toast = document.querySelector('#toast');
const editorPane = document.querySelector('.editor-pane');
const editorHighlight = document.querySelector('#editor-highlight');
const editorHighlightCode = editorHighlight.querySelector('code');
const previewPane = document.querySelector('.preview-pane');
const editorMirror = document.querySelector('#editor-mirror');
const masterScrollbar = document.querySelector('#master-scrollbar');
const masterScrollTrack = document.querySelector('#master-scroll-track');
const fileNameDialog = document.querySelector('#file-name-dialog');
const fileNameForm = document.querySelector('#file-name-form');
const fileNameDialogTitle = document.querySelector('#file-name-dialog-title');
const fileNameInput = document.querySelector('#file-name-input');
const fileNameExtension = document.querySelector('#file-name-extension');
const fileNameError = document.querySelector('#file-name-error');
const fileNameCancel = document.querySelector('#file-name-cancel');
const fileNameConfirm = document.querySelector('#file-name-confirm');
const themeButton = document.querySelector('#theme-button');
const highlightThemeLight = document.querySelector('#highlight-theme-light');
const highlightThemeDark = document.querySelector('#highlight-theme-dark');

function loadTheme() {
  return window.desktop.initialTheme === 'dark' ? 'dark' : 'light';
}

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
  theme: loadTheme(),
  syncingScroll: false,
  scrollAnchors: [],
  renderTimer: null,
  highlightFrame: null,
  scrollTimer: null,
  toastTimer: null,
  sessionReady: false
};

function setTheme(theme, persist = true) {
  state.theme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = state.theme;
  const isDark = state.theme === 'dark';
  themeButton.classList.toggle('active', isDark);
  themeButton.setAttribute('aria-pressed', String(isDark));
  themeButton.setAttribute('aria-label', isDark ? '关闭深色模式' : '开启深色模式');
  themeButton.title = isDark ? '切换浅色模式' : '切换深色模式';
  highlightThemeLight.disabled = isDark;
  highlightThemeDark.disabled = !isDark;
  if (persist) window.desktop.setTheme(state.theme);
}

setTheme(state.theme, false);

const undoHistory = new window.MoriUndoHistory({ limit: 200, mergeDelay: 1000 });
let pendingBeforeInput = null;
let compositionSnapshot = null;
let isComposing = false;
let isTitleEditing = false;
let titleRenamePending = false;
let updateButton = null;

function splitDocumentName(fileName = state.fileName) {
  const normalized = fileName === '未命名' ? '未命名.md' : fileName;
  const lastDot = normalized.lastIndexOf('.');
  if (lastDot <= 0) return { baseName: normalized, extension: '' };
  return {
    baseName: normalized.slice(0, lastDot),
    extension: normalized.slice(lastDot)
  };
}

function renderDocumentTitle() {
  const { baseName, extension } = splitDocumentName();
  documentName.textContent = `${state.dirty ? '• ' : ''}${baseName}`;
  documentExtension.textContent = extension;
  const fullName = `${baseName}${extension}`;
  title.setAttribute('aria-label', `重命名 ${fullName}`);
  document.title = `${state.dirty ? '• ' : ''}${fullName} — Mori Markdown`;
}

function resizeDocumentNameInput() {
  documentNameInput.style.width = `${Math.min(280, Math.max(44, documentNameInput.value.length * 7.4 + 14))}px`;
}

function finishTitleEditing() {
  isTitleEditing = false;
  titleRenamePending = false;
  title.classList.remove('editing');
  documentNameInput.removeAttribute('aria-invalid');
  renderDocumentTitle();
}

function beginTitleEditing() {
  if (isTitleEditing || fileNameDialog.open) return;
  const { baseName } = splitDocumentName();
  isTitleEditing = true;
  documentNameInput.value = baseName;
  resizeDocumentNameInput();
  title.classList.add('editing');
  documentNameInput.focus();
  documentNameInput.select();
}

function cancelTitleEditing() {
  if (!isTitleEditing) return;
  finishTitleEditing();
  title.focus();
}

function validateBaseName(value) {
  if (!value) return '请输入文件名';
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(value)) return '文件名包含 Windows 不允许的字符';
  if (/[. ]$/.test(value)) return '文件名不能以句点或空格结尾';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) {
    return '该名称是 Windows 保留名称';
  }
  return '';
}

function requestBaseName({ heading, confirmLabel, baseName, extension }) {
  fileNameDialogTitle.textContent = heading;
  fileNameConfirm.textContent = confirmLabel;
  fileNameInput.value = baseName;
  fileNameExtension.textContent = extension;
  fileNameError.textContent = '';

  return new Promise((resolve) => {
    const finish = (result) => {
      fileNameForm.removeEventListener('submit', handleSubmit);
      fileNameCancel.removeEventListener('click', handleCancel);
      fileNameDialog.removeEventListener('cancel', handleDialogCancel);
      if (fileNameDialog.open) fileNameDialog.close();
      resolve(result);
    };
    const handleSubmit = (event) => {
      event.preventDefault();
      const value = fileNameInput.value.trim();
      const error = validateBaseName(value);
      fileNameError.textContent = error;
      if (!error) finish(value);
    };
    const handleCancel = () => finish(null);
    const handleDialogCancel = (event) => {
      event.preventDefault();
      finish(null);
    };

    fileNameForm.addEventListener('submit', handleSubmit);
    fileNameCancel.addEventListener('click', handleCancel);
    fileNameDialog.addEventListener('cancel', handleDialogCancel);
    fileNameDialog.showModal();
    window.requestAnimationFrame(() => {
      fileNameInput.focus();
      fileNameInput.select();
    });
  });
}

function escapeHtml(value) {
  const span = document.createElement('span');
  span.textContent = value;
  return span.innerHTML;
}

function getEditorLanguage() {
  const extension = state.fileName.toLowerCase().split('.').at(-1);
  if (extension === 'tex') return 'latex';
  if (extension === 'txt') return 'plaintext';
  return 'markdown';
}

function syncEditorHighlightGeometry() {
  editorHighlight.style.width = `${editor.offsetWidth}px`;
  editorHighlight.style.height = `${editor.offsetHeight}px`;
  editorHighlight.classList.toggle('nowrap', !state.wrap);
}

function syncEditorHorizontalOverflow() {
  const previousScrollLeft = editorPane.scrollLeft;
  editorPane.classList.toggle('nowrap', !state.wrap);

  if (state.wrap) {
    editor.style.width = '';
    editorHighlight.style.width = '';
    editorPane.scrollLeft = 0;
    return;
  }

  // A textarea's max-content width is not based on its value. Measure its
  // native scroll width while constrained, then make both layers that wide.
  editor.style.width = '100%';
  editorHighlight.style.width = '100%';
  const horizontalEndPadding = 36;
  const contentWidth = Math.max(
    editorPane.clientWidth,
    editor.scrollWidth + horizontalEndPadding
  );
  editor.style.width = `${contentWidth}px`;
  editorHighlight.style.width = `${contentWidth}px`;
  editorPane.scrollLeft = previousScrollLeft;
}

function updateEditorHighlight() {
  const source = editor.value;
  const language = getEditorLanguage();
  if (window.hljs?.getLanguage(language)) {
    editorHighlightCode.innerHTML = hljs.highlight(source, {
      language,
      ignoreIllegals: true
    }).value + (source.endsWith('\n') ? ' ' : '');
  } else {
    editorHighlightCode.textContent = source + (source.endsWith('\n') ? ' ' : '');
  }
  syncEditorHighlightGeometry();
  document.documentElement.classList.add('highlight-ready');
}

function scheduleEditorHighlight() {
  if (state.highlightFrame !== null) return;
  state.highlightFrame = window.requestAnimationFrame(() => {
    state.highlightFrame = null;
    updateEditorHighlight();
  });
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
  renderer: {
    image({ href, title: imageTitle, text }) {
      const titleAttribute = imageTitle
        ? ` title="${escapeHtml(imageTitle)}"`
        : '';
      return `<img data-resource-src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${titleAttribute}>`;
    }
  },
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
      ADD_ATTR: ['class', 'aria-hidden', 'data-resource-src'],
      // KaTeX uses inline SVG paths for extensible glyphs such as radicals,
      // braces and long arrows, and MathML for its accessible representation.
      // The HTML-only profile silently removed those nodes after KaTeX had
      // rendered them, leaving formulas such as \sqrt{x} visibly incomplete.
      USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true }
    });
    const template = document.createElement('template');
    template.innerHTML = sanitized;

    template.content.querySelectorAll('img[src]').forEach((image) => {
      image.dataset.resourceSrc = image.getAttribute('src');
      image.removeAttribute('src');
    });

    Array.from(template.content.children).forEach((element) => {
      element.dataset.sourceStart = String(sourceStart);
      element.dataset.sourceEnd = String(sourceOffset);
    });
    fragment.append(template.content);
  });

  preview.replaceChildren(fragment);
}

async function enhancePreviewResources() {
  preview.querySelectorAll('pre code').forEach((block) => {
    if (!window.hljs) return;
    const languageClass = Array.from(block.classList).find((name) => name.startsWith('language-'));
    const language = languageClass?.slice('language-'.length);
    if (language && hljs.getLanguage(language)) {
      hljs.highlightElement(block);
    } else {
      const result = hljs.highlightAuto(block.textContent);
      block.innerHTML = result.value;
      block.classList.add('hljs');
    }
  });

  preview.querySelectorAll('pre').forEach((codeBlock) => {
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'code-copy-button';
    copyButton.textContent = '复制';
    copyButton.setAttribute('aria-label', '复制代码');
    copyButton.title = '复制代码';
    copyButton.addEventListener('click', async () => {
      const code = codeBlock.querySelector('code');
      if (!code) return;

      try {
        await window.desktop.writeClipboardText(code.textContent);
        copyButton.textContent = '已复制';
        copyButton.disabled = true;
        window.setTimeout(() => {
          if (!copyButton.isConnected) return;
          copyButton.textContent = '复制';
          copyButton.disabled = false;
        }, 1400);
      } catch {
        showToast('复制失败');
      }
    });
    codeBlock.append(copyButton);
  });

  const imageTasks = Array.from(preview.querySelectorAll('img[data-resource-src]')).map(async (image) => {
    const source = image.dataset.resourceSrc;
    const resolved = await window.desktop.resolveResource({ href: source, filePath: state.filePath });
    if (!image.isConnected || image.dataset.resourceSrc !== source) return;
    if (resolved) image.src = resolved;
    else image.removeAttribute('src');
  });

  preview.querySelectorAll('a[href]').forEach((link) => {
    link.addEventListener('click', async (event) => {
      const href = link.getAttribute('href');
      if (/^https?:\/\//i.test(href)) {
        event.preventDefault();
        window.desktop.openExternal(href);
        return;
      }
      if (href.startsWith('#')) return;
      event.preventDefault();
      const result = await window.desktop.openLinkedDocument({ href, filePath: state.filePath });
      if (!result.canceled && (await resolveReplacement())) {
        setContent(result.content, result.filePath, result.name);
      }
    });
  });

  await Promise.all(imageTasks);
}

async function updatePreview() {
  const source = editor.value;
  if (!source.trim()) {
    preview.innerHTML = '<div class="empty-preview">开始书写，预览会出现在这里</div>';
    scheduleSharedScrollUpdate();
    return;
  }

  renderPreviewWithAnchors(source);

  await enhancePreviewResources();

  scheduleSharedScrollUpdate();
}

function schedulePreview() {
  window.clearTimeout(state.renderTimer);
  state.renderTimer = window.setTimeout(updatePreview, 90);
}

function setDirty(value) {
  state.dirty = value;
  saveState.textContent = value ? '未保存' : '已保存';
  renderDocumentTitle();
  window.desktop.setDirty(value);
  persistSession();
}

function persistSession() {
  if (!state.sessionReady) return;
  window.desktop.saveSession({
    content: editor.value,
    filePath: state.filePath,
    fileName: state.fileName,
    savedContent: state.savedContent,
    dirty: state.dirty,
    mode: state.mode,
    wrap: state.wrap
  });
}

window.__moriGetSession = () => ({
  content: editor.value,
  filePath: state.filePath,
  fileName: state.fileName,
  savedContent: state.savedContent,
  dirty: state.dirty,
  mode: state.mode,
  wrap: state.wrap
});

function updateEditorHeight() {
  const previousEditorScroll = editorPane.scrollTop;
  const previousEditorScrollLeft = editorPane.scrollLeft;
  const previousMasterScroll = masterScrollbar.scrollTop;
  editor.style.height = 'auto';
  editor.style.height = `${Math.max(editor.scrollHeight, editor.parentElement.clientHeight)}px`;
  syncEditorHorizontalOverflow();
  syncEditorHighlightGeometry();
  editorPane.scrollTop = previousEditorScroll;
  editorPane.scrollLeft = previousEditorScrollLeft;
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
  toast.classList.remove('update-available');
  toast.replaceChildren();
  toast.textContent = message;
  toast.classList.add('visible');
  state.toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 1600);
}

function showUpdateNotice(release) {
  if (!release || typeof release.version !== 'string' || !release.installer) return;
  window.clearTimeout(state.toastTimer);
  toast.replaceChildren(document.createTextNode(`发现新版本 ${release.version}`));

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.textContent = '下载并安装';
  openButton.addEventListener('click', async () => {
    if (openButton.disabled) return;
    openButton.disabled = true;
    openButton.textContent = '正在下载 0%';
    const result = await window.desktop.downloadAndInstallUpdate();
    if (result?.error) {
      openButton.disabled = false;
      openButton.textContent = '重试下载';
    }
  });
  updateButton = openButton;
  toast.append(openButton);
  toast.classList.add('visible', 'update-available');
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
  scheduleEditorHighlight();
  updateStats();
  updateEditorHeight();
  persistSession();
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
  updateEditorHighlight();
  updateStats();
  updateEditorHeight();
  editor.focus();
  editor.setSelectionRange(0, 0);
  persistSession();
}

async function saveDocument(saveAs = false) {
  const previousFilePath = state.filePath;
  let requestedFileName = state.fileName;
  const nameParts = splitDocumentName();
  if (!saveAs && !state.filePath && nameParts.baseName === '未命名') {
    const baseName = await requestBaseName({
      heading: '保存文档',
      confirmLabel: '保存',
      ...nameParts
    });
    if (!baseName) return false;
    requestedFileName = `${baseName}${nameParts.extension || '.md'}`;
  }
  const result = await window.desktop.saveDocument({
    content: editor.value,
    filePath: state.filePath,
    fileName: requestedFileName,
    saveAs
  });

  if (!result.canceled) {
    state.filePath = result.filePath;
    state.fileName = result.name;
    state.savedContent = editor.value;
    undoHistory.breakGroup();
    setDirty(false);
    updateEditorHighlight();
    if (saveAs || !previousFilePath) updatePreview();
    showToast('已保存');
    return true;
  }
  if (result.error) showToast(result.error);
  return false;
}

async function commitTitleEditing() {
  if (!isTitleEditing || titleRenamePending) return;
  titleRenamePending = true;
  const nameParts = splitDocumentName();
  const baseName = documentNameInput.value.trim();
  const validationError = validateBaseName(baseName);
  if (validationError) {
    titleRenamePending = false;
    documentNameInput.setAttribute('aria-invalid', 'true');
    showToast(validationError);
    documentNameInput.focus();
    return;
  }
  if (baseName === nameParts.baseName) {
    finishTitleEditing();
    return;
  }

  if (state.filePath) {
    const result = await window.desktop.renameDocument({
      filePath: state.filePath,
      baseName
    });
    if (result.canceled) {
      if (result.error) showToast(result.error);
      titleRenamePending = false;
      documentNameInput.setAttribute('aria-invalid', 'true');
      documentNameInput.focus();
      documentNameInput.select();
      return;
    }
    state.filePath = result.filePath;
    state.fileName = result.name;
  } else {
    state.fileName = `${baseName}${nameParts.extension || '.md'}`;
  }

  finishTitleEditing();
  updateEditorHighlight();
  persistSession();
  showToast('已重命名');
}

async function prepareExportMarkup() {
  window.clearTimeout(state.renderTimer);
  await updatePreview();
  const exportedPreview = preview.cloneNode(true);

  const images = Array.from(exportedPreview.querySelectorAll('img[data-resource-src]'));
  await Promise.all(images.map(async (image) => {
    const source = image.dataset.resourceSrc;
    if (!/^https?:\/\//i.test(source) && !/^data:image\//i.test(source)) {
      const embedded = await window.desktop.embedResource({ href: source, filePath: state.filePath });
      if (embedded) image.src = embedded;
    }
  }));

  const links = Array.from(exportedPreview.querySelectorAll('a[href]'));
  await Promise.all(links.map(async (link) => {
    const href = link.getAttribute('href');
    if (!href.startsWith('#') && !/^https?:\/\//i.test(href)) {
      const resolved = await window.desktop.resolveResource({ href, filePath: state.filePath });
      if (resolved) link.href = resolved;
    }
  }));

  exportedPreview.querySelectorAll('[data-source-start], [data-source-end], [data-resource-src]')
    .forEach((element) => {
      element.removeAttribute('data-source-start');
      element.removeAttribute('data-source-end');
      element.removeAttribute('data-resource-src');
    });
  return exportedPreview.innerHTML;
}

async function exportDocument(format) {
  const html = await prepareExportMarkup();
  const payload = { html, title: state.fileName };
  const result = format === 'pdf'
    ? await window.desktop.exportPdf(payload)
    : await window.desktop.exportHtml(payload);
  if (!result.canceled) showToast(`已导出 ${format.toUpperCase()}`);
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
  persistSession();
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
  editorPane.classList.add('composing');
});

editor.addEventListener('compositionend', () => {
  isComposing = false;
  editorPane.classList.remove('composing');
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
document.querySelector('#save-as-button').addEventListener('click', () => saveDocument(true));
title.addEventListener('click', beginTitleEditing);
title.addEventListener('keydown', (event) => {
  if (isTitleEditing || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  beginTitleEditing();
});
documentNameInput.addEventListener('input', () => {
  documentNameInput.removeAttribute('aria-invalid');
  resizeDocumentNameInput();
});
documentNameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    commitTitleEditing();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    cancelTitleEditing();
  }
  event.stopPropagation();
});
documentNameInput.addEventListener('blur', commitTitleEditing);
document.querySelector('#export-html-button').addEventListener('click', () => exportDocument('html'));
document.querySelector('#export-pdf-button').addEventListener('click', () => exportDocument('pdf'));
themeButton.addEventListener('click', () => {
  setTheme(state.theme === 'dark' ? 'light' : 'dark');
});

document.querySelectorAll('.mode-button').forEach((button) => {
  button.addEventListener('click', () => setMode(button.dataset.mode));
});

document.querySelector('#wrap-button').addEventListener('click', (event) => {
  state.wrap = !state.wrap;
  editor.classList.toggle('nowrap', !state.wrap);
  editorHighlight.classList.toggle('nowrap', !state.wrap);
  event.currentTarget.classList.toggle('active', state.wrap);
  event.currentTarget.setAttribute('aria-pressed', String(state.wrap));
  updateEditorHeight();
  persistSession();
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

let externalOpenQueue = Promise.resolve();
window.desktop.onOpenPath((document) => {
  externalOpenQueue = externalOpenQueue.then(async () => {
    if (!(await resolveReplacement())) return;
    setContent(document.content, document.filePath, document.name);
    showToast('文档已打开');
  });
});

window.desktop.onUpdateAvailable(showUpdateNotice);
window.desktop.onUpdateDownloadProgress(({ received, total }) => {
  if (!updateButton?.isConnected) return;
  const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null;
  updateButton.textContent = percent == null ? '正在下载' : `正在下载 ${percent}%`;
});

setContent(initialContent);

(async () => {
  const session = await window.desktop.loadSession();
  if (session?.dirty) {
    setContent(session.content, session.filePath, session.fileName);
    state.savedContent = typeof session.savedContent === 'string' ? session.savedContent : '';
    setDirty(true);
    if (session.wrap === false) {
      state.wrap = false;
      editor.classList.add('nowrap');
      editorHighlight.classList.add('nowrap');
      document.querySelector('#wrap-button').classList.remove('active');
      document.querySelector('#wrap-button').setAttribute('aria-pressed', 'false');
    }
    if (['edit', 'split', 'read'].includes(session.mode)) setMode(session.mode);
  } else if (session) {
    setContent('');
  }
  state.sessionReady = true;
  persistSession();
})();

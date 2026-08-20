(() => {
  const editor = document.querySelector('#editor');
  if (!editor) return;

  const style = document.createElement('style');
  style.textContent = `
    .mori-find {
      position: fixed;
      z-index: 18;
      top: calc(var(--title-height) + var(--toolbar-height) + 10px);
      right: 18px;
      width: min(500px, calc(100vw - 36px));
      padding: 8px;
      border: 1px solid var(--line-strong);
      border-radius: 9px;
      background: var(--paper);
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.14);
    }
    .mori-find[hidden], .mori-replace[hidden] { display: none; }
    .mori-find-row, .mori-replace { display: flex; align-items: center; gap: 6px; }
    .mori-replace { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--line); }
    .mori-find input {
      min-width: 0; flex: 1; padding: 6px 8px;
      border: 1px solid var(--line-strong); border-radius: 6px; outline: 0;
      color: var(--text); background: var(--bg); font: inherit; font-size: 12px;
    }
    .mori-find input:focus {
      border-color: #8aa198;
      box-shadow: 0 0 0 2px rgba(81, 109, 100, 0.10);
    }
    .mori-find button {
      height: 30px; padding: 0 8px; border: 0; border-radius: 6px;
      color: var(--muted); background: transparent; font: inherit; font-size: 12px; cursor: pointer;
    }
    .mori-find button:hover:not(:disabled), .mori-find button.active {
      color: var(--accent); background: var(--accent-soft);
    }
    .mori-find button:disabled { opacity: 0.4; cursor: default; }
    .mori-find-count {
      min-width: 42px; color: var(--muted); font-size: 11px;
      text-align: center; font-variant-numeric: tabular-nums;
    }
    @media (max-width: 620px) {
      .mori-find { right: 10px; width: calc(100vw - 20px); }
    }
    @media print { .mori-find { display: none !important; } }
  `;
  document.head.append(style);

  const panel = document.createElement('section');
  panel.className = 'mori-find';
  panel.hidden = true;
  panel.setAttribute('aria-label', '查找和替换');
  panel.innerHTML = `
    <div class="mori-find-row">
      <input class="mori-find-query" placeholder="查找" aria-label="查找内容" autocomplete="off" spellcheck="false">
      <span class="mori-find-count" aria-live="polite">0/0</span>
      <button type="button" class="mori-find-case" title="区分大小写" aria-pressed="false">Aa</button>
      <button type="button" class="mori-find-prev" title="上一个（Shift+Enter）">↑</button>
      <button type="button" class="mori-find-next" title="下一个（Enter）">↓</button>
      <button type="button" class="mori-find-close" title="关闭（Esc）">×</button>
    </div>
    <div class="mori-replace" hidden>
      <input class="mori-replace-with" placeholder="替换为" aria-label="替换为" autocomplete="off" spellcheck="false">
      <button type="button" class="mori-replace-one">替换</button>
      <button type="button" class="mori-replace-all">全部替换</button>
    </div>
  `;
  document.body.append(panel);

  const queryInput = panel.querySelector('.mori-find-query');
  const replaceInput = panel.querySelector('.mori-replace-with');
  const replaceRow = panel.querySelector('.mori-replace');
  const countLabel = panel.querySelector('.mori-find-count');
  const caseButton = panel.querySelector('.mori-find-case');
  const prevButton = panel.querySelector('.mori-find-prev');
  const nextButton = panel.querySelector('.mori-find-next');
  const replaceOneButton = panel.querySelector('.mori-replace-one');
  const replaceAllButton = panel.querySelector('.mori-replace-all');
  const closeButton = panel.querySelector('.mori-find-close');

  let caseSensitive = false;
  let matches = [];
  let currentMatch = -1;

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function collectMatches() {
    if (!queryInput.value) return [];
    const expression = new RegExp(escapeRegExp(queryInput.value), caseSensitive ? 'g' : 'gi');
    return Array.from(
      editor.value.matchAll(expression),
      (match) => [match.index, match.index + match[0].length]
    );
  }

  function nearestMatch(position) {
    const index = matches.findIndex(([start]) => start >= position);
    return index < 0 ? 0 : index;
  }

  function updateStatus() {
    countLabel.textContent = currentMatch < 0
      ? `0/${matches.length}`
      : `${currentMatch + 1}/${matches.length}`;
    const disabled = matches.length === 0;
    prevButton.disabled = disabled;
    nextButton.disabled = disabled;
    replaceOneButton.disabled = disabled;
    replaceAllButton.disabled = disabled;
  }

  function refreshMatches(anchor = editor.selectionStart, preserveCurrent = true) {
    const oldMatch = preserveCurrent && currentMatch >= 0 ? matches[currentMatch] : null;
    matches = collectMatches();

    if (matches.length === 0) {
      currentMatch = -1;
    } else if (oldMatch) {
      const sameIndex = matches.findIndex(
        (match) => match[0] === oldMatch[0] && match[1] === oldMatch[1]
      );
      currentMatch = sameIndex >= 0 ? sameIndex : nearestMatch(anchor);
    } else {
      currentMatch = nearestMatch(anchor);
    }
    updateStatus();
  }

  function selectMatch(index) {
    if (matches.length === 0) return;
    currentMatch = (index + matches.length) % matches.length;
    const [start, end] = matches[currentMatch];
    const previousFocus = document.activeElement;

    editor.setSelectionRange(start, end, 'forward');
    editor.focus({ preventScroll: false });

    if (previousFocus && previousFocus !== editor && typeof previousFocus.focus === 'function') {
      previousFocus.focus({ preventScroll: true });
    }
    updateStatus();
  }

  function moveMatch(step) {
    refreshMatches();
    if (matches.length > 0) selectMatch(currentMatch + step);
  }

  function dispatchReplacement(text, start, end, selectionMode = 'end') {
    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertReplacementText',
      data: text
    });
    if (!editor.dispatchEvent(beforeInput)) return false;

    editor.setRangeText(text, start, end, selectionMode);
    editor.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertReplacementText',
      data: text
    }));
    return true;
  }

  function replaceCurrent() {
    refreshMatches();
    if (matches.length === 0) return;

    const [start, end] = matches[currentMatch];
    if (!dispatchReplacement(replaceInput.value, start, end)) return;

    const anchor = start + replaceInput.value.length;
    refreshMatches(anchor, false);
    if (matches.length > 0) selectMatch(nearestMatch(anchor));
  }

  function replaceAll() {
    refreshMatches(0, false);
    if (matches.length === 0) return;

    const source = editor.value;
    let result = '';
    let sourceOffset = 0;

    for (const [start, end] of matches) {
      result += source.slice(sourceOffset, start);
      result += replaceInput.value;
      sourceOffset = end;
    }
    result += source.slice(sourceOffset);

    const total = matches.length;
    if (!dispatchReplacement(result, 0, source.length)) return;
    refreshMatches(editor.selectionStart, false);

    if (typeof window.showToast === 'function') {
      window.showToast(`已替换 ${total} 处`);
    }
  }

  function openPanel(replaceMode) {
    const workspace = document.querySelector('#workspace');
    if (workspace?.classList.contains('mode-read')) {
      document.querySelector('.mode-button[data-mode="edit"]')?.click();
    }

    replaceRow.hidden = !replaceMode;
    panel.hidden = false;

    const selectedText = editor.selectionStart === editor.selectionEnd
      ? ''
      : editor.value.slice(editor.selectionStart, editor.selectionEnd);

    if (selectedText && !selectedText.includes('\n')) {
      queryInput.value = selectedText;
    }

    refreshMatches(editor.selectionStart, false);
    if (matches.length > 0) selectMatch(currentMatch);

    requestAnimationFrame(() => {
      queryInput.focus();
      queryInput.select();
    });
  }

  function closePanel() {
    panel.hidden = true;
    editor.focus({ preventScroll: true });
  }

  queryInput.addEventListener('input', () => {
    refreshMatches(editor.selectionStart, false);
    if (matches.length > 0) selectMatch(currentMatch);
  });

  queryInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    moveMatch(event.shiftKey ? -1 : 1);
  });

  replaceInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (event.shiftKey) replaceAll();
    else replaceCurrent();
  });

  prevButton.addEventListener('click', () => moveMatch(-1));
  nextButton.addEventListener('click', () => moveMatch(1));
  replaceOneButton.addEventListener('click', replaceCurrent);
  replaceAllButton.addEventListener('click', replaceAll);
  closeButton.addEventListener('click', closePanel);

  caseButton.addEventListener('click', () => {
    caseSensitive = !caseSensitive;
    caseButton.classList.toggle('active', caseSensitive);
    caseButton.setAttribute('aria-pressed', String(caseSensitive));
    refreshMatches(editor.selectionStart, false);
    if (matches.length > 0) selectMatch(currentMatch);
  });

  editor.addEventListener('input', () => {
    if (!panel.hidden) refreshMatches();
  });

  document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    const primaryModifier = (event.ctrlKey || event.metaKey)
      && !event.altKey
      && !event.shiftKey;

    if (
      !document.querySelector('dialog[open]')
      && primaryModifier
      && (key === 'f' || key === 'h')
    ) {
      event.preventDefault();
      event.stopPropagation();
      openPanel(key === 'h');
      return;
    }

    if (!panel.hidden && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closePanel();
    }
  }, true);
})();

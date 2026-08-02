const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');

let mainWindow;
let isDirty = false;
let isQuitting = false;
let pendingDocumentPath = null;
let lastOpenedDocumentPath = null;
let rendererReady = false;
let sessionWrite = Promise.resolve();
let isClosing = false;
const isSmokeMode = process.argv.includes('--smoke');

function getSessionPath() {
  return path.join(app.getPath('userData'), 'session.json');
}

async function loadSession() {
  try {
    const raw = await fs.readFile(getSessionPath(), 'utf8');
    const session = JSON.parse(raw);
    return session && typeof session.content === 'string' ? session : null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  if (isSmokeMode) return Promise.resolve();
  sessionWrite = sessionWrite.then(async () => {
    const sessionPath = getSessionPath();
    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    const temporaryPath = `${sessionPath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(session), 'utf8');
    await fs.rename(temporaryPath, sessionPath);
  }).catch((error) => console.error('Unable to save session:', error));
  return sessionWrite;
}

function getRepositoryDirectory() {
  return app.isPackaged
    ? path.join(path.dirname(app.getPath('exe')), 'Mori Repository')
    : path.join(app.getAppPath(), 'Mori Repository');
}

async function getUntitledSavePath() {
  const directory = getRepositoryDirectory();
  try {
    await fs.mkdir(directory, { recursive: true });
    for (let index = 0; ; index += 1) {
      const fileName = index === 0 ? '未命名.md' : `未命名 ${index + 1}.md`;
      const filePath = path.join(directory, fileName);
      try {
        await fs.access(filePath);
      } catch {
        return filePath;
      }
    }
  } catch (error) {
    throw new Error(`无法在 Mori Repository 中创建文件（${directory}）：${error.message}`);
  }
}

function resolveLocalResource(filePath, href) {
  if (typeof href !== 'string' || !href || /\0/.test(href)) return null;
  let candidate;
  try {
    const localReference = decodeURIComponent(href.split(/[?#]/, 1)[0]);
    if (/^file:\/\//i.test(href)) {
      candidate = path.resolve(fileURLToPath(new URL(href)));
    } else if (path.isAbsolute(localReference)) {
      candidate = path.resolve(localReference);
    } else {
      if (!filePath) return null;
      candidate = path.resolve(path.dirname(filePath), localReference);
    }
  } catch {
    return null;
  }
  return candidate;
}

const documentFilters = [
  { name: 'Markdown / TeX', extensions: ['md', 'markdown', 'mdown', 'mkd', 'tex', 'txt'] },
  { name: 'All files', extensions: ['*'] }
];

async function findDocumentPath(argv, workingDirectory = process.cwd()) {
  for (const argument of argv.slice(1)) {
    if (!argument || argument.startsWith('-')) continue;

    const candidate = path.resolve(workingDirectory, argument);
    if (candidate === path.resolve(process.execPath)) continue;

    try {
      const stats = await fs.stat(candidate);
      if (stats.isFile()) return candidate;
    } catch {
      // Electron and development launch arguments are not necessarily file paths.
    }
  }
  return null;
}

async function readDocument(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return { filePath, content, name: path.basename(filePath) };
}

async function openDocumentPath(filePath) {
  if (!filePath) return;

  if (!mainWindow || mainWindow.isDestroyed() || !rendererReady) {
    pendingDocumentPath = filePath;
    return;
  }

  try {
    const document = await readDocument(filePath);
    mainWindow.webContents.send('document:open-path', document);
    lastOpenedDocumentPath = filePath;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } catch (error) {
    dialog.showErrorBox('无法打开文件', error.message);
  }
}

function createWindow() {
  rendererReady = false;
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#fbfbfa',
    show: false,
    title: 'Mori Markdown',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#fbfbfa',
      symbolColor: '#5a5a57',
      height: 42
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.once('did-finish-load', () => {
    rendererReady = true;
    if (!pendingDocumentPath) return;
    const filePath = pendingDocumentPath;
    pendingDocumentPath = null;
    openDocumentPath(filePath);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', async () => {
    mainWindow.show();
    if (process.argv.includes('--smoke')) {
      console.log(`Smoke argv: ${JSON.stringify(process.argv)}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (lastOpenedDocumentPath) {
        const expectedContent = await fs.readFile(lastOpenedDocumentPath, 'utf8');
        const actualContent = await mainWindow.webContents.executeJavaScript(
          'document.querySelector(\'#editor\').value'
        );
        if (actualContent !== expectedContent) {
          console.error(`Startup document was not displayed: ${lastOpenedDocumentPath}`);
          isQuitting = true;
          app.exit(1);
          return;
        }
        console.log(`Smoke startup document: ${lastOpenedDocumentPath}`);
      }
      const undoTest = await mainWindow.webContents.executeJavaScript(
        `(() => {
          const editor = document.querySelector('#editor');
          const original = editor.value;
          const addition = 'undo-group';
          editor.focus();
          editor.setSelectionRange(original.length, original.length);
          for (const character of addition) {
            const beforeInput = new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: character
            });
            if (!editor.dispatchEvent(beforeInput)) continue;
            editor.setRangeText(character, editor.selectionStart, editor.selectionEnd, 'end');
            editor.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              inputType: 'insertText',
              data: character
            }));
          }
          const typed = editor.value === original + addition;
          editor.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'z',
            ctrlKey: true
          }));
          const undoneAsGroup = editor.value === original;
          editor.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'y',
            ctrlKey: true
          }));
          const redoneAsGroup = editor.value === original + addition;
          editor.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'z',
            ctrlKey: true
          }));
          return { typed, undoneAsGroup, redoneAsGroup };
        })()`
      );
      console.log(`Smoke grouped undo: ${JSON.stringify(undoTest)}`);
      if (!undoTest.typed || !undoTest.undoneAsGroup || !undoTest.redoneAsGroup) {
        console.error('Grouped undo/redo smoke test failed');
        isQuitting = true;
        app.exit(1);
        return;
      }
      const markdownFeatureTest = await mainWindow.webContents.executeJavaScript(
        `(() => {
          const editor = document.querySelector('#editor');
          const fence = String.fromCharCode(96).repeat(3);
          editor.value = fence + 'javascript\\nconst answer = 42;\\n' + fence + '\\n\\n[OpenAI](https://openai.com)\\n\\n![image](https://example.com/image.png)';
          editor.dispatchEvent(new Event('input', { bubbles: true }));
          window.__moriMarkdownFeatureTest = () => ({
            highlighted: Boolean(document.querySelector('pre code.hljs')),
            link: document.querySelector('#preview a')?.getAttribute('href'),
            image: document.querySelector('#preview img')?.getAttribute('src')
          });
        })()`
      );
      await new Promise((resolve) => setTimeout(resolve, 180));
      const markdownFeatureResult = await mainWindow.webContents.executeJavaScript(
        'window.__moriMarkdownFeatureTest()'
      );
      console.log(`Smoke markdown features: ${JSON.stringify(markdownFeatureResult)}`);
      if (!markdownFeatureResult.highlighted || !/^https:\/\//.test(markdownFeatureResult.link) ||
        !/^https:\/\//.test(markdownFeatureResult.image)) {
        console.error('Markdown highlight, link, or image smoke test failed');
        isQuitting = true;
        app.exit(1);
        return;
      }
      const artifactsDirectory = path.join(__dirname, '..', 'artifacts');
      await fs.mkdir(artifactsDirectory, { recursive: true });
      await mainWindow.webContents.executeJavaScript(
        `(() => {
          const editor = document.querySelector('#editor');
          const sample = editor.value;
          editor.value = Array.from({ length: 10 }, (_, index) =>
            sample.replace('# 欢迎使用 Mori', '# 第 ' + (index + 1) + ' 节')
          ).join('\\n\\n');
          editor.dispatchEvent(new Event('input'));
          document.querySelector('[data-mode="split"]')?.click();
        })()`
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      await mainWindow.webContents.executeJavaScript(
        `(() => {
          const scrollbar = document.querySelector('#master-scrollbar');
          scrollbar.scrollTop = (scrollbar.scrollHeight - scrollbar.clientHeight) * 0.5;
          const editor = document.querySelector('#editor');
          const caret = Math.floor(editor.value.length * 0.5);
          editor.focus();
          editor.setSelectionRange(caret, caret);
        })()`
      );
      await new Promise((resolve) => setTimeout(resolve, 120));
      await mainWindow.webContents.executeJavaScript(
        `(() => {
          const scrollbar = document.querySelector('#master-scrollbar');
          const editor = document.querySelector('#editor');
          window.__smokeScrollBefore = scrollbar.scrollTop;
          editor.setRangeText('测', editor.selectionStart, editor.selectionEnd, 'end');
          editor.dispatchEvent(new Event('input', { bubbles: true }));
        })()`
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      const scrollTest = await mainWindow.webContents.executeJavaScript(
        `(() => {
          const after = document.querySelector('#master-scrollbar').scrollTop;
          return { before: window.__smokeScrollBefore, after };
        })()`
      );
      const scrollDelta = Math.abs(scrollTest.after - scrollTest.before);
      console.log(`Smoke edit scroll delta: ${scrollDelta.toFixed(2)}px`);
      if (scrollDelta > 2) {
        console.error('Editing unexpectedly changed the shared scroll position');
        isQuitting = true;
        app.exit(1);
        return;
      }
      const alignmentTest = await mainWindow.webContents.executeJavaScript(
        `(() => {
          const editorPane = document.querySelector('.editor-pane');
          const previewPane = document.querySelector('.preview-pane');
          const mirror = document.querySelector('#editor-mirror');
          const mapped = Array.from(document.querySelectorAll('#preview [data-source-start]'));
          const markerPositions = new Map(
            Array.from(mirror.querySelectorAll('.source-map-anchor')).map((marker) => [
              Number(marker.dataset.sourceOffset),
              marker.offsetTop
            ])
          );
          const editorCenter = editorPane.scrollTop + editorPane.clientHeight / 2;
          const leftBlock = mapped.reduce((closest, element) => {
            const start = markerPositions.get(Number(element.dataset.sourceStart));
            const end = markerPositions.get(Number(element.dataset.sourceEnd));
            if (!Number.isFinite(start) || !Number.isFinite(end)) return closest;
            const distance = editorCenter < start
              ? start - editorCenter
              : editorCenter > end
                ? editorCenter - end
                : 0;
            return !closest || distance < closest.distance ? { element, distance } : closest;
          }, null)?.element;
          const viewportCenter = previewPane.getBoundingClientRect().top + previewPane.clientHeight / 2;
          const rightBlock = mapped.reduce((closest, element) => {
            const rect = element.getBoundingClientRect();
            const distance = viewportCenter < rect.top
              ? rect.top - viewportCenter
              : viewportCenter > rect.bottom
                ? viewportCenter - rect.bottom
                : 0;
            return !closest || distance < closest.distance ? { element, distance } : closest;
          }, null)?.element;
          return {
            leftStart: leftBlock?.dataset.sourceStart,
            rightStart: rightBlock?.dataset.sourceStart,
            leftText: leftBlock?.textContent?.trim().slice(0, 40),
            rightText: rightBlock?.textContent?.trim().slice(0, 40)
          };
        })()`
      );
      console.log(`Smoke center alignment: ${JSON.stringify(alignmentTest)}`);
      const image = await mainWindow.webContents.capturePage();
      await fs.writeFile(path.join(artifactsDirectory, 'smoke.png'), image.toPNG());
      isQuitting = true;
      app.quit();
    }
  });

  // Session state is written continuously. Closing never prompts: the most recent
  // unsaved document is restored on the next launch.
  mainWindow.on('close', (event) => {
    if (isQuitting || isClosing) return;
    event.preventDefault();
    isClosing = true;
    mainWindow.webContents.executeJavaScript('window.__moriGetSession?.()')
      .then((session) => {
        if (session?.content != null) return saveSession(session);
        return sessionWrite;
      })
      .catch(() => sessionWrite)
      .finally(() => {
        isQuitting = true;
        mainWindow?.close();
      });
  });
}

async function showUnsavedDialog() {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: '未保存的更改',
    message: '当前文档尚未保存。',
    detail: '要在继续之前保存更改吗？',
    buttons: ['保存', '不保存', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  });
  return result.response;
}

async function canReplaceDocument() {
  if (!isDirty) return true;
  const choice = await showUnsavedDialog();
  if (choice === 0) return 'save';
  if (choice === 1) {
    isDirty = false;
    return true;
  }
  return false;
}

ipcMain.handle('document:confirm-replace', canReplaceDocument);

ipcMain.handle('document:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '打开文档',
    properties: ['openFile'],
    filters: documentFilters
  });

  if (result.canceled || result.filePaths.length === 0) return { canceled: true };

  try {
    const filePath = result.filePaths[0];
    const document = await readDocument(filePath);
    isDirty = false;
    return { canceled: false, ...document };
  } catch (error) {
    await dialog.showErrorBox('无法打开文件', error.message);
    return { canceled: true, error: error.message };
  }
});

ipcMain.handle('document:save', async (_event, payload) => {
  let filePath = payload.filePath;

  if (!filePath || payload.saveAs) {
    if (!payload.saveAs) {
      try {
        filePath = await getUntitledSavePath();
      } catch (error) {
        dialog.showErrorBox('无法保存文件', error.message);
        return { canceled: true, error: error.message };
      }
    } else {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '保存文档',
        defaultPath: filePath || '未命名.md',
        filters: documentFilters
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      filePath = result.filePath;
    }
  }

  try {
    await fs.writeFile(filePath, payload.content, 'utf8');
    isDirty = false;
    return { canceled: false, filePath, name: path.basename(filePath) };
  } catch (error) {
    await dialog.showErrorBox('无法保存文件', error.message);
    return { canceled: true, error: error.message };
  }
});

ipcMain.on('document:set-dirty', (_event, value) => {
  isDirty = Boolean(value);
});

ipcMain.handle('session:load', () => {
  if (isSmokeMode || pendingDocumentPath || lastOpenedDocumentPath) return null;
  return loadSession();
});
ipcMain.on('session:save', (_event, session) => {
  if (!session || typeof session.content !== 'string') return;
  saveSession({
    content: session.content,
    filePath: typeof session.filePath === 'string' ? session.filePath : null,
    fileName: typeof session.fileName === 'string' ? session.fileName : '未命名',
    savedContent: typeof session.savedContent === 'string' ? session.savedContent : session.content,
    dirty: Boolean(session.dirty),
    mode: ['edit', 'split', 'read'].includes(session.mode) ? session.mode : 'edit',
    wrap: session.wrap !== false
  });
});

ipcMain.handle('resource:resolve', async (_event, { href, filePath }) => {
  if (/^https?:\/\//i.test(href) || /^data:image\//i.test(href)) return href;
  const resourcePath = resolveLocalResource(filePath, href);
  if (!resourcePath) return null;
  try {
    return (await fs.stat(resourcePath)).isFile()
      ? pathToFileURL(resourcePath).href
      : null;
  } catch {
    return null;
  }
});

ipcMain.handle('document:open-link', async (_event, { href, filePath }) => {
  const targetPath = resolveLocalResource(filePath, href);
  if (!targetPath) return { canceled: true };
  try {
    return { canceled: false, ...(await readDocument(targetPath)) };
  } catch (error) {
    return { canceled: true, error: error.message };
  }
});

ipcMain.handle('shell:open-external', async (_event, url) => {
  if (/^https?:\/\//i.test(url)) await shell.openExternal(url);
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', async (_event, argv, workingDirectory) => {
    const filePath = await findDocumentPath(argv, workingDirectory);
    if (filePath) {
      await openDocumentPath(filePath);
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    pendingDocumentPath = pendingDocumentPath || await findDocumentPath(process.argv);
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  openDocumentPath(filePath);
});

app.on('before-quit', () => {
  if (!isDirty) isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

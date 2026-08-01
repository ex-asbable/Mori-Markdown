const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

let mainWindow;
let isDirty = false;
let isQuitting = false;

const documentFilters = [
  { name: 'Markdown / TeX', extensions: ['md', 'markdown', 'mdown', 'mkd', 'tex', 'txt'] },
  { name: 'All files', extensions: ['*'] }
];

function createWindow() {
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
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', async () => {
    mainWindow.show();
    if (process.argv.includes('--smoke')) {
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
      const image = await mainWindow.webContents.capturePage();
      await fs.writeFile(path.join(artifactsDirectory, 'smoke.png'), image.toPNG());
      isQuitting = true;
      app.quit();
    }
  });

  mainWindow.on('close', async (event) => {
    if (!isDirty || isQuitting) return;

    event.preventDefault();
    const choice = await showUnsavedDialog();
    if (choice === 0) {
      mainWindow.webContents.send('document:save-before-close');
    } else if (choice === 1) {
      isDirty = false;
      isQuitting = true;
      mainWindow.close();
    }
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
    const content = await fs.readFile(filePath, 'utf8');
    isDirty = false;
    return { canceled: false, filePath, content, name: path.basename(filePath) };
  } catch (error) {
    await dialog.showErrorBox('无法打开文件', error.message);
    return { canceled: true, error: error.message };
  }
});

ipcMain.handle('document:save', async (_event, payload) => {
  let filePath = payload.filePath;

  if (!filePath || payload.saveAs) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存文档',
      defaultPath: filePath || '未命名.md',
      filters: documentFilters
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    filePath = result.filePath;
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

ipcMain.on('document:close-after-save', () => {
  if (!isDirty) {
    isQuitting = true;
    mainWindow.close();
  }
});

ipcMain.handle('shell:open-external', async (_event, url) => {
  if (/^https?:\/\//i.test(url)) await shell.openExternal(url);
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (!isDirty) isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

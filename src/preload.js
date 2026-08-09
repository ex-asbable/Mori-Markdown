const { contextBridge, ipcRenderer } = require('electron');

const initialThemeArgument = process.argv.find((argument) => argument.startsWith('--mori-theme='));
const initialTheme = initialThemeArgument?.slice('--mori-theme='.length) === 'dark' ? 'dark' : 'light';

contextBridge.exposeInMainWorld('desktop', {
  initialTheme,
  confirmReplace: () => ipcRenderer.invoke('document:confirm-replace'),
  openDocument: () => ipcRenderer.invoke('document:open'),
  saveDocument: (payload) => ipcRenderer.invoke('document:save', payload),
  renameDocument: (payload) => ipcRenderer.invoke('document:rename', payload),
  exportHtml: (payload) => ipcRenderer.invoke('document:export-html', payload),
  exportPdf: (payload) => ipcRenderer.invoke('document:export-pdf', payload),
  setDirty: (value) => ipcRenderer.send('document:set-dirty', value),
  setTheme: (theme) => ipcRenderer.send('app:set-theme', theme),
  loadSession: () => ipcRenderer.invoke('session:load'),
  saveSession: (session) => ipcRenderer.send('session:save', session),
  writeClipboardText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  downloadAndInstallUpdate: () => ipcRenderer.invoke('update:download-and-install'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  resolveResource: (payload) => ipcRenderer.invoke('resource:resolve', payload),
  embedResource: (payload) => ipcRenderer.invoke('resource:embed', payload),
  openLinkedDocument: (payload) => ipcRenderer.invoke('document:open-link', payload),
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('app:update-available', (_event, release) => callback(release));
  },
  onUpdateDownloadProgress: (callback) => {
    ipcRenderer.on('app:update-download-progress', (_event, progress) => callback(progress));
  },
  onOpenPath: (callback) => {
    ipcRenderer.on('document:open-path', (_event, document) => callback(document));
  }
});

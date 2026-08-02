const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  confirmReplace: () => ipcRenderer.invoke('document:confirm-replace'),
  openDocument: () => ipcRenderer.invoke('document:open'),
  saveDocument: (payload) => ipcRenderer.invoke('document:save', payload),
  renameDocument: (payload) => ipcRenderer.invoke('document:rename', payload),
  exportHtml: (payload) => ipcRenderer.invoke('document:export-html', payload),
  exportPdf: (payload) => ipcRenderer.invoke('document:export-pdf', payload),
  setDirty: (value) => ipcRenderer.send('document:set-dirty', value),
  loadSession: () => ipcRenderer.invoke('session:load'),
  saveSession: (session) => ipcRenderer.send('session:save', session),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  resolveResource: (payload) => ipcRenderer.invoke('resource:resolve', payload),
  embedResource: (payload) => ipcRenderer.invoke('resource:embed', payload),
  openLinkedDocument: (payload) => ipcRenderer.invoke('document:open-link', payload),
  onOpenPath: (callback) => {
    ipcRenderer.on('document:open-path', (_event, document) => callback(document));
  }
});

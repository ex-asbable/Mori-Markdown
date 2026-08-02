const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  confirmReplace: () => ipcRenderer.invoke('document:confirm-replace'),
  openDocument: () => ipcRenderer.invoke('document:open'),
  saveDocument: (payload) => ipcRenderer.invoke('document:save', payload),
  setDirty: (value) => ipcRenderer.send('document:set-dirty', value),
  loadSession: () => ipcRenderer.invoke('session:load'),
  saveSession: (session) => ipcRenderer.send('session:save', session),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  resolveResource: (payload) => ipcRenderer.invoke('resource:resolve', payload),
  openLinkedDocument: (payload) => ipcRenderer.invoke('document:open-link', payload),
  onOpenPath: (callback) => {
    ipcRenderer.on('document:open-path', (_event, document) => callback(document));
  }
});

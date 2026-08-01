const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  confirmReplace: () => ipcRenderer.invoke('document:confirm-replace'),
  openDocument: () => ipcRenderer.invoke('document:open'),
  saveDocument: (payload) => ipcRenderer.invoke('document:save', payload),
  setDirty: (value) => ipcRenderer.send('document:set-dirty', value),
  closeAfterSave: () => ipcRenderer.send('document:close-after-save'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  onSaveBeforeClose: (callback) => {
    ipcRenderer.on('document:save-before-close', callback);
  }
});


const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('noteBridge', {
  saveDocument: async payload => ipcRenderer.invoke('note:save', payload),
  saveSharedDocument: async payload => ipcRenderer.invoke('note:saveShared', payload),
  openDocument: async () => ipcRenderer.invoke('note:open'),
  listDocuments: async () => ipcRenderer.invoke('note:list'),
  importDocuments: async () => ipcRenderer.invoke('note:import')
});

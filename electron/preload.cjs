const { contextBridge, ipcRenderer } = require('electron');

// Ponte mínima para a interface acompanhar e confirmar atualizações do aplicativo.
contextBridge.exposeInMainWorld('desktopUpdates', {
  getStatus: () => ipcRenderer.invoke('update:get-status'),
  install: () => ipcRenderer.invoke('update:install'),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
});

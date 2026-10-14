const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('roadmindDesktop', {
  checkForUpdates: () => ipcRenderer.invoke('roadmind:check-update'),
  downloadUpdate: () => ipcRenderer.invoke('roadmind:download-update'),
  installUpdate: () => ipcRenderer.invoke('roadmind:install-update'),
  onUpdateStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('roadmind:update-status', listener);
    return () => ipcRenderer.removeListener('roadmind:update-status', listener);
  },
  onUpdateProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('roadmind:update-progress', listener);
    return () => ipcRenderer.removeListener('roadmind:update-progress', listener);
  }
});

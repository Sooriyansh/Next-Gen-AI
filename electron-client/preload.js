const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deviceCollector', {
  start: (options) => ipcRenderer.invoke('collector:start', options),
  stop: () => ipcRenderer.invoke('collector:stop'),
  onLog: (handler) => ipcRenderer.on('collector-log', (_event, message) => handler(message)),
});

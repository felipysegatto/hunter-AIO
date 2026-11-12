const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pvpWin', {
  armory: (url) => ipcRenderer.invoke('pvp:armory', url),
  external: (url) => ipcRenderer.invoke('shell:open', url),
  onNavigate: (cb) => ipcRenderer.on('pvp:navigate', (_e, u) => cb(u))
});

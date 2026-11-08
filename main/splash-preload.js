'use strict';
// The launcher window only listens to its state and answers with a button.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  onState: (cb) => ipcRenderer.on('launcher:state', (_e, state) => cb(state)),
  act: (action) => ipcRenderer.invoke('launcher:act', action)
});

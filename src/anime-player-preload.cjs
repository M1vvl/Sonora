const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('animePlayer', Object.freeze({
  get: () => ipcRenderer.invoke('anime-player:get'),
  action: (action, value) => ipcRenderer.invoke('anime-player:action', action, value),
  onState: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('anime-player:state', listener); return () => ipcRenderer.removeListener('anime-player:state', listener); },
  onFrame: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('anime-player:frame', listener); return () => ipcRenderer.removeListener('anime-player:frame', listener); },
  onPointer: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('anime-player:pointer', listener); return () => ipcRenderer.removeListener('anime-player:pointer', listener); }
}));

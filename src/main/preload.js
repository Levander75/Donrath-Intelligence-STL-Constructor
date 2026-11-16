// Sichere Brücke zwischen Oberfläche und Hauptprozess
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dicApi', {
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  onWinState: (cb) => ipcRenderer.on('win:state', (_e, s) => cb(s)),
  openFiles: (kind) => ipcRenderer.invoke('file:open', kind),
  saveFile: (kind, name, data) => ipcRenderer.invoke('file:save', { kind, name, data }),
  writeFile: (path, data) => ipcRenderer.invoke('file:write', { path, data }),
  confirm: (message, detail, buttons) => ipcRenderer.invoke('app:confirm', { message, detail, buttons }),
  onCloseRequest: (cb) => ipcRenderer.on('app:close-request', () => cb()),
  confirmClose: () => ipcRenderer.send('app:close-confirmed'),
  onOpenFile: (cb) => ipcRenderer.on('app:open-file', (_e, f) => cb(f)),
  ready: () => ipcRenderer.send('app:ready'),
});

// Donrath Intelligence STL Constructor – Hauptprozess
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let win;

// Auch auf Rechnern mit gesperrten Grafiktreibern (z. B. Remote-Desktop) WebGL erlauben
app.commandLine.appendSwitch('ignore-gpu-blocklist');

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 1100, minHeight: 680,
    frame: false, backgroundColor: '#050505', show: false,
    title: 'Donrath Intelligence STL Constructor',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => win.webContents.send('win:state', 'max'));
  win.on('unmaximize', () => win.webContents.send('win:state', 'normal'));
  // Externe Links im Standardbrowser öffnen
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// Fenstersteuerung (rahmenloses Fenster)
ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:maximize', () => win && (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.on('win:close', () => win && win.close());

const FILTERS = {
  project: [{ name: 'Donrath Constructor Projekt', extensions: ['dicp'] }],
  mesh: [{ name: '3D-Modelle', extensions: ['stl', 'obj', '3mf'] }],
  stl: [{ name: 'STL', extensions: ['stl'] }],
  '3mf': [{ name: '3MF', extensions: ['3mf'] }],
};

ipcMain.handle('file:open', async (_e, kind) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: FILTERS[kind] || [] });
  if (r.canceled) return [];
  return r.filePaths.map(p => ({ name: path.basename(p), path: p, data: fs.readFileSync(p) }));
});

ipcMain.handle('file:save', async (_e, { kind, name, data }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: FILTERS[kind] || [] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, Buffer.from(data));
  return r.filePath;
});

// Speichern unter bekanntem Pfad (Strg+S nach erstem Speichern)
ipcMain.handle('file:write', async (_e, { path: p, data }) => {
  fs.writeFileSync(p, Buffer.from(data));
  return p;
});

ipcMain.handle('app:confirm', async (_e, { message, detail, buttons }) => {
  const r = await dialog.showMessageBox(win, { type: 'question', message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1 });
  return r.response;
});

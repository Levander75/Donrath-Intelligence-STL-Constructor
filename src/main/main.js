// Donrath Intelligence STL Constructor – Hauptprozess
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let win;
let forceClose = false;
let rendererReady = false;
let pendingFile = null; // per Doppelklick übergebene .dicp-Datei

// Nur eine Instanz: weitere Doppelklicks öffnen die Datei im laufenden Fenster
if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', (_e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore(); win.focus();
  const f = projectFromArgv(argv); if (f) sendOpenFile(f);
});
function projectFromArgv(argv) { return argv.slice(1).find(a => /\.dicp$/i.test(a) && fs.existsSync(a)) || null; }
function sendOpenFile(p) {
  if (!rendererReady) { pendingFile = p; return; }
  try { win.webContents.send('app:open-file', { path: p, data: fs.readFileSync(p) }); } catch (e) { dialog.showErrorBox('Datei konnte nicht geöffnet werden', String(e.message || e)); }
}

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
  // Schließen über Titelleiste, Alt+F4 oder Taskleiste: Oberfläche fragt bei ungespeicherten Änderungen nach
  win.on('close', (e) => {
    if (forceClose || !rendererReady) return;
    e.preventDefault(); win.webContents.send('app:close-request');
  });
  const f = projectFromArgv(process.argv); if (f) pendingFile = f;
}
ipcMain.on('app:close-confirmed', () => { forceClose = true; if (win) win.close(); });
ipcMain.on('app:ready', () => { rendererReady = true; if (pendingFile) { const p = pendingFile; pendingFile = null; sendOpenFile(p); } });

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// Fenstersteuerung (rahmenloses Fenster)
ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:maximize', () => win && (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.on('win:close', () => win && win.close());

const FILTERS = {
  project: [{ name: 'Donrath Constructor Projekt', extensions: ['dicp'] }],
  mesh: [{ name: '3D-Modelle', extensions: ['stl', 'obj', '3mf', 'ply', 'amf', 'off'] }, { name: 'Alle Dateien', extensions: ['*'] }],
  stl: [{ name: 'STL', extensions: ['stl'] }],
  stla: [{ name: 'STL (ASCII)', extensions: ['stl'] }],
  '3mf': [{ name: '3MF', extensions: ['3mf'] }],
  obj: [{ name: 'OBJ', extensions: ['obj'] }],
  ply: [{ name: 'PLY', extensions: ['ply'] }],
  amf: [{ name: 'AMF', extensions: ['amf'] }],
  off: [{ name: 'OFF', extensions: ['off'] }],
  x3d: [{ name: 'X3D', extensions: ['x3d'] }],
  png: [{ name: 'PNG-Bild', extensions: ['png'] }],
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

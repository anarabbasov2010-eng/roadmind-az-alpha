const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const fs = require('node:fs');

const isDev = !app.isPackaged;
const iconPath = path.join(__dirname, 'roadmind.ico');

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#101514',
    title: 'RoadMind AZ Alpha',
    autoHideMenuBar: true,
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (isDev) win.loadURL('http://127.0.0.1:5173');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = false;
autoUpdater.logger = require('electron-log');
autoUpdater.logger.transports.file.level = 'info';

function broadcastUpdate(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

autoUpdater.on('checking-for-update', () => broadcastUpdate('roadmind:update-status', { status: 'checking' }));
autoUpdater.on('update-available', (info) => broadcastUpdate('roadmind:update-status', { status: 'available', version: info.version, releaseNotes: info.releaseNotes || '' }));
autoUpdater.on('update-not-available', (info) => broadcastUpdate('roadmind:update-status', { status: 'current', version: info.version }));
autoUpdater.on('download-progress', (progress) => broadcastUpdate('roadmind:update-progress', { percent: Math.round(progress.percent), transferred: progress.transferred, total: progress.total }));
autoUpdater.on('update-downloaded', (info) => broadcastUpdate('roadmind:update-status', { status: 'downloaded', version: info.version }));
autoUpdater.on('error', (error) => broadcastUpdate('roadmind:update-status', { status: 'error', message: error.message }));

ipcMain.handle('roadmind:check-update', async () => {
  if (!app.isPackaged) return { status: 'dev' };
  try { await autoUpdater.checkForUpdates(); return { status: 'checking' }; }
  catch (error) { return { status: 'error', message: error instanceof Error ? error.message : String(error) }; }
});
ipcMain.handle('roadmind:download-update', async () => {
  try { await autoUpdater.downloadUpdate(); return { status: 'downloading' }; }
  catch (error) { return { status: 'error', message: error instanceof Error ? error.message : String(error) }; }
});
ipcMain.handle('roadmind:install-update', () => {
  if (app.isPackaged) { setImmediate(() => autoUpdater.quitAndInstall(false, true)); return { status: 'installing' }; }
  return { status: 'dev' };
});

app.whenReady().then(() => {
  app.setAppUserModelId('az.roadmind.desktop');
  createWindow();
  if (app.isPackaged) setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 4000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
// Aba PvP: janelas abertas pelo site (jogador, Armory) sempre vem para a frente e ficam interativas.
const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const PVP_HOST = /^https:\/\/([a-z0-9-]+\.)?check-pvp\.fr(\/|$)/i;
const ARMORY_HOST = /^https:\/\/worldofwarcraft\.blizzard\.com\//i;
let getMain = () => null;
let playerWin = null;
let armoryWin = null;

function iconPath() {
  const p = path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  return fs.existsSync(p) ? p : undefined;
}

function bringFront(w) {
  if (!w || w.isDestroyed()) return;
  if (w.isMinimized()) w.restore();
  w.show(); w.focus(); w.moveTop();
  w.setAlwaysOnTop(true); w.setAlwaysOnTop(false); // truque para furar a fila no Windows
}

// Endereco do Armory (WoW Forever) a partir do endereco da pagina do jogador no check-pvp
function armoryUrl(pvpUrl) {
  try {
    const seg = new URL(pvpUrl).pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
    if (!seg.length) return null;
    const name = seg[seg.length - 1];
    if (/^(us|eu|kr|tw|ranking|player|character|players)$/i.test(name)) return null;
    const region = (seg.find((s) => /^(us|eu|kr|tw)$/i.test(s)) || 'us').toLowerCase();
    const slug = name.trim().toLowerCase().replace(/\s+/g, '-');
    return `https://worldofwarcraft.blizzard.com/pt-br/forever/${region}/armory/character/${encodeURIComponent(slug)}`;
  } catch (e) { return null; }
}

function guardWebview(contents) {
  contents.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload; delete prefs.preloadURL;
    prefs.nodeIntegration = false; prefs.contextIsolation = true; prefs.sandbox = true;
    if (!PVP_HOST.test(params.src || '')) e.preventDefault();
  });
}

function openPlayer(url) {
  if (!PVP_HOST.test(url || '')) return;
  if (playerWin && !playerWin.isDestroyed()) { playerWin.webContents.send('pvp:navigate', url); bringFront(playerWin); return; }
  const parent = getMain();
  playerWin = new BrowserWindow({
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    width: 1060, height: 800, minWidth: 720, minHeight: 520, show: false,
    backgroundColor: '#070a04', title: 'PvP · Jogador', icon: iconPath(), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'pvp-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true }
  });
  playerWin.setMenu(null);
  guardWebview(playerWin.webContents);
  playerWin.loadFile(path.join(__dirname, '..', 'src', 'pvp-window.html'), { query: { u: url } });
  playerWin.once('ready-to-show', () => bringFront(playerWin));
  playerWin.on('closed', () => { playerWin = null; });
}

function openArmory(url) {
  if (!ARMORY_HOST.test(url || '')) return;
  if (armoryWin && !armoryWin.isDestroyed()) { armoryWin.loadURL(url); bringFront(armoryWin); return; }
  const parent = getMain();
  armoryWin = new BrowserWindow({
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    width: 1180, height: 840, minWidth: 760, minHeight: 520, show: false,
    backgroundColor: '#0b0f08', title: 'Armory', icon: iconPath(), autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  armoryWin.setMenu(null);
  armoryWin.webContents.setWindowOpenHandler(({ url: u }) => { if (/^https?:\/\//i.test(u)) shell.openExternal(u); return { action: 'deny' }; });
  armoryWin.loadURL(url);
  armoryWin.once('ready-to-show', () => bringFront(armoryWin));
  armoryWin.on('closed', () => { armoryWin = null; });
}

function route(url) {
  if (PVP_HOST.test(url)) openPlayer(url);
  else if (ARMORY_HOST.test(url)) openArmory(url);
  else if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

function hookWebview(contents) {
  contents.setWindowOpenHandler(({ url }) => { route(url); return { action: 'deny' }; });
  contents.on('will-navigate', (e, url) => { if (!PVP_HOST.test(url)) { e.preventDefault(); route(url); } });
}

function init(mainGetter) {
  getMain = mainGetter;
  app.on('web-contents-created', (_e, contents) => { if (contents.getType() === 'webview') hookWebview(contents); });
  app.whenReady().then(() => {
    session.fromPartition('persist:pvp').setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  });
  ipcMain.handle('pvp:armory', (_e, url) => { const a = armoryUrl(String(url || '')); if (!a) return false; openArmory(a); return true; });
  ipcMain.handle('pvp:player', (_e, url) => { if (!PVP_HOST.test(String(url || ''))) return false; openPlayer(String(url)); return true; });
}

module.exports = { init, guardWebview, armoryUrl };

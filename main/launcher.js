'use strict';

// The launcher: a small window that opens before the app. It shows the version, checks GitHub for a newer
// one and, when there is one, shows what's new and updates with one click: it downloads the new installer,
// checks its SHA-256 against latest.json, runs it silently and the installer reopens the app.
//
// The app is installed per user (%LOCALAPPDATA%\Programs), like Discord or VS Code: no administrator prompt,
// shortcuts in the Start menu and on the desktop, an entry in Windows' installed apps, and updates that
// need no permission.
const { app, BrowserWindow, ipcMain, shell, net } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const updater = require('./updater');

const isWin = process.platform === 'win32';
const SETUP_RX = /^Grimorio-(?:do-Aventureiro|Hunter)-Setup-(\d+\.\d+\.\d+)\.exe$/i;

/** The installed Windows app updates itself; anything else (development, a loose .exe) opens the link */
const managed = () => isWin && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE;

const LOGIN_NAME = 'Grimorio do Aventureiro';
function setAutostart(enabled) {
  if (!isWin || !app.isPackaged) return { ok: false, supported: false };
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled, path: process.execPath, args: ['--autostart'], name: LOGIN_NAME });
    return { ok: true, supported: true };
  } catch (e) {
    return { ok: false, supported: true, error: String((e && e.message) || e) };
  }
}
function autostartState() {
  if (!isWin || !app.isPackaged) return { supported: false, enabled: false };
  try {
    const s = app.getLoginItemSettings({ path: process.execPath, args: ['--autostart'] });
    return { supported: true, enabled: !!(s.openAtLogin || s.executableWillLaunchAtLogin) };
  } catch (_) { return { supported: true, enabled: false }; }
}

/** A 2.2 test build kept loose copies in %LOCALAPPDATA%\Grimorio do Aventureiro\app: the installer replaces them */
function cleanupLooseCopies() {
  if (!isWin || !process.env.LOCALAPPDATA) return;
  const dir = path.join(process.env.LOCALAPPDATA, 'Grimorio do Aventureiro', 'app');
  try {
    for (const f of fs.readdirSync(dir)) {
      if (/^Grimorio-do-Aventureiro-\d+\.\d+\.\d+-Windows\.exe(\.part)?$/i.test(f)) { try { fs.unlinkSync(path.join(dir, f)); } catch (_) { /* in use: next time */ } }
    }
    fs.rmdirSync(dir);
    fs.rmdirSync(path.dirname(dir));
  } catch (_) { /* nothing there */ }
}

/** Downloads the new installer to a temporary folder, checking its SHA-256 against latest.json */
async function download(check, onProgress) {
  const asset = check.asset;
  if (!asset || !asset.url) throw new Error('a versão nova não tem instalador para Windows');
  if (!/^[0-9a-f]{64}$/i.test(check.sha256 || '')) throw new Error('a versão nova não informou a verificação do arquivo');
  const name = SETUP_RX.test(asset.name || '') ? asset.name : `Grimorio-Hunter-Setup-${check.latest}.exe`;
  const dir = path.join(app.getPath('temp'), 'grimorio-atualizacao');
  fs.mkdirSync(dir, { recursive: true });
  const final = path.join(dir, name);
  const tmp = final + '.part';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10 * 60 * 1000);
  try {
    const res = await net.fetch(asset.url, { signal: ctrl.signal, headers: { 'User-Agent': `GrimorioDoAventureiro/${app.getVersion()}` } });
    if (!res.ok) throw new Error('o GitHub respondeu HTTP ' + res.status);
    const total = Number(res.headers.get('content-length')) || Number(asset.size) || 0;
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(tmp);
    const reader = res.body.getReader();
    let got = 0;
    let last = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      hash.update(chunk);
      got += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      if (Date.now() - last > 120) { last = Date.now(); onProgress(got, total); }
    }
    await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
    onProgress(got, total);
    if (hash.digest('hex') !== check.sha256.toLowerCase()) {
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      throw new Error('o arquivo baixado veio diferente do publicado; nada foi trocado');
    }
    try { fs.unlinkSync(final); } catch (_) { /* first time */ }
    fs.renameSync(tmp, final);
    return final;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs the installer silently; it replaces this version and opens the new one (--force-run).
 * Resolves once Windows actually started it; rejects when it could not (an antivirus may have
 * removed or blocked the file), so the launcher can say so instead of closing for nothing.
 */
async function runInstaller(file) {
  await sleep(1500); // an antivirus scans (and may remove) a new .exe right after it is written
  if (!fs.existsSync(file)) throw new Error('o antivírus do Windows removeu o instalador baixado');
  try { app.releaseSingleInstanceLock(); } catch (_) { /* not held */ }
  await new Promise((resolve, reject) => {
    let child;
    try { child = spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }); } catch (e) { reject(e); return; }
    child.once('spawn', () => { child.unref(); resolve(); });
    child.once('error', (e) => reject(new Error(/EPERM|EACCES|blocked|virus/i.test(String(e && (e.code || e.message))) ? 'o Windows bloqueou o instalador (antivírus?)' : String((e && e.message) || e))));
  }).catch((e) => { try { app.requestSingleInstanceLock(); } catch (_) { /* best effort */ } throw e; });
}

/** "Nova versão" in the title bar: open the app again, so the launcher shows what's new and updates */
function restart() {
  if (!managed()) return false;
  try { app.releaseSingleInstanceLock(); } catch (_) { /* not held */ }
  app.relaunch();
  return true;
}

/* ---------- the window ---------- */
let splash = null;
function openSplash() {
  const iconPath = path.join(__dirname, '..', 'build', isWin ? 'icon.ico' : 'icon.png');
  splash = new BrowserWindow({
    width: 460,
    height: 300,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    center: true,
    backgroundColor: '#070a04',
    title: 'Grimório do Aventureiro',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: { preload: path.join(__dirname, 'splash-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  splash.loadFile(path.join(__dirname, '..', 'src', 'splash.html'));
  splash.once('ready-to-show', () => { if (splash && !splash.isDestroyed()) splash.show(); });
  return new Promise((resolve) => splash.webContents.once('did-finish-load', resolve));
}
function send(state) { if (splash && !splash.isDestroyed()) splash.webContents.send('launcher:state', state); }
function grow(h) { if (splash && !splash.isDestroyed()) { const [w] = splash.getSize(); splash.setSize(w, h); splash.center(); } }
function closeSplash() { if (splash && !splash.isDestroyed()) splash.destroy(); splash = null; }

let waiting = null;
ipcMain.handle('launcher:act', (_e, action) => { if (waiting) { const w = waiting; waiting = null; w(String(action || '')); } return true; });
const userChoice = () => new Promise((resolve) => { waiting = resolve; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Opens the launcher, checks for a new version and waits for the player when there is one.
 * Resolves 'continue' (open the app) or 'quit' (the installer of the new version is running).
 * `onCheck(result)` receives the update check; `fake` replaces it (development screenshots).
 */
async function start({ repo, onCheck, fake } = {}) {
  const started = Date.now();
  await openSplash();
  send({ state: 'checking', version: app.getVersion() });
  const check = fake || await Promise.race([
    updater.check(repo),
    sleep(7000).then(() => ({ ok: false, current: app.getVersion(), error: 'o GitHub demorou para responder' }))
  ]);
  if (onCheck) onCheck(check);
  const wait = 1300 - (Date.now() - started);
  if (wait > 0) await sleep(wait);

  if (!(check.ok && check.available)) {
    send({ state: 'ready', version: app.getVersion(), ok: !!check.ok, error: check.error || null });
    await sleep(check.ok ? 650 : 1100);
    return 'continue';
  }

  const canInstall = fake && fake.canInstall != null ? !!fake.canInstall : managed() && !!check.asset && /^[0-9a-f]{64}$/i.test(check.sha256 || '');
  grow(545);
  send({ state: 'update', version: app.getVersion(), latest: check.latest, notes: check.notesList || [], date: check.publishedAt, size: check.asset && check.asset.size, canInstall });
  for (;;) {
    const action = await userChoice();
    if (action === 'later') return 'continue';
    if (action === 'browser') { shell.openExternal((check.asset && check.asset.url) || check.url); return 'continue'; }
    if (action !== 'update') continue;
    if (!canInstall) { shell.openExternal((check.asset && check.asset.url) || check.url); return 'continue'; }
    try {
      send({ state: 'downloading', got: 0, total: (check.asset && check.asset.size) || 0, latest: check.latest });
      const file = await download(check, (got, total) => send({ state: 'downloading', got, total, latest: check.latest }));
      send({ state: 'restarting', latest: check.latest });
      await runInstaller(file);
      await sleep(500);
      return 'quit';
    } catch (e) {
      send({ state: 'failed', latest: check.latest, error: String((e && e.message) || e).slice(0, 140) });
    }
  }
}

/** Development aid: picture of the launcher window */
async function captureSplash(out) {
  if (!out || !splash || splash.isDestroyed()) return;
  const img = await splash.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG());
}

module.exports = { start, closeSplash, captureSplash, restart, setAutostart, autostartState, cleanupLooseCopies, managed, download };

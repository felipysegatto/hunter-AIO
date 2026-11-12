// Aba PvP (provisoria): o site abre dentro da propria aba; nenhuma janela nova e criada.
const { app, session } = require('electron');

const PVP_HOST = /^https:\/\/([a-z0-9-]+\.)?check-pvp\.fr(\/|$)/i;

function guardWebview(contents) {
  contents.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload; delete prefs.preloadURL;
    prefs.nodeIntegration = false; prefs.contextIsolation = true; prefs.sandbox = true;
    if (!PVP_HOST.test(params.src || '')) e.preventDefault();
  });
}

function hookWebview(contents) {
  // O que o site tentar abrir em "nova janela" abre na mesma aba; enderecos de fora sao ignorados
  contents.setWindowOpenHandler(({ url }) => {
    if (PVP_HOST.test(url)) setImmediate(() => { if (!contents.isDestroyed()) contents.loadURL(url); });
    return { action: 'deny' };
  });
  contents.on('will-navigate', (e, url) => { if (!PVP_HOST.test(url)) e.preventDefault(); });
}

function init() {
  app.on('web-contents-created', (_e, contents) => { if (contents.getType() === 'webview') hookWebview(contents); });
  app.whenReady().then(() => {
    session.fromPartition('persist:pvp').setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  });
}

module.exports = { init, guardWebview };

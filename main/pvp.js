// Mapeador do site de PvP (ferramenta temporaria): abre o ranking, anota as chamadas de dados e salva um arquivo
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const HOME = 'https://forever.check-pvp.fr/ranking';
let mapping = false;

function shrink(v, depth = 0) {
  if (Array.isArray(v)) return { __lista: v.length, amostra: v.slice(0, 3).map((x) => shrink(x, depth + 1)) };
  if (v && typeof v === 'object') {
    if (depth > 6) return '{...}';
    const o = {};
    for (const [k, x] of Object.entries(v).slice(0, 80)) o[k] = shrink(x, depth + 1);
    return o;
  }
  if (typeof v === 'string' && v.length > 200) return v.slice(0, 200) + '...';
  return v;
}

function mapSite(parent) {
  return new Promise((resolve) => {
    if (mapping) return resolve({ ok: false, message: 'O mapeamento ja esta aberto.' });
    mapping = true;
    const log = [];
    const file = path.join(app.getPath('desktop'), 'pvp-gravacao.json');
    const save = () => { try { fs.writeFileSync(file, JSON.stringify(log, null, 2)); } catch (e) { /* sem permissao */ } };
    const win = new BrowserWindow({
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      width: 1280, height: 860, backgroundColor: '#0b1007', autoHideMenuBar: true,
      title: 'Mapeando o site de PvP: use os filtros, mude de pagina, abra um jogador e depois feche esta janela',
      webPreferences: { sandbox: true, contextIsolation: true }
    });
    win.setMenu(null);
    const wc = win.webContents;
    wc.on('did-navigate', (_e, url) => { log.push({ tipo: 'navegacao', url }); save(); });
    wc.on('did-navigate-in-page', (_e, url) => { log.push({ tipo: 'navegacao-interna', url }); save(); });
    const dbg = wc.debugger;
    try { dbg.attach('1.3'); } catch (e) { mapping = false; win.destroy(); return resolve({ ok: false, message: 'Nao consegui iniciar o mapeamento.' }); }
    dbg.sendCommand('Network.enable').catch(() => {});
    const reqs = new Map();
    dbg.on('message', async (_e, method, p) => {
      if (method === 'Network.requestWillBeSent') {
        const h = { ...(p.request.headers || {}) };
        delete h.Cookie; delete h.cookie;
        reqs.set(p.requestId, { url: p.request.url, metodo: p.request.method, corpo: p.request.postData, cabecalhos: h, tipoRecurso: p.type });
      } else if (method === 'Network.responseReceived') {
        const r = reqs.get(p.requestId);
        if (r) { r.status = p.response.status; r.mime = p.response.mimeType; }
      } else if (method === 'Network.loadingFinished') {
        const r = reqs.get(p.requestId);
        if (!r) return;
        if (!/^(XHR|Fetch)$/i.test(r.tipoRecurso || '') && !/json/i.test(r.mime || '')) return;
        try {
          const b = await dbg.sendCommand('Network.getResponseBody', { requestId: p.requestId });
          const body = b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body;
          let resposta;
          try { resposta = shrink(JSON.parse(body)); } catch (e) { resposta = body.slice(0, 800); }
          log.push({ tipo: 'dados', hora: new Date().toISOString(), ...r, resposta });
          save();
        } catch (e) { /* resposta indisponivel */ }
      }
    });
    win.loadURL(HOME);
    win.on('closed', () => {
      mapping = false;
      const dados = log.filter((x) => x.tipo === 'dados').length;
      if (!log.length) return resolve({ ok: false, message: 'Nada foi gravado. Tente de novo e espere o ranking carregar.' });
      save();
      shell.showItemInFolder(file);
      resolve({ ok: true, file, dados });
    });
  });
}

function init(getMain) {
  ipcMain.handle('pvp:map', () => mapSite(getMain()));
}

module.exports = { init };

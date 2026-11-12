// Gravador de rede do check-pvp: abre o site e anota as chamadas de dados (nao altera nada no app)
// Uso:  npm run gravar-pvp   -> mexa no site (filtros, jogadores) e feche a janela. O resultado fica em pvp-gravacao.json
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'pvp-gravacao.json');
const log = [];
const save = () => fs.writeFileSync(OUT, JSON.stringify(log, null, 2));

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

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 860, title: 'Gravador PvP: use o site (filtros, jogadores) e depois feche esta janela', autoHideMenuBar: true, webPreferences: { sandbox: true } });
  const wc = win.webContents;
  wc.on('did-navigate', (_e, url) => { log.push({ tipo: 'navegacao', url }); save(); });
  wc.on('did-navigate-in-page', (_e, url) => { log.push({ tipo: 'navegacao-interna', url }); save(); });
  const dbg = wc.debugger;
  dbg.attach('1.3');
  await dbg.sendCommand('Network.enable');
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
  win.loadURL('https://forever.check-pvp.fr/ranking');
  win.on('closed', () => { save(); app.quit(); });
});

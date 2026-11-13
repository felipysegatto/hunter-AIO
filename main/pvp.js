// PvP: le o ranking e os perfis do check-pvp.fr numa janela INVISIVEL (sem anuncios) e entrega os dados ao app.
// O site nunca aparece na tela: o app monta a visualizacao no proprio estilo.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const scripts = require('./pvp-scripts');

const ORIGIN = 'https://forever.check-pvp.fr';
const SITE = /^https:\/\/forever\.check-pvp\.fr(\/|$)/i;
const AD = /(^|\.)(doubleclick\.net|googlesyndication\.com|googletagmanager\.com|google-analytics\.com|googletagservices\.com|adnxs\.com|rubiconproject\.com|primis\.tech|gumgum\.com|id5-sync\.com|richaudience\.com|media\.net|ad-delivery\.net|amazon-adsystem\.com|pubmatic\.com|openx\.net|criteo\.com|taboola\.com|outbrain\.com|adsrvr\.org|smartadserver\.com|3lift\.com|sharethrough\.com|yieldmo\.com|teads\.tv|casalemedia\.com|indexww\.com|bidswitch\.net|demdex\.net|scorecardresearch\.com|quantserve\.com|doubleverify\.com|adsafeprotected\.com|twitch\.tv|ttvnw\.net|jtvnw\.net)$/i;
const REGIONS = ['us', 'eu', 'kr', 'tw'];
const FACTIONS = ['all', 'alliance', 'horde'];
const SPECS = { all: '253,254,255', '253': '253', '254': '254', '255': '255' }; // Hunter: Dominio das Feras, Precisao, Sobrevivencia
const NAME = /^[\p{L}\p{N}'’ -]{1,30}$/u;

let dataWin = null;
let idleTimer = null;
let chain = Promise.resolve();
const cache = new Map();
const TTL = 10 * 60 * 1000;

function blockAds(sess) {
  sess.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (d, cb) => {
    let host = '';
    try { host = new URL(d.url).hostname; } catch (e) { /* url invalida */ }
    cb({ cancel: AD.test(host) || d.resourceType === 'media' });
  });
}

function ensureWin() {
  if (dataWin && !dataWin.isDestroyed()) return dataWin;
  dataWin = new BrowserWindow({
    show: false, width: 1280, height: 900,
    webPreferences: { partition: 'persist:pvpdata', sandbox: true, contextIsolation: true, backgroundThrottling: false }
  });
  const wc = dataWin.webContents;
  blockAds(wc.session);
  wc.session.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  wc.setAudioMuted(true);
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e, url) => { if (!SITE.test(url)) e.preventDefault(); });
  dataWin.on('closed', () => { dataWin = null; });
  return dataWin;
}

function touchIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (dataWin && !dataWin.isDestroyed()) dataWin.destroy(); dataWin = null; }, 3 * 60 * 1000);
}

function enqueue(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

async function readPage(url, script) {
  const win = ensureWin();
  const wc = win.webContents;
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('O site demorou para responder.')), 30000);
    wc.loadURL(url).then(() => { clearTimeout(t); resolve(); }).catch((e) => {
      clearTimeout(t);
      if (SITE.test(wc.getURL() || '')) resolve(); else reject(e); // ERR_ABORTED em redirecionamento do proprio site
    });
  });
  const out = await wc.executeJavaScript(script, true);
  touchIdle();
  return out;
}

function cached(key, force, make) {
  const hit = cache.get(key);
  if (hit && !force && Date.now() - hit.t < TTL) return Promise.resolve({ ...hit.data, cache: true });
  return enqueue(async () => {
    const data = await make();
    if (data && data.ok) cache.set(key, { t: Date.now(), data });
    return data;
  });
}

function rankingUrl(p) {
  const region = REGIONS.includes(p.region) ? p.region : 'us';
  const faction = FACTIONS.includes(p.faction) ? p.faction : 'all';
  const specs = SPECS[String(p.spec)] || SPECS.all;
  const page = Math.max(1, Math.min(500, parseInt(p.page, 10) || 1));
  return { url: `${ORIGIN}/ranking?region=${region}&faction=${faction}&specs=${specs}&classes=3&sort=honorableKills&order=desc&page=${page}`, page, region, faction };
}

function init(getMain) {
  ipcMain.handle('pvp:ranking', async (_e, params) => {
    try {
      const q = rankingUrl(params || {});
      const data = await cached(q.url, !!(params && params.force), async () => {
        const r = await readPage(q.url, scripts.rankingScript);
        return { ...r, url: q.url, page: q.page, region: q.region, faction: q.faction, fetchedAt: Date.now() };
      });
      if (!data.ok) return { ok: false, message: 'Não consegui ler a lista deste filtro (o site pode estar fora do ar ou ter mudado).', url: q.url, texto: data.texto || '' };
      return data;
    } catch (e) {
      return { ok: false, message: 'Erro ao ler o ranking: ' + e.message };
    }
  });
  ipcMain.handle('pvp:profile', async (_e, params) => {
    try {
      const p = params || {};
      const region = REGIONS.includes(p.region) ? p.region : 'us';
      if (!NAME.test(String(p.nome || '')) || !NAME.test(String(p.sobrenome || ''))) return { ok: false, message: 'Nome de jogador inválido.' };
      const url = `${ORIGIN}/${region}/${encodeURIComponent(p.nome)}/${encodeURIComponent(p.sobrenome)}`;
      const data = await cached(url, !!p.force, async () => {
        const r = await readPage(url, scripts.profileScript);
        return { ...r, url, fetchedAt: Date.now() };
      });
      if (!data.ok) return { ok: false, message: 'Não consegui ler o perfil deste jogador.', url };
      return data;
    } catch (e) {
      return { ok: false, message: 'Erro ao ler o perfil: ' + e.message };
    }
  });
  ipcMain.handle('pvp:map', () => mapSite(getMain()));
}

/* ---------- Mapeador (ferramenta de diagnostico): grava o que o site faz e o formato das paginas ---------- */
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
      parent: parent && !parent.isDestroyed() ? parent : undefined, width: 1280, height: 860, backgroundColor: '#0b1007', autoHideMenuBar: true,
      title: 'Mapeando o site de PvP: use os filtros, mude de pagina, abra um jogador e depois feche esta janela',
      webPreferences: { partition: 'persist:pvpmap', sandbox: true, contextIsolation: true }
    });
    win.setMenu(null);
    blockAds(win.webContents.session);
    const wc = win.webContents;
    let snapTimer = null;
    const snap = () => {
      clearTimeout(snapTimer);
      snapTimer = setTimeout(async () => {
        try {
          const url = wc.getURL();
          if (!SITE.test(url)) return;
          const isRanking = /\/ranking/i.test(url);
          const dados = await wc.executeJavaScript(isRanking ? scripts.rankingScript : scripts.profileScript, true);
          log.push({ tipo: 'pagina', url, dados });
          save();
        } catch (e) { /* pagina trocou */ }
      }, 3500);
    };
    wc.on('did-navigate', (_e, url) => { log.push({ tipo: 'navegacao', url }); save(); snap(); });
    wc.on('did-navigate-in-page', (_e, url) => { log.push({ tipo: 'navegacao-interna', url }); save(); snap(); });
    win.loadURL(`${ORIGIN}/ranking`);
    win.on('closed', () => {
      clearTimeout(snapTimer);
      mapping = false;
      if (!log.length) return resolve({ ok: false, message: 'Nada foi gravado. Tente de novo e espere o ranking carregar.' });
      save();
      shell.showItemInFolder(file);
      resolve({ ok: true, file, dados: log.filter((x) => x.tipo === 'pagina').length });
    });
  });
}

module.exports = { init, rankingUrl };

'use strict';

const { app, BrowserWindow, ipcMain, shell, clipboard, nativeTheme, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const feeds = require('./feeds');
const ai = require('./ai');
const community = require('./community');
const translate = require('./translate');
const armory = require('./armory');
const packs = require('./packs');
const article = require('./article');
const guide = require('./guide');
const updater = require('./updater');
const figure = require('./figure');
const feedback = require('./feedback');
const launcher = require('./launcher');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
let win = null;
let refreshTimer = null;
let armoryTimer = null;
let lastPacks = { packs: [], folders: [] };

nativeTheme.themeSource = 'dark';

// The app's data (settings, character, guides) lives in its own folder: %APPDATA%\Grimorio do Aventureiro.
// Updates install over the app and never touch it, so the character stays saved from one version to the next.
// On a PC that never had the app, the first start finds it empty: no character, and the welcome asks for one.
app.setPath('userData', path.join(app.getPath('appData'), 'Grimorio do Aventureiro'));

/*
 * Whoever already used the app on this PC (v1 "Grimório do BruxoMagic", 2.0 and 2.1 kept their data in
 * %APPDATA%\Grimorio do BruxoMagic) keeps the character: once, the link, class, chosen guide and the saved
 * character come over to the new folder. It happens only while the new folder has no character of its own,
 * and never again after that (v1Imported), so disconnecting later sticks. The old folder is only read.
 */
(function importOldData() {
  try {
    const oldDir = path.join(app.getPath('appData'), 'Grimorio do BruxoMagic');
    const newDir = app.getPath('userData');
    const read = (dir, f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { return null; } };
    const oldSettings = read(oldDir, 'settings.json');
    if (!oldSettings) return;
    const cur = read(newDir, 'settings.json') || {};
    if (cur.v1Imported) return;
    const next = { ...cur, v1Imported: true };
    const hasOwn = !!(cur.armoryUrl || cur.classSlug);
    if (!hasOwn && (oldSettings.armoryUrl || oldSettings.classSlug)) {
      const empty = (v) => v === undefined || v === null || v === '' || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
      for (const k of ['armoryUrl', 'classSlug', 'faction', 'guidePick', 'region', 'bnetClientId', 'armoryMinutes', 'guideMinutes', 'refreshMinutes', 'aiModel', 'alerts', 'sound']) {
        if (!empty(oldSettings[k]) && empty(cur[k])) next[k] = oldSettings[k];
      }
      for (const f of ['character.json', 'guides.json', 'guide.json']) {
        const from = path.join(oldDir, f);
        const to = path.join(newDir, f);
        const mine = read(newDir, f);
        const useless = !mine || (f === 'character.json' && !(mine.armory && mine.armory.data));
        if (fs.existsSync(from) && useless) { fs.mkdirSync(newDir, { recursive: true }); fs.copyFileSync(from, to); }
      }
    }
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, 'settings.json'), JSON.stringify(next, null, 2));
  } catch (_) { /* nothing to carry over */ }
})();

const DATA = (f) => path.join(__dirname, '..', 'src', 'data', f);
const readData = (f) => JSON.parse(fs.readFileSync(DATA(f), 'utf8'));

function loadContent() {
  let base = readData('content.json');
  // Legacy single-file override (v1.0)
  const overridePath = path.join(app.getPath('userData'), 'content-override.json');
  if (fs.existsSync(overridePath)) {
    try {
      const o = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
      if (o && o.meta && o.meta.contentDate >= base.meta.contentDate) base = o;
    } catch (_) { /* ignore broken override */ }
  }
  const merged = packs.apply(base, readData('route.json'), store.getSettings().dataFolder);
  lastPacks = { packs: merged.packs, folders: merged.folders };
  return { ...merged.content, route: merged.route, classes: readData('classes.json'), packs: lastPacks };
}

// The item database is big (~1 MB): read once, handed to the window on request
let itemsCache = null;
function loadItems() { if (!itemsCache) itemsCache = readData('items.json'); return itemsCache; }

/** The class the guide and the gear advice are for: the Armory character's, or the one picked by hand */
function currentClass() {
  const ch = store.getCharacter();
  const d = ch.armory && ch.armory.data;
  const fromArmory = d && d.character && d.character.clsSlug;
  if (fromArmory && guide.CLASSES.includes(fromArmory)) return fromArmory;
  const s = store.getSettings();
  return guide.CLASSES.includes(s.classSlug) ? s.classSlug : null;
}

let mainReady = false;
let launchDone = false;
function maybeShow() {
  if (!mainReady || !launchDone || !win || win.isDestroyed()) return;
  if (!win.isVisible()) win.show();
  win.focus();
  launcher.closeSplash();
}

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'build', isWin ? 'icon.ico' : 'icon.png');
  win = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 1180,
    minHeight: 740,
    backgroundColor: '#0d0912',
    title: 'Grimório do Aventureiro',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    show: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 16, y: 20 } : undefined,
    titleBarOverlay: isMac ? false : { color: '#120c18', symbolColor: '#e8cf86', height: 56 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  // The window appears when it is ready AND the launcher is done (version check, maybe an update)
  win.once('ready-to-show', () => { mainReady = true; maybeShow(); });
  if (!app.isPackaged && process.env.GRIMORIO_SIZE) { const [w, h] = process.env.GRIMORIO_SIZE.split('x').map(Number); win.setSize(w, h); }

  // Development aid: GRIMORIO_SHOT=/path/out.png captures the window and quits
  if (!app.isPackaged && process.env.GRIMORIO_SHOT) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        if (process.env.GRIMORIO_JS) { try { await win.webContents.executeJavaScript(process.env.GRIMORIO_JS); } catch (e) { console.error(e); } }
        setTimeout(async () => {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(process.env.GRIMORIO_SHOT, img.toPNG());
          app.quit();
        }, Number(process.env.GRIMORIO_WAIT || 1500));
      }, 2200);
    });
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); }
  });
}

/* ---------- notifications ---------- */
const CAT_LABEL = { geral: 'Wowhead', comunidade: 'Reddit', build: 'Build nova', guia: 'Guia de leveling atualizado', armory: 'Armory', marcos: 'Marco', update: 'Nova versão do app' };
const PRIORITY = ['update', 'build', 'guia', 'armory', 'marcos', 'comunidade', 'geral'];

function notify(byCat, lines) {
  const s = store.getSettings();
  const cats = PRIORITY.filter((c) => byCat[c] && (c === 'update' || (s.alerts[c] && s.alerts[c].notify)));
  if (!cats.length || !Notification.isSupported()) return;
  const total = cats.reduce((n, c) => n + byCat[c], 0);
  const head = cats.length === 1 ? CAT_LABEL[cats[0]] : cats.map((c) => `${byCat[c]} ${CAT_LABEL[c]}`).join(' · ');
  const n = new Notification({
    title: total > 1 && cats.length > 1 ? `Grimório · ${total} novidades` : `Grimório · ${head}`,
    body: (cats.length > 1 ? head + '\n' : '') + (lines[cats[0]] || ''),
    silent: true
  });
  n.on('click', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  n.show();
}

function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }

/* ---------- news ---------- */
async function translateNews(items, apiKey, model) {
  // Items without an AI summary still have to read in Portuguese
  const todo = items.filter((it) => !(it.ai && it.ai.resumo) && !it.pt).slice(0, 30);
  for (const it of todo) {
    try {
      const r = await translate.translateMany([it.title, (it.snippet || '').slice(0, 900)], apiKey ? { apiKey, model } : null);
      if (r.engine !== 'nenhum') it.pt = { title: r.texts[0], text: r.texts[1], engine: r.engine };
    } catch (_) { /* stays untranslated until next run */ }
  }
}

async function runRefresh({ silent } = {}) {
  const content = loadContent();
  const settings = store.getSettings();
  const result = await feeds.fetchAll(content.feeds, store.getFeedCache());
  let aiStatus = { used: false };
  const apiKey = store.getApiKey();
  if (apiKey && result.newItems.length) {
    try {
      const summaries = await ai.summarize(result.newItems, { apiKey, model: settings.aiModel });
      result.items.forEach((it) => { if (summaries[it.id]) it.ai = summaries[it.id]; });
      aiStatus = { used: true, count: Object.keys(summaries).length };
    } catch (err) {
      aiStatus = { used: false, error: String(err.message || err) };
    }
  } else if (!apiKey) {
    aiStatus = { used: false, reason: 'no-key' };
  }
  await translateNews(result.items, apiKey && !aiStatus.error ? apiKey : '', settings.aiModel);
  store.saveFeedCache({ items: result.items, lastRefresh: new Date().toISOString(), errors: result.errors });

  const fresh = result.items.filter((i) => result.newItems.some((n) => n.id === i.id) && !(i.ai && i.ai.relevante === false) && !i.notified);
  const byCat = {};
  const lines = {};
  for (const it of fresh) {
    // Only what shows up in a tab notifies: class news from any source, or anything from Wowhead
    const topic = (it.ai && it.ai.categoria) || it.category;
    const cat = it.sourceKind === 'wowhead' ? 'geral' : null;
    const title = (it.ai && it.ai.titulo) || (it.pt && it.pt.title) || it.title;
    it.notified = true;
    if (!cat) continue;
    byCat[cat] = (byCat[cat] || 0) + 1;
    if (!lines[cat]) lines[cat] = title;
    void topic;
  }
  if (fresh.length) store.saveFeedCache({ items: result.items, lastRefresh: new Date().toISOString(), errors: result.errors });
  if (silent && fresh.length) notify(byCat, lines);
  send('feeds:updated', { newCount: fresh.length, byCat: silent ? byCat : {} });
  prefetchArticles(result.items).catch(() => {});
  return { items: lean(result.items), newCount: fresh.length, byCat, errors: result.errors, ai: aiStatus, lastRefresh: new Date().toISOString() };
}

/* ---------- community ---------- */
async function runCommunity({ silent } = {}) {
  const content = loadContent();
  const settings = store.getSettings();
  const r = await community.fetchAll(content.communityFeeds || { sources: [] }, { enabled: false, channels: [] }, '', store.getCommunityCache());
  const apiKey = store.getApiKey();
  const todo = r.items.filter((i) => !i.pt).slice(0, 40);
  let engine = null;
  for (const it of todo) {
    try {
      const t = await translate.translateMany([it.title || '', it.text || ''], apiKey ? { apiKey, model: settings.aiModel } : null);
      if (t.engine !== 'nenhum') { it.pt = { title: t.texts[0], text: t.texts[1], engine: t.engine }; engine = t.engine; }
    } catch (_) { /* next run */ }
  }
  const data = { items: r.items, lastRefresh: new Date().toISOString(), errors: r.errors, status: r.status, engine };
  store.saveCommunityCache(data);
  const fresh = r.newItems.filter((n) => n.kind === 'reddit');
  if (silent && fresh.length) {
    const first = fresh[0];
    notify({ comunidade: fresh.length }, { comunidade: `${first.channel}: ${((first.pt && (first.pt.title || first.pt.text)) || first.title || first.text).slice(0, 120)}` });
  }
  send('community:updated', { newCount: fresh.length, byCat: silent && fresh.length ? { comunidade: fresh.length } : {} });
  return { ...data, newCount: fresh.length };
}

/* ---------- full articles ---------- */
function articleOpts() {
  const key = store.getApiKey();
  return key ? { apiKey: key, model: store.getSettings().aiModel } : null;
}

// The newest stories are fetched and translated in the background, so they open instantly
let prefetching = false;
async function prefetchArticles(items) {
  if (prefetching) return;
  prefetching = true;
  try {
    const todo = (items || [])
      .filter((it) => (it.sourceKind === 'wowhead' || it.content) && !(it.ai && it.ai.relevante === false) && !article.has(it.id))
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 8);
    for (const it of todo) {
      const r = await article.get(it, translate.translateLines, articleOpts());
      if (r.ok) send('article:ready', { id: it.id });
      await new Promise((res) => setTimeout(res, 800));
    }
  } finally { prefetching = false; }
}

/* ---------- leveling guide (Mobalytics) ---------- */
let guideTimer = null;
/** The guide panel's data; `needsPick` until the player has chosen which Mobalytics guide to follow */
function guideState(cls) {
  const picked = !!(cls && (store.getSettings().guidePick || {})[cls]);
  return { ...guide.get(cls), needsPick: !!cls && !picked };
}

async function runGuide({ silent } = {}) {
  const cls = currentClass();
  const pinned = (store.getSettings().guidePick || {})[cls] || null;
  const r = cls
    ? await guide.refresh({ cls, pinned, askFirst: !pinned, translateLines: translate.translateLines, translateMany: translate.translateMany, aiOpts: articleOpts() })
    : { ok: false, error: 'escolha a sua classe' };
  const notifyIt = silent && r.ok && r.changed && r.entry;
  if (notifyIt) {
    const b = r.entry.bullets || [];
    notify({ guia: 1 }, { guia: (b[0] || `O guia de leveling de ${r.author || 'Mobalytics'} mudou.`) + (b.length > 1 ? ` (+${b.length - 1})` : '') });
  }
  send('guide:updated', { cls, ok: r.ok, changed: !!r.changed, first: !!r.first, needsPick: !!r.needsPick, error: r.error || null, byCat: notifyIt ? { guia: 1 } : {} });
  return { ...guideState(cls), result: { ok: r.ok, changed: !!r.changed, first: !!r.first, needsPick: !!r.needsPick, error: r.error || null } };
}

/* ---------- new versions (GitHub Releases) ---------- */
let updateTimer = null;
let lastUpdate = null;
async function runUpdateCheck({ silent } = {}) {
  const content = loadContent();
  const repo = (content.meta && content.meta.updates && content.meta.updates.repo) || updater.DEFAULT_REPO;
  const r = await updater.check(repo);
  lastUpdate = r;
  if (r.ok && r.available) {
    const s = store.getSettings();
    if (silent && s.updateNotified !== r.latest) {
      notify({ update: 1 }, { update: `Versão ${r.latest} disponível (você está na ${r.current}). Abra o app para baixar.` });
      store.saveSettings({ updateNotified: r.latest });
    }
  }
  send('update:status', r);
  return r;
}

/* ---------- armory ---------- */
const ARMORY_FMT = 2; // v2 items carry weapon DPS, armor and school damage
let staleReadAt = 0;
function slotSignature(items) { return (items || []).map((i) => `${i.slot}:${i.id || i.name}`).sort().join('|'); }

async function runArmory({ silent } = {}) {
  let settings = store.getSettings();
  const creds = { id: settings.bnetClientId, secret: store.getSecret('bnetSecret') };
  const res = await armory.read(settings, creds);
  // Where the character stands in the render, so every race shows at the same size
  if (res.ok && res.media) await figure.annotate(res.media);
  // A search (link or name) that landed on one character: keep that character's own link from now on
  const relinked = !!(res.ok && res.resolved && res.resolved.url && res.resolved.url !== settings.armoryUrl);
  if (relinked) settings = store.saveSettings({ armoryUrl: res.resolved.url });
  const link = settings.armoryUrl;
  const ch = store.getCharacter();
  const prev = ch.armory || {};
  // A new link replaces the old data; a failed read keeps the last good one for the same link
  const sameLink = prev.url === link;
  const keep = sameLink ? prev.data || null : null;
  const data = res.ok
    ? { fmt: ARMORY_FMT, level: res.level, items: res.items, stats: res.stats, via: res.via, game: res.game, testMode: !!res.testMode, character: res.character, media: res.media || null, link: res.link || null, talents: res.talents || null, professions: res.professions || null }
    : keep;
  // The list of same-name characters stays at hand while the saved one is among them
  const matches = res.matches || (res.resolved && res.resolved.matches) || null;
  const search = matches ? { query: res.query || (res.resolved && res.resolved.query) || '', matches, at: res.at }
    : prev.search && (prev.search.matches || []).some((m) => m.url === link) ? prev.search : null;
  const { matches: _m, resolved: _r, ...rest } = res;
  const patch = { armory: { ...rest, url: link, search, relinked, lastOk: res.ok ? res.at : (sameLink ? prev.lastOk : null) || null, data } };
  // Retail characters are for testing only: they never drive the character's level
  if (res.ok && res.level && !res.testMode) patch.level = Math.min(60, res.level);
  const saved = store.saveCharacter(patch);
  const before = sameLink && prev.data;
  const changed = res.ok && before && slotSignature(before.items) !== slotSignature(res.items);
  const levelUp = res.ok && before && res.level && before.level && res.level > before.level;
  const notifyIt = silent && !res.testMode && (changed || levelUp);
  if (notifyIt) {
    let train = [];
    try { const gs = guideState(currentClass()); train = levelUp && !gs.needsPick ? guide.trainingAt(gs.guide, res.level) : []; } catch (_) { /* tip is optional */ }
    const who = (res.character && res.character.name) || 'Seu personagem';
    const list = train.length > 1 ? `${train.slice(0, -1).join(', ')} e ${train[train.length - 1]}` : train[0];
    notify({ armory: 1 }, { armory: levelUp
      ? `${who} chegou ao nível ${res.level}.${train.length ? ` Hora do instrutor: ${list}.` : ' Veja as melhorias de equipamento do nível.'}`
      : 'Equipamento novo detectado no Armory.' });
  }
  send('armory:updated', { ok: res.ok, changed: !!changed, levelUp: !!levelUp, byCat: notifyIt ? { armory: 1 } : {} });
  // A character of another class: read that class's guide
  const beforeCls = prev.data && prev.data.character && prev.data.character.clsSlug;
  const nowCls = res.ok && res.character && res.character.clsSlug;
  if (nowCls && nowCls !== beforeCls) setTimeout(() => runGuide({ silent: false }).catch(() => {}), 500);
  return saved;
}

function schedule() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (armoryTimer) clearInterval(armoryTimer);
  const s = store.getSettings();
  const minutes = Math.max(10, Number(s.refreshMinutes) || 30);
  refreshTimer = setInterval(() => {
    runRefresh({ silent: true }).catch(() => {});
    runCommunity({ silent: true }).catch(() => {});
  }, minutes * 60 * 1000);
  if (s.armoryUrl) {
    armoryTimer = setInterval(() => runArmory({ silent: true }).catch(() => {}), Math.max(15, Number(s.armoryMinutes) || 60) * 60 * 1000);
  }
  if (guideTimer) clearInterval(guideTimer);
  guideTimer = setInterval(() => runGuide({ silent: true }).catch(() => {}), Math.max(30, Number(s.guideMinutes) || 60) * 60 * 1000);
  if (updateTimer) clearInterval(updateTimer);
  updateTimer = setInterval(() => runUpdateCheck({ silent: true }).catch(() => {}), 6 * 3600 * 1000);
}

/* ---------- IPC ---------- */
ipcMain.handle('content:get', () => loadContent());
ipcMain.handle('items:get', () => loadItems());
ipcMain.handle('update:check', () => runUpdateCheck({ silent: false }));
/* ---------- starting with Windows ---------- */
ipcMain.handle('autostart:get', () => ({ ...launcher.autostartState(), wanted: store.getSettings().openAtLogin !== false }));
ipcMain.handle('autostart:set', (_e, on) => {
  store.saveSettings({ openAtLogin: !!on });
  return { ...launcher.setAutostart(!!on), wanted: !!on };
});

/* ---------- tips, ideas and bug reports → Google Form → private sheet ---------- */
function feedbackCfg() { return (loadContent().meta || {}).feedback || null; }
ipcMain.handle('feedback:info', () => ({ ready: feedback.configured(feedbackCfg()) }));
ipcMain.handle('feedback:send', (_e, p) => {
  const x = p && typeof p === 'object' ? p : {};
  let character = '';
  let details = '';
  if (x.includeChar) {
    const ch = store.getCharacter();
    const st = store.getSettings();
    const d = ch.armory && ch.armory.data;
    const c = (d && d.character) || {};
    const cls = currentClass();
    character = d ? [c.name, [c.cls, c.race].filter(Boolean).join(' '), d.level ? `nível ${d.level}` : '', c.realm, c.guild ? `<${c.guild}>` : ''].filter(Boolean).join(' · ')
      : [cls ? `classe ${cls}` : 'sem Armory', ch.level ? `nível ${ch.level}` : ''].filter(Boolean).join(' · ');
    const pick = cls && (st.guidePick || {})[cls];
    details = [
      `Armory: ${!st.armoryUrl ? 'não conectado' : ch.armory && ch.armory.ok ? 'ok' : `falhou (${(ch.armory && ch.armory.message) || 'sem detalhe'})`}`,
      `Guia: ${pick || 'não escolhido'}`,
      x.screen ? `Tela: ${String(x.screen).slice(0, 40)}` : ''
    ].filter(Boolean).join(' · ');
  }
  return feedback.send(feedbackCfg(), { type: x.type, message: x.message, contact: x.contact, character, details });
});
ipcMain.handle('update:last', () => lastUpdate);
// "Nova versão" in the title bar: reopen through the launcher, which shows what's new and updates
ipcMain.handle('update:apply', () => {
  const u = lastUpdate;
  if (launcher.restart()) { setTimeout(() => app.exit(0), 150); return { ok: true, restarting: true }; }
  if (u && (u.asset || u.url)) shell.openExternal((u.asset && u.asset.url) || u.url);
  return { ok: true, restarting: false };
});
ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, userData: app.getPath('userData'), packs: lastPacks }));
// The renderer gets the list without the full post HTML (that comes through article:get)
const lean = (items) => (items || []).map(({ content, ...rest }) => ({ ...rest, full: !!content || rest.sourceKind === 'wowhead' }));
ipcMain.handle('feeds:cache', () => { const c = store.getFeedCache(); return { ...c, items: lean(c.items) }; });
ipcMain.handle('feeds:refresh', () => runRefresh({ silent: false }));
ipcMain.handle('community:cache', () => store.getCommunityCache());
ipcMain.handle('community:refresh', () => runCommunity({ silent: false }));
ipcMain.handle('armory:refresh', () => runArmory({ silent: false }));
ipcMain.handle('settings:get', () => {
  const s = store.getSettings();
  return { ...s, hasApiKey: !!store.getApiKey(), hasBnetSecret: !!store.getSecret('bnetSecret') };
});
ipcMain.handle('settings:save', (_e, patch) => {
  patch = patch || {};
  for (const [field, secret] of [['apiKey', 'apiKey'], ['bnetSecret', 'bnetSecret']]) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) { store.setSecret(secret, patch[field] || ''); delete patch[field]; }
  }
  const before = currentClass();
  const saved = store.saveSettings(patch);
  schedule();
  // A class picked by hand (no Armory yet): load that class's guide
  if (currentClass() !== before) setTimeout(() => runGuide({ silent: false }).catch(() => {}), 200);
  return { ...saved, hasApiKey: !!store.getApiKey(), hasBnetSecret: !!store.getSecret('bnetSecret') };
});
ipcMain.handle('ai:test', async () => {
  const key = store.getApiKey();
  if (!key) return { ok: false, message: 'Nenhuma chave salva.' };
  try { await ai.ping({ apiKey: key, model: store.getSettings().aiModel }); return { ok: true, message: 'Conexão com a IA funcionando.' }; }
  catch (err) { return { ok: false, message: String(err.message || err) }; }
});
ipcMain.handle('guide:get', () => guideState(currentClass()));
ipcMain.handle('guide:refresh', () => runGuide({ silent: false }));
ipcMain.handle('guide:seen', (_e, id) => guide.markSeen(currentClass(), id));
ipcMain.handle('guide:pick', (_e, slug) => {
  const cls = currentClass();
  if (!cls) return guideState(null);
  const picks = { ...(store.getSettings().guidePick || {}) };
  if (slug) picks[cls] = String(slug); else delete picks[cls];
  store.saveSettings({ guidePick: picks });
  return runGuide({ silent: false });
});
ipcMain.handle('article:get', async (_e, id) => {
  const item = (store.getFeedCache().items || []).find((it) => it.id === id);
  if (!item) return { ok: false, message: 'notícia não encontrada' };
  return article.get(item, translate.translateLines, articleOpts());
});
ipcMain.handle('translate:texts', async (_e, texts) => {
  const s = store.getSettings();
  const key = store.getApiKey();
  return translate.translateMany((texts || []).map(String), key ? { apiKey: key, model: s.aiModel } : null);
});
ipcMain.handle('character:get', () => {
  const ch = store.getCharacter();
  // Data in the old v1 format (written by v1, perhaps still open in the tray) lacks weapon DPS and armor: read again
  const d = ch.armory && ch.armory.data;
  if (d && d.fmt !== ARMORY_FMT && store.getSettings().armoryUrl && Date.now() - staleReadAt > 5 * 60 * 1000) {
    staleReadAt = Date.now();
    setTimeout(() => runArmory({ silent: true }).catch(() => {}), 300);
  }
  return ch;
});
ipcMain.handle('character:save', (_e, patch) => store.saveCharacter(patch || {}));
ipcMain.handle('notify:show', (_e, { cat, body }) => { notify({ [cat]: 1 }, { [cat]: String(body || '') }); return true; });
ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text || '')); return true; });
ipcMain.handle('shell:open', (_e, url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return true; });
ipcMain.handle('shell:folder', (_e, dir) => {
  const allowed = new Set([...(lastPacks.folders || []), path.join(app.getPath('userData'), 'packs')]);
  if (!allowed.has(dir)) return false;
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
  return true;
});

/* ---------- lifecycle ---------- */
// One Grimório at a time: opening it again (or Windows starting it) brings the open window forward
const devShot = !app.isPackaged && !!(process.env.GRIMORIO_SHOT || process.env.GRIMORIO_SPLASH);
const firstInstance = devShot || app.requestSingleInstanceLock();
if (!firstInstance) app.quit();
app.on('second-instance', () => {
  if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); if (launchDone) win.show(); win.focus(); }
});

/** Starting with Windows: on by default, from the installed app */
async function applyAutostart() {
  if (!launcher.managed()) return;
  launcher.cleanupLooseCopies();
  launcher.setAutostart(store.getSettings().openAtLogin !== false);
}

app.whenReady().then(async () => {
  if (!firstInstance) return;
  if (isWin) app.setAppUserModelId('com.grimorio.aventureiro');

  createWindow();
  schedule();
  if (store.getSettings().armoryUrl) setTimeout(() => runArmory({ silent: false }).catch(() => {}), 4000);
  // The guide is checked a little after start-up, then on its own timer
  setTimeout(() => runGuide({ silent: true }).catch(() => {}), 9000);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

  if (devShot && !process.env.GRIMORIO_SPLASH) {
    launchDone = true;
  } else {
    const content = loadContent();
    const repo = (content.meta && content.meta.updates && content.meta.updates.repo) || updater.DEFAULT_REPO;
    let fake = null;
    if (devShot && process.env.GRIMORIO_SPLASH_STATE) { try { fake = JSON.parse(process.env.GRIMORIO_SPLASH_STATE); } catch (_) { fake = null; } }
    if (devShot) setTimeout(() => launcher.captureSplash(process.env.GRIMORIO_SPLASH).then(() => app.quit()), Number(process.env.GRIMORIO_WAIT || 2500));
    const go = await launcher.start({ repo, fake, onCheck: (r) => { lastUpdate = r; send('update:status', r); } });
    if (go === 'quit') { app.quit(); return; }
    launchDone = true;
  }
  maybeShow();
  setTimeout(() => applyAutostart().catch(() => {}), 8000);
  // The launcher already checked; the next check is on the 6-hour timer
  if (!lastUpdate) setTimeout(() => runUpdateCheck({ silent: true }).catch(() => {}), 15000);
});

app.on('window-all-closed', () => { if (!isMac) app.quit(); });

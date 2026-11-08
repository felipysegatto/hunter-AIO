'use strict';

// Content packs: small JSON files that update the Grimório's curated data without a new
// version of the app. The app looks in the "Dados" folder of the Google Drive copy
// (G:\Meu Drive\Grimório do Aventureiro\Dados, or the v1 folder name) and in its own user-data "packs" folder.
//
// Pack format (every key optional):
// { "pack": "grimorio", "date": "2026-11-10", "title": "…",
//   "news": [ curated news items ], "dossie": {…}, "milestones": [ … ],
//   "route": { "add": [ route entries ], "remove": [ ids ] } }
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DRIVE_NAMES = ['Meu Drive', 'My Drive'];
const FOLDERS = [path.join('Grimório do Aventureiro', 'Dados'), path.join('Grimório do BruxoMagic', 'Dados')];

function candidateFolders(custom) {
  const out = [];
  if (custom) out.push(custom);
  if (process.platform === 'win32') {
    for (let c = 67; c <= 90; c++) {
      const letter = String.fromCharCode(c) + ':\\';
      for (const d of DRIVE_NAMES) for (const f of FOLDERS) out.push(path.join(letter, d, f));
    }
  } else {
    const home = app.getPath('home');
    const cloud = path.join(home, 'Library', 'CloudStorage');
    try {
      for (const entry of fs.readdirSync(cloud)) if (/^GoogleDrive/i.test(entry)) for (const d of DRIVE_NAMES) for (const f of FOLDERS) out.push(path.join(cloud, entry, d, f));
    } catch (_) { /* no Google Drive on this Mac */ }
  }
  out.push(path.join(app.getPath('userData'), 'packs'));
  return out;
}

function readPacks(custom) {
  const packs = [];
  const folders = [];
  for (const dir of candidateFolders(custom)) {
    let files;
    try { files = fs.readdirSync(dir).filter((f) => /\.json$/i.test(f)); } catch (_) { continue; }
    folders.push(dir);
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\uFEFF/, ''));
        if (data && data.pack === 'grimorio') packs.push({ ...data, file: f, folder: dir });
      } catch (_) { packs.push({ file: f, folder: dir, broken: true }); }
    }
  }
  packs.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  return { packs, folders };
}

/** Applies packs (oldest first) on top of the bundled content and route. */
function apply(content, route, custom) {
  const { packs, folders } = readPacks(custom);
  const c = { ...content, news: [...(content.news || [])] };
  const r = { ...route, entries: [...(route.entries || [])] };
  const applied = [];
  for (const p of packs) {
    if (p.broken) { applied.push({ file: p.file, ok: false }); continue; }
    if (Array.isArray(p.news)) {
      const ids = new Set(p.news.map((n) => n.id));
      c.news = [...p.news, ...c.news.filter((n) => !ids.has(n.id))];
    }
    if (p.dossie) c.dossie = p.dossie;
    if (Array.isArray(p.milestones)) c.milestones = p.milestones;
    if (p.route) {
      const remove = new Set(p.route.remove || []);
      const add = p.route.add || [];
      const addIds = new Set(add.map((e) => e.id));
      r.entries = [...r.entries.filter((e) => !remove.has(e.id) && !addIds.has(e.id)), ...add.map((e) => ({ ...e, pack: p.date || p.file }))];
    }
    if (p.date && p.date > (c.meta.contentDate || '')) c.meta = { ...c.meta, contentDate: p.date };
    applied.push({ file: p.file, ok: true, date: p.date, title: p.title || '' });
  }
  return { content: c, route: r, packs: applied, folders };
}

module.exports = { apply, readPacks };

'use strict';

// Checks GitHub for a newer version of the app and tells the player where to download it.
// The versions live in a public repository (the code stays private), so no token is needed:
//   1. latest.json at the root of the repository (version, download link, notes) — how versions are published;
//   2. GitHub Releases (GET /repos/<owner>/<repo>/releases/latest), if a release is ever made by hand.
const { net, app } = require('electron');

const DEFAULT_REPO = 'teixeira-ux/grimorio-do-aventureiro-releases';

/** "v2.0.1" / "2.0.1-beta" → [2, 0, 1] */
function parse(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
}

function newer(a, b) {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i]; }
  return false;
}

async function fetchJson(url, plain) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const headers = plain ? { 'User-Agent': `GrimorioDoAventureiro/${app.getVersion()}`, 'Cache-Control': 'no-cache' }
      : { Accept: 'application/vnd.github+json', 'User-Agent': `GrimorioDoAventureiro/${app.getVersion()}`, 'X-GitHub-Api-Version': '2022-11-28' };
    const res = await net.fetch(url, { headers, signal: ctrl.signal });
    if (res.status === 404) return { missing: true };
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}

/**
 * Returns { ok, current, latest, available, url, asset, notes, publishedAt } or { ok: false, error }.
 * `asset` is the Windows .exe download link when the release carries one.
 */
/** "What's new" as a list of short lines (latest.json may carry a list or a text) */
function notesOf(n) {
  const list = Array.isArray(n) ? n : String(n || '').split(/\r?\n/);
  return list.map((x) => String(x).replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean).slice(0, 12).map((x) => x.slice(0, 300));
}

/** latest.json → the same shape as a release check, or null when the file is missing or broken */
async function fromManifest(r, current) {
  let m;
  try { m = await fetchJson(`https://raw.githubusercontent.com/${r}/main/latest.json?t=${Date.now()}`, true); } catch (_) { return null; }
  if (!m || m.missing || !parse(m.version)) return null;
  const page = /^https:\/\/github\.com\//.test(m.page || '') ? m.page : `https://github.com/${r}`;
  const dl = /^https:\/\/(github\.com|raw\.githubusercontent\.com)\//.test(m.download || '') ? m.download : null;
  return {
    ok: true,
    repo: r,
    current,
    latest: String(m.version).replace(/^v/i, ''),
    available: newer(m.version, current),
    url: page,
    asset: dl ? { name: m.file || dl.split('/').pop(), url: dl, size: m.size || null } : null,
    sha256: /^[0-9a-f]{64}$/i.test(m.sha256 || '') ? m.sha256.toLowerCase() : null,
    notes: (Array.isArray(m.notes) ? m.notes.join('\n') : String(m.notes || '')).slice(0, 2000),
    notesList: notesOf(m.notes),
    publishedAt: m.date || null,
    checkedAt: new Date().toISOString()
  };
}

async function check(repo) {
  // versao Hunter: atualizacao automatica desativada (evita trocar esta versao pela original)
  return { ok: true, current: app.getVersion(), repo: repo || DEFAULT_REPO, latest: app.getVersion(), available: false, notesList: [], checkedAt: new Date().toISOString() };
  const current = app.getVersion();
  const r = repo || DEFAULT_REPO;
  const manifest = await fromManifest(r, current);
  if (manifest) return manifest;
  try {
    const rel = await fetchJson(`https://api.github.com/repos/${r}/releases/latest`);
    if (rel.missing) return { ok: false, current, repo: r, error: 'nenhuma versão publicada ainda' };
    const latest = String(rel.tag_name || rel.name || '').replace(/^v/i, '');
    const exe = (rel.assets || []).find((a) => /\.exe$/i.test(a.name || ''));
    return {
      ok: true,
      repo: r,
      current,
      latest,
      available: newer(latest, current),
      url: rel.html_url || `https://github.com/${r}/releases/latest`,
      asset: exe ? { name: exe.name, url: exe.browser_download_url, size: exe.size } : null,
      notes: String(rel.body || '').slice(0, 2000),
      notesList: notesOf(String(rel.body || '').split(/\r?\n/).filter((l) => /^\s*[-*•]\s+/.test(l))),
      sha256: null,
      publishedAt: rel.published_at || null,
      checkedAt: new Date().toISOString()
    };
  } catch (e) {
    const m = String((e && e.message) || e);
    return { ok: false, current, repo: r, error: /abort/i.test(m) ? 'o GitHub demorou para responder' : /ENOTFOUND|ERR_INTERNET|fetch failed|ERR_NAME/i.test(m) ? 'sem conexão' : m.slice(0, 80) };
  }
}

module.exports = { check, newer, parse, notesOf, DEFAULT_REPO };

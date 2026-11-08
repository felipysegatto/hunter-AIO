'use strict';

// Leveling guides from Mobalytics (WoW Forever), one per class: for each class the app reads the
// class page (…/wow-forever/<class>-guides), takes the leveling guide with the most favorites
// (the platform's own score) and keeps a translated copy of it.
// The public guide page is server-rendered with the whole document as data
// (window.__PRELOADED_STATE__): sections of rich text, the talent order level by level,
// strengths and weaknesses, a walkthrough per level band and the author's changelog.
// The app keeps a translated copy, checks it on a timer and, when the guide changes,
// works out what changed and tells the player in a few lines.
const { net, app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { safeText, balance, cleanUrl } = require('./article');

const BASE = 'https://mobalytics.gg/wow-forever';
const CLASSES = ['warrior', 'paladin', 'hunter', 'rogue', 'priest', 'shaman', 'mage', 'warlock', 'druid'];
const CLASS_PT = { warrior: 'guerreiro', paladin: 'paladino', hunter: 'caçador', rogue: 'ladino', priest: 'sacerdote', shaman: 'xamã', mage: 'mago', warlock: 'bruxo', druid: 'druida' };
const guideUrl = (slug) => `${BASE}/classes/${slug}`;
const GUIDE_URL = guideUrl('hunter-leveling-guide');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36';

// Section titles in Portuguese (the guide's own titles stay available in EN mode)
const TITLE_PT = {
  'overview': 'Visão geral',
  'leveling spec': 'Especialização para upar',
  'strengths & weaknesses': 'Pontos fortes e fracos',
  'talents': 'Talentos',
  'gameplay & rotation': 'Jogabilidade e rotação',
  'level walkthrough': 'Passo a passo por nível',
  'stat priority': 'Prioridade de atributos',
  'consumables': 'Consumíveis',
  'professions': 'Profissões',
  'campfire buffs': 'Buffs de fogueira',
  'suggested races': 'Raças sugeridas',
  'demons': 'Demônios',
  'wand progression': 'Progressão de varinhas',
  'utility spells': 'Feitiços utilitários',
  'must have warlock macros': 'Macros essenciais de bruxo',
  'warlock leveling tips': 'Dicas para upar de bruxo',
  'spell power coefficients': 'Coeficientes de poder mágico',
  'warlock spell coefficients': 'Coeficientes dos feitiços do bruxo',
  'demon spell coefficients': 'Coeficientes dos feitiços dos demônios',
  'changelog': 'Histórico de mudanças do guia',
  'guide variants': 'Builds do guia',
  'gameplay': 'Jogabilidade',
  'rotation': 'Rotação',
  'races': 'Raças',
  'best races': 'Melhores raças',
  'useful addons, ui settings and macros': 'Addons, interface e macros úteis',
  'addons': 'Addons',
  'macros': 'Macros',
  'pets': 'Mascotes',
  'gear': 'Equipamento',
  'leveling tips': 'Dicas para upar',
  'tips': 'Dicas',
  'faq': 'Perguntas frequentes',
  'introduction': 'Introdução'
};
const titlePt = (t) => TITLE_PT[String(t || '').trim().toLowerCase()] || null;

// Widgets that carry no tips
const SKIP = /Comments|TableOfContent|DocumentsFeed|VideoAd|Header|BannerTakeover/;

/* ---------- reading the page ---------- */
async function fetchPage(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await net.fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html' }, signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally { clearTimeout(timer); }
}

function extractState(html) {
  const at = html.indexOf('window.__PRELOADED_STATE__=');
  if (at < 0) throw new Error('a página do guia mudou de formato');
  const start = html.indexOf('{', at);
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return JSON.parse(html.slice(start, i + 1)); }
  }
  throw new Error('não deu para ler os dados do guia');
}

function findDocument(state) {
  const queries = (((state || {}).wowforState || {}).apollo || {}).graphqlV2 || {};
  for (const q of queries.queries || []) {
    const data = q.state && q.state.data;
    for (const d of [].concat(data || [])) {
      const doc = d && d.game && d.game.documents && d.game.documents.userGeneratedDocumentBySlug && d.game.documents.userGeneratedDocumentBySlug.data;
      if (doc && Array.isArray(doc.content)) return doc;
    }
  }
  throw new Error('o guia não veio na página');
}

/* ---------- rich text (Lexical JSON) → blocks ---------- */
const iconName = (url) => {
  const m = String(url || '').match(/\/([a-z0-9_-]+)\.(?:webp|png|jpg)$/i);
  return m ? m[1].toLowerCase() : null;
};

function makeCtx() { return { refs: [], refIndex: new Map(), links: [], tseq: 0, qseq: 0 }; }

function inlineOf(nodes, ctx) {
  let out = '';
  for (const n of nodes || []) {
    if (!n || typeof n !== 'object') continue;
    if (n.type === 'text') {
      let t = safeText(n.text || '');
      if (!t) continue;
      if (n.format & 2) t = `<i>${t}</i>`;
      if (n.format & 1) t = `<b>${t}</b>`;
      out += t;
    } else if (n.type === 'static-data-widget') {
      const name = String(n.label || '').trim();
      if (!name) continue;
      const key = (n.groupId || '') + ':' + (n.id || name);
      let k = ctx.refIndex.get(key);
      if (!k) { k = ctx.refs.push({ type: n.groupId || 'ref', id: n.id || '', name, icon: iconName(n.icon) }); ctx.refIndex.set(key, k); }
      out += `[[${k}]]`;
    } else if (n.type === 'link') {
      const u = cleanUrl(n.url && n.url.startsWith('/') ? 'https://mobalytics.gg' + n.url : n.url);
      const inner = inlineOf(n.children, ctx);
      if (u) { const k = ctx.links.push(u); out += `<a${k}>${inner}</a${k}>`; } else out += inner;
    } else if (n.type === 'linebreak' || n.type === 'tab') {
      out += ' ';
    } else if (Array.isArray(n.children)) {
      out += inlineOf(n.children, ctx);
    }
  }
  return out;
}

const clean = (s) => balance(String(s).replace(/\s+/g, ' ').trim());
const visible = (s) => s.replace(/<\/?(?:b|i|a\d+)>/g, '').trim();

function blocksOf(root, ctx, out, depth, ordered, q) {
  out = out || [];
  const push = (b) => { if (b.text != null) { b.text = clean(b.text); if (!visible(b.text)) return; } if (q) b.q = q; out.push(b); };
  for (const n of (root && root.children) || []) {
    if (!n || typeof n !== 'object') continue;
    switch (n.type) {
      case 'paragraph': push({ t: 'p', text: inlineOf(n.children, ctx) }); break;
      case 'heading': {
        const lv = { h1: 2, h2: 2, h3: 3 }[n.tag] || 4;
        push({ t: 'h', level: lv, text: inlineOf(n.children, ctx) });
        break;
      }
      case 'list': blocksOf(n, ctx, out, (depth || 0) + 1, n.listType === 'number', q); break;
      case 'listitem': {
        const own = (n.children || []).filter((c) => c.type !== 'list');
        const nested = (n.children || []).filter((c) => c.type === 'list');
        push({ t: 'li', depth: Math.min(4, Math.max(1, depth || 1) + (n.indent || 0)), ordered: !!ordered, text: inlineOf(own, ctx) });
        nested.forEach((l) => blocksOf({ children: [l] }, ctx, out, depth || 1, ordered, q));
        break;
      }
      case 'quote': { const id = ++ctx.qseq; blocksOf(n, ctx, out, depth, ordered, id); break; }
      case 'table': {
        const id = ++ctx.tseq;
        (n.children || []).forEach((row, r) => (row.children || []).forEach((cell) => {
          push({ t: 'td', table: id, row: r, th: (cell.headerState || 0) > 0, text: inlineOf(cell.children, ctx) });
        }));
        break;
      }
      default:
        if (Array.isArray(n.children)) blocksOf(n, ctx, out, depth, ordered, q);
    }
  }
  return out;
}

const lexical = (v, ctx) => {
  const root = v && (v.root || (v.value && v.value.root));
  return root ? blocksOf(root, ctx, []) : [];
};

/* ---------- talents: order level by level ---------- */
function talentIndex(doc) {
  const idx = {};
  for (const v of (doc.data && doc.data.buildVariants && doc.data.buildVariants.values) || []) {
    for (const b of (v.talentTree && v.talentTree.branches) || []) {
      for (const g of (b.branch && b.branch.grid) || []) {
        if (g.talent && g.talent.id) idx[g.talent.id] = { name: g.talent.name, icon: iconName(g.talent.iconUrl), max: Number(g.talent.maxRank) || 1, tree: b.branch.name };
      }
    }
  }
  return idx;
}

function talentsFor(doc, variantId, idx) {
  // The same id can appear twice: prefer the one that carries the leveling path
  const all = ((doc.data && doc.data.buildVariants && doc.data.buildVariants.values) || []).filter((v) => String(v.id) === String(variantId));
  const v = all.find((x) => x.talentTree && Array.isArray(x.talentTree.levelingPath) && x.talentTree.levelingPath.length) || all[0];
  if (!v || !v.talentTree) return null;
  const points = {};
  for (const b of v.talentTree.branches || []) points[b.branch.name] = (b.talents || []).reduce((n, t) => n + (Number(t.rank) || 0), 0);
  // The finished build (level 60): every talent of each tree with its position and chosen rank
  const trees = (v.talentTree.branches || []).map((b) => {
    const chosen = {};
    (b.talents || []).forEach((t) => { if (t.talent && t.talent.id) chosen[t.talent.id] = Number(t.rank) || 0; });
    return {
      name: b.branch && b.branch.name,
      icon: iconName(b.branch && b.branch.iconUrl),
      talents: ((b.branch && b.branch.grid) || []).filter((g) => g.talent).map((g) => ({
        name: g.talent.name, icon: iconName(g.talent.iconUrl), row: Number(g.row) || 1, col: Number(g.column) || 1,
        max: Number(g.talent.maxRank) || 1, rank: chosen[g.talent.id] || 0
      }))
    };
  });
  const ranks = {};
  const path = (v.talentTree.levelingPath || []).map((p, i) => {
    const t = idx[p.id] || { name: p.slug, icon: null, max: 1, tree: '' };
    ranks[p.id] = (ranks[p.id] || 0) + 1;
    return { level: 10 + i, id: p.id, name: t.name, icon: t.icon, rank: ranks[p.id], max: t.max, tree: t.tree };
  });
  return { points, path, trees };
}

/* ---------- the guide model ---------- */
function build(doc, url) {
  const ctx = makeCtx();
  const byId = Object.fromEntries(doc.content.map((n) => [n.id, n]));
  const idx = talentIndex(doc);
  const sections = [];

  const partOf = (n, variantId) => {
    const d = n.data || {};
    const type = n.__typename || '';
    if (/StrengthsAndWeaknesses/.test(type)) {
      return { id: n.id, kind: 'sw', title: d.title || 'Strengths & Weaknesses', strengths: lexical(d.strengths && d.strengths.value, ctx), weaknesses: lexical(d.weaknesses && d.weaknesses.value, ctx) };
    }
    if (/SkillTree/.test(type)) {
      return { id: n.id, kind: 'talents', title: d.title || 'Talents', talents: talentsFor(doc, variantId, idx) };
    }
    const blocks = lexical(d.contentV2 || (d.simplifiedContent && d.simplifiedContent.value) || (d.optionalDescriptionV2 && d.optionalDescriptionV2.value), ctx);
    return blocks.length ? { id: n.id, kind: 'text', title: d.title || '', blocks } : null;
  };

  const visit = (id) => {
    const n = byId[id];
    if (!n) return;
    const type = n.__typename || '';
    const d = n.data || {};
    if (/Section/.test(type)) { (d.childrenIds || []).forEach(visit); return; }
    if (SKIP.test(type)) return;
    if (/ContentVariants/.test(type)) {
      const variants = (d.childrenVariants || []).map((v) => ({
        id: String(v.id), title: v.title || '',
        blocks: lexical(v.description, ctx),
        parts: (v.childrenIds || []).map((cid) => byId[cid] && partOf(byId[cid], v.id)).filter(Boolean)
      }));
      sections.push({ id: n.id, kind: 'variants', title: d.title || '', variants });
      return;
    }
    if (/Video/.test(type)) { if (d.videoUrl) sections.push({ id: n.id, kind: 'video', title: d.title || 'Video', url: d.videoUrl }); return; }
    const p = partOf(n);
    if (p) sections.push({ ...p, kind: p.kind === 'text' ? 'text' : p.kind });
  };
  visit('root');

  const author = doc.author && (doc.author.name || (doc.author.user && doc.author.user.displayName));
  return {
    url: url || GUIDE_URL,
    title: (doc.data && doc.data.name) || 'Leveling Guide',
    favorites: (doc.favorites && Number(doc.favorites.favoritesCount)) || null,
    author: author || 'Mobalytics',
    updatedAt: doc.updatedAt || null,
    version: doc.version || null,
    sections,
    refs: ctx.refs,
    links: ctx.links
  };
}

/* ---------- walking every text of the guide ---------- */
function eachBlockList(guide, fn) {
  for (const s of guide.sections) {
    if (s.blocks) fn(s.blocks, s, null, null);
    if (s.strengths) fn(s.strengths, s, null, 'strengths');
    if (s.weaknesses) fn(s.weaknesses, s, null, 'weaknesses');
    for (const v of s.variants || []) {
      fn(v.blocks, s, v, null);
      for (const p of v.parts || []) {
        if (p.blocks) fn(p.blocks, s, v, p);
        if (p.strengths) fn(p.strengths, s, v, p);
        if (p.weaknesses) fn(p.weaknesses, s, v, p);
      }
    }
  }
}

const plain = (t) => String(t || '').replace(/<[^>]+>/g, '').replace(/\[\[\d+\]\]/g, '§').replace(/\s+/g, ' ').trim();
// Ref markers become the spell name so a diff reads naturally
const readable = (t, refs) => String(t || '').replace(/\[\[(\d+)\]\]/g, (m, k) => (refs[k - 1] && refs[k - 1].name) || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/* ---------- snapshots and change detection ---------- */
function snapshot(guide) {
  const units = {};
  const add = (key, title, lines) => { const u = units[key] || (units[key] = { title, lines: [] }); u.lines.push(...lines); };
  eachBlockList(guide, (blocks, s, v, p) => {
    const key = [s.id, v && v.id, p && p.id].filter(Boolean).join(':');
    const title = [titlePt(s.title) || s.title, v && v.title, p && (titlePt(p.title) || p.title)].filter(Boolean).join(' · ');
    add(key, title, blocks.filter((b) => b.text).map((b) => readable(b.text, guide.refs)).filter(Boolean));
  });
  const talents = {};
  for (const s of guide.sections) for (const v of s.variants || []) for (const p of v.parts || []) {
    if (p.talents && p.talents.path.length) talents[v.id] = { title: v.title, path: p.talents.path.map((x) => x.name) };
  }
  const changelog = (units[(guide.sections.find((s) => /changelog/i.test(s.title)) || {}).id] || {}).lines || [];
  return { version: guide.version, updatedAt: guide.updatedAt, units, talents, changelog };
}

function diff(prev, next) {
  const changes = [];
  for (const [key, u] of Object.entries(next.units)) {
    const old = prev.units[key];
    if (!old) { if (u.lines.length) changes.push({ kind: 'added', title: u.title, added: u.lines.slice(0, 6), removed: [] }); continue; }
    const before = new Set(old.lines);
    const after = new Set(u.lines);
    const added = u.lines.filter((l) => !before.has(l));
    const removed = old.lines.filter((l) => !after.has(l));
    if (added.length || removed.length) changes.push({ kind: 'changed', title: u.title, added: added.slice(0, 6), removed: removed.slice(0, 6) });
  }
  for (const [key, u] of Object.entries(prev.units)) if (!next.units[key] && u.lines.length) changes.push({ kind: 'removed', title: u.title, added: [], removed: [] });
  const talents = [];
  for (const [id, t] of Object.entries(next.talents)) {
    const old = prev.talents[id];
    if (!old) continue;
    const i = t.path.findIndex((name, j) => name !== old.path[j]);
    if (i >= 0 || t.path.length !== old.path.length) {
      const at = i >= 0 ? i : Math.min(t.path.length, old.path.length);
      talents.push({ title: t.title, level: 10 + at, from: old.path[at] || '—', to: t.path[at] || '—' });
    }
  }
  const oldLog = new Set(prev.changelog);
  const changelog = next.changelog.filter((l) => !oldLog.has(l));
  return { changes: changes.filter((c) => !/changelog|histórico/i.test(c.title)), talents, changelog };
}

const hasChanges = (d) => !!(d.changes.length || d.talents.length || d.changelog.length);

/* ---------- the short "what changed" text ---------- */
async function summarize(d, translateMany, aiOpts, cls) {
  if (aiOpts && aiOpts.apiKey) {
    try { return await summarizeAI(d, aiOpts, cls); } catch (_) { /* falls back to the plain summary */ }
  }
  const bullets = [];
  const toPt = async (lines) => {
    if (!lines.length) return [];
    try { const r = await translateMany(lines, null); return r.texts; } catch (_) { return lines; }
  };
  const log = await toPt(d.changelog.slice(0, 2).map((l) => l.slice(0, 220)));
  log.forEach((l) => bullets.push('Nota do autor: ' + l));
  d.talents.slice(0, 2).forEach((t) => bullets.push(`Talentos de ${t.title}: mudou a partir do nível ${t.level} (${t.from} → ${t.to}).`));
  if (d.changes.length) {
    const names = [...new Set(d.changes.map((c) => c.title))];
    bullets.push(`${names.length === 1 ? 'Seção revisada' : 'Seções revisadas'}: ${names.slice(0, 5).join('; ')}${names.length > 5 ? ` e mais ${names.length - 5}` : ''}.`);
    const first = d.changes.find((c) => c.added.length);
    if (first) {
      const [pt] = await toPt([first.added[0].slice(0, 220)]);
      bullets.push(`Novo em ${first.title}: ${pt}`);
    }
  }
  return bullets.slice(0, 4);
}

async function summarizeAI(d, { apiKey, model }, cls) {
  const payload = {
    notas_do_autor: d.changelog.slice(0, 5),
    talentos: d.talents,
    secoes: d.changes.slice(0, 12).map((c) => ({ secao: c.title, tipo: c.kind, entrou: c.added.slice(0, 4), saiu: c.removed.slice(0, 4) }))
  };
  const res = await net.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: model || 'claude-haiku-5-5',
      max_tokens: 700,
      system: `Você resume, para um jogador brasileiro de ${CLASS_PT[cls] || 'qualquer classe'} no WoW Forever, o que mudou num guia de leveling. Escreva em português do Brasil, direto e prático, mantendo em inglês nomes de feitiços, talentos e especializações. Responda SOMENTE com um array JSON de 1 a 4 frases curtas (até 160 caracteres cada), da mais importante para a menos importante.`,
      messages: [{ role: 'user', content: JSON.stringify(payload).slice(0, 9000) }]
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || 'HTTP ' + res.status);
  const raw = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const arr = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
  if (!Array.isArray(arr) || !arr.length) throw new Error('resumo vazio');
  return arr.slice(0, 4).map(String);
}

/* ---------- translation of the whole guide ---------- */
async function translate(guide, translateLines, opts) {
  const lists = [];
  eachBlockList(guide, (blocks) => lists.push(blocks));
  const blocks = lists.flat().filter((b) => b.text);
  const r = await translateLines(blocks.map((b) => b.text), opts);
  blocks.forEach((b, i) => { if (r.texts[i] && r.texts[i] !== b.text) b.pt = r.texts[i]; });
  for (const s of guide.sections) {
    s.titlePt = titlePt(s.title);
    for (const v of s.variants || []) for (const p of v.parts || []) p.titlePt = titlePt(p.title);
  }
  return r.engine;
}

/* ---------- level plan: what to train, skip and run, level by level ---------- */
// Read from the walkthrough ("Spells to Train", "Spells to skip", "Dungeons while Leveling").
// Works on the stored blocks, so a guide saved by an older version gets it too.
const flat = (t) => String(t || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const SPEC_NAMES = 'Arms|Fury|Protection|Holy|Retribution|Beast Mastery|Marksmanship|Survival|Assassination|Combat|Subtlety|Discipline|Shadow|Elemental|Enhancement|Restoration|Arcane|Fire|Frost|Affliction|Demonology|Destruction|Balance|Feral';
const SPEC_ONLY = new RegExp('\\((?:[^)]*\\b)?(' + SPEC_NAMES + ')\\b[^)]*only\\)', 'i');

function planOf(guide) {
  const walk = guide && (guide.sections || []).find((s) => /walkthrough/i.test(s.title));
  if (!walk) return null;
  const bands = [];
  for (const v of walk.variants || []) {
    const m = String(v.title).match(/(\d+)\s*[-–]\s*(\d+)/);
    const band = { id: v.id, title: v.title, from: m ? Number(m[1]) : null, to: m ? Number(m[2]) : null, tip: null, train: [], skip: [], dungeons: [], trainNote: null, skipNote: null };
    let mode = null;
    let group = null;
    for (const b of v.blocks || []) {
      const en = flat(b.text);
      if (b.t === 'h') {
        mode = /spells? to train/i.test(en) ? 'train' : /spells? to skip/i.test(en) ? 'skip' : /dungeon/i.test(en) ? 'dungeons' : null;
        group = null;
        continue;
      }
      if (b.t === 'p') {
        if (!mode) { if (!band.tip) band.tip = { text: b.text, pt: b.pt || null }; } else if (mode === 'train' && !band.trainNote) band.trainNote = { text: b.text, pt: b.pt || null }; else if (mode === 'skip' && !band.skipNote) band.skipNote = { text: b.text, pt: b.pt || null };
        continue;
      }
      if (b.t !== 'li' || !mode) continue;
      if (mode === 'dungeons') {
        const d = en.match(/^Levels?\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*:?\s*(.+)$/i);
        if (!d) continue;
        let name = d[3].trim();
        let only = null;
        let note = null;
        const f = name.match(/\(\s*(Horde|Alliance)\s+only\s*\)/i);
        if (f) { only = /horde/i.test(f[1]) ? 'HORDE' : 'ALLIANCE'; name = name.replace(f[0], '').trim(); }
        const n = name.match(/\(([^)]+)\)\s*$/);
        if (n) { note = n[1].trim(); name = name.replace(n[0], '').trim(); }
        band.dungeons.push({ from: Number(d[1]), to: Number(d[2] || d[1]), name, only, note });
        continue;
      }
      const lv = en.match(/^Level\s*(\d+)\s*:?$/i);
      if (lv) { group = { level: Number(lv[1]), items: [] }; band[mode].push(group); continue; }
      if (!group) continue;
      const refs = [...String(b.text).matchAll(/\[\[(\d+)\]\]/g)].map((x) => Number(x[1]));
      const rank = (en.match(/Rank\s*(\d+)/i) || [])[1];
      const ref = refs[0] && guide.refs[refs[0] - 1];
      group.items.push({
        text: b.text, pt: b.pt || null, ref: refs[0] || null, rank: rank ? Number(rank) : null,
        name: ref ? ref.name : en.replace(/\s*\(.*$/, '').trim(),
        only: (readable(b.text, guide.refs).match(SPEC_ONLY) || [])[1] || null,
        pvp: /pvp only/i.test(en)
      });
    }
    if (band.tip || band.train.length || band.skip.length || band.dungeons.length) bands.push(band);
  }
  return bands.length ? { bands } : null;
}

/** "Curse of Recklessness, Drain Life e Corruption (Rank 2)": what the guide says to train at exactly this level */
function trainingAt(guide, lvl) {
  const plan = planOf(guide);
  if (!plan) return [];
  const group = plan.bands.flatMap((b) => b.train).find((x) => x.level === lvl);
  return group ? group.items.map((it) => `${it.name}${it.rank && it.rank > 1 ? ` (Rank ${it.rank})` : ''}`) : [];
}

/* ---------- which guide: the class page, ranked by favorites ---------- */
const authorOf = (x) => (x.author && (x.author.name || (x.author.user && x.author.user.displayName))) || '';

/** Guides listed on a class page, with their favorites count (the platform's score) */
function discoveryOf(state, cls) {
  const out = [];
  const seen = new Set();
  const walk = (x, d) => {
    if (!x || typeof x !== 'object' || d > 26) return;
    if (Array.isArray(x)) { x.forEach((v) => walk(v, d + 1)); return; }
    if (x.favorites && typeof x.favorites.favoritesCount === 'number' && (x.featured || x.slugifiedName)) {
      const tags = (x.tags && x.tags.data) || [];
      const clsTag = tags.find((t) => t && t.groupSlug === 'class');
      const slug = (x.featured && x.featured.slug) || x.slugifiedName;
      const name = (x.data && x.data.name) || '';
      if (x.type === 'classes' && clsTag && clsTag.slug === cls && slug && !seen.has(slug)) {
        seen.add(slug);
        const has = (group, rx) => tags.some((t) => t && t.groupSlug === group && rx.test(t.slug || ''));
        const pvp = has('build-type', /pvp/) || has('activity-type', /pvp/);
        out.push({
          slug, name, author: authorOf(x), favorites: x.favorites.favoritesCount, updatedAt: x.updatedAt || null,
          specs: tags.filter((t) => t && t.groupSlug === 'specialization').map((t) => String(t.slug || '').replace(new RegExp('-' + cls + '$'), '')),
          leveling: !pvp && (has('build-type', /leveling/) || /leveling/i.test(name) || /leveling/i.test(slug))
        });
      }
      return;
    }
    for (const k of Object.keys(x)) walk(x[k], d + 1);
  };
  walk(state, 0);
  return out;
}

async function discover(cls) {
  const docs = discoveryOf(extractState(await fetchPage(`${BASE}/${cls}-guides`)), cls);
  return docs.filter((d) => d.leveling).sort((a, b) => b.favorites - a.favorites);
}

/* ---------- storage: one guide per class ---------- */
const FILE = () => path.join(app.getPath('userData'), 'guides.json');
const OLD_FILE = () => path.join(app.getPath('userData'), 'guide.json');
function loadAll() {
  try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch (_) { /* first run of v2 */ }
  const all = { byClass: {} };
  // v1 kept a single warlock guide (Crix)
  try {
    const old = JSON.parse(fs.readFileSync(OLD_FILE(), 'utf8'));
    if (old && old.guide) all.byClass.warlock = { ...old, pick: { slug: 'warlock-leveling-guide', name: old.guide.title, author: old.guide.author, favorites: null } };
  } catch (_) { /* nothing to carry over */ }
  return all;
}
function saveAll(data) { try { const tmp = FILE() + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, FILE()); } catch (_) { /* best effort */ } }
const blank = () => ({ guide: null, snapshot: null, history: [], checkedAt: null, error: null, pick: null, options: null, discoveredAt: null });
function load(cls) { return { ...blank(), ...((loadAll().byClass || {})[cls] || {}) }; }
function save(cls, data) { const all = loadAll(); all.byClass = all.byClass || {}; all.byClass[cls] = data; saveAll(all); }

function friendly(e) {
  const m = String((e && e.message) || e || '');
  if (/abort/i.test(m)) return 'a Mobalytics demorou demais para responder';
  if (/HTTP 40[13]/.test(m)) return 'a Mobalytics recusou a leitura agora';
  if (/HTTP 404/.test(m)) return 'o guia saiu do endereço de sempre';
  if (/HTTP 5\d\d/.test(m)) return 'a Mobalytics está fora do ar';
  if (/ERR_INTERNET_DISCONNECTED|ENOTFOUND|fetch failed|ERR_NAME|ERR_TUNNEL|ERR_PROXY|ERR_CONNECTION|ERR_NETWORK/i.test(m)) return 'sem conexão';
  return m.slice(0, 90);
}

const running = {};
const DISCOVER_EVERY = 12 * 3600 * 1000;

/**
 * Checks the class's guide. Returns { ok, changed, first, entry, error } and keeps the translated
 * guide, a snapshot for the next comparison and a history of "what changed" entries.
 * `pinned` is a guide slug the player chose over the most favorited one.
 */
function refresh({ cls, pinned, askFirst, translateLines, translateMany, aiOpts }) {
  if (!CLASSES.includes(cls)) return Promise.resolve({ ok: false, error: 'escolha a sua classe' });
  if (running[cls]) return running[cls];
  running[cls] = (async () => {
    const store = load(cls);
    const checkedAt = new Date().toISOString();
    try {
      if (!store.options || !store.options.length || !store.discoveredAt || Date.now() - Date.parse(store.discoveredAt) > DISCOVER_EVERY || (pinned && !store.options.some((o) => o.slug === pinned))) {
        try {
          const found = await discover(cls);
          if (found.length) { store.options = found.slice(0, 8); store.discoveredAt = checkedAt; }
        } catch (e) {
          // keep the last list; the default address still works
          if (askFirst && !(store.options && store.options.length)) throw e;
        }
      }
      // The player picks the guide before the app reads one: stop at the list
      if (askFirst) {
        save(cls, { ...store, checkedAt, error: null });
        return { ok: true, changed: false, first: false, needsPick: true };
      }
      const options = store.options && store.options.length ? store.options : [{ slug: `${cls}-leveling-guide`, name: '', author: '', favorites: null }];
      const pick = options.find((o) => o.slug === pinned) || options[0];
      if (store.pick && store.pick.slug !== pick.slug) {
        // Another guide now: start over, without calling the swap a "change"
        Object.assign(store, { guide: null, snapshot: null, history: [], fingerprint: null });
      }
      const url = guideUrl(pick.slug);
      const doc = findDocument(extractState(await fetchPage(url)));
      const favorites = (doc.favorites && Number(doc.favorites.favoritesCount)) || pick.favorites || null;
      store.pick = { ...pick, favorites, author: authorOf(doc) || pick.author, name: (doc.data && doc.data.name) || pick.name };
      const fingerprint = crypto.createHash('sha1').update(JSON.stringify(doc.content) + JSON.stringify(doc.data && doc.data.buildVariants)).digest('hex');
      if (store.guide && store.fingerprint === fingerprint && store.guide.v === MODEL) {
        store.guide.favorites = favorites;
        save(cls, { ...store, checkedAt, error: null });
        return { ok: true, changed: false, first: false };
      }
      const guide = build(doc, url);
      guide.v = MODEL;
      guide.cls = cls;
      guide.engine = await translate(guide, translateLines, aiOpts);
      const snap = snapshot(guide);
      let entry = null;
      const first = !store.snapshot;
      if (!first) {
        const d = diff(store.snapshot, snap);
        if (hasChanges(d)) {
          entry = {
            id: crypto.randomBytes(5).toString('hex'), at: checkedAt, from: store.snapshot.version, to: snap.version,
            updatedAt: guide.updatedAt, bullets: await summarize(d, translateMany, aiOpts, cls), sections: [...new Set(d.changes.map((c) => c.title))].slice(0, 12), seen: false
          };
        }
      }
      const history = entry ? [entry, ...(store.history || [])].slice(0, 20) : (store.history || []);
      save(cls, { ...store, guide, snapshot: snap, fingerprint, history, checkedAt, error: null });
      return { ok: true, changed: !!entry, first, entry, author: guide.author };
    } catch (e) {
      save(cls, { ...store, checkedAt, error: friendly(e) });
      return { ok: false, error: friendly(e) };
    } finally {
      delete running[cls];
    }
  })();
  return running[cls];
}

const MODEL = 3; // 3: one guide per class, tree icons

function get(cls) {
  const s = load(cls);
  let plan = null;
  try { plan = planOf(s.guide); } catch (_) { /* the plan is a bonus: the guide still shows */ }
  return { cls: cls || null, guide: s.guide, plan, history: s.history || [], checkedAt: s.checkedAt, error: s.error, pick: s.pick, options: s.options || [] };
}

function markSeen(cls, id) {
  const s = load(cls);
  (s.history || []).forEach((h) => { if (!id || h.id === id) h.seen = true; });
  save(cls, s);
  return get(cls);
}

module.exports = { refresh, get, markSeen, GUIDE_URL, CLASSES, build, snapshot, diff, extractState, findDocument, discoveryOf, planOf, trainingAt };

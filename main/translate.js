'use strict';

// English → Brazilian Portuguese for news and community messages.
// With the user's Claude key: Claude translates (better with game terms).
// Without a key: Google's free web endpoint, then MyMemory as a fallback.
// Every translation is cached on disk so each text is translated once.
const { net, app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CACHE_FILE = () => path.join(app.getPath('userData'), 'translations.json');
let cache = null;

function loadCache() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE(), 'utf8')); } catch (_) { cache = {}; }
  return cache;
}
function saveCache() {
  const keys = Object.keys(cache);
  if (keys.length > 15000) keys.slice(0, keys.length - 15000).forEach((k) => delete cache[k]);
  try {
    const tmp = CACHE_FILE() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache));
    fs.renameSync(tmp, CACHE_FILE());
  } catch (_) { /* cache is best effort */ }
}
const keyOf = (t) => crypto.createHash('sha1').update(t).digest('hex').slice(0, 20);

// Texts that already read as Portuguese are left alone
function looksPortuguese(t) {
  return /[ãõçáéíóúâê]/i.test(t) && /\b(que|não|para|com|uma|você|está)\b/i.test(t);
}

async function fetchJson(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 12000);
  try {
    const res = await net.fetch(url, { ...(opts || {}), signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}

async function google(text) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=pt-BR&dt=t&q=' + encodeURIComponent(text);
  const data = await fetchJson(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  return (data[0] || []).map((seg) => seg[0]).join('');
}

async function myMemory(text) {
  const url = 'https://api.mymemory.translated.net/get?langpair=en|pt-BR&q=' + encodeURIComponent(text.slice(0, 480));
  const data = await fetchJson(url);
  const out = data && data.responseData && data.responseData.translatedText;
  if (!out || /MYMEMORY WARNING/i.test(out)) throw new Error('MyMemory sem resposta');
  return out;
}

async function machine(text) {
  // Long texts go in pieces so the free endpoints accept them
  const parts = [];
  let rest = text;
  while (rest.length > 1400) {
    let cut = rest.lastIndexOf('. ', 1400);
    if (cut < 400) cut = 1400;
    parts.push(rest.slice(0, cut + 1));
    rest = rest.slice(cut + 1);
  }
  parts.push(rest);
  const out = [];
  for (const p of parts) {
    try { out.push(await google(p)); } catch (_) { out.push(await myMemory(p)); }
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

const SYSTEM = 'Traduza cada texto para português do Brasil, natural e direto, como um jogador brasileiro escreveria. Mantenha em inglês nomes de feitiços, talentos, itens, masmorras, zonas e NPCs de World of Warcraft. Mantenha gírias de jogo conhecidas (DPS, tank, aggro, pull, nerf, buff). Responda SOMENTE com um array JSON de strings, na mesma ordem e quantidade.';

async function claude(texts, { apiKey, model }) {
  const res = await net.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: model || 'claude-haiku-5-5', max_tokens: 4000, system: SYSTEM, messages: [{ role: 'user', content: JSON.stringify(texts) }] })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || 'HTTP ' + res.status);
  const raw = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const arr = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
  if (!Array.isArray(arr) || arr.length !== texts.length) throw new Error('Tradução incompleta');
  return arr.map(String);
}

/**
 * Translates a list of texts. Returns { texts: [...], engine } where engine is
 * 'claude', 'google' or 'cache'. Untranslatable entries come back unchanged.
 */
async function translateMany(texts, opts) {
  loadCache();
  const out = texts.slice();
  const todo = [];
  texts.forEach((t, i) => {
    const s = String(t || '').trim();
    if (!s || looksPortuguese(s)) return;
    const hit = cache[keyOf(s)];
    if (hit) out[i] = hit;
    else todo.push(i);
  });
  let engine = todo.length ? null : 'cache';
  if (todo.length && opts && opts.apiKey) {
    try {
      for (let k = 0; k < todo.length; k += 12) {
        const idx = todo.slice(k, k + 12);
        const tr = await claude(idx.map((i) => texts[i].slice(0, 2000)), opts);
        idx.forEach((i, j) => { out[i] = tr[j]; cache[keyOf(texts[i].trim())] = tr[j]; });
      }
      engine = 'claude';
    } catch (_) { engine = null; }
  }
  if (todo.length && !engine) {
    for (const i of todo) {
      try {
        const tr = await machine(texts[i]);
        out[i] = tr;
        cache[keyOf(texts[i].trim())] = tr;
        engine = 'google';
      } catch (_) { /* keep original */ }
    }
  }
  if (todo.length) saveCache();
  return { texts: out, engine: engine || 'nenhum' };
}

/* ---------- whole articles: many short lines with inline markers ---------- */
// Lines carry <b>, <i>, <aN> (links) and [[N]] (spell/item names that stay in English).
const MARK = /<\/?(?:b|i|a\d+)>|\[\[\d+\]\]/g;

/** Puts back markers the translator spaced out or dropped; strips formatting it broke */
function repair(src, out) {
  let t = String(out || '')
    .replace(/<\s*(\/?)\s*(b|i|a\s*\d+)\s*>/gi, (_, c, tag) => `<${c}${tag.replace(/\s+/g, '').toLowerCase()}>`)
    .replace(/\[\s*\[\s*(\d+)\s*\]\s*\]/g, '[[$1]]');
  const want = (src.match(/\[\[\d+\]\]/g) || []);
  const missing = want.filter((r) => !t.includes(r));
  if (missing.length) t += ' ' + missing.join(' ');
  const tags = (s) => (s.match(/<\/?(?:b|i|a\d+)>/g) || []).sort().join('');
  if (tags(t) !== tags(src)) {
    // Formatting got scrambled: keep links and names, drop bold/italic
    t = t.replace(/<\/?(?:b|i)>/g, '');
    const links = (src.match(/<a\d+>/g) || []);
    if (links.some((l) => !t.includes(l) || !t.includes(l.replace('<', '</')))) t = t.replace(/<\/?a\d+>/g, '');
  }
  return jargon(t).replace(/\s+/g, ' ').trim();
}

// Game jargon the free translator gets wrong ("rank" becomes "classificação", "raid" becomes "ataque"…)
// Google renders "rank" (spell rank, talent rank) as "classificação", which reads wrong to a player.
// Swap it for "rank" and re-agree the words around it, since "rank" is masculine in PT-BR gamer talk.
const FEM = {
  a: 'o', as: 'os', da: 'do', das: 'dos', na: 'no', nas: 'nos', pela: 'pelo', pelas: 'pelos', uma: 'um', umas: 'uns',
  essa: 'esse', essas: 'esses', esta: 'este', estas: 'estes', dessa: 'desse', dessas: 'desses', desta: 'deste', destas: 'destes',
  nessa: 'nesse', nessas: 'nesses', nesta: 'neste', nestas: 'nestes', toda: 'todo', todas: 'todos', sua: 'seu', suas: 'seus',
  nova: 'novo', novas: 'novos', 'última': 'último', 'últimas': 'últimos', primeira: 'primeiro', primeiras: 'primeiros',
  mesma: 'mesmo', mesmas: 'mesmos', 'próxima': 'próximo', 'próximas': 'próximos', segunda: 'segundo', terceira: 'terceiro',
  quarta: 'quarto', quinta: 'quinto', alta: 'alto', altas: 'altos', baixa: 'baixo', baixas: 'baixos', antiga: 'antigo',
  antigas: 'antigos', 'máxima': 'máximo', 'máximas': 'máximos', 'mínima': 'mínimo', 'mínimas': 'mínimos', nenhuma: 'nenhum',
  qualquer: 'qualquer', cada: 'cada', outra: 'outro', outras: 'outros', melhor: 'melhor', maior: 'maior', menor: 'menor',
};
const ADJ_SKIP = /^(mais|menos|existentes?|atual|atuais|anterior|anteriores|dispon[ií]ve(?:l|is)|superior|superiores|inferior|inferiores|maior|maiores|menor|menores)$/i;
const AUX = /^(foram|foi|são|é|serão|será|estão|está|estavam|estava|ficam|fica|ficaram|ficou|eram|era|serem|ser|sendo)$/i;
const keepCase = (orig, word) => (orig[0] && orig[0] === orig[0].toUpperCase() && orig[0] !== orig[0].toLowerCase()
  ? word[0].toUpperCase() + word.slice(1) : word);

function fixRanks(text) {
  if (!/classifica[çc]/i.test(text)) return text;
  const tok = text.split(/(\s+)/); // words at even indexes
  const parts = (w) => w.match(/^([^\p{L}]*)(\p{L}*)([^\p{L}]*)$/u) || [w, '', w, ''];
  const setCore = (i, core) => { const [, pre, , post] = parts(tok[i]); tok[i] = pre + core + post; };
  for (let i = 0; i < tok.length; i += 2) {
    const [, pre, core, post] = parts(tok[i]);
    const m = /^classifica[çc](ão|ões|ao|oes)$/i.exec(core);
    if (!m) continue;
    const plural = /õ|o(?=es)/i.test(m[1]);
    tok[i] = pre + keepCase(core, plural ? 'ranks' : 'rank') + post;
    // determiners and adjectives right before it ("todas as", "a nova")
    for (let j = i - 2; j >= 0 && j >= i - 6; j -= 2) {
      const [, , c, after] = parts(tok[j]);
      if (after || !FEM[c.toLowerCase()]) break;
      setCore(j, keepCase(c, FEM[c.toLowerCase()]));
    }
    if (post) continue;
    // adjectives right after it ("mais altas"), then a participle after a linking verb ("foram renomeadas")
    let j = i + 2;
    for (; j < tok.length && j <= i + 8; j += 2) {
      const [, , c, after] = parts(tok[j]);
      const low = c.toLowerCase();
      if (ADJ_SKIP.test(low)) { if (after) break; continue; }
      if (FEM[low] && /as?$/.test(low)) { setCore(j, keepCase(c, FEM[low])); if (after) break; continue; }
      if (AUX.test(low) && !after && j + 2 < tok.length) {
        const [, , pc] = parts(tok[j + 2]);
        if (/(ad|id)as?$/i.test(pc)) setCore(j + 2, pc.replace(/a(s?)$/i, 'o$1'));
      }
      break;
    }
  }
  return tok.join('');
}

function jargon(text) {
  const t = String(text || '');
  const WHOLE = { aulas: 'Classes', corridas: 'Raças', 'jogador contra jogador': 'Jogador contra Jogador (PvP)' };
  if (WHOLE[t.trim().toLowerCase()]) return WHOLE[t.trim().toLowerCase()];
  return fixRanks(t)
    .replace(/\bgrupo ou ataque\b/gi, 'grupo ou raide')
    .replace(/\bataque de grupo\b/gi, 'raide');
}

async function googleLines(lines) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await net.fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=pt-BR&dt=t', {
      method: 'POST',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: 'q=' + encodeURIComponent(lines.join('\n')),
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const out = (data[0] || []).map((seg) => seg[0]).join('').split('\n');
    if (out.length !== lines.length) throw new Error('linhas desencontradas');
    return out;
  } finally { clearTimeout(timer); }
}

const LINES_SYSTEM = 'Você traduz matérias de World of Warcraft do inglês para o português do Brasil, natural e direto, como um site brasileiro de WoW escreveria. Cada item do array é um parágrafo, título ou item de lista. Preserve exatamente as marcações <b>, </b>, <i>, </i>, <a1>…</a1> (links) e os marcadores [[1]], [[2]]… (nomes de feitiços e itens que ficam em inglês). Mantenha em inglês nomes de feitiços, talentos, itens, masmorras, raides, zonas e NPCs. Mantenha jargão de jogo (DPS, tank, healer, aggro, nerf, buff, hotfix, patch, raid). Responda SOMENTE com um array JSON de strings, na mesma ordem e quantidade.';

async function claudeLines(lines, { apiKey, model }) {
  const res = await net.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: model || 'claude-haiku-5-5', max_tokens: 8000, system: LINES_SYSTEM, messages: [{ role: 'user', content: JSON.stringify(lines) }] })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || 'HTTP ' + res.status);
  const raw = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const arr = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
  if (!Array.isArray(arr) || arr.length !== lines.length) throw new Error('Tradução incompleta');
  return arr.map(String);
}

/** Splits indices into batches of at most `max` characters */
function batches(idx, lines, max, maxCount) {
  const out = [];
  let cur = [];
  let size = 0;
  for (const i of idx) {
    const len = lines[i].length + 1;
    if (cur.length && (size + len > max || cur.length >= maxCount)) { out.push(cur); cur = []; size = 0; }
    cur.push(i);
    size += len;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Translates article lines keeping the inline markers. Returns { texts, engine }.
 * Batched (about 4 500 characters per request), cached line by line.
 */
async function translateLines(lines, opts) {
  loadCache();
  const src = lines.map((l) => String(l || '').replace(/\s*\n\s*/g, ' ').trim());
  const out = src.slice();
  const todo = [];
  src.forEach((s, i) => {
    const plain = s.replace(MARK, '').trim();
    if (!/[a-z]{2}/i.test(plain) || looksPortuguese(plain)) return;
    const hit = cache['L' + keyOf(s)];
    if (hit) out[i] = jargon(hit);
    else todo.push(i);
  });
  let engine = todo.length ? null : 'cache';
  const store = (i, t) => { out[i] = repair(src[i], t); cache['L' + keyOf(src[i])] = out[i]; };

  if (todo.length && opts && opts.apiKey) {
    try {
      for (const group of batches(todo, src, 5000, 60)) {
        const tr = await claudeLines(group.map((i) => src[i]), opts);
        group.forEach((i, j) => store(i, tr[j]));
      }
      engine = 'claude';
    } catch (_) { engine = null; }
  }
  if (todo.length && engine !== 'claude') {
    const left = todo.filter((i) => out[i] === src[i]);
    for (const group of batches(left, src, 4500, 120)) {
      try {
        const tr = await googleLines(group.map((i) => src[i]));
        group.forEach((i, j) => store(i, tr[j]));
        engine = 'google';
      } catch (_) {
        // One line at a time when the batch comes back misaligned
        for (const i of group) {
          try { store(i, (await googleLines([src[i]]))[0]); engine = 'google'; } catch (__) { /* stays in English */ }
        }
      }
    }
  }
  if (todo.length) saveCache();
  return { texts: out, engine: engine || 'nenhum' };
}

module.exports = { translateMany, translateLines, looksPortuguese, repair, jargon };

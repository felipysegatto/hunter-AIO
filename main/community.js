'use strict';

// "Comunidade": community conversation about WoW Forever, always shown in Portuguese.
// Sources:
//  - Discord, through the user's own bot. Kalamazi's server can't be read directly
//    (reading another server with a personal account breaks Discord's rules), so the
//    user follows Kalamazi's announcement channels into a server of their own and the
//    bot reads those channels with the official API.
//  - The official WoW Forever forum and Reddit threads about WoW Forever (public RSS).
const { net } = require('electron');
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');
const { stripHtml } = require('./feeds');

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text' });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36 GrimorioDoAventureiro/2.0';
const DISCORD = 'https://discord.com/api/v10';

const RX_BRUXO = /\b(warlock|lock|affliction|demonology|destruction|demo|destro|aff|succubus|incubus|voidwalker|felhunter|imp|bane|curse|wrack|incinerate|conflagrate|soul ?fire|shadow ?bolt|kalamazi|gnome|eureka)\b/i;

async function get(url, headers, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 15000);
  try {
    const res = await net.fetch(url, { headers: { 'User-Agent': UA, ...(headers || {}) }, signal: ctrl.signal });
    return res;
  } finally { clearTimeout(timer); }
}

function friendly(err) {
  const m = String((err && err.message) || err || '');
  if (/abort/i.test(m)) return 'tempo esgotado';
  if (/401/.test(m)) return 'token do bot recusado';
  if (/403/.test(m)) return 'o bot não tem acesso a este canal';
  if (/404/.test(m)) return 'canal não encontrado';
  if (/429/.test(m)) return 'muitas consultas; tento de novo mais tarde';
  if (/ERR_INTERNET_DISCONNECTED|ENOTFOUND|fetch failed|ERR_NAME/i.test(m)) return 'sem conexão';
  return m.slice(0, 70);
}

/* ---------- Discord ---------- */
async function discordJson(path, token) {
  const res = await get(DISCORD + path, { Authorization: 'Bot ' + token, 'User-Agent': 'DiscordBot (https://github.com/bruxomagic/grimorio, 1.1)' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function discordText(m) {
  const parts = [];
  if (m.content) parts.push(m.content);
  for (const e of m.embeds || []) {
    if (e.title) parts.push(e.title);
    if (e.description) parts.push(e.description);
    for (const f of e.fields || []) parts.push(`${f.name}: ${f.value}`);
  }
  return parts.join('\n').replace(/<a?:(\w+):\d+>/g, ':$1:').replace(/<@[!&]?\d+>/g, '@alguém').replace(/<#\d+>/g, '#canal').trim();
}

async function discordChannel(id, token) {
  const ch = await discordJson(`/channels/${id}`, token);
  let guild = '';
  if (ch.guild_id) {
    try { guild = (await discordJson(`/guilds/${ch.guild_id}`, token)).name; } catch (_) { /* bot may lack guild read */ }
  }
  return { id, name: ch.name, guild, guildId: ch.guild_id || '' };
}

async function fetchDiscord(cfg, token) {
  const items = [];
  const errors = [];
  for (const ch of cfg.channels || []) {
    try {
      const msgs = await discordJson(`/channels/${ch.id}/messages?limit=40`, token);
      for (const m of msgs) {
        const text = discordText(m);
        if (!text) continue;
        // Crossposts from a followed channel carry the original server and channel in the author name
        const author = (m.author && (m.author.global_name || m.author.username)) || 'Discord';
        items.push({
          id: 'dc-' + m.id,
          kind: 'discord',
          channel: ch.label || ch.name || ch.id,
          author,
          date: m.timestamp,
          title: '',
          text: text.slice(0, 2500),
          link: ch.guildId ? `https://discord.com/channels/${ch.guildId}/${ch.id}/${m.id}` : '',
          bruxo: RX_BRUXO.test(text) || /kalamazi/i.test(author + ' ' + (ch.label || ''))
        });
      }
    } catch (err) {
      errors.push({ source: 'Discord · ' + (ch.label || ch.name || ch.id), message: friendly(err) });
    }
  }
  return { items, errors };
}

/* ---------- Reddit ---------- */
function text(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return v['#text'] || v['@href'] || '';
  return String(v);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchFeed(src) {
  let res = await get(src.url, { Accept: 'application/atom+xml, application/rss+xml, application/xml, */*' });
  // Reddit limits anonymous reads: wait what it asks (up to 8 s) and try once more
  if (res.status === 429) {
    const wait = Math.min(8, Math.max(2, Number(res.headers.get('retry-after')) || 4));
    await sleep(wait * 1000);
    res = await get(src.url, { Accept: 'application/atom+xml, application/rss+xml, application/xml, */*' });
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const raw = parser.parse(await res.text());
  const atom = [].concat((raw.feed && raw.feed.entry) || []);
  const rss = [].concat((raw.rss && raw.rss.channel && raw.rss.channel.item) || []);
  const rows = atom.length
    ? atom.map((e) => ({
      link: (Array.isArray(e.link) ? e.link[0] : e.link || {})['@href'] || '',
      title: stripHtml(text(e.title)),
      body: stripHtml(text(e.content)).replace(/submitted by .*$/i, '').replace(/\[link\]\s*\[comments\]/gi, '').trim(),
      author: text(e.author && e.author.name).replace(/^\/u\//, 'u/'),
      date: text(e.updated) || text(e.published)
    }))
    : rss.map((e) => ({
      link: text(e.link),
      title: stripHtml(text(e.title)),
      body: stripHtml(text(e.description)).replace(/\d+ posts? - \d+ participants?.*$/i, '').replace(/Read full topic$/i, '').trim(),
      author: text(e['dc:creator']).replace(/^@/, ''),
      date: text(e.pubDate)
    }));
  return rows.filter((r) => r.title && r.link).map((r) => ({
    id: (src.kind === 'forum' ? 'bf-' : 'rd-') + crypto.createHash('sha1').update(r.link).digest('hex').slice(0, 14),
    kind: src.kind || 'reddit',
    channel: src.name,
    author: r.author,
    date: r.date ? new Date(r.date).toISOString() : new Date().toISOString(),
    title: r.title,
    text: r.body.slice(0, 1200),
    link: r.link,
    bruxo: RX_BRUXO.test(r.title + ' ' + r.body)
  })).filter((i) => src.alwaysForever || /forever|classic\s*\+|classic plus/i.test(i.title + ' ' + i.text));
}

/**
 * Pulls every community source, merges with the cache and returns
 * { items, newItems, errors, status }.
 */
async function fetchAll(config, discordCfg, token, cache) {
  const errors = [];
  const fetched = [];
  const status = { discord: discordCfg && discordCfg.enabled && token && (discordCfg.channels || []).length ? 'on' : 'off' };

  // One after the other, with a pause: Reddit answers 429 to several searches at once
  const sources = config.sources || [];
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    if (i > 0 && /reddit\.com/i.test(src.url)) await sleep(1500);
    try { fetched.push(...(await fetchFeed(src))); } catch (err) { errors.push({ source: src.name, message: friendly(err) }); }
  }
  if (status.discord === 'on') {
    const d = await fetchDiscord(discordCfg, token);
    fetched.push(...d.items);
    errors.push(...d.errors);
    if (d.errors.length && !d.items.length) status.discord = 'error';
  }

  const known = new Map((cache.items || []).map((i) => [i.id, i]));
  const newItems = [];
  for (const it of fetched) {
    const prev = known.get(it.id);
    if (prev) known.set(it.id, { ...it, pt: prev.text === it.text && prev.title === it.title ? prev.pt : null, firstSeen: prev.firstSeen });
    else { const fresh = { ...it, firstSeen: new Date().toISOString() }; known.set(it.id, fresh); newItems.push(fresh); }
  }
  const cutoff = Date.now() - (config.keepDays || 21) * 864e5;
  const items = [...known.values()]
    .filter((i) => new Date(i.date).getTime() > cutoff)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 220);
  return { items, newItems: newItems.filter((n) => items.some((i) => i.id === n.id)), errors, status };
}

module.exports = { fetchAll, discordChannel, friendly };

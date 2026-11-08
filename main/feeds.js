'use strict';

// Pulls RSS/Atom feeds, keeps only World of Warcraft: Forever items and tags
// them into the app's three news groups. Runs in the main process (no CORS).
const { XMLParser } = require('fast-xml-parser');
const crypto = require('crypto');
const { net } = require('electron');

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text' });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36 GrimorioDoAventureiro/2.0';

const RX = {
  forever: /\b(wow\s*:?\s*forever|warcraft\s*:?\s*forever|forever|classic\s*\+|classic plus)\b/i,
  retailNoise: /\b(midnight|the war within|mythic\+|eclipse|last titan|delves?|hero talents?)\b/i,
  bruxo: /\b(warlock|bruxo|affliction|afli[cç][aã]o|demonology|demonologia|destruction|destrui[cç][aã]o|bane of|curse of|soul shard|life tap|succubus|voidwalker|felhunter|imp\b|kalamazi|demonic pact|wrack|incinerate|conflagrate)\b/i,
  gnomo: /\b(gnome|gnomo|gnomish|gnomeregan|eureka|escape artist|expansive mind|tinker)\b/i,
  atencao: /\b(ban|banned|backlash|controvers|nerf|hotfix|revert|issue|bug|outage|queue|delay|postpone|exploit|grief|threat|restricted|known issues?|maintenance|rollback|feedback)\b/i,
  build: /\b(talent|talents|build|builds|spec|tier list|bis|best in slot|rotation)\b/i
};

function text(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return v['#text'] || v['@href'] || '';
  return String(v);
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#8217;/g, '’').replace(/&#8211;/g, '–').replace(/&#8230;/g, '…')
    .replace(/\s+/g, ' ').trim();
}

function normalize(feed, raw) {
  const out = [];
  const rss = raw.rss && raw.rss.channel;
  const atom = raw.feed;
  const entries = rss ? [].concat(rss.item || []) : atom ? [].concat(atom.entry || []) : [];
  for (const e of entries) {
    let link = '';
    if (rss) link = text(e.link);
    else if (Array.isArray(e.link)) link = (e.link.find((l) => l['@rel'] === 'alternate') || e.link[0] || {})['@href'] || '';
    else link = (e.link && e.link['@href']) || text(e.link);
    const title = stripHtml(text(e.title));
    const body = stripHtml(text(e.description) || text(e['content:encoded']) || text(e.summary) || text(e.content) || text(e['media:group'] && e['media:group']['media:description']))
      .replace(/\s*(Continue reading|Read more|Leia mais)\s*»?\s*$/i, '').trim();
    const date = text(e.pubDate) || text(e.published) || text(e.updated) || text(e['dc:date']);
    if (!title || !link) continue;
    // Full post when the feed carries it (used to show the whole article inside the app)
    const full = text(e['content:encoded']) || (atom ? text(e.content) : '');
    out.push({
      id: crypto.createHash('sha1').update(link).digest('hex').slice(0, 16),
      title, link,
      snippet: body.slice(0, 900),
      content: full && stripHtml(full).length > body.length + 200 ? full.slice(0, 160000) : undefined,
      date: date ? new Date(date).toISOString() : new Date().toISOString(),
      source: feed.name, sourceKind: feed.kind
    });
  }
  return out;
}

function classify(item, feed) {
  const hay = `${item.title} ${item.snippet}`;
  const isForever = feed.alwaysForever || RX.forever.test(hay);
  if (!isForever) return null;
  if (!feed.alwaysForever && RX.retailNoise.test(item.title) && !/forever/i.test(item.title)) return null;
  const tags = [];
  if (RX.bruxo.test(hay) || feed.kind === 'kalamazi') tags.push('bruxo');
  if (RX.gnomo.test(hay)) tags.push('gnomo');
  if (RX.atencao.test(hay)) tags.push('atencao');
  const category = tags.includes('atencao') ? 'atencao' : 'geral';
  const buildAlert = false;
  return { ...item, category, tags, buildAlert };
}

function friendlyError(err) {
  const m = String((err && err.message) || err || '');
  if (/abort/i.test(m)) return 'tempo esgotado';
  if (/HTTP 40[13]/.test(m)) return 'acesso bloqueado pelo site';
  if (/HTTP 404/.test(m)) return 'feed não encontrado';
  if (/HTTP 5\d\d/.test(m)) return 'site fora do ar';
  if (/ERR_INTERNET_DISCONNECTED|ENOTFOUND|fetch failed|ERR_NAME/i.test(m)) return 'sem conexão';
  return m.slice(0, 60);
}

/* ---------- YouTube: the channel's video page when the RSS feed is down ---------- */
const UNIT_MS = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 };
function relativeDate(label) {
  const m = String(label || '').match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/i);
  return m ? new Date(Date.now() - Number(m[1]) * UNIT_MS[m[2].toLowerCase()]).toISOString() : null;
}

function findAll(node, key, out, depth) {
  if (!node || typeof node !== 'object' || depth > 60) return out;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, key, out, depth + 1)); return out; }
  for (const k of Object.keys(node)) {
    if (k === key) out.push(node[k]);
    else findAll(node[k], key, out, depth + 1);
  }
  return out;
}

function videosFromInitialData(feed, data) {
  const out = [];
  // Current layout: lockupViewModel; older layout: videoRenderer
  for (const v of findAll(data, 'lockupViewModel', [], 0)) {
    if (!v.contentId || !/VIDEO/.test(String(v.contentType || 'VIDEO'))) continue;
    const md = (v.metadata && v.metadata.lockupMetadataViewModel) || {};
    const title = (md.title && (md.title.content || md.title.simpleText)) || '';
    const parts = findAll(md.metadata, 'metadataParts', [], 0).flat();
    const when = parts.map((p) => p.accessibilityLabel || (p.text && p.text.content) || '').find((t) => /ago/i.test(t));
    out.push({ videoId: v.contentId, title, when });
  }
  for (const v of findAll(data, 'videoRenderer', [], 0)) {
    const title = (v.title && ((v.title.runs && v.title.runs.map((r) => r.text).join('')) || v.title.simpleText)) || '';
    out.push({ videoId: v.videoId, title, when: v.publishedTimeText && v.publishedTimeText.simpleText });
  }
  const seen = new Set();
  return out.filter((v) => v.videoId && v.title && !seen.has(v.videoId) && seen.add(v.videoId)).map((v) => {
    const link = 'https://www.youtube.com/watch?v=' + v.videoId;
    return {
      id: crypto.createHash('sha1').update(link).digest('hex').slice(0, 16),
      title: v.title, link, snippet: '',
      date: relativeDate(v.when) || new Date().toISOString(), approxDate: true,
      source: feed.name, sourceKind: feed.kind
    };
  });
}

async function fetchYoutubePage(feed, signal) {
  const id = (String(feed.url).match(/channel_id=([\w-]+)/) || [])[1] || feed.channelId;
  if (!id) throw new Error('HTTP 404');
  const res = await net.fetch(`https://www.youtube.com/channel/${id}/videos`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html', Cookie: 'CONSENT=YES+1; SOCS=CAI' }, signal
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const at = html.indexOf('var ytInitialData = ');
  if (at < 0) throw new Error('página do canal sem lista de vídeos');
  const start = at + 'var ytInitialData = '.length;
  const end = html.indexOf(';</script>', start);
  return videosFromInitialData(feed, JSON.parse(html.slice(start, end)));
}

async function fetchFeed(feed) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    let items;
    const isYoutube = /youtube\.com\/feeds\//i.test(feed.url);
    try {
      const res = await net.fetch(feed.url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      items = normalize(feed, parser.parse(await res.text()));
    } catch (err) {
      // YouTube's RSS often answers 404/500 for channels that exist: read the channel's video page instead
      if (!isYoutube || ctrl.signal.aborted) throw err;
      items = await fetchYoutubePage(feed, ctrl.signal);
    }
    if (feed.requireTitleMatch) {
      const rx = new RegExp(feed.requireTitleMatch, 'i');
      return items.filter((i) => rx.test(i.title));
    }
    return items;
  } finally { clearTimeout(t); }
}

async function fetchAll(feedConfig, cache) {
  const known = new Map((cache.items || []).map((i) => [i.id, i]));
  const errors = [];
  const fetched = [];
  const list = (feedConfig && feedConfig.sources) || [];
  await Promise.all(list.map(async (feed) => {
    try {
      const items = await fetchFeed(feed);
      for (const it of items) {
        const c = classify(it, feed);
        if (c) fetched.push(c);
      }
    } catch (err) {
      errors.push({ source: feed.name, message: friendlyError(err) });
    }
  }));

  const newItems = [];
  for (const it of fetched) {
    if (known.has(it.id)) {
      const prev = known.get(it.id);
      // Dates read as "3 days ago" drift a little on every run: keep the first estimate
      const date = it.approxDate && prev.date ? prev.date : it.date;
      known.set(it.id, { ...it, date, ai: prev.ai, pt: prev.title === it.title && prev.snippet === it.snippet ? prev.pt : null, notified: prev.notified, firstSeen: prev.firstSeen, read: prev.read });
    } else {
      const fresh = { ...it, firstSeen: new Date().toISOString() };
      known.set(it.id, fresh);
      newItems.push(fresh);
    }
  }
  // Items still missing a summary get another chance with the AI on this run
  for (const it of known.values()) {
    if (!it.ai && !newItems.some((n) => n.id === it.id)) newItems.push(it);
  }
  const keepDays = (feedConfig && feedConfig.keepDays) || 45;
  const cutoff = Date.now() - keepDays * 864e5;
  const items = [...known.values()]
    .filter((i) => new Date(i.date).getTime() > cutoff)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 160);
  return { items, newItems: newItems.filter((n) => items.some((i) => i.id === n.id)).slice(0, 25), errors };
}

module.exports = { fetchAll, classify, stripHtml, normalize };

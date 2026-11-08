'use strict';

// Full article text for news items, read inside the app (no need to open the site).
//  - Wowhead: the article page carries the post as Wowhead markup ([h2], [ul][li], [quote],
//    [spell=ID]…) plus the names and icons of every spell, item or NPC it links.
//  - Any feed with full content in the RSS (content:encoded): parsed from that HTML.
// Articles are kept as plain data (blocks of text with a tiny inline markup: <b>, <i>, <aN>
// for links and [[N]] for game entities), translated block by block and cached on disk.
const { net, app } = require('electron');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36';
const IMG_OK = /^https:\/\/wow\.zamimg\.com\//i;
const WOWHEAD = 'https://www.wowhead.com';

/* ---------- block builder shared by both parsers ---------- */
const decodeEntities = (s) => String(s)
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '‹').replace(/&gt;/g, '›')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

// Literal "<", ">" and "[[" in the text must never be read as our own inline markup
const safeText = (s) => decodeEntities(s).replace(/</g, '‹').replace(/>/g, '›').replace(/\[\[/g, '[ [');

class Builder {
  constructor() {
    this.blocks = [];
    this.refs = [];
    this.refIndex = new Map();
    this.links = [];
    this.cur = null;
    this.fmt = [];          // open inline formats carried across blocks: 'b' | 'i'
    this.linkStack = [];    // { k, start, auto }
    this.quotes = [];       // stack of quote ids
    this.qseq = 0;
    this.lists = [];        // stack of { ordered }
    this.table = null;      // { id, row, th }
    this.tseq = 0;
  }

  get q() { return this.quotes.length ? this.quotes[this.quotes.length - 1] : 0; }

  open(t, props) {
    this.flush();
    this.cur = { t, text: this.fmt.map((f) => `<${f}>`).join(''), ...(props || {}) };
    if (this.q) this.cur.q = this.q;
  }

  ensure() { if (!this.cur) this.open(this.table && this.table.inCell ? 'td' : 'p', this.table && this.table.inCell ? { table: this.table.id, row: this.table.row, th: this.table.th } : null); }

  text(raw) {
    const parts = String(raw).split(/\r?\n/);
    parts.forEach((part, i) => {
      if (i > 0) {
        // A line break ends a paragraph; inside list items, headings and cells it is just a space
        if (this.cur && this.cur.t === 'p') this.flush();
        else if (this.cur) this.cur.text += ' ';
      }
      if (!part) return;
      if (!this.cur && !part.trim()) return;
      this.ensure();
      this.cur.text += safeText(part);
    });
  }

  inline(tag) { this.ensure(); this.cur.text += tag; }

  fmtOpen(f) { this.fmt.push(f); if (this.cur) this.cur.text += `<${f}>`; }
  fmtClose(f) {
    const i = this.fmt.lastIndexOf(f);
    if (i < 0) return;
    this.fmt.splice(i, 1);
    if (this.cur) this.cur.text += `</${f}>`;
  }

  linkOpen(url) {
    this.ensure();
    const u = cleanUrl(url);
    const k = this.links.push(u || '') ;
    this.linkStack.push({ k, start: this.cur.text.length, auto: !url });
    this.cur.text += `<a${k}>`;
  }
  linkClose() {
    const l = this.linkStack.pop();
    if (!l) return;
    if (l.auto && this.cur) {
      const inner = this.cur.text.slice(l.start).replace(/<[^>]+>/g, '').trim();
      this.links[l.k - 1] = cleanUrl(inner) || '';
    }
    if (this.cur) this.cur.text += `</a${l.k}>`;
  }

  entity(ref) {
    const key = ref.type + ':' + ref.id + ':' + ref.name;
    let k = this.refIndex.get(key);
    if (!k) { k = this.refs.push(ref); this.refIndex.set(key, k); }
    this.inline(`[[${k}]]`);
  }

  media(b) { this.flush(); if (this.q) b.q = this.q; this.blocks.push(b); }

  flush() {
    const c = this.cur;
    this.cur = null;
    if (!c) return;
    c.text = balance(c.text.replace(/\s+/g, ' ').trim());
    const visible = c.text.replace(/<\/?(?:b|i|a\d+)>/g, '').trim();
    if (!visible) return;
    this.blocks.push(c);
  }

  quoteOpen(name, blue) {
    this.flush();
    const id = ++this.qseq;
    this.quotes.push(id);
    if (name) this.blocks.push({ t: 'qsrc', text: safeText(name), q: id, blue: !!blue });
    else if (blue) this.blocks.push({ t: 'qsrc', text: 'Blizzard', q: id, blue: true });
  }
  quoteClose() { this.flush(); this.quotes.pop(); this.fmt = []; }

  /** Structure boundaries end any bold/italic left open by the source */
  endStructure() { this.flush(); this.fmt = []; }

  done() {
    this.flush();
    // A short paragraph that is entirely bold works as a heading ("Bug Fixes", "Warlock")
    this.blocks.forEach((b) => {
      if (b.t === 'p' && /^<b>[^<]{1,70}<\/b>:?$/.test(b.text)) { b.t = 'h'; b.level = 3; b.text = b.text.replace(/^<b>|<\/b>:?$/g, ''); }
    });
    // Drop quote labels with nothing under them and cap very long posts
    let blocks = this.blocks.filter((b) => b.t !== 'qsrc' || this.blocks.some((x) => x.q === b.q && x !== b));
    if (blocks.length > 1500) blocks = blocks.slice(0, 1500);
    return { blocks, refs: this.refs, links: this.links };
  }
}

/** Closes inline tags left open and drops closers without an opener */
function balance(s) {
  const stack = [];
  let out = s.replace(/<(\/?)(b|i|a\d+)>/g, (m, close, tag) => {
    if (!close) { stack.push(tag); return m; }
    const i = stack.lastIndexOf(tag);
    if (i < 0) return '';
    const after = stack.splice(i);
    // close anything opened after it, then the tag itself
    return after.slice(1).reverse().map((t) => `</${t}>`).join('') + m;
  });
  while (stack.length) out += `</${stack.pop()}>`;
  return out.replace(/<(b|i|a\d+)><\/\1>/g, '');
}

function cleanUrl(u) {
  let s = String(u || '').trim().replace(/^["']|["']$/g, '');
  if (!s) return '';
  if (s.startsWith('//')) s = 'https:' + s;
  else if (s.startsWith('/')) s = WOWHEAD + s;
  return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : '';
}

/* ---------- Wowhead markup ---------- */
const GATHER_TYPE = { npc: 1, object: 2, item: 3, itemset: 4, quest: 5, spell: 6, zone: 7, faction: 8, pet: 9, achievement: 10, title: 11, event: 12, skill: 15, currency: 17, mount: 6 };
const CLASS_NAME = { 1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest', 6: 'Death Knight', 7: 'Shaman', 8: 'Mage', 9: 'Warlock', 10: 'Monk', 11: 'Druid', 12: 'Demon Hunter', 13: 'Evoker' };
const RACE_NAME = { 1: 'Human', 2: 'Orc', 3: 'Dwarf', 4: 'Night Elf', 5: 'Undead', 6: 'Tauren', 7: 'Gnome', 8: 'Troll', 10: 'Blood Elf', 11: 'Draenei' };

const T_HEAD = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const T_FMT = { b: 'b', strong: 'b', i: 'i', em: 'i', u: null, s: null };
const T_TRANSPARENT = new Set(['db', 'div', 'span', 'center', 'color', 'small', 'pad', 'size', 'sup', 'sub', 'left', 'right', 'minibox', 'tabs', 'spoiler', 'collapse', 'code', 'pre', 'acronym', 'abbr', 'font', 'sticky', 'html', 'wowheadtooltip', 'feedback', 'toggler', 'hidden', 'noscript', 'style', 'p', 'emoji', 'section', 'sidebar', 'inline']);
const T_DROP = new Set(['toc', 'map', 'model', 'script', 'ad', 'button']);
const T_ENTITY = new Set([...Object.keys(GATHER_TYPE), 'class', 'race']);
const T_KNOWN = new Set([...T_HEAD, ...Object.keys(T_FMT), ...T_TRANSPARENT, ...T_DROP, ...T_ENTITY,
  'ul', 'ol', 'li', 'quote', 'table', 'tr', 'td', 'th', 'img', 'screenshot', 'youtube', 'video', 'hr', 'br', 'tab', 'url', 'cta-button', 'icon', 'tooltip',
  'reddit', 'twitter', 'tweet', 'x', 'bluesky', 'instagram', 'tiktok', 'twitch']);
const EMBED_LABEL = { reddit: 'Post no Reddit', twitter: 'Post no X (Twitter)', tweet: 'Post no X (Twitter)', x: 'Post no X (Twitter)', bluesky: 'Post no Bluesky', instagram: 'Post no Instagram', tiktok: 'Vídeo no TikTok', twitch: 'Clipe na Twitch' };

function parseArgs(raw) {
  const out = { _: '' };
  let s = String(raw || '');
  if (s.startsWith('=')) {
    s = s.slice(1);
    const m = s.match(/^"([^"]*)"|^(\S+)/);
    if (m) { out._ = m[1] != null ? m[1] : m[2]; s = s.slice(m[0].length); }
  }
  for (const m of s.matchAll(/([a-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/gi)) {
    out[m[1].toLowerCase()] = m[2] != null ? m[2] : m[3] != null ? m[3] : m[4];
  }
  return out;
}

function gathererData(html) {
  const data = {};
  for (const m of html.matchAll(/WH\.Gatherer\.addData\((\d+),\s*\d+,\s*(\{[\s\S]*?\})\);/g)) {
    try {
      const obj = JSON.parse(m[2]);
      data[m[1]] = Object.assign(data[m[1]] || {}, obj);
    } catch (_) { /* skip a block we can't read */ }
  }
  return data;
}

function entityRef(tag, args, gather) {
  const id = parseInt(args._ || args.id, 10);
  if (!id) return null;
  if (tag === 'class') return { type: 'class', id, name: CLASS_NAME[id] || 'Classe ' + id };
  if (tag === 'race') return { type: 'race', id, name: RACE_NAME[id] || 'Raça ' + id };
  const g = (gather[GATHER_TYPE[tag]] || {})[id] || {};
  const name = g.name_enus || g.name || g.displayName || '';
  const icon = typeof g.icon === 'string' && /^[a-z0-9_-]+$/i.test(g.icon) && !/^quest-/.test(g.icon) ? g.icon.toLowerCase() : null;
  return {
    type: tag, id, name: name || `${tag} ${id}`, icon,
    quality: typeof g.quality === 'number' ? g.quality : null,
    desc: typeof g.description_enus === 'string' ? g.description_enus.slice(0, 400) : '',
    url: `${WOWHEAD}/forever/${tag}=${id}`
  };
}

function fromWowheadMarkup(markup, gather) {
  const b = new Builder();
  const src = String(markup || '').replace(/^\[db=[^\]]*\]/i, '');
  const rx = /\[(\/?)([a-z][a-z0-9-]*)((?:=|\s)[^\]]*)?\]/gi;
  let last = 0;
  let drop = 0;              // inside a tag whose content is hidden
  let m;
  while ((m = rx.exec(src))) {
    const [whole, slash, rawName, rawArgs] = m;
    const name = rawName.toLowerCase();
    if (!T_KNOWN.has(name)) continue; // "[Reddit]", "[sic]"… stay as text
    if (EMBED_LABEL[name] && !slash && !cleanUrl(parseArgs(rawArgs)._ || parseArgs(rawArgs).url)) continue;
    if (m.index > last && !drop) b.text(src.slice(last, m.index));
    last = m.index + whole.length;
    const args = parseArgs(rawArgs);
    const closing = !!slash;

    if (T_DROP.has(name) || (name === 'tooltip' && args.name && !closing)) {
      // Hide the content only when the tag really has a closing pair (some are self-closing)
      if (!closing && src.indexOf('[/' + name + ']', last) >= 0) drop++;
      else if (closing && drop) drop--;
      continue;
    }
    if (name === 'tooltip') { if (closing && drop) drop--; continue; }
    if (drop) continue;

    if (T_HEAD.has(name)) {
      if (!closing) { b.endStructure(); b.open('h', { level: Math.min(4, Math.max(2, Number(name[1]) || 2)) }); }
      else b.endStructure();
    } else if (name in T_FMT) {
      const f = T_FMT[name];
      if (f) { if (closing) b.fmtClose(f); else b.fmtOpen(f); }
    } else if (name === 'ul' || name === 'ol') {
      if (!closing) { b.flush(); b.lists.push({ ordered: name === 'ol' }); } else { b.endStructure(); b.lists.pop(); }
    } else if (name === 'li') {
      if (!closing) {
        const l = b.lists[b.lists.length - 1] || { ordered: false };
        b.endStructure();
        b.open('li', { depth: Math.max(1, b.lists.length), ordered: l.ordered });
      } else b.endStructure();
    } else if (name === 'quote') {
      if (!closing) b.quoteOpen(args._ && !/^https?:/i.test(args._) ? args._ : '', /blizzard|blue/i.test(args.type || args._ || ''));
      else b.quoteClose();
    } else if (name === 'table') {
      if (!closing) { b.endStructure(); b.table = { id: ++b.tseq, row: -1, th: false, inCell: false }; } else { b.endStructure(); b.table = null; }
    } else if (name === 'tr') {
      b.endStructure();
      if (!closing && b.table) b.table.row++;
    } else if (name === 'td' || name === 'th') {
      if (!b.table) continue;
      b.endStructure();
      if (!closing) { b.table.inCell = true; b.table.th = name === 'th'; b.open('td', { table: b.table.id, row: Math.max(0, b.table.row), th: name === 'th' }); } else b.table.inCell = false;
    } else if (name === 'img') {
      if (closing) continue;
      const s = cleanUrl(args.src || args._);
      if (IMG_OK.test(s)) b.media({ t: 'img', src: s, alt: args.alt || '' });
    } else if (name === 'screenshot') {
      if (closing) continue;
      const id = parseInt(args.id || args._, 10);
      const s = id ? `https://wow.zamimg.com/uploads/screenshots/normal/${id}.jpg` : cleanUrl(args.url);
      if (s && IMG_OK.test(s)) b.media({ t: 'img', src: s, alt: args.alt || '' });
    } else if (name === 'youtube' || name === 'video') {
      if (closing) continue;
      const id = String(args._ || args.id || '').match(/^[\w-]{6,20}$/);
      if (id) b.media({ t: 'video', id: id[0], url: 'https://www.youtube.com/watch?v=' + id[0] });
    } else if (EMBED_LABEL[name]) {
      // Social posts embedded in the article become a link card
      const u = cleanUrl(args._ || args.url || '');
      if (!closing && u) b.media({ t: 'embed', url: u, label: EMBED_LABEL[name] });
    } else if (name === 'hr') {
      if (!closing) b.media({ t: 'hr' });
    } else if (name === 'br') {
      if (b.cur && b.cur.t === 'p') b.flush(); else if (b.cur) b.cur.text += ' ';
    } else if (name === 'tab') {
      if (!closing && (args.name || args._)) { b.open('h', { level: 4 }); b.text(args.name || args._); b.flush(); }
    } else if (name === 'url' || name === 'cta-button') {
      if (!closing) b.linkOpen(args._ || args.url || ''); else b.linkClose();
    } else if (name === 'icon') {
      // [icon name=spell_x]Text[/icon]: the text keeps its icon
      if (!closing && args.name && /^[a-z0-9_-]+$/i.test(args.name)) b.inline(`[[${b.refs.push({ type: 'icon', id: 0, name: '', icon: args.name.toLowerCase() })}]]`);
    } else if (T_ENTITY.has(name)) {
      if (closing) continue;
      const ref = entityRef(name, args, gather);
      if (ref) b.entity(ref);
    }
    // transparent tags: nothing to do, their text flows through
  }
  if (last < src.length && !drop) b.text(src.slice(last));
  return b.done();
}

/* ---------- RSS / plain HTML ---------- */
function fromHtml(html) {
  const b = new Builder();
  const src = String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|iframe|noscript|svg)[\s\S]*?<\/\1>/gi, '');
  const rx = /<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/gi;
  let last = 0;
  let m;
  const attr = (s, n) => { const r = String(s).match(new RegExp(n + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i')); return r ? (r[2] || r[3] || r[4] || '') : ''; };
  while ((m = rx.exec(src))) {
    const [whole, slash, rawName, rawAttrs] = m;
    if (m.index > last) b.text(src.slice(last, m.index).replace(/\s*\n\s*/g, ' '));
    last = m.index + whole.length;
    const name = rawName.toLowerCase();
    const closing = !!slash;
    if (/^h[1-6]$/.test(name)) { if (!closing) b.open('h', { level: Math.min(4, Math.max(2, Number(name[1]))) }); else b.flush(); }
    else if (name === 'p' || name === 'div' || name === 'section' || name === 'figure' || name === 'figcaption') b.flush();
    else if (name === 'br') { if (b.cur && b.cur.t === 'p') b.flush(); else if (b.cur) b.cur.text += ' '; }
    else if (name === 'b' || name === 'strong') { if (closing) b.fmtClose('b'); else b.fmtOpen('b'); }
    else if (name === 'i' || name === 'em') { if (closing) b.fmtClose('i'); else b.fmtOpen('i'); }
    else if (name === 'ul' || name === 'ol') { b.flush(); if (!closing) b.lists.push({ ordered: name === 'ol' }); else b.lists.pop(); }
    else if (name === 'li') {
      if (!closing) { const l = b.lists[b.lists.length - 1] || { ordered: false }; b.open('li', { depth: Math.max(1, b.lists.length), ordered: l.ordered }); } else b.flush();
    } else if (name === 'blockquote') { if (!closing) b.quoteOpen('', false); else b.quoteClose(); }
    else if (name === 'a') { if (!closing) b.linkOpen(attr(rawAttrs, 'href')); else b.linkClose(); }
    else if (name === 'img' && !closing) { const s = cleanUrl(attr(rawAttrs, 'src')); if (IMG_OK.test(s)) b.media({ t: 'img', src: s, alt: attr(rawAttrs, 'alt') }); }
    else if (name === 'hr') b.media({ t: 'hr' });
    else if (name === 'table') { b.flush(); if (!closing) b.table = { id: ++b.tseq, row: -1, th: false, inCell: false }; else b.table = null; }
    else if (name === 'tr') { b.flush(); if (!closing && b.table) b.table.row++; }
    else if ((name === 'td' || name === 'th') && b.table) {
      if (!closing) { b.table.inCell = true; b.open('td', { table: b.table.id, row: Math.max(0, b.table.row), th: name === 'th' }); } else { b.flush(); b.table.inCell = false; }
    }
  }
  if (last < src.length) b.text(src.slice(last));
  return b.done();
}

/* ---------- fetching ---------- */
async function fetchText(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 20000);
  try {
    const res = await net.fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html' }, signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally { clearTimeout(timer); }
}

function parseWowheadHtml(html) {
  const mk = html.match(/WH\.markup\.printHtml\(("(?:[^"\\]|\\.)*")/);
  if (!mk) throw new Error('página sem o texto da matéria');
  const art = fromWowheadMarkup(JSON.parse(mk[1]), gathererData(html));
  const hero = (html.match(/news-post-image"\s+style="background-image:\s*url\(([^)]+)\)/) || [])[1];
  return { ...art, hero: hero && IMG_OK.test(hero) ? hero : null, via: 'wowhead' };
}

// When Wowhead refuses the article page, the app respects it for the rest of the session and
// uses the full text Wowhead itself publishes in its RSS feed instead.
let pageRefused = false;

async function fromWowheadPage(url, notes) {
  if (pageRefused) throw new Error('página recusada nesta sessão');
  try { return parseWowheadHtml(await fetchText(url, 20000)); } catch (e) {
    notes.push(friendly(e));
    if (/HTTP 4\d\d|sem o texto/.test(String(e.message))) pageRefused = true;
    throw e;
  }
}

const CLASSES = new Set(['Druid', 'Hunter', 'Mage', 'Paladin', 'Priest', 'Rogue', 'Shaman', 'Warlock', 'Warrior', 'Death Knight', 'Monk', 'Demon Hunter', 'Evoker']);
// Specialization names stay in English, as in the game
const SPECS = new Set(['Affliction', 'Demonology', 'Destruction', 'Arcane', 'Fire', 'Frost', 'Balance', 'Feral', 'Restoration', 'Guardian',
  'Beast Mastery', 'Marksmanship', 'Survival', 'Holy', 'Protection', 'Retribution', 'Discipline', 'Shadow', 'Assassination', 'Combat',
  'Outlaw', 'Subtlety', 'Elemental', 'Enhancement', 'Arms', 'Fury', 'Blood', 'Unholy', 'Brewmaster', 'Mistweaver', 'Windwalker',
  'Havoc', 'Vengeance', 'Devastation', 'Preservation', 'Augmentation']);
const plainOf = (b) => (b.text || '').replace(/<[^>]+>/g, '').replace(/\[\[\d+\]\]/g, '').trim();

/** Wowhead's RSS flattens headings into short paragraphs: give them back their heading role */
function restoreHeadings(art) {
  art.blocks.forEach((b) => {
    const plain = plainOf(b);
    if (b.t === 'p' && plain.length >= 3 && plain.length <= 42 && /^[A-Z0-9]/.test(plain) && !/[.!?:;,)\]]$/.test(plain) && !/<a\d+>/.test(b.text) && plain.split(/\s+/).length <= 6) {
      b.t = 'h';
      b.level = SPECS.has(plain) ? 4 : 3;
    }
  });
  return art;
}

function markKeep(art) {
  art.blocks.forEach((b) => { if (b.t === 'h' && SPECS.has(plainOf(b))) b.keep = true; });
  return art;
}

/** Builds the article for a feed item. Throws when there's nothing more than the teaser. */
async function build(item) {
  const isWowhead = item.sourceKind === 'wowhead' || /wowhead\.com\/(news|.*\/news)/i.test(item.link || '');
  let art = null;
  let err = null;
  const notes = [];
  if (isWowhead) {
    try { art = await fromWowheadPage(item.link, notes); } catch (e) { err = e; }
  }
  if ((!art || art.blocks.length < 2) && item.content && item.content.length > (item.snippet || '').length + 200) {
    art = { ...fromHtml(item.content), hero: null, via: 'rss' };
    if (isWowhead) restoreHeadings(art);
  }
  if (!art || !art.blocks.length) throw err || new Error('a fonte só publica o resumo');
  if (notes.length) art.notes = notes;
  return markKeep(art);
}

/* ---------- cache on disk ---------- */
const FILE = () => path.join(app.getPath('userData'), 'articles.json');
let cache = null;
function load() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch (_) { cache = {}; }
  return cache;
}
function persist() {
  const ids = Object.keys(cache).sort((a, b) => String(cache[b].at).localeCompare(String(cache[a].at)));
  ids.slice(80).forEach((id) => delete cache[id]);
  try { const tmp = FILE() + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(cache)); fs.renameSync(tmp, FILE()); } catch (_) { /* best effort */ }
}

const VERSION = 2; // 2: headings rebuilt for articles read from Wowhead's RSS
const inflight = new Map();

/**
 * Returns { ok, article } for a feed item: blocks with the English text and the Portuguese
 * translation (b.pt), refs, links, hero image. Cached per item; built once.
 */
function get(item, translateLines, opts) {
  load();
  const hit = cache[item.id];
  if (hit && hit.v === VERSION && (hit.engine !== 'nenhum' || Date.now() - new Date(hit.at).getTime() < 30 * 60e3)) return Promise.resolve({ ok: true, article: hit });
  if (inflight.has(item.id)) return inflight.get(item.id);
  const job = (async () => {
    try {
      const art = await build(item);
      const idx = [];
      art.blocks.forEach((b, i) => { if (b.text && b.t !== 'qsrc' && !b.keep) idx.push(i); });
      let engine = 'nenhum';
      try {
        const r = await translateLines(idx.map((i) => art.blocks[i].text), opts);
        engine = r.engine;
        idx.forEach((i, j) => { if (r.texts[j] && r.texts[j] !== art.blocks[i].text) art.blocks[i].pt = r.texts[j]; });
      } catch (_) { /* shows in English until the next try */ }
      const article = { v: VERSION, id: item.id, url: item.link, at: new Date().toISOString(), engine, ...art };
      cache[item.id] = article;
      persist();
      return { ok: true, article };
    } catch (e) {
      return { ok: false, message: friendly(e) };
    } finally {
      inflight.delete(item.id);
    }
  })();
  inflight.set(item.id, job);
  return job;
}

function has(id) { load(); return !!(cache[id] && cache[id].v === VERSION && cache[id].engine !== 'nenhum'); }

function friendly(e) {
  const m = String((e && e.message) || e || '');
  if (/abort/i.test(m)) return 'a fonte demorou demais para responder';
  if (/HTTP 40[13]/.test(m)) return 'a fonte bloqueou a leitura agora';
  if (/HTTP 404/.test(m)) return 'a matéria não está mais no ar';
  if (/HTTP 5\d\d/.test(m)) return 'a fonte está fora do ar';
  if (/ERR_INTERNET_DISCONNECTED|ENOTFOUND|fetch failed|ERR_NAME/i.test(m)) return 'sem conexão';
  return m.slice(0, 80);
}

module.exports = { get, has, fromWowheadMarkup, fromHtml, gathererData, balance, safeText, cleanUrl };

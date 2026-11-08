'use strict';

// Reads a character's level, equipped items and stats from the Armory.
// Works with any Armory link (Retail, Classic, Forever). Retail characters are
// flagged so the app can show a "test only" warning and switch its tips off.
// WoW Forever's official Armory (Nov 2026) has no realms: characters have a name and a
// surname ("Bruxo Magic") and live at /forever/<region>/armory/character/<slug>.
// Routes, tried in order:
//  1. Battle.net API (optional client ID/secret from develop.battle.net).
//  2. The public Armory page, which embeds the character as JSON.
//  3. The same page opened in a hidden browser window (when plain requests are blocked).
const { net, BrowserWindow } = require('electron');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36';
const SLOT = {
  HEAD: 'head', NECK: 'neck', SHOULDER: 'shoulder', BACK: 'back', CLOAK: 'back', CHEST: 'chest', ROBE: 'chest', SHIRT: 'shirt', TABARD: 'tabard',
  WRIST: 'wrist', HANDS: 'hands', HAND: 'hands', WAIST: 'waist', LEGS: 'legs', FEET: 'feet', FINGER_1: 'finger1', FINGER_2: 'finger2',
  TRINKET_1: 'trinket1', TRINKET_2: 'trinket2', MAIN_HAND: 'mainhand', OFF_HAND: 'offhand', RANGED: 'ranged'
};
// Keys of the "gear" object on the Armory page, when an item carries no slot type
const GEAR_KEY = {
  head: 'head', neck: 'neck', shoulder: 'shoulder', back: 'back', chest: 'chest', shirt: 'shirt', tabard: 'tabard', wrist: 'wrist',
  hand: 'hands', waist: 'waist', leg: 'legs', foot: 'feet', leftFinger: 'finger1', rightFinger: 'finger2',
  leftTrinket: 'trinket1', rightTrinket: 'trinket2', weapon: 'mainhand', offhand: 'offhand', offHand: 'offhand', ranged: 'ranged'
};
const QUALITY = { POOR: 'poor', COMMON: 'common', UNCOMMON: 'uncommon', RARE: 'rare', EPIC: 'epic', LEGENDARY: 'epic', ARTIFACT: 'epic', HEIRLOOM: 'rare' };

const LOCALE = /^[a-z]{2}-[a-z]{2}$/i;

function gameOf(tag) {
  const t = String(tag || '').toLowerCase();
  if (!t || /worldsoul|retail|modern|^wow$/.test(t)) return 'retail';
  if (/forever/.test(t)) return 'forever';
  if (/classic|mists|cata|wrath|anniversary|era|hardcore|sod|season/.test(t)) return 'classic';
  return 'desconhecido';
}

/**
 * Accepts every Armory link format:
 *  - new:  worldofwarcraft.blizzard.com/<locale>/<game>/<region>/armory/character/<realm>/<name>   (game "worldsoul" = Retail)
 *  - old:  worldofwarcraft.blizzard.com/<locale>/character/<flavor-region>/<realm>/<name>            ("us" alone = Retail)
 */
const FOREVER_SUBPAGE = /^(achievements|collections|pvp|reputation|professions|mounts|pets|toys|heirlooms|appearances|raids|dungeons)$/i;

function parseUrl(url) {
  const u = String(url || '').trim();
  // WoW Forever: …/forever/us/armory/character/bruxo-magic (optionally /achievements and so on)
  let f = u.match(/\/forever\/(us|eu|kr|tw)\/armory\/character\/([^/?#]+)(?:\/([^/?#]+))?/i);
  if (f && (!f[3] || FOREVER_SUBPAGE.test(f[3]))) {
    return { region: f[1].toLowerCase(), realm: '', name: decodeURIComponent(f[2]).toLowerCase(), game: 'forever', flavor: 'forever', format: 'forever' };
  }
  let m = u.match(/\/(?:([a-z0-9-]+)\/)?(us|eu|kr|tw)\/armory\/character\/([^/?#]+)\/([^/?#]+)/i);
  if (m) {
    const tag = m[1] && !LOCALE.test(m[1]) ? m[1].toLowerCase() : '';
    return { region: m[2].toLowerCase(), realm: decodeURIComponent(m[3]).toLowerCase(), name: decodeURIComponent(m[4]).toLowerCase(), game: gameOf(tag), flavor: tag, format: 'new' };
  }
  m = u.match(/character\/([a-z0-9-]*?)-?(us|eu|kr|tw)\/([^/?#]+)\/([^/?#]+)/i);
  if (!m) return null;
  const prefix = (m[1] || '').toLowerCase();
  return { region: m[2].toLowerCase(), realm: decodeURIComponent(m[3]).toLowerCase(), name: decodeURIComponent(m[4]).toLowerCase(), game: gameOf(prefix), flavor: prefix, format: 'old' };
}

/** Same page in Brazilian Portuguese, so race, class and item names come translated */
function ptUrl(url) {
  return String(url).trim().replace(/^(https?:\/\/[^/]+\/)[a-z]{2}-[a-z]{2}\//i, '$1pt-br/');
}

/* ---------- search: a search link or just a name ---------- */
const HOST = 'https://worldofwarcraft.blizzard.com';
// Game versions the Armory search covers when only a name is typed (WoW Forever first)
const SEARCH_TAGS = ['forever', 'worldsoul', 'classic1x', 'classicann', 'classic'];

const slugify = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['\u2019]/g, '').trim().replace(/\s+/g, '-');

/**
 * Accepts:
 *  - a search link: …/<locale>/<game>/<region>/armory?q=Nome  (also the old …/<locale>/search?q=Nome)
 *  - a bare name, optionally with the realm: "Berkz", "Berkz-Stormrage", "Berkz @ Emerald Dream"
 *  - a WoW Forever name with its surname: "Bruxo Magic" (Forever is searched with the whole text)
 */
function parseSearch(input) {
  const u = String(input || '').trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u) || /^[\w.-]+\.(blizzard|worldofwarcraft)\.com\//i.test(u)) {
    let url;
    try { url = new URL(/^https?:/i.test(u) ? u : 'https://' + u); } catch (_) { return null; }
    if (!/(^|\.)(worldofwarcraft\.blizzard\.com|worldofwarcraft\.com)$/i.test(url.hostname)) return null;
    const q = (url.searchParams.get('q') || '').trim();
    if (!q || /\/character\//i.test(url.pathname)) return null;
    const m = url.pathname.match(/\/(?:([a-z0-9-]+)\/)?(us|eu|kr|tw)\/armory\/?$/i);
    const tag = m && m[1] && !LOCALE.test(m[1]) ? m[1].toLowerCase() : 'worldsoul';
    return { query: q, full: q, realm: '', region: m ? m[2].toLowerCase() : 'us', tags: [tag], from: 'link' };
  }
  // WoW names are a single word of letters (2 to 12); anything after it is the realm,
  // or, on WoW Forever, the surname
  const m = u.match(/^([\p{L}]{2,12})(?:(?:\s*[-@,/]\s*|\s+)(.+))?$/u);
  if (!m) return null;
  const rest = (m[2] || '').trim();
  return { query: m[1], full: rest ? `${m[1]} ${rest.replace(/[-@,/]+/g, ' ')}`.replace(/\s+/g, ' ') : m[1], realm: rest, region: 'us', tags: SEARCH_TAGS.slice(), from: 'name' };
}

function searchRow(r, tag, region) {
  const link = (r.link && (r.link.url || r.link.href)) || r.url || '';
  const path = String(link).replace(/\/$/, '');
  if (!/\/armory\/character\//.test(path)) return null;
  const cls = r.class || {};
  const ruleset = r.ruleset && r.ruleset.name;
  return {
    name: [r.name, r.surname].filter(Boolean).join(' '),
    level: r.level || null,
    cls: cls.name || '', clsSlug: cls.slug || '', isWarlock: String(cls.enum || '').toUpperCase() === 'WARLOCK' || cls.id === 9,
    race: (r.race && r.race.name) || '',
    faction: (r.faction && r.faction.name) || '',
    realm: (r.realm && r.realm.name) || (gameOf(tag) === 'forever' ? `WoW Forever${ruleset ? ' · ' + ruleset : ''}` : ''),
    realmSlug: (r.realm && r.realm.slug) || '',
    slug: r.slug || '',
    guild: (r.guild && r.guild.name) || '',
    region: r.region || region,
    game: gameOf(tag), tag,
    avatar: (r.avatar && r.avatar.url) || null,
    url: HOST + '/pt-br' + (path.startsWith('/') ? path : '/' + path)
  };
}

async function searchOne(tag, region, query) {
  const url = `${HOST}/pt-br/${tag}/${region}/armory?q=${encodeURIComponent(query)}`;
  const res = await fetchRaw(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8', Accept: 'text/html' } }, 20000);
  if (!res.ok) throw new Error('busca do Armory HTTP ' + res.status);
  const html = await res.text();
  const model = extractJsonAfter(html, 'model = {"categories"');
  const cat = model && (model.categories || []).find((c) => c.enum === 'CHARACTER');
  if (cat) return (cat.results || []).map((r) => searchRow(r, tag, region)).filter(Boolean);
  // Fallback: character links in the HTML (no class or level, but still selectable)
  const seen = new Set();
  const out = [];
  for (const m of html.matchAll(/href="(\/forever\/(?:us|eu|kr|tw)\/armory\/character\/([^/"]+))\/?"/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const name = decodeURIComponent(m[2]).split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    out.push({ name, level: null, cls: '', clsSlug: '', isWarlock: false, race: '', faction: '', realm: 'WoW Forever', realmSlug: '', slug: m[2], guild: '', region, game: 'forever', tag, avatar: null, url: HOST + '/pt-br' + m[1] });
  }
  if (out.length) return out;
  for (const m of html.matchAll(/href="(\/[a-z0-9]+\/(?:us|eu|kr|tw)\/armory\/character\/([^/"]+)\/([^/"]+))\/?"/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ name: decodeURIComponent(m[3]), level: null, cls: '', clsSlug: '', isWarlock: false, race: '', faction: '', realm: decodeURIComponent(m[2]), realmSlug: m[2], guild: '', region, game: gameOf(tag), tag, avatar: null, url: HOST + '/pt-br' + m[1] });
  }
  return out;
}

/** Search the Armory. Returns { ok, query, realm, results }: WoW Forever characters first, then by level. */
async function search(input) {
  const s = parseSearch(input);
  if (!s) return { ok: false, message: 'Digite um nome (ex.: Berkz ou Berkz-Stormrage) ou cole um link do Armory.' };
  const errors = [];
  const queryFor = (tag) => (gameOf(tag) === 'forever' ? s.full || s.query : s.query);
  const lists = await Promise.all(s.tags.map((tag) => searchOne(tag, s.region, queryFor(tag)).catch((err) => { errors.push(String(err.message || err)); return []; })));
  let results = [].concat(...lists);
  let forever = results.filter((r) => r.game === 'forever');
  let others = results.filter((r) => r.game !== 'forever');
  if (s.full && s.full !== s.query && forever.length) {
    // "Bruxo Magic": keep the Forever character with exactly that name and surname when there is one
    const exact = forever.filter((r) => slugify(r.name) === slugify(s.full));
    if (exact.length) forever = exact;
  }
  if (s.realm && others.length) {
    const want = slugify(s.realm);
    const narrowed = others.filter((r) => slugify(r.realm) === want || r.realmSlug === want || slugify(r.realm).startsWith(want));
    // A Forever surname is not a realm: when Forever found the character, other games' namesakes go
    others = narrowed.length ? narrowed : forever.length ? [] : others;
  }
  results = forever.concat(others);
  if (!results.length && errors.length === s.tags.length) return { ok: false, message: errors[0] || 'A busca do Armory não respondeu.', query: s.full || s.query };
  results.sort((a, b) => ((b.game === 'forever') - (a.game === 'forever')) || ((b.level || 0) - (a.level || 0)) || a.realm.localeCompare(b.realm));
  return { ok: true, query: s.from === 'link' ? s.query : s.full || s.query, realm: forever.length ? '' : s.realm, from: s.from, results: results.slice(0, 40) };
}

async function fetchRaw(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 15000);
  try { return await net.fetch(url, { ...(opts || {}), signal: ctrl.signal }); } finally { clearTimeout(timer); }
}

/* ---------- normalizers (API and page share the item format) ---------- */
function num(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object') return num(v.effective != null ? v.effective : v.value != null ? v.value : v.rating_bonus != null ? v.rating_bonus : v.base);
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

const ITEM_STAT = {
  STAMINA: 'sta', INTELLECT: 'int', SPIRIT: 'spi', STRENGTH: 'str', AGILITY: 'agi', SPELL_POWER: 'sp', SPELL_DAMAGE: 'sp', HEALING: 'heal',
  HIT_RATING: 'hit', SPELL_HIT_RATING: 'hit', MELEE_HIT_RATING: 'hit', RANGED_HIT_RATING: 'hit',
  CRIT_RATING: 'crit', SPELL_CRIT_RATING: 'crit', CRIT_SPELL_RATING: 'crit', MELEE_CRIT_RATING: 'crit', RANGED_CRIT_RATING: 'crit',
  HASTE_RATING: 'haste', MASTERY_RATING: 'mastery', VERSATILITY: 'vers', ATTACK_POWER: 'ap', RANGED_ATTACK_POWER: 'rap',
  DEFENSE_SKILL_RATING: 'def', DEFENSE_RATING: 'def', DODGE_RATING: 'dodge', PARRY_RATING: 'parry', BLOCK_RATING: 'block', BLOCK_VALUE: 'blockv',
  MANA_REGENERATION: 'mp5', MANA_REGEN: 'mp5', SPELL_PENETRATION: 'pen', EXPERTISE_RATING: 'exp', ARMOR_PENETRATION_RATING: 'arp',
  SHADOW_DAMAGE: 'shadow', FIRE_DAMAGE: 'fire', FROST_DAMAGE: 'frost', ARCANE_DAMAGE: 'arcane', NATURE_DAMAGE: 'nature', HOLY_DAMAGE: 'holy'
};

// Forever writes school damage as BONUS_STAT_SHADOW_DAMAGE_DONE ("+7 Dano de Sombra"), spell power as BONUS_STAT_SPELL_DAMAGE_DONE…
function statKey(t) {
  if (ITEM_STAT[t]) return ITEM_STAT[t];
  const m = t.match(/^(?:BONUS_STAT_)?(ARCANE|FIRE|FROST|HOLY|NATURE|SHADOW|SPELL)_DAMAGE(?:_DONE)?$/);
  if (m) return m[1] === 'SPELL' ? 'sp' : m[1].toLowerCase();
  if (/^(?:BONUS_STAT_)?(?:SPELL_)?HEALING(?:_DONE)?$/.test(t)) return 'heal';
  return null;
}

function normItem(e, key) {
  if (!e || typeof e !== 'object') return null;
  const slotType = (e.slot && (e.slot.type || e.slot)) || e.slotType || (e.inventory_type && e.inventory_type.type);
  const slot = SLOT[String(slotType || '').toUpperCase()] || GEAR_KEY[key];
  if (!slot) return null;
  const stats = {};
  for (const s of e.stats || []) {
    const k = statKey(String((s.type && (s.type.type || s.type)) || '').toUpperCase());
    if (k) stats[k] = num(s.value != null ? s.value : s);
  }
  const assets = (e.media && e.media.content && e.media.content.assets) || [];
  const icon = (assets.find((a) => a.key === 'icon') || {}).value || null;
  const dps = e.weapon && e.weapon.dps ? num(e.weapon.dps) : 0;
  const armor = e.armor ? num(e.armor) : 0;
  return {
    slot,
    dps: dps ? Math.round(dps * 10) / 10 : undefined,
    armor: armor || undefined,
    id: (e.item && e.item.id) || e.itemId || e.id || null,
    name: typeof e.name === 'string' ? e.name : (e.name && (e.name.pt_BR || e.name.en_US)) || (e.item && e.item.name) || '',
    quality: QUALITY[String((e.quality && (e.quality.type || e.quality)) || '').toUpperCase()] || 'common',
    ilvl: num(e.level || e.itemLevel || e.item_level) || null,
    icon,
    stats
  };
}

const STAT_ENUM = {
  HEALTH: 'health', MANA: 'mana', STAMINA: 'stamina', INTELLECT: 'intellect', SPIRIT: 'spirit', STRENGTH: 'strength', AGILITY: 'agility',
  SPELLPOWER: 'spellPower', SPELL_POWER: 'spellPower', CRITICALSTRIKE: 'crit', SPELLCRIT: 'crit', SPELL_CRIT: 'crit', HASTE: 'haste',
  SPELLHIT: 'hit', SPELL_HIT: 'hit', HIT: 'hit', MASTERY: 'mastery', VERSATILITY: 'versatility', ARMOR: 'armor', MANAREGEN: 'mp5',
  SPELLPENETRATION: 'penetration', ITEMLEVEL: 'itemLevel', ATTACKPOWER: 'attackPower', ATTACK_POWER: 'attackPower',
  RANGEDATTACKPOWER: 'rangedAttackPower', DODGE: 'dodge', PARRY: 'parry', BLOCK: 'block', DEFENSE: 'defense'
};

/** Armory page stats: { groups: { 0: { name, stats: [{ enum, value: { type, value } }] } } } */
function pageStats(st) {
  if (!st) return null;
  const out = {};
  const lists = [];
  if (st.groups) Object.values(st.groups).forEach((g) => lists.push(...(g.stats || [])));
  if (Array.isArray(st.overview)) lists.push(...st.overview);
  for (const s of lists) {
    const key = STAT_ENUM[String(s.enum || '').toUpperCase()];
    if (!key || out[key] != null) continue;
    const v = s.value && (s.value.value != null ? s.value.value : null);
    if (typeof v === 'number') out[key] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** Battle.net API /statistics */
function apiStats(s) {
  if (!s) return null;
  const pick = (...keys) => { for (const k of keys) if (s[k] != null) return num(s[k]); return undefined; };
  const out = {
    health: pick('health'), mana: pick('power', 'mana'), stamina: pick('stamina'), intellect: pick('intellect'), spirit: pick('spirit'),
    spellPower: pick('spell_power'), crit: pick('spell_crit'), haste: pick('spell_haste'), hit: pick('spell_hit'),
    mastery: pick('mastery'), versatility: pick('versatility'), armor: pick('armor'), penetration: pick('spell_penetration'), mp5: pick('mana_regen')
  };
  Object.keys(out).forEach((k) => out[k] == null && delete out[k]);
  return out;
}

/** Pictures the Armory shows: full-body render (transparent PNG, 1600×1200), avatar (84×84) and fallbacks */
const RENDER_HOST = /^https:\/\/render\.worldofwarcraft\.com\//;
function cleanMedia(m) {
  const out = {};
  for (const [k, v] of Object.entries(m || {})) if (typeof v === 'string' && RENDER_HOST.test(v)) out[k] = v;
  return Object.keys(out).length ? out : null;
}
function pageMedia(ch) {
  const r = ch.render || {};
  const u = (x) => (x && typeof x === 'object' ? x.url : typeof x === 'string' ? x : null) || null;
  const avatar = u(ch.avatar);
  return cleanMedia({
    main: u(r.foreground) || u(ch.renderRaw),
    fallback: u(r.foregroundFallback),
    avatar,
    inset: avatar ? avatar.replace(/-avatar\.jpg(\?.*)?$/, '-inset.jpg') : null,
    background: u(r.background)
  });
}

const nameOf = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? v.name || '' : '') || '';

/** Talents the Armory shows (WoW Forever pages): every tree with points, names in Portuguese */
function talentsOf(specs) {
  if (!Array.isArray(specs) || !specs.length) return null;
  const trees = specs.filter((x) => x && typeof x === 'object').map((x) => ({
    id: String(x.id || ''), name: nameOf(x), active: !!x.active, points: Number(x.spentPoints) || 0,
    list: (x.talents || []).map((t) => ({ name: t.name || '', rank: Number(t.rank) || 0, icon: (t.icon && t.icon.url) || null })).filter((t) => t.name)
  }));
  const points = trees.reduce((n, x) => n + x.points, 0);
  return trees.length ? { points, trees } : null;
}

function professionsOf(p) {
  if (!p || typeof p !== 'object') return null;
  const row = (x) => {
    const tier = (x.tiers || [])[0] || {};
    return { name: x.name || tier.name || '', skill: Number(tier.skillPoints) || 0, max: Number(tier.maxSkillPoints) || 0 };
  };
  const out = { primary: (p.primaries || []).map(row).filter((x) => x.name), secondary: (p.secondaries || []).map(row).filter((x) => x.name) };
  return out.primary.length || out.secondary.length ? out : null;
}

function fromState(state, c) {
  const ch = (state && (state.character || (state.summary && state.summary.character))) || null;
  if (!ch) throw new Error('a página abriu, mas sem dados reconhecíveis do personagem');
  const items = [];
  if (ch.gear && typeof ch.gear === 'object' && !Array.isArray(ch.gear)) {
    for (const [k, v] of Object.entries(ch.gear)) { const it = normItem(v, k); if (it) items.push(it); }
  } else if (Array.isArray(ch.gear)) {
    ch.gear.forEach((v) => { const it = normItem(v); if (it) items.push(it); });
  }
  const active = (Array.isArray(ch.specs) && (ch.specs.find((x) => x && x.active) || ch.specs[0])) || null;
  const ruleset = ch.ruleset && ch.ruleset.name;
  return {
    ok: true,
    level: ch.level || null,
    character: {
      name: [ch.name || c.name, ch.surname].filter(Boolean).join(' '),
      realm: nameOf(ch.realm) || c.realm || (c.game === 'forever' || ruleset ? `WoW Forever${ruleset ? ' · ' + ruleset : ''}` : ''),
      race: nameOf(ch.race), raceSlug: ch.race && ch.race.slug,
      cls: nameOf(ch.class), clsSlug: ch.class && ch.class.slug,
      spec: nameOf(ch.spec) || (active && active.name) || '', faction: nameOf(ch.faction),
      factionEnum: (ch.faction && ch.faction.enum) || '',
      guild: nameOf(ch.guild),
      ilvl: ch.averageItemLevel || null
    },
    talents: talentsOf(ch.specs),
    professions: professionsOf(ch.professions),
    media: pageMedia(ch),
    items,
    stats: pageStats(ch.stats)
  };
}

/* ---------- route 1: Battle.net API ---------- */
let tokenCache = { value: '', until: 0, key: '' };
async function bnetToken(region, id, secret) {
  const key = id + ':' + region;
  if (tokenCache.key === key && Date.now() < tokenCache.until) return tokenCache.value;
  const res = await fetchRaw('https://oauth.battle.net/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) throw new Error(res.status === 401 ? 'Client ID/Secret da Battle.net recusados' : 'Battle.net HTTP ' + res.status);
  const data = await res.json();
  tokenCache = { value: data.access_token, until: Date.now() + (data.expires_in - 120) * 1000, key };
  return data.access_token;
}

async function viaApi(c, creds) {
  const token = await bnetToken(c.region, creds.id, creds.secret);
  const base = `https://${c.region}.api.blizzard.com/profile/wow/character/${encodeURIComponent(c.realm)}/${encodeURIComponent(c.name)}`;
  const namespaces = c.game === 'retail' ? [`profile-${c.region}`]
    : c.game === 'classic' ? [`profile-${c.flavor}-${c.region}`, `profile-classic-${c.region}`, `profile-classic1x-${c.region}`]
      : [`profile-forever-${c.region}`, `profile-classic-${c.region}`, `profile-classic1x-${c.region}`];
  let lastStatus = 0;
  for (const ns of namespaces) {
    const q = `?namespace=${ns}&locale=pt_BR`;
    const prof = await fetchRaw(base + q, { headers: { Authorization: 'Bearer ' + token } });
    lastStatus = prof.status;
    if (!prof.ok) continue;
    const p = await prof.json();
    const eq = await fetchRaw(base + '/equipment' + q, { headers: { Authorization: 'Bearer ' + token } });
    const st = await fetchRaw(base + '/statistics' + q, { headers: { Authorization: 'Bearer ' + token } });
    const equipment = eq.ok ? await eq.json() : {};
    let media = null;
    try {
      const md = await fetchRaw(base + '/character-media' + q, { headers: { Authorization: 'Bearer ' + token } });
      if (md.ok) {
        const a = {};
        ((await md.json()).assets || []).forEach((x) => { a[x.key] = x.value; });
        media = cleanMedia({ main: a['main-raw'] || a.main, avatar: a.avatar, inset: a.inset });
      }
    } catch (_) { /* pictures are optional */ }
    return {
      ok: true, via: 'api', namespace: ns, level: p.level || null, media,
      character: {
        name: p.name, realm: p.realm && p.realm.name, race: p.race && p.race.name, cls: p.character_class && p.character_class.name,
        clsSlug: p.character_class && String(p.character_class.name || '').toLowerCase(), spec: p.active_spec && p.active_spec.name,
        faction: p.faction && p.faction.name, guild: p.guild && p.guild.name, ilvl: p.average_item_level || null
      },
      items: (equipment.equipped_items || []).map((e) => normItem(e)).filter(Boolean),
      stats: st.ok ? apiStats(await st.json()) : null
    };
  }
  throw new Error(lastStatus === 404 ? 'personagem não encontrado na API' : 'API respondeu HTTP ' + lastStatus);
}

/* ---------- route 2: public page ---------- */
function extractJsonAfter(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(html.slice(start, i + 1)); } catch (_) { return null; } } }
  }
  return null;
}

class NotFound extends Error {}

async function viaPage(url, c) {
  // Character pages are large (about 2 MB on Retail): allow time for slow connections
  const res = await fetchRaw(ptUrl(url), { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8', Accept: 'text/html' } }, 35000);
  // The Armory answers 404 or 500 when the character doesn't exist
  if (res.status === 404 || res.status === 500) throw new NotFound('personagem não encontrado nesse link (confira região, reino e nome)');
  if (!res.ok) throw new Error('Armory HTTP ' + res.status);
  const html = await res.text();
  const state = extractJsonAfter(html, 'characterProfileInitialState');
  if (!state) throw new Error('a página abriu, mas sem dados do personagem');
  return { ...fromState(state, c), via: 'page' };
}

/* ---------- route 3: hidden browser window ---------- */
function viaWindow(url, c) {
  return new Promise((resolve, reject) => {
    const w = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { partition: 'persist:armory', sandbox: true, contextIsolation: true } });
    const done = (fn, arg) => { clearTimeout(timer); if (!w.isDestroyed()) w.destroy(); fn(arg); };
    const timer = setTimeout(() => done(reject, new Error('o Armory demorou demais para abrir')), 30000);
    w.webContents.once('did-finish-load', async () => {
      try {
        const json = await w.webContents.executeJavaScript('JSON.stringify(window.characterProfileInitialState || null)');
        const state = JSON.parse(json);
        if (!state) return done(reject, new Error('a página abriu, mas sem dados do personagem'));
        done(resolve, { ...fromState(state, c), via: 'page' });
      } catch (err) { done(reject, err); }
    });
    w.loadURL(ptUrl(url), { userAgent: UA }).catch((err) => done(reject, err));
  });
}

async function read(settings, creds) {
  let url = String(settings.armoryUrl || '').trim();
  if (!url) return { ok: false, state: 'off', message: 'Nenhum link do Armory salvo.' };
  let c = parseUrl(url);
  let resolved = null;
  if (!c) {
    // A search link or just a name: find the character first
    const s = parseSearch(url);
    if (!s) return { ok: false, state: 'bad-url', message: 'Não reconheci esse link. Cole o link da página do personagem, o link de uma busca do Armory ou só o nome e sobrenome do personagem.', at: new Date().toISOString() };
    const found = await search(url);
    const at = new Date().toISOString();
    if (!found.ok) return { ok: false, state: 'waiting', message: 'A busca do Armory não respondeu: ' + found.message, at };
    const list = found.results;
    const where = found.realm ? ` em ${found.realm}` : '';
    if (!list.length) return { ok: false, state: 'not-found', query: found.query, message: `Nenhum personagem chamado ${found.query}${where} no Armory.`, at };
    // One WoW Forever character among Retail/Classic namesakes: that's the one
    const forever = list.filter((r) => r.game === 'forever');
    const pick = list.length === 1 ? list[0] : forever.length === 1 ? forever[0] : null;
    if (!pick) {
      return {
        ok: false, state: 'choose', query: found.query, matches: list, at,
        message: `${list.length} personagens chamados ${found.query}${where}${forever.length ? ` (${forever.length} no WoW Forever)` : ''}. Escolha qual é o seu.`
      };
    }
    resolved = { from: url, url: pick.url, query: found.query, matches: list };
    url = pick.url;
    c = parseUrl(url);
    if (!c) return { ok: false, state: 'bad-url', message: 'A busca achou o personagem, mas o link dele veio num formato desconhecido.', at };
  }
  const errors = [];
  // Anything above level 60 can't be a WoW Forever character: show it, but only as a test
  const tag = (r) => {
    const game = c.game === 'desconhecido' && r.level > 60 ? 'retail' : c.game;
    return { ...r, game, testMode: game === 'retail' || (r.level || 0) > 60, region: c.region, link: canonicalUrl(url, c), resolved, at: new Date().toISOString() };
  };
  if (creds && creds.id && creds.secret && c.realm) {
    try { return tag(await viaApi(c, creds)); } catch (err) { errors.push(String(err.message || err)); }
  }
  try { return tag(await viaPage(url, c)); } catch (err) {
    errors.push(String(err.message || err));
    if (err instanceof NotFound) return { ok: false, state: 'not-found', game: c.game, message: err.message, details: errors, resolved, at: new Date().toISOString() };
  }
  try { return tag(await viaWindow(url, c)); } catch (err) { errors.push(String(err.message || err)); }
  return { ok: false, state: 'waiting', game: c.game, message: errors[errors.length - 1] || 'Sem resposta do Armory.', details: errors, resolved, at: new Date().toISOString() };
}

/** Link to open the character in the browser (always the Portuguese page) */
function canonicalUrl(url) { return /^https?:\/\/[^/]*worldofwarcraft/i.test(url) ? ptUrl(url) : null; }

module.exports = { read, search, parseUrl, parseSearch, ptUrl, fromState };

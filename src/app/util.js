/* Shared helpers and app state */
(function () {
  'use strict';

  const G = (window.G = {
    content: null,
    settings: {},
    character: null,
    feed: { items: [], lastRefresh: null, errors: [] },
    variant: {},
    preset: {},
    readIds: new Set(),
    community: { items: [], errors: [], status: {} }
  });

  try {
    const saved = JSON.parse(localStorage.getItem('grimorio.ui') || '{}');
    if (saved.variant) G.variant = saved.variant;
    if (saved.preset) G.preset = saved.preset;
    if (Array.isArray(saved.read)) G.readIds = new Set(saved.read);
  } catch (_) { /* first run */ }

  G.saveUi = function () {
    try {
      localStorage.setItem('grimorio.ui', JSON.stringify({ variant: G.variant, preset: G.preset, read: [...G.readIds].slice(-600) }));
    } catch (_) { /* storage unavailable */ }
  };

  const U = (window.U = {});

  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  U.esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  U.icon = (id, cls) => `<svg class="${cls || ''}" aria-hidden="true"><use href="#${id}"/></svg>`;

  U.sourceKindIcon = (kind) => ({
    blizzard: 'src-blizzard', warcrafttavern: 'src-warcrafttavern',
    wowhead: 'src-wowhead', community: 'src-community', news: 'src-news', icyveins: 'src-news'
  }[kind] || 'src-news');

  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  U.parseDate = (d) => {
    if (!d) return new Date();
    // Plain dates (YYYY-MM-DD) are read as local noon so they never slip a day
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) { const [y, m, day] = d.split('-').map(Number); return new Date(y, m - 1, day, 12); }
    return new Date(d);
  };

  U.relDate = (d) => {
    const date = U.parseDate(d);
    const now = new Date();
    const days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(date.getFullYear(), date.getMonth(), date.getDate())) / 864e5);
    if (days <= 0) {
      const mins = Math.round((now - date) / 6e4);
      if (mins < 60 && mins >= 0) return mins <= 1 ? 'agora' : `há ${mins} min`;
      return 'hoje';
    }
    if (days === 1) return 'ontem';
    if (days < 7) return `há ${days} dias`;
    return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  };

  U.fullDate = (d) => {
    const date = U.parseDate(d);
    return date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  U.clock = (d) => U.parseDate(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  /* The centered game-style message */
  let msgTimer = null;
  U.say = (text, kind) => {
    const el = U.$('#ui-message');
    el.textContent = text;
    el.classList.toggle('error', kind === 'error');
    el.classList.add('show');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => el.classList.remove('show'), 2600);
  };

  /* Game tooltip that follows an anchor */
  U.tip = {
    show(anchor, html) {
      const t = U.$('#tooltip');
      t.innerHTML = html;
      t.hidden = false;
      const r = anchor.getBoundingClientRect();
      const tr = t.getBoundingClientRect();
      let x = r.right + 10;
      let y = r.top;
      if (x + tr.width > window.innerWidth - 8) x = r.left - tr.width - 10;
      if (y + tr.height > window.innerHeight - 8) y = window.innerHeight - tr.height - 8;
      t.style.left = Math.max(8, x) + 'px';
      t.style.top = Math.max(8, y) + 'px';
    },
    hide() { U.$('#tooltip').hidden = true; }
  };

  /* Gilded corners on every frame */
  /** Network jargon from a failed Armory read → a sentence for the player */
  U.armoryError = (m) => {
    const t = String(m || '');
    if (!t) return 'O Armory não respondeu agora.';
    if (/ERR_|ENOTFOUND|fetch failed|timed? ?out|abort|socket|ECONN/i.test(t)) return 'O Armory não respondeu agora (sem conexão?). O app tenta de novo sozinho.';
    return t.slice(0, 160);
  };
  /** "2.10.0" is newer than "2.9.1" */
  U.newer = (a, b) => {
    const p = (v) => (String(v || '').replace(/^v/i, '').match(/^(\d+)\.(\d+)(?:\.(\d+))?/) || []).slice(1).map((n) => Number(n || 0));
    const x = p(a); const y = p(b);
    if (x.length < 3 || y.length < 3) return false;
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
    return false;
  };
  U.decorateFrames = (root) => {
    U.$$('[data-frame]', root).forEach((f) => {
      if (f.querySelector(':scope > .corner')) return;
      ['tl', 'tr', 'bl', 'br'].forEach((c) => {
        f.insertAdjacentHTML('afterbegin', `<svg class="corner c-${c}" aria-hidden="true"><use href="#corner"/></svg>`);
      });
    });
  };

  /* Runic glyphs around the summoning circle (drawn, not a font) */
  U.drawRunes = () => {
    const g = U.$('#runes');
    if (!g) return;
    const designs = [
      'M0 -6V6M0 -6L4 -2M0 0L4 -4',
      'M-3 -6V6M-3 -2L3 -6M-3 2L3 6',
      'M0 -6V6M-4 -6L4 6',
      'M-3 6V-6L3 0L-3 6',
      'M0 -6V6M-4 -2L0 2L4 -2',
      'M-4 -6L4 6M4 -6L-4 6',
      'M0 -6V6M0 -3L4 -6M0 3L-4 6',
      'M-3 -6V6M3 -6V6M-3 0H3',
      'M0 -6L4 0L0 6L-4 0Z',
      'M-3 -6V6M-3 -6L3 -3L-3 0'
    ];
    const n = 30;
    const r = 118;
    let html = '';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = 150 + r * Math.cos(a);
      const y = 150 + r * Math.sin(a);
      const deg = (a * 180) / Math.PI + 90;
      html += `<path d="${designs[(i * 7) % designs.length]}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg.toFixed(1)})"/>`;
    }
    g.innerHTML = html;
  };

  /* WoW icons from Wowhead's CDN, with a lettered tile when offline */
  U.wowIcon = (name, size, cls, label) => {
    const letter = U.esc(String(label || name || '?').replace(/[^A-Za-zÀ-ú]/g, '').charAt(0).toUpperCase() || '?');
    if (!name) return `<span class="wicon wicon-fb ${cls || ''}">${letter}</span>`;
    return `<img class="wicon ${cls || ''}" src="https://wow.zamimg.com/images/wow/icons/${size || 'medium'}/${U.esc(name)}.jpg" alt="" loading="lazy" draggable="false" data-letter="${letter}">`;
  };
  /* Armory portrait (84×84) with a lettered tile when it can't load */
  U.avatar = (url, name, cls) => {
    const letter = U.esc(String(name || '?').charAt(0).toUpperCase() || '?');
    if (!url || !/^https:\/\/render\.worldofwarcraft\.com\//.test(url)) return `<span class="arm-av arm-av-fb ${cls || ''}">${letter}</span>`;
    return `<img class="arm-av ${cls || ''}" src="${U.esc(url)}" alt="" loading="lazy" draggable="false" data-letter="${letter}">`;
  };
  // WoW class colors, by the English class slug the Armory uses
  U.CLASS_COLOR = {
    warlock: '#8788ee', mage: '#3fc7eb', priest: '#f0f0f0', druid: '#ff7c0a', rogue: '#fff468', hunter: '#aad372', shaman: '#0070dd',
    paladin: '#f48cba', warrior: '#c69b6d', monk: '#00ff98', 'death-knight': '#c41e3a', 'demon-hunter': '#a330c9', evoker: '#33937f'
  };
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    if (img.classList.contains('slot-img')) {
      // Armory icon offline: fall back to the drawn slot glyph
      const slot = img.closest('.slot');
      const id = slot && slot.dataset.slot;
      const glyph = id ? 'slot-' + (id.startsWith('finger') ? 'finger' : id.startsWith('trinket') ? 'trinket' : id) : 'slot-head';
      img.outerHTML = `<svg aria-hidden="true"><use href="#${glyph}"/></svg>`;
      return;
    }
    // Article pictures that can't load just disappear (the video card keeps its play button)
    if (img.classList.contains('nm-img') || img.classList.contains('nm-hero')) { img.remove(); return; }
    if (img.parentElement && img.parentElement.classList.contains('nm-video')) { img.style.visibility = 'hidden'; return; }
    const isAvatar = img.classList.contains('arm-av');
    if (!img.classList.contains('wicon') && !isAvatar) return;
    const span = document.createElement('span');
    span.className = img.className + (isAvatar ? ' arm-av-fb' : ' wicon-fb');
    span.textContent = img.dataset.letter || '?';
    img.replaceWith(span);
  }, true);

  U.QUALITY = ['var(--q-poor)', 'var(--q-common)', 'var(--q-uncommon)', 'var(--q-rare)', 'var(--q-epic)', 'var(--q-legendary, #ff8000)'];
  U.qColor = (q) => U.QUALITY[typeof q === 'number' ? q : ({ poor: 0, common: 1, uncommon: 2, rare: 3, epic: 4 }[q] || 1)] || U.QUALITY[1];

  const STAT_PT = {
    sta: 'Stamina', int: 'Intelecto', spi: 'Espírito', str: 'Força', agi: 'Agilidade', sp: 'Poder mágico', heal: 'Cura',
    shadow: 'Dano de Sombra', fire: 'Dano de Fogo', frost: 'Dano de Gelo', arcane: 'Dano Arcano', nature: 'Dano de Natureza', holy: 'Dano Sagrado',
    hit: 'Acerto', crit: 'Crítico', haste: 'Haste', pen: 'Penetração mágica', mp5: 'Mana a cada 5 s', ap: 'Poder de ataque',
    rap: 'Poder de ataque à distância', fap: 'Poder de ataque feral', def: 'Defesa', dodge: 'Esquiva', parry: 'Aparo', block: 'Bloqueio',
    blockv: 'Valor de bloqueio', armor: 'Armadura', barmor: 'Armadura extra', arp: 'Penetração de armadura', exp: 'Perícia'
  };
  U.statText = (k, v) => {
    if (k === 'hit') return `+${(v / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% de Acerto`;
    if (k === 'crit') return `+${(v / 14).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% de Crítico`;
    if (k === 'haste') return `+${(v / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% de Haste`;
    return `+${v} ${STAT_PT[k] || k}`;
  };
  U.statChips = (stats) => Object.entries(stats || {}).filter(([k, v]) => v && k !== 'armor').map(([k, v]) => `<span class="stat-chip s-${k}">${U.esc(U.statText(k, v))}</span>`).join('');

  U.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  U.copy = async (text, okMsg) => {
    try {
      await window.grimorio.copy(text);
      U.say(okMsg || 'Copiado');
    } catch (_) { U.say('Não foi possível copiar', 'error'); }
  };
})();

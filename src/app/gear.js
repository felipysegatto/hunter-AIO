/* Gear upgrades: what the character could be wearing in each slot right now, and where to get it.
   Items come from the WoWSims Forever database (MIT); the scoring is the Grimório's own: leveling
   stat weights per role/spec (src/data/classes.json), random-suffix greens rated on their best roll. */
(function () {
  'use strict';
  const { $, esc, icon } = U;

  const Gear = (window.Gear = { db: null, byId: null, filters: null, open: null });

  const SRC = {
    quest: { label: 'Missão', icon: 'src-news' },
    drop: { label: 'Masmorra', icon: 'slot-head' },
    crafted: { label: 'Profissão', icon: 'slot-hands' },
    vendor: { label: 'Vendedor', icon: 'i-pin' },
    rep: { label: 'Reputação', icon: 'i-spark' },
    world: { label: 'Leilão ou mundo', icon: 'src-community' }
  };
  const PROF_PT = {
    Alchemy: 'Alquimia', Blacksmithing: 'Ferraria', Enchanting: 'Encantamento', Engineering: 'Engenharia', Herbalism: 'Herborismo',
    Leatherworking: 'Couraria', Mining: 'Mineração', Skinning: 'Esfolamento', Tailoring: 'Alfaiataria'
  };
  const SCHOOLS = ['arcane', 'fire', 'frost', 'holy', 'nature', 'shadow'];
  const PAIRS = { finger1: 'finger2', finger2: 'finger1', trinket1: 'trinket2', trinket2: 'trinket1' };
  const BASE = (slot) => (slot.startsWith('finger') ? 'finger' : slot.startsWith('trinket') ? 'trinket' : slot);
  const QNAME = ['Ruim', 'Comum', 'Incomum', 'Raro', 'Épico', 'Lendário'];
  const QKEY = { poor: 0, common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 };

  /* ---------- filters (sources), kept per viewer ---------- */
  const DEFAULT_FILTERS = { quest: true, drop: true, crafted: true, vendor: true, rep: true, world: true };
  try { Gear.filters = { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem('grimorio.gear.filters') || '{}') }; } catch (_) { Gear.filters = { ...DEFAULT_FILTERS }; }
  const saveFilters = () => { try { localStorage.setItem('grimorio.gear.filters', JSON.stringify(Gear.filters)); } catch (_) { /* per-viewer convenience */ } };

  Gear.load = async function () {
    if (Gear.db) return;
    try {
      Gear.db = await window.grimorio.getItems();
      Gear.byId = new Map((Gear.db.items || []).map((it) => [it.i, it]));
    } catch (_) { Gear.db = { items: [], suffixes: {} }; Gear.byId = new Map(); }
  };

  /* ---------- who is wearing it ---------- */
  function context() {
    const cls = Char.classInfo();
    if (!cls) return null;
    const spec = Char.specInfo() || cls.specs[0];
    const lvl = Char.level();
    const fx = Char.faction();
    return { cls, spec, lvl, side: fx === 'HORDE' ? 'H' : fx === 'ALLIANCE' ? 'A' : null, w: weights(cls, spec), profs: Char.professions() };
  }
  Gear.context = context;

  function weights(cls, spec) {
    const roles = (G.content.classes && G.content.classes.roles) || {};
    const w = { ...((roles[spec.role] || roles.caster || {}).w || {}) };
    Object.entries(spec.extra || {}).forEach(([k, v]) => { w[k] = (w[k] || 0) + v; });
    // A caster's own schools count almost like spell power; other schools barely
    if (spec.role === 'caster') SCHOOLS.forEach((s) => { w[s] = (spec.school || []).includes(s) ? 0.95 : 0.05; });
    if (spec.noWeaponDps) { w.dps = 0; w.odps = 0; }
    return w;
  }

  /* ---------- can this character use the item? ---------- */
  function maxArmor(cls, lvl) { let m = 1; (cls.armor || []).forEach(([from, a]) => { if (lvl >= from) m = a; }); return m; }
  // Many new Forever items come as "requires level 1" in the database: the item level tells better
  const reqOf = (it) => (it.r && it.r > 1 ? it.r : Math.max(1, (it.l || 1) - 5));

  function usable(it, c, slot) {
    if (it.c && !it.c.includes(c.cls.slug)) return false;
    if (it.f && c.side && it.f !== c.side) return false;
    // Raid gear is not leveling gear
    if ((it.l || 0) > 66) return false;
    const base = BASE(slot);
    if (it.s !== base && !(base === 'offhand' && it.s === 'mainhand')) return false;
    if (it.a && it.s !== 'back' && it.a > maxArmor(c.cls, c.lvl)) return false;
    if (base === 'mainhand') {
      if (!it.w || !(c.cls.weapons || []).includes(it.w)) return false;
      if (it.h === 4 && !(c.cls.twoHand || []).includes(it.w)) return false;
      if (it.h === 3) return false;
    }
    if (base === 'offhand') {
      if (it.s === 'mainhand') {
        // one-handers go in the off hand only for dual wielders
        if (!c.cls.dual || it.h !== 2 || !(c.cls.weapons || []).includes(it.w) || c.lvl < (c.cls.slug === 'rogue' ? 10 : 20)) return false;
      } else if (it.w === 7) { if (!c.cls.shield) return false; }
      else if (it.w === 5 || !it.w) { if (!c.cls.held) return false; }
      else if (!(c.cls.weapons || []).includes(it.w)) return false;
    }
    if (base === 'ranged' && !(c.cls.ranged || []).includes(it.rw)) return false;
    return true;
  }

  /* ---------- score ---------- */
  function suffixStats(it, id) {
    const sx = (Gear.db.suffixes || {})[String(id)];
    if (!sx) return null;
    const st = {};
    Object.entries(sx.st || {}).forEach(([k, m]) => { const v = Math.round((it.rp || 0) * m / 10000); if (v) st[k] = v; });
    return { name: sx.n, st };
  }

  function rawScore(st, dps, slot, c, it) {
    const w = c.w;
    let s = 0;
    Object.entries(st || {}).forEach(([k, v]) => { s += (w[k] || 0) * v; });
    if (dps) {
      const base = BASE(slot);
      if (base === 'mainhand') s += (w.dps || 0) * dps;
      else if (base === 'offhand' && it && it.s === 'mainhand') s += (w.odps || 0) * dps;
      else if (base === 'ranged') s += (w.rdps || 0) * dps;
    }
    return s;
  }

  // Best roll for random-suffix items ("of the Eagle"...)
  function scoreItem(it, slot, c) {
    const fixed = rawScore(it.st, it.dps, slot, c, it);
    if (!it.rs || !it.rs.length) return { score: fixed, st: it.st || {}, suffix: null };
    let best = { score: fixed, st: it.st || {}, suffix: null };
    it.rs.forEach((id) => {
      const sx = suffixStats(it, id);
      if (!sx) return;
      const st = { ...(it.st || {}) };
      Object.entries(sx.st).forEach(([k, v]) => { st[k] = (st[k] || 0) + v; });
      const sc = rawScore(st, it.dps, slot, c, it);
      if (sc > best.score) best = { score: sc, st, suffix: sx.name };
    });
    return best;
  }

  // What the character wears: the database row when the item has fixed stats, the Armory's own numbers otherwise
  function equippedScore(arm, slot, c) {
    if (!arm) return { score: 0, st: {}, item: null };
    const row = arm.id && Gear.byId.get(Number(arm.id));
    if (row && !(row.rs && row.rs.length)) return { score: rawScore(row.st, row.dps, slot, c, row), st: row.st || {}, item: row };
    const st = { ...(arm.stats || {}) };
    const dps = arm.dps || (row && row.dps) || 0;
    if (arm.armor && !st.armor) st.armor = arm.armor;
    // A weapon without DPS means an old reading (v1 format): don't guess a gain for it
    const unknown = !dps && (slot === 'mainhand' || slot === 'ranged');
    return { score: rawScore(st, dps, slot, c, row || { s: BASE(slot) }), st, item: row || null, unknown };
  }

  function sourceOk(it) { return (it.src || []).some((s) => Gear.filters[s.t] !== false); }

  /* ---------- upgrades per slot ---------- */
  let cache = { key: '', data: null };

  Gear.compute = function () {
    if (!Gear.db) return null;
    const c = context();
    if (!c) return null;
    const a = Char.armoryData();
    const items = (a && !Char.isRetail() && a.items) || [];
    const bySlot = {};
    items.forEach((x) => { bySlot[x.slot] = x; });
    // The same items can come back with more detail (a new reading fills in DPS, armor, school damage): key on all of it
    const key = [c.cls.slug, c.spec.id, c.lvl, c.side, JSON.stringify(Gear.filters), items.map((x) => `${x.slot}:${x.id}:${x.dps || ''}:${x.armor || ''}:${JSON.stringify(x.stats || {})}`).join(',')].join('|');
    if (cache.key === key) return cache.data;

    const twoHanded = (() => { const mh = bySlot.mainhand && Gear.byId.get(Number(bySlot.mainhand.id)); return !!(mh && mh.h === 4); })();
    const slots = G.content.gearSlots.filter((s) => s.weight > 0 && !(s.id === 'offhand' && twoHanded));
    const out = {};
    slots.forEach((s) => {
      const eq = equippedScore(bySlot[s.id], s.id, c);
      if (eq.unknown) { out[s.id] = { slot: s, equipped: bySlot[s.id], eq, best: [], soon: [] }; return; }
      const other = PAIRS[s.id] && bySlot[PAIRS[s.id]];
      const otherId = other && Number(other.id);
      const scored = [];
      const soon = [];
      for (const it of Gear.db.items) {
        if (!usable(it, c, s.id) || !sourceOk(it)) continue;
        if (it.u && otherId && it.i === otherId) continue; // unique: already in the other ring/trinket slot
        if (bySlot[s.id] && Number(bySlot[s.id].id) === it.i) continue;
        const req = reqOf(it);
        if (req > c.lvl + 3) continue;
        const sc = scoreItem(it, s.id, c);
        const gain = sc.score - eq.score;
        if (gain <= Math.max(0.6, eq.score * 0.04)) continue;
        const row = { it, req, score: sc.score, gain, pct: eq.score > 0 ? gain / eq.score : 1, empty: !bySlot[s.id], st: sc.st, suffix: sc.suffix };
        (req <= c.lvl ? scored : soon).push(row);
      }
      scored.sort((x, y) => y.score - x.score);
      soon.sort((x, y) => y.score - x.score);
      out[s.id] = { slot: s, equipped: bySlot[s.id] || null, eq, best: dedupe(scored).slice(0, 3), soon: dedupe(soon).filter((x) => !scored[0] || x.score > scored[0].score * 1.08).slice(0, 2) };
    });
    // Two rings / two trinkets share one list: the weaker slot gets the upgrades
    [['finger1', 'finger2'], ['trinket1', 'trinket2']].forEach(([x, y]) => {
      if (!out[x] || !out[y]) return;
      const weak = out[x].eq.score <= out[y].eq.score ? x : y;
      const strong = weak === x ? y : x;
      out[strong].best = [];
      out[strong].soon = [];
    });
    const ranked = Object.values(out).filter((x) => x.best.length).sort((p, q) => q.best[0].gain - p.best[0].gain);
    const data = { c, slots: out, ranked };
    cache = { key, data };
    return data;
  };

  function dedupe(list) {
    const seen = new Set();
    return list.filter((r) => (seen.has(r.it.n) ? false : seen.add(r.it.n)));
  }

  /** Paper-doll badges: the slots with the biggest gains, numbered by priority */
  Gear.flags = function () {
    const d = Gear.compute();
    const flags = {};
    if (!d) return flags;
    d.ranked.slice(0, 5).forEach((x, i) => { flags[x.slot.id] = String(i + 1); });
    return flags;
  };

  /* ---------- sources in words ---------- */
  function sourceText(s, c) {
    if (s.t === 'quest') return `Missão: ${s.name}`;
    if (s.t === 'drop') return `${s.npc || 'Chefe'}${s.zone ? ` · ${s.zone}` : ''}`;
    if (s.t === 'crafted') {
      const pt = PROF_PT[s.prof] || s.prof;
      const mine = (c.profs || []).find((p) => p.name === s.prof);
      return `Feito com ${pt}${mine ? ` · você tem ${mine.skill}/${mine.max}` : ' · ou na Casa de Leilões'}`;
    }
    if (s.t === 'vendor') return `Vendedor: ${s.npc}${s.zone ? ` · ${s.zone}` : ''}`;
    if (s.t === 'rep') return `Reputação: ${s.level ? s.level + ' com ' : ''}${s.faction}`;
    return 'Casa de Leilões ou drop no mundo';
  }
  Gear.sourceText = sourceText;

  function sourcesHtml(it, c, max) {
    const seen = new Set();
    const list = (it.src || []).filter((s) => Gear.filters[s.t] !== false).filter((s) => { const k = s.t + ':' + (s.name || s.npc || s.prof || s.faction || ''); return seen.has(k) ? false : seen.add(k); }).slice(0, max || 2);
    return list.map((s) => `<span class="gr-src s-${esc(s.t)}">${icon((SRC[s.t] || SRC.world).icon)}<span>${esc(sourceText(s, c))}</span></span>`).join('');
  }

  // "+12 damage and healing" comes as two stats in the database: show it once
  const statLine = (st) => {
    const x = { ...(st || {}) };
    if (x.heal && x.sp && x.heal === x.sp) delete x.heal;
    return U.statChips ? U.statChips(x) : '';
  };

  Gear.statLine = statLine;
  // Next to a weak item, percentages explode (+700%): past +300% it just says "muito melhor"
  Gear.gainText = (r) => (r.empty ? 'espaço vazio' : r.pct >= 3 ? 'muito melhor' : `+${Math.round(r.pct * 100)}%`);

  function itemHtml(r, c, opts) {
    const it = r.it;
    const name = it.n + (r.suffix ? ' ' + r.suffix : '');
    const pct = r.empty ? 'vazio' : Gear.gainText(r);
    return `
      <div class="gr-item ${opts && opts.soon ? 'is-soon' : ''}" data-gear-item="${esc(it.i)}" style="--q:${U.qColor(it.q)}">
        ${U.wowIcon(it.ic, 'medium', 'gr-ico', name)}
        <div class="gr-body">
          <div class="gr-name"><b>${esc(name)}</b>${r.suffix ? '<span class="gr-roll">melhor variação</span>' : ''}</div>
          <div class="gr-meta">${opts && opts.slot ? `<span>${esc(opts.slot)}</span>` : ''}<span>nível ${esc(r.req)}</span>${it.l ? `<span>item ${esc(it.l)}</span>` : ''}${it.dps ? `<span>${esc(String(it.dps).replace('.', ','))} DPS</span>` : ''}</div>
          <div class="gr-stats">${statLine(r.st)}</div>
          <div class="gr-srcs">${sourcesHtml(it, c, 2)}</div>
        </div>
        <span class="gr-gain ${r.pct >= 0.25 ? 'big' : ''}" title="Ganho estimado para a sua especialização">${opts && opts.soon ? `nv ${esc(r.req)}` : esc(pct)}</span>
      </div>`;
  }

  function equippedHtml(x) {
    const e = x.equipped;
    if (!e) return '<span class="gr-eq empty">vazio</span>';
    return `<span class="gr-eq" style="--q:${U.qColor(QKEY[e.quality] != null ? QKEY[e.quality] : 1)}">${e.icon && /^https:\/\/render\.worldofwarcraft\.com\//.test(e.icon) ? `<img src="${esc(e.icon)}" alt="">` : icon('slot-' + BASE(x.slot.id))}<span>${esc(e.name || '—')}</span></span>`;
  }

  /* ---------- the Equipment pane ---------- */
  Gear.render = function () {
    const box = $('#pane-gear');
    if (!box) return;
    const c = context();
    if (!c) {
      box.innerHTML = `<div class="list-empty">Conecte o Armory em Ajustes (ou escolha sua classe no painel do guia) para ver as melhorias de equipamento.</div>`;
      return;
    }
    const d = Gear.compute();
    if (!d) { box.innerHTML = '<div class="list-empty">Carregando o banco de itens…</div>'; return; }
    const a = Char.armoryData();
    const hasItems = !!(a && !Char.isRetail() && (a.items || []).length);
    const top = d.ranked.slice(0, 6);
    const chips = Object.keys(SRC).map((k) => `<button class="chip ${Gear.filters[k] !== false ? 'is-on' : ''}" data-gear-filter="${k}">${icon(SRC[k].icon)}${esc(SRC[k].label)}</button>`).join('');
    const soonAll = Object.values(d.slots).flatMap((x) => x.soon.map((r) => ({ ...r, slot: x.slot }))).sort((p, q) => p.req - q.req || q.gain - p.gain).slice(0, 4);

    box.innerHTML = `
      <div class="gr-head">
        <div><b>Melhorias para o nível ${esc(c.lvl)}</b><span>${esc(c.cls.name)} · ${esc(c.spec.pt)} · pesos de ${esc(((G.content.classes.roles || {})[c.spec.role] || {}).label || '')}${c.side ? ` · ${c.side === 'A' ? 'Aliança' : 'Horda'}` : ''}</span></div>
      </div>
      <div class="gr-filters" role="group" aria-label="Fontes">${chips}</div>
      ${hasItems ? '' : `<div class="armory-banner wait">${icon('i-link')}<div><b>Sem o equipamento do Armory</b><span>A lista compara com espaços vazios. Conecte o Armory em Ajustes para comparar com o que você está usando.</span></div></div>`}
      ${top.length ? `<div class="list-section">Maiores ganhos agora <span class="count-pill">${top.length}</span></div>
        ${top.map((x) => itemHtml(x.best[0], c, { slot: x.slot.label })).join('')}`
        : '<div class="list-empty">Nada melhor do que o seu equipamento para o seu nível com essas fontes. Veja o que chega nos próximos níveis.</div>'}
      ${soonAll.length ? `<div class="list-section">Chegando nos próximos níveis</div>${soonAll.map((r) => itemHtml(r, c, { slot: r.slot.label, soon: true })).join('')}` : ''}
      <div class="list-section">Espaço por espaço</div>
      <div class="gr-slots">
        ${Object.values(d.slots).map((x) => `
          <div class="gr-slot ${Gear.open === x.slot.id ? 'is-open' : ''} ${x.best.length ? 'has-up' : ''}" data-gear-slot="${esc(x.slot.id)}">
            <button class="gr-slot-head" data-gear-toggle="${esc(x.slot.id)}">
              ${icon('slot-' + BASE(x.slot.id))}<span class="gr-slot-name">${esc(x.slot.label)}</span>
              ${equippedHtml(x)}
              <span class="gr-slot-best">${x.best.length ? `<b>${esc(x.best[0].empty ? 'vazio' : Gear.gainText(x.best[0]))}</b>` : '<span class="dim">ok</span>'}</span>
            </button>
            ${Gear.open === x.slot.id ? `<div class="gr-slot-body">${x.best.length ? x.best.map((r) => itemHtml(r, c)).join('') : '<p class="dim">Nada melhor agora para este espaço.</p>'}${x.soon.length ? `<div class="gr-soon-h">Logo adiante</div>${x.soon.map((r) => itemHtml(r, c, { soon: true })).join('')}` : ''}</div>` : ''}
          </div>`).join('')}
      </div>
      <p class="path-note">Pontuação do Grimório para upar: dano primeiro, depois sobrevivência e mana, com pesos por especialização. Itens com variação aleatória (“of the Eagle”…) contam pela melhor variação. Banco de itens: WoWSims Forever. Missões aparecem sem filtro de facção quando o banco não informa a facção.</p>`;
  };

  /** Tooltip extra for a paper-doll slot */
  Gear.slotTip = function (slotId) {
    const d = Gear.compute();
    const x = d && d.slots[slotId];
    if (!x || !x.best.length) return '';
    const r = x.best[0];
    return `<div class="tt-sep"></div><div class="tt-dim">Melhor troca agora (${esc(Gear.gainText(r))})</div>
      <div style="color:${U.qColor(r.it.q)}">${esc(r.it.n + (r.suffix ? ' ' + r.suffix : ''))}</div><div class="tt-dim">${esc(sourceText((r.it.src || [])[0] || { t: 'world' }, d.c))}</div>`;
  };

  /** "Stamina 29 → 41": what the best item in every slot would add */
  Gear.potential = function () {
    const d = Gear.compute();
    if (!d) return null;
    const add = {};
    Object.values(d.slots).forEach((x) => {
      const r = x.best[0];
      if (!r) return;
      const keys = new Set([...Object.keys(r.st || {}), ...Object.keys(x.eq.st || {})]);
      keys.forEach((k) => { add[k] = (add[k] || 0) + (Number((r.st || {})[k]) || 0) - (Number((x.eq.st || {})[k]) || 0); });
    });
    return add;
  };

  Gear.openSlot = function (slotId) {
    Gear.open = slotId;
    Char.showPane('gear');
    Gear.render();
    const el = document.querySelector(`[data-gear-slot="${slotId}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  };

  Gear.bind = function () {
    const box = $('#pane-gear');
    if (!box) return;
    box.addEventListener('click', (e) => {
      const f = e.target.closest('[data-gear-filter]');
      if (f) {
        const k = f.dataset.gearFilter;
        Gear.filters[k] = Gear.filters[k] === false;
        saveFilters();
        Gear.render();
        Char.renderStats();
        return;
      }
      const t = e.target.closest('[data-gear-toggle]');
      if (t) { Gear.open = Gear.open === t.dataset.gearToggle ? null : t.dataset.gearToggle; Gear.render(); }
    });
    box.addEventListener('mouseover', (e) => {
      const el = e.target.closest('[data-gear-item]');
      if (!el) return;
      const it = Gear.byId.get(Number(el.dataset.gearItem));
      if (!it) return;
      const c = context();
      U.tip.show(el, `<div class="tt-title" style="color:${U.qColor(it.q)}">${esc(it.n)}</div>
        <div class="tt-dim">${esc(QNAME[it.q] || '')}${it.l ? ` · nível do item ${esc(it.l)}` : ''} · requer nível ${esc(reqOf(it))}</div>
        ${[...new Set((it.src || []).map((s) => sourceText(s, c)))].map((t) => `<div>${esc(t)}</div>`).join('')}`);
    });
    box.addEventListener('mouseout', (e) => { if (e.target.closest('[data-gear-item]')) U.tip.hide(); });
  };
})();

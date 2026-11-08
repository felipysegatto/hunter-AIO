/* Character: paper doll, attributes, gear upgrades and the leveling route — for any class.
   Class, race, spec and faction come from the Armory; without it the player picks a class by hand. */
(function () {
  'use strict';
  const { $, $$, esc, icon } = U;

  const Char = (window.Char = { pane: 'stats', showDone: false });

  const SLOT_ICON = (id) => 'slot-' + (id.startsWith('finger') ? 'finger' : id.startsWith('trinket') ? 'trinket' : id);
  const save = U.debounce(async (patch) => { G.character = await window.grimorio.saveCharacter(patch); }, 250);
  const norm = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');

  function armoryData() { return (G.character.armory && G.character.armory.data) || null; }
  // Characters outside WoW Forever (Retail, or above 60) are only for testing: they never set the level or the advice
  function isRetail() { const a = armoryData(); return !!(a && (a.testMode || a.game === 'retail' || (a.level || 0) > 60)); }
  function level() { const a = armoryData(); return (a && a.level && !isRetail() ? Math.min(60, a.level) : 0) || Number(G.character.level) || 1; }
  Char.armoryData = armoryData;
  Char.isRetail = isRetail;
  Char.level = () => level();

  /* ---------- who: class, spec, race, faction ---------- */
  const CL = () => (G.content.classes && G.content.classes.classes) || {};
  Char.classSlug = function () {
    const a = armoryData();
    const fromArmory = a && a.character && a.character.clsSlug;
    if (fromArmory && CL()[fromArmory]) return fromArmory;
    return CL()[G.settings.classSlug] ? G.settings.classSlug : null;
  };
  Char.classInfo = function () {
    const slug = Char.classSlug();
    return slug ? { slug, ...CL()[slug] } : null;
  };
  Char.specInfo = function () {
    const cls = Char.classInfo();
    if (!cls) return null;
    const specs = cls.specs || [];
    const match = (x) => specs.find((s) => [s.id, norm(s.en), norm(s.pt)].includes(norm(x)));
    // 1) the Armory tree with the most points
    const t = Char.armoryTalents();
    if (t && t.points > 0) {
      const top = [...t.trees].sort((p, q) => q.points - p.points)[0];
      const m = top && (match(top.id) || match(top.name));
      if (m) return m;
    }
    // 2) the build picked in the guide
    const tree = window.Guide && Guide.mainTree ? Guide.mainTree() : null;
    if (tree && match(tree)) return match(tree);
    // 3) the one picked by hand, else the first
    return match(G.settings.specId) || specs[0] || null;
  };
  Char.raceInfo = function () {
    const a = armoryData();
    const slug = a && a.character && a.character.raceSlug;
    const races = (G.content.classes && G.content.classes.races) || {};
    return slug ? { slug, ...(races[slug] || { name: a.character.race || slug }) } : null;
  };
  Char.faction = function () {
    const a = armoryData();
    if (a && !isRetail() && a.character && a.character.factionEnum) return a.character.factionEnum;
    const r = Char.raceInfo();
    return (r && r.faction) || G.settings.faction || null;
  };
  Char.armoryTalents = () => { const a = armoryData(); return a && !isRetail() && a.talents ? a.talents : null; };
  Char.professions = () => { const a = armoryData(); return (a && a.professions && a.professions.primary) || []; };

  function identity() {
    const a = armoryData();
    const who = a && a.character;
    const cls = Char.classInfo();
    if (who && (isRetail() || a.level)) return `Nível ${a.level || '?'} ${who.race || ''} ${who.cls || ''}`.replace(/\s+/g, ' ').trim();
    return `Nível ${level()}${cls ? ' · ' + cls.name : ''}`;
  }

  /* ---------- paper doll ---------- */
  Char.renderDoll = function () {
    const slots = G.content.gearSlots;
    const data = armoryData();
    const flags = !isRetail() && window.Gear ? Gear.flags() : {};
    const bySlot = {};
    ((data && data.items) || []).forEach((it) => { bySlot[it.slot] = it; });
    const slotHtml = (s) => {
      const item = bySlot[s.id];
      const flag = flags[s.id] ? `<span class="slot-flag" title="Prioridade de troca">${flags[s.id]}</span>` : '';
      const pic = item && item.icon && /^https:\/\/render\.worldofwarcraft\.com\//.test(item.icon) ? `<img class="slot-img" src="${esc(item.icon)}" alt="" draggable="false">` : icon(SLOT_ICON(s.id));
      return `<button class="slot ${item ? 'filled' : ''} ${flags[s.id] ? 'has-up' : ''}" data-slot="${esc(s.id)}" style="${item ? `--q:${U.qColor(item.quality)}` : ''}" aria-label="${esc(s.label)}${item ? ': ' + esc(item.name || '') : ' (vazio)'}">${pic}${flag}</button>`;
    };
    $('#slots-left').innerHTML = slots.filter((s) => s.side === 'left').map(slotHtml).join('');
    $('#slots-right').innerHTML = slots.filter((s) => s.side === 'right').map(slotHtml).join('');
    $('#slots-bottom').innerHTML = slots.filter((s) => s.side === 'bottom').map(slotHtml).join('');
    const who = data && data.character;
    const cls = Char.classInfo();
    $('#t-char').textContent = (who && who.name) || 'Seu personagem';
    $('#doll-level').textContent = identity();
    $('#doll-level').style.color = cls ? cls.color : '';
    const fx = Char.faction();
    $('.doll-race').innerHTML = who
      ? `${esc(who.realm || '')}${who.guild ? ` · &lt;${esc(who.guild)}&gt;` : ''}${isRetail() ? ` <span class="game-badge retail">${data.game === 'retail' ? 'Retail' : 'Fora do Forever'} · teste</span>` : data.game === 'classic' ? ' <span class="game-badge">Classic</span>' : ''}`
      : cls ? `${esc(cls.name)}${fx ? ' · ' + (fx === 'HORDE' ? 'Horda' : 'Aliança') : ''} · escolhido à mão` : 'Conecte o Armory em Ajustes';

    const url = G.settings.armoryUrl;
    const st = G.character.armory || {};
    const pill = $('#armory-pill');
    pill.classList.toggle('saved', !!url);
    pill.classList.toggle('live', !!(url && data));
    pill.innerHTML = `${icon('i-link')}${!url ? 'Conectar Armory' : data ? `Armory · ${esc(U.clock(st.lastOk))}` : 'Armory · aguardando'}`;
    $('#portrait-note').textContent = !url
      ? 'Conecte o Armory em Ajustes: o app identifica raça, classe e especialização e preenche itens, atributos e foto.'
      : data ? `${data.media ? 'Foto e equipamento' : 'Equipamento'} do Armory (${data.via === 'api' ? 'API da Battle.net' : 'página pública'})${isRetail() ? ' · só para teste' : ''}. Clique num espaço para ver as melhorias.`
        : st.state === 'choose' ? 'Vários personagens com esse nome: escolha o seu em Ajustes → Armory.'
          : 'Link salvo. O app confere o Armory sozinho e preenche tudo assim que a Blizzard publicar o personagem.';
    const glyph = $('#portrait-glyph');
    if (glyph) glyph.innerHTML = cls ? U.wowIcon(cls.icon, 'large', 'class-glyph', cls.name) : '<svg><use href="#sigil"/></svg>';
    const gearCount = window.Gear && !isRetail() ? Object.keys(flags).length : 0;
    const c = $('#c-gear');
    if (c) c.textContent = gearCount || '';
    renderFigure(data);
  };

  /*
   * The character picture the Armory shows. Retail pages carry a full-body render, which stands in
   * the summoning circle; Classic-family pages (and so, likely, Forever) only carry the 84×84 portrait,
   * which becomes a medallion in the middle of the circle. Each step falls back to the next one.
   */
  /*
   * Zoom the render so the character (whatever the race) fills ~88% of the circle's height, feet near
   * the bottom of the circle, centred. `box` is where the opaque pixels sit in the picture (measured
   * by the main process). Returns the CSS variables for .is-fit, or null to keep the default framing.
   */
  function fitFigure(box) {
    if (!box || !(box.y1 > box.y0) || !(box.x1 > box.x0)) return null;
    const ratio = box.ratio || 4 / 3;
    const tall = 0.84;
    const feet = 0.94;
    let h = Math.min(3.6, Math.max(1.05, tall / (box.y1 - box.y0)));
    const wide = (box.x1 - box.x0) * h * ratio;
    if (wide > 1.02) h *= 1.02 / wide; // a wide character (wings, big weapon) must still fit sideways
    const top = feet - box.y1 * h;
    const left = 0.5 - ((box.x0 + box.x1) / 2) * h * ratio;
    const pct = (n) => (n * 100).toFixed(2) + '%';
    return { '--fh': pct(h), '--ft': pct(top), '--fl': pct(left) };
  }

  function renderFigure(data) {
    const box = $('#portrait-figure');
    const portrait = $('#portrait');
    if (!box) return;
    const m = (data && data.media) || {};
    const chain = [[m.main, 'full'], [m.fallback, 'silhouette'], [m.avatar, 'avatar']].filter(([src]) => src);
    portrait.classList.toggle('has-link', !!(data && data.link));
    portrait.title = data && data.link ? 'Abrir este personagem no Armory' : '';
    const key = chain.map(([src]) => src).join('|') + JSON.stringify([m.box || null, m.fallbackBox || null]);
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.innerHTML = '';
    portrait.classList.remove('has-figure', 'figure-full', 'figure-silhouette', 'figure-avatar');
    if (!chain.length) return;
    const img = new Image();
    img.alt = (data.character && data.character.name) || '';
    img.draggable = false;
    img.decoding = 'async';
    let step = 0;
    const tryStep = () => {
      const [src, kind] = chain[step];
      const fit = fitFigure(kind === 'full' ? m.box : kind === 'silhouette' ? m.fallbackBox : null);
      img.className = 'figure-img is-' + kind + (fit ? ' is-fit' : '');
      img.dataset.kind = kind;
      img.dataset.fit = fit ? '1' : '';
      if (fit) for (const [k, v] of Object.entries(fit)) img.style.setProperty(k, v);
      img.src = src;
    };
    img.onload = () => {
      portrait.classList.add('has-figure', 'figure-' + img.dataset.kind);
      portrait.classList.toggle('figure-fit', !!img.dataset.fit);
      requestAnimationFrame(() => img.classList.add('is-in'));
    };
    img.onerror = () => {
      step += 1;
      if (step < chain.length) { tryStep(); return; }
      box.innerHTML = '';
      portrait.classList.remove('has-figure');
    };
    box.appendChild(img);
    tryStep();
  }

  function slotTooltip(id) {
    const s = G.content.gearSlots.find((x) => x.id === id);
    const data = armoryData();
    const item = data && (data.items || []).find((i) => i.slot === id);
    const up = window.Gear && !isRetail() ? Gear.slotTip(id) : '';
    if (!item) {
      return `<div class="tt-title">${esc(s.label)}</div><div class="tt-dim">${G.settings.armoryUrl ? (data ? 'Espaço vazio' : 'Aguardando o Armory') : 'Sem dados: conecte o Armory em Ajustes'}</div>${up}`;
    }
    return `<div class="tt-title" style="color:${U.qColor(item.quality)}">${esc(item.name || s.label)}</div>
      <div>${esc(s.label)}</div>
      ${item.ilvl ? `<div class="tt-yellow">Nível do item ${esc(item.ilvl)}</div>` : ''}
      ${Object.keys(item.stats || {}).length ? `<div class="tt-green">${Object.entries(item.stats).filter(([k]) => k !== 'armor').map(([k, v]) => esc(U.statText(k, v))).join('<br>')}</div>` : ''}
      ${up}${up ? '<div class="tt-dim" style="margin-top:4px">Clique para ver as melhorias</div>' : ''}`;
  }

  /* ---------- attributes, by role ---------- */
  const n1 = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const n0 = (v) => Math.round(Number(v) || 0).toLocaleString('pt-BR');
  // The Armory may report hit as a percentage or as rating (10 rating = 1% in Forever)
  const pct = (v) => (v > 40 ? v / 10 : v);
  const RETAIL_ROWS = [
    ['health', 'Vida'], ['mana', 'Mana'], ['stamina', 'Stamina'], ['intellect', 'Intelecto'], ['spellPower', 'Poder mágico'],
    ['crit', 'Crítico', '%'], ['haste', 'Aceleração', '%'], ['mastery', 'Maestria', '%'], ['versatility', 'Versatilidade']
  ];
  // Armory attribute ← item stats it grows with
  const FROM_GEAR = {
    stamina: ['sta'], intellect: ['int'], spirit: ['spi'], strength: ['str'], agility: ['agi'], armor: ['armor', 'barmor'], mp5: ['mp5'],
    attackPower: ['ap'], spellPower: ['sp']
  };

  function armoryBanner() {
    const url = G.settings.armoryUrl;
    const st = G.character.armory || {};
    const data = armoryData();
    if (!url) {
      return `<div class="armory-banner off">${icon('i-link')}<div><b>Atributos zerados até o Armory responder.</b><span>Salve o link do Armory (ou o nome do personagem) em Ajustes e o app preenche tudo sozinho: raça, classe, itens e atributos.</span></div><button class="btn btn-sm" data-armory="setup">Conectar</button></div>`;
    }
    if (!data) {
      if (st.state === 'choose') {
        return `<div class="armory-banner choose">${icon('i-link')}<div><b>Qual ${esc(st.query || 'personagem')} é o seu?</b><span>${esc(st.message || '')}</span></div><button class="btn btn-sm" data-armory="setup">Escolher</button></div>`;
      }
      const title = { 'not-found': 'Personagem não encontrado.', 'bad-url': 'Link não reconhecido.' }[st.state] || 'Aguardando o Armory.';
      const action = st.state === 'bad-url' ? '<button class="btn btn-sm" data-armory="setup">Corrigir</button>' : '<button class="btn btn-quiet btn-sm" data-armory="now">Tentar agora</button>';
      return `<div class="armory-banner wait">${icon(st.state === 'bad-url' ? 'i-warn' : 'i-refresh')}<div><b>${title}</b><span>${esc(!st.message ? 'Ainda sem leitura.' : st.state === 'bad-url' || st.state === 'not-found' ? st.message : U.armoryError(st.message))}${st.at ? ` · tentativa às ${esc(U.clock(st.at))}` : ''}</span></div>${action}</div>`;
    }
    if (isRetail()) {
      const d = armoryData();
      const why = d.game === 'retail' ? 'Personagem do WoW Retail · só para teste' : `Personagem de nível ${d.level} (fora do WoW Forever) · só para teste`;
      return `<div class="armory-banner retail">${icon('i-warn')}<div><b>${esc(why)}</b><span>Os números abaixo vêm do Armory, mas melhorias de equipamento e dicas valem só para o WoW Forever e ficam desligadas para este personagem.</span></div><button class="btn btn-quiet btn-sm" data-armory="now">Ler agora</button></div>`;
    }
    return `<div class="armory-banner ok">${icon('i-check')}<div><b>Armory · ${esc(U.clock(st.lastOk))}</b><span>${data.via === 'api' ? 'API da Battle.net' : 'Página pública'} · confere sozinho a cada ${esc(G.settings.armoryMinutes || 60)} min${st.ok === false ? ' · a última tentativa falhou, mostrando a leitura anterior' : ''}</span></div><button class="btn btn-quiet btn-sm" data-armory="now">Ler agora</button></div>`;
  }

  Char.renderStats = function () {
    const data = armoryData();
    const stats = (data && data.stats) || {};
    const retail = isRetail();
    const lvl = level();
    const spec = Char.specInfo();
    const role = spec ? spec.role : 'caster';
    const rows = retail ? RETAIL_ROWS : ((G.content.classes && G.content.classes.statRows) || {})[role] || RETAIL_ROWS;
    const add = !retail && window.Gear ? Gear.potential() : null;
    const fmt = (k, suf, v) => (suf === '%' ? n1(k === 'hit' ? pct(v) : v) + '%' : n0(v));

    const body = rows.map(([k, label, suf]) => {
      const cur = Number(stats[k]) || 0;
      const plus = add && FROM_GEAR[k] ? FROM_GEAR[k].reduce((n, key) => n + (Number(add[key]) || 0), 0) : null;
      const has = plus != null && Math.round(plus) > 0;
      return `
        <div class="goal-row ${has ? 'up' : ''}">
          <span class="goal-name">${esc(label)}</span>
          <b class="goal-cur">${fmt(k, suf, cur)}</b>
          <span class="goal-meta">${has ? `${fmt(k, suf, cur + plus)} <i>+${n0(plus)}</i>` : '—'}</span>
        </div>`;
    }).join('');

    const roleLabel = spec && G.content.classes.roles[role] ? G.content.classes.roles[role].label : '';
    $('#pane-stats').innerHTML = `
      ${armoryBanner()}
      <div class="goal-table ${data && data.stats ? 'is-live' : 'is-zero'}">
        <div class="goal-head"><span>Atributo</span><span>Atual</span><span>${retail ? '—' : 'Com melhorias'}</span></div>
        ${body}
      </div>
      ${retail ? '' : `<p class="goal-note">${spec ? `Atributos de ${esc(roleLabel.toLowerCase())} (${esc(spec.pt)}). ` : ''}“Com melhorias” soma o que as trocas sugeridas na aba Equipamento acrescentam para o nível ${lvl}. Acerto e crítico em % vêm do Armory.</p>`}`;
    Char.renderDoll();
  };

  /* ---------- route: the guide for your level + quests that reward upgrades ---------- */
  const TYPE = {
    classe: { label: 'Missão de classe', icon: 'sigil', order: 0 },
    noticia: { label: 'Da notícia', icon: 'i-spark', order: 1 },
    missao: { label: 'Missão', icon: 'src-news', order: 2 },
    masmorra: { label: 'Masmorra', icon: 'slot-head', order: 3 },
    profissao: { label: 'Profissão', icon: 'slot-hands', order: 4 },
    zona: { label: 'Zona', icon: 'i-pin', order: 5 }
  };

  // The curated route of v1 was written for Alliance warlocks; it stays for them
  function entries() {
    const route = G.content.route || {};
    const cls = Char.classSlug();
    if (cls !== 'warlock' || Char.faction() === 'HORDE') return [];
    return (route.entries || []).slice();
  }

  function rewardHtml(r) {
    if (!r) return '';
    const it = r.item && r.item.name ? r.item : null;
    const alt = r.alt && r.alt.name ? r.alt : null;
    const one = (x) => `<span class="q-item" style="--q:${U.qColor(x.quality == null ? 2 : x.quality)}">${U.wowIcon(x.icon, 'small', 'q-ico', x.name)}<b>${esc(x.name)}</b></span>${U.statChips(x.stats)}`;
    if (it) return `<div class="q-reward">${one(it)}${alt ? `<div class="q-alt"><span class="dim">ou</span> ${one(alt)}</div>` : ''}${r.text ? `<div class="q-reward-text">${icon('i-spark')}${esc(r.text)}</div>` : ''}</div>`;
    return r.text ? `<div class="q-reward"><span class="q-reward-text">${icon('i-spark')}${esc(r.text)}</span></div>` : '';
  }

  function questHtml(e, mode) {
    const t = TYPE[e.type] || TYPE.missao;
    const lv = e.min === e.max ? `${e.min}` : `${e.min}–${e.max}`;
    const done = mode === 'done';
    return `
      <div class="quest t-${esc(e.type)} ${mode === 'next' ? 'is-next' : ''}" data-q="${esc(e.id)}">
        <div class="q-head">
          <span class="q-type">${icon(t.icon)}${esc(t.label)}</span>
          ${e.pack ? '<span class="tag tag-ai">atualização</span>' : ''}
          <span class="grow"></span>
          <span class="q-lvl" title="Faixa de nível">Nv ${esc(lv)}</span>
        </div>
        <div class="q-title">${esc(e.title)}${e.pt ? `<small>${esc(e.pt)}</small>` : ''}</div>
        ${e.where ? `<div class="q-where">${icon('i-pin')}${esc(e.zone && e.zone !== e.where ? e.zone + ' · ' : '')}${esc(e.where)}</div>` : ''}
        ${mode === 'now' && e.steps && e.steps.length ? `<ol class="q-steps">${e.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
        ${mode !== 'done' ? rewardHtml(e.reward) : ''}
        ${mode === 'now' && e.why ? `<div class="q-why">${esc(e.why)}</div>` : ''}
        <div class="q-actions">
          ${done
            ? `<button class="btn btn-quiet btn-sm" data-undo="${esc(e.id)}">Desfazer</button>`
            : `<button class="btn btn-sm q-done" data-done="${esc(e.id)}">${icon('i-check')}Marcar como feita</button>`}
          <span class="grow"></span>
          ${e.src ? `<button class="linkish" data-url="${esc(e.src)}">${icon('i-out')}Fonte</button>` : ''}
        </div>
      </div>`;
  }

  // Quests whose reward beats what you wear, for your level
  function upgradeQuestsHtml() {
    const d = window.Gear && !isRetail() ? Gear.compute() : null;
    if (!d) return '';
    const rows = [];
    Object.values(d.slots).forEach((x) => x.best.forEach((r) => {
      const q = (r.it.src || []).find((s) => s.t === 'quest');
      if (q && Gear.filters.quest !== false) rows.push({ q, r, slot: x.slot });
    }));
    rows.sort((p, q) => q.r.gain - p.r.gain);
    const seen = new Set();
    const list = rows.filter((x) => (seen.has(x.q.name) ? false : seen.add(x.q.name))).slice(0, 6);
    if (!list.length) return '';
    return `<div class="list-section">Missões que dão equipamento melhor <span class="count-pill">${list.length}</span></div>
      ${list.map((x) => `
        <div class="quest t-missao gr-quest" data-gear-slot-open="${esc(x.slot.id)}">
          <div class="q-head"><span class="q-type">${icon('src-news')}Missão</span><span class="grow"></span><span class="q-lvl">${esc(x.slot.label)} · ${esc(Gear.gainText(x.r))}</span></div>
          <div class="q-title">${esc(x.q.name)}</div>
          <div class="q-reward"><span class="q-item" style="--q:${U.qColor(x.r.it.q)}">${U.wowIcon(x.r.it.ic, 'small', 'q-ico', x.r.it.n)}<b>${esc(x.r.it.n + (x.r.suffix ? ' ' + x.r.suffix : ''))}</b></span>${Gear.statLine(x.r.st)}</div>
        </div>`).join('')}`;
  }

  Char.renderPath = function () {
    const lvl = level();
    const fromArmory = !!(armoryData() && armoryData().level && !isRetail());
    const done = new Set(G.character.done || []);
    const all = entries();
    const sort = (a, b) => (TYPE[a.type] || TYPE.missao).order - (TYPE[b.type] || TYPE.missao).order || a.min - b.min;
    const now = all.filter((e) => !done.has(e.id) && lvl >= e.min - 1 && lvl <= e.max).sort(sort);
    const next = all.filter((e) => !done.has(e.id) && e.min - 1 > lvl && e.min <= lvl + 6).sort((a, b) => a.min - b.min || sort(a, b)).slice(0, 6);
    const doneList = all.filter((e) => done.has(e.id)).sort((a, b) => a.min - b.min);

    $('#pane-path').innerHTML = `
      <div class="path-head">
        <span class="path-label">Seu nível</span>
        <div class="stepper ${fromArmory ? 'is-locked' : ''}">
          <button class="icon-btn icon-btn-sm" data-lvl="-1" ${fromArmory ? 'disabled' : ''} aria-label="Diminuir nível">−</button>
          <input class="input" id="path-level" type="number" min="1" max="60" value="${lvl}" ${fromArmory ? 'disabled' : ''} aria-label="Nível atual">
          <button class="icon-btn icon-btn-sm" data-lvl="1" ${fromArmory ? 'disabled' : ''} aria-label="Aumentar nível">+</button>
        </div>
        <span class="path-src">${fromArmory ? `${icon('i-link')}nível lido do Armory` : 'até o Armory chegar, ajuste aqui'}</span>
      </div>
      ${window.Guide ? Guide.pathCardHtml(lvl) : ''}
      ${upgradeQuestsHtml()}
      ${now.length ? `<div class="list-section">Rota curada para o nível ${lvl} <span class="count-pill">${now.length}</span></div>${now.map((e) => questHtml(e, 'now')).join('')}` : ''}
      ${next.length ? `<div class="list-section">Logo adiante</div>${next.map((e) => questHtml(e, 'next')).join('')}` : ''}
      ${doneList.length ? `<div class="list-section">Feitas <span class="count-pill">${doneList.length}</span>
          <button class="linkish" id="toggle-done">${Char.showDone ? 'esconder' : 'mostrar'}</button></div>
        ${Char.showDone ? doneList.map((e) => questHtml(e, 'done')).join('') : ''}` : ''}
      <p class="path-note">A rota junta a dica do guia para a sua faixa de nível, o que treinar no instrutor (quando o guia traz essa lista) e as missões cuja recompensa melhora o seu equipamento.</p>`;
  };

  Char.renderAll = function () {
    if (window.Gear) Gear.render();
    Char.renderStats();
    Char.renderPath();
  };

  Char.showPane = function (id) {
    Char.pane = id;
    $$('#doll-tabs .tab').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.pane === id)));
    $$('#doll-body .pane').forEach((p) => { p.hidden = p.id !== 'pane-' + id; });
  };

  Char.setLevel = function (v) {
    const lvl = Math.max(1, Math.min(60, Math.round(Number(v) || 1)));
    G.character.level = lvl;
    save({ level: lvl });
    Char.renderAll();
    if (window.Guide) Guide.renderSide();
  };

  function markDone(id, on) {
    const done = new Set(G.character.done || []);
    if (on) done.add(id); else done.delete(id);
    G.character.done = [...done];
    save({ done: G.character.done });
  }

  Char.readArmory = async function () {
    U.say('Consultando o Armory…');
    G.character = await window.grimorio.refreshArmory();
    G.settings = await window.grimorio.getSettings();
    Char.renderAll();
    const st = G.character.armory || {};
    const who = st.data && st.data.character;
    let msg;
    if (st.ok) {
      msg = st.relinked && who ? `Encontrei ${who.name} · ${who.cls || ''} ${st.data.level || ''} · ${who.realm || ''}`.replace(/\s+/g, ' ')
        : st.game === 'retail' ? 'Armory lido · personagem do Retail (teste)' : 'Armory lido';
    } else {
      msg = {
        choose: 'Vários personagens com esse nome · escolha o seu em Ajustes → Armory',
        'not-found': st.query ? `Nenhum ${st.query} encontrado no Armory` : 'Personagem não encontrado no Armory',
        'bad-url': 'Link não reconhecido · cole o link do personagem, da busca ou só o nome'
      }[st.state] || 'O Armory não respondeu agora · tento de novo sozinho';
    }
    U.say(msg, st.ok ? undefined : st.state === 'choose' ? undefined : 'error');
    return st;
  };

  Char.bind = function () {
    const doll = $('#paperdoll');
    doll.addEventListener('mouseover', (e) => { const s = e.target.closest('.slot'); if (s) U.tip.show(s, slotTooltip(s.dataset.slot)); });
    doll.addEventListener('mouseout', (e) => { if (e.target.closest('.slot')) U.tip.hide(); });
    doll.addEventListener('click', (e) => {
      const s = e.target.closest('.slot');
      if (!s) return;
      U.tip.hide();
      if (!G.settings.armoryUrl && !Char.classInfo()) { Settings.open('armory'); return; }
      if (window.Gear) Gear.openSlot(s.dataset.slot);
    });

    $('#armory-pill').addEventListener('click', () => Settings.open('armory'));
    $('.portrait-stage').addEventListener('click', () => {
      const d = armoryData();
      if (d && d.link) window.grimorio.open(d.link);
      else if (!G.settings.armoryUrl) Settings.open('armory');
    });

    $('#doll-tabs').addEventListener('click', (e) => {
      const t = e.target.closest('.tab');
      if (!t) return;
      Char.showPane(t.dataset.pane);
      if (Char.pane === 'gear' && window.Gear) Gear.render();
    });

    $('#pane-stats').addEventListener('click', (e) => {
      const b = e.target.closest('[data-armory]');
      if (!b) return;
      if (b.dataset.armory === 'setup') Settings.open('armory');
      else Char.readArmory();
    });

    const pane = $('#pane-path');
    pane.addEventListener('click', (e) => {
      const step = e.target.closest('[data-lvl]');
      if (step) { Char.setLevel(level() + Number(step.dataset.lvl)); return; }
      const d = e.target.closest('[data-done]');
      if (d) {
        const card = d.closest('.quest');
        markDone(d.dataset.done, true);
        card.classList.add('is-leaving');
        U.say('Missão marcada como feita');
        setTimeout(() => Char.renderPath(), 320);
        return;
      }
      const u = e.target.closest('[data-undo]');
      if (u) { markDone(u.dataset.undo, false); Char.renderPath(); return; }
      if (e.target.id === 'toggle-done') { Char.showDone = !Char.showDone; Char.renderPath(); return; }
      const g = e.target.closest('[data-gear-slot-open]');
      if (g && window.Gear) Gear.openSlot(g.dataset.gearSlotOpen);
    });
    pane.addEventListener('change', (e) => { if (e.target.id === 'path-level') Char.setLevel(e.target.value); });
  };
})();

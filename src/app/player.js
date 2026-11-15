/* Aba "Jogador": Armory de outro jogador, com o mesmo visual do seu Armory (foto, equipamentos, atributos) */
(function () {
  'use strict';
  const { $, esc, icon } = U;
  const Player = (window.Player = { data: null, pane: 'stats' });

  const SLOT_ICON = (id) => 'slot-' + (id.startsWith('finger') ? 'finger' : id.startsWith('trinket') ? 'trinket' : id);
  const QC = { legendary: '#ff8000', artifact: '#e6cc80', heirloom: '#00ccff' };
  const qcolor = (q) => QC[q] || U.qColor(q);
  const CLS = { hunter: '#aad372', warrior: '#c69b6d', paladin: '#f48cba', rogue: '#fff468', priest: '#ffffff', shaman: '#0070dd', mage: '#3fc7eb', warlock: '#8788ee', druid: '#ff7c0a' };
  const n1 = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const n0 = (v) => Math.round(Number(v) || 0).toLocaleString('pt-BR');
  const pct = (v) => (v > 40 ? v / 10 : v);
  const slug = (n) => String(n).trim().toLowerCase().replace(/\s+/g, '-');
  const say = (t) => { const el = $('#p-status'); if (el) el.textContent = t || ''; };

  Player.urlFor = (name, region) => `https://worldofwarcraft.blizzard.com/pt-br/forever/${region || 'us'}/armory/character/${encodeURIComponent(slug(name))}`;

  // Tenta o link direto (quando vem do ranking) e depois "Nome Sobrenome" nas duas ordens
  Player.load = async function (directUrl) {
    Player.ensure();
    const name = $('#p-name').value.trim();
    if (!name && !directUrl) { say('Digite o nome do jogador.'); return; }
    const region = $('#p-region').value;
    const parts = name.split(/\s+/).filter(Boolean);
    const urls = [];
    if (directUrl) urls.push(String(directUrl).replace(/\/[a-z]{2}-[a-z]{2}\/forever\//i, '/pt-br/forever/'));
    if (parts.length >= 2) { urls.push(Player.urlFor(parts.join(' '), region)); urls.push(Player.urlFor(parts.slice().reverse().join(' '), region)); }
    else if (name) urls.push(Player.urlFor(name, region));
    const go = $('#p-go');
    go.disabled = true;
    say('Lendo o Armory…');
    let last = null;
    try {
      for (const u of [...new Set(urls)]) {
        const res = await window.grimorio.playerRead(u);
        if (res && res.ok) { Player.data = res; render(); say(''); go.disabled = false; return; }
        last = res;
      }
      Player.data = null; render();
      say((last && last.message) || 'Não achei este jogador no Armory.');
      if (parts.length >= 2) say('Não achei este jogador no Armory. Confira o nome (o formato é "Nome Sobrenome") e a região.');
    } catch (e) {
      say('Erro: ' + e.message);
    }
    go.disabled = false;
  };

  // Abre a aba e ja carrega o jogador (usado pela lista do ranking)
  Player.openUrl = function (url, displayName, region) {
    if (window.Panels) Panels.open('player');
    $('#p-name').value = displayName || '';
    if (region) $('#p-region').value = region;
    Player.load(url);
  };
  Player.open = function (name, region) { Player.openUrl('', name, region); };

  /* ---------- foto (mesma logica do seu Armory) ---------- */
  function fitFigure(box) {
    if (!box || !(box.y1 > box.y0) || !(box.x1 > box.x0)) return null;
    const ratio = box.ratio || 4 / 3;
    let h = Math.min(3.6, Math.max(1.05, 0.84 / (box.y1 - box.y0)));
    const wide = (box.x1 - box.x0) * h * ratio;
    if (wide > 1.02) h *= 1.02 / wide;
    const top = 0.94 - box.y1 * h;
    const left = 0.5 - ((box.x0 + box.x1) / 2) * h * ratio;
    const pct2 = (n) => (n * 100).toFixed(2) + '%';
    return { '--fh': pct2(h), '--ft': pct2(top), '--fl': pct2(left) };
  }

  function renderFigure(data) {
    const box = $('#p-figure');
    const portrait = $('#p-portrait');
    const m = (data && data.media) || {};
    const chain = [[m.main, 'full'], [m.fallback, 'silhouette'], [m.avatar, 'avatar']].filter(([src]) => src);
    box.innerHTML = '';
    portrait.classList.remove('has-figure', 'figure-full', 'figure-silhouette', 'figure-avatar', 'figure-fit');
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
    img.onerror = () => { step += 1; if (step < chain.length) tryStep(); else { box.innerHTML = ''; portrait.classList.remove('has-figure'); } };
    box.appendChild(img);
    tryStep();
  }

  /* ---------- paper doll, atributos e equipamento ---------- */
  const ROWS = [['health', 'Vida', ''], ['mana', 'Mana', ''], ['strength', 'Força', ''], ['agility', 'Agilidade', ''], ['stamina', 'Vigor', ''],
    ['intellect', 'Intelecto', ''], ['spirit', 'Espírito', ''], ['armor', 'Armadura', ''], ['attackPower', 'Poder de ataque', ''],
    ['rangedAttackPower', 'Ataque à distância', ''], ['crit', 'Crítico', '%'], ['hit', 'Acerto', '%'], ['dodge', 'Esquiva', '%'], ['parry', 'Aparar', '%'], ['itemLevel', 'Nível de item', '']];

  function slotTip(id) {
    const s = G.content.gearSlots.find((x) => x.id === id);
    const it = Player.data && (Player.data.items || []).find((i) => i.slot === id);
    if (!it) return `<div class="tt-title">${esc(s.label)}</div><div class="tt-dim">Espaço vazio</div>`;
    return `<div class="tt-title" style="color:${qcolor(it.quality)}">${esc(it.name || s.label)}</div>
      <div>${esc(s.label)}</div>
      ${it.ilvl ? `<div class="tt-yellow">Nível do item ${esc(it.ilvl)}</div>` : ''}
      ${Object.keys(it.stats || {}).length ? `<div class="tt-green">${Object.entries(it.stats).filter(([k]) => k !== 'armor').map(([k, v]) => esc(U.statText(k, v))).join('<br>')}</div>` : ''}`;
  }

  function render() {
    const data = Player.data;
    const slots = G.content.gearSlots;
    const bySlot = {};
    ((data && data.items) || []).forEach((it) => { bySlot[it.slot] = it; });
    const slotHtml = (s) => {
      const it = bySlot[s.id];
      const pic = it && it.icon && /^https:\/\/render\.worldofwarcraft\.com\//.test(it.icon) ? `<img class="slot-img" src="${esc(it.icon)}" alt="" draggable="false">` : icon(SLOT_ICON(s.id));
      return `<button class="slot ${it ? 'filled' : ''}" type="button" data-slot="${esc(s.id)}" style="${it ? '--q:' + qcolor(it.quality) : ''}" aria-label="${esc(s.label)}${it ? ': ' + esc(it.name || '') : ''}">${pic}</button>`;
    };
    $('#p-slots-left').innerHTML = slots.filter((s) => s.side === 'left').map(slotHtml).join('');
    $('#p-slots-right').innerHTML = slots.filter((s) => s.side === 'right').map(slotHtml).join('');
    $('#p-slots-bottom').innerHTML = slots.filter((s) => s.side === 'bottom').map(slotHtml).join('');

    const who = data && data.character;
    $('#t-player').textContent = who && who.name ? who.name : 'Armory do jogador';
    const lv = $('#p-level');
    lv.textContent = who ? `Nível ${data.level || '?'} ${who.race || ''} ${who.cls || ''}`.replace(/\s+/g, ' ').trim() : 'Nenhum jogador aberto';
    lv.style.color = who && CLS[who.clsSlug] ? CLS[who.clsSlug] : '';
    $('#p-sub').innerHTML = who ? `${esc(who.realm || 'WoW Forever')}${who.guild ? ` · &lt;${esc(who.guild)}&gt;` : ''}` : 'Digite um nome acima ou abra pelo ranking PvP';
    $('#p-note').textContent = data ? `${data.media ? 'Foto e equipamento' : 'Equipamento'} do Armory (página pública). Passe o mouse num espaço para ver o item.` : '';
    renderFigure(data);

    // atributos
    const st = (data && data.stats) || {};
    const fmt = (k, suf, v) => (suf === '%' ? n1(k === 'hit' ? pct(v) : v) + '%' : n0(v));
    const rows = ROWS.filter(([k]) => Number(st[k]) > 0).map(([k, label, suf]) => `
      <div class="goal-row"><span class="goal-name">${esc(label)}</span><b class="goal-cur">${fmt(k, suf, Number(st[k]))}</b><span class="goal-meta"></span></div>`).join('');
    $('#p-pane-stats').innerHTML = data
      ? `<div class="goal-table is-live"><div class="goal-head"><span>Atributo</span><span>Valor</span><span></span></div>${rows || '<p class="goal-note">O Armory não trouxe atributos deste jogador.</p>'}</div>`
      : '<p class="goal-note">Os atributos aparecem aqui depois que você abrir um jogador.</p>';

    // equipamento
    const items = slots.map((s) => [s, bySlot[s.id]]).filter(([, it]) => it);
    $('#p-c-gear').textContent = items.length || '';
    $('#p-pane-gear').innerHTML = data
      ? `<div class="pl-gear">${items.map(([s, it]) => `
        <div class="pl-gear-row" style="--q:${qcolor(it.quality)}">
          ${it.icon && /^https:\/\/render\.worldofwarcraft\.com\//.test(it.icon) ? `<img class="pl-gear-img" src="${esc(it.icon)}" alt="" draggable="false">` : '<span class="pl-gear-img"></span>'}
          <span class="pl-gear-name" style="color:${qcolor(it.quality)}">${esc(it.name || s.label)}</span>
          <span class="pl-gear-meta">${esc(s.label)}${it.ilvl ? ' · nível ' + esc(it.ilvl) : ''}</span>
        </div>`).join('') || '<p class="goal-note">Nenhum equipamento encontrado.</p>'}</div>`
      : '<p class="goal-note">O equipamento aparece aqui depois que você abrir um jogador.</p>';
  }

  function setPane(p) {
    Player.pane = p;
    document.querySelectorAll('#p-tabs .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.pane === p)));
    $('#p-pane-stats').hidden = p !== 'stats';
    $('#p-pane-gear').hidden = p !== 'gear';
  }

  function bind() {
    $('#p-go').addEventListener('click', () => Player.load());
    $('#p-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); Player.load(); } });
    $('#p-tabs').addEventListener('click', (e) => { const t = e.target.closest('.tab'); if (t) setPane(t.dataset.pane); });
    const doll = $('#p-doll');
    doll.addEventListener('mouseover', (e) => { const s = e.target.closest('.slot'); if (s) U.tip.show(s, slotTip(s.dataset.slot)); });
    doll.addEventListener('mouseout', (e) => { if (e.target.closest('.slot')) U.tip.hide(); });
  }

  // O conteudo (lista de espacos) so existe depois que o app carregou; monta na primeira vez que a aba abre
  let ready = false;
  Player.ensure = function () {
    if (ready || !(window.G && G.content && G.content.gearSlots)) return;
    ready = true;
    render();
    setPane('stats');
  };

  bind();
})();

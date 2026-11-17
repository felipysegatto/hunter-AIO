/* Aba PvP (nativa): ranking de Hunters, filtros e perfil de cada jogador, importados do check-pvp.fr.
   O app le o site em segundo plano (sem mostrar a pagina) e monta tudo no proprio estilo. */
(function () {
  'use strict';
  const { $, esc, icon } = U;
  const PvP = (window.PvP = { mapped: false, lastAt: 0 });
  const KEY = 'hunter.pvp.filters';
  const f = { region: 'us', faction: 'all', spec: 'all', page: 1 };
  try { Object.assign(f, JSON.parse(localStorage.getItem(KEY) || '{}'), { page: 1 }); } catch (e) { /* sem armazenamento */ }
  const st = { loading: false, view: 'list', result: null, profile: null, error: '', started: false, open: new Set() };

  const OPT = {
    region: [['us', 'Américas (US)'], ['eu', 'Europa (EU)'], ['kr', 'Coreia (KR)'], ['tw', 'Taiwan (TW)']],
    faction: [['all', 'Todas'], ['alliance', 'Aliança'], ['horde', 'Horda']],
    spec: [['all', 'Todas'], ['253', 'Domínio das Feras'], ['254', 'Precisão'], ['255', 'Sobrevivência']]
  };
  const RACE = { 1: 'Humano', 2: 'Orc', 3: 'Anão', 4: 'Elfo Noturno', 5: 'Morto-vivo', 6: 'Tauren', 7: 'Gnomo', 8: 'Troll', 9: 'Goblin', 10: 'Elfo Sangrento', 11: 'Draenei', 22: 'Worgen' };
  const SPEC = { 253: 'Domínio das Feras', 254: 'Precisão', 255: 'Sobrevivência' };
  const ZAM = 'https://wow.zamimg.com/images/wow/icons/large/';
  // Campos de batalha na ordem das colunas do site
  const BG = [['Ravina Brado Guerreiro', ZAM + 'achievement_bg_winwsg.jpg'], ['Bacia Arathi', ZAM + 'achievement_bg_winab.jpg'], ['Ilhas Lançanegra', ZAM + 'inv_misc_tournaments_banner_troll.jpg'], ['Vale Alterac', ZAM + 'achievement_bg_winav.jpg']];
  const safeImg = (src) => (/^https:\/\/wow\.zamimg\.com\//.test(src || '') ? src : '');
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ region: f.region, faction: f.faction, spec: f.spec })); } catch (e) { /* sem armazenamento */ } };
  const CHEV = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';

  PvP.sourceText = () => (PvP.mapped ? `lido às ${U.clock(PvP.lastAt)} (check-pvp.fr)` : 'lido sob demanda (check-pvp.fr)');

  /* ---------- estrutura fixa da aba ---------- */
  function shell() {
    const body = $('#pvp-body');
    if (!body || body.dataset.ready) return;
    body.dataset.ready = '1';
    body.innerHTML = `
      <div class="pvp-head">
        <div class="pvp-title">Ranking PvP · WoW Forever</div>
        <div class="pvp-sub">Caçadores por abates honrosos · dados do check-pvp.fr</div>
      </div>
      <div class="pvp-filters" id="pvp-filters">
        <label>Região<div id="dd-region"></div></label>
        <label>Facção<div id="dd-faction"></div></label>
        <label>Especialização<div id="dd-spec"></div></label>
        <label>Classe<span class="pvp-class" title="O app mostra só Caçadores">Caçador</span></label>
        <button class="icon-btn icon-btn-sm" id="pvp-refresh" type="button" title="Ler de novo" aria-label="Ler de novo">${icon('i-refresh')}</button>
      </div>
      <div id="pvp-content" aria-live="polite"></div>
      <p class="pvp-sources">Fontes: <button class="linkish" data-url="https://forever.check-pvp.fr/ranking">forever.check-pvp.fr</button> (ranking e perfis) · <button class="linkish" data-url="https://worldofwarcraft.blizzard.com/pt-br/forever">Armory da Blizzard</button> (jogadores)
        · <button class="linkish" id="pvp-map" type="button">mapear o site (diagnóstico)</button> <span id="pvp-map-status"></span></p>`;
    for (const [key, label] of [['region', 'Região'], ['faction', 'Facção'], ['spec', 'Especialização']]) {
      UIDropdown.create($('#dd-' + key), {
        options: OPT[key], value: f[key], label,
        onChange: (v) => { f[key] = v; f.page = 1; save(); st.view = 'list'; load(false); }
      });
    }
  }

  /* ---------- lista ---------- */
  function bgData(r) {
    const heads = st.result.headers || [], icons = st.result.headerIcons || [];
    const out = [];
    if (heads.length === r.cells.length) {
      heads.forEach((h, k) => {
        if (k > 0 && !h && r.cells[k] !== '') {
          const n = out.length;
          const ic = icons[k] || {};
          out.push({ nome: ic.alt || (BG[n] && BG[n][0]) || `Campo ${n + 1}`, icon: safeImg(ic.src) || (BG[n] && BG[n][1]) || '', v: r.cells[k] });
        }
      });
    }
    return out;
  }

  function rowHtml(r, i) {
    const name = r.linkText || `${r.sobrenome} ${r.nome}`.trim();
    const heads = st.result.headers || [];
    const aligned = heads.length === r.cells.length;
    const col = (rx) => { const k = aligned ? heads.findIndex((h) => rx.test(h)) : -1; return k >= 0 ? r.cells[k] : ''; };
    const rank = r.cells[0] && /^#?\d{1,5}$/.test(r.cells[0]) ? r.cells[0].replace('#', '') : String((f.page - 1) * 50 + i + 1);
    const nivel = col(/^n[ií]vel/i), ilvl = col(/^ilvl/i), patente = col(/^patente/i), honra = col(/^vit[oó]rias honrosas/i), views = col(/^visualiza/i);
    const tags = [];
    if (r.raceId) tags.push(RACE[r.raceId] || `Raça ${r.raceId}`);
    if (r.specId) tags.push(SPEC[r.specId] || `Espec. ${r.specId}`);
    const chips = [nivel && ['Nível', nivel], ilvl && ['iLvl', ilvl]].filter(Boolean).map(([l, v]) => `<span class="pvp-chip"><i>${l}</i>${esc(v)}</span>`).join('');
    const bgs = bgData(r);
    const open = st.open.has(i);
    const detail = `
      <div class="pvp-detail" ${open ? '' : 'hidden'}>
        <div class="pvp-stats">
          ${patente ? `<span>Patente PvP<b>${esc(patente)}</b></span>` : ''}
          ${honra ? `<span>Vitórias honrosas<b>${esc(honra)}</b></span>` : ''}
          ${views ? `<span>Visualizações<b>${esc(views)}</b></span>` : ''}
        </div>
        ${bgs.length ? `<div class="pvp-sec-t">Campos de batalha (vitórias)</div><div class="pvp-bgs">${bgs.map((b) => `<span class="pvp-bg" title="${esc(b.nome)}">${b.icon ? `<img src="${esc(b.icon)}" alt="" draggable="false">` : ''}<i>${esc(b.nome)}</i><b>${esc(b.v)}</b></span>`).join('')}</div>` : ''}
        ${(r.profissoes || []).length ? `<div class="pvp-sec-t">Profissões</div><div class="pvp-bgs">${r.profissoes.map((p) => `<span class="pvp-bg" title="${esc(p.nome)}">${safeImg(p.icon) ? `<img src="${esc(safeImg(p.icon))}" alt="" draggable="false">` : ''}<i>${esc(p.nome)}</i><b>${esc(p.valor)}</b></span>`).join('')}</div>` : ''}
      </div>`;
    return `
      <div class="pvp-item ${open ? 'is-open' : ''}" data-i="${i}">
        <div class="pvp-row">
          <span class="pvp-rank">${esc(rank)}</span>
          <div class="pvp-main">
            <div class="pvp-who"><button class="pvp-name" type="button" data-prof="${i}" title="Ver o perfil de ${esc(name)}">${esc(name)}</button>${r.guild ? `<span class="pvp-guild">${esc(r.guild)}</span>` : ''}</div>
            <div class="pvp-meta">${tags.map((t) => `<span class="pvp-tag">${esc(t)}</span>`).join('')}${chips}</div>
          </div>
          <div class="pvp-act">
            <button class="icon-btn icon-btn-sm pvp-exp" type="button" data-exp="${i}" aria-expanded="${open}" title="${open ? 'Recolher' : 'Mais informações'}" aria-label="Mais informações de ${esc(name)}">${CHEV}</button>
            <button class="btn btn-sm" type="button" data-arm="${i}" title="Abrir o Armory de ${esc(name)}">Armory</button>
          </div>
        </div>
        ${detail}
      </div>`;
  }

  function pager() {
    const total = st.result && st.result.pages;
    return `<div class="pvp-pager">
      <button class="btn btn-quiet btn-sm" id="pvp-prev" type="button" ${f.page <= 1 ? 'disabled' : ''}>‹ Anterior</button>
      <span>Página ${f.page}${total ? ' de ' + total : ''}</span>
      <button class="btn btn-quiet btn-sm" id="pvp-next" type="button" ${total && f.page >= total ? 'disabled' : ''}>Próxima ›</button>
    </div>`;
  }

  function paint() {
    shell();
    const box = $('#pvp-content');
    if (!box) return;
    if (st.view === 'profile') return paintProfile(box);
    if (st.loading && !st.result) { box.innerHTML = '<p class="pvp-note">Lendo o ranking…</p>'; return; }
    if (st.error) {
      box.innerHTML = `<div class="pvp-card"><p>${esc(st.error)}</p><p class="pvp-note">Se isso continuar, toque em “mapear o site (diagnóstico)” no rodapé e envie o arquivo salvo na Área de Trabalho ao Claude.</p><button class="btn btn-sm" id="pvp-retry" type="button">Tentar de novo</button></div>`;
      return;
    }
    const r = st.result;
    if (!r) return;
    box.innerHTML = `
      ${pager()}
      ${st.loading ? '<p class="pvp-note">Atualizando…</p>' : ''}
      <div class="pvp-list">${r.rows.map(rowHtml).join('') || '<p class="pvp-note">Nenhum jogador encontrado para este filtro.</p>'}</div>
      ${r.rows.length > 8 ? pager() : ''}
      <p class="pvp-note">Lido às ${esc(U.clock(r.fetchedAt))}${r.cache ? ' (guardado por até 10 minutos)' : ''}. Use a seta para ver mais informações e o nome para abrir o perfil.</p>`;
  }

  /* ---------- perfil ---------- */
  function paintProfile(box) {
    const p = st.profile;
    if (!p || p.loading) { box.innerHTML = '<p class="pvp-note">Lendo o perfil…</p>'; return; }
    const head = `<div class="pvp-prof-head"><button class="btn btn-quiet btn-sm" id="pvp-back" type="button">‹ Ranking</button>
      <h3>${esc(p.title)}</h3>
      <button class="btn btn-sm" type="button" id="pvp-prof-arm">Armory</button></div>`;
    if (p.error) { box.innerHTML = `${head}<div class="pvp-card"><p>${esc(p.error)}</p></div>`; return; }
    const d = PvPParse.parseProfile(p.data.lines || []);
    const row = p.row || {};
    const profIcon = (nome) => { const x = (row.profissoes || []).find((q) => norm(q.nome) === norm(nome)); return x ? safeImg(x.icon) : ''; };
    const bgIcon = (nome, n) => { const x = BG.find((b) => norm(b[0]) === norm(nome)) || BG[n]; return x ? x[1] : ''; };
    const kpi = [['Patente PvP', d.patente], ['Vitórias honrosas', d.honrosas], ['Visualizações', d.visualizacoes], ['Curtidas', d.curtidas]].filter(([, v]) => v);
    if (!d.ok) {
      box.innerHTML = `${head}<div class="pvp-card"><p>Não reconheci o formato desta página. Toque em “mapear o site (diagnóstico)” no rodapé, abra este jogador e me envie o arquivo.</p></div>`;
      return;
    }
    box.innerHTML = `${head}
      <section class="pvp-sec">
        <div class="pvp-id"><b>${esc(d.nome || p.title)}</b>${d.guilda ? `<span class="pvp-guild">${esc(d.guilda)}</span>` : ''}${d.nivel ? `<span class="pvp-chip"><i>Nível</i>${esc(d.nivel)}</span>` : ''}${d.atualizado ? `<span class="pvp-guild">atualizado há ${esc(d.atualizado)}</span>` : ''}</div>
        <div class="pvp-stats">${kpi.map(([l, v]) => `<span>${esc(l)}<b>${esc(v)}</b></span>`).join('')}</div>
      </section>
      ${d.campos.length ? `<section class="pvp-sec"><h4>Campos de batalha</h4><div class="pvp-bgs">${d.campos.map((c, n) => `<span class="pvp-bg"><img src="${esc(bgIcon(c.nome, n))}" alt="" draggable="false"><i>${esc(c.nome)}</i><b>${esc(c.vitorias)} vit.</b></span>`).join('')}</div></section>` : ''}
      ${d.profissoes.length ? `<section class="pvp-sec"><h4>Profissões</h4><div class="pvp-bgs">${d.profissoes.map((c) => `<span class="pvp-bg">${profIcon(c.nome) ? `<img src="${esc(profIcon(c.nome))}" alt="" draggable="false">` : ''}<i>${esc(c.nome)}</i><b>${esc(c.valor)}</b></span>`).join('')}</div></section>` : ''}
      <p class="pvp-note">Lido às ${esc(U.clock(p.data.fetchedAt))} no check-pvp.fr.</p>`;
  }

  /* ---------- carregar ---------- */
  async function load(force) {
    st.loading = true; st.error = ''; st.open = new Set();
    paint();
    try {
      const r = await window.grimorio.pvpRanking({ region: f.region, faction: f.faction, spec: f.spec, page: f.page, force: !!force });
      if (r && r.ok) { st.result = r; PvP.mapped = true; PvP.lastAt = r.fetchedAt || Date.now(); }
      else { st.result = null; st.error = (r && r.message) || 'Não consegui ler o ranking.'; }
    } catch (e) {
      st.result = null; st.error = 'Erro: ' + e.message;
    }
    st.loading = false;
    paint();
  }

  async function openProfile(row, force) {
    const shown = row.linkText || `${row.sobrenome} ${row.nome}`.trim();
    st.view = 'profile';
    st.profile = { loading: true, title: shown, row };
    paint();
    try {
      const r = await window.grimorio.pvpProfile({ region: row.region || f.region, nome: row.nome, sobrenome: row.sobrenome, force: !!force });
      st.profile = r && r.ok ? { title: shown, row, data: r } : { title: shown, row, error: (r && r.message) || 'Não consegui ler o perfil.' };
    } catch (e) {
      st.profile = { title: shown, row, error: 'Erro: ' + e.message };
    }
    paint();
  }

  // O nome vem como o site mostra (Nome Sobrenome); o endereco do jogador no site vem ao contrario
  const armory = (row) => { if (window.Player) Player.openUrl(row.armoryUrl, row.linkText || `${row.sobrenome} ${row.nome}`.trim(), row.region || f.region); };

  PvP.activate = function () {
    shell();
    if (!st.started) { st.started = true; load(false); } else paint();
  };

  /* ---------- eventos ---------- */
  document.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('#pvp-refresh') || t.closest('#pvp-retry')) { st.view = 'list'; load(true); return; }
    if (t.closest('#pvp-prev')) { if (f.page > 1) { f.page -= 1; load(false); } return; }
    if (t.closest('#pvp-next')) { f.page += 1; load(false); return; }
    if (t.closest('#pvp-back')) { st.view = 'list'; paint(); return; }
    if (t.closest('#pvp-prof-arm')) { if (st.profile) armory(st.profile.row); return; }
    const ex = t.closest('[data-exp]');
    if (ex) {   // amplia so a linha escolhida
      const i = Number(ex.dataset.exp), item = ex.closest('.pvp-item'), det = item.querySelector('.pvp-detail');
      const open = !st.open.has(i);
      if (open) st.open.add(i); else st.open.delete(i);
      det.hidden = !open; item.classList.toggle('is-open', open);
      ex.setAttribute('aria-expanded', String(open)); ex.title = open ? 'Recolher' : 'Mais informações';
      return;
    }
    const pr = t.closest('[data-prof]'); if (pr && st.result) { openProfile(st.result.rows[Number(pr.dataset.prof)]); return; }
    const ar = t.closest('[data-arm]'); if (ar && st.result) { armory(st.result.rows[Number(ar.dataset.arm)]); return; }
    const mp = t.closest('#pvp-map');
    if (mp) {
      const s = $('#pvp-map-status');
      mp.disabled = true; s.textContent = 'abrindo o site para mapear…';
      try {
        const r = await window.grimorio.pvpMap();
        s.textContent = r && r.ok ? `pronto: arquivo pvp-gravacao.json na Área de Trabalho (${r.dados} páginas gravadas)` : (r && r.message) || 'não deu certo';
      } catch (err) { s.textContent = 'não deu certo: ' + err.message; }
      mp.disabled = false;
    }
  });
})();

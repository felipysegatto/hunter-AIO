/* Aba PvP (nativa): ranking de Hunters, filtros e perfil de cada jogador, importados do check-pvp.fr.
   O app le o site em segundo plano (sem mostrar a pagina) e monta tudo no proprio estilo. */
(function () {
  'use strict';
  const { $, esc, icon } = U;
  const PvP = (window.PvP = { mapped: false, lastAt: 0 });
  const KEY = 'hunter.pvp.filters';
  const f = { region: 'us', faction: 'all', spec: 'all', page: 1 };
  try { Object.assign(f, JSON.parse(localStorage.getItem(KEY) || '{}'), { page: 1 }); } catch (e) { /* sem armazenamento */ }
  const st = { loading: false, view: 'list', result: null, profile: null, error: '', started: false };

  const OPT = {
    region: [['us', 'Américas (US)'], ['eu', 'Europa (EU)'], ['kr', 'Coreia (KR)'], ['tw', 'Taiwan (TW)']],
    faction: [['all', 'Todas'], ['alliance', 'Aliança'], ['horde', 'Horda']],
    spec: [['all', 'Todas'], ['253', 'Domínio das Feras'], ['254', 'Precisão'], ['255', 'Sobrevivência']]
  };
  const sel = (id, key) => `<select id="${id}" aria-label="${esc(key)}">${OPT[key].map(([v, l]) => `<option value="${v}" ${String(f[key]) === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ region: f.region, faction: f.faction, spec: f.spec })); } catch (e) { /* sem armazenamento */ } };

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
        <label>Região${sel('pvp-region', 'region')}</label>
        <label>Facção${sel('pvp-faction', 'faction')}</label>
        <label>Especialização${sel('pvp-spec', 'spec')}</label>
        <label>Classe<span class="pvp-class" title="O app mostra só Caçadores">Caçador</span></label>
        <button class="icon-btn icon-btn-sm" id="pvp-refresh" type="button" title="Ler de novo" aria-label="Ler de novo">${icon('i-refresh')}</button>
      </div>
      <div id="pvp-content" aria-live="polite"></div>
      <p class="pvp-sources">Fontes: <button class="linkish" data-url="https://forever.check-pvp.fr/ranking">forever.check-pvp.fr</button> (ranking e perfis) · <button class="linkish" data-url="https://worldofwarcraft.blizzard.com/pt-br/forever">Armory da Blizzard</button> (jogadores)
        · <button class="linkish" id="pvp-map" type="button">mapear o site (diagnóstico)</button> <span id="pvp-map-status"></span></p>`;
  }

  /* ---------- lista ---------- */
  const RACE = { 1: 'Humano', 2: 'Orc', 3: 'Anão', 4: 'Elfo Noturno', 5: 'Morto-vivo', 6: 'Tauren', 7: 'Gnomo', 8: 'Troll', 9: 'Goblin', 10: 'Elfo Sangrento', 11: 'Draenei', 22: 'Worgen' };
  const SPEC = { 253: 'Domínio das Feras', 254: 'Precisão', 255: 'Sobrevivência' };
  const SKIP = /^(ranking|nome|name|links?|profiss)/i;
  function rowHtml(r, i) {
    const name = r.linkText || `${r.sobrenome} ${r.nome}`.trim();
    const heads = st.result.headers || [];
    const hints = st.result.headerHints || [];
    const aligned = heads.length === r.cells.length;
    const rank = r.cells[0] && /^#?\d{1,5}$/.test(r.cells[0]) ? r.cells[0].replace('#', '') : String((f.page - 1) * 50 + i + 1);
    const chips = [];
    const grupo = [];
    r.cells.forEach((c, idx) => {
      if (idx === 0 || !c) return;
      const h = aligned ? heads[idx] : '';
      if (aligned && SKIP.test(h)) return;
      if (aligned && !h) { grupo.push({ v: c, hint: hints[idx] || '' }); return; }   // colunas sem titulo (vitorias por campo de batalha)
      if (!aligned && (c.length > 24 || c.includes(name.slice(0, 5)))) return;
      chips.push(`<span class="pvp-chip">${h ? `<i>${esc(h)}</i>` : ''}${esc(c)}</span>`);
    });
    if (grupo.length) chips.splice(Math.min(3, chips.length), 0, `<span class="pvp-chip" title="Vitórias em campos de batalha"><i>Campos de batalha</i>${grupo.map((g) => esc(g.v)).join(' · ')}</span>`);
    const tags = [];
    if (r.raceId) tags.push(RACE[r.raceId] || `Raça ${r.raceId}`);
    if (r.specId) tags.push(SPEC[r.specId] || `Espec. ${r.specId}`);
    (r.profissoes || []).forEach((p) => tags.push(`${p.nome}${p.valor ? ' ' + p.valor : ''}`));
    return `
      <div class="pvp-row">
        <span class="pvp-rank">${esc(rank)}</span>
        <div class="pvp-main">
          <div class="pvp-who"><button class="pvp-name" type="button" data-prof="${i}" title="Ver o perfil de ${esc(name)}">${esc(name)}</button>${r.guild ? `<span class="pvp-guild">${esc(r.guild)}</span>` : ''}</div>
          <div class="pvp-meta">${tags.map((t) => `<span class="pvp-tag">${esc(t)}</span>`).join('')}${chips.join('')}</div>
        </div>
        <button class="btn btn-sm" type="button" data-arm="${i}" title="Abrir o Armory de ${esc(name)}">Armory</button>
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
      <p class="pvp-note">Lido às ${esc(U.clock(r.fetchedAt))}${r.cache ? ' (guardado por até 10 minutos)' : ''}. Clique no nome para ver o perfil.</p>`;
  }

  /* ---------- perfil ---------- */
  const isVal = (s) => s.length <= 22 && /^[+\-]?[\d][\d.,/:%\s()+\-kKmMxX]*$/.test(s);
  function pairs(lines) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const a = lines[i], b = lines[i + 1];
      const colon = /^(.{2,40}?):\s*(.{1,40})$/.exec(a);
      if (colon && isVal(colon[2])) out.push([colon[1], colon[2]]);
      else if (b && !isVal(a) && isVal(b)) { out.push([a, b]); i++; }
      else out.push([null, a]);
    }
    return out;
  }
  function paintProfile(box) {
    const p = st.profile;
    if (!p || p.loading) { box.innerHTML = '<p class="pvp-note">Lendo o perfil…</p>'; return; }
    const head = `<div class="pvp-prof-head"><button class="btn btn-quiet btn-sm" id="pvp-back" type="button">‹ Ranking</button>
      <h3>${esc(p.title)}</h3>
      <button class="btn btn-sm" type="button" id="pvp-prof-arm">Armory</button></div>`;
    if (p.error) { box.innerHTML = `${head}<div class="pvp-card"><p>${esc(p.error)}</p></div>`; return; }
    const secs = p.data.sections.map((s) => `
      <section class="pvp-sec"><h4>${esc(s.title)}</h4>
        ${pairs(s.lines).map(([k, v]) => (k ? `<div class="pvp-kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>` : `<p class="pvp-line">${esc(v)}</p>`)).join('')}
      </section>`).join('');
    box.innerHTML = `${head}${secs || '<p class="pvp-note">O site não trouxe dados para este jogador.</p>'}<p class="pvp-note">Lido às ${esc(U.clock(p.data.fetchedAt))} no check-pvp.fr.</p>`;
  }

  /* ---------- carregar ---------- */
  async function load(force) {
    st.loading = true; st.error = '';
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

  // Nome como o site mostra (Nome Sobrenome); o endereco do jogador no site vem ao contrario (/regiao/Sobrenome/Nome)
  const armory = (row) => { if (window.Player) Player.openUrl(row.armoryUrl, row.linkText || `${row.sobrenome} ${row.nome}`.trim(), row.region || f.region); };

  PvP.activate = function () {
    shell();
    if (!st.started) { st.started = true; load(false); } else paint();
  };

  /* ---------- eventos ---------- */
  document.addEventListener('change', (e) => {
    const id = e.target && e.target.id;
    const map = { 'pvp-region': 'region', 'pvp-faction': 'faction', 'pvp-spec': 'spec' };
    if (!map[id]) return;
    f[map[id]] = e.target.value; f.page = 1; save(); st.view = 'list'; load(false);
  });
  document.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('#pvp-refresh') || t.closest('#pvp-retry')) { st.view = 'list'; load(true); return; }
    if (t.closest('#pvp-prev')) { if (f.page > 1) { f.page -= 1; load(false); } return; }
    if (t.closest('#pvp-next')) { f.page += 1; load(false); return; }
    if (t.closest('#pvp-back')) { st.view = 'list'; paint(); return; }
    if (t.closest('#pvp-prof-arm')) { if (st.profile) armory(st.profile.row); return; }
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

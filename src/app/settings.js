/* Settings: Armory and class, AI, sounds & notifications, data packs, sources, updates, about */
(function () {
  'use strict';
  const { $, $$, esc, icon } = U;

  const Settings = (window.Settings = {});

  function feedRows(sources, cache) {
    const errs = (cache && cache.errors) || [];
    if (!cache || !cache.lastRefresh) return '<div><span>Ainda não houve busca.</span></div>';
    const counts = {};
    (cache.items || []).forEach((i) => { const k = i.source || i.channel; counts[k] = (counts[k] || 0) + 1; });
    return sources.map((s) => {
      const err = errs.find((e) => e.source === s.name);
      return `<div><span>${esc(s.name)}</span>${err ? `<span class="bad">sem resposta (${esc(err.message)})</span>` : `<span class="ok">ok · ${counts[s.name] || 0} itens</span>`}</div>`;
    }).join('');
  }

  function soundRows() {
    const a = G.settings.alerts || {};
    return Sound.CATS.map((c) => {
      const r = a[c.id] || {};
      return `
        <div class="snd-row" data-cat="${c.id}">
          <div class="snd-name"><b>${esc(c.label)}</b><span>${esc(c.hint)}</span></div>
          <label class="switch" title="Aviso do Windows"><input type="checkbox" data-alert="notify" ${r.notify ? 'checked' : ''}><i></i><span>Aviso</span></label>
          <label class="switch" title="Tocar som"><input type="checkbox" data-alert="sound" ${r.sound ? 'checked' : ''}><i></i><span>Som</span></label>
          <select class="select select-sm" data-alert="tone" ${r.sound ? '' : 'disabled'}>${Sound.TONES.map((t) => `<option value="${t.id}" ${t.id === r.tone ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
          <button class="icon-btn icon-btn-sm" data-test="${c.id}" title="Ouvir" aria-label="Ouvir o som de ${esc(c.label)}">${icon('i-play')}</button>
        </div>`;
    }).join('');
  }

  const GAME_LABEL = { retail: 'Retail', classic: 'Classic', forever: 'Forever', desconhecido: '' };
  // armoryWho / armoryPicker are shared with the welcome window (Settings.armoryWho / Settings.armoryPicker)

  /** The character the Armory link points to right now */
  function armoryWho(arm) {
    const d = arm && arm.data;
    const who = d && d.character;
    if (!who) return '';
    const m = d.media || {};
    const line = [`Nível ${d.level || '?'}`, who.race, who.cls].filter(Boolean).join(' ');
    const game = GAME_LABEL[d.game] || '';
    return `
      <div class="arm-who" style="--cc:${U.CLASS_COLOR[who.clsSlug] || 'var(--gold)'}">
        ${U.avatar(m.avatar, who.name, 'arm-av-lg')}
        <div class="arm-who-text">
          <b>${esc(who.name || '')}</b>
          <span>${esc(line)}${who.spec ? ' · ' + esc(who.spec) : ''}</span>
          <span class="dim">${esc(who.realm || '')}${who.guild ? ` · &lt;${esc(who.guild)}&gt;` : ''}${game ? ` · <span class="game-badge ${d.testMode ? 'retail' : ''}">${esc(game)}${d.testMode ? ' · teste' : ''}</span>` : ''}</span>
        </div>
        ${d.link ? `<button class="linkish" data-url="${esc(d.link)}">${icon('i-out')}Abrir no Armory</button>` : ''}
      </div>`;
  }

  /** Without the Armory: pick the class (and faction) by hand */
  function classRow(s, arm) {
    const fromArmory = arm && arm.data && arm.data.character && arm.data.character.clsSlug;
    const cl = (G.content.classes && G.content.classes.classes) || {};
    const order = (G.content.classes && G.content.classes.order) || Object.keys(cl);
    if (fromArmory && cl[fromArmory]) return `<p class="set-help" style="margin-top:10px">Classe lida do Armory: <b style="color:${esc(cl[fromArmory].color)}">${esc(cl[fromArmory].name)}</b>.</p>`;
    return `
      <div class="set-row" style="margin-top:10px">
        <div class="field" style="max-width:220px; flex:none">
          <label for="st-class">Sem Armory: sua classe</label>
          <select class="select" id="st-class"><option value="">Escolha…</option>${order.map((k) => `<option value="${k}" ${s.classSlug === k ? 'selected' : ''}>${esc(cl[k].name)}</option>`).join('')}</select>
        </div>
        <div class="field" style="max-width:180px; flex:none">
          <label for="st-faction">Facção</label>
          <select class="select" id="st-faction"><option value="">—</option><option value="ALLIANCE" ${s.faction === 'ALLIANCE' ? 'selected' : ''}>Aliança</option><option value="HORDE" ${s.faction === 'HORDE' ? 'selected' : ''}>Horda</option></select>
        </div>
      </div>`;
  }

  /** Name or link: the same field, two ways in (also used by the welcome window) */
  Settings.armMode = null;
  Settings.armoryFormHtml = function (prefix, current) {
    const cur = String(current || '');
    const mode = Settings.armMode || (/^https?:|armory/i.test(cur) ? 'link' : 'name');
    const val = mode === 'name' && /^https?:/i.test(cur) ? '' : cur;
    return `
      <div class="seg" role="tablist" aria-label="Como encontrar o personagem">
        <button class="seg-btn ${mode === 'name' ? 'is-on' : ''}" role="tab" aria-selected="${mode === 'name'}" data-arm-mode="name">${icon('i-search')}Buscar pelo nome</button>
        <button class="seg-btn ${mode === 'link' ? 'is-on' : ''}" role="tab" aria-selected="${mode === 'link'}" data-arm-mode="link">${icon('i-link')}Colar o link do Armory</button>
      </div>
      <div class="set-row">
        <input class="input" id="${prefix}-armory" value="${esc(val)}" spellcheck="false" autocomplete="off"
          placeholder="${mode === 'name' ? 'Nome e sobrenome do personagem, ex.: Bruxo Magic' : 'https://worldofwarcraft.blizzard.com/pt-br/forever/us/armory/…'}">
        <button class="btn btn-sm" id="${prefix}-armory-save">${mode === 'name' ? 'Buscar' : 'Conectar'}</button>
        ${cur ? `<button class="btn btn-quiet btn-sm" id="${prefix}-armory-clear" title="Desconectar o personagem">Desconectar</button>` : ''}
      </div>
      <p class="set-hint">${mode === 'name'
    ? 'Digite como aparece no jogo, com o sobrenome. O app procura no Armory do WoW Forever.'
    : 'No site do WoW, abra o Armory do Forever, procure o seu personagem e copie o endereço da página (ou da busca).'}</p>`;
  };

  /** Same-name characters found by a search: pick one to connect */
  function armoryPicker(arm, current) {
    const sr = arm && arm.search;
    const list = (sr && sr.matches) || [];
    if (!sr || (list.length < 2 && arm.state !== 'choose')) return '';
    const card = (r) => {
      const on = r.url === current;
      return `
        <button class="arm-card ${on ? 'is-on' : ''}" data-arm-pick="${esc(r.url)}" style="--cc:${U.CLASS_COLOR[r.clsSlug] || 'var(--text-dim)'}" ${on ? 'aria-current="true"' : ''}>
          ${U.avatar(r.avatar, r.name)}
          <span class="arm-card-text">
            <b>${esc(r.name)}</b>
            <span class="arm-cls">${r.level ? esc(r.level) + ' ' : ''}${esc(r.cls || 'Personagem')}</span>
            <span class="dim">${esc(r.realm)}${GAME_LABEL[r.game] && r.game !== 'retail' ? ' · ' + esc(GAME_LABEL[r.game]) : ''}</span>
          </span>
          ${on ? '<span class="arm-tag">conectado</span>' : r.game === 'forever' ? '<span class="arm-tag lock">Forever</span>' : ''}
        </button>`;
    };
    return `
      <div class="arm-pick-head">
        <b>${arm.state === 'choose' ? `Qual ${esc(sr.query)} é o seu?` : `Outros chamados ${esc(sr.query)}`}</b>
        <span class="count-pill">${list.length}</span>
        <span class="dim">personagens do WoW Forever primeiro</span>
      </div>
      <div class="arm-pick">${list.map(card).join('')}</div>`;
  }

  Settings.armoryWho = armoryWho;
  Settings.armoryPicker = armoryPicker;

  Settings.render = function () {
    const s = G.settings;
    const info = Settings.info || {};
    const packs = (G.content.packs && G.content.packs.packs) || [];
    const folders = (G.content.packs && G.content.packs.folders) || [];
    const driveFolder = folders.find((f) => /Drive/i.test(f));
    const arm = G.character.armory || {};
    $('#settings-body').innerHTML = `
      <nav class="set-nav">
        ${[['sg-armory', 'Armory'], ['sg-ai', 'IA'], ['sg-sound', 'Sons'], ...(packs.length || driveFolder ? [['sg-packs', 'Dados']] : []), ['sg-feeds', 'Fontes'], ['sg-about', 'Versão']].map(([id, l]) => `<button class="chip" data-jump="${id}">${l}</button>`).join('')}
      </nav>

      <section class="set-group" id="sg-armory">
        <h3>Armory</h3>
        <p class="set-help">Encontre o seu personagem do WoW Forever pelo nome ou pelo link do Armory. O app identifica raça, classe e especialização, lista os guias de leveling da classe na Mobalytics para você escolher qual seguir e compara o seu equipamento com as melhores trocas do seu nível. Se houver mais de um com esse nome, ele lista todos para você escolher.</p>
        ${Settings.armoryFormHtml('st', s.armoryUrl)}
        ${armoryWho(arm)}
        ${armoryPicker(arm, s.armoryUrl)}
        ${classRow(s, arm)}
        <p class="set-help" style="margin-top:12px">Opcional: com um Client ID e Secret da Battle.net (develop.battle.net), o app usa a API oficial em vez da página pública.</p>
        <div class="set-row">
          <input class="input" id="st-bnet-id" value="${esc(s.bnetClientId || '')}" placeholder="Battle.net Client ID (opcional)" spellcheck="false">
          <input class="input" id="st-bnet-secret" type="password" placeholder="${s.hasBnetSecret ? 'Secret salvo (criptografado)' : 'Client Secret (opcional)'}" spellcheck="false">
          <button class="btn btn-quiet btn-sm" id="st-bnet-save">Salvar API</button>
          <button class="linkish" data-url="https://develop.battle.net/access/clients">${icon('i-out')}Criar credenciais</button>
        </div>
        <div class="set-row">
          <div class="field" style="max-width:220px; flex:none">
            <label for="st-arm-int">Conferir o Armory a cada</label>
            <select class="select" id="st-arm-int">${[30, 60, 180].map((m) => `<option value="${m}" ${Number(s.armoryMinutes) === m ? 'selected' : ''}>${m < 60 ? m + ' minutos' : m / 60 + (m === 60 ? ' hora' : ' horas')}</option>`).join('')}</select>
          </div>
          <button class="btn btn-quiet btn-sm" id="st-armory-now" ${s.armoryUrl ? '' : 'disabled'} style="margin-top:16px">${icon('i-refresh')}Ler agora</button>
          <span class="set-status ${arm.ok ? 'ok' : arm.state === 'choose' ? '' : arm.at ? 'bad' : ''}" style="margin-top:16px">${arm.at ? esc(arm.ok ? `Lido às ${U.clock(arm.at)} (${arm.via === 'api' ? 'API' : 'página'})` : arm.state === 'choose' ? '' : U.armoryError(arm.message)) : ''}</span>
        </div>
      </section>

      <section class="set-group" id="sg-ai">
        <h3>Tradução por IA <span class="dim">(opcional)</span></h3>
        <p class="set-help"><b>Não precisa fazer nada aqui:</b> sem chave, as notícias, o Reddit, as matérias e o guia já chegam em português pelo Google Tradutor, de graça. A chave é para quem quiser uma tradução mais caprichada e resumos das notícias feitos pela IA (Claude). Ela é da API da Anthropic, criada em console.anthropic.com, cobrada por uso e separada da assinatura do Claude.</p>
        <div class="set-row">
          <input class="input" id="st-key" type="password" autocomplete="off" spellcheck="false" placeholder="${s.hasApiKey ? 'Chave salva neste computador (criptografada)' : 'Cole sua chave: sk-ant-…'}">
          <button class="btn btn-sm" id="st-key-save">Salvar chave</button>
        </div>
        <div class="set-row">
          <button class="btn btn-quiet btn-sm" id="st-key-test" ${s.hasApiKey ? '' : 'disabled'}>Testar conexão</button>
          ${s.hasApiKey ? '<button class="btn btn-quiet btn-sm" id="st-key-del">Remover chave</button>' : ''}
          <button class="linkish" data-url="https://console.anthropic.com/settings/keys">${icon('i-out')}Criar uma chave</button>
          <span class="set-status" id="st-key-status"></span>
        </div>
        <div class="set-row">
          <div class="field" style="max-width:340px">
            <label for="st-model">Modelo</label>
            <select class="select" id="st-model">
              <option value="claude-haiku-5-5" ${s.aiModel === 'claude-haiku-5-5' ? 'selected' : ''}>Claude Haiku 5.5 — rápido e barato</option>
              <option value="claude-sonnet-5-5" ${s.aiModel === 'claude-sonnet-5-5' ? 'selected' : ''}>Claude Sonnet 5.5 — resumos mais caprichados</option>
            </select>
          </div>
          <div class="field" style="max-width:220px; flex:none">
            <label for="st-interval">Buscar novidades a cada</label>
            <select class="select" id="st-interval">
              ${[15, 30, 60, 120].map((m) => `<option value="${m}" ${Number(s.refreshMinutes) === m ? 'selected' : ''}>${m < 60 ? m + ' minutos' : m / 60 + (m === 60 ? ' hora' : ' horas')}</option>`).join('')}
            </select>
          </div>
        </div>
      </section>

      <section class="set-group" id="sg-sound">
        <h3>Sons e notificações</h3>
        <p class="set-help">Escolha o que merece aviso do Windows e o que merece som. Os sons são originais do app e tocam mesmo com ele minimizado.</p>
        <div class="set-row snd-master">
          <label class="switch"><input type="checkbox" id="st-sound" ${s.sound.enabled ? 'checked' : ''}><i></i><span>Sons ligados</span></label>
          <label class="vol">Volume <input class="range" id="st-volume" type="range" min="0" max="100" value="${Math.round(s.sound.volume * 100)}" style="--p:${Math.round(s.sound.volume * 100)}%"></label>
        </div>
        <div class="snd-table ${s.sound.enabled ? '' : 'is-muted'}">${soundRows()}</div>
      </section>

      ${packs.length || driveFolder ? `<section class="set-group" id="sg-packs">
        <h3>Pacotes de dados</h3>
        <p class="set-help">Atualizações de conteúdo (notícias curadas, marcos, missões da rota) podem chegar como arquivos .json na pasta <b>Dados</b> do app no seu Google Drive. O app lê essa pasta ao abrir, sem precisar de versão nova.</p>
        <div class="feed-table">
          ${packs.length ? packs.map((p) => `<div><span>${esc(p.file)}${p.title ? ' · ' + esc(p.title) : ''}</span>${p.ok ? `<span class="ok">aplicado${p.date ? ' · ' + esc(U.fullDate(p.date)) : ''}</span>` : '<span class="bad">arquivo com erro</span>'}</div>`).join('') : '<div><span>Nenhum pacote encontrado ainda.</span></div>'}
        </div>
        <div class="set-row">
          ${driveFolder ? `<button class="btn btn-quiet btn-sm" data-folder="${esc(driveFolder)}">${icon('i-out')}Abrir a pasta Dados do Drive</button>` : ''}
        </div>
      </section>` : ''}

      <section class="set-group" id="sg-feeds">
        <h3>Fontes ao vivo</h3>
        <p class="set-help">${G.feed.lastRefresh ? `Notícias: última busca às ${esc(U.clock(G.feed.lastRefresh))}.` : ''} O app guarda só o que fala de WoW Forever.</p>
        <div class="feed-table">${feedRows((G.content.feeds && G.content.feeds.sources) || [], G.feed)}</div>
        <p class="set-help" style="margin-top:10px">Reddit${G.community.lastRefresh ? ` · última busca às ${esc(U.clock(G.community.lastRefresh))}` : ''}</p>
        <div class="feed-table">${feedRows((G.content.communityFeeds && G.content.communityFeeds.sources) || [], G.community)}</div>
        <p class="set-help" style="margin-top:10px">Guia de leveling (Mobalytics)</p>
        <div class="feed-table"><div><span>${window.Guide && Guide.data && Guide.data.guide ? `${esc(Guide.data.guide.title.replace(/\s*-\s*Talents.*$/i, ''))} · ${esc(Guide.data.guide.author)} · versão ${esc(Guide.data.guide.version || '')}` : 'Guia da sua classe'}</span>${window.Guide && Guide.data && Guide.data.error ? `<span class="bad">${esc(Guide.data.error)}</span>` : window.Guide && Guide.data && Guide.data.checkedAt ? `<span class="ok">ok · conferido às ${esc(U.clock(Guide.data.checkedAt))}</span>` : '<span>ainda não conferido</span>'}</div></div>
        <p class="set-help" style="margin-top:10px">PvP e Armory de jogadores</p>
        <div class="feed-table"><div><span>Ranking, filtros e perfis · forever.check-pvp.fr</span><span>${window.PvP ? esc(PvP.sourceText()) : ''}</span></div><div><span>Armory do jogador · worldofwarcraft.blizzard.com</span><span>sob demanda</span></div></div>
        <div class="set-row"><button class="btn btn-quiet btn-sm" id="st-refresh-now">${icon('i-refresh')}Buscar agora</button><button class="btn btn-quiet btn-sm" data-gd="refresh">${icon('i-refresh')}Conferir o guia</button></div>
      </section>

      <section class="set-group" id="sg-about">
        <h3>Versão, atualizações e inicialização</h3>
        <p class="set-help">Grimório do Aventureiro ${esc(info.version || '')} · conteúdo de ${esc(U.fullDate(G.content.meta.contentDate))}. Seus dados e chaves ficam só neste computador. O app confere no GitHub se há versão nova toda vez que abre (na janelinha inicial) e a cada 6 horas; quando há, mostra as novidades e atualiza com um clique.</p>
        <div class="set-row">
          <button class="btn btn-quiet btn-sm" id="st-update">${icon('i-refresh')}Procurar atualização</button>
          <span class="set-status ${App.update && App.update.ok ? (App.update.available ? 'ok' : '') : App.update ? 'bad' : ''}" id="st-update-status">${esc(App.updateText ? App.updateText() : '')}</span>
          ${App.update && App.update.available ? `<button class="btn btn-sm" id="st-update-apply">${icon('i-download')}Atualizar para a ${esc(App.update.latest)}</button>` : ''}
        </div>
        <div class="set-row">
          <label class="switch" title="O app abre sozinho quando o Windows liga"><input type="checkbox" id="st-autostart" ${s.openAtLogin !== false ? 'checked' : ''}><i></i><span>Abrir junto com o Windows</span></label>
          <span class="set-status" id="st-autostart-status">${Settings.auto && Settings.auto.supported === false ? 'funciona no app instalado no Windows' : ''}</span>
        </div>
        <div class="set-row">
          <button class="btn btn-quiet btn-sm" id="st-tour">${icon('i-spark')}Ver o tutorial de novo</button>
          <button class="btn btn-quiet btn-sm" data-whatsnew>${icon('i-check')}Novidades desta versão</button>
          ${G.content.meta.updates && G.content.meta.updates.page ? `<button class="btn btn-quiet btn-sm" id="st-share">${icon('i-link')}Copiar link para os amigos</button>` : ''}
        </div>
        <div class="set-row">
          <button class="btn btn-sm" data-fb-open="erro">${icon('i-chat')}Relatar um erro</button>
          <button class="btn btn-quiet btn-sm" data-fb-open="melhoria">Mandar ideia ou dica</button>
          <span class="set-help">vai direto para o autor, sem conta nem e-mail</span>
        </div>
        <p class="set-help">Créditos: banco de itens do <button class="linkish" data-url="https://github.com/wowsims/forever">WoWSims Forever</button> (licença MIT, aviso incluído no app); guias da <button class="linkish" data-url="https://mobalytics.gg/wow-forever/leveling-guides">Mobalytics</button>, com crédito a cada autor; personagem pelo Armory da Blizzard; ícones do Wowhead. World of Warcraft é marca da Blizzard Entertainment; este app não é afiliado à Blizzard.</p>
        <div class="changelog">${(G.content.changelog || []).map((c) => `<div><b>${esc(c.version)}</b> (${esc(U.fullDate(c.date))})<ul>${c.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>`).join('')}</div>
      </section>`;
  };

  Settings.open = async function (focus) {
    G.settings = await window.grimorio.getSettings();
    G.character = await window.grimorio.getCharacter();
    Settings.info = Settings.info || (await window.grimorio.appInfo());
    try { Settings.auto = await window.grimorio.getAutostart(); } catch (_) { Settings.auto = null; }
    Settings.render();
    $('#settings-modal').hidden = false;
    const target = { armory: '#sg-armory', feeds: '#sg-feeds', ai: '#sg-ai', sound: '#sg-sound', about: '#sg-about' }[focus];
    if (target) $(target).scrollIntoView({ block: 'start' });
    else $('#settings-body').scrollTop = 0;
  };

  async function save(patch) {
    G.settings = await window.grimorio.saveSettings(patch);
    return G.settings;
  }
  function status(id, text, kind) { const el = $(id); if (el) { el.textContent = text; el.className = 'set-status ' + (kind || ''); } }

  Settings.bind = function () {
    const body = $('#settings-body');
    body.addEventListener('click', async (e) => {
      const jump = e.target.closest('[data-jump]');
      if (jump) { $('#' + jump.dataset.jump).scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
      const test = e.target.closest('[data-test]');
      if (test) { const a = G.settings.alerts[test.dataset.test]; Sound.play(a.tone, G.settings.sound.volume); return; }
      const folder = e.target.closest('[data-folder]');
      if (folder) { window.grimorio.openFolder(folder.dataset.folder); return; }
      const fb = e.target.closest('[data-fb-open]');
      if (fb && window.Feedback) { $('#settings-modal').hidden = true; Feedback.open(fb.dataset.fbOpen); return; }
      const modeBtn = e.target.closest('[data-arm-mode]');
      if (modeBtn) {
        Settings.armMode = modeBtn.dataset.armMode;
        const keep = $('#st-armory') ? $('#st-armory').value : '';
        Settings.render();
        const inp = $('#st-armory');
        if (inp) { if (keep && !(Settings.armMode === 'name' && /^https?:/i.test(keep))) inp.value = keep; inp.focus(); }
        return;
      }
      const pick = e.target.closest('[data-arm-pick]');
      if (pick) {
        if (pick.dataset.armPick === G.settings.armoryUrl) return;
        body.querySelectorAll('.arm-card').forEach((c) => c.classList.toggle('is-busy', c === pick));
        await save({ armoryUrl: pick.dataset.armPick });
        await Char.readArmory();
        Settings.render();
        return;
      }

      const id = e.target.closest('button') && e.target.closest('button').id;
      if (id === 'st-key-save') {
        const v = $('#st-key').value.trim();
        if (!v) { status('#st-key-status', 'Cole a chave no campo antes de salvar.', 'bad'); return; }
        await save({ apiKey: v });
        Settings.render();
        status('#st-key-status', 'Chave salva. Testando…');
        const r = await window.grimorio.testAI();
        status('#st-key-status', r.message, r.ok ? 'ok' : 'bad');
        App.updateFeedStatus();
        if (r.ok) App.refresh();
      } else if (id === 'st-key-test') {
        status('#st-key-status', 'Testando…');
        const r = await window.grimorio.testAI();
        status('#st-key-status', r.message, r.ok ? 'ok' : 'bad');
      } else if (id === 'st-key-del') {
        await save({ apiKey: '' });
        Settings.render();
        App.updateFeedStatus();
        U.say('Chave removida');
      } else if (id === 'st-armory-save') {
        const v = $('#st-armory').value.trim();
        const btn = $('#st-armory-save');
        btn.disabled = true;
        btn.textContent = v ? 'Buscando…' : 'Removendo…';
        await save({ armoryUrl: v });
        if (G.settings.armoryUrl) await Char.readArmory(); else { Char.renderAll(); U.say('Armory desconectado'); }
        Settings.render();
        const pickHead = $('.arm-pick-head');
        if (pickHead && (G.character.armory || {}).state === 'choose') pickHead.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else if (id === 'st-armory-clear') {
        await save({ armoryUrl: '' });
        G.character = await window.grimorio.getCharacter();
        Char.renderAll();
        if (window.Guide) { await Guide.load(); Guide.renderSide(); }
        Settings.render();
        U.say('Personagem desconectado');
      } else if (id === 'st-autostart') {
        return;
      } else if (id === 'st-tour') {
        $('#settings-modal').hidden = true;
        if (window.Welcome) Welcome.start(0);
      } else if (id === 'st-bnet-save') {
        const patch = { bnetClientId: $('#st-bnet-id').value.trim() };
        const sec = $('#st-bnet-secret').value.trim();
        if (sec) patch.bnetSecret = sec;
        await save(patch);
        Settings.render();
        U.say('Credenciais da Battle.net salvas');
      } else if (id === 'st-armory-now') {
        await Char.readArmory();
        Settings.render();
      } else if (id === 'st-refresh-now') {
        await Promise.all([App.refresh(), Community.refresh(false)]);
        Settings.render();
      } else if (id === 'st-share') {
        U.copy(G.content.meta.updates.page, 'Link de download copiado: é só mandar para os amigos');
      } else if (id === 'st-update-apply') {
        $('#update-pill').click();
      } else if (id === 'st-update') {
        status('#st-update-status', 'Procurando no GitHub…');
        await App.checkUpdate(true);
        Settings.render();
      }
    });

    body.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.id === 'st-model') await save({ aiModel: t.value });
      if (t.id === 'st-interval') await save({ refreshMinutes: Number(t.value) });
      if (t.id === 'st-arm-int') await save({ armoryMinutes: Number(t.value) });
      if (t.id === 'st-sound') { await save({ sound: { enabled: t.checked } }); $('.snd-table').classList.toggle('is-muted', !t.checked); if (t.checked) Sound.play('runa', G.settings.sound.volume); }
      if (t.id === 'st-volume') { await save({ sound: { volume: Number(t.value) / 100 } }); Sound.play('pergaminho', G.settings.sound.volume); }
      if (t.id === 'st-class') {
        await save({ classSlug: t.value });
        if (window.Guide) { Guide.data = null; Guide.busy = !!t.value; Guide.renderSide(); }
        Char.renderAll();
      }
      if (t.id === 'st-faction') { await save({ faction: t.value }); Char.renderAll(); }
      if (t.id === 'st-autostart') {
        const r = await window.grimorio.setAutostart(t.checked);
        G.settings = await window.grimorio.getSettings();
        const st = $('#st-autostart-status');
        if (st) { st.className = 'set-status ' + (r.ok ? 'ok' : ''); st.textContent = r.ok ? (t.checked ? 'Vai abrir junto com o Windows' : 'Não abre mais sozinho') : r.supported === false ? 'Funciona no app para Windows' : 'Não deu para mudar agora'; }
      }
      const alert = t.dataset.alert;
      if (alert) {
        const cat = t.closest('.snd-row').dataset.cat;
        const val = alert === 'tone' ? t.value : t.checked;
        await save({ alerts: { [cat]: { [alert]: val } } });
        if (alert === 'sound') t.closest('.snd-row').querySelector('select').disabled = !t.checked;
        if (alert === 'tone' || (alert === 'sound' && val)) Sound.play(G.settings.alerts[cat].tone, G.settings.sound.volume);
      }
    });
    body.addEventListener('keydown', (e) => {
      if (e.target.id === 'st-armory' && e.key === 'Enter') { e.preventDefault(); const b = $('#st-armory-save'); if (b) b.click(); }
    });
    body.addEventListener('input', (e) => {
      if (e.target.id === 'st-volume') e.target.style.setProperty('--p', e.target.value + '%');
    });
  };
})();

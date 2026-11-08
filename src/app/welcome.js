/* Welcome: a floating window that walks a new player through the app (character, tour, sounds),
   and the "what's new" window shown the first time a new version opens. */
(function () {
  'use strict';
  const { $, esc, icon } = U;

  const Welcome = (window.Welcome = { step: 0, busy: false, version: '' });

  const save = async (patch) => { G.settings = await window.grimorio.saveSettings(patch); return G.settings; };

  /* ---------- steps ---------- */
  const STEPS = [
    {
      id: 'hello',
      title: 'Bem-vindo, aventureiro!',
      next: 'Começar',
      body: () => `
        <p>O Grimório é o seu companheiro de leveling no WoW Forever, em português, para qualquer classe:</p>
        <ul class="wl-list">
          <li>${icon('i-link')}<span><b>Seu personagem</b> lido do Armory: nível, itens, talentos e profissões.</span></li>
          <li>${icon('i-spark')}<span><b>O guia da sua classe</b> na Mobalytics, traduzido, com o que treinar a cada nível.</span></li>
          <li>${icon('i-check')}<span><b>Melhorias de equipamento</b> para o seu nível, e de onde vem cada item.</span></li>
          <li>${icon('i-news')}<span><b>Notícias</b> do Wowhead e do Reddit, com aviso quando algo muda.</span></li>
        </ul>
        <p class="wl-note">Leva uns 2 minutos. Dá para pular agora e rever depois em Ajustes → Versão.</p>`
    },
    {
      id: 'char',
      title: 'Qual é o seu personagem?',
      body: () => {
        const arm = G.character.armory || {};
        const connected = !!(G.settings.armoryUrl && arm.data && arm.data.character);
        return `
          <p>${connected ? 'Este é o personagem conectado. Para trocar, busque outro abaixo.' : 'Busque pelo nome do personagem ou cole o link do Armory do WoW Forever.'}</p>
          <div class="wl-arm">${Settings.armoryFormHtml('wl', G.settings.armoryUrl)}</div>
          <div class="wl-arm-result" id="wl-arm-result">${armResult()}</div>
          ${connected ? '' : '<p class="wl-note">Ainda não tem personagem no Forever? Pule esta etapa e escolha a classe no painel do guia, à direita.</p>'}`;
      }
    },
    { id: 'doll', target: '#paperdoll', title: 'Seu personagem e os itens', body: () => '<p>Aqui fica o seu personagem do Armory, com o equipamento. Os <b>números vermelhos</b> nos espaços marcam as melhores trocas; passe o mouse num espaço para ver o item e a melhoria.</p>' },
    { id: 'gear', target: '.doll .subframe', title: 'Melhorias de equipamento', body: () => '<p>As melhores trocas para o seu nível em cada espaço, com <b>de onde vem cada item</b>: missão, masmorra, profissão, vendedor, reputação ou leilão. Dá para filtrar por fonte.</p>' },
    { id: 'guide', target: 'section.frame.grimoire', title: 'O guia da sua classe', body: () => '<p>Aqui você <b>escolhe qual guia da Mobalytics seguir</b>. O app traduz o guia, mostra o que treinar no instrutor no seu nível e a build, e avisa com um resumo quando o autor muda algo.</p>' },
    { id: 'news', target: '#news-rail', title: 'Notícias', body: () => '<p>Puxe esta aba para abrir as notícias do <b>Wowhead</b> e do <b>Reddit</b> sobre o Forever. Clique numa matéria para ler o texto completo em português.</p>' },
    { id: 'feedback', target: '#btn-feedback', title: 'Dicas, ideias e erros', body: () => '<p>Achou um erro ou teve uma ideia? Este balão manda a sua mensagem <b>direto para o autor</b> do app, sem conta nem e-mail.</p>' },
    { id: 'settings', target: '#btn-settings', title: 'Ajustes', body: () => '<p>Na engrenagem ficam o Armory, os sons, a opção de <b>abrir junto com o Windows</b> e a tradução por IA. O app também confere sozinho se saiu versão nova.</p>' },
    {
      id: 'sounds',
      title: 'Quais avisos devem tocar som?',
      body: () => {
        const a = G.settings.alerts || {};
        return `
          <p>O Grimório confere tudo sozinho. Marque o que merece <b>um som</b> quando chegar novidade:</p>
          <div class="wl-sounds">${Sound.CATS.map((c) => `
            <div class="wl-snd">
              <label class="switch"><input type="checkbox" data-wl-sound="${esc(c.id)}" ${(a[c.id] || {}).sound && G.settings.sound.enabled ? 'checked' : ''}><i></i><span><b>${esc(c.label)}</b><small>${esc(c.hint)}</small></span></label>
              <button class="icon-btn icon-btn-sm" type="button" data-wl-play="${esc(c.id)}" title="Ouvir" aria-label="Ouvir o som de ${esc(c.label)}">${icon('i-play')}</button>
            </div>`).join('')}
          </div>
          <p class="wl-note">Aviso de versão nova do app aparece sempre. Tons, volume e avisos do Windows ficam em Ajustes → Sons.</p>`;
      }
    },
    {
      id: 'done',
      title: 'Tudo pronto!',
      next: 'Concluir',
      body: () => {
        const arm = G.character.armory || {};
        const who = arm.ok && arm.data && arm.data.character;
        const picked = window.Guide && Guide.data && !Guide.data.needsPick && Guide.data.guide;
        return `
          <p>${who ? `<b>${esc(who.name)}</b> está conectado.` : 'Quando quiser, conecte o seu personagem em Ajustes → Armory.'}
          ${picked ? '' : ' Próximo passo: <b>escolha o guia</b> que você quer seguir, no painel da direita.'}</p>
          <p>Bom jogo, aventureiro.</p>
          <p class="wl-note">Para rever este tutorial: Ajustes → Versão → Ver o tutorial de novo.</p>`;
      }
    }
  ];

  function armResult() {
    const arm = G.character.armory || {};
    if (Welcome.busy) return '<div class="wl-wait"><span class="wl-spin"></span>Procurando no Armory…</div>';
    if (!G.settings.armoryUrl) return '';
    if (arm.state === 'choose') return Settings.armoryPicker(arm, G.settings.armoryUrl);
    if (arm.data && arm.data.character) {
      return Settings.armoryWho(arm) + (arm.ok ? '' : '<div class="wl-note">O Armory não respondeu agora; isto é a última leitura. O app tenta de novo sozinho.</div>');
    }
    if (arm.state === 'not-found') return `<div class="wl-bad">Não achei ${esc(arm.query || 'esse personagem')} no Armory do Forever. Confira o nome e o sobrenome, ou cole o link.</div>`;
    if (arm.state === 'bad-url') return '<div class="wl-bad">Não reconheci esse link. Cole o endereço da página do personagem ou da busca no Armory.</div>';
    if (arm.at && !arm.ok) return `<div class="wl-bad">${esc(U.armoryError(arm.message))}</div>`;
    return '';
  }

  /* ---------- placing the window ---------- */
  function targetOf(step) {
    if (!step.target) return null;
    const el = document.querySelector(step.target);
    if (!el || el.offsetParent === null) return null;
    const r = el.getBoundingClientRect();
    return r.width && r.height ? r : null;
  }

  function place() {
    const card = $('#wl-card');
    const step = STEPS[Welcome.step];
    const r = targetOf(step);
    const spot = $('#wl-spot');
    const dim = $('#wl-dim');
    card.classList.toggle('is-tour', !!r);
    if (!r) {
      spot.hidden = true;
      dim.hidden = false;
      card.style.left = '';
      card.style.top = '';
      return;
    }
    dim.hidden = true;
    const pad = 6;
    Object.assign(spot.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    spot.hidden = false;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const gap = 18;
    let left;
    let top;
    if (r.right + gap + cw < W - 8) { left = r.right + gap; top = r.top + r.height / 2 - ch / 2; }
    else if (r.left - gap - cw > 8) { left = r.left - gap - cw; top = r.top + r.height / 2 - ch / 2; }
    else if (r.bottom + gap + ch < H - 8) { left = r.left + r.width / 2 - cw / 2; top = r.bottom + gap; }
    else { left = r.left + r.width / 2 - cw / 2; top = r.top - gap - ch; }
    card.style.left = Math.max(10, Math.min(W - cw - 10, left)) + 'px';
    card.style.top = Math.max(10, Math.min(H - ch - 10, top)) + 'px';
  }

  /* ---------- rendering ---------- */
  Welcome.render = function () {
    const step = STEPS[Welcome.step];
    $('#wl-count').textContent = `${Welcome.step + 1} de ${STEPS.length}`;
    $('#wl-title').textContent = step.title;
    $('#wl-body').innerHTML = step.body();
    $('#wl-dots').innerHTML = STEPS.map((_, i) => `<i class="${i === Welcome.step ? 'is-on' : i < Welcome.step ? 'is-done' : ''}"></i>`).join('');
    $('[data-wl="back"]').hidden = Welcome.step === 0;
    $('#wl-next').textContent = step.next || 'Próximo';
    $('[data-wl="skip"]').hidden = Welcome.step === STEPS.length - 1;
    // Tour steps: the panel being explained must be on screen
    if (step.id === 'gear' && window.Char && Char.showPane) Char.showPane('gear');
    if (step.id === 'news' && window.News && News.drawer) News.openDrawer(false);
    requestAnimationFrame(place);
  };

  Welcome.start = function (at) {
    document.querySelectorAll('.modal:not([hidden])').forEach((m) => { m.hidden = true; });
    Welcome.step = Math.max(0, Math.min(STEPS.length - 1, at || 0));
    $('#wl-card').hidden = false;
    Welcome.render();
    setTimeout(() => { const b = $('#wl-next'); if (b) b.focus(); }, 50);
  };

  Welcome.finish = async function () {
    $('#wl-card').hidden = true;
    $('#wl-spot').hidden = true;
    $('#wl-dim').hidden = true;
    if (window.Char && Char.showPane) Char.showPane('stats');
    await save({ onboarded: true, lastRunVersion: Welcome.version || G.settings.lastRunVersion || '' });
  };

  async function search() {
    const input = $('#wl-armory');
    const v = input ? input.value.trim() : '';
    if (!v) { if (input) input.focus(); return; }
    Welcome.busy = true;
    $('#wl-arm-result').innerHTML = armResult();
    await save({ armoryUrl: v });
    try { await Char.readArmory(); } catch (_) { /* the result line says what happened */ }
    Welcome.busy = false;
    Settings.armMode = null;
    Welcome.render();
  }

  Welcome.bind = function () {
    const card = $('#wl-card');
    card.addEventListener('click', async (e) => {
      const nav = e.target.closest('[data-wl]');
      if (nav) {
        const a = nav.dataset.wl;
        if (a === 'skip') { await Welcome.finish(); U.say('Tutorial pulado. Dá para rever em Ajustes → Versão'); return; }
        if (a === 'back') { Welcome.step = Math.max(0, Welcome.step - 1); Welcome.render(); return; }
        if (a === 'next') {
          if (Welcome.step >= STEPS.length - 1) { await Welcome.finish(); return; }
          Welcome.step += 1;
          Welcome.render();
        }
        return;
      }
      const mode = e.target.closest('[data-arm-mode]');
      if (mode) {
        Settings.armMode = mode.dataset.armMode;
        const keep = $('#wl-armory') ? $('#wl-armory').value : '';
        Welcome.render();
        const inp = $('#wl-armory');
        if (inp) { if (keep && !(Settings.armMode === 'name' && /^https?:/i.test(keep))) inp.value = keep; inp.focus(); }
        return;
      }
      const pick = e.target.closest('[data-arm-pick]');
      if (pick) {
        Welcome.busy = true;
        $('#wl-arm-result').innerHTML = armResult();
        await save({ armoryUrl: pick.dataset.armPick });
        try { await Char.readArmory(); } catch (_) { /* shown below */ }
        Welcome.busy = false;
        Welcome.render();
        return;
      }
      const id = e.target.closest('button') && e.target.closest('button').id;
      if (id === 'wl-armory-save') search();
      else if (id === 'wl-armory-clear') {
        await save({ armoryUrl: '' });
        G.character = await window.grimorio.getCharacter();
        Char.renderAll();
        Welcome.render();
      }
      const play = e.target.closest('[data-wl-play]');
      if (play) { const a = G.settings.alerts[play.dataset.wlPlay]; if (a) Sound.play(a.tone, G.settings.sound.volume); }
    });
    card.addEventListener('keydown', (e) => {
      if (e.target.id === 'wl-armory' && e.key === 'Enter') { e.preventDefault(); search(); }
    });
    card.addEventListener('change', async (e) => {
      const cat = e.target.dataset.wlSound;
      if (!cat) return;
      const patch = { alerts: { [cat]: { sound: e.target.checked } } };
      if (e.target.checked && !G.settings.sound.enabled) patch.sound = { enabled: true };
      await save(patch);
      if (e.target.checked) Sound.play(G.settings.alerts[cat].tone, G.settings.sound.volume);
    });
    window.addEventListener('resize', () => { if (!$('#wl-card').hidden) place(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#wl-card').hidden) Welcome.finish();
    });
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-whatsnew]')) { $('#settings-modal').hidden = true; WhatsNew.open(null, true); }
    });
  };

  /* ---------- what's new ---------- */
  const WhatsNew = (window.WhatsNew = {});
  WhatsNew.open = function (since, all) {
    const list = (G.content.changelog || []).filter((c) => all || !since || window.grimorio && U.newer(c.version, since)).slice(0, all ? 3 : 4);
    if (!list.length) return false;
    $('#wn-title').textContent = all ? 'Novidades' : `Novidades da versão ${list[0].version}`;
    $('#whatsnew-body').innerHTML = `
      ${all ? '' : '<p class="set-help">O Grimório foi atualizado. Isto é o que mudou:</p>'}
      ${list.map((c) => `
        <section class="wn-ver">
          <h3>Versão ${esc(c.version)} <span>${esc(U.fullDate(c.date))}</span></h3>
          <ul>${c.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
        </section>`).join('')}
      <div class="fb-actions"><button class="btn" data-close>Entendi</button></div>`;
    $('#whatsnew-modal').hidden = false;
    return true;
  };

  /** First run → the tutorial; first run of a new version → what's new */
  Welcome.boot = async function () {
    let info = {};
    try { info = await window.grimorio.appInfo(); } catch (_) { info = {}; }
    Welcome.version = info.version || (G.content.meta && G.content.meta.version) || '';
    if (!G.settings.onboarded) { setTimeout(() => Welcome.start(0), 700); return; }
    const last = G.settings.lastRunVersion || '';
    if (last !== Welcome.version) {
      if (last) setTimeout(() => WhatsNew.open(last), 700);
      await save({ lastRunVersion: Welcome.version });
    }
  };
})();

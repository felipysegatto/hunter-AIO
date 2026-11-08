/* Bootstrap and global wiring */
(function () {
  'use strict';
  const { $, esc, icon } = U;

  const App = (window.App = { refreshing: false, update: null });

  /* ---------- countdown to the next milestone ---------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  let fired = new Set();
  try { fired = new Set(JSON.parse(localStorage.getItem('grimorio.milestones') || '[]')); } catch (_) { /* first run */ }
  function milestoneAlerts(ms, now) {
    ms.filter((m) => m.t <= now && now - m.t < 6 * 36e5 && !fired.has(m.id)).forEach((m) => {
      fired.add(m.id);
      try { localStorage.setItem('grimorio.milestones', JSON.stringify([...fired])); } catch (_) { /* ignore */ }
      Sound.forEvents({ marcos: 1 });
      if (G.settings.alerts && G.settings.alerts.marcos && G.settings.alerts.marcos.notify) window.grimorio.notify('marcos', `${m.label}: começou agora!`);
      U.say(`${m.label}: começou!`);
    });
  }

  function tickCountdown() {
    const now = Date.now();
    const ms = (G.content.milestones || []).map((m) => ({ ...m, t: new Date(m.date).getTime() })).sort((a, b) => a.t - b.t);
    milestoneAlerts(ms, now);
    const next = ms.find((m) => m.t > now);
    const box = $('#countdown');
    if (!next) {
      box.classList.add('is-live');
      $('#cd-label').textContent = 'World of Warcraft: Forever';
      $('#cd-value').textContent = 'No ar';
      $('#cd-detail').textContent = 'Bom jogo, aventureiro';
      return;
    }
    const launched = ms[0] && ms[0].t <= now;
    box.classList.toggle('is-live', launched);
    const diff = next.t - now;
    const d = Math.floor(diff / 864e5);
    const h = Math.floor((diff % 864e5) / 36e5);
    const m = Math.floor((diff % 36e5) / 6e4);
    const s = Math.floor((diff % 6e4) / 1e3);
    $('#cd-label').textContent = launched ? `Forever no ar · próximo: ${next.label}` : next.label;
    $('#cd-value').textContent = d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m` : `${pad(h)}:${pad(m)}:${pad(s)}`;
    if (next.id === 'launch') {
      const when = new Date(next.date);
      const wd = when.toLocaleDateString('pt-BR', { weekday: 'long' });
      $('#cd-detail').textContent = `${wd.charAt(0).toUpperCase() + wd.slice(1)}, ${when.toLocaleDateString('pt-BR', { day: 'numeric', month: 'numeric' })} às ${when.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} (seu horário)`;
    } else {
      $('#cd-detail').textContent = next.detail || '';
    }
  }

  /* ---------- live feeds ---------- */
  App.updateFeedStatus = function (lastResult) {
    const dot = $('#feed-dot');
    const txt = $('#feed-status-text');
    const errs = (G.feed.errors || []).length;
    const total = (G.content.feeds.sources || []).length;
    dot.className = 'dot ' + (!G.feed.lastRefresh ? 'off' : errs === 0 ? 'ok' : errs < total ? 'partial' : 'off');
    let label = 'Fontes ao vivo';
    if (G.feed.lastRefresh) {
      label = errs >= total ? 'Fontes sem resposta' : `Ao vivo · ${U.clock(G.feed.lastRefresh)}`;
      if (lastResult && lastResult.newCount) label += ` · ${lastResult.newCount} nova${lastResult.newCount > 1 ? 's' : ''}`;
    }
    txt.textContent = label;
  };

  App.refresh = async function (opts) {
    const manual = !opts || opts.manual !== false;
    if (App.refreshing) return;
    App.refreshing = true;
    $('#btn-refresh').classList.add('spinning');
    try {
      const r = await window.grimorio.refreshFeeds();
      G.feed = { items: r.items, lastRefresh: r.lastRefresh, errors: r.errors };
      News.render();
      App.updateFeedStatus(r);
      Char.renderPath();
      if (r.newCount) U.say(`${r.newCount} novidade${r.newCount > 1 ? 's' : ''} do Forever`);
      else if (manual && r.errors.length >= (G.content.feeds.sources || []).length) U.say('As fontes não responderam. Confira sua conexão.', 'error');
      if (r.ai && r.ai.error) U.say('Resumo da IA falhou: ' + r.ai.error, 'error');
    } catch (err) {
      if (manual) U.say('Não consegui buscar novidades agora', 'error');
    } finally {
      App.refreshing = false;
      $('#btn-refresh').classList.remove('spinning');
    }
  };

  /* ---------- new versions (GitHub Releases) ---------- */
  App.updateText = function () {
    const u = App.update;
    if (!u) return '';
    if (!u.ok) return `Não deu para conferir: ${u.error || 'sem resposta'}`;
    return u.available ? `Versão ${u.latest} disponível (você está na ${u.current})` : `Você está na versão mais recente (${u.current})`;
  };
  App.showUpdate = function (u) {
    App.update = u || App.update;
    const pill = $('#update-pill');
    const x = App.update;
    if (!pill) return;
    pill.hidden = !(x && x.ok && x.available);
    if (!pill.hidden) {
      pill.innerHTML = `${icon('i-download')}<span>Nova versão ${esc(x.latest)}</span>`;
      pill.title = `Você está na ${x.current}. Clique para ver as novidades e atualizar para a ${x.latest}.`;
    }
  };
  App.checkUpdate = async function (manual) {
    try {
      const u = await window.grimorio.checkUpdate();
      App.showUpdate(u);
      if (manual) U.say(App.updateText(), u.ok ? undefined : 'error');
    } catch (_) { if (manual) U.say('Não deu para conferir as atualizações agora', 'error'); }
  };

  /* ---------- global delegation ---------- */
  function bindGlobal() {
    document.addEventListener('click', (e) => {
      const link = e.target.closest('[data-url]');
      if (link) { e.preventDefault(); window.grimorio.open(link.dataset.url); return; }
      const close = e.target.closest('[data-close]');
      if (close) { close.closest('.modal').hidden = true; }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const open = document.querySelectorAll('.modal:not([hidden])');
        open.forEach((m) => { m.hidden = true; });
        if (!open.length && News.drawer) News.openDrawer(false);
        U.tip.hide();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); App.refresh(); }
    });
    $('#btn-refresh').addEventListener('click', () => App.refresh({ manual: true }));
    $('#btn-settings').addEventListener('click', () => Settings.open());
    $('#update-pill').addEventListener('click', async () => {
      const u = App.update;
      if (!u || !u.available) return;
      const r = await window.grimorio.applyUpdate();
      U.say(r && r.restarting ? `Reabrindo para atualizar para a ${u.latest}…` : `Baixe a versão ${u.latest} na página que abriu`);
    });
    window.grimorio.onUpdateStatus((u) => App.showUpdate(u));
    $('#feed-status').addEventListener('click', () => Settings.open('feeds'));
    window.grimorio.onFeedsUpdated(async (data) => {
      G.feed = await window.grimorio.getFeedCache();
      News.render();
      Char.renderPath();
      App.updateFeedStatus();
      if (data) Sound.forEvents(data.byCat);
    });
    window.grimorio.onCommunityUpdated(async (data) => {
      G.community = await window.grimorio.getCommunity();
      if (News.cat === 'reddit' && News.drawer) News.render(); else News.counts();
      if (data) Sound.forEvents(data.byCat);
    });
    window.grimorio.onArmoryUpdated(async (data) => {
      // A search may have swapped the saved link for the character's own page
      [G.character, G.settings] = await Promise.all([window.grimorio.getCharacter(), window.grimorio.getSettings()]);
      Char.renderAll();
      Guide.renderSide();
      if (!$('#settings-modal').hidden && window.Settings) Settings.render();
      if (data) Sound.forEvents(data.byCat);
    });
  }

  /* ---------- boot ---------- */
  async function boot() {
    document.body.classList.add('platform-' + (window.grimorio.platform || 'win32'));
    const [content, settings, character, feed, community] = await Promise.all([
      window.grimorio.getContent(),
      window.grimorio.getSettings(),
      window.grimorio.getCharacter(),
      window.grimorio.getFeedCache(),
      window.grimorio.getCommunity()
    ]);
    G.content = content;
    G.settings = settings;
    G.character = character;
    G.feed = feed || { items: [], errors: [] };
    G.community = community || { items: [], errors: [], status: {} };

    U.decorateFrames(document);
    U.drawRunes();
    News.bind();
    Community.bind();
    Char.bind();
    Gear.bind();
    Guide.bind();
    if (window.Feedback) Feedback.bind();
    if (window.Welcome) Welcome.bind();
    Settings.bind();
    bindGlobal();

    await Promise.all([Guide.load(), Gear.load()]);
    News.render();
    Guide.renderSide();
    Char.renderAll();
    window.grimorio.lastUpdate().then((u) => { if (u) App.showUpdate(u); }).catch(() => {});
    App.updateFeedStatus();
    tickCountdown();
    setInterval(tickCountdown, 1000);

    if (window.Welcome) Welcome.boot();
    setTimeout(() => App.refresh({ manual: false }), 1200);
    setTimeout(() => Community.refresh(false), 2600);
  }

  boot().catch((err) => {
    document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;bottom:10px;left:10px;color:#f66;z-index:99">${esc(err.stack || err)}</pre>`);
  });
})();

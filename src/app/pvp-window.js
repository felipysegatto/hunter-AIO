/* Janela do jogador (check-pvp): barra com Armory e navegador */
(() => {
  const $ = (id) => document.getElementById(id);
  const view = $('view');
  const HOST = /^https:\/\/([a-z0-9-]+\.)?check-pvp\.fr\//i;
  let ready = false;
  const say = (t) => { $('pw-status').textContent = t || ''; };
  const nameFrom = (u) => {
    try {
      const seg = new URL(u).pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
      const n = seg[seg.length - 1];
      return n && !/^(ranking|us|eu|kr|tw|player|players|character)$/i.test(n) ? n : '';
    } catch (e) { return ''; }
  };
  const refresh = () => {
    if (!ready) return;
    const n = nameFrom(view.getURL());
    $('pw-title').textContent = n || 'Jogador';
    document.title = 'PvP · ' + (n || 'Jogador');
    $('pw-armory').disabled = !n;
    $('pw-back').disabled = !view.canGoBack();
  };
  const go = (u) => { if (!HOST.test(u || '')) return; if (ready) view.loadURL(u); else view.setAttribute('src', u); };
  go(new URLSearchParams(location.search).get('u'));
  window.pvpWin.onNavigate(go);
  view.addEventListener('dom-ready', () => { ready = true; say(''); refresh(); });
  view.addEventListener('did-navigate', refresh);
  view.addEventListener('did-navigate-in-page', refresh);
  view.addEventListener('did-start-loading', () => say('Carregando…'));
  view.addEventListener('did-stop-loading', () => { say(''); refresh(); });
  view.addEventListener('did-fail-load', (e) => { if (e.isMainFrame && e.errorCode !== -3) say('Não consegui abrir a página (' + (e.errorDescription || e.errorCode) + ').'); });
  $('pw-back').addEventListener('click', () => { if (ready && view.canGoBack()) view.goBack(); });
  $('pw-reload').addEventListener('click', () => { if (ready) view.reload(); });
  $('pw-armory').addEventListener('click', async () => { const ok = await window.pvpWin.armory(view.getURL()); if (!ok) say('Não consegui descobrir o jogador por este endereço.'); });
  $('pw-browser').addEventListener('click', () => window.pvpWin.external(ready ? view.getURL() : ''));
  $('pw-close').addEventListener('click', () => window.close());
})();

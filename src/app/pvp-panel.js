/* Aba PvP: ranking do check-pvp (WoW Forever) dentro do app, com o filtro Hunter marcado */
(() => {
  const $ = (id) => document.getElementById(id);
  const view = $('pvp-view');
  if (!view) return;
  const HOME = 'https://forever.check-pvp.fr/ranking';
  let started = false, ready = false, prevRanking = false, injectTimer = null;

  // Procura o filtro de classe Hunter na pagina e marca uma vez (so age em grupos que tem varias classes)
  const PRESELECT = String.raw`(() => {
    if (window.__hpTimer) clearInterval(window.__hpTimer);
    window.__hpResult = 'running';
    const OTHER = ['warrior','paladin','rogue','priest','mage','warlock','druid','shaman','guerrier','voleur','pretre','prêtre','demoniste','druide','chaman'];
    const HUNTER = /(^|[^a-zà-ÿ])(hunter|chasseur|chasseuse|caçador|cacador|cazador|jäger|jager|cacciatore)([^a-zà-ÿ]|$)/i;
    const attr = (el, n) => (el.getAttribute && el.getAttribute(n)) || '';
    const own = (el) => [attr(el,'aria-label'), attr(el,'title'), attr(el,'alt'), attr(el,'data-class'), attr(el,'data-tooltip'), attr(el,'src'), attr(el,'value'), typeof el.className === 'string' ? el.className : '', el.children.length === 0 ? el.textContent : ''].join(' ');
    const score = (root) => { const h = (root.outerHTML || '').toLowerCase(); return OTHER.filter((c) => h.includes(c)).length; };
    const digits = (root) => ((root.textContent || '').match(/\d/g) || []).length;
    const active = (el) => /(^|[\s_-])(selected|active|checked|is-active|on)([\s_-]|$)/i.test(typeof el.className === 'string' ? el.className : '') || ['aria-pressed','aria-selected','aria-checked'].some((a) => attr(el, a) === 'true');
    const CTRL = 'button, [role="button"], [role="option"], [role="radio"], [role="tab"], label, li, a';
    let tries = 0;
    function finish(r) { clearInterval(window.__hpTimer); window.__hpResult = r; }
    function tick() {
      tries++;
      for (const s of document.querySelectorAll('select')) {
        const opt = [...s.options].find((o) => HUNTER.test(o.textContent + ' ' + o.value));
        if (opt && score(s) >= 4) {
          if (s.value !== opt.value) { s.value = opt.value; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); }
          return finish('ok');
        }
      }
      for (const el of document.querySelectorAll('button, [role="button"], [role="option"], [role="radio"], [role="tab"], label, li, a, img, span, div')) {
        if (el.children.length > 2 || !HUNTER.test(own(el))) continue;
        if (el.closest('table, tbody, tr, [role="row"], [role="rowgroup"], [role="grid"], [role="table"]')) continue;
        let g = el.parentElement, hops = 0;
        while (g && hops < 5 && score(g) < 5) { g = g.parentElement; hops++; }
        if (!g || score(g) < 5 || digits(g) > 25 || g.querySelectorAll('*').length > 400) continue;
        const t = el.closest(CTRL) || el;
        if (active(t) || active(el)) return finish('ja-marcado');
        t.click();
        return finish('ok');
      }
      if (tries > 40) finish('nao-achei');
    }
    window.__hpTimer = setInterval(tick, 500); tick();
  })();`;

  const say = (t, ms) => {
    const el = $('pvp-status'); el.textContent = t || '';
    if (ms) setTimeout(() => { if (el.textContent === t) el.textContent = ''; }, ms);
  };
  const pathOf = () => { try { return new URL(view.getURL()).pathname; } catch (e) { return ''; } };
  const isPlayer = () => { const seg = pathOf().split('/').filter(Boolean); return seg.length > 0 && !/^ranking$/i.test(seg[0]); };

  function injectHunter() {
    clearTimeout(injectTimer);
    view.executeJavaScript(PRESELECT).catch(() => {});
    injectTimer = setTimeout(async () => {
      try {
        const r = await view.executeJavaScript('window.__hpResult');
        if (r === 'ok') say('Filtro de Hunter marcado.', 4000);
        else if (r === 'nao-achei' || r === 'running') say('Não achei o filtro de Hunter. Marque no site ou toque em "Hunter".', 9000);
      } catch (e) { /* a pagina mudou */ }
    }, 22000);
  }

  function sync() {
    if (!ready) return;
    try { $('pvp-back').disabled = !view.canGoBack(); } catch (e) { /* ainda carregando */ }
    $('pvp-armory').hidden = !isPlayer();
    const ranking = /^\/ranking/i.test(pathOf());
    if (ranking && !prevRanking) injectHunter();
    prevRanking = ranking;
  }

  function activate() {
    if (started) return;
    started = true;
    view.setAttribute('src', HOME);
    say('Carregando o ranking…');
  }

  view.addEventListener('dom-ready', () => { ready = true; sync(); });
  view.addEventListener('did-navigate', sync);
  view.addEventListener('did-navigate-in-page', sync);
  view.addEventListener('did-start-loading', () => say('Carregando…'));
  view.addEventListener('did-stop-loading', () => { if ($('pvp-status').textContent === 'Carregando…') say(''); sync(); });
  view.addEventListener('did-fail-load', (e) => { if (e.isMainFrame && e.errorCode !== -3) say('Não consegui abrir o site (' + (e.errorDescription || e.errorCode) + ').'); });

  $('pvp-back').addEventListener('click', () => { if (ready && view.canGoBack()) view.goBack(); });
  $('pvp-reload').addEventListener('click', () => { if (ready) view.reload(); else activate(); });
  $('pvp-hunter').addEventListener('click', () => { if (!ready) return; say('Procurando o filtro de Hunter…'); injectHunter(); });
  $('pvp-armory').addEventListener('click', async () => {
    const ok = await window.grimorio.pvpArmory(view.getURL());
    if (!ok) say('Não consegui descobrir o jogador por este endereço.', 6000);
  });
  $('pvp-window').addEventListener('click', () => window.grimorio.pvpOpenPlayer(ready ? view.getURL() : HOME));
  $('pvp-browser').addEventListener('click', () => window.grimorio.open(ready ? view.getURL() : HOME));

  window.PvP = { activate };
})();

/* Reddit tab of the news drawer (Forever threads, translated) */
(function () {
  'use strict';
  const { $, $$, esc, icon } = U;

  const Community = (window.Community = { refreshing: false });
  const showEn = new Set();
  let seen = new Set();
  try { seen = new Set(JSON.parse(localStorage.getItem('grimorio.seen.comm') || '[]')); } catch (_) { /* first run */ }
  const saveSeen = U.debounce(() => { try { localStorage.setItem('grimorio.seen.comm', JSON.stringify([...seen].slice(-800))); } catch (_) { /* ignore */ } }, 600);

  const KIND = { reddit: { label: 'Reddit', icon: 'src-reddit' } };

  const reddit = () => (G.community.items || []).filter((i) => i.kind === 'reddit');

  Community.count = function () {
    const recent = Date.now() - 3 * 864e5;
    const n = reddit().filter((i) => !seen.has(i.id) && new Date(i.date).getTime() > recent).length;
    const el = $('#c-reddit');
    if (el) el.textContent = n ? String(n > 99 ? '99+' : n) : '';
    return n;
  };

  function statusHtml() {
    const errs = G.community.errors || [];
    const feeds = (G.content.communityFeeds && G.content.communityFeeds.sources) || [];
    const feedErr = feeds.filter((f) => errs.some((e) => e.source === f.name)).length;
    const state = !G.community.lastRefresh ? '<span class="cs">Reddit: aguardando</span>'
      : feedErr === feeds.length ? '<span class="cs bad">Reddit: sem resposta</span>'
        : `<span class="cs ok">Reddit: ok${feedErr ? ` (${feedErr} busca falhou)` : ''}</span>`;
    const when = G.community.lastRefresh ? `atualizado às ${esc(U.clock(G.community.lastRefresh))}` : '';
    const engine = G.community.engine === 'claude' ? 'tradução: IA' : G.community.engine === 'google' ? 'tradução: Google' : '';
    return `<div class="comm-status">${state}<span class="grow"></span><span class="cs dim">${[when, engine].filter(Boolean).join(' · ')}</span>
      <button class="icon-btn icon-btn-sm ${Community.refreshing ? 'spinning' : ''}" id="comm-refresh" title="Atualizar Reddit" aria-label="Atualizar Reddit">${icon('i-refresh')}</button></div>`;
  }

  function msgHtml(m) {
    const k = KIND[m.kind] || KIND.reddit;
    const en = showEn.has(m.id) || !m.pt;
    const title = en ? m.title : (m.pt && m.pt.title) || m.title;
    const text = en ? m.text : (m.pt && m.pt.text) || m.text;
    const fresh = !seen.has(m.id);
    return `
      <article class="msg k-${esc(m.kind)} ${fresh ? 'is-new' : ''}" data-msg="${esc(m.id)}">
        <header class="msg-head">
          <span class="msg-src">${icon(k.icon)}${esc(m.channel || k.label)}</span>
          ${m.author ? `<span class="msg-author">${esc(m.author)}</span>` : ''}
          <span class="grow"></span>
          <time title="${esc(U.fullDate(m.date))} ${esc(U.clock(m.date))}">${esc(U.relDate(m.date))}</time>
        </header>
        ${title ? `<h4 class="msg-title" data-open-msg="${esc(m.id)}" role="button" tabindex="0" ${en ? 'lang="en"' : ''}>${esc(title)}</h4>` : ''}
        ${text ? `<p class="msg-text" ${en ? 'lang="en"' : ''}>${esc(text)}</p>` : ''}
        <footer class="msg-foot">
          ${m.pt ? `<button class="lang-toggle lang-sm ${en ? 'is-en' : ''}" data-msg-lang="${esc(m.id)}" title="${en ? 'Ver em português' : 'Ver original em inglês'}"><span class="${en ? '' : 'on'}">PT</span><span class="${en ? 'on' : ''}">EN</span></button>` : '<span class="tag tag-pending">traduzindo</span>'}
          <span class="grow"></span>
          <button class="linkish" data-open-msg="${esc(m.id)}">${icon('i-out')}Abrir</button>
        </footer>
      </article>`;
  }

  function markSeen(list) {
    clearTimeout(Community.seenTimer);
    Community.seenTimer = setTimeout(() => { list.forEach((m) => seen.add(m.id)); saveSeen(); Community.count(); if (window.News) News.counts(); }, 2500);
  }

  /** Reddit tab */
  Community.render = function () {
    const list = reddit();
    let html = statusHtml();
    if (list.length) html += list.map(msgHtml).join('');
    else html += `<div class="list-empty">${G.community.lastRefresh ? 'Nenhuma conversa sobre o Forever no Reddit neste filtro.' : 'Buscando conversas do Reddit…'}</div>`;
    $('#news-list').innerHTML = html;
    Community.count();
    markSeen(list);
  };

  Community.refresh = async function (manual) {
    if (Community.refreshing) return;
    Community.refreshing = true;
    if (News.cat === 'reddit') Community.render();
    try {
      const r = await window.grimorio.refreshCommunity();
      G.community = r;
      if (manual && r.newCount) U.say(`${r.newCount} conversa${r.newCount > 1 ? 's' : ''} nova${r.newCount > 1 ? 's' : ''}`);
    } catch (_) {
      if (manual) U.say('Não consegui buscar o Reddit agora', 'error');
    }
    Community.refreshing = false;
    if (News.cat === 'reddit') News.render(); else News.counts();
  };

  // Janela (pergaminho) com a conversa, igual a das noticias do Wowhead
  Community.paintModal = function () {
    const m = (G.community.items || []).find((x) => x.id === Community.openId);
    if (!m) return;
    const en = Community.modalEn || !m.pt;
    const title = en ? m.title : (m.pt && m.pt.title) || m.title;
    const text = en ? m.text : (m.pt && m.pt.text) || m.text;
    const paras = String(text || '').split(/\n+/).filter(Boolean).map((p) => `<p ${en ? 'lang="en"' : ''}>${esc(p)}</p>`).join('');
    $('#news-modal-body').innerHTML = `
      <div class="nm-top">
        <span class="nm-cat">${esc(m.channel || 'Reddit')}${m.author ? ' · ' + esc(m.author) : ''}</span>
        ${m.pt ? `<button class="lang-toggle ${en ? 'is-en' : ''}" id="cm-lang" title="${en ? 'Voltar para o português' : 'Ver o original em inglês'}" aria-pressed="${en}"><span class="${en ? '' : 'on'}">PT</span><span class="${en ? 'on' : ''}">EN</span></button>` : ''}
      </div>
      <h2 class="nm-title" id="nm-title" ${en ? 'lang="en"' : ''}>${esc(title || 'Conversa do Reddit')}</h2>
      <div class="nm-meta"><span>${esc(U.fullDate(m.date))} ${esc(U.clock(m.date))}</span></div>
      <div class="nm-reddit">${paras || '<p class="dim">Esta conversa não trouxe texto. Abra no Reddit para ver tudo.</p>'}</div>
      <h3 class="nm-h">Fonte</h3>
      <div class="nm-sources">${m.link ? `<button class="nm-source" data-url="${esc(m.link)}">${icon('src-reddit')}Abrir no Reddit${icon('i-out')}</button>` : ''}</div>
      <div class="nm-foot">${icon('i-spark')}O texto vem do resumo que o Reddit entrega. Comentários e imagens ficam no site.</div>`;
  };
  Community.open = function (id) {
    Community.openId = id;
    Community.modalEn = false;
    Community.paintModal();
    $('#news-modal').hidden = false;
    const box = $('#news-parchment');
    box.scrollTop = 0;
    box.focus({ preventScroll: true });
  };

  Community.bind = function () {
    $('#news-modal').addEventListener('click', (e) => {
      if (e.target.closest('#cm-lang')) { Community.modalEn = !Community.modalEn; Community.paintModal(); }
    });
    $('#news-list').addEventListener('keydown', (e) => {
      const t = e.target.closest('.msg-title[data-open-msg]');
      if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); Community.open(t.dataset.openMsg); }
    });
    $('#news-list').addEventListener('click', (e) => {
      const lang = e.target.closest('[data-msg-lang]');
      if (lang) {
        const id = lang.dataset.msgLang;
        if (showEn.has(id)) showEn.delete(id); else showEn.add(id);
        const m = (G.community.items || []).find((x) => x.id === id);
        const el = lang.closest('.msg');
        if (m && el) el.outerHTML = msgHtml(m);
        return;
      }
      const opn = e.target.closest('[data-open-msg]');
      if (opn) { Community.open(opn.dataset.openMsg); return; }
      if (e.target.closest('#comm-refresh')) { Community.refresh(true); return; }
      const txt = e.target.closest('.msg-text');
      if (txt) txt.classList.toggle('is-open');
    });
  };
})();

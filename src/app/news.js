/* Chronicle: curated news + live feed items, always shown in Portuguese */
(function () {
  'use strict';
  const { $, $$, esc, icon } = U;

  const News = (window.News = { cat: 'wowhead', lang: 'pt', openId: null, drawer: false });
  const ptCache = new Map(); // translations requested from the renderer (fallback when the main process had none)
  const articles = new Map(); // full articles: rawId → { state: 'loading' | 'ok' | 'error', data, message }
  let translating = false;

  function normalizeLive(it) {
    const ai = it.ai || null;
    if (ai && ai.relevante === false) return null;
    const category = ai ? ai.categoria : it.category;
    const pt = it.pt || ptCache.get(it.id) || null;
    const hasPt = !!((ai && ai.titulo) || pt);
    return {
      id: 'live-' + it.id,
      rawId: it.id,
      live: true,
      hasAI: !!ai,
      hasPt,
      engine: ai && ai.titulo ? 'claude' : pt ? pt.engine : null,
      category,
      impact: ai ? ai.impacto : (category === 'atencao' ? 'medio' : 'baixo'),
      date: it.date,
      title: (ai && ai.titulo) || (pt && pt.title) || it.title,
      summary: ((ai && ai.resumo) || (pt && pt.text) || '').replace(/\s*(Continuar lendo|Continue lendo|Leia mais)\s*»?\s*$/i, ''),
      bullets: ai ? ai.pontos : [],
      why: ai ? ai.porque : '',
      build: (ai && ai.build) || it.buildAlert,
      rota: ai && ai.rota,
      full: !!it.full,
      orig: { title: it.title, text: it.snippet || '' },
      sources: [{ name: it.source, kind: it.sourceKind, url: it.link }]
    };
  }

  News.all = function () {
    const curated = (G.content.news || []).map((n) => ({ ...n, live: false, hasAI: true, hasPt: true }));
    const curatedUrls = new Set(curated.flatMap((n) => (n.sources || []).map((s) => s.url)));
    const live = (G.feed.items || [])
      .map(normalizeLive)
      .filter(Boolean)
      .filter((n) => !curatedUrls.has(n.sources[0].url));
    return [...live, ...curated].sort((a, b) => U.parseDate(b.date) - U.parseDate(a.date));
  };

  /** Route hints the AI pulled out of live news (used by the Rota de poder) */
  News.routeHints = function () {
    return News.all().filter((n) => n.live && n.rota).map((n) => ({ ...n.rota, newsId: n.id, date: n.date, source: n.sources[0] }));
  };

  // Live items that still read in English get translated here as a fallback
  async function ensurePt() {
    if (translating) return;
    const missing = (G.feed.items || []).filter((it) => !(it.ai && it.ai.titulo) && !it.pt && !ptCache.has(it.id)).slice(0, 12);
    if (!missing.length) return;
    translating = true;
    try {
      const texts = missing.flatMap((it) => [it.title, (it.snippet || '').slice(0, 700)]);
      const r = await window.grimorio.translate(texts);
      if (r.engine !== 'nenhum') {
        missing.forEach((it, i) => ptCache.set(it.id, { title: r.texts[i * 2], text: r.texts[i * 2 + 1], engine: r.engine }));
        News.render();
      }
    } catch (_) { /* offline: keeps the "tradução pendente" state */ }
    translating = false;
  }

  // Tabs: Wowhead (every Forever story from Wowhead + the pre-launch archive) and Reddit
  function inCat(n, cat) {
    if (cat === 'wowhead') return n.live ? (n.sources[0] || {}).kind === 'wowhead' : n.category !== 'bruxo';
    return false;
  }

  function entryHtml(n) {
    const src = (n.sources || [])[0] || { name: 'Fonte', kind: 'news' };
    const read = G.readIds.has(n.id);
    const tags = [];
    if (n.live) tags.push(`<span class="tag tag-live">${icon('i-spark')}ao vivo</span>`);
    if (n.live && n.hasAI) tags.push('<span class="tag tag-ai">resumo IA</span>');
    if (n.live && !n.hasPt) tags.push('<span class="tag tag-pending">traduzindo</span>');
    if (n.build) tags.push('<span class="tag tag-build">build</span>');
    if (n.impact === 'alto') tags.push('<span class="tag tag-impact-alto">impacto alto</span>');
    const summary = n.summary || (n.live && !n.hasPt ? 'Tradução a caminho. Abra para ver o original em inglês.' : '');
    return `
      <button class="entry cat-${esc(n.category)} impact-${esc(n.impact || 'baixo')} ${read ? 'is-read' : ''}" data-id="${esc(n.id)}">
        <span class="entry-title">${esc(n.title)}</span>
        ${summary ? `<span class="entry-sum">${esc(summary)}</span>` : ''}
        <span class="entry-meta">
          <span>${esc(U.relDate(n.date))}</span>
          ${tags.join('')}
          <span class="grow"></span>
          <span class="source-mark k-${esc(src.kind)}" title="Fonte: ${esc(src.name)}">${icon(U.sourceKindIcon(src.kind))}${esc(src.name.split(' · ')[0])}</span>
        </span>
      </button>`;
  }

  News.counts = function () {
    const all = News.all();
    const unread = (cat) => all.filter((n) => n.live && inCat(n, cat) && !G.readIds.has(n.id)).length;
    const w = unread('wowhead');
    $('#c-wowhead').textContent = w || '';
    const r = window.Community ? Community.count() : 0;
    const rail = $('#rail-count');
    if (rail) { rail.textContent = w + r > 99 ? '99+' : String(w + r); rail.hidden = !(w + r); }
  };

  // Marca todas as noticias da aba Wowhead como vistas
  News.markAllRead = function () {
    News.all().filter((n) => inCat(n, 'wowhead')).forEach((n) => G.readIds.add(n.id));
    G.saveUi();
    News.render();
  };
  const markBtn = $('#news-markall');
  if (markBtn) markBtn.addEventListener('click', () => News.markAllRead());

  /* ---------- the drawer ---------- */
  News.openDrawer = function (on) {
    News.drawer = on !== false;
    $('#news-drawer').hidden = !News.drawer;
    $('#news-backdrop').hidden = !News.drawer;
    $('#news-rail').setAttribute('aria-expanded', String(News.drawer));
    document.body.classList.toggle('drawer-open', News.drawer);
    if (News.drawer) News.render();
  };

  News.render = function () {
    News.counts();
    $$('#news-tabs .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.cat === News.cat)));
    const mk = $('#news-markall'); if (mk) mk.hidden = News.cat !== 'wowhead';
    if (News.cat === 'reddit') { Community.render(); return; }

    const all = News.all();
    const list = all.filter((n) => inCat(n, News.cat));
    const live = list.filter((n) => n.live);
    const curated = list.filter((n) => !n.live);
    let html = '';
    if (live.length) html += `<div class="list-section">${News.cat === 'wowhead' ? 'Wowhead · WoW Forever' : 'Recém-chegadas das fontes'}</div>` + live.map(entryHtml).join('');
    else if (News.cat === 'wowhead') html += `<div class="list-empty">${G.feed.lastRefresh ? 'Nenhuma matéria nova do Forever no Wowhead nos últimos dias.' : 'Buscando as matérias do Wowhead…'}</div>`;
    if (curated.length) {
      html += `<div class="list-section">${News.cat === 'wowhead' ? 'Arquivo do Grimório · antes do lançamento' : 'Arquivo do Grimório'}</div>` + curated.map(entryHtml).join('');
    }
    $('#news-list').innerHTML = html;
    ensurePt();
  };

  /* ---------- full article ---------- */
  // Inline markup from the main process: <b>, <i>, <aN>…</aN> (links) and [[N]] (spells, items, NPCs)
  function inline(s, art) {
    let h = esc(s);
    h = h.replace(/&lt;(\/?)(b|i)&gt;/g, '<$1$2>');
    h = h.replace(/&lt;a(\d+)&gt;([\s\S]*?)&lt;\/a\1&gt;/g, (m, k, inner) => {
      const u = (art.links || [])[k - 1];
      return u ? `<a class="nm-link" href="#" data-url="${esc(u)}">${inner}</a>` : inner;
    });
    h = h.replace(/&lt;\/?a\d+&gt;/g, '');
    return h.replace(/\[\[(\d+)\]\]/g, (m, k) => refHtml((art.refs || [])[k - 1], k));
  }

  function refHtml(r, k) {
    if (!r) return '';
    const ico = r.icon ? U.wowIcon(r.icon, 'small', 'nm-ico', r.name) : '';
    if (!r.name) return ico;
    const q = r.quality != null ? ` q${Math.max(0, Math.min(5, r.quality))}` : '';
    return `<span class="nm-ref t-${esc(r.type)}${q}" data-ref="${esc(k)}" ${r.url ? `data-url="${esc(r.url)}"` : ''}>${ico}${esc(r.name)}</span>`;
  }

  function articleHtml(art, en) {
    const T = (b) => (en ? b.text : b.pt || b.text);
    const blocks = art.blocks || [];
    let html = art.hero ? `<img class="nm-hero" src="${esc(art.hero)}" alt="" loading="lazy">` : '';
    let openQ = 0;
    let openList = '';
    let openTable = 0;
    let openRow = -1;
    const closeList = () => { if (openList) { html += `</${openList}>`; openList = ''; } };
    const closeTable = () => { if (openTable) { html += '</tr></table></div>'; openTable = 0; openRow = -1; } };
    const closeQuote = () => { closeList(); closeTable(); if (openQ) { html += '</blockquote>'; openQ = 0; } };
    for (const b of blocks) {
      const q = b.q || 0;
      if (q !== openQ) {
        closeQuote();
        if (q) {
          const src = blocks.find((x) => x.q === q && x.t === 'qsrc');
          html += `<blockquote class="nm-quote${src && src.blue ? ' blue' : ''}">`;
          openQ = q;
        }
      }
      if (b.t !== 'li') closeList();
      if (b.t !== 'td') closeTable();
      if (b.t === 'qsrc') html += `<div class="nm-qsrc">${b.blue ? icon('src-blizzard') : ''}${esc(b.text)}</div>`;
      else if (b.t === 'h') { const lv = Math.min(4, Math.max(2, b.level || 2)); html += `<h${lv + 1} class="nm-ah l${lv}">${inline(T(b), art)}</h${lv + 1}>`; }
      else if (b.t === 'p') html += `<p class="nm-p">${inline(T(b), art)}</p>`;
      else if (b.t === 'li') {
        const tag = b.ordered ? 'ol' : 'ul';
        if (openList !== tag) { closeList(); html += `<${tag} class="nm-ul">`; openList = tag; }
        html += `<li class="d${Math.min(4, b.depth || 1)}">${inline(T(b), art)}</li>`;
      } else if (b.t === 'td') {
        if (openTable !== b.table) { closeTable(); html += '<div class="nm-tablewrap"><table class="nm-table"><tr>'; openTable = b.table; openRow = b.row; }
        else if (b.row !== openRow) { html += '</tr><tr>'; openRow = b.row; }
        const tag = b.th ? 'th' : 'td';
        html += `<${tag}>${inline(T(b), art)}</${tag}>`;
      } else if (b.t === 'img') html += `<img class="nm-img" src="${esc(b.src)}" alt="${esc(b.alt || '')}" loading="lazy">`;
      else if (b.t === 'video') html += `<button class="nm-video" data-url="${esc(b.url)}"><img src="https://i.ytimg.com/vi/${esc(b.id)}/hqdefault.jpg" alt="" loading="lazy"><span>${icon('i-play')}Assistir no YouTube</span></button>`;
      else if (b.t === 'embed') html += `<button class="nm-embed" data-url="${esc(b.url)}">${icon('i-out')}${esc(b.label)}</button>`;
      else if (b.t === 'hr') html += '<hr class="nm-hr">';
    }
    closeQuote();
    return `<div class="nm-article" ${en ? 'lang="en"' : ''}>${html}</div>`;
  }

  // Shared with the leveling guide, which uses the same block format
  News.articleHtml = articleHtml;
  News.inlineHtml = (text, art) => inline(text, art);

  function articleSection(n, en) {
    if (!n.live || !n.full) return '';
    const a = articles.get(n.rawId);
    const src = ((n.sources || [])[0] || {}).name || 'fonte';
    if (!a || a.state === 'loading') {
      return `<div class="nm-art-loading"><span class="nm-spin"></span>${en ? `Buscando a matéria completa no ${esc(src)}…` : `Trazendo a matéria completa do ${esc(src)} e traduzindo…`}</div>
        <div class="nm-skel"><i></i><i></i><i></i><i></i><i class="short"></i></div>`;
    }
    if (a.state === 'error') {
      return `<div class="nm-why"><b>Não deu para trazer a matéria completa agora</b>${esc(a.message || '')}. <button class="linkish" data-art-retry>Tentar de novo</button></div>`;
    }
    const viaFeed = a.data.via === 'rss' ? `<p class="nm-note nm-via">Texto completo que o ${esc(src)} publica no feed. As imagens e os ícones de feitiços ficam na página original.</p>` : '';
    return `<h3 class="nm-h nm-art-h">${icon('src-news')}${en ? 'Matéria completa · original em inglês' : 'Matéria completa'}</h3>${viaFeed}${articleHtml(a.data, en)}`;
  }

  async function loadArticle(n, force) {
    if (!n || !n.live || !n.full) return;
    const cur = articles.get(n.rawId);
    if (cur && (cur.state === 'loading' || (cur.state === 'ok' && !force))) return;
    articles.set(n.rawId, { state: 'loading' });
    if (News.openId === n.id) repaint();
    let r;
    try { r = await window.grimorio.getArticle(n.rawId); } catch (e) { r = { ok: false, message: String((e && e.message) || e) }; }
    articles.set(n.rawId, r && r.ok ? { state: 'ok', data: r.article } : { state: 'error', message: (r && r.message) || 'sem resposta' });
    if (News.openId === n.id) repaint();
  }

  function repaint() {
    const box = $('#news-parchment');
    const top = box ? box.scrollTop : 0;
    News.paintModal();
    if (box) box.scrollTop = top;
    updateScroll();
  }

  /* Reading progress along the top edge and a "back to the start" button for long stories */
  function updateScroll() {
    const box = $('#news-parchment');
    if (!box) return;
    const room = box.scrollHeight - box.clientHeight;
    const scrollable = room > 24;
    box.classList.toggle('is-scrollable', scrollable);
    $('#nm-progress').style.width = scrollable ? `${Math.min(100, (box.scrollTop / room) * 100).toFixed(1)}%` : '0%';
    $('#nm-top').hidden = box.scrollTop < 480;
  }

  function ptBody(n) {
    let body = '';
    const art = articles.get(n.rawId);
    const hasArticle = !!(art && art.state === 'ok');
    // Without an AI summary the "summary" is just the article's opening line: the article itself replaces it
    if (n.summary && !(hasArticle && !n.hasAI)) body += `<h3 class="nm-h">${icon('i-spark')}Resumo</h3><p class="nm-sum">${esc(n.summary)}</p>`;
    else if (n.live && !n.summary && !hasArticle) body += `<div class="nm-why"><b>Tradução pendente</b>O Grimório ainda não conseguiu traduzir este item (sem conexão com o tradutor). Veja o original no botão EN.</div>`;
    if (n.bullets && n.bullets.length) body += `<h3 class="nm-h">Em tópicos</h3><ul class="nm-list">${n.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`;
    if (n.why) body += `<div class="nm-why"><b>O que muda para você</b>${esc(n.why)}</div>`;
    body += articleSection(n, false);
    return body;
  }

  function enBody(n) {
    const o = n.orig || {};
    if (n.live) {
      if (n.full) return articleSection(n, true);
      return `<h3 class="nm-h">Original (${esc(n.sources[0].name || 'fonte')})</h3>
        ${o.text ? `<p class="nm-raw" lang="en">${esc(o.text.slice(0, 1400))}${o.text.length > 1400 ? '…' : ''}</p>` : ''}
        <p class="nm-note">Esta fonte publica só o começo da matéria. O texto completo está na fonte.</p>`;
    }
    if (!o.title) return '<p class="nm-note">Este item não tem versão em inglês guardada. Abra a fonte para o original.</p>';
    return `<h3 class="nm-h">Original em inglês</h3>
      <p class="nm-sum" lang="en">${esc(o.summary)}</p>
      ${o.bullets && o.bullets.length ? `<ul class="nm-list" lang="en">${o.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      <p class="nm-note">Resumo em inglês das fontes abaixo. O texto completo está em cada fonte.</p>`;
  }

  function engineNote(n) {
    if (!n.live) return 'Resumo escrito por IA (Claude) a partir das fontes. Confira a fonte antes de decisões caras, como respec.';
    const art = articles.get(n.rawId);
    if (art && art.state === 'ok') {
      const e = art.data.engine;
      if (e === 'claude') return 'Matéria completa traduzida pela IA (Claude). Nomes de feitiços e itens ficam em inglês, como no jogo.';
      if (e === 'google' || e === 'cache') return 'Matéria completa traduzida automaticamente (Google Tradutor). Nomes de feitiços e itens ficam em inglês. Com a chave da IA em Ajustes, a tradução fica mais caprichada.';
      return 'A tradução da matéria não respondeu agora; ela aparece em inglês e o Grimório tenta de novo mais tarde.';
    }
    if (n.hasAI) return 'Resumo e tradução da IA (Claude) a partir da fonte.';
    if (n.engine === 'google') return 'Tradução automática (Google Tradutor). Adicione sua chave da IA em Ajustes para resumos mais caprichados.';
    if (n.engine === 'claude') return 'Tradução da IA (Claude).';
    return 'Item ao vivo ainda sem tradução.';
  }

  News.paintModal = function () {
    const n = News.all().find((x) => x.id === News.openId);
    if (!n) return;
    const catLabel = { geral: 'Informações gerais', atencao: 'Polêmica' }[n.category] || 'Notícia';
    const impactLabel = { alto: 'Impacto alto', medio: 'Impacto médio', baixo: 'Impacto baixo' }[n.impact] || '';
    const en = News.lang === 'en';
    const sources = (n.sources || []).map((s) => `
      <button class="nm-source" data-url="${esc(s.url)}">${icon(U.sourceKindIcon(s.kind))}${esc(s.name)}${icon('i-out')}</button>`).join('');
    $('#news-modal-body').innerHTML = `
      <div class="nm-top">
        <span class="nm-cat">${esc(catLabel)}${impactLabel ? ' · ' + esc(impactLabel) : ''}${n.live ? ' · chegou ao vivo' : ''}</span>
        <button class="lang-toggle ${en ? 'is-en' : ''}" id="nm-lang" title="${en ? 'Voltar para o português' : 'Ver o original em inglês'}" aria-pressed="${en}">
          <span class="${en ? '' : 'on'}">PT</span><span class="${en ? 'on' : ''}">EN</span>
        </button>
      </div>
      <h2 class="nm-title" id="nm-title" ${en ? 'lang="en"' : ''}>${esc(en ? (n.orig && n.orig.title) || n.title : n.title)}</h2>
      <div class="nm-meta"><span>${esc(U.fullDate(n.date))}</span></div>
      ${en ? enBody(n) : ptBody(n)}
      <h3 class="nm-h">Fontes</h3>
      <div class="nm-sources">${sources}</div>
      <div class="nm-foot">${icon('i-spark')}${esc(engineNote(n))}</div>`;
  };

  News.open = function (id) {
    const n = News.all().find((x) => x.id === id);
    if (!n) return;
    G.readIds.add(id);
    G.saveUi();
    News.openId = id;
    News.lang = 'pt';
    News.paintModal();
    $('#news-modal').hidden = false;
    const box = $('#news-parchment');
    box.scrollTop = 0;
    updateScroll();
    // Focus the parchment so the wheel, arrows, Page Down and Space scroll the story right away
    box.focus({ preventScroll: true });
    loadArticle(n);
    News.counts();
    const el = $(`#news-list .entry[data-id="${CSS.escape(id)}"]`);
    if (el) el.classList.add('is-read');
  };

  News.bind = function () {
    $('#news-tabs').addEventListener('click', (e) => {
      const t = e.target.closest('.tab');
      if (!t) return;
      News.cat = t.dataset.cat;
      News.render();
      $('#news-list').scrollTop = 0;
    });
    $('#news-rail').addEventListener('click', () => News.openDrawer(!News.drawer));
    $('#news-close').addEventListener('click', () => News.openDrawer(false));
    $('#news-backdrop').addEventListener('click', () => News.openDrawer(false));
    $('#news-list').addEventListener('click', (e) => {
      const b = e.target.closest('.entry');
      if (b) News.open(b.dataset.id);
    });
    $('#news-modal').addEventListener('click', (e) => {
      if (e.target.closest('#nm-lang')) { News.lang = News.lang === 'en' ? 'pt' : 'en'; News.paintModal(); return; }
      if (e.target.closest('[data-art-retry]')) loadArticle(News.all().find((x) => x.id === News.openId), true);
    });
    const parchment = $('#news-parchment');
    parchment.addEventListener('scroll', updateScroll, { passive: true });
    $('#nm-top').addEventListener('click', () => { parchment.scrollTo({ top: 0, behavior: 'smooth' }); parchment.focus({ preventScroll: true }); });
    // Images arrive after the text: the scroll length changes as they load
    parchment.addEventListener('load', updateScroll, true);
    window.addEventListener('resize', updateScroll);

    // Spell, item and NPC names show their in-game description on hover
    const modal = $('#news-modal');
    modal.addEventListener('mouseover', (e) => {
      const el = e.target.closest('.nm-ref');
      if (!el) return;
      const n = News.all().find((x) => x.id === News.openId);
      const a = n && articles.get(n.rawId);
      const r = a && a.data && (a.data.refs || [])[Number(el.dataset.ref) - 1];
      if (!r) return;
      U.tip.show(el, `<div class="tt-title" style="color:${r.quality != null ? U.qColor(r.quality) : '#fff'}">${esc(r.name)}</div>${r.desc ? `<div class="tt-yellow">${esc(r.desc)}</div>` : ''}${r.url ? '<div class="tt-dim">Clique para ver no Wowhead</div>' : ''}`);
    });
    modal.addEventListener('mouseout', (e) => { if (e.target.closest('.nm-ref')) U.tip.hide(); });
    // Stories fetched in the background: an open story fills in as soon as its article is ready
    window.grimorio.onArticleReady(({ id }) => {
      const cur = articles.get(id);
      if (cur && cur.state === 'ok') return;
      const n = News.all().find((x) => x.rawId === id);
      if (n) loadArticle(n, true);
    });

  };
})();

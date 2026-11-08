/* Leveling guide (Mobalytics): the most favorited guide of the character's class — tips for your
   level, talent order, what changed — plus a class picker when there is no Armory yet */
(function () {
  'use strict';
  const { $, $$, esc, icon } = U;

  const Guide = (window.Guide = { data: null, lang: 'pt', band: null, busy: false });
  const LS = { get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* optional */ } } };
  const clsSlug = () => (window.Char && Char.classSlug ? Char.classSlug() : null);
  const clsInfo = () => (window.Char && Char.classInfo ? Char.classInfo() : null);
  // The build picked by hand, per class
  const pickedSpec = () => LS.get('guide.spec.' + (clsSlug() || 'none'));

  // Until the player picks a guide, there is none (even if an older one is still stored)
  const g = () => (Guide.data && !Guide.data.needsPick && Guide.data.guide) || null;
  const level = () => (window.Char && Char.level ? Char.level() : 1);
  const en = () => Guide.lang === 'en';
  const T = (b) => (en() ? b.text : b.pt || b.text);
  const titleOf = (x) => (en() ? x.title : x.titlePt || x.title);
  const shortDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const opts = d.getFullYear() === new Date().getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' };
    return d.toLocaleDateString('pt-BR', opts).replace(/\./g, '');
  };
  const stamp = (iso) => (iso ? `${shortDate(iso)}, ${U.clock(iso)}` : '');

  Guide.load = async function () {
    try { Guide.data = await window.grimorio.getGuide(); } catch (_) { Guide.data = null; }
    const unseen = (Guide.data && Guide.data.history || []).some((h) => !h.seen);
    const dot = $('#guide-dot');
    if (dot) dot.hidden = !unseen;
  };

  /* ---------- pieces of the guide ---------- */
  const sectionBy = (rx) => (g() ? g().sections.find((s) => rx.test(s.title)) : null);
  // The variants that carry a talent build (Crix: "Leveling Spec"; others: "Guide Variants"…)
  const buildSection = () => (g() ? g().sections.find((s) => s.kind === 'variants' && (s.variants || []).some((v) => talentsOf(v))) || sectionBy(/leveling spec/i) : null);
  const specVariants = () => ((buildSection() || {}).variants || []);
  const walkVariants = () => ((sectionBy(/walkthrough/i) || {}).variants || []);

  // Main tree of a build: the one with the most points
  function mainTreeOf(v) {
    const t = talentsOf(v);
    if (!t) return null;
    const top = Object.entries(t.points || {}).sort((a, b) => b[1] - a[1])[0];
    return top && top[1] > 0 ? top[0] : null;
  }

  /**
   * The build to show: the one picked by hand, else the one that fits the character's spec and still
   * covers their level ("Recommended" first), else any build that covers the level, else the longest.
   */
  function chosenSpec() {
    const vs = specVariants();
    if (!vs.length) return null;
    const picked = vs.find((v) => v.id === pickedSpec());
    if (picked) return picked;
    const lvl = level();
    const withT = vs.filter((v) => talentsOf(v));
    const covers = (v) => { const t = talentsOf(v); return t && t.path.length + 9 >= Math.min(lvl, 60); };
    const t = window.Char && Char.armoryTalents ? Char.armoryTalents() : null;
    const top = t && t.points > 0 ? [...t.trees].sort((p, q) => q.points - p.points)[0] : null;
    const cls = clsInfo();
    const armorySpec = top && cls ? (cls.specs || []).find((sp) => [sp.id, sp.pt.toLowerCase(), sp.en.toLowerCase()].includes(String(top.id || '').toLowerCase()) || sp.pt.toLowerCase() === String(top.name || '').toLowerCase()) : null;
    const fits = (v) => !armorySpec || mainTreeOf(v) === armorySpec.en || new RegExp(armorySpec.en, 'i').test(v.title);
    const pool = withT.filter((v) => !/respec/i.test(v.title));
    const rank = (list) => list.find((v) => /recommend/i.test(v.title)) || list[0];
    return rank(pool.filter((v) => fits(v) && covers(v)))
      || rank(pool.filter(covers))
      || rank(pool.filter(fits))
      || [...withT].sort((a, b) => talentsOf(b).path.length - talentsOf(a).path.length)[0]
      || vs[0];
  }
  Guide.mainTree = () => mainTreeOf(chosenSpec());

  function bandFor(lvl) {
    const vs = walkVariants();
    const pick = vs.find((v) => { const m = v.title.match(/(\d+)\s*[-–]\s*(\d+)/); return m && lvl >= Number(m[1]) && (lvl < Number(m[2]) || Number(m[2]) >= 60); });
    return vs.find((v) => v.id === Guide.band) || pick || vs[0] || null;
  }

  const talentsOf = (v) => { const p = v && (v.parts || []).find((x) => x.talents); return p && p.talents; };
  const partOf = (v, kind) => v && (v.parts || []).find((x) => x.kind === kind);

  // Blocks rendered with the article engine (refs and links are shared by the whole guide)
  const blocksHtml = (blocks, limit) => News.articleHtml({ blocks: limit ? blocks.slice(0, limit) : blocks, refs: g().refs, links: g().links }, en());

  function talentIco(t) { return t.icon ? U.wowIcon(t.icon, 'small', 'gd-ico', t.name) : `<span class="wicon wicon-fb gd-ico">${esc((t.name || '?')[0])}</span>`; }

  function nextTalentsHtml(v, lvl, count) {
    const t = talentsOf(v);
    if (!t || !t.path.length) return '';
    if (lvl < 10) {
      const first = t.path[0];
      return `<p class="gd-note">O primeiro ponto de talento chega no nível 10: ${talentIco(first)}<b>${esc(first.name)}</b>.</p>`;
    }
    const from = t.path.findIndex((x) => x.level >= lvl);
    const rows = (from >= 0 ? t.path.slice(Math.max(0, from - 1), from - 1 + (count || 6)) : t.path.slice(-3));
    return `<ol class="gd-tlist">${rows.map((x) => `
      <li class="${x.level === lvl ? 'is-now' : x.level < lvl ? 'is-past' : ''}">
        <span class="gd-lv">${esc(x.level)}</span>${talentIco(x)}<span class="gd-tname">${esc(x.name)}</span><span class="gd-rank">${esc(x.rank)}/${esc(x.max)}</span>
      </li>`).join('')}</ol>`;
  }

  function changeCard(entry, compact, inGuide) {
    if (!entry) return '';
    return `
      <div class="gd-change ${entry.seen ? 'is-seen' : ''}">
        <div class="gd-change-head">${icon('i-spark')}<b>${entry.seen ? 'Última mudança no guia' : 'O guia mudou'}</b><span>${esc(stamp(entry.at))}${entry.to ? ` · versão ${esc(entry.to)}` : ''}</span></div>
        <ul>${(entry.bullets || []).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
        ${!compact && entry.sections && entry.sections.length ? `<p class="gd-note">Seções mexidas: ${esc(entry.sections.join('; '))}</p>` : ''}
        ${entry.seen ? '' : `<div class="gd-change-actions"><button class="btn btn-sm" data-gd="seen" data-id="${esc(entry.id)}">${icon('i-check')}Entendi</button>${inGuide ? '' : '<button class="linkish" data-gd="open" data-sec="history">Ver no guia</button>'}</div>`}
      </div>`;
  }

  /* ---------- your level: what to train, skip and run (from the walkthrough) ---------- */
  const planBands = () => ((Guide.data && Guide.data.plan && Guide.data.plan.bands) || []);
  const faction = () => (window.Char && Char.faction ? Char.faction() : 'ALLIANCE');

  function levelPlan(lvl) {
    const bands = planBands();
    if (!bands.length) return null;
    const train = bands.flatMap((b) => b.train).sort((a, b) => a.level - b.level);
    const skip = bands.flatMap((b) => b.skip).sort((a, b) => a.level - b.level);
    const now = train.filter((x) => x.level <= lvl).pop() || null;
    const before = now ? train.filter((x) => x.level < now.level).pop() || null : null;
    const next = train.find((x) => x.level > lvl) || null;
    const skipNow = skip.filter((x) => x.level <= lvl && x.level > (before ? before.level : 0));
    const band = bands.find((b) => b.from != null && lvl >= b.from && (lvl < b.to || b.to >= 60)) || null;
    const mine = (d) => !d.only || d.only === faction();
    const dungeons = bands.flatMap((b) => b.dungeons).filter(mine);
    const seen = new Set();
    const uniq = (d) => (seen.has(d.name) ? false : seen.add(d.name));
    const dNow = dungeons.filter((d) => d.from <= lvl && lvl <= d.to).filter(uniq);
    const dSoon = dungeons.filter((d) => d.from > lvl && d.from <= lvl + 4).filter(uniq);
    const trainNote = (band && band.trainNote) || (bands.find((b) => b.trainNote) || {}).trainNote || null;
    return { now, before, next, skipNow, band, dNow, dSoon, trainNote };
  }
  Guide.levelPlan = levelPlan;

  const spellsHtml = (items, cls) => `<ul class="gd-spells ${cls || ''}">${items.map((it) => `<li>${News.inlineHtml(T(it), g())}</li>`).join('')}</ul>`;
  const range = (d) => (d.from === d.to ? `${d.from}` : `${d.from}–${d.to}`);

  function levelCardHtml(lvl) {
    const p = levelPlan(lvl);
    if (!p || (!p.now && !p.next)) return '';
    const dun = (d) => `<li><span class="gd-dname">${esc(d.name)}</span><span class="gd-rank">níveis ${esc(range(d))}</span>${d.only ? `<span class="gd-only">só ${d.only === 'ALLIANCE' ? 'Aliança' : 'Horda'}</span>` : ''}${d.note ? `<span class="gd-rank">${esc(d.note)}</span>` : ''}</li>`;
    return `
      <section class="gd-card gd-lvl">
        <h4>${icon('sigil')}Para o seu nível ${esc(lvl)}${p.band ? `<span class="dim">guia de ${esc(g().author)} · ${esc(p.band.title)}</span>` : ''}</h4>
        ${p.now ? `
          <div class="gd-lvl-row is-train">
            <div class="gd-lvl-tag">Treinar no instrutor <b>nível ${esc(p.now.level)}</b></div>
            ${spellsHtml(p.now.items)}
          </div>` : ''}
        ${p.before ? `
          <div class="gd-lvl-row">
            <div class="gd-lvl-tag">Se ainda não pegou <b>nível ${esc(p.before.level)}</b></div>
            ${spellsHtml(p.before.items, 'is-inline')}
          </div>` : ''}
        ${p.skipNow.length ? `
          <div class="gd-lvl-row is-skip">
            <div class="gd-lvl-tag">Pode pular <b>economiza ouro</b></div>
            ${spellsHtml(p.skipNow.flatMap((x) => x.items), 'is-inline')}
          </div>` : ''}
        ${p.next ? `
          <div class="gd-lvl-row is-next">
            <div class="gd-lvl-tag">Próximo treino <b>nível ${esc(p.next.level)}</b></div>
            ${spellsHtml(p.next.items, 'is-inline')}
          </div>` : ''}
        ${p.trainNote ? `<p class="gd-note gd-demon">${News.inlineHtml(T(p.trainNote), g())}</p>` : ''}
        ${p.dNow.length || p.dSoon.length ? `
          <div class="gd-lvl-row is-dungeon">
            <div class="gd-lvl-tag">${p.dNow.length ? 'Masmorras para agora' : 'Masmorras chegando'} <b>pegue as missões antes</b></div>
            <ul class="gd-dungeons">${(p.dNow.length ? p.dNow : p.dSoon).map(dun).join('')}</ul>
            ${p.dNow.length && p.dSoon.length ? `<p class="gd-note">Logo depois: ${p.dSoon.map((d) => `${esc(d.name)} (${esc(d.from)}+)`).join(', ')}</p>` : ''}
          </div>` : ''}
        <button class="linkish" data-gd="open" data-sec="walk">${icon('i-out')}Lista completa no passo a passo</button>
      </section>`;
  }

  // What the Armory shows against what the guide says to have spent by now
  function armoryTalentsHtml(lvl) {
    const a = window.Char && Char.armoryTalents ? Char.armoryTalents() : null;
    if (!a || lvl < 10) return '';
    const want = Math.max(0, Math.min(51, lvl - 9));
    const trees = a.trees.filter((x) => x.points > 0);
    const list = trees.map((x) => `${esc(x.name)} ${esc(x.points)}: ${x.list.map((t) => `${esc(t.name)} (${esc(t.rank)})`).join(', ')}`).join(' · ');
    const left = want - a.points;
    return `<p class="gd-armory">${icon('i-link')}<span>No Armory, ${esc(a.points)} de ${esc(want)} pontos${list ? ` · ${list}` : ''}</span>${left > 0 ? `<b class="gd-warn">${esc(left)} ponto${left > 1 ? 's' : ''} para gastar</b>` : `<b class="gd-ok">${icon('i-check')}em dia</b>`}</p>`;
  }

  /* ---------- talent code (calculator format) ---------- */
  // Digits per talent in calculator order (row by row, left to right), trees joined by "-",
  // trailing zeros dropped: the format of the talent calculators. Built from the guide's own grid,
  // so it works for every class.
  function talentCode(ranksByTree, trees) {
    if (!trees || !trees.length) return null;
    const code = trees.map((tree) => {
      const want = ranksByTree[tree.name] || {};
      return [...tree.talents].sort((p, q) => p.row - q.row || p.col - q.col).map((x) => Math.min(x.max, want[x.name] || 0)).join('').replace(/0+$/, '');
    }).join('-').replace(/-+$/, '');
    return /[1-9]/.test(code) ? code : null;
  }
  function finalRanks(t) {
    const out = {};
    (t.trees || []).forEach((tr) => { out[tr.name] = {}; tr.talents.forEach((x) => { if (x.rank) out[tr.name][x.name] = x.rank; }); });
    return out;
  }
  function ranksAtLevel(t, lvl) {
    const out = {};
    t.path.filter((x) => x.level <= lvl).forEach((x) => { (out[x.tree] = out[x.tree] || {})[x.name] = x.rank; });
    return out;
  }

  /* ---------- the side panel ---------- */
  const SHORT = (v) => (/respec/i.test(v.title) ? v.title.replace(/.*?(respec)/i, 'Respec') : v.title.replace(/\s*\(?recommended\)?/i, '').replace(/\s*\d+\s*[-–]\s*\d+\s*$/, '').trim() || v.title);
  const treeIcon = (v) => { const t = talentsOf(v); const main = mainTreeOf(v); const tr = t && (t.trees || []).find((x) => x.name === main); return tr && tr.icon; };

  function pointsHtml(t) {
    const names = (t.trees || []).map((x) => x.name);
    const pts = names.map((n) => (t.points || {})[n] || 0);
    return `
      <div class="points">
        <div class="points-bar" aria-label="Distribuição de pontos ${pts.join('/')}">
          ${pts.map((p, i) => (p ? `<span class="pt-${i}" style="flex:${p}">${p}</span>` : '')).join('')}
        </div>
        <div class="points-legend">${pts.map((p, i) => `<span>${esc(names[i])} <b>${p}</b></span>`).join('')}</div>
      </div>`;
  }

  function miniTrees(t) {
    const trees = t.trees || [];
    if (!trees.length) return '';
    return `<button class="mini-trees" data-gd="open" data-sec="talents" title="Ver a ordem completa dos talentos">
      ${trees.map((tr) => `
        <span class="mini-tree" style="--rows:${Math.max(...tr.talents.map((x) => x.row))}">
          ${tr.talents.map((x) => `<i class="${x.rank ? (x.rank >= x.max ? 'full' : 'part') : ''}" style="grid-row:${x.row};grid-column:${x.col}" title="${esc(x.name)} ${x.rank}/${x.max}"></i>`).join('')}
        </span>`).join('')}
      <span class="mini-cta">${icon('i-out')}Ordem dos talentos, do 10 ao ${esc(9 + t.path.length)}</span>
    </button>`;
  }

  function classPickerHtml() {
    const cl = (G.content.classes && G.content.classes.classes) || {};
    const order = (G.content.classes && G.content.classes.order) || Object.keys(cl);
    return `
      <div class="gd-pick">
        <h3 class="h-sec">Qual é a sua classe?</h3>
        <p class="gd-note">Conecte o seu personagem (Ajustes → Armory, pelo nome ou pelo link) e o app descobre sozinho. Ou escolha a classe aqui para ver os guias de leveling dela na Mobalytics e as melhorias de equipamento.</p>
        <div class="gd-classes">${order.map((k) => `<button class="gd-class" data-gd="class" data-id="${esc(k)}" style="--cc:${esc(cl[k].color)}">${U.wowIcon(cl[k].icon, 'medium', 'gd-class-ico', cl[k].name)}<span>${esc(cl[k].name)}</span></button>`).join('')}</div>
        <button class="btn btn-sm" data-gd="armory">${icon('i-link')}Conectar o Armory</button>
      </div>`;
  }

  const guideName = (o) => String(o.name || '').replace(/\s*[-–|:]\s*(Talents|Rotation|Tips).*$/i, '').trim() || 'Guia de leveling';
  const specPt = (id) => {
    const c = clsInfo();
    const sp = c && (c.specs || []).find((x) => x.id === id);
    return sp ? sp.pt : id.replace(/-/g, ' ');
  };

  function otherGuidesHtml(d) {
    const opts = (d.options || []).filter((o) => !d.pick || o.slug !== d.pick.slug).slice(0, 4);
    if (!opts.length) return '';
    return `
      <section>
        <h3 class="h-sec">Outros guias da classe <span class="dim">por favoritos na Mobalytics</span></h3>
        <div class="gd-guides">${opts.map((o) => `<button class="gd-guide" data-gd="pick" data-id="${esc(o.slug)}" title="${esc(o.name)}"><b>${esc(o.author || 'Mobalytics')}</b><span>${esc(guideName(o))}</span><i>★ ${esc(o.favorites)}</i></button>`).join('')}</div>
        <button class="linkish" data-gd="pick" data-id="">${icon('i-out')}Ver todos e escolher de novo</button>
      </section>`;
  }

  /* Before anything else: which Mobalytics guide does the player want to follow? */
  function askGuideHtml(d, cls) {
    const opts = d.options || [];
    const top = opts.reduce((m, o) => Math.max(m, Number(o.favorites) || 0), 0);
    const list = opts.map((o) => `
      <article class="gd-opt ${top && Number(o.favorites) === top ? 'is-top' : ''}">
        <div class="gd-opt-head">
          <b>${esc(guideName(o))}</b>
          ${top && Number(o.favorites) === top ? '<span class="gd-opt-badge">Mais favoritado</span>' : ''}
        </div>
        <div class="gd-opt-meta">por <b>${esc(o.author || 'Mobalytics')}</b>${o.favorites != null ? ` · <span class="gd-opt-fav">★ ${esc(o.favorites)}</span>` : ''}${o.updatedAt ? ` · atualizado em ${esc(shortDate(o.updatedAt))}` : ''}</div>
        ${(o.specs || []).length ? `<div class="gd-opt-specs">${o.specs.map((x) => `<span class="chip chip-sm">${esc(specPt(x))}</span>`).join('')}</div>` : ''}
        <div class="gd-opt-actions">
          <button class="btn btn-sm" data-gd="pick" data-id="${esc(o.slug)}" ${Guide.busy ? 'disabled' : ''}>${icon('i-spark')}Seguir este guia</button>
          <button class="linkish" data-url="https://mobalytics.gg/wow-forever/classes/${esc(o.slug)}">${icon('i-out')}Ver na Mobalytics</button>
        </div>
      </article>`).join('');
    return `
      <div class="gd-ask">
        <h3 class="h-sec">Qual guia você quer seguir?</h3>
        <p class="gd-note">Estes são os guias de leveling de ${esc(cls.name.toLowerCase())} na Mobalytics, do mais favoritado ao menos. O app traduz o guia escolhido, monta as dicas do seu nível e avisa quando o autor mudar algo. Dá para trocar depois.</p>
        ${Guide.busy ? `<div class="list-empty">${opts.length ? 'Carregando e traduzindo o guia escolhido (a primeira vez leva alguns segundos)…' : `Procurando os guias de ${esc(cls.name.toLowerCase())} na Mobalytics…`}</div>` : ''}
        ${list ? `<div class="gd-ask-list">${list}</div>` : !Guide.busy ? `
          <div class="list-empty">${d.error ? `Não consegui listar os guias agora (${esc(d.error)}).` : 'Ainda não listei os guias desta classe.'}</div>
          <div class="gd-opt-actions"><button class="btn btn-sm" data-gd="refresh">${icon('i-refresh')}Tentar de novo</button></div>` : ''}
      </div>`;
  }

  function swSide(p) {
    if (!p) return '';
    const items = (bl) => (bl || []).map((b) => `<li>${News.inlineHtml(T(b), g())}</li>`).join('');
    return `
      <section class="proscons gd-dark">
        <div><h3 class="h-sec">Pontos fortes</h3><ul class="pros">${items(p.strengths)}</ul></div>
        <div><h3 class="h-sec">Pontos fracos</h3><ul class="cons">${items(p.weaknesses)}</ul></div>
      </section>`;
  }

  Guide.renderSide = function () {
    const box = $('#build');
    if (!box) return;
    const d = Guide.data || {};
    const gd = g();
    const lvl = level();
    const cls = clsInfo();
    $('#t-builds').firstChild.textContent = cls ? `Guia de ${cls.name}` : 'Guia de leveling';

    if (!cls) {
      $('#spec-tabs').innerHTML = '';
      box.innerHTML = classPickerHtml();
      return;
    }
    const vs = specVariants().filter((x) => talentsOf(x));
    const v = chosenSpec();
    $('#spec-tabs').innerHTML = vs.length > 1 ? vs.map((x) => `
      <button class="medal" role="tab" data-gd="spec" data-id="${esc(x.id)}" aria-selected="${!!(v && x.id === v.id)}" title="${esc(x.title)}">
        <span class="medal-ring">${treeIcon(x) ? U.wowIcon(treeIcon(x), 'large', 'medal-ico', x.title) : icon('sigil')}${/recommend/i.test(x.title) ? '<i class="medal-star" title="Recomendada pelo autor">★</i>' : ''}</span>
        <span>${esc(SHORT(x))}</span>
      </button>`).join('') : '';
    $('#spec-tabs').classList.toggle('is-many', vs.length > 3);
    const sw = $('#variant-switch');
    if (sw) sw.hidden = true;

    if (d.needsPick) {
      $('#spec-tabs').innerHTML = '';
      box.innerHTML = askGuideHtml(d, cls);
      return;
    }
    const pinned = !!(G.settings.guidePick || {})[cls.slug];
    const fav = gd && gd.favorites != null ? gd.favorites : d.pick && d.pick.favorites;
    const status = `
      <div class="gd-head">
        <div class="gd-src">
          <b>Guia de leveling · Mobalytics${fav != null ? ` <span class="gd-fav" title="Favoritos na Mobalytics">★ ${esc(fav)}</span>` : ''}</b>
          <span>${gd ? `por ${esc(gd.author)} · atualizado em ${esc(stamp(gd.updatedAt))}${gd.version ? ` · versão ${esc(gd.version)}` : ''}` : `O guia mais favoritado de ${esc(cls.name.toLowerCase())} na Mobalytics`}</span>
          <span class="gd-why">${pinned ? 'O guia que você escolheu' : 'O mais favoritado da classe'}</span>
        </div>
        <button class="btn btn-sm" data-gd="refresh" ${Guide.busy ? 'disabled' : ''}>${icon('i-refresh')}${Guide.busy ? 'Conferindo…' : 'Atualizar'}</button>
      </div>
      <div class="gd-status ${d.error ? 'bad' : ''}">${d.checkedAt ? `Conferido às ${esc(U.clock(d.checkedAt))}` : 'Ainda não conferido'}${d.error ? ` · ${esc(d.error)}` : ` · confere sozinho a cada ${esc(G.settings.guideMinutes || 60)} min e avisa quando mudar`}</div>`;

    if (!gd || !v) {
      box.innerHTML = `${status}<div class="list-empty">${Guide.busy ? `Procurando o guia mais favoritado de ${esc(cls.name.toLowerCase())} na Mobalytics e traduzindo (a primeira vez leva alguns segundos)…` : 'O app ainda não leu o guia desta classe. Clique em Atualizar.'}</div>${otherGuidesHtml({ ...d, pinned })}`;
      return;
    }

    const t = talentsOf(v);
    const rot = (v.parts || []).find((p) => p.kind === 'text');
    const history = d.history || [];
    const latest = history.find((h) => !h.seen);
    const code = t ? talentCode(finalRanks(t), t.trees) : null;
    const codeNow = t && lvl >= 10 && lvl < 9 + t.path.length ? talentCode(ranksAtLevel(t, lvl), t.trees) : null;
    box.dataset.code = code || '';
    box.dataset.codeNow = codeNow || '';
    const end = t ? 9 + t.path.length : 60;

    box.innerHTML = `
      ${status}
      ${latest ? changeCard(latest, true) : ''}
      ${levelCardHtml(lvl)}
      ${v.blocks && v.blocks.length ? `<div class="gd-dark gd-intro">${blocksHtml(v.blocks, 2)}</div>` : ''}
      ${t ? `
        <section>
          <h3 class="h-sec">Build no nível ${esc(end)} <span class="dim">${esc(v.title)}</span></h3>
          ${pointsHtml(t)}
        </section>
        ${miniTrees(t)}
        <section class="gd-card">
          <h4>${icon('sigil')}Talentos para o nível ${esc(lvl)}</h4>
          ${nextTalentsHtml(v, lvl, 6)}
          ${armoryTalentsHtml(lvl)}
        </section>` : ''}
      ${rot ? `
        <section class="gd-dark">
          <h3 class="h-sec">${esc(titleOf(rot) || 'Rotação')} <span class="dim">do guia de ${esc(gd.author)}</span></h3>
          ${blocksHtml(rot.blocks, 7)}
          ${rot.blocks.length > 7 ? `<button class="linkish" data-gd="open" data-sec="${esc(buildSection().id)}">${icon('i-out')}Ver tudo</button>` : ''}
        </section>` : ''}
      ${swSide(partOf(v, 'sw'))}
      <section>
        <h3 class="h-sec">Mais do guia</h3>
        <div class="gd-jump">
          ${walkVariants().length ? '<button class="chip" data-gd="open" data-sec="walk">Passo a passo por nível</button>' : ''}
          ${g().sections.filter((s) => s.kind === 'text').map((s) => `<button class="chip" data-gd="open" data-sec="${esc(s.id)}">${esc(titleOf(s))}</button>`).join('')}
        </div>
      </section>
      ${otherGuidesHtml({ ...d, pinned })}
      ${!latest && history[0] ? changeCard(history[0], true) : ''}
      <p class="gd-foot">Guia de ${esc(gd.author)} na Mobalytics, traduzido ${gd.engine === 'claude' ? 'pela IA (Claude)' : 'automaticamente'}. Nomes de feitiços e talentos ficam em inglês, como no jogo. <button class="linkish" data-url="${esc(gd.url)}">${icon('i-out')}Ver na Mobalytics</button></p>
      <div class="build-actions">
        <button class="btn" data-gd="open">${icon('i-spark')}Guia completo</button>
        ${code ? `<button class="btn btn-quiet" data-gd="copy" title="Código de talentos da build completa, no formato das calculadoras">${icon('i-copy')}Copiar código</button>` : ''}
        ${codeNow ? `<button class="linkish gd-copy-now" data-gd="copy-now" title="Só os pontos que o guia manda gastar até o seu nível">${icon('i-copy')}Código até o nível ${esc(lvl)}</button>` : ''}
      </div>`;
  };
  // The middle "Guia" tab moved to the side panel
  Guide.renderPane = Guide.renderSide;

  /* ---------- the card at the top of the power route ---------- */
  Guide.pathCardHtml = function (lvl) {
    if (!g()) return '';
    const band = bandFor(lvl);
    const v = chosenSpec();
    const t = talentsOf(v);
    const now = t && t.path.find((x) => x.level === lvl);
    const first = band && band.blocks.find((b) => b.t === 'p');
    const plan = levelPlan(lvl);
    if (!band && !now) return '';
    return `
      <div class="gd-path-card gd-dark">
        <div class="gd-path-head">${icon('i-spark')}<b>Guia de ${esc(g().author)} · ${band ? 'níveis ' + esc(band.title) : 'nível ' + esc(lvl)}</b><button class="linkish" data-gd="open" data-sec="${band ? 'walk' : ''}">Abrir o guia</button></div>
        ${first ? `<div class="gd-path-tip">${News.articleHtml({ blocks: [first], refs: g().refs, links: g().links }, false)}</div>` : ''}
        ${now ? `<div class="gd-path-talent">Talento do nível ${esc(lvl)}: ${talentIco(now)}<b>${esc(now.name)}</b> <span class="gd-rank">${esc(now.rank)}/${esc(now.max)}</span></div>` : ''}
        ${plan && plan.now ? `<div class="gd-path-train"><span>Instrutor (nível ${esc(plan.now.level)}):</span>${spellsHtml(plan.now.items, 'is-inline')}</div>` : ''}
      </div>`;
  };

  /* ---------- the full guide in the parchment ---------- */
  function talentsTable(v) {
    const t = talentsOf(v);
    if (!t) return '';
    const lvl = level();
    const pts = Object.entries(t.points || {}).map(([k, n]) => `<span class="gd-pts"><b>${esc(n)}</b> ${esc(k)}</span>`).join('');
    return `
      <div class="gd-pts-row">${pts}</div>
      <div class="gd-ttable" style="--rows:${Math.ceil(t.path.length / 2)}">${t.path.map((x) => `
        <div class="gd-trow ${x.level === lvl ? 'is-now' : ''}"><span class="gd-lv">${esc(x.level)}</span>${talentIco(x)}<span class="gd-tname">${esc(x.name)}</span><span class="gd-rank">${esc(x.rank)}/${esc(x.max)}</span><span class="gd-tree">${esc(x.tree || '')}</span></div>`).join('')}
      </div>`;
  }

  function swHtml(p) {
    if (!p) return '';
    return `
      <div class="gd-sw">
        <div class="gd-sw-col good"><h5>${en() ? 'Strengths' : 'Pontos fortes'}</h5>${blocksHtml(p.strengths || [])}</div>
        <div class="gd-sw-col bad"><h5>${en() ? 'Weaknesses' : 'Pontos fracos'}</h5>${blocksHtml(p.weaknesses || [])}</div>
      </div>`;
  }

  function sectionHtml(s) {
    const anchor = `gd-sec-${esc(s.id)}`;
    if (s.kind === 'variants' && buildSection() && s.id === buildSection().id) {
      const v = chosenSpec();
      const rot = (v && v.parts || []).filter((p) => p.kind === 'text');
      return `
        <section class="gd-sec" id="${anchor}">
          <h3 class="nm-ah l2">${esc(titleOf(s))}</h3>
          <div class="gd-chips">${s.variants.map((x) => `<button class="chip ${v && x.id === v.id ? 'is-on' : ''}" data-gd="spec" data-id="${esc(x.id)}">${esc(x.title)}</button>`).join('')}</div>
          ${v ? `${blocksHtml(v.blocks)}${swHtml(partOf(v, 'sw'))}
            ${talentsOf(v) ? `<h4 class="nm-ah l3" id="gd-sec-talents">${en() ? 'Talents · order by level' : 'Talentos · ordem por nível'}</h4>${talentsTable(v)}` : ''}
            ${rot.map((p) => `<h4 class="nm-ah l3">${esc(titleOf(p))}</h4>${blocksHtml(p.blocks)}`).join('')}` : ''}
        </section>`;
    }
    if (s.kind === 'variants') {
      const band = /walkthrough/i.test(s.title) ? bandFor(level()) : s.variants.find((x) => x.id === Guide.band) || s.variants[0];
      return `
        <section class="gd-sec" id="${anchor}">
          <h3 class="nm-ah l2" ${/walkthrough/i.test(s.title) ? 'id="gd-sec-walk"' : ''}>${esc(titleOf(s))}</h3>
          <div class="gd-chips">${s.variants.map((x) => `<button class="chip ${band && x.id === band.id ? 'is-on' : ''}" data-gd="band" data-id="${esc(x.id)}">${esc(/^\d/.test(x.title) ? 'Níveis ' + x.title : x.title)}</button>`).join('')}</div>
          ${band ? blocksHtml(band.blocks) : ''}
        </section>`;
    }
    if (s.kind === 'video') {
      const id = (String(s.url).match(/(?:youtu\.be\/|v=)([\w-]{6,20})/) || [])[1];
      return id ? `<section class="gd-sec" id="${anchor}"><h3 class="nm-ah l2">${en() ? 'Video' : 'Vídeo do autor'}</h3>${News.articleHtml({ blocks: [{ t: 'video', id, url: 'https://www.youtube.com/watch?v=' + id }], refs: [], links: [] }, en())}</section>` : '';
    }
    return `<section class="gd-sec" id="${anchor}"><h3 class="nm-ah l2">${esc(titleOf(s))}</h3>${blocksHtml(s.blocks || [])}</section>`;
  }

  function historyHtml() {
    const h = (Guide.data && Guide.data.history) || [];
    if (!h.length) return '';
    return `<section class="gd-sec" id="gd-sec-history"><h3 class="nm-ah l2">Mudanças que o Grimório detectou</h3>${h.slice(0, 8).map((e) => changeCard(e, false, true)).join('')}</section>`;
  }

  function githubHtml() {
    const list = (G.content.classes && G.content.classes.githubGuides) || [];
    if (!list.length) return '';
    return `<section class="gd-sec" id="gd-sec-github"><h3 class="nm-ah l2">Guias dentro do jogo (addons do GitHub)</h3>
      <p>Para quem quer o passo a passo com seta e missões dentro do jogo. São projetos novos da comunidade; confira a página de cada um antes de instalar.</p>
      ${list.map((x) => `<div class="gd-gh"><b>${esc(x.name)}</b> <span class="dim">· ${esc(x.status)} · licença ${esc(x.license)}</span><br>${esc(x.what)}<br><button class="nm-source" data-url="${esc(x.url)}">${icon('i-out')}github.com/${esc(x.repo)}</button></div>`).join('')}</section>`;
  }

  Guide.paintModal = function () {
    const gd = g();
    if (!gd) return;
    const cls = clsInfo();
    const toc = gd.sections.map((s) => `<button class="chip" data-gd="goto" data-sec="${esc(s.id)}">${esc(s.kind === 'video' ? (en() ? 'Video' : 'Vídeo') : titleOf(s))}</button>`).join('');
    $('#guide-modal-body').innerHTML = `
      <div class="nm-top">
        <span class="nm-cat">Guia de leveling · Mobalytics · por ${esc(gd.author)}</span>
        <button class="lang-toggle ${en() ? 'is-en' : ''}" id="gd-lang" aria-pressed="${en()}"><span class="${en() ? '' : 'on'}">PT</span><span class="${en() ? 'on' : ''}">EN</span></button>
      </div>
      <h2 class="nm-title" id="gd-title">${en() || !cls ? esc(gd.title) : `Guia de leveling de ${esc(cls.name.toLowerCase())} (1–60)`}</h2>
      <div class="nm-meta"><span>Atualizado em ${esc(stamp(gd.updatedAt))}${gd.version ? ` · versão ${esc(gd.version)}` : ''}</span><button class="nm-source" data-url="${esc(gd.url)}">${icon('i-out')}Ver na Mobalytics</button></div>
      <div class="gd-toc">${toc}${(Guide.data.history || []).length ? '<button class="chip" data-gd="goto" data-sec="history">O que mudou</button>' : ''}<button class="chip" data-gd="goto" data-sec="github">Addons de guia</button></div>
      <div class="nm-article gd-article">
        ${historyHtml()}
        ${gd.sections.map(sectionHtml).join('')}
        ${githubHtml()}
      </div>
      <div class="nm-foot">${icon('i-spark')}Guia de ${esc(gd.author)} na Mobalytics, traduzido ${gd.engine === 'claude' ? 'pela IA (Claude)' : 'automaticamente (Google Tradutor)'}. Nomes de feitiços, talentos e especializações ficam em inglês.</div>`;
    updateScroll();
  };

  Guide.open = function (sec) {
    if (!g()) { Guide.refresh(); return; }
    Guide.paintModal();
    $('#guide-modal').hidden = false;
    const box = $('#guide-parchment');
    box.scrollTop = 0;
    box.focus({ preventScroll: true });
    if (sec) goTo(sec);
    updateScroll();
  };

  function goTo(sec) {
    const box = $('#guide-parchment');
    if (!sec) return;
    const el = $(sec === 'talents' ? '#gd-sec-talents' : sec === 'walk' ? '#gd-sec-walk' : `#gd-sec-${CSS.escape(sec)}`);
    if (el && box) box.scrollTop = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 14;
  }

  function updateScroll() {
    const box = $('#guide-parchment');
    if (!box) return;
    const room = box.scrollHeight - box.clientHeight;
    box.classList.toggle('is-scrollable', room > 24);
    $('#gd-progress').style.width = room > 24 ? `${Math.min(100, (box.scrollTop / room) * 100).toFixed(1)}%` : '0%';
    $('#gd-top').hidden = box.scrollTop < 480;
  }

  /* ---------- updating ---------- */
  Guide.refresh = async function () {
    if (Guide.busy) return;
    Guide.busy = true;
    Guide.renderSide();
    U.say(g() ? 'Conferindo o guia da Mobalytics…' : 'Procurando os guias da classe na Mobalytics…');
    let r = null;
    try { r = await window.grimorio.refreshGuide(); } catch (e) { r = { result: { ok: false, error: String((e && e.message) || e) } }; }
    Guide.busy = false;
    if (r && r.guide !== undefined) Guide.data = r;
    await Guide.load();
    const res = (r && r.result) || {};
    U.say(!res.ok ? `A Mobalytics não respondeu: ${res.error || 'sem resposta'}`
      : res.needsPick ? 'Escolha o guia que você quer seguir, à direita'
      : res.first ? 'Guia de leveling carregado e traduzido'
        : res.changed ? 'O guia mudou: o resumo está no topo do guia, à direita'
          : 'O guia não mudou desde a última leitura', res.ok ? undefined : 'error');
    Guide.renderAll();
  };

  Guide.renderAll = function () {
    Guide.renderSide();
    if (window.Char) Char.renderPath();
    if (!$('#guide-modal').hidden) { const box = $('#guide-parchment'); const top = box.scrollTop; Guide.paintModal(); box.scrollTop = top; }
  };

  Guide.bind = function () {
    document.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-gd]');
      if (!b) return;
      const act = b.dataset.gd;
      if (act === 'refresh') Guide.refresh();
      else if (act === 'open') Guide.open(b.dataset.sec);
      else if (act === 'goto') goTo(b.dataset.sec);
      else if (act === 'tab') { const t = $('#tab-guide'); if (t) t.click(); }
      else if (act === 'spec') {
        LS.set('guide.spec.' + (clsSlug() || 'none'), b.dataset.id);
        Guide.renderAll();
        if (window.Char) Char.renderAll();
      }
      else if (act === 'class') {
        G.settings = await window.grimorio.saveSettings({ classSlug: b.dataset.id });
        Guide.data = null;
        Guide.busy = true;
        Guide.renderSide();
        if (window.Char) Char.renderAll();
      }
      else if (act === 'armory') Settings.open('armory');
      else if (act === 'pick') {
        Guide.busy = true;
        Guide.renderSide();
        U.say(b.dataset.id ? 'Carregando o guia escolhido…' : 'Listando os guias da classe…');
        const r = await window.grimorio.pickGuide(b.dataset.id || '');
        G.settings = await window.grimorio.getSettings();
        Guide.busy = false;
        if (r) Guide.data = r;
        await Guide.load();
        Guide.renderAll();
      }
      else if (act === 'copy') { const c = $('#build').dataset.code; if (c) U.copy(c, `Código da build do nível 60 copiado: ${c}`); }
      else if (act === 'copy-now') { const c = $('#build').dataset.codeNow; if (c) U.copy(c, `Código até o nível ${level()} copiado: ${c}`); }
      else if (act === 'band') { Guide.band = b.dataset.id; if (!$('#guide-modal').hidden) { const box = $('#guide-parchment'); const top = box.scrollTop; Guide.paintModal(); box.scrollTop = top; } }
      else if (act === 'seen') { Guide.data = await window.grimorio.guideSeen(b.dataset.id); await Guide.load(); Guide.renderAll(); }
    });
    $('#guide-modal').addEventListener('click', (e) => {
      if (e.target.closest('#gd-lang')) { Guide.lang = en() ? 'pt' : 'en'; const box = $('#guide-parchment'); const top = box.scrollTop; Guide.paintModal(); box.scrollTop = top; }
    });
    const box = $('#guide-parchment');
    box.addEventListener('scroll', updateScroll, { passive: true });
    box.addEventListener('load', updateScroll, true);
    $('#gd-top').addEventListener('click', () => { box.scrollTo({ top: 0, behavior: 'smooth' }); box.focus({ preventScroll: true }); });
    // Spell and talent names show their name on hover, like in the news
    box.addEventListener('mouseover', (e) => {
      const el = e.target.closest('.nm-ref');
      const r = el && g() && g().refs[Number(el.dataset.ref) - 1];
      if (r) U.tip.show(el, `<div class="tt-title">${esc(r.name)}</div>`);
    });
    box.addEventListener('mouseout', (e) => { if (e.target.closest('.nm-ref')) U.tip.hide(); });

    window.grimorio.onGuideUpdated(async (data) => {
      Guide.busy = false;
      await Guide.load();
      Guide.renderAll();
      if (window.Char) Char.renderAll();
      if (data && data.changed) U.say('O guia mudou: veja o resumo no topo do guia, à direita');
      if (data) Sound.forEvents(data.byCat);
    });
  };
})();

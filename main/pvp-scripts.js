// Funcoes que rodam DENTRO da pagina do check-pvp (janela invisivel) e devolvem os dados lidos.
// Sao escritas como funcoes normais para poderem ser testadas; viram texto no final do arquivo.

async function rankingScript() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const T = (el) => String((el && (el.innerText != null ? el.innerText : el.textContent)) || '').replace(/\s+/g, ' ').trim();
  const PLAYER = /^\/(us|eu|kr|tw|oc)\/[^/?#]+\/[^/?#]+\/?$/i;
  const pathOf = (a) => { try { return new URL(a.getAttribute('href'), location.href).pathname; } catch (e) { return ''; } };
  const isP = (a) => PLAYER.test(pathOf(a));
  const playerLinks = () => [...document.querySelectorAll('a[href]')].filter(isP);

  for (let i = 0; i < 60; i++) {
    if (playerLinks().length >= 3) { await wait(900); break; }
    await wait(400);
  }
  const links = playerLinks();
  if (!links.length) return { ok: false, rows: [], headers: [], note: 'sem-links', texto: T(document.body).slice(0, 500) };

  const hasP = (el) => (el.tagName === 'A' ? isP(el) : [...el.querySelectorAll('a[href]')].some(isP));
  const groups = new Map();
  for (const a of links) {
    let el = a;
    while (el.parentElement && el.parentElement !== document.body) {
      const p = el.parentElement;
      const kids = [...p.children];
      const n = kids.filter(hasP).length;
      if (n >= 5 && n >= kids.length * 0.5) { if (!groups.has(p)) groups.set(p, new Set()); groups.get(p).add(el); break; }
      el = p;
    }
  }
  let parent = null, rowEls = [];
  for (const [p, set] of groups) if (set.size > rowEls.length) { parent = p; rowEls = [...set]; }
  if (!rowEls.length) {
    const set = new Set(links.map((a) => a.closest('tr, li, [role="row"]') || a.parentElement));
    rowEls = [...set];
    parent = rowEls[0] && rowEls[0].parentElement;
  }

  const rows = rowEls.slice(0, 120).map((row) => {
    const kids = [...row.children];
    const cellEls = kids.length > 1 ? kids : [row];
    const link = (row.tagName === 'A' ? row : [...row.querySelectorAll('a[href]')].find(isP));
    const cells = cellEls.map((k) => T(k));
    const tags = [];
    row.querySelectorAll('img[alt], img[title], [title], [aria-label]').forEach((x) => {
      const v = (x.getAttribute('alt') || x.getAttribute('title') || x.getAttribute('aria-label') || '').trim();
      if (v && v.length <= 32 && !tags.includes(v)) tags.push(v);
    });
    const p = link ? pathOf(link).split('/').filter(Boolean).map((s) => decodeURIComponent(s)) : [];
    return { cells, tags, linkText: link ? T(link) : '', region: p[0] || '', nome: p[1] || '', sobrenome: p[2] || '' };
  });

  let headers = [];
  const table = rowEls[0] && rowEls[0].closest('table');
  if (table) headers = [...table.querySelectorAll('thead th, thead td')].map(T);
  if (!headers.length && parent) {
    const sib = [...parent.children].find((k) => !rowEls.includes(k) && k.children.length >= 3);
    if (sib) headers = [...sib.children].map(T);
  }
  if (!headers.length && parent) {
    const prev = parent.previousElementSibling;
    if (prev && prev.children.length >= 3) headers = [...prev.children].map(T);
  }

  let pages = null;
  for (const a of document.querySelectorAll('a[href*="page="]')) {
    const m = /[?&]page=(\d+)/.exec(a.getAttribute('href') || '');
    if (m) pages = Math.max(pages || 0, Number(m[1]));
  }
  const tm = /(?:page|pagina|página)\s+\d+\s*(?:\/|of|de)\s*(\d+)/i.exec(T(document.body));
  if (tm) pages = Math.max(pages || 0, Number(tm[1]));

  return { ok: true, rows, headers, pages, debugHtml: rowEls[0] ? rowEls[0].outerHTML.slice(0, 3000) : '' };
}

async function profileScript() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const T = (el) => String((el && (el.innerText != null ? el.innerText : el.textContent)) || '').replace(/\s+/g, ' ').trim();
  let last = -1;
  for (let i = 0; i < 40; i++) {
    const n = T(document.body).length;
    if (n > 80 && n === last) break;   // texto parou de mudar: a pagina terminou de montar
    last = n;
    await wait(500);
  }
  const root = document.querySelector('main') || document.querySelector('#root') || document.body;
  const heads = new Set([...root.querySelectorAll('h1, h2, h3, h4')].map(T).filter(Boolean));
  const raw = String(root.innerText != null ? root.innerText : root.textContent || '');
  const lines = raw.split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 500);
  const sections = [];
  let cur = { title: 'Resumo', lines: [] };
  for (const line of lines) {
    if (heads.has(line)) { if (cur.lines.length) sections.push(cur); cur = { title: line, lines: [] }; } else cur.lines.push(line);
  }
  if (cur.lines.length) sections.push(cur);
  const h1 = root.querySelector('h1');
  return { ok: sections.length > 0, titulo: T(h1) || document.title, sections: sections.slice(0, 14), url: location.href };
}

module.exports = {
  rankingScript: `(${rankingScript.toString()})()`,
  profileScript: `(${profileScript.toString()})()`
};

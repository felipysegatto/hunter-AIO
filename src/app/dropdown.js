/* Lista suspensa no estilo do app (no lugar do <select> branco do sistema) */
(function () {
  'use strict';
  const CHEV = '<svg class="dd-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function create(host, { options, value, label, onChange }) {
    host.classList.add('dd');
    host.innerHTML = `<button class="dd-btn" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(label || '')}"><span class="dd-val"></span>${CHEV}</button>
      <ul class="dd-list" role="listbox" tabindex="-1" hidden>${options.map(([v, l]) => `<li role="option" data-v="${esc(v)}">${esc(l)}</li>`).join('')}</ul>`;
    const btn = host.querySelector('.dd-btn'), list = host.querySelector('.dd-list'), val = host.querySelector('.dd-val');
    const items = [...list.children];
    let cur = String(value), hi = 0;
    const paint = () => {
      const it = items.find((li) => li.dataset.v === cur) || items[0];
      val.textContent = it ? it.textContent : '';
      items.forEach((li) => li.setAttribute('aria-selected', String(li === it)));
    };
    const light = (i) => { hi = Math.max(0, Math.min(items.length - 1, i)); items.forEach((li, k) => li.classList.toggle('is-hi', k === hi)); items[hi].scrollIntoView({ block: 'nearest' }); };
    const close = () => { list.hidden = true; host.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); };
    const open = () => {
      document.querySelectorAll('.dd.is-open').forEach((d) => { if (d !== host && d.__dd) d.__dd.close(); });
      list.hidden = false; host.classList.add('is-open'); btn.setAttribute('aria-expanded', 'true');
      light(Math.max(0, items.findIndex((li) => li.dataset.v === cur)));
    };
    const choose = (v) => { const changed = String(v) !== cur; cur = String(v); paint(); close(); btn.focus(); if (changed && onChange) onChange(cur); };
    btn.addEventListener('click', () => (list.hidden ? open() : close()));
    btn.addEventListener('keydown', (e) => {
      if (list.hidden) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); } return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); light(hi + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); light(hi - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(items[hi].dataset.v); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') close();
    });
    list.addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) choose(li.dataset.v); });
    list.addEventListener('mousemove', (e) => { const li = e.target.closest('li'); if (li) light(items.indexOf(li)); });
    host.__dd = { close, set: (v) => { cur = String(v); paint(); }, get value() { return cur; } };
    paint();
    return host.__dd;
  }

  document.addEventListener('click', (e) => { document.querySelectorAll('.dd.is-open').forEach((d) => { if (!d.contains(e.target) && d.__dd) d.__dd.close(); }); });
  window.UIDropdown = { create };
})();

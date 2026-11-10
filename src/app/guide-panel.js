/* Aba do guia: recolhe para a direita (como as noticias recolhem para a esquerda) */
(() => {
  const realm = document.querySelector('.realm');
  const rail = document.getElementById('guide-rail');
  if (!realm || !rail) return;
  const KEY = 'hunter.guideCollapsed';
  let collapsed = true; // padrao: recolhido, com o Armory centralizado
  try { const v = localStorage.getItem(KEY); if (v !== null) collapsed = v === '1'; } catch (e) { /* sem armazenamento */ }
  const apply = () => {
    realm.classList.toggle('guide-collapsed', collapsed);
    rail.setAttribute('aria-expanded', String(!collapsed));
    rail.title = collapsed ? 'Abrir o guia' : 'Recolher o guia';
  };
  rail.addEventListener('click', () => {
    collapsed = !collapsed;
    try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch (e) { /* sem armazenamento */ }
    apply();
  });
  // a bolinha de "guia atualizado" tambem aparece na aba lateral
  const dot = document.getElementById('guide-dot'), rdot = document.getElementById('guide-rail-dot');
  if (dot && rdot) {
    const sync = () => { rdot.hidden = dot.hidden; };
    new MutationObserver(sync).observe(dot, { attributes: true, attributeFilter: ['hidden'] });
    sync();
  }
  apply();
})();

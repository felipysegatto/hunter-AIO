/* Abas laterais da direita: Guia e PvP (uma aberta por vez; as duas recolhidas centralizam o Armory) */
(() => {
  const realm = document.querySelector('.realm');
  const gRail = document.getElementById('guide-rail');
  const pRail = document.getElementById('pvp-rail');
  if (!realm || !gRail || !pRail) return;
  const KEY = 'hunter.rightPanel';
  let state = 'none';
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'guide' || v === 'none') state = v;
    else if (v === null && localStorage.getItem('hunter.guideCollapsed') === '0') state = 'guide';
  } catch (e) { /* sem armazenamento */ }
  const apply = () => {
    realm.classList.toggle('guide-collapsed', state === 'none');
    realm.classList.toggle('pvp-open', state === 'pvp');
    gRail.setAttribute('aria-expanded', String(state === 'guide'));
    pRail.setAttribute('aria-expanded', String(state === 'pvp'));
    gRail.title = state === 'guide' ? 'Recolher o guia' : 'Abrir o guia';
    pRail.title = state === 'pvp' ? 'Recolher o PvP' : 'Abrir o ranking PvP';
    if (state === 'pvp' && window.PvP) window.PvP.activate();
  };
  const set = (s) => {
    state = s;
    try { localStorage.setItem(KEY, s === 'pvp' ? 'none' : s); } catch (e) { /* sem armazenamento */ }
    apply();
  };
  gRail.addEventListener('click', () => set(state === 'guide' ? 'none' : 'guide'));
  pRail.addEventListener('click', () => set(state === 'pvp' ? 'none' : 'pvp'));
  const dot = document.getElementById('guide-dot'), rdot = document.getElementById('guide-rail-dot');
  if (dot && rdot) {
    const sync = () => { rdot.hidden = dot.hidden; };
    new MutationObserver(sync).observe(dot, { attributes: true, attributeFilter: ['hidden'] });
    sync();
  }
  apply();
})();

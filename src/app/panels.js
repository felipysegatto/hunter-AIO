/* Abas laterais da direita: Guia, PvP e Jogador (uma aberta por vez; todas recolhidas centralizam o Armory) */
(() => {
  const realm = document.querySelector('.realm');
  const R = { guide: document.getElementById('guide-rail'), pvp: document.getElementById('pvp-rail'), player: document.getElementById('player-rail') };
  if (!realm || !R.guide || !R.pvp || !R.player) return;
  const TIP = { guide: ['Recolher o guia', 'Abrir o guia'], pvp: ['Recolher o PvP', 'Abrir o ranking PvP'], player: ['Recolher o Armory do jogador', 'Abrir o Armory de um jogador'] };
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
    realm.classList.toggle('player-open', state === 'player');
    for (const k of Object.keys(R)) {
      R[k].setAttribute('aria-expanded', String(state === k));
      R[k].title = TIP[k][state === k ? 0 : 1];
    }
    if (state === 'pvp' && window.PvP) window.PvP.activate();
    if (state === 'player' && window.Player) window.Player.ensure();
  };
  const set = (s) => {
    state = s;
    try { localStorage.setItem(KEY, s === 'guide' ? 'guide' : 'none'); } catch (e) { /* sem armazenamento */ }
    apply();
  };
  for (const k of Object.keys(R)) R[k].addEventListener('click', () => set(state === k ? 'none' : k));
  window.Panels = { open: (s) => set(s) };
  const dot = document.getElementById('guide-dot'), rdot = document.getElementById('guide-rail-dot');
  if (dot && rdot) {
    const sync = () => { rdot.hidden = dot.hidden; };
    new MutationObserver(sync).observe(dot, { attributes: true, attributeFilter: ['hidden'] });
    sync();
  }
  apply();
})();

/* Botoes de janela proprios (minimizar, maximizar/restaurar, fechar) */
(() => {
  const g = window.grimorio;
  const $ = id => document.getElementById(id);
  if (!g || !g.winMinimize) return;
  if (/Mac/i.test(navigator.platform)) { document.querySelectorAll('.win-btn, .win-sep').forEach(e => { e.hidden = true; }); return; }
  const MAX = '<rect x="3.5" y="3.5" width="9" height="9" rx="1.2"/>';
  const RESTORE = '<rect x="3" y="5.5" width="7.5" height="7.5" rx="1.2"/><path d="M5.5 5.5V4.2a1.2 1.2 0 0 1 1.2-1.2H12a1.2 1.2 0 0 1 1.2 1.2V9.5a1.2 1.2 0 0 1-1.2 1.2h-1.5"/>';
  $('win-min').addEventListener('click', () => g.winMinimize());
  $('win-max').addEventListener('click', () => g.winToggleMax());
  $('win-close').addEventListener('click', () => g.winClose());
  g.onWinState(max => {
    $('win-max').querySelector('svg').innerHTML = max ? RESTORE : MAX;
    $('win-max').title = max ? 'Restaurar' : 'Maximizar';
    $('win-max').setAttribute('aria-label', max ? 'Restaurar' : 'Maximizar');
  });
})();

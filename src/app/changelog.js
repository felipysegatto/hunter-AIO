/* Pergaminho com o historico completo de novidades (aberto em Ajustes) */
(function () {
  'use strict';
  const { $, esc, icon } = U;
  const Changelog = (window.Changelog = {});
  Changelog.open = function () {
    const list = (G.content && G.content.changelog) || [];
    const cur = (window.Welcome && Welcome.version) || (G.content.meta && G.content.meta.version) || '';
    $('#news-modal-body').innerHTML = `
      <div class="nm-top"><span class="nm-cat">Histórico</span></div>
      <h2 class="nm-title" id="nm-title">Novidades da Cabana do Caçador</h2>
      <div class="nm-meta"><span>Tudo o que mudou no app, da versão mais nova para a mais antiga</span></div>
      <div class="cl-list">${list.map((c) => `
        <section class="cl-ver">
          <h3>${esc(c.version)}${c.version === cur ? '<span class="cl-now">versão instalada</span>' : ''}<small>${esc(U.fullDate(c.date))}</small></h3>
          <ul>${(c.notes || []).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
        </section>`).join('')}</div>
      <div class="nm-foot">${icon('i-spark')}As versões 1.x e 2.x são do Grimório do Aventureiro, que deu origem a este app.</div>`;
    $('#news-modal').hidden = false;
    const box = $('#news-parchment');
    box.scrollTop = 0;
    box.focus({ preventScroll: true });
  };
})();

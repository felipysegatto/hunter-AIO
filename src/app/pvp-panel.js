/* Aba PvP (nativa): ranking, filtros e perfis do check-pvp.fr no estilo do app.
   Os dados entram assim que o formato do site for mapeado (botao abaixo). */
(function () {
  'use strict';
  const { $, esc, icon } = U;
  const PvP = (window.PvP = { mapped: false });

  PvP.sourceText = () => (PvP.mapped ? 'importado do check-pvp.fr' : 'aguardando o mapeamento do site');

  PvP.render = function () {
    const body = $('#pvp-body');
    if (!body) return;
    body.innerHTML = `
      <div class="pvp-head">
        <div class="pvp-title">Ranking PvP · WoW Forever</div>
        <div class="pvp-sub">Hunters · filtros, ranking e perfil de cada jogador, importados do check-pvp.fr</div>
      </div>
      <section class="pvp-card">
        <h3>Importação do ranking</h3>
        <p>Esta aba vai mostrar aqui, no visual do app, os filtros (com <b>Hunter</b> já marcado), a lista do ranking e o perfil de cada jogador, com pontos, vitórias e o botão do <b>Armory</b>.</p>
        <p>Para o app aprender o formato dos dados do site, faça o mapeamento uma vez: abre o site, você usa os filtros, muda de página e abre um jogador, e depois fecha a janela. O arquivo <b>pvp-gravacao.json</b> é salvo na Área de Trabalho. Envie esse arquivo ao Claude.</p>
        <div class="pvp-actions">
          <button class="btn btn-sm" id="pvp-map" type="button">${icon('i-refresh')}Mapear o site</button>
          <button class="btn btn-quiet btn-sm" id="pvp-to-player" type="button">Ver o Armory de um jogador</button>
        </div>
        <p class="pvp-status" id="pvp-map-status" role="status"></p>
      </section>
      <p class="pvp-sources">Fontes: <button class="linkish" data-url="https://forever.check-pvp.fr/ranking">forever.check-pvp.fr</button> (ranking e perfis) · <button class="linkish" data-url="https://worldofwarcraft.blizzard.com/pt-br/forever">Armory da Blizzard</button> (jogadores)</p>`;
  };
  PvP.activate = PvP.render;

  document.addEventListener('click', async (e) => {
    if (e.target.closest('#pvp-to-player')) { if (window.Panels) Panels.open('player'); return; }
    const b = e.target.closest('#pvp-map');
    if (!b) return;
    const st = $('#pvp-map-status');
    b.disabled = true;
    st.textContent = 'Abrindo o site para mapear…';
    try {
      const r = await window.grimorio.pvpMap();
      st.textContent = r && r.ok
        ? `Pronto: ${r.dados} chamadas de dados gravadas. O arquivo pvp-gravacao.json está na Área de Trabalho (a pasta foi aberta). Envie-o ao Claude.`
        : (r && r.message) || 'Não deu certo. Tente de novo.';
    } catch (err) {
      st.textContent = 'Não deu certo: ' + err.message;
    }
    b.disabled = false;
  });
})();

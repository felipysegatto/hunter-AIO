/* The launcher window: version, update check, what's new and the update progress */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mb = (n) => (n ? (n / 1048576).toFixed(n > 10485760 ? 0 : 1) + ' MB' : '');
  let latest = '';

  function status(text, kind, spinning) {
    $('#status-text').textContent = text;
    $('#status').className = 'status' + (kind ? ' ' + kind : '');
    $('#spin').hidden = !spinning;
  }

  window.launcher.onState((s) => {
    if (s.version) $('#ver').innerHTML = `versão <b>${esc(s.version)}</b>`;
    if (s.latest) latest = s.latest;
    $('#err').hidden = true;
    switch (s.state) {
      case 'checking':
        status('Procurando atualizações…', '', true);
        break;
      case 'ready':
        status(s.ok ? 'Você está na versão mais recente' : `Não deu para conferir agora (${s.error || 'sem conexão'}). Abrindo assim mesmo…`, s.ok ? 'ok' : 'warn', false);
        break;
      case 'handover':
        status(`Abrindo a versão ${s.latest}, que já foi baixada…`, 'ok', true);
        break;
      case 'update': {
        $('#news').hidden = false;
        $('#news-title').innerHTML = `Nova versão ${esc(s.latest)}${s.size ? `<small>${esc(mb(s.size))}</small>` : ''}`;
        const notes = (s.notes || []).length ? s.notes : ['Melhorias e correções.'];
        $('#news-list').innerHTML = notes.map((n) => `<li>${esc(n)}</li>`).join('');
        status(s.canInstall ? 'O app baixa a versão nova, confere o arquivo e abre sozinho.' : 'A versão nova abre no navegador para você baixar.', '', false);
        $('#btn-update').textContent = s.canInstall ? 'Atualizar agora' : 'Baixar a versão nova';
        $('#actions').hidden = false;
        $('#btn-update').disabled = false;
        $('#btn-browser').hidden = true;
        break;
      }
      case 'downloading': {
        $('#actions').hidden = true;
        $('#bar').hidden = false;
        const pct = s.total ? Math.min(100, (s.got / s.total) * 100) : 0;
        $('#bar-fill').style.width = pct.toFixed(1) + '%';
        status(`Baixando a versão ${latest}… ${s.total ? `${mb(s.got)} de ${mb(s.total)}` : mb(s.got)}`, '', true);
        break;
      }
      case 'restarting':
        $('#bar-fill').style.width = '100%';
        status(`Arquivo conferido. Instalando a versão ${latest}; o app reabre sozinho…`, 'ok', true);
        break;
      case 'failed':
        $('#bar').hidden = true;
        status('A atualização não deu certo.', 'warn', false);
        $('#err').hidden = false;
        $('#err').textContent = s.error || '';
        $('#btn-update').textContent = 'Tentar de novo';
        $('#btn-update').disabled = false;
        $('#btn-browser').hidden = false;
        $('#actions').hidden = false;
        break;
      default:
        break;
    }
  });

  $('#btn-update').addEventListener('click', () => { $('#btn-update').disabled = true; window.launcher.act('update'); });
  $('#btn-later').addEventListener('click', () => window.launcher.act('later'));
  $('#btn-browser').addEventListener('click', () => window.launcher.act('browser'));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#actions').hidden) window.launcher.act('later'); });
})();

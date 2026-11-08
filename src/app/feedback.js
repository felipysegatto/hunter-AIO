/* Tips, ideas and bug reports: a small form that posts to the author's Google Form (private sheet). */
(function () {
  'use strict';
  const { $, esc, icon } = U;
  const Feedback = (window.Feedback = { type: 'melhoria', sent: false, busy: false });
  const LS = { get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* optional */ } } };

  const TYPES = [
    ['melhoria', 'Ideia ou melhoria', 'O que você gostaria que o app fizesse, ou fizesse melhor?'],
    ['erro', 'Erro', 'O que aconteceu e o que você estava fazendo antes? Ex.: cliquei em Atualizar no guia e apareceu "sem conexão", mas a internet estava funcionando.'],
    ['dica', 'Dica', 'Uma dica de jogo ou de uso do app que vale passar adiante.']
  ];

  function charLine() {
    const d = G.character && G.character.armory && G.character.armory.data;
    const c = (d && d.character) || {};
    const parts = d ? [c.name, [c.cls, c.race].filter(Boolean).join(' '), d.level ? `nível ${d.level}` : ''] : [];
    return [...parts.filter(Boolean), `versão ${G.content && G.content.meta ? G.content.meta.version : ''}`].join(' · ');
  }

  function screenName() {
    const pane = window.Char && Char.pane;
    const parts = [];
    if (pane) parts.push({ stats: 'Atributos', gear: 'Equipamento', path: 'Rota' }[pane] || pane);
    if (window.News && News.drawer) parts.push('Notícias abertas');
    return parts.join(', ');
  }

  Feedback.render = function () {
    const box = $('#feedback-body');
    if (!box) return;
    if (Feedback.sent) {
      box.innerHTML = `
        <div class="fb-done">
          ${icon('i-check')}
          <h3>Recebido, obrigado!</h3>
          <p>A sua mensagem foi direto para a planilha do autor do Grimório. Se você deixou um contato, ele pode te chamar para entender melhor.</p>
          <div class="fb-actions"><button class="btn btn-sm" data-fb="again">Mandar outra</button><button class="btn btn-quiet btn-sm" data-close>Fechar</button></div>
        </div>`;
      return;
    }
    const t = TYPES.find((x) => x[0] === Feedback.type) || TYPES[0];
    const include = LS.get('fb.char') !== '0';
    box.innerHTML = `
      <p class="set-help">Achou um erro, teve uma ideia ou tem uma dica? Escreva aqui: vai direto para o autor do Grimório, sem precisar de conta nem de e-mail.</p>
      <div class="fb-types" role="radiogroup" aria-label="Tipo de mensagem">
        ${TYPES.map(([id, label]) => `<button class="chip ${id === t[0] ? 'is-on' : ''}" role="radio" aria-checked="${id === t[0]}" data-fb="type" data-id="${id}">${esc(label)}</button>`).join('')}
      </div>
      <div class="field">
        <label for="fb-msg">Mensagem</label>
        <textarea class="input fb-msg" id="fb-msg" rows="7" maxlength="4000" placeholder="${esc(t[2])}">${esc(LS.get('fb.draft') || '')}</textarea>
      </div>
      <div class="field">
        <label for="fb-contact">Como te chamar <span class="dim">(opcional: nick no jogo, Discord…)</span></label>
        <input class="input" id="fb-contact" maxlength="200" value="${esc(LS.get('fb.contact') || '')}" spellcheck="false">
      </div>
      <label class="toggle"><input type="checkbox" id="fb-char" ${include ? 'checked' : ''}> Incluir o personagem e a versão do app (ajuda a achar erros)</label>
      <p class="fb-preview" id="fb-preview" ${include ? '' : 'hidden'}>Vai junto: ${esc(charLine())}</p>
      <div class="fb-actions">
        <button class="btn" data-fb="send" ${Feedback.busy ? 'disabled' : ''}>${icon('i-chat')}${Feedback.busy ? 'Enviando…' : 'Enviar'}</button>
        <span class="set-status" id="fb-status"></span>
      </div>`;
  };

  Feedback.open = function (type) {
    if (type) Feedback.type = type;
    Feedback.sent = false;
    Feedback.render();
    $('#feedback-modal').hidden = false;
    setTimeout(() => { const m = $('#fb-msg'); if (m) m.focus(); }, 60);
  };

  async function send() {
    const msg = ($('#fb-msg').value || '').trim();
    const status = $('#fb-status');
    if (msg.length < 3) { status.className = 'set-status bad'; status.textContent = 'Escreva a sua mensagem primeiro.'; $('#fb-msg').focus(); return; }
    Feedback.busy = true;
    const btn = $('[data-fb="send"]');
    if (btn) { btn.disabled = true; btn.lastChild.textContent = 'Enviando…'; }
    let r;
    try {
      r = await window.grimorio.sendFeedback({ type: Feedback.type, message: msg, contact: $('#fb-contact').value, includeChar: $('#fb-char').checked, screen: screenName() });
    } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    Feedback.busy = false;
    if (r && r.ok) {
      LS.set('fb.draft', '');
      Feedback.sent = true;
      Feedback.render();
      U.say('Mensagem enviada. Obrigado!');
      return;
    }
    if (btn) { btn.disabled = false; btn.lastChild.textContent = 'Enviar'; }
    status.className = 'set-status bad';
    status.textContent = `Não deu para enviar: ${(r && r.error) || 'sem resposta'}. O texto ficou salvo; tente de novo daqui a pouco.`;
  }

  Feedback.bind = function () {
    const btn = $('#btn-feedback');
    if (btn) btn.addEventListener('click', () => Feedback.open());
    const modal = $('#feedback-modal');
    modal.addEventListener('click', (e) => {
      const b = e.target.closest('[data-fb]');
      if (!b) return;
      const act = b.dataset.fb;
      if (act === 'type') {
        const m = $('#fb-msg');
        if (m) LS.set('fb.draft', m.value);
        Feedback.type = b.dataset.id;
        Feedback.render();
        const m2 = $('#fb-msg');
        if (m2) { m2.focus(); m2.setSelectionRange(m2.value.length, m2.value.length); }
      } else if (act === 'send') send();
      else if (act === 'again') { Feedback.sent = false; Feedback.render(); }
    });
    modal.addEventListener('input', (e) => {
      if (e.target.id === 'fb-msg') LS.set('fb.draft', e.target.value);
      if (e.target.id === 'fb-contact') LS.set('fb.contact', e.target.value);
    });
    modal.addEventListener('change', (e) => {
      if (e.target.id === 'fb-char') {
        LS.set('fb.char', e.target.checked ? '1' : '0');
        const p = $('#fb-preview');
        if (p) p.hidden = !e.target.checked;
      }
    });
    modal.addEventListener('keydown', (e) => {
      if (e.target.id === 'fb-msg' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
    });
  };
})();

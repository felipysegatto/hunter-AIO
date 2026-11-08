'use strict';

// Tips, ideas and bug reports from the players. They go to a Google Form owned by the app's author;
// the form's answers land in a private Google Sheet. Posting to a public form needs no key or login,
// so nothing secret ships inside the app.
//   content.json → meta.feedback = { form: "https://docs.google.com/forms/d/e/<id>/formResponse",
//                                    fields: { type: "entry.1", message: "entry.2", … } }
const os = require('os');
const { net, app } = require('electron');

const TYPES = { dica: 'Dica', melhoria: 'Sugestão de melhoria', erro: 'Erro' };
let lastSent = 0;

const configured = (cfg) => !!(cfg && /^https:\/\/docs\.google\.com\/forms\/d\/e\/[\w-]+\/formResponse$/.test(cfg.form || '') && cfg.fields && cfg.fields.message);

function friendly(e) {
  const m = String((e && e.message) || e || '');
  if (/abort/i.test(m)) return 'o Google demorou demais para responder';
  if (/ERR_INTERNET|ENOTFOUND|fetch failed|ERR_NAME|ERR_TUNNEL|ERR_PROXY|ERR_CONNECTION|ERR_NETWORK/i.test(m)) return 'sem conexão';
  return m.slice(0, 80);
}

/**
 * payload: { type: 'dica'|'melhoria'|'erro', message, contact, character, details }
 * Returns { ok } or { ok: false, error }.
 */
async function send(cfg, payload) {
  if (!configured(cfg)) return { ok: false, error: 'o canal de sugestões ainda não foi ligado nesta versão' };
  const message = String((payload && payload.message) || '').trim();
  if (message.length < 3) return { ok: false, error: 'escreva a sua mensagem primeiro' };
  if (Date.now() - lastSent < 15000) return { ok: false, error: 'espere uns segundos antes de mandar outra' };
  const values = {
    type: TYPES[payload.type] || TYPES.melhoria,
    message: message.slice(0, 4000),
    contact: String(payload.contact || '').trim().slice(0, 200),
    character: String(payload.character || '').trim().slice(0, 300),
    version: app.getVersion(),
    details: [`Windows ${os.release()}`, String(payload.details || '').trim()].filter(Boolean).join(' · ').slice(0, 1500)
  };
  const body = new URLSearchParams();
  for (const [k, entry] of Object.entries(cfg.fields)) {
    if (entry && values[k]) body.append(entry, values[k]);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await net.fetch(cfg.form, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: ctrl.signal
    });
    if (!res.ok) return { ok: false, error: `o Google recusou o envio (HTTP ${res.status})` };
    lastSent = Date.now();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { send, configured, TYPES };

'use strict';

// Summaries in Brazilian Portuguese through the Claude API (Messages API).
// Only runs when the user saves their own API key in Ajustes.
const { net } = require('electron');
const API = 'https://api.anthropic.com/v1/messages';

const SYSTEM = `Você é o cronista do "Grimório do Aventureiro", um app para jogadores brasileiros de World of Warcraft: Forever (o "Classic+" da Blizzard, lançado em 4/11/2026), de qualquer classe e raça.
Regras:
- Considere apenas o WoW Forever. Se a notícia for sobre o WoW moderno (Midnight), Classic Era, Hardcore antigo ou outro jogo, marque "relevante": false.
- Escreva em português do Brasil, direto, sem floreio. Nomes de feitiços, talentos, masmorras e itens ficam em inglês, como aparecem no jogo.
- "categoria": "atencao" (mudança polêmica, nerf, bug, banimento, fila, problema, repercussão negativa da comunidade) ou "geral".
- "impacto": "alto", "medio" ou "baixo" para quem está upando ou jogando no 60.
- "titulo": até 90 caracteres. "resumo": 1 ou 2 frases. "pontos": até 3 tópicos curtos. "porque": 1 frase dizendo o que muda para o jogador.
- "build": true se a notícia trouxer mudança de talentos ou de classe.
- Nunca invente números ou fatos que não estejam no texto recebido.
Responda SOMENTE com um array JSON válido, sem comentários.`;

function buildPrompt(items) {
  const lines = items.map((it) => ({ id: it.id, fonte: it.source, data: it.date, titulo: it.title, texto: (it.snippet || '').slice(0, 700), link: it.link }));
  return `Resuma estas notícias. Formato de cada objeto: {"id","relevante","categoria","impacto","titulo","resumo","pontos","porque","build"}.\n\n${JSON.stringify(lines, null, 1)}`;
}

async function call({ apiKey, model, system, user, maxTokens }) {
  const res = await net.fetch(API, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: model || 'claude-haiku-5-5', max_tokens: maxTokens || 4000, system, messages: [{ role: 'user', content: user }] })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
    if (res.status === 401) throw new Error('Chave da API recusada. Confira a chave em Ajustes.');
    throw new Error(msg);
  }
  return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
}

function parseArray(textOut) {
  const start = textOut.indexOf('[');
  const end = textOut.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('Resposta da IA sem JSON.');
  return JSON.parse(textOut.slice(start, end + 1));
}

async function summarize(items, opts) {
  const out = {};
  for (let i = 0; i < items.length; i += 8) {
    const chunk = items.slice(i, i + 8);
    const raw = await call({ ...opts, system: SYSTEM, user: buildPrompt(chunk) });
    for (const r of parseArray(raw)) {
      if (!r || !r.id) continue;
      out[r.id] = {
        relevante: r.relevante !== false,
        categoria: ['atencao', 'geral'].includes(r.categoria) ? r.categoria : 'geral',
        impacto: ['alto', 'medio', 'baixo'].includes(r.impacto) ? r.impacto : 'medio',
        titulo: String(r.titulo || '').slice(0, 120),
        resumo: String(r.resumo || ''),
        pontos: Array.isArray(r.pontos) ? r.pontos.slice(0, 3).map(String) : [],
        porque: String(r.porque || ''),
        build: !!r.build,
        rota: r.rota && typeof r.rota === 'object' && r.rota.titulo ? {
          min: Math.max(1, Math.min(60, Number(r.rota.min) || 1)),
          max: Math.max(1, Math.min(60, Number(r.rota.max) || Number(r.rota.min) || 60)),
          titulo: String(r.rota.titulo).slice(0, 90),
          onde: String(r.rota.onde || '').slice(0, 120),
          porque: String(r.rota.porque || '').slice(0, 220)
        } : null,
        geradoEm: new Date().toISOString()
      };
    }
  }
  return out;
}

async function ping(opts) {
  await call({ ...opts, system: 'Responda apenas OK.', user: 'ping', maxTokens: 5 });
  return true;
}

module.exports = { summarize, ping };

/* Le o texto da pagina de um jogador do check-pvp e separa o que importa (sem menu, anuncios e "Checks Recentes") */
(function (root) {
  'use strict';
  // O site escreve icones como texto (as vezes colados na palavra do lado)
  const ICONS = ['arrow_drop_down', 'expand_more', 'expand_less', 'unfold_more', 'keyboard_arrow_down', 'keyboard_arrow_up', 'visibility', 'favorite_outline', 'favorite_border', 'star_outline', 'photo_camera', 'account_tree', 'policy', 'settings', 'pause', 'search'];
  const ALT = ICONS.join('|');
  const START = new RegExp('^(?:' + ALT + ')(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ\\s]|$)');
  const END = new RegExp('(?:' + ALT + ')$');
  const strip = (s) => {
    let t = String(s || '');
    for (let i = 0; i < 3; i++) t = t.replace(START, '').replace(END, '');
    return t.replace(/\s+/g, ' ').trim();
  };
  const num = (s) => { const m = /(\d[\d.]*)/.exec(s || ''); return m ? m[1] : ''; };

  function parseProfile(rawLines) {
    let L = (rawLines || []).map(strip).filter(Boolean);
    const cut = L.findIndex((x) => /^checks? recentes?$/i.test(x) || /^elite checker/i.test(x));
    if (cut >= 0) L = L.slice(0, cut);
    const find = (rx, from = 0) => { for (let i = from; i < L.length; i++) if (rx.test(L[i])) return i; return -1; };
    const after = (rx) => { const k = find(rx); return k >= 0 ? L[k + 1] || '' : ''; };

    const gi = find(/^<.+>$/);
    const levelLine = L[find(/^N[ií]vel\s+\d+/i)] || '';
    const out = {
      nome: gi > 0 ? L[gi - 1] : '',
      guilda: gi >= 0 ? L[gi] : '',
      nivel: num(levelLine),
      atualizado: after(/^[ÚU]ltima atualiza[cç][aã]o$/i),
      patente: after(/^Patente PvP$/i),
      honrosas: after(/^Vit[oó]rias honrosas$/i),
      visualizacoes: num(L[find(/^\d[\d.]*\s+visualiza/i)]),
      curtidas: num(L[find(/^\d[\d.]*\s+curtida/i)]),
      campos: [],
      profissoes: []
    };
    const bs = find(/^Campos de Batalha$/i);
    const ps = find(/^Profiss[oõ]es$/i, bs >= 0 ? bs : 0);
    if (bs >= 0) {
      const end = ps > bs ? ps : L.length;
      for (let i = bs + 1; i < end - 1; i++) {
        if (/^\d[\d.]*\s*vit[oó]ria/i.test(L[i + 1])) { out.campos.push({ nome: L[i], vitorias: num(L[i + 1]) }); i++; }
      }
    }
    if (ps >= 0) {
      for (let i = ps + 1; i < L.length - 1; i++) {
        if (/^\d+\s*\/\s*\d+$/.test(L[i + 1])) { out.profissoes.push({ nome: L[i], valor: L[i + 1].replace(/\s+/g, '') }); i++; }
      }
    }
    out.ok = !!(out.patente || out.honrosas || out.campos.length || out.profissoes.length);
    out.linhas = L;
    return out;
  }

  root.PvPParse = { parseProfile, strip };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PvPParse;
})(typeof window !== 'undefined' ? window : globalThis);

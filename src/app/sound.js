/* Sounds: original tones synthesized with WebAudio (no audio files, no game assets) */
(function () {
  'use strict';

  const Sound = (window.Sound = {});
  let ctx = null;

  Sound.TONES = [
    { id: 'sino', label: 'Sino do templo' },
    { id: 'runa', label: 'Runa arcana' },
    { id: 'vil', label: 'Chama vil' },
    { id: 'alerta', label: 'Trompa de alerta' },
    { id: 'tambor', label: 'Tambor de guerra' },
    { id: 'pergaminho', label: 'Pergaminho' }
  ];

  Sound.CATS = [
    { id: 'geral', label: 'Wowhead', hint: 'Matérias novas do Forever no Wowhead' },
    { id: 'guia', label: 'Guia de leveling', hint: 'O guia da sua classe na Mobalytics foi atualizado' },
    { id: 'comunidade', label: 'Reddit', hint: 'Conversas novas sobre o Forever no Reddit' },
    { id: 'armory', label: 'Armory', hint: 'Nível novo ou item trocado' },
    { id: 'marcos', label: 'Marcos', hint: 'Abertura do servidor e das raids' }
  ];

  const PRIORITY = ['atencao', 'build', 'guia', 'armory', 'marcos', 'comunidade', 'geral'];

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Shared output: gain → soft room (feedback delay) → destination
  function chain(volume) {
    const a = ac();
    const out = a.createGain();
    out.gain.value = volume;
    const dry = a.createGain(); dry.gain.value = 1;
    const delay = a.createDelay(); delay.delayTime.value = 0.13;
    const fb = a.createGain(); fb.gain.value = 0.28;
    const wet = a.createGain(); wet.gain.value = 0.22;
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    out.connect(dry).connect(a.destination);
    out.connect(delay); delay.connect(lp).connect(fb).connect(delay); lp.connect(wet).connect(a.destination);
    return out;
  }

  function osc(type, freq, start, dur, peak, dest, opts) {
    const a = ac();
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (opts && opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, start + (opts.glide || dur));
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + (opts && opts.attack ? opts.attack : 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g);
    if (opts && opts.filter) { const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opts.filter; f.Q.value = opts.q || 1; g.connect(f).connect(dest); }
    else g.connect(dest);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  function noise(start, dur, peak, dest, freq) {
    const a = ac();
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource(); src.buffer = buf;
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 1200; f.Q.value = 0.8;
    const g = a.createGain(); g.gain.value = peak;
    src.connect(f).connect(g).connect(dest);
    src.start(start);
  }

  const DESIGNS = {
    sino(t, d) {
      [[880, 0.32, 1.8], [880 * 2.76, 0.12, 1.1], [880 * 5.4, 0.05, 0.6], [440, 0.1, 2]].forEach(([f, p, l]) => osc('sine', f, t, l, p, d));
    },
    runa(t, d) {
      osc('triangle', 1318.5, t, 0.5, 0.22, d);
      osc('triangle', 1975.5, t + 0.11, 0.7, 0.2, d);
      osc('sine', 2637, t + 0.22, 0.9, 0.08, d);
    },
    vil(t, d) {
      osc('sawtooth', 110, t, 0.75, 0.16, d, { to: 330, glide: 0.5, attack: 0.06, filter: 900, q: 6 });
      osc('sine', 220, t + 0.05, 0.6, 0.12, d, { to: 440, glide: 0.45 });
      noise(t, 0.6, 0.18, d, 700);
    },
    alerta(t, d) {
      osc('square', 440, t, 0.24, 0.09, d, { filter: 1600 });
      osc('square', 659.3, t + 0.26, 0.34, 0.09, d, { filter: 1600 });
      osc('sine', 220, t, 0.6, 0.12, d);
    },
    tambor(t, d) {
      [0, 0.22, 0.44].forEach((o, i) => { osc('sine', i === 2 ? 70 : 95, t + o, 0.45, i === 2 ? 0.5 : 0.35, d, { to: 45, glide: 0.3, attack: 0.004 }); noise(t + o, 0.08, 0.15, d, 300); });
    },
    pergaminho(t, d) {
      noise(t, 0.12, 0.12, d, 3000);
      osc('triangle', 660, t + 0.02, 0.35, 0.16, d);
      osc('triangle', 990, t + 0.09, 0.3, 0.08, d);
    }
  };

  Sound.play = function (tone, volume) {
    try {
      const a = ac();
      const dest = chain(volume == null ? 0.7 : volume);
      (DESIGNS[tone] || DESIGNS.sino)(a.currentTime + 0.03, dest);
    } catch (_) { /* audio unavailable */ }
  };

  /** Plays the sound of the most important category in byCat that has sound on. */
  Sound.forEvents = function (byCat) {
    const s = G.settings || {};
    if (!byCat || !s.sound || !s.sound.enabled) return;
    const cat = PRIORITY.find((c) => byCat[c] && s.alerts && s.alerts[c] && s.alerts[c].sound);
    if (cat) Sound.play(s.alerts[cat].tone, s.sound.volume);
  };
})();

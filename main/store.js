'use strict';

// Small JSON store in the OS user-data folder. Secrets (Claude key, Battle.net secret) are encrypted with the operating system keychain (safeStorage).
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const ALERT_CATS = ['geral', 'atencao', 'comunidade', 'build', 'guia', 'armory', 'marcos'];
const DEFAULT_ALERTS = {
  geral: { notify: true, sound: true, tone: 'pergaminho' },
  atencao: { notify: true, sound: true, tone: 'alerta' },
  comunidade: { notify: false, sound: false, tone: 'runa' },
  build: { notify: true, sound: true, tone: 'sino' },
  guia: { notify: true, sound: true, tone: 'runa' },
  armory: { notify: true, sound: true, tone: 'runa' },
  marcos: { notify: true, sound: true, tone: 'tambor' }
};

const DEFAULT_SETTINGS = {
  aiModel: 'claude-haiku-5-5',
  refreshMinutes: 30,
  notifications: true,
  armoryUrl: '',
  armoryMinutes: 60,
  guideMinutes: 60,
  bnetClientId: '',
  region: 'us',
  sound: { enabled: true, volume: 0.7 },
  alerts: DEFAULT_ALERTS,
  classSlug: '',
  guidePick: {},
  dataFolder: '',
  openAtLogin: true,
  onboarded: false,
  lastRunVersion: ''
};

const DEFAULT_CHARACTER = {
  level: 1,
  done: [],
  armory: null
};

function file(name) { return path.join(app.getPath('userData'), name); }

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch (_) { return fallback; }
}

function writeJson(name, data) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const tmp = file(name + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file(name));
}

function readSecrets() {
  const raw = readJson('secret.json', {});
  // v1.0 kept only the Claude key as { enc, value }
  if (raw && raw.value && !raw.apiKey) return { apiKey: { enc: raw.enc, value: raw.value } };
  return raw || {};
}
function decode(entry) {
  if (!entry || !entry.value) return '';
  try {
    if (entry.enc && safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(entry.value, 'base64'));
    return entry.enc ? '' : Buffer.from(entry.value, 'base64').toString('utf8');
  } catch (_) { return ''; }
}
function encode(value) {
  if (!value) return null;
  if (safeStorage.isEncryptionAvailable()) return { enc: true, value: safeStorage.encryptString(value).toString('base64') };
  return { enc: false, value: Buffer.from(value, 'utf8').toString('base64') };
}

module.exports = {
  ALERT_CATS,
  getSettings() {
    const s = readJson('settings.json', {});
    const alerts = {};
    for (const k of ALERT_CATS) alerts[k] = { ...DEFAULT_ALERTS[k], ...((s.alerts || {})[k] || {}) };
    // v1.0's single "notifications" switch becomes the default for every category
    if (s.notifications === false && !s.alerts) for (const k of ALERT_CATS) alerts[k].notify = false;
    return {
      ...DEFAULT_SETTINGS, ...s,
      sound: { ...DEFAULT_SETTINGS.sound, ...(s.sound || {}) },
      alerts
    };
  },
  saveSettings(patch) {
    const cur = this.getSettings();
    const next = { ...cur, ...patch };
    if (patch.alerts) {
      next.alerts = { ...cur.alerts };
      for (const k of Object.keys(patch.alerts)) next.alerts[k] = { ...cur.alerts[k], ...patch.alerts[k] };
    }
    if (patch.sound) next.sound = { ...cur.sound, ...patch.sound };
    writeJson('settings.json', next);
    return next;
  },

  getSecret(name) { return decode(readSecrets()[name]); },
  setSecret(name, value) {
    const all = readSecrets();
    const enc = encode(value);
    if (enc) all[name] = enc; else delete all[name];
    writeJson('secret.json', all);
  },
  getApiKey() { return this.getSecret('apiKey'); },
  setApiKey(key) { this.setSecret('apiKey', key); },

  getCharacter() {
    const c = readJson('character.json', {});
    return { ...DEFAULT_CHARACTER, level: c.level || 1, done: Array.isArray(c.done) ? c.done : [], armory: c.armory || null };
  },
  saveCharacter(patch) {
    const next = { ...this.getCharacter(), ...patch };
    writeJson('character.json', next);
    return next;
  },

  getFeedCache() { return readJson('feed-cache.json', { items: [], lastRefresh: null, errors: [] }); },
  saveFeedCache(data) { writeJson('feed-cache.json', data); },
  getCommunityCache() { return readJson('community-cache.json', { items: [], lastRefresh: null, errors: [], status: {} }); },
  saveCommunityCache(data) { writeJson('community-cache.json', data); }
};

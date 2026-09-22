// /js/storage.js
// localStorage: packs, code drafts, solved flags, last opened exercise + backup/restore.
const KEY  = 'r5900-trainer';
const MARK = 'r5900Backup';
const blank = () => ({ packs: {}, code: {}, solved: {}, last: null });

function load() {
  try { return { ...blank(), ...JSON.parse(localStorage.getItem(KEY)) }; }
  catch { return blank(); }
}
let state = load();
const save = () => localStorage.setItem(KEY, JSON.stringify(state));

export const store = {
  get packs()          { return state.packs; },
  addPack(pack)        { state.packs[pack.name] = pack; save(); },
  removePack(name)     { delete state.packs[name]; save(); },
  getCode(key)         { return state.code[key]; },
  setCode(key, src)    { state.code[key] = src; save(); },
  isSolved(key)        { return !!state.solved[key]; },
  setSolved(key)       { state.solved[key] = Date.now(); save(); },
  get last()           { return state.last; },
  set last(key)        { state.last = key; save(); },

  // backup = everything: packs + code drafts + solved
  exportBackup() {
    return JSON.stringify({ [MARK]: 1, date: new Date().toISOString(), ...state }, null, 1);
  },
  isBackup(obj) { return !!obj?.[MARK]; },
  restoreBackup(obj) {
    state = { ...blank(), packs: obj.packs ?? {}, code: obj.code ?? {},
              solved: obj.solved ?? {}, last: obj.last ?? null };
    save();
  },
  resetProgress() { state.code = {}; state.solved = {}; save(); },
};

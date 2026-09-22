// /js/app.js
// UI: exercise view, editor, run/check, pack import, backup/reset.
import { runExercise } from './cpu.js';
import { store } from './storage.js';
import { initToolbar } from './toolbar.js';

const $ = id => document.getElementById(id);
const ui = {
  pick: $('pick'), prev: $('prev'), next: $('next'), menuBtn: $('menuBtn'),
  title: $('title'), text: $('text'),
  hintBox: $('hintBox'), hint: $('hint'), solBox: $('solBox'), solution: $('solution'),
  run: $('run'), result: $('result'), code: $('code'), gutter: $('gutter'),
  menu: $('menu'), packList: $('packList'), stats: $('stats'),
  importBtn: $('importBtn'), file: $('file'),
  paste: $('paste'), addPaste: $('addPaste'), closeMenu: $('closeMenu'),
  exportBtn: $('exportBtn'), resetBtn: $('resetBtn'),
};

let list = [];      // flat: [{ key, pack, ex }]
let cur = -1;
let errLine = 0;

/* ---------- pack parsing ---------- */

const lower = o => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k.toLowerCase(), v]));

// setup/expect: { regs, mem } or flat { "v0": 5, "0x003E8888": 100 }
function normState(o) {
  o = lower(o);
  if (o.regs || o.mem) return { regs: o.regs ?? {}, mem: o.mem ?? {} };
  const regs = {}, mem = {};
  for (const [k, v] of Object.entries(o)) (/^(0x|\d)/i.test(k) ? mem : regs)[k] = v;
  return { regs, mem };
}

function normalizePack(data, fallbackName) {
  const top = Array.isArray(data) ? { exercises: data } : lower(data);
  if (!Array.isArray(top.exercises) || !top.exercises.length) throw new Error('no "exercises" array found');
  const exercises = top.exercises.map((raw, i) => {
    const ex = lower(raw);
    if (!ex.exercise) throw new Error(`exercise #${i + 1}: missing "exercise"`);
    // "cases": [{ setup, expect }, ...]  or a single setup/expect
    const cases = (ex.cases ?? [{ setup: ex.setup, expect: ex.expect }]).map(c => {
      c = lower(c);
      if (!c.expect) throw new Error(`exercise #${i + 1}: missing "expect"`);
      return { setup: normState(c.setup), expect: normState(c.expect) };
    });
    return { ...ex, id: String(ex.id ?? i + 1), title: ex.title ?? `#${i + 1}`, cases };
  });
  return { name: top.pack ?? top.name ?? fallbackName, exercises };
}

// handles both packs and backups
function importText(text, fallbackName) {
  flushSave();
  let data;
  try { data = JSON.parse(text); }
  catch (e) { alert(`Not valid JSON: ${e.message}`); return false; }

  if (store.isBackup(data)) {
    if (!confirm('Restore this backup? It replaces all packs and progress.')) return false;
    store.restoreBackup(data);
    rebuild();
    const i = list.findIndex(it => it.key === store.last);
    show(i >= 0 ? i : 0);
    ui.menu.close();
    return true;
  }

  try {
    const pack = normalizePack(data, fallbackName);
    store.addPack(pack);
    rebuild();
    show(list.findIndex(it => it.pack === pack.name));
    ui.menu.close();
    return true;
  } catch (e) {
    alert(`Import failed: ${e.message}`);
    return false;
  }
}

/* ---------- list + view ---------- */

const label = it => (store.isSolved(it.key) ? '✓ ' : '') + it.ex.title;

function rebuild() {
  list = [];
  for (const [name, pack] of Object.entries(store.packs))
    for (const ex of pack.exercises) list.push({ key: `${name}/${ex.id}`, pack: name, ex });

  ui.pick.innerHTML = '';
  let group = null;
  list.forEach((it, i) => {
    if (group?.label !== it.pack) {
      group = document.createElement('optgroup');
      group.label = it.pack;
      ui.pick.append(group);
    }
    group.append(new Option(label(it), i));
  });
  renderPacks();
}

function show(i) {
  flushSave();
  const empty = !list.length;
  ui.run.disabled = ui.code.disabled = empty;
  if (empty) {
    cur = -1;
    ui.title.textContent = 'No exercises';
    ui.text.textContent = 'Tap ☰ to import a .json pack.';
    ui.hintBox.hidden = ui.solBox.hidden = true;
    ui.code.value = '';
    errLine = 0; updateGutter(); setResult('', '');
    return;
  }
  cur = (i + list.length) % list.length;       // wraps for prev/next
  const { key, ex } = list[cur];
  store.last = key;
  ui.pick.value = String(cur);
  ui.title.textContent = ex.title;
  ui.text.textContent = ex.exercise;
  ui.hint.textContent = ex.hint ?? '';
  ui.solution.textContent = ex.solution ?? '';
  ui.hintBox.hidden = !ex.hint;
  ui.solBox.hidden = !ex.solution;
  ui.hintBox.open = ui.solBox.open = false;
  ui.code.value = store.getCode(key) ?? ex.starter ?? '';
  errLine = 0; updateGutter(); setResult('', '');
}

function setResult(cls, text) {
  ui.result.className = cls;
  ui.result.textContent = text;
}

/* ---------- editor ---------- */

function updateGutter() {
  const n = ui.code.value.split('\n').length;
  ui.gutter.innerHTML = Array.from({ length: n },
    (_, i) => (i + 1 === errLine ? `<b>${i + 1}</b>` : i + 1)).join('\n');
  ui.gutter.scrollTop = ui.code.scrollTop;
}

let saveTimer = null, saveKey = null;
function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer); saveTimer = null;
  store.setCode(saveKey, ui.code.value);
}

ui.code.addEventListener('input', () => {
  errLine = 0; updateGutter();
  saveKey = list[cur].key;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
});
ui.code.addEventListener('scroll', () => { ui.gutter.scrollTop = ui.code.scrollTop; });
ui.code.addEventListener('keydown', e => {        // desktop comfort
  if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '    '); }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); }
});

/* ---------- run ---------- */

function run() {
  if (cur < 0) return;
  const { key, ex } = list[cur];
  const cases = ex.cases ?? [{ setup: ex.setup, expect: ex.expect }];   // older stored packs
  let r, n = 0;
  for (const c of cases) {
    n++;
    r = runExercise(ui.code.value, c);
    if (!r.pass) break;
  }
  const tag = cases.length > 1 ? `case ${n}/${cases.length}: ` : '';
  const regs = r.changed.length ? '\n' + r.changed.map(([nm, v]) => `${nm}=${v}`).join('  ') : '';

  if (r.errors.length) {
    const e = r.errors[0];
    errLine = e.line ?? 0; updateGutter();
    const more = r.errors.length > 1 ? `  (+${r.errors.length - 1} more)` : '';
    setResult('err', `${tag}${e.line ? `line ${e.line}: ` : ''}${e.msg}${more}`);
  } else if (r.pass) {
    store.setSolved(key);
    ui.pick.options[cur].text = label(list[cur]);
    setResult('ok', `✓ Correct${cases.length > 1 ? ` (all ${cases.length} cases)` : ''}` + regs);
  } else {
    setResult('bad', `✗ ${tag}` + r.diffs.map(d => `${d.where} want ${d.want} got ${d.got}`).join('  ') + regs);
  }
}


/* ---------- menu ---------- */

function renderPacks() {
  ui.packList.innerHTML = '';
  for (const [name, pack] of Object.entries(store.packs)) {
    const li = document.createElement('li');
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.onclick = () => {
      if (!confirm(`Delete pack "${name}"? Progress is kept.`)) return;
      store.removePack(name); rebuild(); show(0);
    };
    li.append(`${name} (${pack.exercises.length})`, del);
    ui.packList.append(li);
  }
  if (!ui.packList.children.length) ui.packList.innerHTML = '<li class="dim">No packs yet</li>';
  const solved = list.filter(it => store.isSolved(it.key)).length;
  ui.stats.textContent = list.length ? `Solved ${solved} / ${list.length}` : '';
}

async function exportBackup() {
  flushSave();
  const name = `r5900-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([store.exportBackup()], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {          // iOS: share sheet → Save to Files
    try { await navigator.share({ files: [file] }); } catch { /* cancelled */ }
    return;
  }
  const a = document.createElement('a');                   // desktop: plain download
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function resetProgress() {
  if (!confirm('Clear all solved marks and saved code? Packs stay.')) return;
  flushSave();
  store.resetProgress();
  rebuild();
  show(cur);
  ui.menu.close();
}

/* ---------- wiring ---------- */

ui.pick.onchange  = () => show(+ui.pick.value);
ui.prev.onclick   = () => show(cur - 1);
ui.next.onclick   = () => show(cur + 1);
ui.run.onclick    = run;
ui.menuBtn.onclick   = () => { renderPacks(); ui.menu.showModal(); };
ui.closeMenu.onclick = () => ui.menu.close();
ui.importBtn.onclick = () => ui.file.click();
ui.file.onchange = async () => {
  for (const f of ui.file.files) importText(await f.text(), f.name.replace(/\.json$/i, ''));
  ui.file.value = '';
};
ui.addPaste.onclick  = () => { if (importText(ui.paste.value, 'Pasted')) ui.paste.value = ''; };
ui.exportBtn.onclick = exportBackup;
ui.resetBtn.onclick  = resetProgress;
addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', flushSave);
initToolbar({ code: ui.code, onRun: run });

/* ---------- start ---------- */

rebuild();
const last = list.findIndex(it => it.key === store.last);
show(last >= 0 ? last : 0);

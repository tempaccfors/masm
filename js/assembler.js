// /js/assembler.js
// Text -> instruction list. R5900 subset + pseudo-ops + CLPS2C-style absolute loads/stores.

export const BASE = 0x00100000;   // where "code" lives

export const REGS = ['zero','at','v0','v1','a0','a1','a2','a3',
  't0','t1','t2','t3','t4','t5','t6','t7',
  's0','s1','s2','s3','s4','s5','s6','s7',
  't8','t9','k0','k1','gp','sp','fp','ra'];

// accepts $t0, t0 (Ghidra style), $8, s8
export function parseReg(tok) {
  let t = String(tok).trim().toLowerCase().replace(/^\$/, '');
  if (t === 's8') t = 'fp';
  if (/^\d+$/.test(t) && +t < 32) return +t;
  const i = REGS.indexOf(t);
  if (i < 0) throw new Error(`bad register "${tok}"`);
  return i;
}

export function parseNum(tok) {
  const m = /^(-)?(0x[0-9a-f]+|\d+)$/i.exec(String(tok).trim());
  if (!m) throw new Error(`bad number "${tok}"`);
  const v = Number(m[2]);
  return m[1] ? -v : v;
}

export const hex = n => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

// operand specs: d=rd s=rs t=rt a=shift i=signed16 u=unsigned16 m=off(base) L=label
const SPEC = {
  addu:'d,s,t', add:'d,s,t', subu:'d,s,t', sub:'d,s,t',
  and:'d,s,t', or:'d,s,t', xor:'d,s,t', nor:'d,s,t', slt:'d,s,t', sltu:'d,s,t',
  sll:'d,t,a', srl:'d,t,a', sra:'d,t,a', sllv:'d,t,s', srlv:'d,t,s', srav:'d,t,s',
  addiu:'t,s,i', addi:'t,s,i', slti:'t,s,i', sltiu:'t,s,i',
  andi:'t,s,u', ori:'t,s,u', xori:'t,s,u', lui:'t,u',
  lw:'t,m', lh:'t,m', lhu:'t,m', lb:'t,m', lbu:'t,m', sw:'t,m', sh:'t,m', sb:'t,m',
  beq:'s,t,L', bne:'s,t,L', beql:'s,t,L', bnel:'s,t,L',
  blez:'s,L', bgtz:'s,L', bltz:'s,L', bgez:'s,L',
  j:'L', jal:'L', jr:'s', jalr:['s','d,s'],
  mult:['s,t','d,s,t'], multu:['s,t','d,s,t'], div:'s,t', divu:'s,t',
  mfhi:'d', mflo:'d', mthi:'s', mtlo:'s',
  nop:'',
};
const NAMES = { d:'rd', s:'rs', t:'rt', a:'sa', i:'simm16', u:'uimm16', m:'off(base)', L:'label' };
const keys  = spec => spec.split(',').filter(Boolean);
const usage = spec => keys(spec).map(k => NAMES[k]).join(', ') || 'no operands';

function range(op, v, lo, hi) {
  if (v >= lo && v <= hi) return v;
  const tip = lo < 0 && v > hi && v <= 0xFFFF ? ' — use ori, or li' : '';
  throw new Error(`${op}: ${v} out of range ${lo}..${hi}${tip}`);
}

function parseMem(tok) {
  const m = /^(.*)\(([^)]+)\)$/.exec(tok);
  if (!m) throw new Error(`bad memory operand "${tok}" (want off(base))`);
  return { imm: m[1].trim() ? parseNum(m[1]) : 0, rs: parseReg(m[2]) };
}

function build(op, args) {
  const specs = [].concat(SPEC[op] ?? []);
  if (!specs.length) throw new Error(`unknown instruction "${op}"`);
  const spec = specs.find(s => keys(s).length === args.length);
  if (spec === undefined) throw new Error(`${op} expects: ${specs.map(usage).join('  or  ')}`);

  const ins = { op, rd: 0, rs: 0, rt: 0, imm: 0 };
  keys(spec).forEach((k, i) => {
    const a = args[i];
    if (k === 'd') ins.rd = parseReg(a);
    else if (k === 's') ins.rs = parseReg(a);
    else if (k === 't') ins.rt = parseReg(a);
    else if (k === 'a') ins.imm = range(op, parseNum(a), 0, 31);
    else if (k === 'i') ins.imm = range(op, parseNum(a), -32768, 32767);
    else if (k === 'u') ins.imm = range(op, parseNum(a), 0, 0xFFFF);
    else if (k === 'm') { const m = parseMem(a); ins.rs = m.rs; ins.imm = range(op, m.imm, -32768, 32767); }
    else if (k === 'L') ins.target = a;
  });
  if (op === 'jalr' && args.length === 1) ins.rd = 31;
  return ins;
}

// li/la: picks the shortest real encoding
function loadImm(rt, v) {
  const s = v | 0, u = v >>> 0;
  if (s >= -32768 && s <= 32767) return [['addiu', [rt, '$zero', String(s)]]];
  if (u <= 0xFFFF) return [['ori', [rt, '$zero', String(u)]]];
  const hi = String(u >>> 16), lo = u & 0xFFFF;
  return lo ? [['lui', [rt, hi]], ['ori', [rt, rt, String(lo)]]] : [['lui', [rt, hi]]];
}

const PSEUDO = {
  li:   ['rt, imm32',  ([t, n]) => loadImm(t, parseNum(n))],
  la:   ['rt, addr32', ([t, n]) => loadImm(t, parseNum(n))],
  move: ['rd, rs',     ([d, s]) => [['addu', [d, s, '$zero']]]],
  not:  ['rd, rs',     ([d, s]) => [['nor',  [d, s, '$zero']]]],
  negu: ['rd, rs',     ([d, s]) => [['subu', [d, '$zero', s]]]],
  b:    ['label',      ([L])    => [['beq',  ['$zero', '$zero', L]]]],
  beqz: ['rs, label',  ([s, L]) => [['beq',  [s, '$zero', L]]]],
  bnez: ['rs, label',  ([s, L]) => [['bne',  [s, '$zero', L]]]],
};
const MEM_OPS = new Set(['lw','lh','lhu','lb','lbu','sw','sh','sb']);

function expand(op, args) {
  if (PSEUDO[op]) {
    const [use, fn] = PSEUDO[op];
    if (args.length !== use.split(',').length) throw new Error(`${op} expects: ${use}`);
    return fn(args);
  }
  // CLPS2C-style: lw $t0, 0x003E8888  ->  lui $at, hi ; lw $t0, lo($at)
  if (MEM_OPS.has(op) && args.length === 2 && !args[1].includes('(')) {
    const addr = parseNum(args[1]) >>> 0;
    const lo = addr & 0xFFFF;
    const hi = ((addr + 0x8000) >>> 16) & 0xFFFF;   // +1 when lo is "negative"
    const off = lo >= 0x8000 ? lo - 0x10000 : lo;
    return [['lui', ['$at', String(hi)]], [op, [args[0], `${off}($at)`]]];
  }
  return [[op, args]];
}

export function assemble(src) {
  const instrs = [], labels = Object.create(null), errors = [];

  src.split('\n').forEach((raw, i) => {
    const line = i + 1;
    let text = raw.replace(/(#|;|\/\/).*$/, '').trim();
    let m;
    while ((m = /^([A-Za-z_.][\w.]*):\s*/.exec(text))) {
      if (m[1] in labels) errors.push({ line, msg: `duplicate label "${m[1]}"` });
      labels[m[1]] = BASE + instrs.length * 4;
      text = text.slice(m[0].length);
    }
    if (!text) return;

    const [, op, rest = ''] = /^(\S+)\s*(.*)$/.exec(text);
    const args = rest.trim() ? rest.split(',').map(s => s.trim()) : [];
    try {
      for (const [o, a] of expand(op.toLowerCase(), args))
        instrs.push({ ...build(o, a), line });
    } catch (e) { errors.push({ line, msg: e.message }); }
  });

  // resolve labels (or absolute numeric targets)
  for (const ins of instrs) {
    if (ins.target === undefined) continue;
    if (ins.target in labels) ins.target = labels[ins.target];
    else try { ins.target = parseNum(ins.target) >>> 0; }
    catch { errors.push({ line: ins.line, msg: `unknown label "${ins.target}"` }); }
  }
  return { instrs, labels, errors };
}

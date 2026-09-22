// /js/cpu.js
// R5900 subset interpreter: 32-bit GPRs, little-endian, branch delay slots.
import { BASE, REGS, parseReg, parseNum, hex, assemble } from './assembler.js';

export class CPU {
  constructor(instrs, { delaySlots = true, maxSteps = 10000 } = {}) {
    Object.assign(this, { instrs, delaySlots, maxSteps });
    this.reset();
  }

  reset() {
    this.r = new Int32Array(32);
    this.hi = 0; this.lo = 0;
    this.mem = new Map();                        // byte addr -> byte
    this.end = BASE + this.instrs.length * 4;
    this.pc = BASE; this.npc = BASE + 4;
    this.r[31] = this.end;                       // top-level "jr $ra" = finish
    this.r[29] = 0x01FFF000;                     // $sp near top of 32MB EE RAM
    this.steps = 0; this.done = false; this.lastLine = 0;
  }

  // index or name: 5, "v0", "$t1", "hi", "lo"
  getReg(k) {
    if (k === 'hi' || k === 'lo') return this[k];
    return this.r[typeof k === 'number' ? k : parseReg(k)];
  }
  setReg(k, v) {
    if (k === 'hi' || k === 'lo') { this[k] = v | 0; return; }
    const i = typeof k === 'number' ? k : parseReg(k);
    if (i !== 0) this.r[i] = v;                  // $zero stays 0
  }

  read(a, size) {
    a >>>= 0;
    if (a % size) throw new Error(`unaligned ${size * 8}-bit read at ${hex(a)}`);
    let v = 0;
    for (let i = size - 1; i >= 0; i--) v = v * 256 + (this.mem.get(a + i) ?? 0);
    return v;                                    // unsigned
  }
  write(a, size, v) {
    a >>>= 0;
    if (a % size) throw new Error(`unaligned ${size * 8}-bit write at ${hex(a)}`);
    for (let i = 0; i < size; i++) { this.mem.set(a + i, v & 0xFF); v >>>= 8; }
  }

  load({ regs = {}, mem = {} } = {}) {
    for (const [k, v] of Object.entries(regs)) this.setReg(k, parseNum(v));
    for (const [a, v] of Object.entries(mem))  this.write(parseNum(a), 4, parseNum(v));
  }

  step() {
    const ins = this.instrs[(this.pc - BASE) / 4];
    if (!ins) {
      // a taken branch whose delay slot is past the end (jumping to the end itself is fine)
      if (this.npc !== this.pc + 4 && this.npc !== this.end) {
        const err = new Error('branch taken, but its delay slot is past the end of the code — add a nop after it');
        err.line = this.lastLine;
        throw err;
      }
      this.done = true; return;
    }
    try { this.exec(ins); }
    catch (e) { const err = new Error(e.message); err.line = ins.line; throw err; }
    this.lastLine = ins.line;
    this.steps++;
  }

  run() {
    while (!this.done) {
      if (this.steps >= this.maxSteps) throw new Error(`stopped after ${this.maxSteps} steps (infinite loop?)`);
      this.step();
    }
    return this;
  }

  exec(ins) {
    const { op, rd, rs, rt, imm } = ins;
    const s = this.r[rs], t = this.r[rt], us = s >>> 0, ut = t >>> 0;
    const set = (i, v) => this.setReg(i, v);
    const addr = (s + imm) >>> 0;
    let target = null, skipDelay = false;
    const br  = c => { if (c) target = ins.target; };
    const brl = c => { if (c) target = ins.target; else skipDelay = true; };   // branch-likely

    switch (op) {
      case 'nop': break;
      case 'add': case 'addu': set(rd, s + t); break;
      case 'sub': case 'subu': set(rd, s - t); break;
      case 'and':  set(rd, s & t); break;
      case 'or':   set(rd, s | t); break;
      case 'xor':  set(rd, s ^ t); break;
      case 'nor':  set(rd, ~(s | t)); break;
      case 'slt':  set(rd, s < t ? 1 : 0); break;
      case 'sltu': set(rd, us < ut ? 1 : 0); break;
      case 'sll':  set(rd, t << imm); break;
      case 'srl':  set(rd, t >>> imm); break;
      case 'sra':  set(rd, t >> imm); break;
      case 'sllv': set(rd, t << (s & 31)); break;
      case 'srlv': set(rd, t >>> (s & 31)); break;
      case 'srav': set(rd, t >> (s & 31)); break;

      case 'addi': case 'addiu': set(rt, s + imm); break;
      case 'slti':  set(rt, s < imm ? 1 : 0); break;
      case 'sltiu': set(rt, us < (imm >>> 0) ? 1 : 0); break;
      case 'andi':  set(rt, s & imm); break;
      case 'ori':   set(rt, s | imm); break;
      case 'xori':  set(rt, s ^ imm); break;
      case 'lui':   set(rt, imm << 16); break;

      case 'lw':  set(rt, this.read(addr, 4)); break;
      case 'lh':  set(rt, (this.read(addr, 2) << 16) >> 16); break;
      case 'lhu': set(rt, this.read(addr, 2)); break;
      case 'lb':  set(rt, (this.read(addr, 1) << 24) >> 24); break;
      case 'lbu': set(rt, this.read(addr, 1)); break;
      case 'sw':  this.write(addr, 4, t); break;
      case 'sh':  this.write(addr, 2, t); break;
      case 'sb':  this.write(addr, 1, t); break;

      case 'beq':  br(s === t); break;
      case 'bne':  br(s !== t); break;
      case 'beql': brl(s === t); break;
      case 'bnel': brl(s !== t); break;
      case 'blez': br(s <= 0); break;
      case 'bgtz': br(s > 0); break;
      case 'bltz': br(s < 0); break;
      case 'bgez': br(s >= 0); break;
      case 'j':    target = ins.target; break;
      case 'jal':  set(31, this.pc + 8); target = ins.target; break;
      case 'jr':   target = us; break;
      case 'jalr': set(rd, this.pc + 8); target = us; break;

      case 'mult': case 'multu': {
        const p = op === 'mult' ? BigInt(s) * BigInt(t) : BigInt(us) * BigInt(ut);
        this.lo = Number(BigInt.asIntN(32, p));
        this.hi = Number(BigInt.asIntN(32, p >> 32n));
        if (rd) set(rd, this.lo);                // R5900 3-operand form
        break;
      }
      case 'div':  if (t !== 0)  { this.lo = Math.trunc(s / t) | 0;   this.hi = (s % t) | 0; } break;
      case 'divu': if (ut !== 0) { this.lo = Math.floor(us / ut) | 0; this.hi = (us % ut) | 0; } break;
      case 'mfhi': set(rd, this.hi); break;
      case 'mflo': set(rd, this.lo); break;
      case 'mthi': this.hi = s; break;
      case 'mtlo': this.lo = s; break;
      default: throw new Error(`"${op}" not implemented`);
    }

    // control flow
    if (target !== null && !this.delaySlots) { this.pc = target; this.npc = target + 4; }
    else if (skipDelay && this.delaySlots)   { this.pc = this.npc + 4; this.npc = this.pc + 4; }
    else { this.pc = this.npc; this.npc = target ?? this.npc + 4; }
  }
}

// assemble + run + compare with exercise.expect
export function runExercise(src, ex, opts) {
  const { instrs, errors } = assemble(src);
  if (errors.length) return { pass: false, errors, diffs: [], changed: [] };

  const cpu = new CPU(instrs, opts);
  const snap = () => [...cpu.r, cpu.hi, cpu.lo];
  let before;
  try { cpu.load(ex.setup); before = snap(); cpu.run(); }
  catch (e) { return { pass: false, errors: [{ line: e.line ?? null, msg: e.message }], diffs: [], changed: [], cpu }; }

  // registers the code changed (shown in the result line)
  const changed = snap().flatMap((v, i) =>
    v === before[i] ? [] : [[i < 32 ? REGS[i] : (i === 32 ? 'hi' : 'lo'), hex(v)]]);

  const diffs = [];
  const cmp = (where, want, got) => {
    if ((want >>> 0) !== (got >>> 0)) diffs.push({ where, want: hex(want), got: hex(got) });
  };
  for (const [k, v] of Object.entries(ex.expect?.regs ?? {}))
    cmp('$' + k.replace(/^\$/, ''), parseNum(v), cpu.getReg(k));
  for (const [a, v] of Object.entries(ex.expect?.mem ?? {}))
    cmp(`[${a}]`, parseNum(v), cpu.read(parseNum(a), 4));

  return { pass: diffs.length === 0, errors: [], diffs, changed, cpu };
}

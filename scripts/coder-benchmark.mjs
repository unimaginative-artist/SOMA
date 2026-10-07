#!/usr/bin/env node
/**
 * coder-benchmark.mjs — is a bigger code model actually WORTH it for the LOGOS lobe?
 *
 * Honest, un-fakeable test (same spirit as lobe-benchmark.mjs, but hard enough to
 * separate a 14B-coder from a 7B): each task asks the model to implement a real
 * function, then we EXECUTE the generated code against hidden assertions in an
 * isolated child process. Score = fraction of tasks whose code actually passes.
 * No LLM judge — code either runs correct or it doesn't.
 *
 * Also records generation latency and whether Ollama ran it on GPU or CPU, so the
 * "quality" number can be weighed against the real cost on THIS box.
 *
 * Usage:
 *   node scripts/coder-benchmark.mjs                                   # 14b-coder vs 7b
 *   node scripts/coder-benchmark.mjs --models qwen2.5-coder:14b,qwen2.5:7b,soma-logos,gemma3:4b
 */

import { spawn } from 'child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const OLLAMA = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
const argModels = (process.argv.includes('--models')
  ? process.argv[process.argv.indexOf('--models') + 1] : '').split(',').map(s => s.trim()).filter(Boolean);
const MODELS = argModels.length ? argModels : ['qwen2.5-coder:14b', 'qwen2.5:7b'];
const GEN_TIMEOUT_MS = Number(process.env.CODER_BENCH_GEN_TIMEOUT_MS || 180_000);
const RUN_TIMEOUT_MS = 8_000;

// Each task: a function to implement + hidden asserts run against the generated code.
// Chosen to be edge-case-heavy so a stronger coder pulls ahead of a general 7B.
const TASKS = [
  {
    name: 'mergeIntervals',
    prompt: 'Implement `function mergeIntervals(intervals)` that merges overlapping [start,end] intervals and returns them sorted by start. Reply with ONLY the JavaScript function — no markdown, no explanation.',
    tests: `
      const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
      if(!eq(mergeIntervals([[1,3],[2,6],[8,10],[15,18]]),[[1,6],[8,10],[15,18]])) throw 'case1';
      if(!eq(mergeIntervals([[1,4],[4,5]]),[[1,5]])) throw 'case2';
      if(!eq(mergeIntervals([[1,4],[0,4]]),[[0,4]])) throw 'case3';
      if(!eq(mergeIntervals([]),[])) throw 'empty';
      if(!eq(mergeIntervals([[1,4],[2,3]]),[[1,4]])) throw 'contained';
    `,
  },
  {
    name: 'lruCache',
    prompt: 'Implement `function makeLRU(capacity)` returning an object with get(key) and put(key,value). get returns the value or -1; put evicts the least-recently-used key when over capacity; get and put both count as "use". Reply with ONLY the JavaScript function — no markdown, no explanation.',
    tests: `
      const c=makeLRU(2);
      c.put(1,1); c.put(2,2);
      if(c.get(1)!==1) throw 'g1';        // order now [2,1]
      c.put(3,3);                          // over cap -> evict LRU=2 -> {1,3}
      if(c.get(2)!==-1) throw 'evict2';
      if(c.get(1)!==1) throw 'keep1';      // 1 still present -> order [3,1]
      c.put(4,4);                          // evict LRU=3 -> {1,4}
      if(c.get(3)!==-1) throw 'evict3';
      if(c.get(4)!==4) throw 'g4';
    `,
  },
  {
    name: 'deepClone',
    prompt: 'Implement `function deepClone(obj)` that deep-clones nested objects and arrays (no shared references), handling Date correctly. Reply with ONLY the JavaScript function — no markdown, no explanation.',
    tests: `
      const src={a:1,b:{c:[1,2,{d:3}]},e:new Date(0)};
      const cl=deepClone(src);
      if(cl===src||cl.b===src.b||cl.b.c===src.b.c) throw 'sharedRef';
      cl.b.c[2].d=99;
      if(src.b.c[2].d!==3) throw 'mutation';
      if(!(cl.e instanceof Date)||cl.e.getTime()!==0) throw 'date';
    `,
  },
  {
    name: 'validParentheses',
    prompt: 'Implement `function isValid(s)` returning true iff every (), [], {} is correctly matched and nested. Reply with ONLY the JavaScript function — no markdown, no explanation.',
    tests: `
      if(isValid('()[]{}')!==true) throw 'c1';
      if(isValid('([{}])')!==true) throw 'c2';
      if(isValid('(]')!==false) throw 'c3';
      if(isValid('([)]')!==false) throw 'c4';
      if(isValid('')!==true) throw 'empty';
      if(isValid('(')!==false) throw 'open';
    `,
  },
  {
    name: 'romanToInt',
    prompt: 'Implement `function romanToInt(s)` converting a Roman numeral string to an integer (handles subtractive cases like IV, IX, XL, CM). Reply with ONLY the JavaScript function — no markdown, no explanation.',
    tests: `
      if(romanToInt('III')!==3) throw 'c1';
      if(romanToInt('IV')!==4) throw 'c2';
      if(romanToInt('IX')!==9) throw 'c3';
      if(romanToInt('LVIII')!==58) throw 'c4';
      if(romanToInt('MCMXCIV')!==1994) throw 'c5';
    `,
  },
  {
    name: 'topoSort',
    prompt: 'Implement `function topoSort(numNodes, edges)` where edges are [from,to] pairs of a DAG; return a valid topological ordering as an array, or null if a cycle exists. Reply with ONLY the JavaScript function — no markdown, no explanation.',
    tests: `
      const valid=(order,n,edges)=>{ if(order===null) return false; if(order.length!==n) return false; const pos={}; order.forEach((x,i)=>pos[x]=i); return edges.every(([a,b])=>pos[a]<pos[b]); };
      if(!valid(topoSort(4,[[0,1],[0,2],[1,3],[2,3]]),4,[[0,1],[0,2],[1,3],[2,3]])) throw 'dag';
      if(topoSort(2,[[0,1],[1,0]])!==null) throw 'cycle';
      if(!valid(topoSort(3,[]),3,[])) throw 'noedges';
    `,
  },
];

async function generate(model, prompt) {
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0.1 } }),
    signal: AbortSignal.timeout(GEN_TIMEOUT_MS),
  }).then(r => r.json());
  return { text: res.response || '', ms: Date.now() - t0 };
}

function extractCode(text) {
  const fence = text.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
  return (fence ? fence[1] : text).trim();
}

function runCode(code, tests) {
  return new Promise((resolve) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'coderbench-'));
    const file = path.join(dir, 'run.mjs');
    writeFileSync(file, `${code}\n\ntry {\n${tests}\nconsole.log('PASS');\n} catch(e){ console.log('FAIL:'+e); }\n`);
    let out = '';
    const proc = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'pipe'] });
    const killer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, RUN_TIMEOUT_MS);
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => out += d);
    proc.on('close', () => { clearTimeout(killer); try { rmSync(dir, { recursive: true, force: true }); } catch {}
      resolve(out.includes('PASS') ? { pass: true } : { pass: false, why: out.trim().split('\n')[0]?.slice(0, 80) }); });
    proc.on('error', () => { clearTimeout(killer); resolve({ pass: false, why: 'spawn error' }); });
  });
}

async function processorFor(model) {
  try {
    const ps = await fetch(`${OLLAMA}/api/ps`).then(r => r.json());
    const m = (ps.models || []).find(x => x.name === model || x.name.startsWith(model.split(':')[0]));
    if (!m) return '?';
    const gpu = m.size_vram || 0, total = m.size || 1;
    return gpu >= total * 0.95 ? 'GPU' : gpu <= total * 0.05 ? 'CPU' : `${Math.round(gpu / total * 100)}%GPU`;
  } catch { return '?'; }
}

async function main() {
  console.log(`[coder-bench] models: ${MODELS.join(', ')}`);
  console.log(`[coder-bench] ${TASKS.length} executable coding tasks, temp=0.1\n`);
  const summary = [];
  for (const model of MODELS) {
    let passed = 0, totalMs = 0; const detail = [];
    for (const task of TASKS) {
      let gen;
      try { gen = await generate(model, task.prompt); }
      catch (e) { detail.push(`${task.name}:GEN_ERR`); continue; }
      totalMs += gen.ms;
      const result = await runCode(extractCode(gen.text), task.tests);
      if (result.pass) passed++;
      detail.push(`${task.name}:${result.pass ? '✅' : '❌'}${result.pass ? '' : '(' + (result.why || '') + ')'} ${(gen.ms / 1000).toFixed(1)}s`);
    }
    const proc = await processorFor(model);
    const pct = Math.round(passed / TASKS.length * 100);
    summary.push({ model, passed, total: TASKS.length, pct, avgMs: Math.round(totalMs / TASKS.length), proc });
    console.log(`\n■ ${model}  (${proc})`);
    console.log(`   ${passed}/${TASKS.length} passed (${pct}%)  |  avg gen ${(totalMs / TASKS.length / 1000).toFixed(1)}s`);
    detail.forEach(d => console.log(`     ${d}`));
  }
  console.log(`\n${'='.repeat(60)}\nSUMMARY (higher pass% = better coder; weigh vs latency/proc):`);
  summary.sort((a, b) => b.pct - a.pct || a.avgMs - b.avgMs);
  for (const s of summary) console.log(`  ${s.model.padEnd(28)} ${String(s.pct).padStart(3)}%  ${String((s.avgMs / 1000).toFixed(1)).padStart(6)}s/task  ${s.proc}`);
  console.log('='.repeat(60));
}

main().catch(e => { console.error('benchmark error:', e); process.exit(1); });

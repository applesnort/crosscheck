#!/usr/bin/env node
/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// A crosscheck --exec runner for the Codex CLI.
//
//   crosscheck run lib/ --exec 'node examples/codex-lens.mjs'
//
// Demonstrates the CROSSCHECK_EFFORT contract: a lens declaring `effort: low` in
// its frontmatter runs at low reasoning depth without the caller retyping a
// provider flag per lens. Leaving every lens at maximum reasoning is usually the
// largest bill nobody looks at.
//
// Environment, all optional:
//   CC_CODEX_MODEL   default gpt-5.6-luna
//   CC_CODEX_EFFORT  fallback when the lens declares none (default medium)
//   CC_CODEX_STATS   set to print token usage to stderr
import { spawn } from 'node:child_process';

const MODEL = process.env.CC_CODEX_MODEL ?? 'gpt-5.6-luna';
const EFFORT = process.env.CROSSCHECK_EFFORT ||
  process.env.CC_CODEX_EFFORT || 'medium';
const LENS = process.env.CROSSCHECK_LENS || 'lens';

const die = (m) => {
  process.stderr.write(`codex-lens[${LENS}]: ${m}\n`);
  process.exit(1);
};

const prompt = await new Promise((res, rej) => {
  let b = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { b += d; });
  process.stdin.on('end', () => res(b));
  process.stdin.on('error', rej);
});
if (!prompt.trim()) die('empty prompt on stdin');

// --ephemeral keeps a panel of lenses from leaving a session file each; the
// prompt already carries the source, so the sandbox needs no write access.
const child = spawn('codex', [
  'exec', '--json', '--ephemeral', '-s', 'read-only', '--skip-git-repo-check',
  '-m', MODEL, '-c', `model_reasoning_effort=${EFFORT}`, '-'
], { stdio: ['pipe', 'pipe', 'pipe'] });

child.stdin.write(prompt);
child.stdin.end();

let out = '';
let err = '';
child.stdout.on('data', d => { out += d; });
child.stderr.on('data', d => { err += d; });

const code = await new Promise(res => child.on('close', res));
if (code !== 0) die(`codex exited ${code}: ${err.slice(0, 300)}`);

let text = null;
let usage = null;
for (const ln of out.split('\n')) {
  if (!ln.trim()) continue;
  let ev;
  try { ev = JSON.parse(ln); } catch { continue; }
  if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') {
    text = ev.item.text;
  }
  if (ev.type === 'turn.completed') usage = ev.usage;
  if (ev.type === 'error' || ev.error) {
    die(`codex error: ${JSON.stringify(ev).slice(0, 300)}`);
  }
}
if (!text?.trim()) die(`no agent_message in output: ${out.slice(0, 300)}`);

if (process.env.CC_CODEX_STATS && usage) {
  process.stderr.write(
    `codex-lens[${LENS}]: ${MODEL}/${EFFORT} in=${usage.input_tokens} ` +
    `cached=${usage.cached_input_tokens ?? 0} out=${usage.output_tokens} ` +
    `reasoning=${usage.reasoning_output_tokens ?? 0}\n`);
}
process.stdout.write(
  text.split('\n').filter(l => !/^\s*```/.test(l)).join('\n').trim() + '\n');

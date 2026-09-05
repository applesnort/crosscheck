#!/usr/bin/env node
/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// The benchmark's model runner. One prompt on stdin, findings on stdout.
//
// It resolves file paths out of the prompt and inlines their contents when the
// prompt names files without providing them. Versions before 0.9.0 built
// prompts that way and expected an agent on the other end, so a bare endpoint
// scored zero on everything — a fact about the runner, not about the version.
// Giving the old contract the minimum capability it assumed is what makes the
// comparison measure the tool rather than the harness.
//
// Deterministic on purpose: temperature 0 and a fixed seed, so a score that
// moves between versions moved because the version changed.
import { existsSync, readFileSync } from 'node:fs';

const HOST = process.env.BENCH_OLLAMA_HOST ?? 'http://127.0.0.1:11434';
const MODEL = process.env.BENCH_MODEL ?? 'gemma4:latest';
const CTX = Number(process.env.BENCH_CTX ?? 16384);
const PREDICT = Number(process.env.BENCH_PREDICT ?? 3000);
const SEED = Number(process.env.BENCH_SEED ?? 7);

const die = (m) => { process.stderr.write(`bench-runner: ${m}\n`); process.exit(1); };

let prompt = await new Promise((res, rej) => {
  let b = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { b += d; });
  process.stdin.on('end', () => res(b));
  process.stdin.on('error', rej);
});
if (!prompt.trim()) die('empty prompt on stdin');

// Only inline when the prompt did not already carry its source. A prompt that
// embeds files needs no help, and appending them twice would change what the
// newer versions are being scored on.
if (!prompt.includes('--- BEGIN SOURCE ---')) {
  const paths = [...prompt.matchAll(/^ {2}- (\S+)/gm)]
    .map(m => m[1]).filter(p => existsSync(p));
  if (paths.length) {
    const block = 'The files named above, in full:\n\n' +
      [...new Set(paths)].map(p => `===== ${p} =====\n` +
        readFileSync(p, 'utf8').split('\n')
          .map((l, i) => `${String(i + 1).padStart(6)}  ${l}`).join('\n'))
        .join('\n\n');
    // Inserted immediately after the file list the prompt itself builds, not
    // appended at the end. Appending would put the source after the output
    // contract — the worst position available — and newer versions lead with
    // it, so the comparison would be scoring placement rather than the tool.
    const anchor = /(Audit exactly these[\s\S]*?\n)(?=\n[A-Z])/;
    prompt = anchor.test(prompt)
      ? prompt.replace(anchor, `$1\n${block}\n`)
      : `${block}\n\n${prompt}`;
  }
}

let res;
try {
  res = await fetch(`${HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, prompt, stream: false, keep_alive: '30m', think: false,
      options: { num_ctx: CTX, num_predict: PREDICT, temperature: 0, seed: SEED }
    })
  });
} catch (e) {
  die(`cannot reach ${HOST}: ${e.message}`);
}
if (!res.ok) die(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
const body = await res.json();
if (body.error) die(`ollama error: ${body.error}`);

const used = body.prompt_eval_count ?? 0;
if (used >= CTX - 8) die(`prompt filled num_ctx (${used}/${CTX}) — truncated`);

const text = String(body.response ?? '')
  .split('\n').filter(l => !/^\s*```/.test(l)).join('\n').trim();
if (!text) {
  die(`no text (eval_count=${body.eval_count ?? 0}, ` +
      `done_reason=${body.done_reason})`);
}
process.stdout.write(text + '\n');

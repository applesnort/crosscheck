#!/usr/bin/env node
/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// A crosscheck --exec runner for a bare Ollama endpoint.
//
//   crosscheck run lib/ --exec 'node examples/ollama-lens.mjs'
//
// This is only possible because the prompt carries the source it reviews. A bare
// model has no filesystem, so under --no-embed it would be asked to review files
// it cannot open, and would answer NO FINDINGS to everything.
//
// Environment, all optional:
//   CC_OLLAMA_HOST      default http://127.0.0.1:11434
//   CC_OLLAMA_MODEL     default qwen2.5-coder:14b
//   CC_OLLAMA_CTX       default 16384
//   CC_OLLAMA_PREDICT   generation cap, overriding the effort-derived default
//   CC_OLLAMA_THINK     'true' to let a reasoning model think first (default
//                       false: reasoning is not free and a lens wants findings)
//   CC_OLLAMA_STATS     set to print throughput to stderr
//
// crosscheck sets CROSSCHECK_LENS, CROSSCHECK_EFFORT and CROSSCHECK_SCOPE.

const HOST = process.env.CC_OLLAMA_HOST ?? 'http://127.0.0.1:11434';
const MODEL = process.env.CC_OLLAMA_MODEL ?? 'qwen2.5-coder:14b';
const CTX = Number(process.env.CC_OLLAMA_CTX ?? 16384);
// Reasoning models return their chain in `thinking` and leave `response` empty
// until they reach a conclusion. Left on with a normal generation budget, the
// budget is spent thinking and the lens returns nothing at all — which reads as
// a clean file. Off by default; a lens wants findings, not deliberation.
const THINK = process.env.CC_OLLAMA_THINK === 'true';
const LENS = process.env.CROSSCHECK_LENS || 'lens';

// Most local models expose no reasoning-depth dial, so `effort` maps to how much
// the model is allowed to write. That is a proxy, not a translation — a runner
// for a provider that has a real setting should use that instead.
const PREDICT = Number(process.env.CC_OLLAMA_PREDICT) ||
  ({ low: 512, medium: 1024, high: 2048 }[
    process.env.CROSSCHECK_EFFORT || 'medium'] ?? 1024);

const die = (msg) => {
  // A non-zero exit marks the lens dead. Writing nothing on stdout and exiting
  // zero would be read as a clean file, which is the one failure that matters.
  process.stderr.write(`ollama-lens[${LENS}]: ${msg}\n`);
  process.exit(1);
};

const prompt = await new Promise((resolve, reject) => {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { buf += d; });
  process.stdin.on('end', () => resolve(buf));
  process.stdin.on('error', reject);
});
if (!prompt.trim()) die('empty prompt on stdin');

let res;
try {
  res = await fetch(`${HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      keep_alive: process.env.CC_OLLAMA_KEEPALIVE ?? '15m',
      think: THINK,
      options: { num_ctx: CTX, num_predict: PREDICT, temperature: 0 }
    })
  });
} catch (e) {
  die(`cannot reach ${HOST}: ${e.message}`);
}
if (!res.ok) die(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

const body = await res.json().catch(e => die(`unparseable response: ${e.message}`));
if (body.error) die(`ollama error: ${body.error}`);

// The server reports how many prompt tokens it consumed. Reaching the ceiling
// means the input was cut, and a review of a truncated file is a clean bill of
// health for code nobody looked at.
const used = body.prompt_eval_count ?? 0;
if (used >= CTX - 8) {
  die(`prompt filled num_ctx (${used}/${CTX}) — input was truncated. ` +
      'Raise CC_OLLAMA_CTX or narrow the target; refusing to report on a ' +
      'partial file.');
}

const text = String(body.response ?? '')
  .split('\n').filter(l => !/^\s*```/.test(l)).join('\n').trim();
if (!text) {
  // Naming the cause matters: "no text" sent four lenses back as failures with
  // nothing to act on. A reasoning model that spent the whole budget thinking
  // looks identical to a broken endpoint unless the counters are read.
  const spent = body.eval_count ?? 0;
  const thought = (body.thinking ?? '').length;
  die(spent > 0 && body.done_reason === 'length'
    ? `${MODEL} produced ${spent} tokens but no answer (done_reason=length` +
      `${thought ? `, ${thought} chars of it reasoning` : ''}). Raise ` +
      'CC_OLLAMA_PREDICT, or set CC_OLLAMA_THINK=false if this model reasons ' +
      'by default.'
    : `${MODEL} returned no text (eval_count=${spent})`);
}

if (process.env.CC_OLLAMA_STATS) {
  const pd = (body.prompt_eval_duration ?? 1) / 1e9;
  const ed = (body.eval_duration ?? 1) / 1e9;
  process.stderr.write(
    `ollama-lens[${LENS}]: ${MODEL} ctx=${CTX} effort=${
      process.env.CROSSCHECK_EFFORT || '-'} ` +
    `prompt=${used}tok@${(used / pd).toFixed(0)}/s ` +
    `gen=${body.eval_count ?? 0}tok@${((body.eval_count ?? 0) / ed).toFixed(1)}/s\n`);
}
process.stdout.write(text + '\n');

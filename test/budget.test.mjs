/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, planTokenBudget, formatEstimate } from '../lib/budget.mjs';

const job = (lens, chars) => ({ lens, prompt: 'x'.repeat(chars), files: ['a.js'] });

test('an estimate scales with length and is never zero for real text', () => {
  assert.ok(estimateTokens('hello world') > 0);
  assert.ok(estimateTokens('x'.repeat(1000)) > estimateTokens('x'.repeat(100)));
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens(null), 0);
});

test('no budget runs everything and still reports the estimate', () => {
  const jobs = [job('a', 400), job('b', 400)];
  const p = planTokenBudget(jobs, null);
  assert.equal(p.run.length, 2);
  assert.equal(p.dropped.length, 0);
  assert.ok(p.estimated > 0);
});

test('a budget keeps lenses in roster order until it is spent', () => {
  const jobs = [job('a', 350), job('b', 350), job('c', 350)];
  const each = estimateTokens('x'.repeat(350));
  const p = planTokenBudget(jobs, each * 2);
  assert.deepEqual(p.run.map(j => j.lens), ['a', 'b']);
  assert.deepEqual(p.dropped.map(j => j.lens), ['c']);
});

test('a dropped lens is named, never silently omitted', () => {
  const jobs = [job('a', 700), job('b', 700)];
  const p = planTokenBudget(jobs, estimateTokens('x'.repeat(700)));
  assert.equal(p.dropped.length, 1);
  assert.ok(p.dropped[0].lens);
});

test('a budget too small for even one lens drops all and says so', () => {
  const jobs = [job('a', 4000)];
  const p = planTokenBudget(jobs, 1);
  assert.equal(p.run.length, 0);
  assert.deepEqual(p.dropped.map(j => j.lens), ['a']);
});

test('the estimate is labelled as an estimate wherever it surfaces', () => {
  assert.match(formatEstimate(1234, null), /estimate/i);
  assert.match(formatEstimate(1234, 5000), /estimate/i);
});

test('formatting names the budget when one is set', () => {
  assert.match(formatEstimate(1234, 5000), /5,?000/);
});

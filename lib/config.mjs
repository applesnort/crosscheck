/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Project configuration.
//
// Retyping --exec on every invocation is friction that pushes people toward
// shell aliases, which are invisible to everyone else on the team. A committed
// config file makes the panel reproducible: the same command produces the same
// roster and the same model for whoever runs it.
//
// Precedence is defaults < config file < command line, and the loaded path is
// always reported — a run shaped by a file the user forgot about is exactly the
// kind of silent behaviour this tool refuses everywhere else.

export const CONFIG_FILENAMES = [
  '.crosscheckrc.json',
  '.crosscheckrc',
  'crosscheck.config.json'
];

// Keys a config file may set. Anything else is a typo worth reporting rather
// than ignoring: a misspelled `exec` that silently does nothing is worse than
// an error.
export const CONFIG_KEYS = new Set([
  'exec', 'lenses', 'concurrency', 'only', 'skip', 'mixed',
  'out', 'sarif', 'baseline', 'overlap',
  // Phase 1: change-scoped review, verification, and a project's own gate.
  'preflight', 'context', 'verify', 'no-verify', 'since',
  // Phase 2: cost control.
  'max-dispatches', 'no-cache', 'cache-dir'
]);

const LIST_KEYS = new Set(['only', 'skip']);

export function validateConfig(raw, source = 'config') {
  if (raw == null) {
    return { config: {}, problems: [] };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      config: {},
      problems: [`${source}: expected a JSON object at the top level`]
    };
  }
  const config = {};
  const problems = [];
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('//') || key === '$schema') {
      continue;
    }
    if (!CONFIG_KEYS.has(key)) {
      problems.push(
        `${source}: unknown key "${key}" — expected one of ` +
        [...CONFIG_KEYS].sort().join(', '));
      continue;
    }
    if (LIST_KEYS.has(key)) {
      if (Array.isArray(value)) {
        config[key] = value.map(String);
      } else if (typeof value === 'string') {
        config[key] = value.split(',').map(s => s.trim()).filter(Boolean);
      } else {
        problems.push(`${source}: "${key}" must be a list or a comma string`);
      }
      continue;
    }
    // `exec` may be one command for every lens, or a map choosing per lens so a
    // cheap lens does not pay for an expensive model.
    if (key === 'exec' && value && typeof value === 'object' &&
        !Array.isArray(value)) {
      const bad = Object.entries(value)
        .filter(([, v]) => typeof v !== 'string' || v === '');
      if (bad.length) {
        problems.push(
          `${source}: exec map entries must be non-empty strings ` +
          `(${bad.map(([k]) => k).join(', ')})`);
        continue;
      }
      config.exec = { ...value };
      continue;
    }
    if (key === 'concurrency' || key === 'context' || key === 'max-dispatches') {
      const n = Number(value);
      const floor = key === 'context' ? 0 : 1;
      if (!Number.isInteger(n) || n < floor) {
        problems.push(
          `${source}: "${key}" must be an integer >= ${floor}`);
        continue;
      }
      config[key] = n;
      continue;
    }
    if (key === 'mixed' || key === 'verify' || key === 'no-verify' ||
        key === 'no-cache') {
      if (typeof value !== 'boolean') {
        problems.push(`${source}: "${key}" must be true or false`);
        continue;
      }
      config[key] = value;
      continue;
    }
    if (typeof value !== 'string' || value === '') {
      problems.push(`${source}: "${key}" must be a non-empty string`);
      continue;
    }
    config[key] = value;
  }
  return { config, problems };
}

// Command-line flags always win. `only`/`skip` arrive as comma strings from the
// CLI and as lists from a file, so both are normalised to lists here.
export function mergeConfig(fileConfig = {}, cliOptions = {}) {
  const merged = { ...fileConfig };
  for (const [key, value] of Object.entries(cliOptions)) {
    if (value === undefined) {
      continue;
    }
    merged[key] = LIST_KEYS.has(key) && typeof value === 'string'
      ? value.split(',').map(s => s.trim()).filter(Boolean)
      : value;
  }
  for (const key of LIST_KEYS) {
    if (typeof merged[key] === 'string') {
      merged[key] = merged[key].split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  return merged;
}

// Walk from `startDir` toward the filesystem root looking for a config file, so
// running from a subdirectory of a project still picks up its settings.
// `readFile` and `exists` are injected to keep this testable without a disk.
export function findConfig(startDir, { exists, isRoot = null } = {}) {
  if (typeof exists !== 'function') {
    throw new Error('findConfig requires an exists() probe');
  }
  let dir = startDir;
  const seen = new Set();
  while (dir && !seen.has(dir)) {
    seen.add(dir);
    for (const name of CONFIG_FILENAMES) {
      const candidate = dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
      if (exists(candidate)) {
        return candidate;
      }
    }
    if (isRoot?.(dir)) {
      return null;
    }
    const parent = dir.replace(/\/[^/]*\/?$/, '');
    if (parent === dir || parent === '') {
      return null;
    }
    dir = parent;
  }
  return null;
}

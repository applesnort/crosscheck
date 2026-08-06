/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Lens metadata and routing.
//
// Routing used to be a prose table a model was asked to interpret. Declaring it
// in each lens's frontmatter makes the roster decision testable, and lets a bad
// roster fail before any agent is dispatched rather than after.
//
// No YAML dependency: the frontmatter this reads is a deliberately small subset
// (scalars and inline `[a, b]` lists), and a parser for that subset is smaller
// than the risk of pulling in a dependency for a five-key header.

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

// Split a list on commas, but NOT on commas inside {...} or quotes. A glob like
// `**/*.{js,mjs}` is one pattern; splitting it yields three broken ones, and the
// lens then matches nothing at all.
function splitList(body) {
  const items = [];
  let current = '';
  let depth = 0;
  let quote = null;
  for (const ch of body) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{' || ch === '[') {
      depth += 1;
    } else if (ch === '}' || ch === ']') {
      depth -= 1;
    }
    if (ch === ',' && depth === 0) {
      items.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  items.push(current.trim());
  return items.filter(Boolean);
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value.startsWith('[') && value.endsWith(']')) {
    return splitList(value.slice(1, -1));
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value.replace(/^["']|["']$/g, '');
}

export function parseFrontmatter(text) {
  const match = FRONTMATTER.exec(String(text ?? ''));
  if (!match) {
    return null;
  }
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) {
      continue;
    }
    const kv = /^([A-Za-z][\w-]*):(.*)$/.exec(line);
    if (!kv) {
      continue;
    }
    meta[kv[1]] = parseScalar(kv[2]);
  }
  return meta;
}

export const REQUIRED_KEYS = ['name', 'summary', 'when', 'owns'];

export function validateLens(meta) {
  const problems = [];
  if (!meta) {
    return { ok: false, problems: ['missing frontmatter block'] };
  }
  for (const key of REQUIRED_KEYS) {
    const value = meta[key];
    const empty = value == null || value === '' ||
      (Array.isArray(value) && value.length === 0);
    if (empty) {
      problems.push(`missing or empty required key: ${key}`);
    }
  }
  if (meta.when && !Array.isArray(meta.when)) {
    problems.push('`when` must be a list of globs, e.g. [**/*.js]');
  }
  // A lens that never declines is a lens that dilutes consensus, so the scope
  // boundary is required rather than optional.
  if (meta['not-owns'] == null || meta['not-owns'] === '') {
    problems.push('missing `not-owns`: every lens must state what it excludes');
  }
  return { ok: problems.length === 0, problems };
}

// Minimal glob matching: `**` across separators, `*` and `?` within a segment.
// Enough for path routing; deliberately not a full glob implementation.
export function globToRegExp(glob) {
  let out = '';
  const pattern = String(glob ?? '');
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` may match zero directories, so the separator is optional.
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
      continue;
    }
    if (c === '?') {
      out += '[^/]';
      continue;
    }
    if (c === '{') {
      const close = pattern.indexOf('}', i);
      if (close > i) {
        const alts = pattern.slice(i + 1, close).split(',')
          .map(a => a.replace(/[.+^${}()|[\]\\]/g, '\\$&'));
        out += `(?:${alts.join('|')})`;
        i = close;
        continue;
      }
    }
    out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export function matchesAny(file, globs) {
  return (globs ?? []).some(g => globToRegExp(g).test(file));
}

// lenses: [{name, when: [globs], ...}], files: [paths in scope]
// Returns { roster, skipped } — skipped carries a reason per lens, because a
// silently omitted lens reads as coverage that never happened.
export function routeRoster(lenses, files) {
  const roster = [];
  const skipped = [];
  for (const lens of lenses ?? []) {
    const matched = (files ?? []).filter(f => matchesAny(f, lens.when));
    if (matched.length === 0) {
      skipped.push({
        lens: lens.name,
        reason: `nothing in scope matches ${(lens.when ?? []).join(', ')}`
      });
      continue;
    }
    roster.push({ ...lens, files: matched });
  }
  return { roster, skipped };
}

// `--only a,b` / `--skip x,y` overrides, applied after routing so an explicit
// request wins over the glob decision but is still reported.
export function applyOverrides(routed, { only, skip } = {}) {
  let { roster, skipped } = routed;
  if (only?.length) {
    const keep = new Set(only);
    skipped = [
      ...skipped,
      ...roster.filter(l => !keep.has(l.name))
        .map(l => ({ lens: l.name, reason: 'excluded by --only' }))
    ];
    roster = roster.filter(l => keep.has(l.name));
  }
  if (skip?.length) {
    const drop = new Set(skip);
    skipped = [
      ...skipped,
      ...roster.filter(l => drop.has(l.name))
        .map(l => ({ lens: l.name, reason: 'excluded by --skip' }))
    ];
    roster = roster.filter(l => !drop.has(l.name));
  }
  return { roster, skipped };
}

// Layered lens resolution.
//
// A single lens directory has to be either yours or the packaged one, which
// forces anyone adding a lens to fork all of them and lose upstream changes.
// Sources are layered instead, in increasing precedence: a later source with the
// same lens `name` shadows an earlier one, so overriding one lens costs one file
// rather than a fork.
//
// sources: [{origin, lenses: [{name, ...}]}] — origin is a label for reporting,
// usually the directory the lenses were read from.
export function resolveLensSet(sources) {
  const byName = new Map();
  const shadowed = [];
  for (const source of sources ?? []) {
    for (const lens of source.lenses ?? []) {
      if (!lens?.name) {
        continue;
      }
      const previous = byName.get(lens.name);
      if (previous) {
        shadowed.push({
          name: lens.name,
          winner: source.origin,
          shadowedFrom: previous.origin
        });
      }
      byName.set(lens.name, { ...lens, origin: source.origin });
    }
  }
  return {
    lenses: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    shadowed
  };
}

/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Emit merged panel findings as SARIF 2.1.0.
//
// Why: every other multi-persona review panel emits prose for a human to read
// once. SARIF is the OASIS interchange format that static analyzers already
// speak, so emitting it puts lens findings into GitHub code scanning, editor
// problem panels, and security dashboards without any of them knowing an LLM
// produced the results.
//
// Two panel-specific properties ride along in `properties`, since SARIF has no
// native concept for either: the lenses that reported a finding, and the
// consensus score. Lenses that failed to complete are recorded as tool
// execution notifications — the format's own place for "this run was partial",
// which keeps the disclosure machine-readable instead of a line of prose.

const SARIF_VERSION = '2.1.0';
const SCHEMA =
  'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json';

// BLOCK/FIX/CONSIDER onto SARIF's result levels.
const LEVEL = { BLOCK: 'error', FIX: 'warning', CONSIDER: 'note' };

export function sarifLevel(severity) {
  return LEVEL[severity] ?? 'note';
}

// Stable across runs and independent of finding order, so a consumer can match
// the same defect between two runs. SARIF's own mechanism for this.
export function fingerprint(finding) {
  const basis = `${finding.file}:${finding.line}|${finding.issue}`;
  // A short, dependency-free digest. Not cryptographic — it only has to be
  // stable and collision-resistant enough to key one repo's findings.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < basis.length; i++) {
    const c = basis.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') +
    h2.toString(16).padStart(8, '0'));
}

// One SARIF rule per lens: the lens is what "decided" the finding, so it is the
// unit a consumer will want to filter and configure by.
function rulesForLenses(lenses, lensMeta = {}) {
  return [...lenses].sort().map(name => {
    const meta = lensMeta[name] ?? {};
    const rule = {
      id: `lens/${name}`,
      name,
      shortDescription: { text: meta.summary ?? `${name} review lens` },
      properties: {}
    };
    if (meta.cites?.length) {
      rule.properties.cites = meta.cites;
    }
    if (meta.owns) {
      rule.properties.owns = meta.owns;
    }
    if (Object.keys(rule.properties).length === 0) {
      delete rule.properties;
    }
    return rule;
  });
}

function resultFor(finding) {
  const text = finding.fix
    ? `${finding.issue} — fix: ${finding.fix}`
    : finding.issue;
  return {
    // A finding confirmed by several lenses is attributed to the first that
    // reported it, with the full set in properties; SARIF results carry one
    // ruleId.
    ruleId: `lens/${finding.lenses[0]}`,
    level: sarifLevel(finding.severity),
    message: { text },
    locations: [{
      physicalLocation: {
        artifactLocation: { uri: finding.file },
        region: { startLine: finding.line }
      }
    }],
    partialFingerprints: { crosscheckFindingV1: fingerprint(finding) },
    properties: {
      lenses: finding.lenses,
      consensus: finding.consensus === true,
      consensusScore: finding.consensusScore ?? 1,
      severity: finding.severity
    }
  };
}

// merged: the object returned by mergeFindings (plus optional refuted list).
// options: { toolVersion, informationUri, lensMeta, refuted }
export function toSarif(merged, options = {}) {
  const {
    toolVersion = '0.1.0',
    informationUri = 'https://github.com/applesnort/crosscheck',
    lensMeta = {},
    refuted = []
  } = options;

  const findings = merged?.findings ?? [];
  const incomplete = merged?.incomplete ?? [];
  const unparsed = merged?.unparsed ?? [];
  const lenses = new Set(findings.flatMap(f => f.lenses));
  for (const lens of incomplete) {
    lenses.add(lens);
  }

  const notifications = [];
  for (const lens of incomplete) {
    notifications.push({
      level: 'error',
      message: {
        text: `Lens "${lens}" did not complete; its coverage is missing from ` +
          'this run.'
      },
      descriptor: { id: 'crosscheck/lensIncomplete' },
      properties: { lens }
    });
  }
  for (const { lens, line } of unparsed) {
    notifications.push({
      level: 'warning',
      message: {
        text: `Lens "${lens}" emitted a line that does not match the finding ` +
          `contract: ${line}`
      },
      descriptor: { id: 'crosscheck/unparsedOutput' },
      properties: { lens }
    });
  }
  for (const finding of refuted) {
    notifications.push({
      level: 'note',
      message: {
        text: `Finding at ${finding.file}:${finding.line} was refuted during ` +
          `verification and excluded: ${finding.issue}`
      },
      descriptor: { id: 'crosscheck/refuted' },
      properties: { lenses: finding.lenses }
    });
  }

  return {
    $schema: SCHEMA,
    version: SARIF_VERSION,
    runs: [{
      tool: {
        driver: {
          name: 'crosscheck',
          version: toolVersion,
          informationUri,
          rules: rulesForLenses(lenses, lensMeta)
        }
      },
      invocations: [{
        // A panel missing a lens still produced results, so the invocation
        // succeeded; the gap is reported, not hidden, and not faked as success
        // of the whole roster.
        executionSuccessful: incomplete.length === 0,
        toolExecutionNotifications: notifications
      }],
      results: findings.map(resultFor)
    }]
  };
}

export function toSarifJson(merged, options = {}) {
  return JSON.stringify(toSarif(merged, options), null, 2) + '\n';
}

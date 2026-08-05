#!/usr/bin/env bash
# Fetch the OWASP Benchmark corpus locally. It is NOT vendored into this
# repository: the upstream repo declares no SPDX license, so no assumption is
# made about redistribution terms. Only the adapter, the sample manifest, and
# the resulting scores are committed here.
#
# Usage: bash scripts/fetch-corpus.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEST="${ROOT}/corpus/owasp-benchmark"
REMOTE="https://github.com/OWASP-Benchmark/BenchmarkJava.git"

mkdir -p "${ROOT}/corpus"

if [ -d "${DEST}/.git" ]; then
    printf 'Corpus already present at %s\n' "${DEST}"
    printf 'Updating...\n'
    if ! git -C "${DEST}" pull --ff-only --quiet; then
        printf 'ERROR: could not fast-forward the corpus. Resolve manually or ' >&2
        printf 'delete %s and re-run.\n' "${DEST}" >&2
        exit 1
    fi
else
    printf 'Cloning OWASP Benchmark (shallow) into %s\n' "${DEST}"
    if ! git clone --depth 1 --quiet "${REMOTE}" "${DEST}"; then
        printf 'ERROR: clone failed — corpus not fetched.\n' >&2
        exit 1
    fi
fi

LABELS="${DEST}/expectedresults-1.2.csv"
if [ ! -f "${LABELS}" ]; then
    printf 'ERROR: %s is missing. The upstream layout may have changed; the\n' \
        "${LABELS}" >&2
    printf 'adapter in lib/corpus.mjs expects that file.\n' >&2
    exit 1
fi

total=$(grep -c ',' "${LABELS}")
vulnerable=$(awk -F, '$3=="true"' "${LABELS}" | wc -l | tr -d ' ')
safe=$(awk -F, '$3=="false"' "${LABELS}" | wc -l | tr -d ' ')

printf '\n✓ Corpus ready\n'
printf '  labels:      %s\n' "${LABELS}"
printf '  cases:       %s\n' "${total}"
printf '  vulnerable:  %s\n' "${vulnerable}"
printf '  safe:        %s  <- the false-positive opportunities\n' "${safe}"
printf '\nNext: node scripts/build-sample.mjs\n'

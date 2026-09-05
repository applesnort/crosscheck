# Example runners

`--exec` names a command that receives one lens prompt on stdin and returns
findings on stdout. These are two working ones. Neither is imported by
crosscheck; copy either as a starting point.

| | |
|---|---|
| `ollama-lens.mjs` | a bare Ollama endpoint — no filesystem, no tools |
| `codex-lens.mjs` | the Codex CLI, demonstrating per-lens reasoning effort |

```sh
crosscheck run lib/ --exec 'node examples/ollama-lens.mjs'
crosscheck run lib/ --exec 'node examples/codex-lens.mjs'
```

## What crosscheck tells a runner

Three variables are set on every dispatch:

| variable | meaning |
|---|---|
| `CROSSCHECK_LENS` | the lens being run, useful in logs |
| `CROSSCHECK_EFFORT` | `low`, `medium` or `high` from the lens's frontmatter |
| `CROSSCHECK_SCOPE` | `file` or `hunks`, what the prompt contains |

crosscheck cannot know your provider's flag for reasoning depth — `--exec` is an
arbitrary command — so it publishes the intent and the runner translates it.
`codex-lens.mjs` maps `CROSSCHECK_EFFORT` onto `model_reasoning_effort`.
`ollama-lens.mjs` has no real equivalent to map onto, so it maps effort to a
generation budget and says so in a comment rather than pretending otherwise.

## Two rules a runner has to follow

**Exit non-zero when anything goes wrong.** crosscheck reads empty stdout or a
non-zero exit as a lens that died, and reports it as such. A runner that
swallows an error and exits cleanly turns a broken lens into a clean file, which
is the one failure mode that costs more than not running at all.

**Refuse to report on a truncated prompt.** `ollama-lens.mjs` checks
`prompt_eval_count` against the context window and exits non-zero if the input
filled it, because findings drawn from half a file read as a clean bill of
health for the half nobody saw.

## Why a bare model works at all

Before 0.9.0 a lens prompt named its files and told the runner to open them, so
`--exec` needed an agent. Pointed at a bare model, four lenses returned
`NO FINDINGS` each against a fixture with seven planted defects — the model had
nothing to look at. The prompt now carries its source, so an endpoint with no
tools is a valid runner. Under `--no-embed` these examples stop working, and
that is expected.

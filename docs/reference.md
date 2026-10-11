# Reference

This page lists the public command and module surface of `@kontourai/aidlc-kit`. Ordinary execution goes through `flow-agents kit run aidlc`; see [Environment setup](environment-setup.md). The `kontour-aidlc` command covers methodology-specific operator actions on a run that already exists.

## kontour-aidlc CLI

The package declares one binary, `kontour-aidlc` (`scripts/cli.mjs`). It is separate from the AWS `aidlc` command. Commands that need an argument throw a usage error when it is missing. Results are printed as JSON.

| Command | Arguments | Effect |
| --- | --- | --- |
| `profiles` | none | Prints the profile names from the pinned `upstream/snapshot.json`. |
| `check` | none | Runs `node scripts/compile.mjs --check`, which fails on drift between the snapshot and the generated `kit.json`, flows and skills. |
| `run` | `--request <kit-request.json> --controller-root <private-root> [--auth-file <host-auth.json>]` | Executes the request through the kit's standard entry. Exits `0` when the result status is `completed` or `waiting`, otherwise `1`. |
| `decisions` | `--controller-root <private-root>` | Lists signed pending inputs under `<private-root>/authority/pending/`, each with its file path. |
| `decide` | `--controller-root <private-root> --pending <signed-pending.json> --reference <operator-reference> [--decision approve\|deny] [--disposition <file.json>]` | Records an operator interaction against one pending input, under the controller lock. `--decision` defaults to `approve`. |
| `recompose` | `--request <original-kit-request.json> --controller-root <private-root> --proposal <pending-stage-delta.json>` | Proposes, or applies once approved, a change to the pending stages of a stopped run. |
| `recover-controller` | `--controller-root <private-root>` | Removes a stale controller lock when its recorded owner is proven dead. |
| `help` | none | Prints a one-line usage summary. Running with no command does the same. |

Each command's contract is described in its guide:

- `decide --disposition` with questionnaire answers: [questionnaire replies](questionnaire-replies.md).
- `decide --disposition` with review corrections, and `recover-controller`: [review revisions](review-revisions.md).
- `recompose`: [recomposition](recomposition.md).

## Package exports

| Export | Module | Named exports |
| --- | --- | --- |
| `@kontourai/aidlc-kit` | `scripts/runtime.mjs` | `runAidlc`, `snapshotWorkspace`, `artifactPaths`, `attachObservation`, `refreshArtifactValidity`, `stageContext`, `restoreUnits` |
| `@kontourai/aidlc-kit/run` | `scripts/run.mjs` | `executeRequestFile`, `executeKit`, `runAidlc` |
| `@kontourai/aidlc-kit/executor` | `scripts/executor.mjs` | `createDockerExecutor` |
| `@kontourai/aidlc-kit/compile` | `scripts/compile.mjs` | `compileProfile`, `readSnapshot`, `generatedFiles`, `writeGenerated`, `requestBindingValue`, `requestBindingDigest`, `digest`, `KIT_ROOT` |
| `@kontourai/aidlc-kit/kit.json` | `kit.json` | The generated kit manifest. |

`kit.json` declares the standard execution entry as `executeRequestFile` in `scripts/run.mjs`, with contract `kontour.kit.execution_request@1.0`. See [Standard kit execution entry](docker-worker-adapter.md).

## Repository scripts

| Script | Runs |
| --- | --- |
| `npm run check` | The generated-file drift check, `node scripts/compare.mjs method`, and `node evals/public-flow-conformance.mjs`. |
| `npm test` | `node --test evals/*.test.mjs`. |
| `npm run test:package` | Packs the repository, installs it cleanly outside the source tree, and validates and activates it through the public Flow Agents CLI. |
| `node scripts/compile.mjs [--check]` | Regenerates `kit.json`, `flows/` and `skills/` from the snapshot, or with `--check` fails on drift. |
| `node scripts/import-upstream.mjs <pinned-upstream-checkout> [output-directory]` | Re-imports the pinned upstream methodology; see [methodology](methodology.md#reproduce-the-import). |
| `node scripts/compare.mjs outputs <case.json> <aws-result.json> <kontour-result.json>` | Compares recorded outputs against a frozen rubric; see [comparison ground](README.md#comparison-ground). |
| `node scripts/capture-run.mjs <case.json> <adapter.json> <workspace> <result.json>` | Captures an adapter run for comparison. |

# Reference

This page lists the public command and module surface of `@kontourai/aidlc-kit`. Ordinary execution goes through `flow-agents kit run aidlc`; see [Environment setup](environment-setup.md). The `kontour-aidlc` command covers methodology-specific operator actions on a run that already exists.

## kontour-aidlc CLI

The package declares one binary, `kontour-aidlc` (`scripts/cli.mjs`). It is separate from the AWS `aidlc` command. Results are printed as JSON.

Exit codes:

- `0`: the command succeeded. For `run`, the result status was `completed` or `waiting`.
- `1`: the command ran and failed, or `run` returned any other status. Runtime errors are printed with their stack.
- `2`: usage error. A required argument is missing or the command is unknown. The CLI prints `kontour-aidlc: <message>` and the usage line to stderr, without a stack trace, and does nothing else.

| Command | Arguments | Effect |
| --- | --- | --- |
| `profiles` | none | Prints the profile names from the pinned `upstream/snapshot.json`. |
| `check` | none | Runs `node scripts/compile.mjs --check`, which fails on drift between the snapshot and the generated `kit.json`, flows and skills. |
| `run` | `--request <kit-request.json> --controller-root <private-root> [--auth-file <host-auth.json>]` | Executes the request through the kit's standard entry. Exits `0` when the result status is `completed` or `waiting`, otherwise `1`. |
| `decisions` | `--controller-root <private-root>` | Lists signed pending inputs under `<private-root>/authority/pending/`, each with its file path. |
| `review` | `--controller-root <private-root> --pending <current-signed-review.json> --reference <host-operator-reference> [--port <port>]` | Creates a signed, private produced-artifact review session and serves the optional Survey console on loopback. Prints its URL, session file and original budget. Survey must be installed separately; local actions remain host-observed operator interactions. |
| `inspect-review` | `--controller-root <private-root> --pending <current-signed-review.json>` | Reads a current single-unit produced-artifact review under the controller lock. Verifies the signed request, current visit, artifact bytes and original execution bounds; prints the admitted input, document text/digests, basis digest and worker/deadline budget. Records no decision and advances no gate. |
| `decide` | `--controller-root <private-root> --pending <signed-pending.json> --reference <operator-reference> [--decision approve\|deny] [--disposition <file.json>]` | Records an operator interaction against one pending input, under the controller lock. `--decision` defaults to `approve`. |
| `recompose` | `--request <original-kit-request.json> --controller-root <private-root> --proposal <pending-stage-delta.json>` | Proposes, or applies once approved, a change to the pending stages of a stopped run. |
| `revise-input` | `--request <original-request.json> --controller-root <private-root> --pending <current-signed-wait.json> --proposal <exact-input-revision.json>` | Proposes, or applies once explicitly approved, one exact revision to an accepted observed public input at a settled wait, retaining original requests, budgets and receipts. |
| `recover-controller` | `--controller-root <private-root>` | Removes a stale controller lock when its recorded owner is proven dead. |
| `help` | none | Prints a one-line usage summary. Running with no command does the same. |

Each command's contract is described in its guide:

- `review`: [optional Survey decisions](using-the-kit.md#optional-local-survey-decisions).
- `inspect-review`: [current requirements review inspection](using-the-kit.md#inspect-the-current-artifact-review). Questionnaire/input confirmation, stale or expired subjects, drifted history and unsettled workers are refused; inspection supplies no human approval.
- `decide --disposition` with questionnaire answers: [questionnaire replies](questionnaire-replies.md).
- `decide --disposition` with review corrections, and `recover-controller`: [review revisions](review-revisions.md).
- `recompose`: [recomposition](recomposition.md).
- `revise-input`: [signed input revisions](input-revisions.md).

## Package exports

| Export | Module | Named exports |
| --- | --- | --- |
| `@kontourai/aidlc-kit` | `scripts/runtime.mjs` | `runAidlc`, `snapshotWorkspace`, `artifactPaths`, `attachObservation`, `refreshArtifactValidity`, `refreshAndPersistArtifactValidity`, `currentOutputInventory`, `stageContext`, `restoreUnits` |
| `@kontourai/aidlc-kit/run` | `scripts/run.mjs` | `executeRequestFile`, `executeKit`, `runAidlc` |
| `@kontourai/aidlc-kit/executor` | `scripts/executor.mjs` | `createDockerExecutor` |
| `@kontourai/aidlc-kit/compile` | `scripts/compile.mjs` | `compileProfile`, `readSnapshot`, `generatedFiles`, `shippedDocs`, `writeGenerated`, `requestBindingValue`, `requestBindingDigest`, `digest`, `KIT_ROOT` |
| `@kontourai/aidlc-kit/kit.json` | `kit.json` | The generated kit manifest. |

`kit.json` declares the standard execution entry as `executeRequestFile` in `scripts/run.mjs`, with contract `kontour.kit.execution_request@1.0`. Its `docs` list is every `.md` and `.json` file the package ships under `docs/`, sorted, so a new guide is advertised once it is added and the manifest is regenerated; `npm run check` fails until it is. See [Standard kit execution entry](docker-worker-adapter.md).

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

## Native Flow Agents review

`flow-agents kit review aidlc --dest <installed-bootstrap> --request
<private-review-request.json> [--port <0..65535>]` opens the optional Survey
produced-artifact review through the platform's installed-kit host. The request uses
`kontour.kit.review_request` version `1.0`, kit ID `aidlc`, and `input` containing
`controllerRoot`, `pendingFile`, and `reference`. See the
[usage guide](using-the-kit.md#optional-local-survey-decisions) for an
actual request shape, original deadline and decision semantics. The native host
checks kit integrity; the kit checks current domain admission. `kontour-aidlc
review` remains a compatibility front door; it does not establish person identity.

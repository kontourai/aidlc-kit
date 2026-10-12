# Use the AI-DLC Kit

The Kit turns a task into an AI-DLC workflow: clarify intent, produce the selected
stage artifacts, obtain the required decisions and reviews, run checks, and
advance through Flow gates. Start with a small POC before choosing a larger
profile. A full profile includes more ceremony and may require deployment
commands and permissions that a local coding task does not supply.

## How the tools fit together

| Tool | Responsibility |
| --- | --- |
| AI-DLC Kit | Pinned AWS procedures, profiles, artifact contracts, and the operator decision interface. |
| Flow | Canonical run state, gates, dependency invalidation, and routes back to work that needs correction. |
| Flow Agents | Installation and activation, the public `kit setup`/`doctor`/`run` interface, and execution through the selected coding engine. |
| Coding engine | Uses its configured model and tools to author artifacts or perform a distinct review. |
| Plumb | Shared check observations and required-check aggregation. The kit retains its methodology-specific checks and observes actual artifact bytes. |
| Veritas | The Governance Kit wraps repository standards and readiness evaluation, hosted by Flow Agents. Passing these checks does not establish general semantic correctness. |
| Surface | Evidence and provenance contracts used by the host. A valid receipt is not proof of authenticated human approval. |
| Evals | Independent comparison and grading, used for qualification rather than required for an ordinary project run. |
| Datum / Station | Optional provider references or host connections. They are not prerequisites for the standalone native CLI path. |

This is an alternative implementation of the pinned methodology. It uses
`flow-agents kit run aidlc` and `kontour-aidlc`; it does not invoke or replace the
AWS `aidlc` executable on your machine. Method representation, runtime behavior,
and independently measured output quality are separate claims.

## Prepare your environment

Install Node.js 24 and a supported coding-engine CLI. Sign in through that
engine's normal login flow and verify access to the exact model you intend to
use. Provider login is separate from GitHub access needed to install the Kit.

The engine creates and owns its login state. Depending on the engine and its
configuration, it may use a private file, an OS keyring, or provider-specific
configuration. Kit installation does not create, copy, or renew those sessions.
Native execution uses the existing login on that machine. Datum is optional;
use it for supported portable provider/secret references, not as an assumed
replacement for every engine's native OAuth session.

Keep three locations separate:

| Location | Contents |
| --- | --- |
| Application workspace | Your project and the generated `.aidlc` artifacts. |
| Bootstrap directory | Installed public packages and the registered Kit. |
| Private controller | Decisions, execution receipts, checkpoints, and host authority state. |

The bootstrap and controller must be outside the application workspace. Use
absolute paths and select or create the application directory before setup.
The following example leaves application dependencies alone:

```sh
aidlc_project_dir=/absolute/path/to/project
aidlc_host_dir=/absolute/path/to/aidlc-host
mkdir -p "$aidlc_project_dir" "$aidlc_host_dir/bootstrap" "$aidlc_host_dir/controller"
chmod 700 "$aidlc_host_dir/controller"
cd "$aidlc_host_dir/bootstrap"
npm init -y
npm install --save-exact 'github:kontourai/aidlc-kit#QUALIFIED_KIT_COMMIT'
npx flow-agents kit install ./node_modules/@kontourai/aidlc-kit --dest "$PWD"
```

Replace `QUALIFIED_KIT_COMMIT` with the exact Kit revision you intend to use.
The Kit pins its public runtime dependencies. Keep using the CLI installed in
this bootstrap directory for this run.

## Start a small native run

For new work, create `parameters.json` in the bootstrap directory:

```json
{"profile":"poc","project_type":"greenfield"}
```

Choose the profile and project classification to match the actual task. The
profile selects stages and defaults; it is not a promise that every engine,
account, or optional topology has been qualified live. See the
[methodology](methodology.md) and [capability ledger](parity.json).

For example, with an already configured OpenCode provider/model:

```sh
npx flow-agents kit setup aidlc --dest "$PWD" \
  --workspace "$aidlc_project_dir" \
  --controller-root "$aidlc_host_dir/controller" \
  --engine opencode --model PROVIDER/MODEL --auth native \
  --isolation trusted-host --allow-host-execution \
  --parameters-file parameters.json \
  --prompt "Describe the concrete change and acceptance criteria here" \
  --max-turns 32 --max-provider-requests 128 --timeout-s 3600 \
  --output "$aidlc_host_dir/request.json"
npx flow-agents kit doctor --request "$aidlc_host_dir/request.json"
npx flow-agents kit run aidlc --dest "$PWD" \
  --request "$aidlc_host_dir/request.json" \
  --controller-root "$aidlc_host_dir/controller"
```

Replace `PROVIDER/MODEL` with a model identifier available to your authenticated
engine. The example budgets are a small-run choice, not a sufficient budget
for every full profile. Operator pauses consume the same deadline.

Doctor checks preconditions. A successful configuration or engine-installed
check does not establish account access or completion. Read its individual
results and the actual execution result.

Native mode explicitly permits host tool use. It has no OS filesystem or
credential confinement, and native engines' internal provider requests are not
enforced by the configured request count. For the isolated Codex worker and
broker, use the separate [Docker setup](environment-setup.md#isolated-codex-setup).
That path needs Docker, an immutable prepared image, and a supported host
credential source; a keyring-only login is not automatically a broker auth file.

## Handle a stopped run

The default operator policy grants no approvals automatically. A run may stop
for a questionnaire, assumption confirmation, review disposition, plan,
operation, or other declared subject. Read the actual pending document and its
referenced artifacts before deciding.

Use the installed Kit's decision CLI, not a source checkout's helper:

```sh
npx kontour-aidlc decisions --controller-root "$aidlc_host_dir/controller"
npx kontour-aidlc decide --controller-root "$aidlc_host_dir/controller" \
  --pending /absolute/path/to/the/current/pending.json \
  --reference "operator:what-you-actually-read" --decision approve
```

The approval command is an example for an appropriate approval subject. A
questionnaire needs its typed answer disposition, and a review requesting
changes needs its current findings and revision instructions. Follow
[questionnaire replies](questionnaire-replies.md) and
[review revisions](review-revisions.md) for those concrete formats. Review
approval and input confirmation can be separate decisions; one does not imply
the other.

Revision authors and their distinct reviewers receive verified prior own-artifact
bytes through [read-only history inputs](execution.md#prior-own-artifacts-during-revisions).
These support exact comparison; they are not current outputs or approvals.

The CLI signs the decision automatically against the current run, stage,
source and artifact subject. This binds what was approved and rejects stale or
wrong-subject decisions. It is not a separate manual signing step and does not
authenticate a human merely because the operator supplies a reference. An AI
engineering operator should identify itself accordingly.

After deciding, run the same `kit run` command with the same request and
controller. Let Flow perform advancement or a route back. Preserve failures
and original receipts; do not edit signed state or reset the budget to resume.
Use the ordinary [input revision](input-revisions.md) or
[recomposition](recomposition.md) interfaces when the authorized scope changes.

## Read the result

Inspect the canonical workflow status, current gate evidence, execution
receipts, actual check results, and artifacts. A completed model process does
not by itself mean the workflow completed. Structural artifact completeness
and passing project tests do not establish independent semantic correctness.
Missing provider identity, token usage, cost or account evidence remain
unavailable rather than inferred.

Keep the request, controller and resulting artifacts together as a run's
evidence. For a failed or exhausted trial, retain that result. A separately
authorized new trial needs its own request/controller and must not borrow a
previous run's completion or approvals.

## Common next steps

- Expose installed guidance in your IDE with optional `kit activate`; see
  [environment setup](environment-setup.md). Activation is separate from live
  execution and IDE qualification.
- Register real repository checks and testing posture; see
  [execution](execution.md#host-testing-posture-and-code-plan-authority).
- Use actual operation commands and explicit authority for deployment. A
  local-only task does not authorize a deployment, and an unconfigured
  operation is not a successful no-op.
- For a dead controller owner, follow the bounded
  [recovery procedure](review-revisions.md). Keep live or unsettled custody
  intact.
- For engine-specific login, Datum references, Docker workers and measured
  qualification limits, use [environment setup](environment-setup.md).

## Maintainer references

[Execution contracts](execution.md), [CLI reference](reference.md), and
[methodology](methodology.md) explain the implementation boundaries. The
compiler/conformance checks measure representation; independent Evals results
measure the frozen cases and their declared limitations. Neither should be
presented as universal runtime equivalence or superiority.

## Check observations

AWS names its deterministic checks “sensors”; those names remain in the pinned
methodology and wire contracts. AI-DLC adapters own required sections, upstream
coverage, traceability, claim-source structure, linting and type checks. Their
common result plumbing comes from the dependency-free
`@kontourai/plumb/checks` API, also consumed by Veritas.

Each observation records an actual stage artifact-set digest, file SHA-256
references, findings and `pass`, `fail`, `not_verified` or `not_applicable`.
The kit re-reads observed files before accepting results. Missing captures,
malformed diagnostics and stale bytes cannot pass. An actual command failure
remains failed when stderr is empty. Only the kit's actual file applicability
assessment permits a lint or type check to be inapplicable. A stage declaring no
checks retains that explicit upstream contract; it does not manufacture a check.

These structural observations do not establish semantic correctness, human
approval or Veritas readiness. Surface derives trust evidence and Flow enforces
the gate. Veritas retains its own repository standards and evaluation policy;
shared plumbing does not move those rules into AI-DLC.

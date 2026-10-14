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
| Survey | Optional artifact review UI, persisted decisions and MCP App over the host-owned current queue. |
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

<a id="inspect-the-current-requirements-review"></a>

## Inspect the current artifact review

A host preparing a Survey session can inspect a current produced-artifact review
without recording a decision:

```sh
kontour-aidlc inspect-review --controller-root /private/controller \
  --pending /private/controller/authority/pending/current-review.json
```

This local interface handles signed produced-artifact review dispositions for a single current stage/unit, including intent, requirements and design. It
refuses questionnaire/input confirmation. It uses the same signed pending-request
binding as the decision writer, verifies the current Flow visit and sealed review
checkpoint, and reads the exact current artifact bytes. It also requires the
retained admitted request and settled executor history, preserves the original
worker limit and wall-clock deadline, and refuses stale, expired, drifted or
unsettled observations. The output includes artifact text/digests and remaining
worker count/deadline; native upstream provider-request usage is not inferred.

Inspection holds the controller lock, writes no approval and advances no gate.
The output also identifies the current stage/unit and observed review findings.

A consumer must re-admit the current subject before application. The optional [Survey decision interface](#optional-local-survey-decisions)
provides presentation and admitted decision application for this subject. Inspection
alone establishes neither human approval nor semantic correctness.

<a id="optional-survey-requirements-decisions"></a>

## Optional local Survey decisions

Use the native Flow Agents review host with this installed kit. It opens Survey
and manages the browser/MCP transport; AI-DLC supplies the current artifact
queue and signed decision admission. Write a private review request using the
current pending file and absolute paths:

```json
{
  "schema": "kontour.kit.review_request",
  "version": "1.0",
  "kit_id": "aidlc",
  "input": {
    "controllerRoot": "/private/controller",
    "pendingFile": "/private/controller/authority/pending/current-review.json",
    "reference": "Local operator artifact review"
  }
}
```

```sh
flow-agents kit review aidlc --dest /absolute/aidlc-bootstrap \
  --request /private/artifact-review-request.json
```

Flow Agents 8.1.0 exposes `kit review`, and the installed kit manifest
must declare the `kontour.kit.review_request@1.0` producer. New use should select
this native host. The contextual interface described below also requires a host
that forwards the producer's `presentation`; use the runtime pinned by this kit.
The previous `kontour-aidlc review` command remains a
compatibility interface for existing consumers. Other typed decisions still use
their existing controller formats; visual artifact review does not answer a
questionnaire.

Use the current pending file returned by the stopped controller. The command
prints a loopback URL and private `sessionPath`. Open that URL to inspect the
actual artifact text, source paths and SHA-256 references. The queue shows the
original deadline and remaining worker slots. It does not renew the deadline.

The review summary shows why the run is waiting, the current unit, observed
findings and dissent, and the original deadline and remaining worker slots.
Artifact cards use short filenames; their exact source paths, SHA-256 references
and bytes remain available for inspection.

Read each artifact and select **Mark reviewed**. This acknowledges inspection;
it does not approve the artifacts. Under **Your decision**, select **Approve**,
**Request changes** or **Decline**, and enter a correction note for Request
changes. **Could not confirm** remains available with a reason. Then use the
single **Send review to workflow** button. Submission waits for all items to be
decided and their events to be saved:

| Action | Controller effect |
| --- | --- |
| Approve | Records approval for the exact current artifact basis. Open findings or judgment dissent still require the existing explicit disposition policy. |
| Decline | Records denial; the artifacts remain unapproved. |
| Request changes | Requires a correction note. Retains a deterministic operator concern and the original review; a new author and distinct review must fit the existing worker/revision budgets. |
| Could not confirm | Requires a reason and retains signed feedback. It supplies no approval or denial. |

Artifact acceptance in the workbench is distinct from questionnaire answers.
This interface handles produced-artifact review dispositions and refuses
input-confirmation subjects. Artifacts are read-only; edits become correction
requests rather than writes to canonical model outputs.

The same private session can be inspected and updated by Survey's MCP server,
including its embedded MCP App on compatible hosts:

```sh
npx --yes --package=@kontourai/survey@8.2.0 survey-review-mcp \
  --session /private/controller/survey-reviews/current-session.json
```

The MCP tools record review events. Application stays with the host's console
callback. The native host rechecks installed kit integrity, and the AI-DLC
producer rechecks the signed request, current Flow visit, artifact/source
bytes and original execution history before recording a decision under the
controller lock. Stale, expired, forged or competing submissions refuse.
A retained signed receipt makes a retry recover the first decision rather than
write another. The recorded result remains visible after reloading the console.
After submission, return to the terminal and continue the original request with
the same bootstrap and controller root:

```sh
flow-agents kit run aidlc --dest /absolute/aidlc-bootstrap \
  --request /private/original-execution-request.json \
  --controller-root /private/controller
```

This console records the decision; the run command consumes it and resumes
through Flow. The console does not execute a model or restart the run.

Local browser/MCP interactions are **host-observed operator interactions**.
A reference string or session actor name does not authenticate a person. An
application requiring personally authenticated human review must provide that
identity and authorization through its trusted host; this local adapter does
not claim it. Command-line/native/Docker execution continues to work with no
mandatory kit-local Survey interface. The native Flow Agents host owns its
Survey dependency; existing standalone compatibility hosting still needs the
optional Survey peer.

## Compose repository governance with AI-DLC

AI-DLC controls the selected development ceremony. The Veritas Governance Kit
controls repository standards and readiness. Adopt the Governance Kit separately
through Flow Agents and use Veritas's canonical readiness bundle when your flow
requires repository governance. An AI-DLC structural check does not satisfy an
unrelated repository standard, and a standards-plan approval is not an AI-DLC
questionnaire reply or artifact approval.

Both kits consume Plumb check observations while retaining their own adapter
semantics. AI-DLC binds its observation to the stage artifact set; Veritas's
shared command observation binds to a check definition and retains execution
identity. That definition digest must not be described as a source-tree digest.
Veritas's full readiness evaluation owns its own source/freshness policy.

For a paused Flow gate, Flow Agents already exposes review-work discovery,
queue construction, `createSurveyFlowGateAdapter`, and
`continuePausedFlowGateFromSurvey`. The host provides the current producer-owned
queue, resolver, expected run head and continuation authority. Reuse these ports
when embedding Survey in a general workflow. An AI-DLC active operator checkpoint
is handled by this kit's signed controller protocol; it must not be passed to a
paused-gate adapter merely because its UI looks similar.

Survey's browser, CLI and embedded MCP App are presentation transports over the
same producer queue. Survey event persistence is separate from host application,
Flow advancement, human authentication and independent output grading. Choose the
transport your host supports and preserve those contracts across it.

## Native review producer contract

`kit.json` declares `review.module`, `review.export`, and
`kontour.kit.review_request@1.0`. The producer validates its domain input and
returns the private Survey session path, immutable queue binding and host-only
application callback. Flow Agents loads only the integrity-bound installed
producer and refuses a changed installation before applying. It never takes an
application callback or authority assertion from JSON, browser state or MCP.

The AI-DLC producer retains its signed current pending subject, Flow visit,
artifact/source checks and original worker/deadline budget. This local producer
rejects authenticated-host resolver capabilities it does not support rather
than recording a human identity claim. Native hosting changes how a review is
opened, not the scope of its authority or what can advance the workflow.

The native host supplies the public Survey queue-binding and event-derivation
methods as `services.survey`. This in-memory capability comes from its own
installed dependency, so a Git-installed producer does not need a redundant
kit-local Survey installation. It is not accepted from JSON or used as human
identity. Standalone compatibility hosting retains its optional peer.

The compatibility review command delegates its server lifecycle to the same public Flow Agents `serveSurveyReview` host. Survey 8.1.1 closes active event streams when the review server shuts down; a browser may remain open.

Survey 8.2.0 supports the optional display-only `presentation` data returned
by the producer. Survey
renders its queue title, visible review context, artifact acknowledgments and
action labels; Flow Agents passes those hints to its native host. Canonical
ReviewItems, candidate IDs, artifact bytes and signed admission rules remain the
decision basis. The AI-DLC controller seals its presentation alongside that
basis so editing the retained context cannot create a different producer review.


## Local review scope and priorities

Use the local interface when you need to resolve an existing produced-artifact
proposal: an intent statement, requirements, or a design. It presents exact
current documents (including their sources and proposed assumptions), observed
findings, prior operator concerns and dissent. Document acknowledgement records
inspection; the separate decision records approval, decline or requested changes.
An open finding still blocks ordinary approval. Request changes carries all
current open finding IDs and your correction note through the existing signed
controller, then requires a fresh author/current distinct review and another
local decision. Merely inspecting a finding does not resolve it.

Survey owns candidate presentation, notes, decisions and session replay. The
AI-DLC adapter maps that reusable contract to its current domain proposal; Flow
Agents hosts it and checks installed provenance, and Flow owns advancement. This
uses Survey's existing producer-neutral resources. It adds no review checkpoint
to the selected methodology and grants no model execution or deployment itself.

Local use needs no reviewer login. The persisted record describes a local
operator interaction with the exact artifact basis. Optional authenticated-host
work and larger comparative benchmarks are deferred. They are not prerequisites
for local kit use. Existing provider/engine sign-in remains necessary for model
execution and is separate from local review.

Ordinary questions and mandatory assumption/input confirmations stay on the
signed CLI input path; this interface cannot answer them by approving an artifact.
A stage can therefore consume this artifact decision and then ask for its existing
input confirmation. Multi-unit aggregate review also stays on the signed CLI;
this slice admits one current unit. Inline changes become explicit correction
requests, and original deadlines/revision limits remain in force. Expand the UI
further when actual local usage shows another awkward decision point.

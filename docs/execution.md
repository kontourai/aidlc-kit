# Execution and evidence boundaries

Flow owns the canonical run, gate evaluations, route-back and retry budgets. Flow Agents owns kit bindings, skills and host execution. Veritas owns repo requirements and repository readiness. Surface derives evidence/trust state. This kit never writes canonical Flow state or changes protected Veritas standards.

Each stage skill reads its pinned procedure and artifact contract from `upstream/snapshot.json`. These procedures contain upstream harness commands; those are reference data, not executable Kontour instructions. Follow their substantive work with the host's supported tools, keeping the active Flow stage and scope authoritative.

## Artifacts

Maintain a run-owned artifact index with `{id,stage,path}` entries. Artifact ids are the upstream vocabulary; stage identity disambiguates producers. `observeStage` reads bounded workspace-local files and reports missing/empty/unreadable required outputs plus applicable upstream inputs. `inspectBasis` rechecks exact bytes. `projectInvalidation` projects direct and transitive staleness from receipts without introducing a second mutable run state.

These functions provide structural observations only. `semantic_status` and unexecuted sensors remain `not_verified`. Do not turn structural success into the compiled completion claim, which also demands applicable checks. An adapter must run those checks, preserve their actual verdicts, publish revision- and subject-bound evidence through Surface, attach it through Flow/Flow Agents, then let Flow evaluate the gate.

The lifecycle conductor reobserves artifact bytes before each gate visit and submits direct/transitive invalidations through Surface and Flow. Completed off-cursor reappraisal exposed a defect in published Flow 5.1.3; the installed-package integration regressions now consume the released Flow 5.1.4 repair. Independent branches retain their current evidence.

## Review, human decisions and operations

The compiled review expectation represents a current review. A distinct reviewer must record the real outcome through an evidence producer; a skill role declaration does not authenticate a review or prove the skill executed. Preserve findings and their dispositions through existing critique records.

Human decisions and approval in the source procedure require the host's trusted decision channel and exact artifact/source basis. A completion claim cannot substitute for a human approval. The dispatch adapter executes inline, ordered pipeline, blind contributor/integration and bounded mob dialogue topologies. Unit DAGs use real Flow multi-cursor claims, leases and canonical joins. Host-owned workers publish successful authorized fork changes after checking the canonical source basis. Independent review runs in a separate read-only worker. When later source-writing units make earlier reviews stale, a fresh child Flow captures new independent reviews against the final whole-source basis; earlier unit completions remain historical. The fresh current canonical join is mandatory before parent acceptance. Operator-policy receipts are explicitly labelled policy decisions; they are not human signatures. Intent answers and assumptions require an operator-supplied exact artifact confirmation, and planning approval requires every plan and test-instruction artifact.

Source-writing stages beyond the pinned code-generation marker require explicit `source_write_stages` selection and a current signed `source-change` operator-policy grant. Deployment and operation stages require actual environment/provider adapters and existing user authorization. Do not deploy because a stage is selected. Veritas checks are invoked through its public CLI and recorded artifacts; the kit does not reevaluate Repo Standards. Learning outputs may be captured through Knowledge Kit's public operations after their real source and decision exist.

## What the tests prove

The public conformance eval installs no aliases and imports the declared published Flow/Surface packages. Synthetic fixtures demonstrate gate behavior for successful, missing, failed, stale, wrong-subject and tampered evidence. They do not prove that agents produce good artifacts, approvals are authentic, deployments work, or Kontour outperforms AWS. Paired runs and independent Evals grading must supply those observations.

## Installed execution and measurement

`flow-agents kit run aidlc --dest <installed-workspace> --request <private-request.json> --controller-root <private-directory> --auth-file <host-auth.json>` executes the integrity-bound installed entry with `kontour.kit.execution_request@1.0`. Evals adapts its measurement request to this same public entry. AWS execution is owned by Evals' native AWS adapter; it is never routed through this controller.

The request pins treatment bytes, model/provider/harness, a Docker image and finite turn/time budgets. The kit imports the public Flow Agents Docker worker and scoped provider broker; its request does not name an Evals helper. Workers receive isolated workspace forks, read-only treatment bytes and their specific context. The controller, hidden grading oracle and long-lived provider credentials stay outside workers. Applicable required sensors must pass; missing or malformed checks refuse the gate. Build/test commands execute in separate check containers and preserve real command receipts. A planned test command that cannot be parsed as one safe test invocation fails the build-and-test gate with the parse reason; it never aborts the adapter and never passes silently.

The registered `storage_budget` (`max_bytes`, `max_entries`, `max_file_bytes`, `min_free_bytes`, optional absolute `roots`) is enforced by a durable host ledger inside the executor, not by worker self-reporting: every published source change and returned artifact is charged against the shared byte/entry budgets before any canonical byte is written, per-file caps and the free-space floor are checked, and publication outside declared roots (canonicalized before comparison) is refused. Budget exhaustion ends the run as `budget_exhausted` — whether the refusal throws through dispatch or is returned as a blocked dispatch outcome — and publishes nothing.

Unit source custody follows the authoritative unit manifest. The runtime currently restores every unit with `source/workspace` custody (scheduler-serialized, workspace-wide), so the path jail below is forward-looking: a unit manifest that declares explicit resource scopes is confined to those path prefixes (`unit_scope` refusal), and `*` behaves like `source/workspace`. The `stage` pseudo-unit is not jailed by unit resources; its source writes remain governed by stage-level authority (`workspace_requires` or a signed `source_write_stages` grant). The frozen dispatch request carries the unit's `mutable_resources`; controller state written before that field existed is not resume-compatible (no registered runs predate it).

Execution receipts, source publication, Flow observations and operator policy signatures are host-owned. The model supplies artifacts, findings and a final execution status. A model-created approval, identity or gate status is rejected. Failed execution cannot publish its edits. Rotating provider access capabilities do not alter the bound experiment identity; source, seeds, definition and policy do.

Mob judgment dissent is an unresolved objection to shipping: a `review-disposition` grant never accepts it implicitly, regardless of finding severities. Only an operator policy that explicitly sets `review_disposition.accept_judgment_dissent` may accept it — preregistered in the original request binding, since a changed policy changes the binding and cannot resume a bound run. The acceptance is recorded in the signed receipt payload only when judgment dissent was actually present, and the full decided input is durably stored beside every receipt for audit. Without that acceptance the run ends `waiting` (held at `awaiting_decision`), never completed; an undispositioned advisory review holds the same way.

Native ceremony settings are resolved from the selected profile plus validated `parameters.ceremony` overrides. The resolved settings are bound by the request digest and retained in every stage record. `review_cap` lowers each declared review class (none removes its compiled review expectation; advisory runs one distinct reviewer and requires an explicit disposition). `collaborators` off collapses pipeline/mob execution to the lead. `sensors` off produces an explicit `disabled` observation under the registered policy, never a sensor PASS; structural artifact obligations and actual planned build/tests still run. `summary_confirmation` prepares only the stage's question artifacts before substantive generation and requires operator-supplied exact-byte confirmation through `summary-confirmation` authority. Workers must preserve those confirmed bytes. `plan_approval` retains its separate code-plan authority checkpoint.

`learnings` bootstraps an advisory stage diary on first showing, delivers the learning protocol to the worker, and optionally captures real diary bytes through the host `knowledge.capture` port, which must return a durable reference. It does not create synthetic Knowledge Kit records. `skeleton` on composes dependency-ordered child Flows: each unit traverses the complete contiguous per-unit construction block before the next unit starts. The first completed Bolt requires a signed `skeleton-checkpoint` on its exact artifacts and source before the next is admitted. Parent gates are evaluated sequentially only after canonical child completion; declared reviewers run fresh independent reviews against the final whole-source basis. This is reusable methodology composition through public Flow, with no Evals arm/case routing.

Guard policy is resolved and recorded, but Kontour deliberately retains current-evidence custody for strict, relaxed and off. Pinned AWS relaxed/off may keep a review whose source cannot be read or whose reviewed bytes changed. That behavior cannot satisfy Kontour's public current-evidence contract. Explicitly disabling review/sensors changes the selected obligations; it never authenticates stale evidence or a model-created approval.

The normal operator decision inbox stores denied exact requests as host-signed files under the private controller's `authority/pending/`. `recordControllerDecision` records an explicit operator approval reference against that signed input, without changing the registered request or policy. Restarted authority reads the signed decision and authorizes only the same request, source/artifact basis and purpose. These are host-observed operator interaction receipts, not human signatures. Unsigned or altered pending files fail verification; unresolved judgment dissent and open findings require explicit per-concern disposition. Model workers never receive the controller key or inbox.

Operation stages require both registered deployment/operation authority and a trusted host `operationProvider` with `execute(input,{signal})` and `verify(receipt,input)` ports. The input binds the stage, workspace, source digest, request and authority. Missing ports produce `operation_provider_required`; failed or unauthenticated receipts produce `operation_not_verified`. The receipt is retained on the stage record. Provider configuration does not itself authorize deployment.

Component/subprocess tests are implementation evidence. Real provider execution, method fidelity, output quality and superiority are separate observations from the independent paired experiment. No completion or structural claim means semantic correctness.

## Optional source-write guard

Pinned AWS source executable sensor resolution is stage-scoped, despite older procedure prose describing checks on every write. The default preserves that executable behavior. An explicitly registered `write_sensor_policy: "all_actual_source_writes"` also checks actual source writes against the pinned extension matchers. Those additional checks identify their trigger as Kontour policy and count as a declared treatment difference. They cannot be claimed AWS parity or silently change a registered experiment.

The included command operation provider accepts ordinary operator configuration `{stages:{<stage>:{argv:[<executable>,...],outputs:[<workspace-relative-file>],timeout_ms}}}`. The default command runner uses the actual admitted workspace, retains real exit/output receipts and bounds process-group lifetime. No shell interpolation or model-created command is used. Attempt records prevent automatic repeated operations on the same registration. Learning capture retains immutable source/decision provenance and explicitly reports Knowledge Kit adoption as `not_imported` until a separate public import occurs.

## Host testing posture and code-plan authority

The host resolves the pinned AWS Testing Posture method before dispatch, from registered `parameters.testing_policy` workspace-relative `org`, `team` and `project` memory paths. Unconfigured layers observe `.aidlc/memory/<layer>.md`; absent files are explicitly part of the policy basis. Only a real `## Testing Posture` section contributes. Project takes precedence over team, then org; the pinned team/project specialization conflict rule and additive notes are preserved. Without a classified policy the upstream fallback is `test-after`. `parameters.test_strategy` defaults to `standard`, independently of profile depth, and combines with the selected scope floor. Greenfield and brownfield runner prerequisites differ exactly as the pinned method defines them.

The literal host-rendered `## Testing Contract` JSON is in the worker's authoritative brief. Planning completes before implementation even when the registered plan-approval ceremony is off. The host may append its generated contract to a nonempty proposed plan; that transformation retains the original worker observation and explicit before/after artifact hashes. A supplied conflicting, malformed or altered contract is refused rather than replaced. Approval binds the exact plan and test-instruction bytes, executable unit-scoped commands, contract/policy hashes and planned source. Implementation receives and must preserve that approved basis.

The policy binding records exact source-file bytes and absences, method revision, scope, test strategy and project type. Policy files cannot be changed by source-publishing workers. The host checks that policy before approval and source publication; a policy or scope change requires a new current contract and approval. Ordinary implementation source changes do not themselves change testing posture. These checks prove custody and faithful contract resolution, not that the implementation obeys every semantic testing obligation or that its tests are effective. Actual execution and independent evaluation remain separate evidence.

`testing-posture-upstream.mjs` ports the pure resolver/classifier/obligation/plan-profile functions from AWS commit `2a555f7a4387cd1b8254029cccb9fd1e99974574` under its MIT-0 license. It contains no upstream harness, state mutation or engine commands.

## Per-unit construction checkpoints

Following pinned AWS initialization, selecting Units plus a per-unit source-producing construction stage enables serial, unit-major checkpoints by default, including profiles whose skeleton is off. `parameters.construction_checkpoints` may explicitly register `enabled` and `verification_command` (argv or operator-supplied shell text). The command is a host operation; workers cannot propose their own passing receipt. Missing command selection or authority leaves a normal signed pending decision. The operator may choose the command through the existing decision inbox's `disposition.verification_command`, without changing the bound request.

Every complete child Flow requires a real successful authorized verification command and unchanged evidence, followed by a distinct `construction-checkpoint` approval bound to its command receipt, source/artifact basis and Testing Contract. A skeleton first unit retains its additional `skeleton-checkpoint` authority. The next unit cannot start before the preceding checkpoint is approved. Actual command receipts must bind command, identity, exit code and timeout/signal state; absent, failed, changed or mismatched proof refuses completion. Attempt records are written before execution, and failed or interrupted commands cannot silently restart under the same registration.

Completed child publications retain actual before/after source-file digests, including deletion tombstones. Resume checks the entire canonical source against the initial basis plus the ordered, canonically completed child-publication chain. This permits authorized later units to change shared files without rerunning earlier work. Unknown edits, additions, deletions, broken source transitions and altered checkpoint receipts refuse replay. Earlier accepted checkpoints remain labelled historical; they do not become reviews of later source. Declared final reviewers still evaluate the current complete source independently before parent acceptance.

### Per-run profile composition

The ordinary installed-kit request accepts `parameters.composition` alongside
`parameters.profile`, for example:

```json
{"profile":"poc","composition":{"name":"discovery","add":["market-research"],"skip":[],"strict_inputs":false}}
```

`name` is a bounded lowercase slug. `add` and `skip` are unique pinned stage
identities; unknown stages, overlapping changes, already-selected additions,
unselected skips, initialization skips and dependency cycles are rejected.
Only the installed 33-stage methodology inventory is executable. No custom
stage code or runtime is loaded. Dependencies determine a stable order with
pinned stage order as the tie breaker. Greenfield excludes Reverse Engineering.
The base defaults and testing scope are inherited; composition without an
explicit base uses Classic, matching upstream custom creation. Ordinary
requests without composition retain Feature as their default.

As in upstream plan creation, required artifacts with producers outside the
selected path are retained as explicit advisories in the composition proposal;
missing graph producers are errors. `strict_inputs: true` applies upstream
recompose-style refusal when a required producer is absent. Runtime omissions
cannot bypass that stricter check. Selected producers still supply real,
current artifact bytes through the existing lineage machinery.

Before starting the canonical Flow, `profile-composition` authority approves
the exact request, compiled definition, ceremony, testing policy/contract and
source basis. An unapproved proposal returns `waiting` with the normal signed
pending decision; the existing `aidlc` decision command approves and resumes
it. A registered operator policy may explicitly include this purpose. It is
host policy or an observed operator interaction, never a fabricated human
signature. Composition approval does not approve input answers, source writes,
code plans or deployment. Durable resume verifies the retained approval and
refuses altered proposals or definition bindings. Changing pending stages of a
running plan requires a separately bound live recomposition decision.

Live pending-stage add/skip uses the ordinary signed operator inbox and canonical Flow amendment ledger; see [recomposition.md](recomposition.md). The original request and provider budgets are retained.

## Resuming across operator decisions

Summary questions, intent outputs, code plans, and observed author/reviewer phases retain their signed dispatch checkpoints across ordinary operator waits. Resume verifies the signed host checkpoint and current source/artifact basis before reusing the producer output; changed inputs require a new exact decision. The shared checkpoint binding includes canonical gate retry/reentry history; a new rejected gate visit reruns the producer even when failure text and artifacts are unchanged. Review-disposition resume binds the observed post-author source and retained pre-author authorization, without rerunning an already reviewed producer. Unit completion still uses public Flow claims, settlement and join. These checkpoint signatures record host observation and do not constitute human approval.

Dependent unit dispatch resumes from a host-verified observed outcome after each exact review disposition. Accepted upstream units retain their original actor identities and receipts, and public Flow settlement admits newly ready downstream units. A downstream reviewer outcome requires its own current decision; an upstream approval never covers a worker that had not run. Cumulative stage and provider budgets remain in force across waits.

When an admitted later unit publishes source, its host-observed before/after source digests and author receipt form a retained publication lineage. An earlier completed unit stays historical: its old source digest and review are never rebased. Resume admits that history only when its artifacts remain exact and the current source matches the observed lineage. Current integration acceptance uses new independent final-source reviews and a fresh canonical Flow join. An external source or artifact change refuses the retained approval.

Mob judgment waits retain the exact continuation phase and execution receipts. Accepting a contribution or dialogue objection resumes the remaining dialogue/integration and the declared reviewer; it never substitutes for hard review or a later advisory disposition. Previously executed authors and collaborators retain their identities and receipts.

Actual questionnaire answers, Edit File replies, and mandatory pre-review intent assumption decisions use the existing signed operator inbox. See [questionnaire-replies.md](questionnaire-replies.md) for the exact response contract and bounded follow-up cycle.

Advisory review corrections use the ordinary signed `decide --disposition` path; see [review-revisions.md](review-revisions.md) for bounded author revision, fresh review and explicit controller recovery.

Construction uses stage-level artifacts when the approved effective plan omits Units Generation and that producer has never completed. This matches the pinned AWS `usesStageLevelPerUnitArtifacts` rule, including stock POC and infra profiles with skeleton enabled. Such a plan uses ordinary stage Flow gates rather than a fabricated Unit DAG or unit-major skeleton walk. A selected or previously completed Units producer still requires its current approved DAG, even after recomposition skips the producer or invalidates its artifacts.

When a canonical gate reentry revises a stage's own outputs, a fresh reviewer consumes the new host-observed author publication. Historical same-stage output references are superseded only for a matching declared output ID/path/unit with a signed successful publication, matching frozen review basis and current bytes. The prompt and execution observation retain the prior/current lineage and author receipt. Foreign upstream inputs and approved plans/questions remain immutable; a stale or unproved reference still refuses worker admission. This does not turn an earlier review into acceptance of changed bytes.

Repair feedback is retained in a host-sealed checkpoint for the exact canonical gate retry/visit, request, stage and source basis. Its actual failed Flow evidence and original observation digest are verified again on resume. A questionnaire or review wait does not erase or silently replace that feedback. New visits use newly observed diagnostics; changed source requires matching successful signed author publication before historical rejection facts can be carried to the new source basis. Historical own output references are labelled history rather than current immutable upstream inputs; unrelated stages and peer-unit references remain bound.

Execution results distinguish `turns_started` (actual worker-runner launches, including launched but unsettled work) from `attempts_started` (all durable preparation reservations). Both remain cumulative across restart. Preparation failures spend the same finite attempt budget and cannot be automatically retried; they do not fabricate provider workers or reset elapsed time. Legacy observed workers remain counted, and unobserved launches retain their unavailable receipt boundary.

Per-unit repair inputs apply the same exact identity retirement within that unit's existing visibility scope. Current declared dependency artifacts come from the dispatcher dependency outcome and are copied only with exact host-observed digests; stale, missing-digest or mutated peer inputs refuse work/publication. Learning diaries are declared before input/history projection, so a mutable current diary is not accidentally treated as an immutable old upstream file. Approved plan and questionnaire bases remain separately immutable.

A completed worker process may still produce an invalid planning artifact. The specifically identified Testing Contract heading/JSON shape errors retain a failed host execution receipt with the actual admitted source and output-rejection diagnostic; no artifact or source is published. A later ordinary invocation follows the public canonical gate retry/visit and sees those signed diagnostics, requiring a new author execution and current independent review. The identical execution request cannot be automatically retried. Contract fingerprint/policy substitutions, immutable-input changes, unauthorized source/output paths, native canonical mutation, storage limits, cancellation, budget exhaustion and publication races remain hard custody failures; they are not reclassified as model-shape repair.

## Pinned methodology references

Stage and persona procedures are accompanied by the complete pinned common
protocol/support library under `upstream/references/`. The provenance manifest
binds each source path, exact byte hash and transitive links to the same AWS
commit as the stage snapshot. It includes substantive standards such as the
ASCII diagram rules; generated workspace memory, state and questions remain
actual per-run inputs, never substituted with reference data.

Ordinary author and distinct reviewer contexts receive the same compact
reference index for their stage, roles and profile. Bodies stay in verified
read-only source files rather than being duplicated in every prompt. Docker
workers read the existing `/treatment` source mount; native workers receive
the actual installed Kit path. The host validates the complete closure before
a worker launches and again before publishing results. Native trusted-host
execution still has no OS filesystem confinement; verification rejects changes
and does not claim stronger confinement. Native engine commands in reference
prose remain data and are translated through existing Flow-owned execution.

Reference classification is reviewed for this exact pinned source, not a general
parser for arbitrary future upstream documents. The manifest records each
Markdown mention as shipped support, a declared runtime/project artifact, or
an explicitly classified historical or illustrative example. Unknown normative
core references and explicit static links refuse import; the pinned manifest
hash prevents later source or classification changes from silently borrowing
this qualification. A new upstream import requires review and qualification.

## Prior own artifacts during revisions

Successful author publications retain their exact own-artifact bytes in a
private, bounded version store. A later ordinary revision or canonical reentry
receives verified prior versions at separate read-only history paths, with the
original run, stage, unit, source, author, publication and visit provenance.
Current independent reviewers receive the same historical comparison inputs
used by the revision author. Other stages and units are not exposed through
this channel; existing upstream, peer and approved-input rules still apply.

Historical paths are inputs for comparison and preservation, never current
outputs or approvals. Authors must produce the currently required outputs;
returning only historical references cannot satisfy publication. Declared
optional outputs remain optional. Missing, changed, foreign or unsealed
versions refuse execution or publication instead of reconstructing prior bytes.
Older controllers without retained versions cannot claim this new guarantee.

Archive writes spend the existing cumulative storage allowance. The public
storage inspector counts hidden paths and orphan files, and projected inputs
remain within worker quotas. No turn, attempt or deadline budget is reset.
Native history files are verified before and after work; trusted-host execution
still does not provide OS filesystem or credential confinement.

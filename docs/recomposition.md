# Change pending stages in a running workflow

Live recomposition changes the pending stage grid of an existing run. It does not
change the original request, its selected scope/depth/testing policy, completed
work, current execution contract, or construction walking-skeleton anchor.
Stages remain restricted to the installed pinned methodology inventory.

Use the original request file and the stopped run's private controller directory:

```sh
# Proposal: {"add":["market-research"],"skip":[],"reason":"Include pending market analysis"}
aidlc recompose --request original-request.json --controller-root /private/run --proposal pending-delta.json
aidlc decisions --controller-root /private/run
aidlc decide --controller-root /private/run --pending /private/run/authority/pending/<digest>.json --reference "Owner approved this exact pending plan"
aidlc recompose --request original-request.json --controller-root /private/run --proposal pending-delta.json
aidlc run --request original-request.json --controller-root /private/run --auth-file /private/provider-auth.json
```

Only an actual `decide` interaction may authorize live recomposition. Listing
`live-recomposition` in unattended authority policy does not approve it. To deny
a proposal, use `decide ... --decision deny`; that exact binding stays denied.
Reconsideration needs a fresh proposal binding, for example a changed reason or
an updated source/plan basis. A signed denial permits ordinary execution of the
unchanged plan. An unresolved proposal, including an approved but unapplied or
stale proposal, holds ordinary runtime dispatch with no new worker execution.
Old superseded pending entries may be explicitly denied through the same inbox.

The decision binds the original request and its host-admitted projection,
current source bytes, stage/checkpoint/child records, testing contract, settings,
current effective Flow identity and run head, and the complete successor digest.
If the basis changes before application, a prior approval cannot authorize the
new proposal. Malformed or tampered pending entries and signed decisions refuse
execution rather than disappearing into a regenerated plan.

The host execution lock excludes concurrent kit workers and operator mutations.
The command refuses active durable claims, unsettled child runs, paused or
terminal runs, and unknown child inventory. Stop dispatch and concurrent external
workspace editing before proposing/applying a change. Source observations are
checked at that host boundary; this does not supply an OS filesystem mutation
lock against unrelated host processes.

Required-input checks compare the successor to the actual effective stage grid.
Preexisting stock-profile omissions remain disclosed; only newly introduced
required-input starvation rejects the proposal. Completed producers remain
available. Previously touched stages, their gate/expectation contracts and their
history are frozen. Only the current stage's still-unconsumed forward edge can
change, under Flow's public `pending_forward` amendment contract; consumed edges,
accepted evidence, route-back histories and retry bounds do not reset.

Flow's amendment ledger is the authority for effective stages. The initial
`definition.json` and `binding.json` stay unchanged. Resume verifies the ledger
and the exact signed operator input/receipt, then derives the effective stage
inventory and artifact dependencies. Private `recomposition/` files are checked
caches; after a crash between canonical amendment and cache publication, they
are reconstructed from the verified Flow ledger and retained signed decision.
Missing or changed decision proof is never reconstructed from a model statement.
Provider admission/budget ledgers, worker receipts and prior command records are
retained across amendments.

The CLI records a host-observed operator interaction using the private controller
signing key. It does not prove a personally authenticated human signature.
Source/deployment permissions and review dispositions remain separate decisions.

This path consumes published Flow 5.2.0, Flow Agents 7.0.1, and the public `pending_forward`
compatibility mode. Package tests exercise clean installation and ordinary CLI
proposal, decision, amendment and resume against that public package. Adapter
fixtures remain separate from live model execution and comparative quality.

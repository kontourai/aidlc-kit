# Revising an observed public input

Use the ordinary `kontour-aidlc revise-input` command when an operator changes an already observed public input while execution is stopped at its actual signed wait. This is separate from requesting changes for a review finding. The original request, task prompt, cumulative execution budgets and model receipts remain unchanged.

Supply a bounded JSON proposal with `scope` (`artifact` or `source`), workspace-relative `path`, exact `before_digest`, `after_text`, matching `after_digest` and explicit `reason`. Digests use the kit's SHA-256 hex representation. Artifact scope admits only an accepted observed stage output under `.aidlc/artifacts/`. Source scope admits an existing public source file only when a current accepted source observation covers its bytes. Unknown files, control paths, no changes, active claims, unsettled child runs and unobserved worker settlement are refused.

```sh
kontour-aidlc revise-input --request original-request.json \
  --controller-root /private/controller --pending /private/controller/authority/pending/CURRENT.json \
  --proposal input-revision.json
```

Read the returned signed input-revision subject, then use ordinary `decide` with that pending file and an explicit reference. Approval records permission without changing the public file. Repeat the unchanged `revise-input` command to apply it; denial prevents publication.

The apply command rechecks the current Flow visit, original wait, whole source/artifact inventory and checkpoint basis, then records a signed reservation before replacing the exact file. Publication uses the existing no-follow jail and host controller lock; this is serialized host custody with checks, not an operating-system atomic preimage comparison. The runtime's artifact-validity bridge records invalidated producer and dependent evidence through public Flow APIs and retains unrelated observations. The response reports invalidated stages, deferred rechecks and the actual canonical cursor; invalidation does not itself mean new semantic acceptance.

Resume the same original request. New author and independent review work follows the canonical gate reentry. Explicit signed revisions take precedence over conflicting original task requirements within their declared scope; workers receive their text and provenance as operator input. Earlier author and reviewer receipts remain historical. Repeated revisions retain chronological provenance; the latest settled revision for a path takes precedence over earlier revisions. Old approvals cannot authorize the changed basis.

A crash between reservation and signed settlement refuses further execution and publication. There is no automatic retry, rollback or signed-history repair. `recover-controller` can remove only an otherwise recoverable dead-owner lock; it cannot settle an incomplete input revision. Integrity verification refuses execution if retained authority is lost or a conflicting denial exists; this is not an undo or revocation command. The ordinary CLI refuses stale decisions after application. Start a fresh ordinary trial when this boundary cannot be safely resumed.

Native execution retains its documented weaker isolation and unavailable internal-provider request accounting. No provider execution or deployment is authorized merely by admitting an input revision.

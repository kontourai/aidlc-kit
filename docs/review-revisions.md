# Request changes after an advisory review

Use the ordinary signed decision inbox to request a correction to the current
reviewed work. Supply exact current unit and open finding IDs and the operator's
clarification in a private disposition file:

```json
{
  "review_disposition": {
    "decision": "request_changes",
    "units": [{
      "id": "stage",
      "finding_ids": ["RA-001"],
      "clarification": "The actual correction requested by the operator."
    }]
  }
}
```

```sh
kontour-aidlc decide --controller-root /private/controller \
  --pending /private/controller/authority/pending/<digest>.json \
  --reference "Operator requests correction to these current findings" \
  --disposition /private/correction.json
```

This authorizes revision, not finding acceptance. It preserves the original
request, source permissions, questionnaire answers, claims, receipts and budgets.
The author receives the actual clarification; a new reviewer instance reviews
the revised basis and retains the finding IDs. The new outcome waits for its own
current disposition. Aggregate or unit denial takes precedence over approval.

`parameters.dispatch_policy.maxReviewRevisions` bounds operator revisions per
unit (default 4, maximum 16). The CLI verifies the current canonical visit,
host-sealed record, exact receipts and current artifact/source bytes. Unknown
findings, changed inputs and exhausted budgets refuse before writing a receipt.
The dispatcher independently enforces the same bound. Adversarial review keeps
its original iteration budget.

After the author finishes and the host observes the revised artifacts, a signed
progress checkpoint permits restart at the fresh review. A process crash before
that durable checkpoint refuses automatic author replay if a signed revision
has changed its basis. That earlier interruption window requires a fresh
ordinary run; it does not recover the interrupted run. No history-file edits
or one-off replay code are supported.

A process crash can leave a controller lock. Recovery is explicit:

```sh
kontour-aidlc recover-controller --controller-root /private/controller
```

Recovery only removes a same-host lock whose recorded process is proven dead.
For Docker execution it verifies admitted request/image custody, terminal removed
worker observations, and an empty actual owner-labeled Docker inventory. Missing
Docker access, unsettled workers, legacy locks, live owners, or changed lock
custody refuse. Recovery does not kill processes, remove containers, alter
receipts, or reset budgets. Custom hosts must declare their worker custody when
acquiring the lock; unknown custody refuses recovery. These checks do not claim
an operating-system atomic compare-and-unlink primitive.

## Concerns raised by the operator after a ready review

A ready model review does not prevent the operator from raising a concrete concern about the current source or artifacts. Keep `finding_ids` for actual open model findings; use a separate `operator_concerns` array on the requested unit for new operator observations:

```json
{ "review_disposition": { "decision": "request_changes", "units": [{
  "id": "stage", "finding_ids": [],
  "operator_concerns": [{ "id": "operator:incorrect-summary", "severity": "medium", "reason": "The current summary contradicts the actual observed implementation." }],
  "clarification": "Correct the factual summary using the actual implementation and preserve the existing behavior and quality targets."
}] } }
```

The ordinary signed `decide --disposition` admission binds this concern to the exact current visit, source, artifacts and original author/review receipts. Operator IDs use the `operator:` namespace and cannot collide with current or historical model findings or prior operator concerns. Empty, stale, tampered, denied, unknown model IDs and exhausted requests refuse before new work. These are host-observed operator interactions, not model-reported findings or authenticated personal-human signatures.

The existing bounded revision path runs the normal author and a fresh independent reviewer. The new reviewer must explicitly dispose every operator concern ID on the revised basis; omission refuses completion. The original ready verdict and empty model finding list remain unchanged as historical observations. New current findings retain signed operator provenance separately from the model's observed disposition. A new current advisory decision is still required.

## Repair after structural or check rejection

Required artifact omissions are passed into ordinary reentry as actual structural findings, separately from failed or unavailable sensor checks. A passing sensor does not imply the required artifact inventory passed. Every required path remains required; an inapplicable document needs an evidence-backed assessment under its required structure rather than omission or invented verification. Retained completion is reusable only when structural and applicable sensor checks pass. New observations replace only the exact owned artifact identity; unrelated stages and peer-unit input history remain bound.

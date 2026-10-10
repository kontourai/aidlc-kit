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

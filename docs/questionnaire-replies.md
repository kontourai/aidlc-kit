# Reply to questions through the ordinary operator inbox

`decide --disposition` accepts explicit questionnaire responses. Approval by itself
is not an answer. `decisions` lists the signed pending input, including each
questionnaire document, its stable `answer-N` cells, their headings, and any
previously confirmed answer cells.

```sh
aidlc decisions --controller-root /private/run-controller
aidlc decide --controller-root /private/run-controller \
  --pending /private/run-controller/authority/pending/<digest>.json \
  --reference "Operator answered the exact retained questionnaire" \
  --disposition /private/operator-reply.json
aidlc run --request /private/original-request.json \
  --controller-root /private/run-controller --auth-file /private/provider-auth.json
```

A Chat or Guide Me collection uses this same response file once the required
answers have actually been supplied. Use the current pending input's document
paths and cell IDs; do not copy IDs from a different run or infer a default.

```json
{
  "questionnaire_reply": {
    "version": "1.0",
    "mode": "answers",
    "documents": [
      {
        "path": ".aidlc/artifacts/intent-capture/intent-capture-questions.md",
        "answers": {
          "answer-1": "The actual operator answer",
          "answer-2": "The actual operator confirmation"
        }
      }
    ]
  }
}
```

The initial reply supplies every answer cell, including any proposed value the
model wrote. Model text is not a previously confirmed answer. Later derived
questionnaires identify previously confirmed cells through their signed operator
receipts; only new or explicitly reset cells need answers. Unknown IDs, missing
answers, blank/underscore placeholders, and changed confirmed answers refuse.
Control cells declare their exact allowed values in the signed subject. An assumption or revised-summary control answer must equal one of those full strings; expanded prose, prefixes, and short letters refuse before any decision or host artifact write. Business-answer cells remain free-form.

Answers are bounded single-line text. Question wording, source registers,
options, and all other document text remain protected.

For Edit File, fill only `[Answer]:` cells in the current workspace documents,
then submit the same ordinary decision with this disposition:

```json
{
  "questionnaire_reply": {
    "version": "1.0",
    "mode": "edit-files",
    "documents": [
      {"path": ".aidlc/artifacts/intent-capture/intent-capture-questions.md"}
    ]
  }
}
```

Edited cells hold the original questions producer; resume never regenerates the
questions over operator edits. The CLI verifies the current public Flow step and
retry history, original request, workspace custody, source, question contract,
producer, and current substantive artifact subjects before recording a response.
A signed denial does not publish answers. Source changes, stale visits, modified
question contracts, symlinks, altered receipts, or conflicting edits refuse.

The private controller signs a host-observed operator interaction and the exact
old/new artifact digests. This is not a personally authenticated human signature.
The model worker's original output and receipt stay unchanged and historical.
Host materialization is a separate observation, using the existing publication
jail; it does not claim a kernel filesystem compare-and-swap against unrelated
host processes. Original requests, provider budgets, worker history, and Flow
history remain bound across the response.

## Intent assumptions and follow-ups

The pinned intent procedure requires both intent artifacts to declare
`Assumptions & Open Questions`. When either contains actual unresolved
assumptions, the host derives one `Assumption Confirmation` section listing those
exact observed assumptions. This is mandatory even when optional summary
confirmation is off. The declared reviewer waits for the actual operator reply.

`A. Accept assumptions` retains the assumption labels; acceptance does not turn
an assumption into a fact. `B. Convert to follow-up questions` appends consecutive
Q numbers tied to the observed assumptions and pauses for real answers. Only
then does a bounded `revise-input` author phase revise both artifacts while
preserving the confirmed question text and answers. With summary confirmation
on, the host presents the actual revised artifacts as a new consolidated summary
and requires a fresh `A. Confirm summary` receipt. With it off, that optional
summary is omitted. Remaining assumptions trigger another mandatory confirmation.

`B. Request changes` on the revised summary creates a fresh follow-up asking for
the actual requested changes before another author revision. Neither change
requests nor assumption conversion authorize the model to invent user input.
The normal `dispatch_policy.maxInputRevisions` limit defaults to four and accepts
values 1 through 16. Actual worker/provider budgets and canonical retry history
remain cumulative. Budget exhaustion is retained; it does not imply approval.

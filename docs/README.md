# AI-DLC Reference Kit

Start with [Use the AI-DLC Kit](using-the-kit.md) for tool responsibilities,
authentication, a small native run, operator decisions and result interpretation.

AWS AI-DLC's pinned 33-stage methodology and 11 profiles, expressed through Kontour's existing Flow definitions and Flow Agents kit contracts. This independently installable reference exercises the same extension path available to external kit authors. It is not activated as a default Builder replacement.

The current implementation reproduces profile selection and stage contracts, provides agent stage skills, fingerprints artifact inputs/outputs, projects dependency invalidation, and tests real published Flow/Surface gate behavior. Full AWS runtime equivalence and generated-output effectiveness remain unverified; [parity.json](parity.json) is the explicit capability ledger.

Delivery is tracked by [Flow Agents #1439](https://github.com/kontourai/flow-agents/issues/1439). The program's runtime and output-quality exit criteria remain distinct from this reference's contract tests.

From this kit repository:

```sh
npm test
npm run check
node scripts/compile.mjs --check
node scripts/compare.mjs method
node evals/public-flow-conformance.mjs
flow-agents kit install . --dest /path/to/workspace
flow-agents kit activate --dest /path/to/workspace --format json
```

Kit installation/activation and canonical run startup are different checks. The replica ships one declared Flow Definition per profile. Execute through `flow-agents kit run aidlc --dest /path/to/workspace --request /private/request.json --controller-root /private/controller --auth-file /private/auth.json`. The ordinary request selects its profile through `parameters.profile` and supplies the actual task and bounded execution settings. See the repository README for installation and the request contract.

For a greenfield profile, `compileProfile(snapshot, profile, {projectType:'greenfield'})` omits brownfield reverse engineering. Compile and pin that exact definition before starting a separate run; never overwrite an active run's definition.

## Comparison ground

`evals/corpus.json` freezes two initial inputs and structural artifact rubrics. Record AWS and Kontour outputs separately with the same input digest, model, harness and budget. Each result needs `status`, `identity:{revision,model,harness}`, `budget:{max_tokens}`, `input_digest`, and `artifacts:{path:content}`. Include measured economics or null; missing cost is not zero.

```sh
node scripts/compare.mjs outputs case.json aws-result.json kontour-result.json
```

The comparator checks completeness against a frozen rubric and refuses unbound or incomparable runs. It never infers semantic quality or superiority from artifact shape. Independent semantic grading, experimental assignment and causal effectiveness belong to Evals (Ops #142). Installation does not itself supply paired model evidence.

`scripts/capture-run.mjs` runs an explicitly configured adapter through Flow's public command-capture CLI, collects workspace-local artifacts, and retains the actual command receipt in a separate Flow run. Every expected output must be absent before the command; a rerun cannot borrow leftover output from an earlier run. Use an adapter configuration with `argv`, `identity`, `budget`, and optional `timeout_ms`. A whole argv item `{case_file}` receives the temporary frozen case input path. Adapter identity is configured metadata; the capture proves which command ran, not which provider/model that command secretly used.

```sh
node scripts/capture-run.mjs case.json aws-adapter.json /path/to/aws-workspace aws-result.json
node scripts/capture-run.mjs case.json kontour-adapter.json /path/to/kontour-workspace kontour-result.json
```

See [execution.md](execution.md) for evidence ownership, [methodology.md](methodology.md) for the pinned upstream method, and [parity.json](parity.json) for unsupported behaviors. Re-run the compiler check and conformance suite when updating the upstream snapshot or product package versions.


A kit declares a standard entry in `kit.json`:

```json
{"execution":{"module":"scripts/run.mjs","export":"executeRequestFile","contract":"kontour.kit.execution_request@1.0"}}
```

Use `flow-agents kit run <id> --dest <workspace> --request <request.json> --controller-root <private-root> --auth-file <host-auth.json>`. The public `@kontourai/flow-agents/kit-execution` export exposes the same `executeInstalledKit` operation for host applications. It verifies installed content integrity and kit/request identity before importing the declared function. Installation does not execute setup or install dependencies; install the kit's npm package in the workspace first so its copied entry can resolve its public dependencies. The entry receives `{requestFile,controllerRoot,authFile}` and returns a result with `status`; CLI exits zero for `completed` or `waiting`, otherwise one.

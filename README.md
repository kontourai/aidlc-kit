# AI-DLC Kit

The independently maintained AI-DLC methodology kit for Flow Agents. It uses the same public kit installation, activation, Flow gate and host adapter contracts as any other kit. Upstream methodology and license provenance are frozen under `upstream/`.

Install the Git repository at an immutable revision into an initialized Flow Agents workspace:

```sh
flow-agents kit install https://github.com/kontourai/aidlc-kit.git#<commit> --dest /path/to/workspace
flow-agents kit activate --dest /path/to/workspace --format json
```

The npm package is also a kit repository: unpack its tarball and pass the resulting `package` directory to `flow-agents kit install`. Installation copies a validated repository; it does not fetch or execute npm dependencies. Runtime applications install this package normally to resolve its pinned public Flow and Surface dependencies.

```sh
npm ci
npm run check
npm test
npm run test:package
```

Package-install verification packs this repository and performs a clean npm installation outside its source tree. It validates and activates the installed kit through the public Flow Agents CLI and exercises the packaged public Flow/Surface contracts. Live model equivalence is a separate measurement; no synthetic package check proves effectiveness.

See [execution](docs/execution.md) and [methodology](docs/methodology.md) for controller, authority and evidence boundaries.

For ordinary installed execution, install this repository through npm in the destination workspace, then install and activate that directory as a kit. The kit pins the published Flow Agents 7.0.2 runtime, including its public `/kit-execution`, `/docker-worker` and `/provider-broker` exports. The kit itself is distributed from Git; select an immutable reviewed commit for reproducible installation.

```sh
npm install "git+https://github.com/kontourai/aidlc-kit.git#<reviewed-commit-sha>"
flow-agents kit install node_modules/@kontourai/aidlc-kit --dest .
flow-agents kit activate --dest . --format json
flow-agents kit run aidlc --dest . --request /private/request.json --controller-root /private/run-controller --auth-file /private/codex-auth.json
```

The ordinary request uses `schema: "kontour.kit.execution_request"`, `version: "1.0"`, `kit_id: "aidlc"`, a task `prompt`, `run_id`, absolute model `workspace`, finite `execution` model/turn/time settings, and `engine_sandbox.image` as an immutable Docker image ID. Kit runtime dependencies resolve in the destination workspace; the model workspace is separate. Host prerequisites are Node 24, Docker (Desktop on macOS or Engine on Linux) and Python 3 for descriptor-relative storage inspection. Keep controller state, credentials and hidden grading materials outside worker mounts.

For a Linux host with an incoming firewall, configure `engine_sandbox.provider_broker` with an explicit IP `bind_host` and TCP `port`. The public worker maps `host.docker.internal` to the Docker host gateway on Linux. Permit only the relevant Docker bridge source range to reach that listener; the scoped provider capability remains mandatory. The default uses an ephemeral port, and this configuration never disables or changes the host firewall. Configure reachability before starting a run; a connection failure is retained rather than counted as provider work.

```json
{"engine_sandbox":{"provider_broker":{"bind_host":"172.17.0.1","port":8326}}}
```

Use the actual bridge gateway and an available port on your host. Broker transport settings are part of the run binding; changing them starts a new registration rather than reusing prior approvals or provider quota.

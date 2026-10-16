# AI-DLC Kit

**The pinned AWS AI-DLC methodology, run as a Flow Agents kit with a Flow gate on every stage and Surface evidence.**

[![CI](https://github.com/kontourai/aidlc-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/kontourai/aidlc-kit/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-kontourai.github.io-blue)](https://kontourai.github.io/aidlc-kit/)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

[Documentation](https://kontourai.github.io/aidlc-kit/) · [AI-DLC on Flow](https://kontourai.io/use-cases/aidlc/)

For a practical walkthrough of setup, tool responsibilities and ordinary use,
read [Use the AI-DLC Kit](docs/using-the-kit.md). It includes native setup, signed decisions, native Flow Agents [local Survey review](docs/using-the-kit.md#optional-local-survey-decisions), and [Veritas governance composition](docs/using-the-kit.md#compose-repository-governance-with-ai-dlc).

The independently maintained AI-DLC methodology kit for Flow Agents. It uses the same public kit installation, activation, Flow gate and host adapter contracts as any other kit. Upstream methodology and license provenance are frozen under `upstream/`.

`@kontourai/aidlc-kit` is not published to the npm registry (`npm view @kontourai/aidlc-kit` returns 404). Install it from GitHub.

To pin an exact commit, install from GitHub into a bootstrap directory, then register the installed copy as a kit with the Flow Agents CLI that the install brought with it:

```sh
mkdir aidlc-bootstrap && cd aidlc-bootstrap
npm init -y
npm install --save-exact 'github:kontourai/aidlc-kit#<commit>'
npx flow-agents kit install ./node_modules/@kontourai/aidlc-kit --dest "$PWD"
npx flow-agents kit activate --dest "$PWD" --format json
```

`flow-agents kit install` can also clone directly, but its `#<ref>` and `--ref` accept only a branch or tag name, not a commit SHA:

```sh
flow-agents kit install https://github.com/kontourai/aidlc-kit.git#<branch-or-tag> --dest /path/to/workspace
flow-agents kit activate --dest /path/to/workspace --format json
```

The packed tarball from `npm pack` is also a kit repository: unpack it and pass the resulting `package` directory to `flow-agents kit install`. Installation copies a validated repository; it does not fetch or execute npm dependencies. Runtime applications install this package from GitHub, as above, to resolve its pinned public Flow and Surface dependencies.

To work on the kit itself, from a clone:

```sh
npm ci
npm run check
npm test
npm run test:package
```

Package-install verification packs this repository and performs a clean npm installation outside its source tree. It validates and activates the installed kit through the public Flow Agents CLI and exercises the packaged public Flow/Surface contracts. It also opens the installed native review host, checks that artifact findings and action labels reach Survey, and verifies that an unresolved review cannot write a controller decision. Live model equivalence is a separate measurement; no synthetic package check proves effectiveness.

Documentation is published to <https://kontourai.github.io/aidlc-kit/> with Corpus. `corpus.json` lists the published docs and the topics served to agents, and `npm run docs:check` is the gate. When you change code that a document `covers`, update that document.

See [execution](docs/execution.md) and [methodology](docs/methodology.md) for controller, authority and evidence boundaries.

For ordinary installed execution, install this repository from GitHub with npm in a bootstrap directory outside your application workspace, then register that directory as a kit. The kit pins its published Flow Agents runtime in `package.json`, including the public `/kit-execution`, `/docker-worker` and `/provider-broker` exports. The kit itself is distributed from Git; select an immutable reviewed commit for reproducible installation. Native setup is covered in the walkthrough above; the lower-level example below uses an isolated Codex worker.

```sh
npm install --save-exact "github:kontourai/aidlc-kit#<reviewed-commit-sha>"
flow-agents kit install node_modules/@kontourai/aidlc-kit --dest .
flow-agents kit activate --dest . --format json
flow-agents kit run aidlc --dest . --request /private/request.json --controller-root /private/run-controller --auth-file /private/codex-auth.json
```

The ordinary request uses `schema: "kontour.kit.execution_request"`, `version: "1.0"`, `kit_id: "aidlc"`, a task `prompt`, `run_id`, absolute model `workspace`, and finite `execution` model/turn/time settings. The isolated Docker path also requires `engine_sandbox.image` as an immutable image ID. Kit runtime dependencies resolve in the bootstrap directory; the model workspace is separate. Host prerequisites for Docker execution are Node 24, Docker (Desktop on macOS or Engine on Linux) and Python 3 for descriptor-relative storage inspection. Keep controller state, credentials and hidden grading materials outside worker mounts.

For a Linux host with an incoming firewall, configure `engine_sandbox.provider_broker` with an explicit IP `bind_host` and TCP `port`. The public worker maps `host.docker.internal` to the Docker host gateway on Linux. Permit only the relevant Docker bridge source range to reach that listener; the scoped provider capability remains mandatory. The default uses an ephemeral port, and this configuration never disables or changes the host firewall. Configure reachability before starting a run; a connection failure is retained rather than counted as provider work.

```json
{"engine_sandbox":{"provider_broker":{"bind_host":"172.17.0.1","port":8326}}}
```

Use the actual bridge gateway and an available port on your host. Broker transport settings are part of the run binding; changing them starts a new registration rather than reusing prior approvals or provider quota.

For native login, Datum provider references, Docker broker setup, engine qualification and ordinary resume commands, read [Environment setup](docs/environment-setup.md).

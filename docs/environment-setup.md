# Environment setup

This kit runs AI-DLC through Flow Agents and Flow. It does not invoke the AWS `aidlc` engine. Use `flow-agents kit run aidlc` to avoid confusing the two products' CLI names. The package exposes `kontour-aidlc` for methodology-specific decisions and recomposition, leaving the AWS `aidlc` command separate. Existing users of the former kit alias should switch to `kontour-aidlc` or invoke the installed script explicitly. AWS procedures are pinned reference inputs; the host owns execution and decisions.

## Native engine setup

Install Node.js 24 and the chosen engine's ordinary CLI. Sign in with that engine's own login flow. Codex supports `codex login` or headless `codex login --device-auth`; `codex login status` checks its session. Codex may store authentication in its OS keyring or private `~/.codex/auth.json`, depending on its configuration. A file is not guaranteed to exist. Claude, Kiro, Cursor, OpenCode and Copilot own their corresponding login and refresh flows.

Native execution uses those existing sessions on the selected host. It requires explicit host execution permission and provides no OS filesystem confinement or credential confinement. The explicit host grant permits native tool use, including reads and tests during review. A reviewer that changes its snapshot is refused by post-execution integrity checks. Review snapshots and canonical byte checks observe changes; they are not a sandbox. Native workers execute and publish serially so a peer publication cannot be mistaken for an unauthorized canonical write; isolated Docker workers retain their declared parallelism. The outer worker count and elapsed deadline are bounded, while native engines' internal provider request counts are not enforceable by this runtime.

Create a separate bootstrap directory and install the kit through npm so its exact runtime dependencies resolve normally. This directory must be outside the application workspace and private controller. If the GitHub repository requires access, use your normal Git/GitHub authentication; provider login is a separate concern.

```sh
mkdir aidlc-bootstrap
cd aidlc-bootstrap
npm init -y
npm install --save-exact github:kontourai/aidlc-kit
npx flow-agents kit install ./node_modules/@kontourai/aidlc-kit --dest "$PWD"
```

For a reproducible install, append `#QUALIFIED_KIT_COMMIT` to the GitHub package specification. The package pins published Flow Agents and Flow versions. Keep using this directory's CLI (`npx flow-agents` here, or its absolute `node_modules/.bin/flow-agents` path) for setup and execution. Installing only source files into a global kit directory does not install Node dependencies; it is not the qualified execution setup.

The public Flow Agents `kit install` command registers and verifies this installed content. Native discovery is optional for direct CLI execution. To expose the kit inside an IDE project while keeping its runtime dependencies in the separate bootstrap directory, run:

```sh
npx flow-agents kit activate --dest "$PWD" --target /path/to/project \
  --adapter codex --kits aidlc
```

The generated guidance records the exact runtime launcher and installation root, so it works from the project without adding bootstrap dependencies to application code. Choose a surface such as codex, claude-code, kiro-cli, kiro-ide, cursor, opencode, copilot-cli or vscode. Activation verifies installed content and owns only its generated projection. Configuration success does not establish login, provider availability, a completed workflow, IDE behavior or hook enforcement.

For a small greenfield POC, create a parameters file containing:

```json
{"profile":"poc","project_type":"greenfield"}
```

Keep stock ceremony defaults. The kit's default authority is interactive: it grants no approvals automatically. Existing explicit authority policies remain supported.

```sh
npx flow-agents kit setup aidlc --dest /path/to/installation \
  --workspace /path/to/project --controller-root /private/path/controller \
  --engine codex --model YOUR_MODEL --auth native \
  --isolation trusted-host --allow-host-execution \
  --parameters-file parameters.json --prompt "Your task" --output request.json
npx flow-agents kit doctor --request request.json
npx flow-agents kit run aidlc --dest /path/to/installation \
  --request request.json --controller-root /private/path/controller
```

Read each actual pending questionnaire, summary, review and command subject. The installed kit's `node scripts/cli.mjs decisions` and `decide` commands retain explicit, signed operator interactions. Use that installed script's absolute path, the current pending file and an operator reference. Supply typed answers through `--disposition`; closed control choices require their exact declared strings. Resume the same unchanged request after deciding. Do not edit signed state or reset a failed trial.

## Datum provider setup

Datum owns portable provider metadata and references to secrets in environment variables, macOS Keychain or 1Password. An existing configured model can be selected with `--provider model@provider`; a private JSON auth reference can be supplied with `--auth-ref`. Materialization happens on the host. Never put a raw key in a request, project or chat. Station can supply host bindings and connections, but is optional for this standalone CLI path.

Provider compatibility is explicit. Native Claude supports an Anthropic-compatible Datum provider; other native engines currently use engine-owned login. Docker currently supports the Codex/OpenAI scoped broker. Unsupported combinations are refused rather than routed to another engine.

## Isolated Codex setup

Install Docker and run `flow-agents kit prepare-worker --codex-version EXACT_VERSION` to build the generic Node/Git/Python/Codex worker and obtain its immutable local image ID. Select `--isolation docker --image sha256:...` with either an existing private Codex file cache or a supported Datum API-key reference. Keep controller and credentials outside the project and kit. The broker grants only an ephemeral model-bound capability to workers; it never mounts native credential caches. A keyring-backed native login alone is not a Docker broker credential.

The broker enforces cumulative provider requests for the run. OAuth renewal remains the native engine's responsibility. Doctor reports specific preflight checks; provider authorization and actual execution remain unverified until observed live.

## Current qualification boundaries

Six CLI profiles are implemented: Codex, Claude, Kiro, Cursor, OpenCode and Copilot. Complete workflow qualification is recorded separately from engine smoke and configuration. Claude's expired OAuth, Cursor's unsigned session and Kiro's exhausted monthly quota remain explicitly unverified by operator direction. Native IDE interaction is a separate qualification. Do not interpret those states as verified parity.

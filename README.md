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

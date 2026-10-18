# PPT Master native export runtime

The runtime uses the official `hugohe3/ppt-master` SVG → native DrawingML
compiler at commit `b113d23720260c411ee47b2b05a73615f954deeb`.
`backend/vendor/ppt-master/source-lock.json` records a SHA-256 for every
unmodified upstream file. The 378-file compiler/attribution subset is
9,958,369 bytes. It excludes the examples, template collections, AI providers,
document converters and their dependencies. The upstream MIT license,
copyright, Skill metadata, sponsor files and executable attribution guards
remain intact. See [the official source](https://github.com/hugohe3/ppt-master/tree/b113d23720260c411ee47b2b05a73615f954deeb/skills/ppt-master)
and [the retained license](../backend/vendor/ppt-master/LICENSE).

## Installation

Use Linux with Python 3.10 or newer. macOS is supported for local verification.
Install as an account that can write the chosen private runtime directory:

```sh
node scripts/setup-ppt-master.mjs --runtime-root /opt/paperknow/ppt-master --python /usr/bin/python3
```

The installer creates an exclusive virtual environment, verifies all vendored
sources, installs wheel files using exact versions and PyPI SHA-256 hashes,
runs the official attribution guard and compiles a real native proof slide.
Only after output validation succeeds does it write `ready.json`. It does not
change system Python packages. Repeating the command validates and repairs the
same installation. `backend/vendor/ppt-master-requirements.lock` pins
python-pptx 1.0.2, Pillow 11.3.0, lxml 6.1.1, XlsxWriter 3.2.9 and
typing_extensions 4.15.0. The isolated macOS installation measured 52 MB;
platform wheel sizes vary. No LibreOffice, Cairo, browser, image generation,
audio service, GPU or AGPL document converter is required.

Application configuration:

```dotenv
PK_PPT_MASTER_ENABLED=1
PK_PPT_MASTER_RUNTIME_ROOT=/opt/paperknow/ppt-master
PK_PPT_MASTER_PYTHON=/opt/paperknow/ppt-master/venv/bin/python
PK_PPT_MASTER_MAX_TOKENS=1000000
```

The token setting bounds the whole multi-call presentation task and accepts
1,000–2,000,000 (default 1,000,000). The saved Agent per-task cost cap still
applies to long source materials, many pages and model repairs; this setting
does not authorize extra provider cost. Ordinary tools keep their existing
200,000-token default.

Installation uses the fixed official PyPI index by default. To install without
network access, prepare a wheel directory on a connected machine matching the
server's operating system, CPU architecture and Python version:

```sh
python3 -m pip download --only-binary=:all: --require-hashes --dest /absolute/ppt-master-wheels -r backend/vendor/ppt-master-requirements.lock
```

Transfer that directory and the unchanged source/requirements locks to the
server, then install with:

```sh
node scripts/setup-ppt-master.mjs --runtime-root /opt/paperknow/ppt-master --python /usr/bin/python3 --wheel-dir /absolute/ppt-master-wheels
```

`--wheel-dir` must resolve to an existing directory and must be an absolute
path. It selects `pip --no-index --find-links` while preserving wheel-only
installation and all pinned SHA-256 checks. An incomplete wheel directory or
wrong platform wheel fails without falling back to a network index. Setup
disables global/user/site pip configuration files so they cannot add hidden
indexes or remote wheel links. Timeouts include the last bounded,
credential-redacted installer output.

Export is offline. Missing configuration,
dependencies, attribution files or changed compiler sources fail closed.
The service does not install dependencies on an API request.

## Adapter contract

```js
const renderer = createPptMasterRuntime({
  runtimeRoot: '/opt/paperknow/ppt-master',
  pythonPath: '/opt/paperknow/ppt-master/venv/bin/python',
});
renderer.isReady(); // cheap readiness-marker / executable / pinned-lock check
const result = await renderer.render({
  slides: [{svg: trustedSvg, title: 'Slide title', notes: 'Speaker notes'}],
  signal,
});
// result.pptx: Buffer
// result.previews: [{index, title, mime:'image/svg+xml', svg}]
// result.validation: {slideCount, nativeShapeCount, bytes}
// result.engine === 'ppt-master'; result.commit === pinned revision
```

`pptMasterRuntimeReady(config)` additionally requires
`config.pptMasterEnabled === true` and maps `pptMasterRuntimeRoot` /
`pptMasterPython`. `PPT_MASTER_REVISION` aliases `PPT_MASTER_COMMIT`.
`validatePptMasterSvg` and `validatePptMasterSlides` expose the same input gate
used by the renderer. Tests can inject `runCompiler`, `readiness`, and
`tempRoot` into the factory without accepting executable content from model
responses.

The caller owns content/evidence validation and private artifact storage.
The adapter accepts an ordered plan of 1–40 resource-free SVG pages, each
1280 × 720. Its subset supports native geometry and editable text/tspan runs.
Scripts, DTD/entities, processing instructions, foreign namespaces, styles,
links, remote/local image resources, CSS URLs, custom fonts, embedded code,
transforms and unsupported metadata are rejected. SVG previews are validated
source artifacts; the adapter does not claim to render PowerPoint previews.

The fixed helper calls upstream's public
`create_pptx_with_native_svg(..., use_native_shapes=True, pptx_structure='flat')`
after source checks and the intact official attribution guard. Native mode
preserves editable DrawingML. No alternative renderer or raster slide fallback
is used. The inherited python-pptx template's opaque Windows printer settings
are removed with their relationship and content-type declaration; native
slide content and notes remain unchanged.

Each Node process permits one compiler at a time. The helper runs with one
worker, a clean environment containing no application credentials, no network
or child subprocesses, a 60-second CPU limit, 90-second default wall limit,
768 MB address-space limit on Linux, 128 file descriptors, disabled core dumps,
and 20 MB maximum files. Cancellation kills the process group. Standard output
and error are capped together at 64 KB and never exposed in user errors.
Temporary inputs and outputs are removed on success, cancellation and failure.
Do not configure multiple application workers without budgeting their combined
compiler concurrency for the shared host.

The final package gate checks container size, ZIP expansion, duplicate paths,
encryption, OPC internal relationships, contiguous slide count, native text
shapes and preservation of every input text character (ignoring layout
whitespace). External package relationships, hyperlinks, embedded binaries,
active content and slide raster fallback fail validation. The returned PPTX is
at most 20 MB. No deployment, storage write, user billing or task settlement
occurs inside this adapter.

## Verification

```sh
node --test tests/ppt-master-runtime.test.mjs tests/ppt-master-model.test.mjs
```

The native smoke test runs when the default local isolated installation is
ready; otherwise it is explicitly skipped. The input, ZIP/relationship,
native-text, subprocess cancellation, output limit, concurrency, cleanup and
source-integrity checks run without Python or network access.

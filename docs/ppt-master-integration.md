# PaperKnow PPT Master integration

The three existing presentation modes (`ai`, `proposal`, `thesis`) share the
same generation, ownership, billing and private delivery pipeline. No external
PPT SaaS account is required. The existing administrator-selected Agent/model
configuration remains authoritative; no provider credentials or model names
are exposed in the workspace.

## Processing and delivery

1. Validate the normalized topic/report, page count (6–30), consent and quote.
   Refuse admission before reserving credits when the compiler or private OSS
   adapter is unavailable.
2. Generate source-checked semantic slides using the existing bounded content
   batches. Keep accepted title/body/notes and their material provenance.
3. Build a deterministic deck design plan. Author one SVG page per controlled
   Agent task, using one immutable accepted-slide material. The Agent has no
   shell, filesystem or network tools. SVG content cannot change the accepted
   wording, add numbers, hide text or access remote resources.
4. Compile validated SVG pages through the pinned official PPT Master native
   exporter. Verify page count, native editable objects, text preservation and
   safe internal package relationships. The fixed subprocess has a clean
   environment, bounded CPU/memory/output, cancellation and temporary cleanup.
5. Upload PPTX, a downloadable offline SVG layout preview, and the SVG/notes
   source archive to account-private OSS through the existing artifact service.
   Files associated with an unfinished PPT task remain absent from the artifact
   library and cannot be downloaded.
6. In one database transaction recheck active ownership/file state, settle the
   existing quote, create the result and mark the task completed. This publishes
   the files together. No successful file delivery means no successful charge.

## Recovery

PPT Master uses a dedicated multi-call token ceiling of 1,000,000 per task.
`PK_PPT_MASTER_MAX_TOKENS` (or `config.pptMasterMaxTokens`) accepts an integer
from 1,000 through 2,000,000; missing or invalid values use the default. Ordinary
research tools retain their separate 200,000-token default and existing bounds.
The larger ceiling accommodates source reading, one authoring call per page,
and bounded repairs; it does not raise the administrator's saved Agent
`maxCostUsd`. All page counts and material sizes remain subject to that strict
per-task cost cap. A task that reaches either limit stops without settlement,
preserves accepted checkpoints, and requires fresh consent to resume.

Semantic and per-page design checkpoints are bounded by the account text
storage quota. A failed/cancelled task can resume only with identical input,
fresh consent and a new quote; reused pages are revalidated. Resume admission
counts the bytes copied from prior checkpoints. Per-page SVG checkpoints are
removed after successful delivery because the complete sources are in OSS.

Cancellation, compiler failure, a failed settlement, or interrupted delivery
releases the reservation and compensates only files created by that owned run.
Deduplicated files from another successful run are preserved. Pending cleanup
is indexed and retried with a delay, including uploads that failed before an
artifact ID was acknowledged. A service restart never silently repeats a
paid model call.

## User experience

The existing generation panel shows planning, page authoring, validation,
export and account storage progress. Completed tasks offer PPTX, layout
preview and page-source downloads. Task-center and account-result links reopen
the exact owned task, including on another browser after login.

The generated PPTX is an immutable version. Adopting its semantic slides into
the existing editor allows wording/notes changes; the editor's current basic
export is separately labelled and does not claim to update the previously
generated layout. HTML previews are download-only, never injected into the
application document.

## Current scope

This integration uses PPT Master's resource-free SVG-to-native DrawingML
compiler and attributed authoring constraints. It supports editable text and
basic native geometry, speaker notes, academic palette consistency, and page
composition variety. Remote images, arbitrary user SVG, uploaded PPTX template
execution, narration and animation are not enabled by this integration.
Complex chart/formula reconstruction and exact PowerPoint/WPS visual parity
are not promised. See [runtime installation and integrity controls](ppt-master-runtime.md).

The dedicated Python virtual environment lives outside immutable releases.
Its installed code and readiness marker must be readable/executable, but not
writable, by `paperknow`. Keep the project runtime separate from other hosted
services and budget aggregate process memory before increasing concurrency.

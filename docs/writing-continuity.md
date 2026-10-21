# Continuous writing and quality checks

The web client submits one thesis run. The server writes bounded sections, saves each validated checkpoint, verifies public citation metadata, and reviews the complete manuscript in bounded batches. This is not a single unlimited model response.

## Server-owned workflow skills

`backend/skills/index.mjs` maps trusted task stages to registered, versioned skills. Scientific writing, literature review, citation management, critical thinking, and peer review are adapted instruction modules. The source and MIT notice are in `backend/skills/scientific-workflows.NOTICE.md`. No external script, arbitrary skill path, network tool or filesystem permission is added by a skill.

Thesis sections and independent review use `submit_writing_output`: the server validates the complete candidate, freezes it, and ends with a local acknowledgement. The candidate is not emitted a second time as a model final answer. Existing source-read and evidence validation remain mandatory.

## Continuity and billing

New thesis runs pin the snapshot, plan, runtime version and continuity flags. Output-aware section planning respects the configured output limit. A durable ledger reserves tokens and provider cost before every dispatch, including optional review. Known usage replaces its reservation; missing or all-zero usage keeps the full token reservation. Unknown provider cost keeps its cost reservation. Actual overruns are recorded and stop further work.

A section permits at most three dispatches, including its first attempt. Only known-usage truncation, turn, JSON and length failures can retry automatically. Authentication, unsafe evidence, cancellation, exhausted budgets and unknown usage do not automatically retry. An explicit smaller operator budget always wins; automatic retries never reset the whole-run pool.

Maintenance recovery reuses the same run and held billing reservation, and only processes unfinished sections. An unresolved dispatch is conservatively recorded as unknown usage. Review checkpoints are keyed by run, attempt, review unit and task hash. Legacy runs without the continuity ledger do not silently replay. User cancellation never automatically requeues.

Customer billing reserves and settles once for the run. Retry and review calls do not create a new quote or consume another package entitlement. Completed chapter versions are saved before optional quality checks.

## Quality scope

The citation verifier uses validated public DOI, arXiv or OpenAlex identifiers with fixed official endpoints. It does not send private manuscript text or fetch arbitrary user URLs. Missing identifiers remain unverified, and a missing result is not proof of a fabricated source. Metadata matches do not verify the full text or whether an assertion is supported.

Rule checks locate explicit placeholders, unresolved citation markers and duplicate text. Independent model review must cite exact text and an existing section ID; coverage is reported across every submitted batch. It does not rewrite the manuscript or certify facts. Failed optional checks report partial or unavailable status. Editing the manuscript makes the saved report stale.

The customer panel hides runtime/provider configuration, starts collapsed, and uses a fixed internal scroll window. Academic uses of words such as model, cost or service provider remain intact; runtime secrets and configuration details are excluded.

## Operations

`PK_THESIS_CONTINUOUS_ENABLED=0` disables continuity for new work; `PK_WRITING_QUALITY_ENABLED=0` disables optional quality checks. Both are enabled by the production configuration loader by default. Pinned old runs retain their compatibility behavior. Existing configured model timeout, per-call cost and output limits are not increased by the runtime adapter.

This improves completion under recoverable failures; it is not a guarantee against provider outages, explicit cancellation, invalid evidence, exhausted budgets or full account storage. Completed checkpoints remain available when execution must stop.

## Verification

Meaningful regression coverage includes strict SDK submission, automatic repair, long-run token budgeting, exact-once billing, maintenance recovery, unknown/all-zero usage, explicit cancellation, citation endpoint limits, exact review quotations, old schema compatibility and fixed-window UI behavior. Browser acceptance uses isolated synthetic accounts and an in-memory database. Real provider probes use synthetic short content and bounded spending; they do not certify full-thesis quality across all fields.

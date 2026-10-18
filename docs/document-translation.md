# Whole-document translation

The initial integration uses Aliyun Machine Translation `alimt` version
`2018-10-12`, with `CreateDocTranslateTask` (POST) and `GetDocTranslateTask`
(GET). It is distinct from model-based text translation and from the newer
Aidge document-translation service; credentials and activation must authorize
these specific alimt APIs.

Official contracts:

- https://help.aliyun.com/zh/machine-translation/developer-reference/api-alimt-2018-10-12-createdoctranslatetask
- https://help.aliyun.com/zh/machine-translation/developer-reference/api-alimt-2018-10-12-getdoctranslatetask
- https://help.aliyun.com/zh/machine-translation/usage-notes-of-api-operations-for-document-operation

## Configuration and permission

Set these server-only environment variables through the service environment:

```
PK_DOCUMENT_TRANSLATION_ENABLED=1
PK_DOCUMENT_TRANSLATION_ACCESS_KEY_ID=
PK_DOCUMENT_TRANSLATION_ACCESS_KEY_SECRET=
PK_DOCUMENT_TRANSLATION_REGION=cn-hangzhou
```

Use a dedicated RAM identity with `alimt:CreateDocTranslateTask` and
`alimt:GetDocTranslateTask` on `*`, following the provider's current permission
model. No browser or API response receives the credentials. The client uses the
fixed HTTPS endpoint `mt.cn-hangzhou.aliyuncs.com`; arbitrary endpoints are not
configurable. The existing private OSS storage configuration must also be ready.

This initial release does not debit PaperKnow research credits. Upstream calls
can still consume the operator's free quota or incur provider charges. Admission
is capped at three tasks and 100 reserved pages per user per UTC day, twenty tasks
and 500 pages globally. Failed and cancelled submissions retain quota usage so
repeated cancellation cannot bypass cost controls. Future paid use needs a
separate explicit quote/reservation/settlement flow before raising these limits.

## Product limits and output

- Only account-owned, private OSS originals are accepted; the user must confirm
  third-party processing for each submission.
- Initial language pairs are English to simplified Chinese, and the reverse.
- PDF and DOCX originals up to 10 MiB are supported. Existing DOCX upload limits
  may be lower; this integration does not increase the general original quota.
- PDF has a real page-count preflight with a 100-page ceiling. Encrypted or
  unreadable PDFs fail before remote creation.
- DOCX uses ZIP entry/uncompressed size limits and counts all XML text, including
  notes and headers, before submission. Its input ceiling is 100,000 characters;
  estimated billable units use the provider's 2,000-character page unit.
- Both PDF and DOCX inputs produce DOCX output through this API. Do not advertise
  a translated PDF download or pixel-identical layout preservation. Tables,
  formulae, terminology and pagination require review.
- Translated outputs are at most 20 MiB. File bytes remain only in memory during
  transfer, and the existing artifact service saves the final attachment to
  private OSS. SQLite stores metadata, IDs and job state rather than binaries.

## API

`POST /api/document-translations`

```json
{
  "fileId": "owned-original-id",
  "sourceLanguage": "en",
  "targetLanguage": "zh",
  "consent": true,
  "expectedUserId": "current-user-id",
  "idempotencyKey": "unique-browser-request-id"
}
```

Returns `{ "id": "job-id" }` with 201 for a new job or 200 for a replay/deduplicated
active job. Matching idempotency keys with different immutable inputs are rejected.
Only one translation can be active per user, and three globally. The general
three-active-jobs-per-user ceiling also applies.

`GET /api/document-translations` lists the latest twenty owned task summaries.
`GET /api/document-translations/:id` returns its owned summary and, on completion,
`result.artifacts` with authenticated `/api/artifacts/:id/download` links, language,
page count and review warnings. It never returns provider task IDs, signed input
URLs or provider result URLs.

`POST /api/document-translations/:id/cancel` takes `{}` and stops local processing
and delivery. The provider does not expose cancellation in this integration;
already-submitted remote work may continue and consume operator quota. A cancelled
job is never changed back to completed.

## Durable execution and secure files

The worker persists `submitting` before remote creation, uses the job ID as
`ClientToken`, and persists an acknowledged provider task ID before polling.
Automatic SDK retries are disabled. The provider's three-minute idempotency
window is not treated as durable exactly-once delivery: after an ambiguous create
or a process interruption without a known task ID, the job fails for user review
and no remote creation is replayed automatically. A known task resumes read-only
polling across restarts, with a thirty-minute total task budget.

Input uses an exact owned original's signed private OSS URL, valid for 600 seconds;
bucket ACLs are never changed. Result URLs must use a standard allowlisted OSS
hostname, with no userinfo, unusual port, fragment or arbitrary IP. Historical
HTTP OSS result URLs are upgraded to HTTPS. Public DNS is validated and pinned to
the actual TLS request; redirects are not followed and no API credential is sent
to the download host. Download sizes and DOCX ZIP structure are bounded.

Only artifacts newly created by the task are compensated after cancellation or
failure. Existing deduplicated owned artifacts are preserved. Failed cloud cleanup
retains metadata for later retry. The original is retained throughout, and active
translation jobs block deletion through the shared file service.

Run targeted verification:

```
node --test tests/document-translation.test.mjs tests/document-translation-client.test.mjs
```

The tests cover owner/account/consent checks, restricted inputs, cost admission,
idempotency, recovery without paid replays, cancellation races, private-only
storage, malformed output, DNS/URL safety and attachment ownership. Live provider
activation and an authorized synthetic-document round trip still need independent
deployment verification; mocked tests are not evidence of a live account's quota
or service permission.

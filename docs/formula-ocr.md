# Formula image recognition

This supplements the existing local mathematical formula editor. It identifies
printed mathematical formulas from a user-selected screenshot and returns
editable LaTeX. It does not claim handwriting, chemistry recognition, whole PDF
OCR, symbolic computation, or mathematical correctness verification.

## Provider and configuration

Official Aliyun OCR operation: `RecognizeEduFormula`, version `2021-07-07`.
Fixed endpoint: `ocr-api.cn-hangzhou.aliyuncs.com`, HTTPS, RPC POST, binary stream
body. The generic installed `@alicloud/openapi-client` SDK signs the binary body.
No SDK automatic retries are permitted.

Official documentation:
<https://help.aliyun.com/zh/ocr/developer-reference/api-ocr-api-2021-07-07-recognizeeduformula>

Enable the Education Scenario Recognition service in the Aliyun account. A
dedicated RAM policy can grant only `ocr:RecognizeEduFormula`, resource `*`.
The deployment environment must explicitly provide:

```dotenv
PK_FORMULA_OCR_ENABLED=1
PK_FORMULA_OCR_REGION=cn-hangzhou
PK_FORMULA_OCR_ACCESS_KEY_ID=
PK_FORMULA_OCR_ACCESS_KEY_SECRET=
```

Keep credentials in the server's root-readable environment configuration. No
fallback to SMS, OSS, model, browser, or ambient process credential providers is
used. Public capabilities disclose only availability and limits. Access keys,
provider diagnostics, request IDs, image echoes and internal versions are never
returned to users.

## End-to-end contract

The user chooses an image and confirms that it may be sent to cloud recognition.
The browser resizes large images to at most 1000 pixels on either side and sends
the image directly to PaperKnow's authenticated API. Supported input MIME types
are `image/png`, `image/jpeg` and `image/webp`.

`POST /api/formula-recognitions`:

```json
{
  "imageBase64": "<canonical standard base64, no data URL prefix>",
  "mime": "image/png",
  "consent": true,
  "expectedUserId": "<current account id>",
  "idempotencyKey": "<random UUID retained for the same operation>"
}
```

The normal result is HTTP 201:

```json
{
  "id": "<recognition id>",
  "status": "completed",
  "latex": "E=mc^2",
  "createdAt": "<ISO timestamp>",
  "updatedAt": "<ISO timestamp>",
  "notice": "识别结果需核对，可在公式编辑器中继续修改。"
}
```

An identical image for the same owner reuses the record (HTTP 200,
`cached: true`). A repeated idempotency key with different content is HTTP 409.
If the first request is still in flight, duplicate submissions return its
`status: "running"` rather than starting another paid request. Poll
`GET /api/formula-recognitions/:id` to obtain the same record. Other owners get
HTTP 404. All operations require login.

Validation and admission errors use the standard API's Chinese `error` message.
A provider failure returns its failed record with a safe Chinese `error` and an
appropriate HTTP 422/429/503/504 status. A later cache lookup of that failed record
is HTTP 200 with `status: "failed"`; the UI must inspect status before applying
LaTeX. Do not overwrite an existing editor formula until the user chooses Apply.

## Validation, privacy, and initial operating limits

- Maximum decoded image: 2 MiB, width/height 1–1000 pixels. This is tighter than
  Aliyun's documented 10 MB and dimensions below 1024 pixels.
- PNG: signature, dimensions, chunk boundaries, CRCs, required data/end chunks;
  reject animated PNG. JPEG: SOF dimensions, scan/header structure, EOI marker.
  WebP: RIFF length, image/canvas dimensions and frame headers; reject animation.
- Maximum formula: 2000 characters. Normalize optional equation delimiters and
  comparison glyphs, then validate with the existing restricted MathJax renderer.
  Reject links, HTML, macros, file commands and unsupported/malformed results.
- No original or resized image is stored on the application filesystem, in
  SQLite or OSS. It is held only in request memory while calling the provider.
  SQLite stores the owner, SHA-256 hash, request alias, status, LaTeX and safe
  operational metadata. The provider may process the image under its own terms.
- Persistent allowance: 20 unique images per owner per UTC day, 200 globally.
  Failed admitted calls count toward the limit; no PaperKnow point balance is
  charged by this supplementary recognition endpoint in this initial version.
- At most one active request per owner and two globally; 25-second SDK deadline.
  Outstanding SDK requests keep their in-memory slots until they actually
  settle, even after the caller's deadline expires.
- No automatic re-submission after provider failure, ambiguous timeout, server
  restart or repeated button click. Same-owner/image hashes remain deduplicated.
  Stale running rows become a safe failed state after two minutes. A support
  intervention is required before deliberately repeating the same failed image.

These controls limit duplicate billing; they are not a substitute for Aliyun
account budgets and billing alerts. Operators can disable this feature without
disabling the local formula editor.

## Verification

`node --test tests/formula-ocr.test.mjs` covers official binary request structure,
timeouts/concurrency, auth/consent/account boundaries, header and dimension
validation, LaTeX safety, durable deduplication, failed/restarted requests and
daily budgets. Real provider activation and a screenshot → editable preview →
explicit Apply test are separate deployment acceptance steps; a passing unit test
does not establish account permissions or live provider availability.

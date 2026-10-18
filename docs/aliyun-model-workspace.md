# Alibaba model workspace configuration

The scientific task runtime supports a versioned, optional `workspaceId` in the
administrator Agent settings. On the validated Beijing shared endpoint
`https://dashscope.aliyuncs.com/apps/anthropic`, it sends the server-owned
`X-DashScope-WorkSpace` header on model and token-count requests. The connection
test uses the same header. User prompts and incoming SDK headers cannot override
the configured workspace.

Workspace IDs accept `ws-` or `llm-` followed by up to 64 ASCII letters/digits.
The optional header is restricted to the exact HTTPS host
`dashscope.aliyuncs.com`; credentials, query strings, fragments, nonstandard
ports and third-party endpoints are rejected. A workspace-specific host should
instead be copied from Alibaba's API Host field and separately verified. Do not
construct an unverified endpoint from an ID or infer region from its prefix.

Saving only `workspaceId` creates a new encrypted immutable configuration
version and preserves the current model, credential and execution limits.
Existing jobs retain their original configuration version. Historical versions
without the new property load with an empty workspace. Clear the field before
switching to a different provider or a dedicated endpoint.

For legacy editing requests, `PK_AI_WORKSPACE_ID` configures the same header.
`PK_AGENT_WORKSPACE_ID` is the initial runtime override when no saved Agent
configuration exists; otherwise that initial runtime inherits the AI workspace
only for the validated Alibaba shared host. An explicit empty override clears
inheritance. Environment changes require a service restart; saved scientific
settings do not.

## Verification performed on 2026-10-18

Synthetic, bounded requests with no automatic paid retry verified:

- `qwen3.7-plus` and `qwen3.7-max`: two-turn tool-use exchange.
- `qwen3-vl-plus`: dominant-color recognition of a synthetic PNG.
- `text-embedding-v4`: 64 finite numeric dimensions.
- `qwen3-rerank`: expected first-ranked document and valid scores.
- `wan2.6-t2i`: API returned one 1280×1280 image URL and image-count usage.

The shared endpoint accepted the supplied workspace. Invalid-workspace negative
controls were rejected by the Messages and embedding APIs. The constructed
workspace-specific hostname returned `Endpoint.AccessDenied`; it was not used
as the production endpoint. The generated image binary was not downloaded or
validated during these endpoint tests.

These checks do not establish long-document quality, full business delivery,
precise currency charges, or completed vision/search/image product adapters.
Reported usage and request IDs are retained in the local task's test outputs;
credentials and signed image URLs are omitted. Current production model choice
is independent of the six candidate availability checks.

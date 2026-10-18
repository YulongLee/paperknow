# AMiner literature search

AMiner is an optional server-side metadata source shared by the literature
library and writing reference picker. It joins Crossref, Europe PMC and
OpenAlex in aggregate search and can also be selected directly.

## Private configuration

The validated integration uses the account's existing console-generated token:

- `PK_AMINER_ENABLED`: only `1` enables the integration; disabled by default.
- `PK_AMINER_ACCESS`: defaults to `internal`. In this mode only an authenticated
  server-verified administrator can see and query AMiner. Public publication
  requires the explicit value `public` after the applicable rights are confirmed.
- `PK_AMINER_TOKEN`: raw HS256 JWT, without a `Bearer` prefix.
- `PK_AMINER_DAILY_LIMIT`: outbound attempts per UTC day; default 100, maximum
  10000, and 0 stops new outbound requests.

Store these in `/etc/paperknow/aminer.env`, owned by root with mode 0600. A
PaperKnow-only systemd drop-in can load this file for administrator-only internal
acceptance. Never put credentials in source,
browser assets, reports, query strings or public capability responses. Replacing
the token requires a PaperKnow service restart after installing the private file.
The token is not a browser login/session cookie.

An explicitly supplied token takes priority over the optional
`PK_AMINER_API_KEY` / `PK_AMINER_USER_ID` signing configuration. Malformed or
expired tokens do not fall back to a different credential. The service checks
token structure, algorithm and expiry; AMiner validates its signature. The
documented short-lived signing mode has mock coverage but was not successfully
verified against the real account, so production does not rely on it.

## Endpoint and data scope

Only the official title search endpoint is called:

`GET https://datacenter.aminer.cn/gateway/open_platform/api/paper/search`

The server fixes `page=1`, bounds `size` to 20 and passes the public query as
`title`. No other AMiner endpoints or paid detail/full-text calls are made.
The documentation labelled this endpoint free for a limited period on
2026-10-19; that is not a permanent pricing commitment. Check provider pricing
and account permissions before increasing traffic.

The open platform's recharge agreement, section 3.2, describes non-commercial
internal use unless separately agreed in writing. A free endpoint or successful
HTTP response alone does not establish commercial display/redistribution rights.
The integration can be accepted on the existing site in administrator-only internal
mode while ordinary users continue using existing sources. Switch to public mode
after verifying the agreement that covers PaperKnow's intended use.

Results contain the original title (Chinese title only as a fallback), supplied
first author, year, DOI and official AMiner source link. No abstract, full text,
complete author list or open-access declaration is invented. Import creates an
unconfirmed metadata record, preserving existing local text and notes. It does
not mark the paper as read. This integration does not provide CNKI synchronization
or a plagiarism report.

The confirmed endpoint has no year filter. Year bounds are applied to this
returned batch, and its unfiltered upstream total is omitted in that case. OA
filtering explicitly skips AMiner without spending a request. Aggregate search
continues with other available sources.

## Operational limits

The existing bounded response reader, HTTPS host allowlist, timeout, redirect
rejection, five-minute cache, in-flight coalescing, client limits and provider
concurrency limits apply. Business error codes are checked even on HTTP 200.
Only fixed public error descriptions are returned; upstream diagnostics and
credentials are never echoed. Other providers can return partial results when
AMiner fails. There are no automatic upstream retries.

Access is enforced on the server for both capabilities and search. Anonymous and
ordinary user requests cannot enable AMiner using a source parameter or a warm
administrator cache entry. Aggregate searches omit restricted sources. The
single provider instance retains shared budgets and concurrency controls across
request scopes; browser UI visibility is not the security boundary.

The daily counter is process-local: restarting resets it and multiple instances
do not share it. It is an operating limit, not a financial spending guarantee.
Use AMiner account-level controls and revisit this design before paid/high-volume
use. Monitor token expiry and replace it before expiry; expired authorization
automatically removes the source from capabilities and stops new AMiner calls.

## Validation

The AMiner search and API integration tests cover private token priority,
expiry, the documented signing shape, credentials confined to the provider host,
business errors, cooling, quota, malformed data, cache/coalescing, metadata
normalization, filters, aggregate partial results and DOI deduplication. Shared
frontend tests cover capability-gated options, import, local persistence and
metadata-only reading state.

Official documentation:

- Search: https://open.aminer.cn/open/docs?id=64f03e746221825d961dbde4
- Authentication: https://open.aminer.cn/open/board?tab=doc
- Account keys: https://open.aminer.cn/open/board?tab=control
- Open-platform recharge agreement: https://open.aminer.cn/open/protocol

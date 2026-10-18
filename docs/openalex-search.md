# OpenAlex literature search

OpenAlex joins the existing Crossref and Europe PMC metadata sources when
`PK_OPENALEX_API_KEY` is present in the PaperKnow service environment. Keep the
key in `/etc/paperknow/paperknow.env` (root owned, mode 0600), outside Git and
browser assets. No account password, browser cookies or unrelated service
credentials are needed. Existing keys are reused without rotation.

The public capabilities endpoint advertises only configured sources and returns
configuration booleans, never credentials. Literature search and the writing
reference picker use the same provider service. Queries are explicit public
titles/keywords with optional year and open-access filters; documents and
private account contents are not forwarded.

The fixed OpenAlex HTTPS endpoint receives the key through the Authorization
header. Responses are bounded and normalized to the existing literature schema.
Missing abstracts/authors are left missing. A public full-text link is shown only
for provider-declared open-access locations; authenticated OpenAlex content
download URLs are excluded. Metadata is not a substitute for reading the paper,
nor does a link itself grant unrestricted reuse of the full text.

`PK_OPENALEX_DAILY_LIMIT` limits outbound OpenAlex attempts to 500 per UTC day by
default (0 disables attempts; maximum 10000). This counter is in memory and
resets on restart, so it is a supplementary operating limit rather than an
account spending guarantee. The upstream account's budget remains authoritative;
zero remaining budget and provider throttling pause requests. Shared five-minute
cache, coalesced requests, per-client and per-provider limits reduce repeated
calls. There are no automatic upstream retries. Other sources can still return
partial results when one provider is unavailable.

Aggregated results retain the existing DOI deduplication and source priority.
Select OpenAlex directly to see its own metadata and open-access links when a
duplicate from another provider takes precedence in the aggregate.

References:
- https://help.openalex.org/api/authentication/
- https://help.openalex.org/api/endpoints/works/

Validation: `node --test tests/openalex-search.test.mjs
tests/openalex-integration.test.mjs tests/literature-search.test.mjs`, followed by
the full project suite and real production/UI acceptance using public keywords.

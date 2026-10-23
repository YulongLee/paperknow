# Literature source access

The writing reference picker and AI reading discovery page share
`/api/literature/search` and the server's capability list. Search returns public
bibliographic metadata, not downloaded or confirmed full text. Import keeps the
provider, identifier, supplied authors/year/DOI/journal/pages and available
abstract. The reader must explicitly admit abstract or full-text material.

## PubMed

`pubmed` calls NCBI directly: ESearch finds up to 20 PMIDs, then one batched
ESummary retrieves their bibliographic metadata. This is separate from Europe
PMC. No API key or paid account is required for this bounded anonymous mode.

All clients sharing a transport share a serial queue, with at least 350 ms
between HTTP requests, a queue of three distinct searches, an hour of bounded
metadata caching, and in-flight coalescing. Each HTTP request/body read has an
eight-second timeout and a 2 MiB response limit. The application client rate
limit still applies. There are no automatic remote retries.

Only relevance and publication-year sorting are supported. PubMed publication
date search can match an electronic date that differs from the summary's print
year. Returned displayed years are checked again locally; year, type and DOI
filtering therefore describe the current result window and omit the unfiltered
index-wide total. Unsupported open-license and citation-count conditions are
reported explicitly without calling NCBI. A PMC link or “Has Abstract” flag is
never interpreted as full text, an abstract, or an open licence.

The writing search, reading search and reader display an NCBI disclaimer and
copyright link. `tool=PaperKnow` and the existing public support email are
included in requests. Register these details with NCBI before scaling usage;
the presence of URL parameters does not establish registration.

Official references:

- https://www.nlm.nih.gov/dataguide/eutilities/utilities.html
- https://www.ncbi.nlm.nih.gov/books/NBK25497/
- https://www.ncbi.nlm.nih.gov/home/about/policies/

## OpenAlex

The existing `openalex` adapter remains unchanged. Production already has its
server credential. Its status is included in capabilities; no credential is
returned to the browser. See `openalex-search.md` for operating limits.

## Semantic Scholar

The `semantic_scholar` adapter is implemented with mock coverage but remains
closed in production. It uses the official Graph relevance search endpoint:
`https://api.semanticscholar.org/graph/v1/paper/search`. Credentials are sent only
in the `x-api-key` header. One anonymous probe from the production server returned
200; a separate development probe returned 429. Neither proves commercial
permission or reliable quota.

Official API terms limit the standard grant to specified internal noncommercial
uses and direct commercial users to apply for an Expanded License. The public
display terms also require the provider name, logo and a source link carrying
`utm_source=api`. Obtain written scope covering PaperKnow's commercial search,
display, caching and citation import, the API key, quota, and approved logo/display
guidance before enabling this source publicly. Source links already include the
required UTM value; a public logo treatment must be completed using approved
assets before activation.

Configuration, kept solely in the private service environment:

| Variable | Default / meaning |
| --- | --- |
| `PK_SEMANTIC_SCHOLAR_ENABLED` | `0`; only `1` constructs an available configured source |
| `PK_SEMANTIC_SCHOLAR_API_KEY` | Empty; required for outbound access |
| `PK_SEMANTIC_SCHOLAR_ACCESS` | `internal`; `public` requests publication |
| `PK_SEMANTIC_SCHOLAR_COMMERCIAL_LICENSED` | `0`; public activation also requires `1` after rights are confirmed |
| `PK_SEMANTIC_SCHOLAR_DAILY_LIMIT` | 100 actual HTTP attempts per UTC day; 0 stops new calls; maximum 10000 |

Authenticated persisted administrators may exercise a configured source in
internal mode. Ordinary and anonymous requests cannot use a parameter or a warm
admin cache to bypass this scope. The daily budget hook runs only before actual
outbound calls, so cached metadata remains usable after the budget is reached.
The counter is process-local and is not a persistent financial safeguard.

Requests are serial per credential with a one-second interval, a three-search
queue, one-hour bounded cache, eight-second HTTP/body timeout, 2 MiB maximum and
five-page display limit. Unsupported DOI filters, zero-citation filters,
thesis/report/preprint types and sorting other than relevance are reported
without sending a request. Missing counts, type and access state remain unknown.

Official references:

- https://api.semanticscholar.org/api-docs/graph
- https://api.semanticscholar.org/license/
- https://www.semanticscholar.org/product/api#api-key-form

## CNKI / 知网

`cnki` is a known unavailable source. It is excluded from the selectable and
aggregate sources; a direct request receives `not_configured` without an
outbound call. The UI explains its state under a collapsed source-status panel.

No CNKI endpoint or credential has been supplied to this project. Obtain the
official authorized retrieval interface documentation, application/account
credentials, commercial display/import/cache scope, quota/pricing, and any
server IP allowlist requirements. The official platform entry is
https://openx.cnki.net/ . The final adapter must be written against those actual
documents; this change deliberately does not invent a CNKI endpoint or return
another provider's results under its name. Consumer website login, a competitor's
dropdown and successful searches on a different platform are not integration
configuration.

## Verification boundary

Provider transport tests cover bounded access, metadata truthfulness, malformed
responses, throttling, caching and body timeout. Shared API tests cover import,
provenance, filtered-window totals, public/internal scope and outbound budgets.
Browser acceptance uses the actual writing/reading search components with the
real anonymous PubMed service and no private user documents or paid generation.
Semantic Scholar acceptance remains mock/internal until its missing inputs are
provided; CNKI remains unconfigured.

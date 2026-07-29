# Anakin datasource for Budibase

A [Budibase](https://budibase.com) datasource plugin for [Anakin](https://anakin.io) —
web scraping, site mapping/crawling, AI search, agentic research, Wire site
automation (read + write actions across hundreds of sites), website
monitoring, AI-visibility tracking, and AI browser automation, all callable
as Budibase queries.

> Datasource plugins only run on **self-hosted Budibase** — Budibase Cloud
> does not support custom plugins.

## Install

1. In a self-hosted Budibase instance, go to **Settings → Plugins → Add
   plugin** and point it at this repo (or a built release of it).
2. Add a new datasource, choose **Anakin**, and supply your API key
   ([anakin.io](https://anakin.io) → API keys). "Test Connection" runs a
   1-result `search` query (3 credits) to validate the key.

## Authentication

Every request sends the configured API key as the `X-API-Key` header
against `https://api.anakin.io/v1`.

## Async jobs: submit + get-result

Several Anakin operations are asynchronous — the API accepts the job and
you poll a separate endpoint until it completes (some runs take minutes).
A single Budibase query is one bounded HTTP round trip, so this plugin
never blocks inside a query to poll to completion. Instead, each async
operation is a **submit** query that returns immediately with a job/search
ID, paired with a **get-result** query you call again (e.g. from an
automation loop with a delay step) until the status is terminal:

| Submit                | Poll with              |
| ---------------------- | ----------------------- |
| `scrapeUrl`             | `getScrapeResult`        |
| `map`                   | `getMapResult`            |
| `crawl`                 | `getCrawlResult`          |
| `agenticSearch`         | `getAgenticSearchResult`  |
| `wireReadAction` / `wireWriteAction` (when the response carries a `job_id`; some Wire actions return data inline) | `getWireJobResult` |
| `aiVisibilitySearch`    | `getAiVisibilitySearchResult` |
| `browserTask`           | `getBrowserTaskResult`    |

`wireBuild` is also asynchronous (returns `status: "pending"`) but has no
polling endpoint — check `wireCatalog` or the dashboard/webhook
notification for completion. `search` is synchronous and returns results
directly.

## Queries

### Web scraping
- **scrapeUrl** — submit a single-page scrape (`url`, `generateJson`,
  `country`, `useBrowser`, `forceFresh`).
- **getScrapeResult** — fetch a scrape job's result (`jobId`).

### Site discovery
- **map** — discover reachable URLs under a site (`url`, `limit`, `depth`,
  `limitPerLevel`, `includeSubdomains`, `includeExternalLinks`,
  `useBrowser`, `search`).
- **getMapResult** — fetch a map job's result (`jobId`).

### Bulk crawling
- **crawl** — fetch markdown across many pages of a site (`url`,
  `maxPages`, `depth`, `country`, `useBrowser`, `includePatterns`,
  `excludePatterns` — both comma-separated glob/regex patterns —
  `sessionId`, `sessionName`).
- **getCrawlResult** — fetch a crawl job's result (`jobId`).

### AI search
- **search** — synchronous AI web search (`prompt`, `limit`).
- **agenticSearch** — submit a multi-step research task, optionally with a
  structured-output `schema` (`prompt`, `useBrowser`, `schema`).
- **getAgenticSearchResult** — fetch an agentic-search job's result
  (`jobId`).

### Wire (pre-built site automation)
Wire is Anakin's catalog of automation actions across hundreds of sites.
Discover an action, then run it with the read or write query matching its
type.

- **wireDiscover** — find candidate actions from a natural-language intent
  (`q`, `limit`).
- **wireCatalog** — list every catalog, or one catalog's full action list
  and parameter schemas (`slug`, optional).
- **wireReadAction** — run a read-only action that extracts data
  (`actionId`, `params` JSON, `credentialId`, `identityId`).
- **wireWriteAction** — run a state-changing action (submit a form, add to
  cart, etc.); does not execute payments or transfer funds — the Anakin
  catalog itself excludes those (`actionId`, `params` JSON, `credentialId`,
  `identityId`).
- **getWireJobResult** — fetch a Wire job's result (`jobId`).
- **wireIdentities** — list saved identities/credentials, optionally
  filtered by catalog (`catalogId`).
- **wireLogin** — credentials-mode sign-in, returns a `credential_id`
  (`catalogSlug`, `params` JSON, `identityName`, `sourceId`, `sourceRef`
  JSON).
- **wireBuild** — request a new action for a site not yet in the catalog
  (`websiteUrl`, `goal`, `catalogId`, `visibility`, `force`).

### Website monitoring
- **monitorCreate** — create a scheduled monitor for a page, site, or Wire
  action (`url`, `intervalMinutes` [min 15], `scope`, `watchMode`,
  `watchFormat`, `outputSchema` JSON, `aiMode`, `aiGoal`, `useBrowser`,
  `country`, `sessionId`, `isActive`, `expiresAt`, `alertWebhookUrl`,
  `alertEmails`, plus site-scope `maxPages`/`maxDepth`/`includePatterns`/
  `excludePatterns` and wire-scope `wireActionId`/`wireCatalogSlug`/
  `wireCredentialId`/`wireParams`/`wireWatchPaths`).
- **monitorList** — list all monitors, or fetch one (`id`, optional).
- **monitorChanges** — list a monitor's detected changes (`id`).
- **monitorControl** — pause / resume / run_now / delete a monitor (`id`,
  `action`).

Monitor responses have their `alertWebhookSecret` (HMAC signing secret)
redacted before being returned — retrieve the real value from the Anakin
dashboard.

### AI visibility
- **aiVisibilitySearch** — ask multiple AI answer engines the same question
  and compare answers (`query`, `sources` comma-separated engine slugs,
  `country`).
- **getAiVisibilitySearchResult** — fetch a visibility search's result
  (`searchId`).
- **aiVisibilitySources** — list available AI engines (no fields).

### Browser sessions
Saved sessions are encrypted login states created interactively via the
Anakin dashboard; this plugin only lists and deletes them.

- **sessionList** — list saved sessions, optionally filtered by domain
  (`domain`).
- **sessionDelete** — permanently delete a saved session (`id`).

### AI browser automation
- **browserTask** — run a natural-language task in a real cloud browser
  (`prompt`, `url`, `sessionId`, `maxSteps`, `timeoutMs`, `outputSchema`
  JSON). Never put credentials in `prompt` — use `sessionId` for
  authenticated tasks.
- **getBrowserTaskResult** — fetch a browser task's result (`jobId`, the
  `workflow_id` returned by `browserTask`).

## Design notes

- **List-shaped parameters are comma-separated strings**, not native array
  fields (e.g. `includePatterns`, `sources`, `wireWatchPaths`). Budibase's
  per-query `fields` schema in this plugin only uses `string` / `boolean` /
  `number` / `json` — the same types the original 5-query version used —
  so multi-value inputs follow the API's own convention for `alertEmails`
  (a comma-separated string) rather than assuming an unverified list input.
- **No client-side financial-transaction guard.** Anakin's MCP server
  (`anakin-mcp`) refuses Wire write-actions/build-requests/browser-tasks
  that look like payments or fund transfers, because Anthropic's Connectors
  Directory requires that guard for an LLM agent autonomously deciding
  which tool to call. A Budibase query runs with parameters a developer
  explicitly wired up at build time — not chosen by an autonomous agent —
  so that specific guard isn't reproduced here. The Anakin catalog itself
  still excludes payment-execution actions.
- **`wireReadAction` / `wireWriteAction`** hit the same `POST /wire/task`
  endpoint and share an implementation, kept as two query types (not one
  with a mode flag) so the split between safe reads and state-changing
  writes stays visible in the query picker.

## Verified

Installed and typechecked against the real published `@budibase/types`:

```
npm install
npx tsc --noEmit
```

Not bundled (no rollup config) and not run inside an actual Budibase
instance — see `SUBMIT.md` for what's left before this can be published to
`Budibase/plugins`.

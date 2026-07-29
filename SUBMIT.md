# Budibase — submission instructions

## Correction to the earlier research

`Budibase/plugins` (the repo the initial research pointed at) is **not** a
monorepo of plugin source — it's a curated markdown table linking out to
independently-hosted plugin repos. "Submitting" means: (1) build and host
your own plugin repo (this directory), (2) add one table row to
`Budibase/plugins`'s README pointing at it. Confirmed by reading the actual
repo contents (`CONTRIBUTING.md`, `README.md`) via `gh api` rather than
trusting the earlier summary — it described the mechanism correctly in
spirit but implied a monorepo structure that doesn't exist.

## What's here and how it was verified

```
schema.json       datasource + 28 query type definitions
src/datasource.ts AnakinIntegration class — one method per query type
src/index.ts       exports { integration, schema }
README.md          query reference + design notes
icon.svg
```

Structure mirrors a real, current, in-production plugin —
`melohagan/budibase-datasource-supabase` (pulled live via `gh api`; Mel
O'Hagan's plugins are the most prolific/consistent examples in the curated
list).

### Coverage: 28 queries covering all 21 Anakin API surfaces

Started at 5 queries (scrapeUrl/getScrapeResult, search,
agenticSearch/getAgenticSearchResult) covering 3 of 21 ground-truth API
surfaces (read from `anakin-mcp/src/client.ts` and `anakin-mcp/src/tools/
*.ts`, the source of truth for every endpoint path, param name, and
default). Extended to the remaining 18: map, crawl, wire_discover,
wire_catalog, wire_read_action, wire_write_action, wire_identities,
wire_login, wire_build, monitor_create, monitor_list, monitor_changes,
monitor_control, ai_visibility_search, ai_visibility_sources,
session_list, session_delete, browser_task.

The 18 map to 23 Budibase query methods, not 18 1:1, because 7 of them are
async/job-based (map, crawl, wireReadAction, wireWriteAction — shares one
job endpoint with getWireJobResult, ai_visibility_search, browser_task).
Rather than block a single query for up to several minutes of polling (as
`anakin-mcp`'s client does internally), each gets a submit query plus a
separate get-result/poll query — the same pattern the original 5 queries
already established with scrapeUrl/getScrapeResult and
agenticSearch/getAgenticSearchResult. wire_build is async too but has no
polling endpoint (matches `client.ts`, which doesn't poll it either) — its
completion is checked via wireCatalog or the dashboard. See README.md for
the full query reference and the submit/poll pairing table.

Session *creation* was intentionally excluded — it's not in `anakin-mcp`'s
tool surface either, because it's an interactive noVNC login flow (2FA/
captchas) that can't run headless from a single API call.

Monitor responses have their `alertWebhookSecret` redacted (ported from
`anakin-mcp`'s `monitor.ts`, which redacts it before it reaches an LLM's
context — the same leak risk applies to a Budibase query result bound into
a table or shown to an app's end users). `anakin-mcp`'s financial-
transaction refusal guard on Wire writes/build/browser-task was **not**
ported — it exists specifically because an LLM agent autonomously picks
which tool to call under Anthropic's Connectors Directory policy; a
Budibase query runs with parameters a developer explicitly wired up at
build time, not an agent's choice. The catalog-side payment exclusion
still applies regardless. Both decisions are documented in README.md.

**Actually installed and typechecked** against the real published
`@budibase/types@3.40.1`. Caught and fixed a real bug this way:
`IntegrationBase`'s only formally-declared members are `create`, `read`,
`update`, `delete`, `patch`, `testConnection`,
`defineTypeCastingFromSchema` — all optional. A class implementing that
interface with **zero** overlapping member names (my first draft: only
`scrapeUrl`/`getScrapeResult`/`search`/`agenticSearch`/
`getAgenticSearchResult`) trips TypeScript's "no properties in common"
check, because when every interface member is optional, TS still wants at
least one point of structural overlap to accept `implements`. Fixed by
adding `testConnection()` — which is both the fix and independently useful
(it's what powers Budibase's "Test Connection" button in the datasource
setup UI). The custom operation names themselves are fine at the framework
level despite not being in `IntegrationBase`'s declared list — the
reference Supabase plugin does the same thing with `upsert`, which isn't
in that interface either; Budibase dispatches by matching `schema.json`'s
query-type keys to method names at runtime, not by the static interface.

## Design choice: no eager credit-spending validation outside testConnection

Same reasoning as the Botpress and Activepieces integrations elsewhere in
this session: `testConnection()` only runs when the user explicitly clicks
"Test Connection" in the UI, so spending 3 credits there is expected/opt-in
— there's no separate eager validation on every datasource save.

## Steps (needs the account owner)

1. Push this directory as its own repo, e.g.
   `Anakin-Inc/budibase-datasource-anakin`.
2. Add the rollup build config + package.json scripts matching the
   Supabase reference's `rollup.config.js` (not copied here — the
   TypeScript source and schema are the substantive part; the bundler
   config is boilerplate worth copying directly from the reference repo
   rather than re-deriving).
3. Test inside a real, self-hosted Budibase instance — **datasource
   plugins only work on self-hosted installs, not Budibase Cloud**
   (confirmed in the original research and consistent with how the
   plugin-loading mechanism works).
4. Open a PR to `Budibase/plugins` adding one row to the "Datasources and
   APIs" table, per their `CONTRIBUTING.md` format.

## Not done

Typechecks against the real `@budibase/types`, but never bundled (no
rollup config) or run inside an actual Budibase instance.

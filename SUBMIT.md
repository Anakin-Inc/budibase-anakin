# Budibase: how this ships

`Budibase/plugins` is a curated README table that links to plugin repos
hosted elsewhere. It is not a monorepo. Shipping means:

1. This repo publishes an installable release: pushing to `main` runs
   `.github/workflows/release.yml`, which builds
   `budibase-datasource-anakin-<version>.tar.gz` and attaches it to a
   GitHub release `v<version>`. Budibase's **GitHub** plugin source reads
   `releases/latest` and takes the first asset with content type
   `application/gzip` (`packages/server/src/sdk/plugins/update.ts`).
2. One row is added to the "Datasources and APIs" table of
   `Budibase/plugins` (alphabetical, description of 100 characters or
   fewer, at most 3 tags, PR title `Add <Name> datasource`, one squashed
   commit, target `master`).

Datasource plugins only load on **self-hosted** Budibase, not Budibase
Cloud.

## How it was verified

- `npm run typecheck` against `@budibase/types` 3.40.x.
- `npm test`: builds the bundle and checks the HTTP request every query
  sends (method, path, body, `X-API-Key` header) with a stubbed `fetch`,
  using inputs shaped the way Budibase delivers them (strings, blanks).
- The built tarball was run through a replica of Budibase's current plugin
  pipeline: metadata checks from `utilities/fileSystem/plugin.ts`, the
  sha1 `hash` check, and the restricted child process from
  `utilities/pluginSession.ts` + `pluginRunnerProcess.js`
  (`node --permission --allow-fs-read=<plugin>`, Node 22.22.2, same as
  Budibase's image). All 28 query methods are discovered, network calls
  work inside the sandbox, `wireCatalog` returned real catalog data, and a
  bad key produces `connected: false` with the 401 message.
- Not yet run inside a real self-hosted Budibase container (Docker Desktop
  would not start on the build machine).

## Things found while reading Budibase's source

- Query fields reach the plugin after handlebars enrichment, so bound
  values are strings and blank inputs are `""`. Budibase only JSON-parses
  fields literally named `json`, `customData` or `requestBody`
  (`sdk/workspace/queries/queries.ts`). The plugin therefore coerces every
  field to its `schema.json` type before use.
- Plugins run in a separate process over IPC; results must be structured-
  clone serialisable (plain JSON is).

## Design decisions

- Async operations are a submit query plus a get-result query; a query
  never blocks to poll (see README).
- `testConnection` calls `GET /sessions`: authenticated, no credits.
- Monitor responses redact `alertWebhookSecret`.
- No client-side financial-action guard (that exists in `anakin-mcp` for
  autonomous LLM tool choice; a Budibase query is wired up by a developer).
  The Anakin catalog itself excludes payment actions.

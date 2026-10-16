// Runs the built bundle (dist/plugin.min.js) against a stubbed fetch and
// checks the HTTP request each query sends. Inputs are given the way
// Budibase delivers them: bound values as strings, blank fields as "".
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { beforeEach, test } from "node:test"

const require = createRequire(import.meta.url)
const { integration: Anakin, schema } = require("../dist/plugin.min.js")

let calls = []
let reply = {}
let status = 200
globalThis.fetch = async (url, init) => {
  calls.push({ url, method: init.method, headers: init.headers, body: init.body && JSON.parse(init.body) })
  return { ok: status < 400, status, json: async () => reply, text: async () => JSON.stringify(reply) }
}
beforeEach(() => {
  calls = []
  reply = {}
  status = 200
})

const BASE = "https://api.anakin.io/v1"
const client = () => new Anakin({ apiKey: "ask_test" })
const last = () => calls.at(-1)

test("every schema query has a method", () => {
  for (const name of Object.keys(schema.schema.query)) {
    assert.equal(typeof Anakin.prototype[name], "function", name)
  }
})

test("sends the API key as X-API-Key", async () => {
  await client().getScrapeResult({ jobId: "j1" })
  assert.equal(last().headers["X-API-Key"], "ask_test")
  assert.equal(last().url, `${BASE}/url-scraper/j1`)
})

test("testConnection uses a no-credit authenticated read", async () => {
  assert.deepEqual(await client().testConnection(), { connected: true })
  assert.equal(last().method, "GET")
  assert.equal(last().url, `${BASE}/sessions`)
})

test("testConnection reports API errors", async () => {
  status = 401
  reply = { error: "unauthorized", message: "Invalid or inactive API key" }
  const result = await client().testConnection()
  assert.equal(result.connected, false)
  assert.match(result.error, /401/)
})

test("blank strings fall back to defaults, string booleans are parsed", async () => {
  await client().scrapeUrl({ url: "https://example.com", country: "", generateJson: "true", useBrowser: "", forceFresh: false })
  assert.deepEqual(last().body, {
    url: "https://example.com",
    generateJson: true,
    country: "us",
    useBrowser: false,
    forceFresh: false,
  })
})

test("string numbers and comma lists are coerced", async () => {
  await client().crawl({ url: "https://example.com", maxPages: "25", depth: "", includePatterns: "/blog/*, /docs/*", sessionId: "" })
  assert.deepEqual(last().body, {
    url: "https://example.com",
    maxPages: 25,
    depth: 1,
    country: "us",
    useBrowser: false,
    includePatterns: ["/blog/*", "/docs/*"],
  })
})

test("json fields given as strings are parsed", async () => {
  await client().wireReadAction({ actionId: "a1", params: '{"query":"shoes"}', credentialId: "", identityId: "" })
  assert.deepEqual(last().body, { action_id: "a1", params: { query: "shoes" } })
  await client().agenticSearch({ prompt: "p", schema: '{"type":"object"}', useBrowser: "false" })
  assert.deepEqual(last().body, { prompt: "p", useBrowser: false, schema: { type: "object" } })
})

test("invalid typed input fails with the field name", async () => {
  await assert.rejects(client().map({ url: "https://example.com", limit: "ten" }), /Field 'limit'/)
  await assert.rejects(client().browserTask({ prompt: "p", outputSchema: "{" }), /Field 'outputSchema'/)
  assert.equal(calls.length, 0)
})

test("monitor responses redact alertWebhookSecret", async () => {
  reply = { data: [{ id: "m1", alertWebhookSecret: "whsec_x" }] }
  const result = await client().monitorList({ id: "" })
  assert.equal(last().url, `${BASE}/monitors`)
  assert.notEqual(result.data[0].alertWebhookSecret, "whsec_x")
})

test("routes each query to its endpoint", async () => {
  const cases = [
    ["getMapResult", { jobId: "j" }, "GET", "/map/j"],
    ["getCrawlResult", { jobId: "j" }, "GET", "/crawl/j"],
    ["search", { prompt: "p", limit: "2" }, "POST", "/search"],
    ["getAgenticSearchResult", { jobId: "j" }, "GET", "/agentic-search/j"],
    ["wireDiscover", { q: "find jobs", limit: "3" }, "GET", "/wire/resolve?q=find%20jobs&limit=3"],
    ["wireCatalog", { slug: "" }, "GET", "/wire/catalog"],
    ["wireCatalog", { slug: "amazon" }, "GET", "/wire/catalog/amazon"],
    ["wireWriteAction", { actionId: "a" }, "POST", "/wire/task"],
    ["getWireJobResult", { jobId: "j" }, "GET", "/wire/jobs/j"],
    ["wireIdentities", { catalogId: "" }, "GET", "/wire/identities"],
    ["wireLogin", { catalogSlug: "s", params: '{"u":"x"}' }, "POST", "/wire/login"],
    ["wireBuild", { websiteUrl: "https://x.com", goal: "g" }, "POST", "/wire/build-request"],
    ["monitorCreate", { url: "https://x.com", intervalMinutes: "15" }, "POST", "/monitors"],
    ["monitorChanges", { id: "m" }, "GET", "/monitors/m/changes"],
    ["monitorControl", { id: "m", action: "run_now" }, "POST", "/monitors/m/run"],
    ["monitorControl", { id: "m", action: "delete" }, "DELETE", "/monitors/m"],
    ["aiVisibilitySearch", { query: "q", sources: "chatgpt,perplexity" }, "POST", "/ai-visibility/search"],
    ["getAiVisibilitySearchResult", { searchId: "s" }, "GET", "/ai-visibility/search/s"],
    ["aiVisibilitySources", {}, "GET", "/ai-visibility/sources"],
    ["sessionList", { domain: "x.com" }, "GET", "/sessions?domain=x.com"],
    ["sessionDelete", { id: "s" }, "DELETE", "/sessions/s"],
    ["browserTask", { prompt: "p", maxSteps: "5" }, "POST", "/ai/evaluate"],
    ["getBrowserTaskResult", { jobId: "w" }, "GET", "/ai/jobs/w"],
  ]
  for (const [name, input, method, path] of cases) {
    await client()[name](input)
    assert.equal(last().method, method, name)
    assert.equal(last().url, BASE + path, name)
  }
  const monitor = calls.find(c => c.url === `${BASE}/monitors` && c.method === "POST")
  assert.equal(monitor.body.intervalMinutes, 15)
  const browser = calls.find(c => c.url.endsWith("/ai/evaluate"))
  assert.deepEqual(browser.body, { prompt: "p", async: true, max_steps: 5 })
  const visibility = calls.find(c => c.url.endsWith("/ai-visibility/search"))
  assert.deepEqual(visibility.body.sources, ["chatgpt", "perplexity"])
})

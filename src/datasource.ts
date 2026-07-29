import { ConnectionInfo, IntegrationBase } from "@budibase/types"

const BASE_URL = "https://api.anakin.io/v1"

/** Shape shared by wireReadAction / wireWriteAction — kept as a type alias
 * since both methods build an identical request body (only the safety
 * framing at the schema/UI level differs, mirroring anakin-mcp's two
 * separate tools over one execution path). */
type WireActionQuery = {
  actionId: string
  params?: Record<string, unknown>
  credentialId?: string
  identityId?: string
}

class AnakinIntegration implements IntegrationBase {
  private readonly apiKey: string

  constructor(config: { apiKey: string }) {
    this.apiKey = config.apiKey
  }

  private async request(path: string, options: { method: string; body?: unknown }) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: options.method,
      headers: {
        "X-API-Key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
    if (!res.ok) {
      throw new Error(`Anakin API error (${res.status}): ${await res.text()}`)
    }
    return await res.json()
  }

  /** Append a query string, dropping undefined/empty values. Mirrors the
   * `withQuery` helper in anakin-mcp's client.ts. */
  private withQuery(path: string, params: Record<string, string | number | undefined>): string {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
    if (entries.length === 0) return path
    const q = entries
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&")
    return `${path}?${q}`
  }

  /** Split a comma-separated field into a trimmed string[], or undefined
   * when empty. Budibase's query "fields" schema has no verified array/list
   * input for arbitrary queries (only "string" | "boolean" | "number" |
   * "json" are used elsewhere in this plugin), so list-shaped API params
   * (glob patterns, engine slugs, JSON paths) are collected as a single
   * comma-separated string field, same convention the Anakin API itself
   * already uses for monitor `alertEmails`. */
  private splitList(value?: string): string[] | undefined {
    if (!value) return undefined
    const items = value
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
    return items.length > 0 ? items : undefined
  }

  /** Deep-copy `value` with `alertWebhookSecret` redacted. The Website
   * Monitoring API returns each monitor's HMAC alert-signing secret inline;
   * anakin-mcp redacts it before it reaches an LLM's context, and the same
   * risk applies here — a Budibase query result can be bound into a table,
   * stored, or shown to end users of the built app, so the secret shouldn't
   * flow through unredacted either. Retrieve the real value from the Anakin
   * dashboard. */
  private redactSecrets(value: unknown): unknown {
    const REDACTED = "[redacted — view in the Anakin dashboard]"
    if (Array.isArray(value)) return value.map(v => this.redactSecrets(v))
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = k === "alertWebhookSecret" && v ? REDACTED : this.redactSecrets(v)
      }
      return out
    }
    return value
  }

  // ── Web scraping ─────────────────────────────────────────────────────

  async scrapeUrl(query: {
    url: string
    generateJson?: boolean
    country?: string
    useBrowser?: boolean
    forceFresh?: boolean
  }) {
    if (!query.url) {
      throw new Error("You must provide a 'url'!")
    }
    return await this.request("/url-scraper", {
      method: "POST",
      body: {
        url: query.url,
        generateJson: query.generateJson ?? false,
        country: query.country ?? "us",
        useBrowser: query.useBrowser ?? false,
        forceFresh: query.forceFresh ?? false,
      },
    })
  }

  async getScrapeResult(query: { jobId: string }) {
    if (!query.jobId) {
      throw new Error("You must provide a 'jobId'!")
    }
    return await this.request(`/url-scraper/${query.jobId}`, { method: "GET" })
  }

  // ── Site discovery ───────────────────────────────────────────────────

  /** Submits a map job; returns { jobId } immediately without polling — use
   * getMapResult to fetch it once ready. Same async-submit/poll-separately
   * pattern as scrapeUrl/getScrapeResult: a Budibase query is one bounded
   * HTTP round trip, and this job can take well over a minute, too long to
   * block inside a single automation/query step. */
  async map(query: {
    url: string
    limit?: number
    depth?: number
    limitPerLevel?: number
    includeSubdomains?: boolean
    includeExternalLinks?: boolean
    useBrowser?: boolean
    search?: string
  }) {
    if (!query.url) {
      throw new Error("You must provide a 'url'!")
    }
    const body: Record<string, unknown> = {
      url: query.url,
      limit: query.limit ?? 100,
      depth: query.depth ?? 2,
      limitPerLevel: query.limitPerLevel ?? 100,
      includeSubdomains: query.includeSubdomains ?? false,
      includeExternalLinks: query.includeExternalLinks ?? false,
      useBrowser: query.useBrowser ?? false,
    }
    if (query.search !== undefined) body.search = query.search
    return await this.request("/map", { method: "POST", body })
  }

  async getMapResult(query: { jobId: string }) {
    if (!query.jobId) {
      throw new Error("You must provide a 'jobId'!")
    }
    return await this.request(`/map/${query.jobId}`, { method: "GET" })
  }

  // ── Bulk crawling ────────────────────────────────────────────────────

  /** Submits a crawl job; returns { jobId } immediately — use getCrawlResult
   * to poll it (same reasoning as map()). */
  async crawl(query: {
    url: string
    maxPages?: number
    depth?: number
    country?: string
    useBrowser?: boolean
    includePatterns?: string
    excludePatterns?: string
    sessionId?: string
    sessionName?: string
  }) {
    if (!query.url) {
      throw new Error("You must provide a 'url'!")
    }
    const body: Record<string, unknown> = {
      url: query.url,
      maxPages: query.maxPages ?? 10,
      depth: query.depth ?? 1,
      country: query.country ?? "us",
      useBrowser: query.useBrowser ?? false,
    }
    const includePatterns = this.splitList(query.includePatterns)
    if (includePatterns) body.includePatterns = includePatterns
    const excludePatterns = this.splitList(query.excludePatterns)
    if (excludePatterns) body.excludePatterns = excludePatterns
    if (query.sessionId !== undefined) body.sessionId = query.sessionId
    if (query.sessionName !== undefined) body.sessionName = query.sessionName
    return await this.request("/crawl", { method: "POST", body })
  }

  async getCrawlResult(query: { jobId: string }) {
    if (!query.jobId) {
      throw new Error("You must provide a 'jobId'!")
    }
    return await this.request(`/crawl/${query.jobId}`, { method: "GET" })
  }

  // ── AI search ────────────────────────────────────────────────────────

  async search(query: { prompt: string; limit?: number }) {
    if (!query.prompt) {
      throw new Error("You must provide a 'prompt'!")
    }
    return await this.request("/search", {
      method: "POST",
      body: { prompt: query.prompt, limit: query.limit ?? 5 },
    })
  }

  async agenticSearch(query: {
    prompt: string
    useBrowser?: boolean
    schema?: Record<string, unknown>
  }) {
    if (!query.prompt) {
      throw new Error("You must provide a 'prompt'!")
    }
    const body: Record<string, unknown> = {
      prompt: query.prompt,
      useBrowser: query.useBrowser ?? true,
    }
    if (query.schema) {
      body.schema = query.schema
    }
    return await this.request("/agentic-search", { method: "POST", body })
  }

  async getAgenticSearchResult(query: { jobId: string }) {
    if (!query.jobId) {
      throw new Error("You must provide a 'jobId'!")
    }
    return await this.request(`/agentic-search/${query.jobId}`, { method: "GET" })
  }

  // ── Wire: discovery ──────────────────────────────────────────────────

  /** Natural-language intent → ranked candidate actions. */
  async wireDiscover(query: { q: string; limit?: number }) {
    if (!query.q) {
      throw new Error("You must provide a 'q'!")
    }
    const path = this.withQuery("/wire/resolve", { q: query.q, limit: query.limit })
    return await this.request(path, { method: "GET" })
  }

  /** List every catalog, or one catalog's full action list with param schemas. */
  async wireCatalog(query: { slug?: string }) {
    const path = query.slug ? `/wire/catalog/${encodeURIComponent(query.slug)}` : "/wire/catalog"
    return await this.request(path, { method: "GET" })
  }

  // ── Wire: execution ──────────────────────────────────────────────────

  private async runWireAction(query: WireActionQuery) {
    if (!query.actionId) {
      throw new Error("You must provide an 'actionId'!")
    }
    const body: Record<string, unknown> = { action_id: query.actionId }
    if (query.params && Object.keys(query.params).length > 0) body.params = query.params
    if (query.credentialId !== undefined) body.credential_id = query.credentialId
    if (query.identityId !== undefined) body.identity_id = query.identityId
    // Returns either the completed data inline, or { status, job_id,
    // poll_url } for the caller to follow up with getWireJobResult — not
    // polled here for the same reason map/crawl aren't (a Wire job can run
    // up to 3 minutes).
    return await this.request("/wire/task", { method: "POST", body })
  }

  /** Run a Wire READ action — extracts data, does not change state on the
   * target site. Kept as a separate query type from wireWriteAction (both
   * hit the same endpoint) so the two carry distinct, honest names in the
   * Budibase query picker — mirrors anakin-mcp's mandatory read/write tool
   * split for its safety annotations. */
  async wireReadAction(query: WireActionQuery) {
    return await this.runWireAction(query)
  }

  /** Run a Wire WRITE action — a state-changing interaction on the target
   * site (submit a form, add to cart, post content, update settings). Does
   * not execute payments or transfer funds; the Anakin API itself excludes
   * those from the catalog. (anakin-mcp additionally applies a client-side
   * financial-action regex refusal — that guard exists specifically because
   * an LLM agent autonomously decides which action to call under Anthropic's
   * Connectors Directory policy. A Budibase query is invoked by a param set
   * a developer explicitly wired up at build time, not chosen by an agent,
   * so that guard isn't reproduced here; the catalog-side exclusion still
   * applies.) */
  async wireWriteAction(query: WireActionQuery) {
    return await this.runWireAction(query)
  }

  async getWireJobResult(query: { jobId: string }) {
    if (!query.jobId) {
      throw new Error("You must provide a 'jobId'!")
    }
    return await this.request(`/wire/jobs/${query.jobId}`, { method: "GET" })
  }

  // ── Wire: identities & credentials ──────────────────────────────────

  /** List your identities (and their credentials inline). */
  async wireIdentities(query: { catalogId?: string }) {
    const path = this.withQuery("/wire/identities", { catalog_id: query.catalogId })
    return await this.request(path, { method: "GET" })
  }

  /** Credentials-mode sign-in → a credential_id ready for wireReadAction /
   * wireWriteAction. */
  async wireLogin(query: {
    catalogSlug: string
    params?: Record<string, unknown>
    identityName?: string
    sourceId?: string
    sourceRef?: Record<string, unknown>
  }) {
    if (!query.catalogSlug) {
      throw new Error("You must provide a 'catalogSlug'!")
    }
    const body: Record<string, unknown> = { catalog_slug: query.catalogSlug }
    if (query.params) body.params = query.params
    if (query.identityName !== undefined) body.identity_name = query.identityName
    if (query.sourceId !== undefined) body.source_id = query.sourceId
    if (query.sourceRef) body.source_ref = query.sourceRef
    return await this.request("/wire/login", { method: "POST", body })
  }

  // ── Wire: build ──────────────────────────────────────────────────────

  /** Request a brand-new action for a site not yet in the catalog.
   * Asynchronous (returns status "pending") but — per the Anakin API and
   * mirrored in anakin-mcp's client, which does not poll this one — has no
   * job-polling endpoint; check completion via wireCatalog or the
   * dashboard/webhook notification. */
  async wireBuild(query: {
    websiteUrl: string
    goal: string
    catalogId?: string
    visibility?: "private" | "public"
    force?: boolean
  }) {
    if (!query.websiteUrl) {
      throw new Error("You must provide a 'websiteUrl'!")
    }
    if (!query.goal) {
      throw new Error("You must provide a 'goal'!")
    }
    const body: Record<string, unknown> = { website_url: query.websiteUrl, goal: query.goal }
    if (query.catalogId !== undefined) body.catalog_id = query.catalogId
    if (query.visibility === "private" || query.visibility === "public") {
      body.visibility = query.visibility
    }
    if (query.force !== undefined) body.force = query.force
    return await this.request("/wire/build-request", { method: "POST", body })
  }

  // ── Website Monitoring ───────────────────────────────────────────────

  async monitorCreate(query: {
    url: string
    intervalMinutes: number
    scope?: "page" | "site" | "wire"
    watchMode?: "full_page" | "specific_data"
    watchFormat?: "markdown" | "html" | "cleaned_html"
    outputSchema?: Record<string, unknown>
    aiMode?: boolean
    aiGoal?: string
    useBrowser?: boolean
    country?: string
    sessionId?: string
    isActive?: boolean
    expiresAt?: string
    alertWebhookUrl?: string
    alertEmails?: string
    maxPages?: number
    maxDepth?: number
    includePatterns?: string
    excludePatterns?: string
    wireActionId?: string
    wireCatalogSlug?: string
    wireCredentialId?: string
    wireParams?: Record<string, unknown>
    wireWatchPaths?: string
  }) {
    if (!query.url) {
      throw new Error("You must provide a 'url'!")
    }
    if (!query.intervalMinutes) {
      throw new Error("You must provide an 'intervalMinutes'!")
    }
    const body: Record<string, unknown> = {
      url: query.url,
      intervalMinutes: query.intervalMinutes,
    }
    // Only send fields the caller set — the API applies its own defaults,
    // same as anakin-mcp's client.
    if (query.scope !== undefined) body.scope = query.scope
    if (query.watchMode !== undefined) body.watchMode = query.watchMode
    if (query.watchFormat !== undefined) body.watchFormat = query.watchFormat
    if (query.outputSchema !== undefined) body.outputSchema = query.outputSchema
    if (query.aiMode !== undefined) body.aiMode = query.aiMode
    if (query.aiGoal !== undefined) body.aiGoal = query.aiGoal
    if (query.useBrowser !== undefined) body.useBrowser = query.useBrowser
    if (query.country !== undefined) body.country = query.country
    if (query.sessionId !== undefined) body.sessionId = query.sessionId
    if (query.isActive !== undefined) body.isActive = query.isActive
    if (query.expiresAt !== undefined) body.expiresAt = query.expiresAt
    if (query.alertWebhookUrl !== undefined) body.alertWebhookUrl = query.alertWebhookUrl
    if (query.alertEmails !== undefined) body.alertEmails = query.alertEmails
    if (query.maxPages !== undefined) body.maxPages = query.maxPages
    if (query.maxDepth !== undefined) body.maxDepth = query.maxDepth
    const includePatterns = this.splitList(query.includePatterns)
    if (includePatterns) body.includePatterns = includePatterns
    const excludePatterns = this.splitList(query.excludePatterns)
    if (excludePatterns) body.excludePatterns = excludePatterns
    if (query.wireActionId !== undefined) body.wireActionId = query.wireActionId
    if (query.wireCatalogSlug !== undefined) body.wireCatalogSlug = query.wireCatalogSlug
    if (query.wireCredentialId !== undefined) body.wireCredentialId = query.wireCredentialId
    if (query.wireParams !== undefined) body.wireParams = query.wireParams
    const wireWatchPaths = this.splitList(query.wireWatchPaths)
    if (wireWatchPaths) body.wireWatchPaths = wireWatchPaths

    const result = await this.request("/monitors", { method: "POST", body })
    return this.redactSecrets(result)
  }

  /** List all monitors, or pass `id` to fetch one monitor's full config. */
  async monitorList(query: { id?: string }) {
    const result = query.id
      ? await this.request(`/monitors/${encodeURIComponent(query.id)}`, { method: "GET" })
      : await this.request("/monitors", { method: "GET" })
    return this.redactSecrets(result)
  }

  async monitorChanges(query: { id: string }) {
    if (!query.id) {
      throw new Error("You must provide an 'id'!")
    }
    const result = await this.request(`/monitors/${encodeURIComponent(query.id)}/changes`, {
      method: "GET",
    })
    return this.redactSecrets(result)
  }

  async monitorControl(query: { id: string; action: "pause" | "resume" | "run_now" | "delete" }) {
    if (!query.id) {
      throw new Error("You must provide an 'id'!")
    }
    const base = `/monitors/${encodeURIComponent(query.id)}`
    let result: unknown
    switch (query.action) {
      case "pause":
        result = await this.request(`${base}/pause`, { method: "POST" })
        break
      case "resume":
        result = await this.request(`${base}/resume`, { method: "POST" })
        break
      case "run_now":
        result = await this.request(`${base}/run`, { method: "POST" })
        break
      case "delete":
        result = await this.request(base, { method: "DELETE" })
        break
      default:
        throw new Error("'action' must be one of: pause, resume, run_now, delete")
    }
    return this.redactSecrets(result)
  }

  // ── AI Visibility ────────────────────────────────────────────────────

  /** Submits a search across AI answer engines; returns the initial
   * { search_id, status, ... } payload without polling — use
   * getAiVisibilitySearchResult to fetch the terminal state (same
   * async-submit/poll-separately reasoning as map/crawl). */
  async aiVisibilitySearch(query: { query: string; sources?: string; country?: string }) {
    if (!query.query) {
      throw new Error("You must provide a 'query'!")
    }
    const body: Record<string, unknown> = { query: query.query }
    const sources = this.splitList(query.sources)
    if (sources) body.sources = sources
    if (query.country !== undefined) body.country = query.country
    return await this.request("/ai-visibility/search", { method: "POST", body })
  }

  async getAiVisibilitySearchResult(query: { searchId: string }) {
    if (!query.searchId) {
      throw new Error("You must provide a 'searchId'!")
    }
    return await this.request(`/ai-visibility/search/${encodeURIComponent(query.searchId)}`, {
      method: "GET",
    })
  }

  /** Available AI engines ({slug, label} roster) for aiVisibilitySearch. */
  async aiVisibilitySources() {
    return await this.request("/ai-visibility/sources", { method: "GET" })
  }

  // ── Browser sessions ─────────────────────────────────────────────────

  async sessionList(query: { domain?: string }) {
    const path = this.withQuery("/sessions", { domain: query.domain })
    return await this.request(path, { method: "GET" })
  }

  async sessionDelete(query: { id: string }) {
    if (!query.id) {
      throw new Error("You must provide an 'id'!")
    }
    return await this.request(`/sessions/${encodeURIComponent(query.id)}`, { method: "DELETE" })
  }

  // ── AI browser automation ────────────────────────────────────────────

  /** Submits a natural-language browser task in async mode; returns the
   * initial { workflow_id, status } payload without polling — use
   * getBrowserTaskResult to fetch it once done (same reasoning as
   * map/crawl; the server hard-caps a run at ~5.5 minutes, far too long to
   * block inside one Budibase query). Never pass credentials in `prompt` —
   * use a saved sessionId (see sessionList) for authenticated tasks. */
  async browserTask(query: {
    prompt: string
    url?: string
    sessionId?: string
    maxSteps?: number
    timeoutMs?: number
    outputSchema?: Record<string, unknown>
  }) {
    if (!query.prompt) {
      throw new Error("You must provide a 'prompt'!")
    }
    const body: Record<string, unknown> = { prompt: query.prompt, async: true }
    if (query.url !== undefined) body.url = query.url
    if (query.sessionId !== undefined) body.session_id = query.sessionId
    if (query.maxSteps !== undefined) body.max_steps = query.maxSteps
    if (query.timeoutMs !== undefined) body.timeout_ms = query.timeoutMs
    if (query.outputSchema !== undefined) body.output_schema = query.outputSchema
    return await this.request("/ai/evaluate", { method: "POST", body })
  }

  async getBrowserTaskResult(query: { jobId: string }) {
    if (!query.jobId) {
      throw new Error("You must provide a 'jobId'!")
    }
    return await this.request(`/ai/jobs/${encodeURIComponent(query.jobId)}`, { method: "GET" })
  }

  // No free/no-credit endpoint exists to test against without spending
  // credits — same reasoning as every other integration built in this
  // session (Botpress, Activepieces, ToolJet). A minimal real call: search
  // with limit 1 (3 credits).
  async testConnection(): Promise<ConnectionInfo> {
    try {
      await this.request("/search", { method: "POST", body: { prompt: "anakin api key validation", limit: 1 } })
      return { connected: true }
    } catch (e) {
      return { connected: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
}

export default AnakinIntegration

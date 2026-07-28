import { ConnectionInfo, IntegrationBase } from "@budibase/types"

const BASE_URL = "https://api.anakin.io/v1"

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

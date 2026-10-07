const SEARCH_CATEGORIES = [
    ['viability', profile => `${profile.concept} customer demand viability ${profile.geography}`],
    ['saturation', profile => `${profile.concept} competitors market saturation ${profile.geography}`],
    ['market', profile => `${profile.concept} market size growth trends ${profile.geography}`],
    ['market_inputs', profile => `${profile.concept} number of target customers annual spending Census BLS ${profile.geography}`],
    ['pricing', profile => `${profile.solution || profile.concept} pricing willingness to pay alternatives`],
    ['costs', profile => `${profile.solution || profile.concept} supplier labor fulfillment cost benchmarks ${profile.geography}`],
    ['regulation', profile => `${profile.concept} licenses regulations requirements ${profile.geography}`],
    ['banking', profile => `${profile.concept} small business financing SBA loans lenders requirements ${profile.geography}`],
    ['resources', profile => `${profile.concept} small business grants incubators SBDC SCORE resources ${profile.geography}`]
];

const AUTHORITY_HOSTS = ['sba.gov', 'census.gov', 'bls.gov', 'grants.gov', 'fdic.gov', 'federalreserve.gov', 'commerce.gov', 'irs.gov', 'score.org'];
const clip = (value, limit = 1400) => String(value || '').slice(0, limit);
const hostOf = value => { try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const authoritative = url => AUTHORITY_HOSTS.some(host => hostOf(url) === host || hostOf(url).endsWith(`.${host}`)) || hostOf(url).endsWith('.gov');

export class BusinessEvidenceService {
    constructor(system = {}, options = {}) {
        this.system = system;
        this.tavily = options.researchService;
        this.now = options.now || (() => Date.now());
        this.maxSources = options.maxSources || 42;
    }

    async research(profile, hooks = {}) {
        const sources = [];
        const notes = [];
        const queries = SEARCH_CATEGORIES.map(([category, build]) => ({ category, query: build(profile) }));
        for (const item of queries) {
            if (hooks.signal?.aborted) throw new Error('cancelled');
            hooks.onQuery?.(item);
            const found = await this._search(item.query);
            found.slice(0, 6).forEach(result => sources.push(this._normalize(result, item)));
        }
        const authoritativeSeeds = [...new Set(sources.filter(source => source.authoritative).map(source => source.url))].slice(0, 8);
        const browser = this.system.webScraperDendrite;
        if (browser?.browseObjective && authoritativeSeeds.length) {
            try {
                const result = await browser.browseObjective({
                    objective: `Verify official market, regulatory, financing, grant, and small-business resource facts for ${profile.concept}`,
                    seedUrls: authoritativeSeeds,
                    allowedDomains: [...new Set(authoritativeSeeds.map(hostOf))],
                    maxPages: Math.min(8, authoritativeSeeds.length),
                    timeoutMs: 30000
                });
                this._browserPages(result).forEach(page => sources.push(this._normalize(page, { category: 'official_verification', query: 'Targeted authoritative-page verification' }, 'scrape')));
                notes.push('SOMA performed targeted page verification on authoritative sources.');
            } catch (error) { notes.push(`Targeted page verification was unavailable: ${error.message}`); }
        }
        const deduped = [...new Map(sources.filter(source => source.url).map(source => [source.url.replace(/\/$/, ''), source])).values()]
            .sort((a, b) => Number(b.authoritative) - Number(a.authoritative))
            .slice(0, this.maxSources)
            .map((source, index) => ({ ...source, id: `S${index + 1}` }));
        if (!deduped.length) notes.push('No live web sources were available. Market statements must remain explicit hypotheses until research access is configured.');
        return {
            status: deduped.length ? 'live_sources_found' : 'assumptions_only',
            queries,
            sources: deduped,
            ledger: deduped.map(({ id, title, url, category, authoritative: isAuthoritative, retrievedAt }) => ({ id, title, url, category, authoritative: isAuthoritative, retrievedAt })),
            notes,
            disclaimer: 'Research covers public market, lender, grant, and resource information only. It does not access bank accounts, submit applications, or provide lending guarantees.'
        };
    }

    async _search(query) {
        if (this.tavily?.isConfigured?.()) {
            try {
                const result = await this.tavily.searchWeb(query, { depth: 'advanced', maxResults: 6 });
                if (result?.success && result.results?.length) return result.results.map(item => ({ ...item, snippet: item.content, provider: 'tavily' }));
            } catch {}
        }
        if (this.system.braveSearch?.searchWeb) {
            try {
                const result = await this.system.braveSearch.searchWeb(query, { maxResults: 6 });
                if (result?.success && result.results?.length) return result.results.map(item => ({ ...item, provider: 'brave' }));
            } catch {}
        }
        if (this.system.toolRegistry?.execute) {
            for (const toolName of ['research_web', 'web_search']) {
                try {
                    const result = await this.system.toolRegistry.execute(toolName, { query, maxResults: 6, count: 6 });
                    const items = result?.results || result?.data?.results || result?.result?.results;
                    if (Array.isArray(items) && items.length) return items.map(item => ({ ...item, provider: toolName }));
                } catch {}
            }
        }
        return [];
    }

    _normalize(item, query, provider) {
        const url = clip(item.url || item.link || item.sourceUrl, 2000);
        return {
            id: '', category: query.category, query: query.query,
            title: clip(item.title || item.name || hostOf(url) || 'Untitled source', 300),
            url, excerpt: clip(item.snippet || item.content || item.text || item.description, 1600),
            provider: provider || item.provider || 'web', authoritative: authoritative(url),
            retrievedAt: new Date(this.now()).toISOString()
        };
    }

    _browserPages(result) {
        const items = result?.pages || result?.results || result?.data?.pages || [];
        return Array.isArray(items) ? items : [];
    }
}

export default BusinessEvidenceService;

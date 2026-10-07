/**
 * KevinResearchService - Threat Research & Domain Intelligence
 *
 * Uses Tavily API for web search and domain reputation checking.
 * Helps KEVIN investigate suspicious emails and senders.
 */

const https = require('https');

class KevinResearchService {
    constructor() {
        this.tavilyApiKey = process.env.TAVILY_API_KEY;
        this.cache = new Map(); // Simple cache for repeated lookups
        this.cacheTimeout = 1000 * 60 * 30; // 30 minutes
    }

    /**
     * Check if Tavily API is configured
     */
    isConfigured() {
        return !!this.tavilyApiKey;
    }

    /**
     * Search the web using Tavily API
     */
    async searchWeb(query, options = {}) {
        if (!this.isConfigured()) {
            return { success: false, error: 'TAVILY_API_KEY not configured' };
        }

        const cacheKey = `search:${query}`;
        const cached = this._getFromCache(cacheKey);
        if (cached) return cached;

        try {
            const response = await this._tavilyRequest('/search', {
                query,
                search_depth: options.depth || 'basic',
                max_results: options.maxResults || 5,
                include_domains: options.includeDomains || [],
                exclude_domains: options.excludeDomains || []
            });

            const result = {
                success: true,
                results: response.results || [],
                query
            };

            this._setCache(cacheKey, result);
            return result;

        } catch (error) {
            console.error('[KevinResearch] Search error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Research a domain for threat indicators
     */
    async researchDomain(domain) {
        if (!domain) return { success: false, error: 'No domain provided' };

        // Clean domain
        domain = domain.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();

        const cacheKey = `domain:${domain}`;
        const cached = this._getFromCache(cacheKey);
        if (cached) return cached;

        const queries = [
            `"${domain}" scam OR phishing OR fraud`,
            `"${domain}" reviews OR reputation`,
            `site:${domain} about`
        ];

        try {
            const results = await Promise.all(
                queries.map(q => this.searchWeb(q, { maxResults: 3 }))
            );

            const allResults = results.flatMap(r => r.results || []);
            const analysis = this._analyzeDomainResults(domain, allResults);

            const result = {
                success: true,
                domain,
                analysis,
                searchResults: allResults.slice(0, 5)
            };

            this._setCache(cacheKey, result);
            return result;

        } catch (error) {
            console.error('[KevinResearch] Domain research error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Research a sender (email address or name)
     */
    async researchSender(sender) {
        if (!sender) return { success: false, error: 'No sender provided' };

        // Extract email and name
        const emailMatch = sender.match(/<(.+?)>/);
        const email = emailMatch ? emailMatch[1] : sender;
        const name = sender.replace(/<.+?>/, '').trim();
        const domain = email.split('@')[1];

        const cacheKey = `sender:${email}`;
        const cached = this._getFromCache(cacheKey);
        if (cached) return cached;

        try {
            const tasks = [
                // Research the domain
                this.researchDomain(domain),
                // Search for the email address
                this.searchWeb(`"${email}" OR "${name}"`, { maxResults: 3 })
            ];

            // Add LinkedIn search if we have a name
            if (name && name.length > 2) {
                tasks.push(this.searchWeb(`"${name}" linkedin`, { maxResults: 2 }));
            }

            const [domainResult, emailResult, linkedinResult] = await Promise.all(tasks);

            const result = {
                success: true,
                sender: {
                    email,
                    name: name || null,
                    domain
                },
                domainAnalysis: domainResult.analysis || null,
                emailMentions: emailResult.results || [],
                linkedinResults: linkedinResult?.results || [],
                overallThreatScore: this._calculateSenderThreatScore(domainResult, emailResult)
            };

            this._setCache(cacheKey, result);
            return result;

        } catch (error) {
            console.error('[KevinResearch] Sender research error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Check if a URL is potentially malicious
     */
    async checkUrl(url) {
        if (!url) return { success: false, error: 'No URL provided' };

        try {
            // Extract domain from URL
            const urlObj = new URL(url);
            const domain = urlObj.hostname;

            // Research the domain
            const domainResult = await this.researchDomain(domain);

            // Search for the specific URL
            const urlSearch = await this.searchWeb(`"${url}" scam OR phishing`, { maxResults: 3 });

            const threatIndicators = [];
            let threatScore = 0;

            // Check for suspicious TLDs
            const suspiciousTLDs = ['.xyz', '.top', '.buzz', '.click', '.loan', '.work', '.gq', '.ml', '.tk'];
            if (suspiciousTLDs.some(tld => domain.endsWith(tld))) {
                threatIndicators.push('Suspicious TLD');
                threatScore += 25;
            }

            // Check for IP-based URLs
            if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(domain)) {
                threatIndicators.push('IP-based URL (no domain)');
                threatScore += 30;
            }

            // Check for URL shorteners
            const shorteners = ['bit.ly', 'tinyurl', 'goo.gl', 't.co', 'ow.ly', 'rebrand.ly'];
            if (shorteners.some(s => domain.includes(s))) {
                threatIndicators.push('URL shortener detected');
                threatScore += 15;
            }

            // Check for excessive subdomains
            const subdomainCount = domain.split('.').length - 2;
            if (subdomainCount > 2) {
                threatIndicators.push('Excessive subdomains');
                threatScore += 10;
            }

            // Add domain analysis score
            if (domainResult.analysis?.threatScore) {
                threatScore += domainResult.analysis.threatScore * 0.5;
            }

            return {
                success: true,
                url,
                domain,
                threatScore: Math.min(threatScore, 100),
                threatIndicators,
                domainAnalysis: domainResult.analysis,
                relatedResults: urlSearch.results || []
            };

        } catch (error) {
            console.error('[KevinResearch] URL check error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Analyze domain search results for threat indicators
     */
    _analyzeDomainResults(domain, results) {
        const threatKeywords = ['scam', 'phishing', 'fraud', 'fake', 'malware', 'spam', 'suspicious', 'warning', 'hack'];
        const positiveKeywords = ['legitimate', 'trusted', 'official', 'verified', 'secure'];

        let threatScore = 0;
        let positiveScore = 0;
        const indicators = [];

        const allText = results.map(r => `${r.title} ${r.content}`).join(' ').toLowerCase();

        // Count threat keywords
        threatKeywords.forEach(keyword => {
            const count = (allText.match(new RegExp(keyword, 'gi')) || []).length;
            if (count > 0) {
                threatScore += count * 5;
                indicators.push(`"${keyword}" mentioned ${count}x`);
            }
        });

        // Count positive keywords
        positiveKeywords.forEach(keyword => {
            const count = (allText.match(new RegExp(keyword, 'gi')) || []).length;
            if (count > 0) {
                positiveScore += count * 3;
            }
        });

        // Check for known safe domains
        const safeDomains = ['google.com', 'microsoft.com', 'apple.com', 'amazon.com', 'github.com'];
        if (safeDomains.some(d => domain.includes(d))) {
            positiveScore += 50;
        }

        // Final score
        const finalScore = Math.max(0, Math.min(100, threatScore - positiveScore));

        let riskLevel = 'LOW';
        if (finalScore >= 60) riskLevel = 'CRITICAL';
        else if (finalScore >= 40) riskLevel = 'HIGH';
        else if (finalScore >= 20) riskLevel = 'MEDIUM';

        return {
            domain,
            threatScore: finalScore,
            riskLevel,
            indicators: indicators.slice(0, 5),
            resultsAnalyzed: results.length
        };
    }

    /**
     * Calculate overall threat score for a sender
     */
    _calculateSenderThreatScore(domainResult, emailResult) {
        let score = 0;

        // Domain score contribution
        if (domainResult.analysis?.threatScore) {
            score += domainResult.analysis.threatScore * 0.6;
        }

        // No online presence is suspicious
        if (!emailResult.results || emailResult.results.length === 0) {
            score += 15; // Unknown sender
        }

        return Math.min(Math.round(score), 100);
    }

    /**
     * Make request to Tavily API
     */
    async _tavilyRequest(endpoint, data) {
        return new Promise((resolve, reject) => {
            const postData = JSON.stringify({
                api_key: this.tavilyApiKey,
                ...data
            });

            const options = {
                hostname: 'api.tavily.com',
                port: 443,
                path: endpoint,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        reject(new Error('Invalid JSON response'));
                    }
                });
            });

            req.on('error', reject);
            req.write(postData);
            req.end();
        });
    }

    /**
     * Cache helpers
     */
    _getFromCache(key) {
        const item = this.cache.get(key);
        if (item && Date.now() - item.timestamp < this.cacheTimeout) {
            return item.data;
        }
        return null;
    }

    _setCache(key, data) {
        this.cache.set(key, { data, timestamp: Date.now() });

        // Clean old entries if cache gets too large
        if (this.cache.size > 100) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }
    }
}

module.exports = { KevinResearchService };

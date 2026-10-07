import https from 'https';

class BraveSearchAdapter {
    static async searchNews(query, options = {}) {
        const detailed = await this.searchNewsDetailed(query, options);
        return detailed.headlines;
    }

    static async searchNewsDetailed(query, options = {}) {
        const provider = options.provider || 'auto';
        const apiKey = process.env.BRAVE_SEARCH_API_KEY;
        if (apiKey && provider !== 'rss') {
            const headlines = await new Promise((resolve, reject) => {
                const options = {
                    hostname: 'api.search.brave.com',
                    path: `/res/v1/news/search?q=${encodeURIComponent(query)}&count=10`,
                    headers: {
                        'Accept': 'application/json',
                        'X-Subscription-Token': apiKey
                    }
                };

                https.get(options, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.results) {
                                resolve(parsed.results.map(r => r.title));
                            } else {
                                resolve([]);
                            }
                        } catch (e) {
                            reject(e);
                        }
                    });
                }).on('error', reject);
            });
            return { provider: 'brave-news', quotaCost: 1, headlines };
        } else {
            if (!apiKey) console.warn("No BRAVE_SEARCH_API_KEY found. Falling back to public RSS feed scraping for news.");
            const headlines = await this.scrapeGoogleNewsRSS(query);
            return { provider: 'google-news-rss', quotaCost: 0, headlines };
        }
    }

    static scrapeGoogleNewsRSS(query) {
        return new Promise((resolve, reject) => {
            // Google News RSS
            const options = {
                hostname: 'news.google.com',
                path: `/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            };

            https.get(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    const titles = [];
                    const regex = /<item>[\s\S]*?<title>(.*?)<\/title>/g;
                    let match;
                    while ((match = regex.exec(data)) !== null) {
                        let title = match[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')
                                            .replace(/&amp;/g, '&')
                                            .replace(/&quot;/g, '"')
                                            .replace(/&apos;/g, "'")
                                            .replace(/&lt;/g, "<")
                                            .replace(/&gt;/g, ">");
                        titles.push(title);
                        if (titles.length >= 10) break;
                    }
                    resolve(titles.length > 0 ? titles : ["No headlines found"]);
                });
            }).on('error', reject);
        });
    }
}

export default BraveSearchAdapter;

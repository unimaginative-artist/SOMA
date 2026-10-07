import sys
import json
import asyncio
import os
import urllib.parse
import urllib.request
try:
    from playwright.async_api import async_playwright
except:
    async_playwright = None
try:
    import arxiv
except:
    arxiv = None
try:
    from playwright_stealth import stealth_async
    _STEALTH = True
except:
    _STEALTH = False

class MlResearcher:
    def __init__(self):
        self.browser = None
        self.philosophy_terms = {
            "plato", "socrates", "aristotle", "stoic", "stoicism", "metaphysics",
            "ontology", "epistemology", "phenomenology", "existentialism",
            "consciousness", "personhood", "selfhood", "soul", "virtue",
            "ethics", "memory", "identity", "neoplatonism", "archetype",
            "mythopoetic", "care ethics", "dialogue"
        }

    def _is_philosophy_query(self, query):
        q = (query or "").lower()
        return any(term in q for term in self.philosophy_terms)

    async def _fetch_json(self, url):
        def _read():
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "SOMA-ReflectiveResearch/1.0"}
            )
            with urllib.request.urlopen(req, timeout=15) as response:
                return json.loads(response.read().decode("utf-8", errors="replace"))
        return await asyncio.to_thread(_read)

    async def search_wikipedia(self, query, limit=4):
        encoded = urllib.parse.urlencode({
            "action": "query",
            "list": "search",
            "srsearch": query,
            "format": "json",
            "utf8": 1,
            "srlimit": max(1, min(int(limit or 4), 8)),
        })
        data = await self._fetch_json(f"https://en.wikipedia.org/w/api.php?{encoded}")
        results = []
        for item in data.get("query", {}).get("search", []):
            title = item.get("title", "")
            snippet = (item.get("snippet", "") or "").replace("<span class=\"searchmatch\">", "").replace("</span>", "")
            results.append({
                "title": title,
                "summary": snippet,
                "url": f"https://en.wikipedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'))}",
                "source": "wikipedia",
            })
        return results

    async def search_open_library(self, query, limit=4):
        encoded = urllib.parse.urlencode({
            "q": query,
            "limit": max(1, min(int(limit or 4), 8)),
        })
        data = await self._fetch_json(f"https://openlibrary.org/search.json?{encoded}")
        results = []
        for item in data.get("docs", [])[:limit]:
            title = item.get("title", "")
            authors = item.get("author_name", [])[:3]
            key = item.get("key", "")
            first_year = item.get("first_publish_year")
            results.append({
                "title": title,
                "summary": f"{' / '.join(authors) if authors else 'Unknown author'}"
                           f"{f' · first published {first_year}' if first_year else ''}",
                "url": f"https://openlibrary.org{key}" if key else "https://openlibrary.org",
                "source": "openlibrary",
                "authors": authors,
                "published": str(first_year) if first_year else "",
            })
        return results

    async def search_philosophy(self, query, max_results=5):
        limit = max(1, min(int(max_results or 5), 10))
        results = []
        errors = []

        try:
            results.extend(await self.search_wikipedia(query, limit=3))
        except Exception as e:
            errors.append(f"wikipedia: {e}")

        try:
            results.extend(await self.search_open_library(query, limit=3))
        except Exception as e:
            errors.append(f"openlibrary: {e}")

        source_leads = [
            {
                "title": f"Stanford Encyclopedia of Philosophy search: {query}",
                "summary": "Curated philosophy source lead. Use this for deeper human review and future ingestion.",
                "url": f"https://plato.stanford.edu/search/searcher.py?query={urllib.parse.quote(query)}",
                "source": "stanford-encyclopedia-lead",
            },
            {
                "title": f"Internet Encyclopedia of Philosophy search: {query}",
                "summary": "Curated philosophy source lead for accessible philosophical overview material.",
                "url": f"https://iep.utm.edu/?s={urllib.parse.quote(query)}",
                "source": "iep-lead",
            },
            {
                "title": f"Project Gutenberg search: {query}",
                "summary": "Public-domain classics source lead for Plato, Aristotle, Stoic texts, and related works.",
                "url": f"https://www.gutenberg.org/ebooks/search/?query={urllib.parse.quote(query)}",
                "source": "gutenberg-lead",
            },
        ]

        seen = set()
        deduped = []
        for item in results + source_leads:
            key = (item.get("title", "").lower(), item.get("url", ""))
            if key in seen:
                continue
            seen.add(key)
            deduped.append(item)

        return {
            "success": True,
            "source": "philosophy-humanities",
            "mode": "reflective-research",
            "errors": errors,
            "data": deduped[:limit],
        }

    async def search_arxiv(self, query, max_results=5):
        if arxiv is None:
            return {"success": False, "source": "arxiv", "error": "Python package 'arxiv' is not installed"}
        limit = max(1, min(int(max_results or 5), 10))
        client = arxiv.Client(page_size=limit, delay_seconds=3.0, num_retries=2)
        search = arxiv.Search(
            query=query,
            max_results=limit,
            sort_by=arxiv.SortCriterion.Relevance
        )
        results = []
        for r in client.results(search):
            results.append({
                "title": r.title,
                "summary": r.summary,
                "pdf_url": r.pdf_url,
                "published": str(r.published),
                "authors": [a.name for a in r.authors]
            })
        return {"success": True, "source": "arxiv", "data": results}

    async def scrape_hf(self, url):
        if async_playwright is None:
            return {"success": False, "source": "huggingface", "error": "Python package 'playwright' is not installed"}
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context()
            page = await context.new_page()
            if _STEALTH:
                await stealth_async(page)
            
            await page.goto(url, wait_until="networkidle")
            # Extract basic model/dataset info
            title = await page.title()
            content = await page.content()
            
            # Look for GitHub links or README content
            readme = await page.inner_text("div.prose") if await page.query_selector("div.prose") else ""
            
            await browser.close()
            return {
                "success": True, 
                "source": "huggingface", 
                "title": title, 
                "readme_preview": readme[:2000],
                "url": url
            }

    async def execute(self, task, payload):
        if task == "search_papers":
            query = payload.get("query", "")
            if self._is_philosophy_query(query):
                return await self.search_philosophy(query, payload.get("limit", 5))
            return await self.search_arxiv(query, payload.get("limit", 5))
        elif task == "inspect_hf":
            return await self.scrape_hf(payload.get("url", ""))
        else:
            return {"success": False, "error": f"Unknown task: {task}"}

async def main():
    researcher = MlResearcher()
    try:
        raw_input = sys.stdin.read().strip()
        if not raw_input:
            print(json.dumps({"success": False, "error": "No input"}))
            return

        cmd = json.loads(raw_input)
        result = await researcher.execute(cmd.get("task"), cmd.get("payload", {}))
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    asyncio.run(main())

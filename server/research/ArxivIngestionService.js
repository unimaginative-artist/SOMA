import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import AiTrainingDistiller from './AiTrainingDistiller.js';

const ARXIV_API_BASE = 'https://export.arxiv.org/api/query';

function stripText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function safeJsonRead(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export class ArxivIngestionService {
  constructor(config = {}) {
    this.root = config.root || process.cwd();
    this.dataDir = config.dataDir || path.join(this.root, 'data', 'research', 'arxiv');
    this.corpusPath = path.join(this.dataDir, 'papers', 'corpus.json');
    this.auditPath = path.join(this.dataDir, 'papers', 'ingestion-events.jsonl');
    this.distiller = config.distiller || new AiTrainingDistiller({ root: this.root });
  }

  _readCorpus() {
    const corpus = safeJsonRead(this.corpusPath, { version: 1, papers: [], findings: [], updatedAt: null });
    return {
      version: 1,
      papers: Array.isArray(corpus.papers) ? corpus.papers : [],
      findings: Array.isArray(corpus.findings) ? corpus.findings : [],
      updatedAt: corpus.updatedAt || null
    };
  }

  _writeCorpus(corpus) {
    fs.mkdirSync(path.dirname(this.corpusPath), { recursive: true });
    const next = { ...corpus, updatedAt: new Date().toISOString() };
    fs.writeFileSync(this.corpusPath, JSON.stringify(next, null, 2), 'utf8');
    return next;
  }

  _audit(event) {
    try {
      fs.mkdirSync(path.dirname(this.auditPath), { recursive: true });
      fs.appendFileSync(this.auditPath, `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`, 'utf8');
    } catch {}
  }

  /**
   * Search ArXiv for AI architecture papers
   * @param {string} query - Keyword search e.g. "speculative decoding" or "agent memory"
   * @param {object} options - { limit = 8, categories = ['cs.AI', 'cs.LG', 'cs.SE', 'cs.CL'], sortBy = 'relevance' }
   */
  async searchPapers(query, { limit = 8, categories = ['cs.AI', 'cs.LG', 'cs.SE', 'cs.CL'], sortBy = 'relevance', sortOrder = 'descending' } = {}) {
    const cleanQuery = stripText(query);
    if (!cleanQuery) throw new Error('query is required');

    const cappedLimit = Math.max(1, Math.min(Number(limit) || 8, 25));

    // Build ArXiv query: search keywords across title/abstract and filter by CS categories
    const catQuery = categories.map(c => `cat:${c}`).join(' OR ');
    const searchQuery = `(${encodeURIComponent(cleanQuery)}) AND (${catQuery})`;
    const url = `${ARXIV_API_BASE}?search_query=${searchQuery}&start=0&max_results=${cappedLimit}&sortBy=${sortBy}&sortOrder=${sortOrder}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`ArXiv search failed with HTTP ${res.status}`);

    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });

    const papers = [];
    $('entry').each((_, entryEl) => {
      const $entry = $(entryEl);
      const rawId = stripText($entry.find('id').text());
      const arxivIdMatch = rawId.match(/abs\/([^/]+)$/) || rawId.match(/arxiv\.org\/abs\/(.+)$/);
      const arxivId = arxivIdMatch ? arxivIdMatch[1] : rawId.replace(/https?:\/\/arxiv\.org\/abs\//, '');

      const title = stripText($entry.find('title').text());
      const summary = stripText($entry.find('summary').text());
      const publishedAt = stripText($entry.find('published').text());
      const updatedAt = stripText($entry.find('updated').text());

      const authors = [];
      $entry.find('author name').each((__, nameEl) => {
        const name = stripText($(nameEl).text());
        if (name) authors.push(name);
      });

      const entryCategories = [];
      $entry.find('category').each((__, catEl) => {
        const term = $(catEl).attr('term');
        if (term) entryCategories.push(term);
      });

      let pdfUrl = null;
      $entry.find('link').each((__, linkEl) => {
        const $link = $(linkEl);
        if ($link.attr('title') === 'pdf' || $link.attr('type') === 'application/pdf') {
          pdfUrl = $link.attr('href');
        }
      });
      if (!pdfUrl && arxivId) {
        pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;
      }

      papers.push({
        id: rawId,
        arxivId,
        title,
        summary,
        authors: authors.slice(0, 10),
        categories: entryCategories,
        publishedAt,
        updatedAt,
        url: rawId,
        pdfUrl,
        source: 'arxiv'
      });
    });

    return {
      query: cleanQuery,
      source: 'arxiv',
      count: papers.length,
      papers,
      searchedAt: new Date().toISOString()
    };
  }

  /**
   * Extract architectural mechanisms and claims from paper abstract
   */
  extractArchitecturalFindings(paper) {
    const text = stripText(paper.summary || '');
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map(stripText)
      .filter(s => s.length >= 40 && s.length <= 400);

    const mechanismRegex = /\b(propose|introduce|present|architecture|framework|algorithm|mechanism|pipeline|design|technique|method|system|module)\b/i;
    const performanceRegex = /\b(outperform|achieve|speedup|latency|throughput|reduce|efficiency|accuracy|benchmark|state-of-the-art|sota|evaluat|improvement|percent|%|faster)\b/i;
    const limitationRegex = /\b(limitation|trade-off|overhead|computational cost|memory constraint|bound|bottleneck|failure)\b/i;

    const mechanisms = sentences.filter(s => mechanismRegex.test(s)).slice(0, 5);
    const findings = sentences.filter(s => performanceRegex.test(s)).slice(0, 5);
    const limitations = sentences.filter(s => limitationRegex.test(s)).slice(0, 3);

    return {
      arxivId: paper.arxivId,
      title: paper.title,
      mechanisms,
      findings,
      limitations,
      extractedAt: new Date().toISOString()
    };
  }

  /**
   * Ingest a single paper: stores in corpus and distills into SOMA's lobes
   */
  async ingestPaper(paper) {
    const corpus = this._readCorpus();
    const existingIndex = corpus.papers.findIndex(p => (p.arxivId && p.arxivId === paper.arxivId) || p.id === paper.id);

    const extraction = this.extractArchitecturalFindings(paper);

    if (existingIndex >= 0) {
      corpus.papers[existingIndex] = { ...corpus.papers[existingIndex], ...paper, reIngestedAt: new Date().toISOString() };
    } else {
      corpus.papers.push({ ...paper, ingestedAt: new Date().toISOString() });
    }

    corpus.findings.push(extraction);
    this._writeCorpus(corpus);

    // Distill into SOMA's lobes
    const distillation = this.distiller.distillPaper(paper, extraction);

    this._audit({
      type: 'arxiv_paper_ingested',
      arxivId: paper.arxivId,
      title: paper.title,
      lobes: distillation.lobes,
      knowledgeFiles: distillation.knowledgeFiles
    });

    return {
      success: true,
      paper: { arxivId: paper.arxivId, title: paper.title },
      distillation,
      totalInCorpus: corpus.papers.length
    };
  }

  /**
   * High-level: search ArXiv and automatically ingest the top N results
   */
  async searchAndIngest(query, { limit = 3, categories } = {}) {
    const searchResult = await this.searchPapers(query, { limit, categories });
    const ingested = [];

    for (const paper of searchResult.papers) {
      try {
        const result = await this.ingestPaper(paper);
        ingested.push(result);
      } catch (err) {
        console.warn(`[ArxivIngestionService] Failed to ingest ${paper.arxivId}:`, err.message);
      }
    }

    return {
      query,
      found: searchResult.count,
      ingestedCount: ingested.length,
      ingested
    };
  }

  /**
   * Returns current corpus stats
   */
  getCorpusStatus() {
    const corpus = this._readCorpus();
    return {
      paperCount: corpus.papers.length,
      findingCount: corpus.findings.length,
      updatedAt: corpus.updatedAt,
      recentPapers: corpus.papers.slice(-5).map(p => ({ arxivId: p.arxivId, title: p.title, publishedAt: p.publishedAt }))
    };
  }
}

export default ArxivIngestionService;

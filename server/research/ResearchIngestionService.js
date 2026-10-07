import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import MedicalManuscriptStandardizer from './MedicalManuscriptStandardizer.js';
import MedicalDiscoveryScoreboard from './MedicalDiscoveryScoreboard.js';

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

const slugValue = (value = 'untitled') => String(value)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 90) || 'untitled';

const frontmatterValue = (value) => JSON.stringify(String(value || ''));

function safeJsonRead(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function stripText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function articleId(summary, type) {
  const ids = summary?.articleids || [];
  return ids.find(item => String(item.idtype || '').toLowerCase() === type)?.value || null;
}

export class ResearchIngestionService {
  constructor(config = {}) {
    this.root = config.root || process.cwd();
    this.dataDir = config.dataDir || path.join(this.root, 'data', 'research');
    this.corpusPath = path.join(this.dataDir, 'papers', 'corpus.json');
    this.auditPath = path.join(this.dataDir, 'papers', 'ingestion-events.jsonl');
    this.reflectionsPath = config.reflectionsPath || path.join(this.root, 'data', 'vault', 'reflections');
    this.manuscriptStandardizer = new MedicalManuscriptStandardizer();
    this.discoveryScoreboard = new MedicalDiscoveryScoreboard({ root: this.root });
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

  async _fetchJson(url, label) {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`${label} failed: ${res.status}`);
    return res.json();
  }

  async _fetchText(url, label) {
    const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`${label} failed: ${res.status}`);
    return res.text();
  }

  async searchPapers(query, { limit = 8, source = 'pubmed' } = {}) {
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) throw new Error('query is required');
    const cappedLimit = Math.max(1, Math.min(Number(limit) || 8, 20));
    if (source !== 'pubmed') throw new Error('v1 supports PubMed/PMC ingestion only');

    const searchUrl = `${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax=${cappedLimit}&term=${encodeURIComponent(cleanQuery)}`;
    const search = await this._fetchJson(searchUrl, 'PubMed search');
    const ids = search?.esearchresult?.idlist || [];
    if (!ids.length) {
      return { query: cleanQuery, source, papers: [], searchedAt: new Date().toISOString() };
    }

    const summaryUrl = `${EUTILS}/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`;
    const summary = await this._fetchJson(summaryUrl, 'PubMed summary');
    const papers = ids.map((id) => {
      const item = summary?.result?.[id] || {};
      const pmcid = articleId(item, 'pmc');
      const doi = articleId(item, 'doi');
      return {
        id: `pmid:${id}`,
        pmid: id,
        pmcid,
        doi,
        title: stripText(item.title || 'Untitled paper'),
        journal: stripText(item.fulljournalname || item.source || ''),
        authors: (item.authors || []).slice(0, 8).map(author => author.name).filter(Boolean),
        publishedAt: item.pubdate || null,
        source: 'pubmed',
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        fullTextAvailable: !!pmcid,
        evidenceType: item.pubtype || []
      };
    });

    return { query: cleanQuery, source, papers, searchedAt: new Date().toISOString() };
  }

  async fetchPaperFullText(paper) {
    const abstractUrl = `${EUTILS}/efetch.fcgi?db=pubmed&retmode=xml&id=${paper.pmid}`;
    const abstractXml = await this._fetchText(abstractUrl, 'PubMed abstract');
    const $abstract = cheerio.load(abstractXml, { xmlMode: true });
    const abstract = $abstract('AbstractText')
      .map((_, el) => stripText($abstract(el).text()))
      .get()
      .filter(Boolean)
      .join('\n\n');

    let fullText = '';
    let fullTextSource = 'abstract_only';
    if (paper.pmcid) {
      try {
        const pmcId = String(paper.pmcid).replace(/^PMC/i, '');
        const pmcXml = await this._fetchText(`${EUTILS}/efetch.fcgi?db=pmc&retmode=xml&id=${encodeURIComponent(pmcId)}`, 'PMC full text');
        const $ = cheerio.load(pmcXml, { xmlMode: true });
        const paragraphs = $('body p')
          .map((_, el) => stripText($(el).text()))
          .get()
          .filter(text => text.length > 40)
          .slice(0, 120);
        fullText = paragraphs.join('\n\n');
        if (fullText) fullTextSource = 'pmc_open_access_full_text';
      } catch (error) {
        fullText = '';
        fullTextSource = `pmc_fetch_failed:${error.message}`;
      }
    }

    return {
      abstract,
      fullText,
      fullTextSource,
      textForAnalysis: [abstract, fullText].filter(Boolean).join('\n\n').slice(0, 60_000)
    };
  }

  extractFindings(paper, text) {
    const clean = stripText(text);
    const sentences = clean
      .split(/(?<=[.!?])\s+/)
      .map(stripText)
      .filter(sentence => sentence.length >= 60 && sentence.length <= 450);

    const claimWords = /\b(associated|increased|decreased|inhibited|activated|regulated|correlated|significant|mutation|expression|resistance|pathway|mechanism|risk|survival|response)\b/i;
    const limitationWords = /\b(limitations?|small sample|retrospective|in vitro|mouse|murine|preclinical|observational|further studies|not significant|no significant)\b/i;
    const contradictionWords = /\b(however|whereas|although|contrary|conflicting|in contrast|failed to|did not)\b/i;

    const claims = sentences.filter(sentence => claimWords.test(sentence)).slice(0, 6);
    const limitations = sentences.filter(sentence => limitationWords.test(sentence)).slice(0, 5);
    const contradictions = sentences.filter(sentence => contradictionWords.test(sentence)).slice(0, 5);

    return {
      paperId: paper.id,
      title: paper.title,
      claims,
      limitations,
      contradictions,
      evidenceClass: paper.fullTextAvailable ? 'open_access_full_text_or_abstract' : 'abstract_metadata_only',
      extractionNote: 'Heuristic v1 extraction for research triage; not clinical evidence grading.'
    };
  }

  compareFindings(papers, findings) {
    const termCounts = new Map();
    const importantTerms = /\b(TP53|KRAS|PCSK9|APP|ACE2|mutation|resistance|inflammation|amyloid|microglial|LDLR|synthetic lethality|pathway|expression|survival|response)\b/gi;
    for (const finding of findings) {
      const text = [...(finding.claims || []), ...(finding.limitations || []), ...(finding.contradictions || [])].join(' ');
      for (const match of text.matchAll(importantTerms)) {
        const key = match[0].toLowerCase();
        termCounts.set(key, (termCounts.get(key) || 0) + 1);
      }
    }
    const sharedTerms = Array.from(termCounts.entries())
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([term, count]) => ({ term, count }));

    return {
      paperCount: papers.length,
      fullTextCount: papers.filter(paper => paper.fullTextAvailable).length,
      abstractOnlyCount: papers.filter(paper => !paper.fullTextAvailable).length,
      claimCount: findings.reduce((sum, item) => sum + (item.claims?.length || 0), 0),
      limitationCount: findings.reduce((sum, item) => sum + (item.limitations?.length || 0), 0),
      contradictionCount: findings.reduce((sum, item) => sum + (item.contradictions?.length || 0), 0),
      sharedTerms,
      possibleMisses: sharedTerms.slice(0, 5).map(item => `Repeated signal "${item.term}" appears across ${item.count} extracted findings; review for cross-paper mechanism overlap.`)
    };
  }

  _ensureResearchScaffold() {
    fs.mkdirSync(this.reflectionsPath, { recursive: true });
    const now = new Date().toISOString();
    const files = [
      {
        filename: 'workbook.soma-research.md',
        body: [
          '---',
          'title: "SOMA Research"',
          'type: workbook',
          'status: active',
          `createdAt: ${now}`,
          'tags: [reflections, research, soma]',
          '---',
          '',
          '# SOMA Research',
          '',
          'Research workbook for structured paper ingestion, extracted findings, contradictions, and research-only dossiers.'
        ].join('\n')
      },
      {
        filename: 'segment.soma-research.medical-literature.md',
        body: [
          '---',
          'title: "Medical Literature"',
          'type: segment',
          'workbook: "SOMA Research"',
          'parent: "SOMA Research"',
          'status: active',
          `createdAt: ${now}`,
          'tags: [reflections, research, medical-literature]',
          '---',
          '',
          '# Medical Literature',
          '',
          'Ingested medical papers and extracted research findings.'
        ].join('\n')
      },
      {
        filename: 'segment.soma-research.contradictions.md',
        body: [
          '---',
          'title: "Contradictions"',
          'type: segment',
          'workbook: "SOMA Research"',
          'parent: "SOMA Research"',
          'status: active',
          `createdAt: ${now}`,
          'tags: [reflections, research, contradictions]',
          '---',
          '',
          '# Contradictions',
          '',
          'Cross-paper tensions, negative findings, and unresolved evidence conflicts.'
        ].join('\n')
      }
    ];
    for (const file of files) {
      const filePath = path.join(this.reflectionsPath, file.filename);
      if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, file.body, 'utf8');
    }
  }

  publishCorpusToReflections({ query, papers, findings, comparison }) {
    this._ensureResearchScaffold();
    const now = new Date().toISOString();
    const safeQuery = slugValue(query);
    const title = `Research Corpus: ${query}`;
    const standardized = this.manuscriptStandardizer.standardizeCorpus({ query, papers, findings, comparison });
    const filename = `folio.research.medical-literature.${safeQuery}.${Date.now()}.md`;
    const filePath = path.join(this.reflectionsPath, filename);
    const paperLines = papers.map((paper, index) => [
      `### ${index + 1}. ${paper.title}`,
      '',
      `- PMID: ${paper.pmid || 'N/A'}`,
      `- PMCID: ${paper.pmcid || 'N/A'}`,
      `- DOI: ${paper.doi || 'N/A'}`,
      `- Journal: ${paper.journal || 'N/A'}`,
      `- Published: ${paper.publishedAt || 'N/A'}`,
      `- Full text: ${paper.fullTextAvailable ? 'PMC/open-access available' : 'abstract/metadata only'}`,
      `- URL: ${paper.url}`,
      '',
      '#### Extracted Claims',
      '',
      ...(findings[index]?.claims?.length ? findings[index].claims.map(item => `- ${item}`) : ['- No claim sentences extracted by v1 heuristics.']),
      '',
      '#### Limitations',
      '',
      ...(findings[index]?.limitations?.length ? findings[index].limitations.map(item => `- ${item}`) : ['- No limitation sentences extracted by v1 heuristics.']),
      '',
      '#### Contradictions Or Tensions',
      '',
      ...(findings[index]?.contradictions?.length ? findings[index].contradictions.map(item => `- ${item}`) : ['- No contradiction sentences extracted by v1 heuristics.'])
    ].join('\n')).join('\n\n');

    const body = [
      '---',
      `title: ${frontmatterValue(title)}`,
      'type: folio',
      'status: inbox',
      'workbook: "SOMA Research"',
      'segment: "Medical Literature"',
      'parent: "Medical Literature"',
      `createdAt: ${now}`,
      `query: ${frontmatterValue(query)}`,
      `manuscriptStandard: ${frontmatterValue(standardized.guideline.name)}`,
      `manuscriptReadiness: ${frontmatterValue(standardized.quality.status)}`,
      `manuscriptScore: ${standardized.quality.score}`,
      'tags: [reflections, research, medical-literature, paper-corpus, medical-manuscript]',
      '---',
      '',
      `# ${title}`,
      '',
      '> Research-only literature corpus. Not medical advice. No diagnosis, treatment, dosing, or cure claims.',
      '',
      '## Corpus Summary',
      '',
      `- Papers ingested: ${comparison.paperCount}`,
      `- Full text available: ${comparison.fullTextCount}`,
      `- Abstract/metadata only: ${comparison.abstractOnlyCount}`,
      `- Extracted claims: ${comparison.claimCount}`,
      `- Extracted limitations: ${comparison.limitationCount}`,
      `- Extracted contradictions: ${comparison.contradictionCount}`,
      '',
      '## Possible Cross-Paper Signals',
      '',
      ...(comparison.possibleMisses?.length ? comparison.possibleMisses.map(item => `- ${item}`) : ['- No repeated signals found yet.']),
      '',
      '## Shared Terms',
      '',
      ...(comparison.sharedTerms?.length ? comparison.sharedTerms.map(item => `- ${item.term}: ${item.count}`) : ['- None detected.']),
      '',
      '## Papers',
      '',
      paperLines,
      '',
      '## Manuscript-Ready Evidence Map',
      '',
      standardized.manuscript
    ].join('\n');

    fs.writeFileSync(filePath, body, 'utf8');
    return { filename, path: filePath, manuscript: standardized };
  }

  async ingestMedicalPapers(query, options = {}) {
    const search = await this.searchPapers(query, options);
    const papers = [];
    const findings = [];
    const limit = Math.max(1, Math.min(Number(options.limit) || search.papers.length || 5, 10));

    for (const paper of search.papers.slice(0, limit)) {
      const text = await this.fetchPaperFullText(paper).catch(error => ({
        abstract: '',
        fullText: '',
        fullTextSource: `fetch_failed:${error.message}`,
        textForAnalysis: ''
      }));
      const enriched = {
        ...paper,
        abstract: text.abstract,
        fullTextSource: text.fullTextSource,
        fullTextChars: text.fullText?.length || 0,
        ingestedAt: new Date().toISOString()
      };
      papers.push(enriched);
      findings.push(this.extractFindings(enriched, text.textForAnalysis || text.abstract || paper.title));
    }

    const comparison = this.compareFindings(papers, findings);
    const corpus = this._readCorpus();
    const existing = new Map(corpus.papers.map(paper => [paper.id, paper]));
    for (const paper of papers) existing.set(paper.id, paper);
    const nextFindings = [...findings, ...corpus.findings].slice(0, 500);
    const written = this._writeCorpus({
      ...corpus,
      papers: Array.from(existing.values()).slice(-500),
      findings: nextFindings
    });
    const reflection = this.publishCorpusToReflections({ query: search.query, papers, findings, comparison });
    const scoreboardEntry = this.discoveryScoreboard.record({
      outcome: 'literature_ingested',
      target: 'PAPER_CORPUS',
      strand: search.query,
      query: search.query,
      category: 'Medical literature ingestion',
      evidenceGrade: reflection.manuscript?.quality?.status || (comparison.fullTextCount > 0 ? 'literature corpus' : 'abstract metadata corpus'),
      manuscriptScore: reflection.manuscript?.quality?.score,
      readiness: reflection.manuscript?.reviewState?.state,
      citationIntegrity: reflection.manuscript?.citationIntegrity?.status,
      reflectionPath: reflection.path,
      lesson: `Ingested ${papers.length} paper(s), ${comparison.claimCount} claims, ${comparison.limitationCount} limitations, ${comparison.contradictionCount} tensions for "${search.query}".`
    });
    this._audit({ type: 'medical_paper_ingestion', query: search.query, paperCount: papers.length, reflection });

    return {
      success: true,
      query: search.query,
      papers,
      findings,
      comparison,
      reflection,
      scoreboard: scoreboardEntry,
      corpus: this.summarizeCorpus(written)
    };
  }

  summarizeCorpus(corpus = this._readCorpus()) {
    const papers = corpus.papers || [];
    const findings = corpus.findings || [];
    return {
      paperCount: papers.length,
      findingCount: findings.length,
      fullTextCount: papers.filter(paper => paper.fullTextAvailable).length,
      abstractOnlyCount: papers.filter(paper => !paper.fullTextAvailable).length,
      updatedAt: corpus.updatedAt,
      recentPapers: papers.slice(-8).reverse(),
      recentFindings: findings.slice(0, 8),
      discoveryScoreboard: this.discoveryScoreboard.summary(8)
    };
  }
}

export default ResearchIngestionService;

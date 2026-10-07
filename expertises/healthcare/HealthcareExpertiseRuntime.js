import { ExpertiseBase } from '../../core/ExpertiseBase.js';
import MedicalManuscriptStandardizer from '../../server/research/MedicalManuscriptStandardizer.js';

const trim = (value = '', max = 3000) => String(value || '').trim().slice(0, max);

export class HealthcareExpertiseRuntime extends ExpertiseBase {
  constructor(config = {}) {
    super({
      ...config,
      name: 'HealthcareExpertise',
      category: 'Healthcare',
      version: '0.2.0'
    });
    this.manifest = config.manifest || config.expertiseManifest || {};
    this.manuscriptStandardizer = new MedicalManuscriptStandardizer();
  }

  async getPhases() {
    return ['SAFETY_SCOPE', 'STUDY_TYPE', 'EVIDENCE_TABLE', 'CLAIMS_BOUNDARY', 'REPORTING_CHECKLIST', 'OUTPUT'];
  }

  getStatus() {
    return {
      ...super.getStatus(),
      id: this.manifest.id || 'healthcare',
      persona: 'SOMA Healthcare Evidence Expertise',
      manuscriptStandards: ['ICMJE', 'EQUATOR', 'PRISMA-inspired', 'STROBE-inspired', 'CONSORT-aware', 'ARRIVE-inspired', 'CARE-aware', 'RoB 2', 'ROBINS-I', 'SYRCLE', 'QUADAS-2'],
      modes: ['manuscript', 'checklist', 'claims', 'evidence_table', 'risk_of_bias', 'citation_integrity', 'figures_tables', 'journal_target', 'standardize']
    };
  }

  async runMission(target = {}) {
    const request = typeof target === 'string'
      ? { prompt: target, mode: 'standardize' }
      : { mode: 'standardize', ...target };
    const mode = String(request.mode || 'standardize').toLowerCase();
    const startedAt = Date.now();
    const text = request.text || request.prompt || request.manuscript || request.content || '';

    let structured;
    if (mode === 'claims' || mode === 'claim_audit') {
      structured = {
        success: true,
        mode,
        claims: this.manuscriptStandardizer.extractClaims(text)
      };
    } else if (mode === 'checklist') {
      const type = request.type || this.manuscriptStandardizer.classifyStudyType({ rawText: text, title: request.title });
      structured = {
        success: true,
        mode,
        type,
        guideline: this.manuscriptStandardizer.guidelineFor(type)
      };
    } else if (mode === 'evidence_table') {
      const evidenceRows = this.manuscriptStandardizer.buildEvidenceRows({
        sourceLedger: request.sourceLedger,
        papers: request.papers || [],
        findings: request.findings || []
      });
      structured = {
        success: true,
        mode,
        evidenceRows,
        markdown: this.manuscriptStandardizer.evidenceTableMarkdown(evidenceRows)
      };
    } else if (mode === 'risk_of_bias' || mode === 'bias') {
      const type = request.type || this.manuscriptStandardizer.classifyStudyType({ rawText: text, title: request.title });
      const evidenceRows = this.manuscriptStandardizer.buildEvidenceRows({
        sourceLedger: request.sourceLedger,
        papers: request.papers || [],
        findings: request.findings || []
      });
      structured = {
        success: true,
        mode,
        type,
        riskOfBias: this.manuscriptStandardizer.assessRiskOfBias(type, evidenceRows, { rawText: text })
      };
    } else if (mode === 'citation_integrity' || mode === 'citations') {
      const claims = this.manuscriptStandardizer.extractClaims(text);
      const evidenceRows = this.manuscriptStandardizer.buildEvidenceRows({
        sourceLedger: request.sourceLedger,
        papers: request.papers || [],
        findings: request.findings || []
      });
      structured = {
        success: true,
        mode,
        claims,
        evidenceRows,
        citationIntegrity: this.manuscriptStandardizer.auditCitationIntegrity(claims, evidenceRows)
      };
    } else {
      const standardized = this.manuscriptStandardizer.standardize({
        type: request.type,
        title: request.title || 'SOMA Medical Manuscript Draft',
        rawText: text,
        sourceLedger: request.sourceLedger,
        papers: request.papers || [],
        findings: request.findings || [],
        evidenceGrade: request.evidenceGrade,
        safetyReport: request.safetyReport,
        replicationPlan: request.replicationPlan,
        objective: request.objective,
        researchQuestion: request.researchQuestion,
        mission: request.mission
      });
      structured = {
        success: true,
        mode,
        ...standardized
      };
    }

    this.metrics.missionsCompleted++;
    this.metrics.lastRun = Date.now();
    this.metrics.avgConfidence = 0.82;

    return {
      success: true,
      mode,
      persona: 'Healthcare Evidence Expertise',
      elapsedMs: Date.now() - startedAt,
      response: this._formatResponse(structured),
      structured
    };
  }

  _formatResponse(result = {}) {
    if (result.manuscript) {
      return [
        `Medical manuscript draft: ${result.guideline?.name || result.type}`,
        `Readiness: ${result.quality?.status || 'unknown'} (${result.quality?.score ?? 'n/a'})`,
        result.reviewState ? `Review state: ${result.reviewState.state}` : '',
        result.citationIntegrity ? `Citation integrity: ${result.citationIntegrity.status}` : '',
        '',
        trim(result.manuscript, 2600)
      ].filter(Boolean).join('\n');
    }
    if (result.markdown) return trim(result.markdown, 2600);
    if (result.claims) {
      return [
        `Claims audited: ${result.claims.length}`,
        ...result.claims.slice(0, 12).map((claim, index) => `${index + 1}. [${claim.boundary}] ${claim.text}`)
      ].join('\n');
    }
    if (result.guideline) {
      return [
        `Selected guideline: ${result.guideline.name}`,
        `Standards: ${result.guideline.standards.join(', ')}`,
        ...result.guideline.checklist.map(item => `- ${item}`)
      ].join('\n');
    }
    if (result.riskOfBias) {
      return [
        `Risk-of-bias tool: ${result.riskOfBias.tool}`,
        `Overall: ${result.riskOfBias.overall}`,
        ...result.riskOfBias.domains.map(domain => `- ${domain.label}: ${domain.rating}`)
      ].join('\n');
    }
    if (result.citationIntegrity) {
      return [
        `Citation integrity: ${result.citationIntegrity.status} (${result.citationIntegrity.score})`,
        ...result.citationIntegrity.auditedClaims.slice(0, 12).map(claim => `- ${claim.id}: ${claim.action} support=${claim.supportRows.join(', ') || 'none'}`)
      ].join('\n');
    }
    return trim(JSON.stringify(result, null, 2), 2600);
  }
}

export default HealthcareExpertiseRuntime;

import { ExpertiseBase } from '../../../core/ExpertiseBase.js';
import storyResearchLedger from '../../../server/social/StoryResearchLedger.js';
import storyWorkspace from '../../../server/social/StoryPublishingWorkspace.js';

const trim = (value = '', max = 5000) => String(value || '').trim().slice(0, max);

export class WriterExpertiseRuntime extends ExpertiseBase {
    constructor(config = {}) {
        super({
            ...config,
            name: 'WriterExpertise',
            category: 'Creative',
            version: '0.1.0',
        });
        this.manifest = config.manifest || config.expertiseManifest || {};
    }

    async getPhases() {
        return ['SCOUT', 'DISTILL', 'STORYBOARD', 'DRAFT', 'REFLECT'];
    }

    getStatus() {
        const state = storyResearchLedger.getState();
        return {
            ...super.getStatus(),
            id: this.manifest.id || 'creative/writer',
            persona: 'SOMA Writer Expertise',
            aurora: !!this._getAuroraBrain(),
            storyboards: state.boards?.length || 0,
            chapterReflections: state.chapterReflections?.length || 0,
            modes: ['scout', 'storyboard', 'chapter', 'critique', 'full'],
            revisionModes: ['draft', 'tighten', 'more_emotional', 'more_cinematic', 'less_weird', 'more_soma', 'more_human', 'fix_dialogue'],
            structures: storyResearchLedger.getStructureToolbox().map(item => item.name),
        };
    }

    async runMission(target = {}) {
        const request = typeof target === 'string'
            ? { prompt: target, mode: 'full' }
            : { mode: 'full', ...target };
        const mode = String(request.mode || 'full').toLowerCase();
        const brain = this._getAuroraBrain();
        const startedAt = Date.now();

        let result;
        if (mode === 'scout') {
            result = await storyResearchLedger.scoutInfluences({ limit: request.limit || 5 });
        } else if (mode === 'structures' || mode === 'structure') {
            result = {
                ok: true,
                toolbox: storyResearchLedger.getStructureToolbox(),
                suggested: storyResearchLedger.chooseCandidateStructures(request.prompt || request.query || request.mission || ''),
            };
        } else if (mode === 'storyboard' || mode === 'outline' || mode === 'board') {
            result = await storyResearchLedger.createStoryboard(brain, {
                mission: request.prompt || request.query || request.mission,
                title: request.title,
                limit: request.limit || 5,
            });
        } else if (mode === 'chapter' || mode === 'draft') {
            result = await storyWorkspace.generateFullChapter(brain, {
                title: request.title,
                chapterTitle: request.chapterTitle,
                targetWords: request.targetWords || 1600,
                useWriterBoard: request.useWriterBoard !== false,
                revisionMode: request.revisionMode || request.modeHint || 'draft',
            });
        } else if (mode === 'critique' || mode === 'reflect') {
            const status = storyWorkspace.getStatus();
            const latest = status.currentStory?.latestChapter;
            if (!latest) throw new Error('No story chapter exists to reflect on yet');
            result = {
                ok: false,
                note: 'Use a full chapter object for direct critique, or run mode=chapter first.',
                latest,
            };
        } else {
            const board = await storyResearchLedger.createStoryboard(brain, {
                mission: request.prompt || request.query || request.mission,
                title: request.title,
                limit: request.limit || 5,
            });
            const chapter = await storyWorkspace.generateFullChapter(brain, {
                title: request.title || board.board?.title,
                chapterTitle: request.chapterTitle,
                targetWords: request.targetWords || 1600,
                useWriterBoard: true,
                revisionMode: request.revisionMode || request.modeHint || 'draft',
            });
            result = { ok: true, board: board.board, chapter };
        }

        this.metrics.missionsCompleted++;
        this.metrics.lastRun = Date.now();
        this.metrics.avgConfidence = 0.86;

        return {
            success: true,
            mode,
            persona: 'Writer Expertise',
            brain: 'AURORA',
            elapsedMs: Date.now() - startedAt,
            response: this._formatResponse(result, mode),
            structured: result,
        };
    }

    _formatResponse(result, mode) {
        if (mode === 'scout') {
            return [
                `Scout complete: ${result.signals?.length || 0} influence signals.`,
                ...(result.signals || []).slice(0, 5).map(signal => `- ${signal.title || signal.category} (${signal.source})`),
            ].join('\n');
        }

        if (result?.board) {
            return [
                `Storyboard ready: ${result.board.title}`,
                result.board.reflectionPath ? `Saved: ${result.board.reflectionPath}` : '',
                '',
                result.board.structurePlan ? `Structure\n${trim(result.board.structurePlan, 1200)}\n` : '',
                trim(result.board.storyboard, 2400),
            ].filter(Boolean).join('\n');
        }

        if (result?.toolbox) {
            return [
                `Narrative structure toolbox: ${result.toolbox.length} methods`,
                ...(result.suggested || result.toolbox).slice(0, 10).map(item => `- ${item.name}: ${item.bestFor.join(', ')}`),
            ].join('\n');
        }

        if (result?.chapter) {
            return [
                `Chapter ready: ${result.title || ''} chapter ${result.chapter}`,
                `Words: ${result.wordCount}`,
                result.reflectionPath ? `Saved: ${result.reflectionPath}` : '',
                result.writerReflectionPath ? `Writer reflection: ${result.writerReflectionPath}` : '',
            ].filter(Boolean).join('\n');
        }

        return trim(JSON.stringify(result, null, 2), 3000);
    }

    _getAuroraBrain() {
        return this.system?.museEngine?.quadBrain || this.system?.quadBrain || this.system?.somArbiter || this.system?.brain || null;
    }
}

export default WriterExpertiseRuntime;

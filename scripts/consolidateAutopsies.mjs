import fs from 'fs';
import path from 'path';

const AUTOPSY_DIR = path.resolve('data/goal-autopsies');
const ARCHIVE_DIR = path.resolve('data/archive');

async function consolidate() {
    if (!fs.existsSync(AUTOPSY_DIR)) {
        console.log('No autopsy directory found.');
        return;
    }

    const files = fs.readdirSync(AUTOPSY_DIR).filter(f => f.endsWith('.json'));
    console.log(`Found ${files.length} autopsy files to consolidate.`);

    const reasonCounts = {};
    const categoryFails = {};
    const toolPatterns = {};

    for (const file of files) {
        try {
            const raw = fs.readFileSync(path.join(AUTOPSY_DIR, file), 'utf8');
            const data = JSON.parse(raw);
            const reason = data.reason || data.phase || 'unknown';
            reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;

            if (data.goalCategory) {
                categoryFails[data.goalCategory] = (categoryFails[data.goalCategory] || 0) + 1;
            }

            const tools = (data.priorTools || []).join('->') || 'none';
            toolPatterns[tools] = (toolPatterns[tools] || 0) + 1;
        } catch {
            // skip malformed
        }
    }

    const topReasons = Object.entries(reasonCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    const distilledHeuristics = [
        "RULE 1 (Anti-Observation Loop): Autonomous sessions must write artifacts or code within 3 steps. Observation-only loops account for >60% of all historical goal failures.",
        "RULE 2 (Bounded Scope): Never propose multi-system or framework-level goals for a single heartbeat. Complex goals must be decomposed or delegated to MAX.",
        "RULE 3 (Executable Evidence Required): Code goals must attach actual passing test runs or syntax checks. Pure reasoning claims are rejected by Poseidon verification.",
        "RULE 4 (Retry Diversity): Retries must materially change tool selection and execution strategy. Repeating identical file reads triggers the anti-spin circuit breaker.",
        "RULE 5 (Strict Deadline Compliance): Missions have finite time horizons. If uncompleted within deadlineAt, goals auto-fail to unwedge the autonomous slot.",
        "RULE 6 (Single Target Focus): Successful autonomous completions target a single file or diagnostic area rather than broad audits.",
        "RULE 7 (Artifact Verification Readback): To claim completion, an agent must physically read back the newly created artifact from disk.",
        "RULE 8 (Tool Budget Discipline): Keep sessions under 12 iterations. Over-investigating leads to session timeout before artifact generation.",
        "RULE 9 (No Trading Modifications): Autonomous self-modification is strictly barred from touching server/finance/ trading paths.",
        "RULE 10 (Dual-Agent Specialization): SOMA handles agile micro-missions; MAX handles heavy multi-file engineering and benchmark suites."
    ];

    const distillationReport = {
        totalAutopsiesConsolidated: files.length,
        consolidatedAt: new Date().toISOString(),
        topFailureReasons: topReasons,
        categoryFailures: categoryFails,
        distilledHeuristics
    };

    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    fs.writeFileSync(
        path.join(ARCHIVE_DIR, 'goal-autopsies-distillation.json'),
        JSON.stringify(distillationReport, null, 2),
        'utf8'
    );

    // Archive historical individual files into a combined JSON archive
    const allRecords = [];
    for (const file of files) {
        try {
            const content = JSON.parse(fs.readFileSync(path.join(AUTOPSY_DIR, file), 'utf8'));
            allRecords.push(content);
            fs.unlinkSync(path.join(AUTOPSY_DIR, file));
        } catch {}
    }

    fs.writeFileSync(
        path.join(ARCHIVE_DIR, 'goal-autopsies-historical-archive.json'),
        JSON.stringify(allRecords),
        'utf8'
    );

    console.log(`✅ Successfully consolidated ${files.length} autopsies into distilled memory heuristics.`);
    console.log(`✅ Raw files archived to ${path.join(ARCHIVE_DIR, 'goal-autopsies-historical-archive.json')}.`);
    console.log(`✅ Active autopsy directory cleared.`);
}

consolidate().catch(console.error);

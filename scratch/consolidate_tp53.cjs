const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'data', 'vault', 'reflections');
const files = fs.readdirSync(dir).filter(f => f.startsWith('folio.medlab.discovery.tp53.'));

const sections = {
    'KNOWN CONSENSUS': new Set(),
    'EMERGING OPPORTUNITIES': new Set(),
    'HIGH-NOVELTY HYPOTHESES': new Set(),
    'CONTRADICTIONS / TENSIONS': new Set(),
    'SUGGESTED EXPERIMENTS': new Set(),
    'BIOLOGICAL CONSTRAINTS': new Set()
};

const extractSection = (content, headerStart, headerEnd) => {
    const startIdx = content.indexOf(headerStart);
    if (startIdx === -1) return [];
    
    let endIdx = content.length;
    if (headerEnd) {
        const nextIdx = content.indexOf(headerEnd, startIdx);
        if (nextIdx !== -1) endIdx = nextIdx;
    }
    
    const block = content.substring(startIdx + headerStart.length, endIdx);
    // split by bullet points
    return block.split('\n- ').map(s => s.trim().replace(/^- /g, '')).filter(s => s.length > 5);
};

console.log(`Processing ${files.length} files...`);

for (const f of files) {
    const content = fs.readFileSync(path.join(dir, f), 'utf8');
    
    const known = extractSection(content, '1. ✅ KNOWN CONSENSUS\n', '\n2. 🟡 EMERGING OPPORTUNITIES');
    known.forEach(k => sections['KNOWN CONSENSUS'].add(k));

    const emerging = extractSection(content, '2. 🟡 EMERGING OPPORTUNITIES (Combinatorial Synergy)\n', '\n3. 🔴 HIGH-NOVELTY HYPOTHESES');
    emerging.forEach(e => sections['EMERGING OPPORTUNITIES'].add(e));

    const novelty = extractSection(content, '3. 🔴 HIGH-NOVELTY HYPOTHESES (Cross-domain Anomaly Clusters)\n', '\n4. ⚡ CONTRADICTIONS');
    novelty.forEach(n => sections['HIGH-NOVELTY HYPOTHESES'].add(n));

    const tensions = extractSection(content, '4. ⚡ CONTRADICTIONS / TENSIONS (The Tension Engine Results)\n', '\n5. 🔬 SUGGESTED EXPERIMENTS');
    tensions.forEach(t => sections['CONTRADICTIONS / TENSIONS'].add(t));

    const experiments = extractSection(content, '5. 🔬 SUGGESTED EXPERIMENTS (research-only falsification and replication checks)\n', '\n6. 🧬 BIOLOGICAL CONSTRAINTS');
    experiments.forEach(e => sections['SUGGESTED EXPERIMENTS'].add(e));

    const constraints = extractSection(content, '6. 🧬 BIOLOGICAL CONSTRAINTS (Mitochondrial/Enzymatic bottlenecks)\n', null);
    constraints.forEach(c => sections['BIOLOGICAL CONSTRAINTS'].add(c));
}

let masterContent = `---
title: "Master Consolidated TP53 Folio"
type: folio
status: consolidated
workbook: "SOMA MedLab"
segment: "Discovery Missions"
parent: "Discovery Missions"
createdAt: ${new Date().toISOString()}
tags: [reflections, folio, medlab, discovery-mission, consolidated]
---

# Master Consolidated TP53 Folio

> Research-only dry-lab artifact. Consolidated from ${files.length} raw semantic crawls.

## 1. ✅ KNOWN CONSENSUS
`;

sections['KNOWN CONSENSUS'].forEach(k => { masterContent += `- ${k}\n`; });

masterContent += `\n## 2. 🟡 EMERGING OPPORTUNITIES (Combinatorial Synergy)\n`;
sections['EMERGING OPPORTUNITIES'].forEach(e => { masterContent += `- ${e}\n`; });

masterContent += `\n## 3. 🔴 HIGH-NOVELTY HYPOTHESES (Cross-domain Anomaly Clusters)\n`;
sections['HIGH-NOVELTY HYPOTHESES'].forEach(h => { masterContent += `- ${h}\n`; });

masterContent += `\n## 4. ⚡ CONTRADICTIONS / TENSIONS (The Tension Engine Results)\n`;
sections['CONTRADICTIONS / TENSIONS'].forEach(t => { masterContent += `- ${t}\n`; });

masterContent += `\n## 5. 🔬 SUGGESTED EXPERIMENTS\n`;
sections['SUGGESTED EXPERIMENTS'].forEach(e => { masterContent += `- ${e}\n`; });

masterContent += `\n## 6. 🧬 BIOLOGICAL CONSTRAINTS\n`;
sections['BIOLOGICAL CONSTRAINTS'].forEach(c => { masterContent += `- ${c}\n`; });

const outPath = path.join(dir, 'folio.medlab.consolidated.tp53.md');
fs.writeFileSync(outPath, masterContent);
console.log(`Consolidated into ${outPath}`);

// Delete original files
for (const f of files) {
    fs.unlinkSync(path.join(dir, f));
}
console.log(`Deleted ${files.length} raw folios.`);

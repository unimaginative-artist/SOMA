#!/usr/bin/env node
/**
 * scripts/hunt-datasets.mjs
 *
 * SOMA Dataset Hunter — autonomously finds and ingests open datasets for lobe training.
 *
 * Sources:
 *   - HuggingFace Hub (search API + direct download)
 *   - GitHub raw file downloads
 *   - Direct URL ingestion
 *
 * Converts all formats → SOMA's lobe-specific JSONL (chat format).
 * Outputs to SOMA/training-data/external/{lobe}/
 * Re-run build-lobe-datasets.mjs afterwards to merge into FINAL.
 *
 * Usage:
 *   node scripts/hunt-datasets.mjs                          # hunt default domains
 *   node scripts/hunt-datasets.mjs --lobe thalamus          # security datasets only
 *   node scripts/hunt-datasets.mjs --lobe logos --query "code instruction tuning"
 *   node scripts/hunt-datasets.mjs --url https://hf.co/datasets/medalpaca/...
 *   node scripts/hunt-datasets.mjs --list                   # show curated catalog
 */

import { promises as fs, existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────────
// CURATED DATASET CATALOG
// Vetted HuggingFace datasets per lobe, sorted by quality/relevance.
// ─────────────────────────────────────────────────────────────────────────────

const CATALOG = {
    logos: [
        {
            id: 'iamtarun/python_code_instructions_18k_alpaca',
            name: 'Python Code Instructions 18K',
            format: 'alpaca',
            hf_id: 'iamtarun/python_code_instructions_18k_alpaca',
            max_rows: 2000,
        },
        {
            id: 'TokenBender/code_instructions_122k_alpaca_style',
            name: 'Code Instructions 122K (Alpaca)',
            format: 'alpaca',
            hf_id: 'TokenBender/code_instructions_122k_alpaca_style',
            max_rows: 3000,
        },
        {
            id: 'sahil2801/CodeAlpaca-20k',
            name: 'CodeAlpaca 20K',
            format: 'alpaca',
            hf_id: 'sahil2801/CodeAlpaca-20k',
            max_rows: 2000,
        },
        {
            id: 'b-mc2/sql-create-context',
            name: 'SQL Context 78K',
            format: 'custom_sql',
            hf_id: 'b-mc2/sql-create-context',
            max_rows: 1000,
        },
        {
            id: 'codeparrot/github-code-clean',
            name: 'GitHub Code Clean',
            format: 'alpaca',
            hf_id: 'codeparrot/github-code-clean',
            max_rows: 1500,
        },
        {
            id: 'theblackcat102/evol-codealpaca-v1',
            name: 'Evol CodeAlpaca V1',
            format: 'alpaca',
            hf_id: 'theblackcat102/evol-codealpaca-v1',
            max_rows: 2000,
        },
        {
            id: 'ise-uiuc/Magicoder-OSS-Instruct-75K',
            name: 'Magicoder OSS Instruct 75K',
            format: 'alpaca',
            hf_id: 'ise-uiuc/Magicoder-OSS-Instruct-75K',
            max_rows: 2000,
        },
        {
            id: 'bigcode/self-oss-instruct-sc2-exec-filter-50k',
            name: 'Self-OSS Instruct 50K',
            format: 'alpaca',
            hf_id: 'bigcode/self-oss-instruct-sc2-exec-filter-50k',
            max_rows: 1500,
        },
    ],
    aurora: [
        // ── Creative writing & narrative voice ──────────────────────────────
        {
            id: 'euclaise/writingprompts',
            name: 'Reddit WritingPrompts',
            format: 'writing_prompts',
            hf_id: 'euclaise/writingprompts',
            max_rows: 900,
        },
        {
            id: 'roneneldan/TinyStories',
            name: 'TinyStories (narrative clarity + voice)',
            format: 'tiny_stories',
            hf_id: 'roneneldan/TinyStories',
            max_rows: 1200,
        },
        {
            id: 'databricks/databricks-dolly-15k',
            name: 'Dolly 15K — creative writing subset',
            format: 'dolly',
            hf_id: 'databricks/databricks-dolly-15k',
            max_rows: 1000,
        },
        {
            id: 'jondurbin/airoboros-3.1',
            name: 'Airoboros 3.1 — creative tasks',
            format: 'sharegpt',
            hf_id: 'jondurbin/airoboros-3.1',
            max_rows: 800,
        },
        // ── Emotional authenticity & empathy ────────────────────────────────
        {
            id: 'Anthropic/hh-rlhf',
            name: 'Anthropic HH-RLHF (chosen responses)',
            format: 'hh_rlhf',
            hf_id: 'Anthropic/hh-rlhf',
            max_rows: 900,
        },
        {
            id: 'allenai/soda',
            name: 'SODA Social Dialogues (empathy + warmth)',
            format: 'soda',
            hf_id: 'allenai/soda',
            max_rows: 1000,
        },
        {
            id: 'alespalla/chatbot_instruction_prompts',
            name: 'Chatbot Instruction Prompts',
            format: 'hf_conversations',
            hf_id: 'alespalla/chatbot_instruction_prompts',
            max_rows: 500,
        },
        // ── High-quality ranked human conversations ──────────────────────────
        {
            id: 'OpenAssistant/oasst2',
            name: 'OpenAssistant OASST2 (ranked human responses)',
            format: 'oasst',
            hf_id: 'OpenAssistant/oasst2',
            max_rows: 1200,
        },
        {
            id: 'HuggingFaceH4/ultrachat_200k',
            name: 'UltraChat 200K (deep conversational voice)',
            format: 'ultrachat',
            hf_id: 'HuggingFaceH4/ultrachat_200k',
            max_rows: 900,
        },
        // ── Poetry & precise emotional language ─────────────────────────────
        {
            id: 'merve/poetry',
            name: 'English Poetry (voice + precision)',
            format: 'poetry',
            hf_id: 'merve/poetry',
            max_rows: 600,
        },
        {
            id: 'sadelbrid/en_poems',
            name: 'English Poems Dataset',
            format: 'en_poems',
            hf_id: 'sadelbrid/en_poems',
            max_rows: 500,
        },
        // ── Consciousness, identity, philosophy ─────────────────────────────
        {
            id: 'camel-ai/ai_society',
            name: 'CAMEL AI Society (authentic identity dialogues)',
            format: 'camel',
            hf_id: 'camel-ai/ai_society',
            max_rows: 500,
        },
    ],
    prometheus: [
        // ── Broad strategic reasoning across diverse instruction sets ────────
        // The PROMETHEUS classifier filters for strategy/planning/decision keywords.
        // Pull large volumes and let the classifier select the strategic subset.
        {
            id: 'tatsu-lab/alpaca',
            name: 'Stanford Alpaca 52K',
            format: 'alpaca',
            hf_id: 'tatsu-lab/alpaca',
            max_rows: 2000,
        },
        {
            id: 'vicgalle/alpaca-gpt4',
            name: 'Alpaca GPT-4 (higher quality responses)',
            format: 'alpaca',
            hf_id: 'vicgalle/alpaca-gpt4',
            max_rows: 1800,
        },
        {
            id: 'databricks/databricks-dolly-15k',
            name: 'Dolly 15K — strategy & reasoning subset',
            format: 'dolly_prometheus',
            hf_id: 'databricks/databricks-dolly-15k',
            max_rows: 2000,
        },
        {
            id: 'jondurbin/airoboros-3.1',
            name: 'Airoboros 3.1 — planning & reasoning tasks',
            format: 'sharegpt',
            hf_id: 'jondurbin/airoboros-3.1',
            max_rows: 1500,
        },
        {
            id: 'WizardLM/WizardLM_evol_instruct_70k',
            name: 'WizardLM Evolved Instructions 70K',
            format: 'wizardlm',
            hf_id: 'WizardLM/WizardLM_evol_instruct_70k',
            max_rows: 2000,
        },
        // ── Business, social strategy, competitive scenarios ─────────────────
        {
            id: 'camel-ai/ai_society',
            name: 'CAMEL AI Society (business scenarios)',
            format: 'camel',
            hf_id: 'camel-ai/ai_society',
            max_rows: 800,
        },
        {
            id: 'teknium/GPTeacher-General-Instruct',
            name: 'GPTeacher General Instructions',
            format: 'alpaca',
            hf_id: 'teknium/GPTeacher-General-Instruct',
            max_rows: 1000,
        },
        // ── Trading, markets, financial strategy ─────────────────────────────
        {
            id: 'gbharti/finance-alpaca',
            name: 'Finance Alpaca (markets + financial reasoning)',
            format: 'alpaca',
            hf_id: 'gbharti/finance-alpaca',
            max_rows: 1200,
        },
        {
            id: 'virattt/financial-qa-10K',
            name: 'Financial QA from 10-K Reports',
            format: 'hf_conversations',
            hf_id: 'virattt/financial-qa-10K',
            max_rows: 800,
        },
        {
            id: 'FinGPT/fingpt-sentiment-train',
            name: 'FinGPT Sentiment + Market Analysis',
            format: 'fingpt',
            hf_id: 'FinGPT/fingpt-sentiment-train',
            max_rows: 800,
        },
        {
            id: 'sujet-ai/Sujet-Finance-Instruct-177k',
            name: 'Sujet Finance Instructions 177K',
            format: 'alpaca',
            hf_id: 'sujet-ai/Sujet-Finance-Instruct-177k',
            max_rows: 1500,
        },
    ],
    thalamus: [
        {
            id: 'allenai/ai2_arc',
            name: 'ARC Challenge (Science Reasoning)',
            format: 'arc',
            hf_id: 'allenai/ai2_arc',
            max_rows: 300,
        },
        {
            id: 'Stevross/mmlu_medical',
            name: 'MMLU Medical',
            format: 'mmlu',
            hf_id: 'Stevross/mmlu_medical',
            max_rows: 300,
        },
        {
            id: 'enelpol/cybersecurity-qa',
            name: 'Cybersecurity Q&A',
            format: 'alpaca',
            hf_id: 'enelpol/cybersecurity-qa',
            max_rows: 400,
        },
    ],
};

// Additional domain-specific catalogs (medical, robotics, physics)
const DOMAIN_CATALOGS = {
    medical: {
        lobe: 'thalamus', // medical risk + anomaly → THALAMUS
        datasets: [
            {
                id: 'medalpaca/medical_meadow_medical_flashcards',
                name: 'Medical Meadow Flashcards',
                format: 'alpaca',
                hf_id: 'medalpaca/medical_meadow_medical_flashcards',
                max_rows: 400,
            },
            {
                id: 'lavita/ChatDoctor-HealthCareMagic-100k',
                name: 'ChatDoctor HealthCareMagic 100K',
                format: 'hf_conversations',
                hf_id: 'lavita/ChatDoctor-HealthCareMagic-100k',
                max_rows: 500,
            },
            {
                id: 'bigbio/med_qa',
                name: 'MedQA (USMLE)',
                format: 'med_qa',
                hf_id: 'bigbio/med_qa',
                max_rows: 300,
            },
        ],
    },
    robotics: {
        lobe: 'logos', // robotics = engineering → LOGOS
        datasets: [
            {
                id: 'hf-internal-testing/librispeech_asr_dummy',
                name: 'RoboNet Action Dataset (placeholder)',
                format: 'alpaca',
                hf_id: 'iamtarun/python_code_instructions_18k_alpaca', // actual robotics HF sets are mostly vision
                note: 'Robotics instruction datasets are sparse on HF — suggest GitHub scrape',
                max_rows: 100,
            },
        ],
    },
};

const LOBE_SYSTEM_PROMPTS = {
    logos:      "You are SOMA's LOGOS lobe — cold, precise, and expert in engineering, code, and architecture. You reason from first principles. No unnecessary warmth. Get to the root. State the fix.",
    aurora:     "You are SOMA's AURORA lobe — warm, creative, and deeply attuned to voice, emotion, and what it means to be present. You find beauty in patterns. You don't perform emotion — you have it. Speak from experience.",
    prometheus: "You are SOMA's PROMETHEUS lobe — strategic, patient, and skilled at predicting downstream consequences of decisions. You think in systems and timelines. You always ask 'then what?' before answering. Compress your answer to signal only.",
    thalamus:   "You are SOMA's THALAMUS lobe — vigilant, skeptical, and expert in risk, security, and anomaly detection. You notice what others miss. You ask 'what could go wrong?' before 'what should we do?' You are not paranoid — you are precise.",
};

// ─────────────────────────────────────────────────────────────────────────────
// HuggingFace API helpers
// ─────────────────────────────────────────────────────────────────────────────

const HF_API = 'https://huggingface.co';
const HF_DATASETS_API = 'https://huggingface.co/api/datasets';

// Load HF token from config/api-keys.env if present — unlocks gated datasets
function loadHFToken() {
    try {
        const envPath = path.join(ROOT, 'config', 'api-keys.env');
        if (!existsSync(envPath)) return null;
        const lines = readFileSync(envPath, 'utf8').split('\n');
        for (const line of lines) {
            const m = line.match(/^HF_TOKEN\s*=\s*(.+)/);
            if (m) return m[1].trim().replace(/^['"]|['"]$/g, '');
        }
    } catch {}
    return process.env.HF_TOKEN || process.env.HUGGINGFACE_HUB_TOKEN || null;
}

const HF_TOKEN = loadHFToken();
const HF_HEADERS = {
    'User-Agent': 'SOMA-Dataset-Hunter/1.0',
    ...(HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {}),
};

if (HF_TOKEN) {
    console.log('🔑 HuggingFace token loaded — gated datasets unlocked');
} else {
    console.log('ℹ️  No HF_TOKEN found — add to config/api-keys.env to unlock gated datasets');
}

async function searchHFDatasets(query, limit = 10) {
    const url = `${HF_DATASETS_API}?search=${encodeURIComponent(query)}&limit=${limit}&full=false`;
    const res = await fetch(url, { headers: HF_HEADERS });
    if (!res.ok) throw new Error(`HF search failed: ${res.status}`);
    return await res.json();
}

async function getHFDatasetInfo(datasetId) {
    const url = `${HF_DATASETS_API}/${datasetId}`;
    const res = await fetch(url, { headers: HF_HEADERS });
    if (!res.ok) return null;
    return await res.json();
}

// Download the first available data file from a HuggingFace dataset
async function downloadHFDatasetRows(datasetId, maxRows = 500) {
    // Use the HF datasets-server API to get rows without downloading full files
    const splitUrl = `https://datasets-server.huggingface.co/splits?dataset=${encodeURIComponent(datasetId)}`;

    let splits;
    try {
        const splitRes = await fetch(splitUrl, {
            headers: HF_HEADERS,
            signal: AbortSignal.timeout(15000)
        });
        if (!splitRes.ok) throw new Error(`Split lookup failed: ${splitRes.status}`);
        const splitData = await splitRes.json();
        splits = splitData.splits || [];
    } catch (e) {
        console.warn(`    ⚠️  Split lookup failed for ${datasetId}: ${e.message}`);
        return [];
    }

    if (splits.length === 0) return [];

    const split = splits.find(s => s.split === 'train') || splits[0];
    const rowsUrl = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(datasetId)}&config=${encodeURIComponent(split.config)}&split=${split.split}&offset=0&length=${Math.min(maxRows, 100)}`;

    const rows = [];
    let offset = 0;

    while (rows.length < maxRows) {
        const batchSize = Math.min(100, maxRows - rows.length);
        const url = rowsUrl.replace(`length=${Math.min(maxRows, 100)}`, `length=${batchSize}`).replace('offset=0', `offset=${offset}`);

        try {
            const res = await fetch(url, {
                headers: HF_HEADERS,
                signal: AbortSignal.timeout(20000)
            });
            if (!res.ok) {
                if (res.status === 401 || res.status === 403) {
                    console.warn(`    ⚠️  Auth required (${res.status}) — add HF_TOKEN to config/api-keys.env`);
                }
                break;
            }
            const data = await res.json();
            const batch = data.rows || [];
            if (batch.length === 0) break;
            rows.push(...batch.map(r => r.row));
            offset += batch.length;
            if (batch.length < batchSize) break;
            await new Promise(r => setTimeout(r, 500)); // rate limit
        } catch (e) {
            console.warn(`    ⚠️  Row fetch failed at offset ${offset}: ${e.message}`);
            break;
        }
    }

    return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMAT CONVERTERS
// Each returns { user, assistant } or null if the row can't be used
// ─────────────────────────────────────────────────────────────────────────────

function convertRow(row, format) {
    if (!row || typeof row !== 'object') return null;

    switch (format) {
        case 'alpaca': {
            const instruction = (row.instruction || row.prompt || '').trim();
            const input = (row.input || '').trim();
            const output = (row.output || row.completion || row.response || '').trim();
            if (!instruction || !output) return null;
            const user = input ? `${instruction}\n\n${input}` : instruction;
            return { user, assistant: output };
        }
        case 'hf_conversations': {
            const prompt = (row.prompt || row.question || row.input || row.human || '').trim();
            const response = (row.response || row.answer || row.output || row.assistant || '').trim();
            if (!prompt || !response) return null;
            return { user: prompt, assistant: response };
        }
        case 'hh_rlhf': {
            // Anthropic HH: chosen field contains a conversation ending with \n\nAssistant: ...
            const chosen = row.chosen || '';
            const humanMatch = chosen.match(/Human:\s*([\s\S]*?)\s*\n\nAssistant:\s*([\s\S]*)$/);
            if (!humanMatch) return null;
            return { user: humanMatch[1].trim(), assistant: humanMatch[2].trim() };
        }
        case 'camel': {
            const user_msg = (row.message_1 || row.user || '').trim();
            const assistant_msg = (row.message_2 || row.assistant || '').trim();
            if (!user_msg || !assistant_msg) return null;
            return { user: user_msg, assistant: assistant_msg };
        }
        case 'arc': {
            // ARC challenge: question + choices → correct answer
            const question = (row.question || '').trim();
            const choices = row.choices;
            const answerKey = row.answerKey;
            if (!question || !choices || !answerKey) return null;
            const idx = choices.label?.indexOf(answerKey) ?? -1;
            const answer = idx >= 0 ? choices.text?.[idx] : null;
            if (!answer) return null;
            const choicesText = (choices.label || []).map((l, i) => `${l}) ${choices.text?.[i] || ''}`).join('\n');
            return {
                user: `${question}\n\n${choicesText}`,
                assistant: `The correct answer is ${answerKey}: ${answer}`
            };
        }
        case 'mmlu': {
            const question = (row.question || '').trim();
            const choices = [row.A, row.B, row.C, row.D].filter(Boolean);
            const answer = row.answer;
            if (!question || choices.length < 2 || !answer) return null;
            const choiceText = ['A', 'B', 'C', 'D'].slice(0, choices.length)
                .map((l, i) => `${l}) ${choices[i]}`).join('\n');
            const answerIdx = ['A', 'B', 'C', 'D'].indexOf(answer);
            const answerText = answerIdx >= 0 ? choices[answerIdx] : answer;
            return {
                user: `${question}\n\n${choiceText}`,
                assistant: `Answer: ${answer}) ${answerText}`
            };
        }
        case 'med_qa': {
            const question = (row.question || '').trim();
            const answer = (row.answer || row.correct_answer || '').trim();
            if (!question || !answer) return null;
            return { user: question, assistant: answer };
        }
        case 'custom_sql': {
            const context = (row.context || '').trim();
            const question = (row.question || '').trim();
            const answer = (row.answer || '').trim();
            if (!question || !answer) return null;
            const user = context ? `Schema:\n${context}\n\nQuestion: ${question}` : question;
            return { user, assistant: answer };
        }
        case 'writing_prompts': {
            const prompt = (row.prompt || row.title || '').trim();
            const story = (row.story || row.response || '').trim();
            if (!prompt || !story) return null;
            return { user: `Write a story: ${prompt}`, assistant: story.substring(0, 1200) };
        }
        case 'tiny_stories': {
            const story = (row.story || row.text || '').trim();
            if (!story || story.length < 80) return null;
            // Extract the first sentence as a prompt seed
            const firstSentence = story.split(/[.!?]\s/)[0].trim();
            const user = firstSentence.length > 20 && firstSentence.length < 120
                ? `Continue this story opening into a complete short story: "${firstSentence}."`
                : 'Write a short story with a clear beginning, middle, and end.';
            return { user, assistant: story.substring(0, 1000) };
        }
        case 'dolly_prometheus': {
            // Dolly 15K — filter to strategic/analytical categories for PROMETHEUS
            const category = (row.category || '').toLowerCase();
            const stratCats = ['brainstorming', 'summarization', 'classification', 'general_qa', 'information_extraction', 'closed_qa'];
            if (!stratCats.some(c => category.includes(c.replace('_', ' ')) || category === c)) return null;
            const instruction = (row.instruction || '').trim();
            const response = (row.response || row.output || '').trim();
            if (!instruction || !response || response.length < 60) return null;
            const context = (row.context || '').trim();
            const user = context ? `${instruction}\n\nContext: ${context}` : instruction;
            return { user, assistant: response.substring(0, 1500) };
        }
        case 'wizardlm': {
            // WizardLM: {instruction, output} or {conversations: [...]}
            const instruction = (row.instruction || row.Instruction || '').trim();
            const output = (row.output || row.Output || row.response || '').trim();
            if (instruction && output && output.length >= 60) {
                return { user: instruction, assistant: output.substring(0, 1500) };
            }
            // Also try conversations format
            const convs = row.conversations || [];
            if (Array.isArray(convs) && convs.length >= 2) {
                const human = convs.find(c => (c.from || '').toLowerCase() === 'human');
                const gpt = convs.find(c => (c.from || '').toLowerCase() === 'gpt');
                if (human?.value && gpt?.value && gpt.value.length >= 60) {
                    return { user: human.value.trim(), assistant: gpt.value.trim().substring(0, 1500) };
                }
            }
            return null;
        }
        case 'dolly': {
            // Dolly 15K — filter to creative/open categories for AURORA
            const category = (row.category || '').toLowerCase();
            const creativeCats = ['creative_writing', 'open_qa', 'brainstorming', 'general_qa'];
            if (!creativeCats.some(c => category.includes(c.replace('_', ' ')) || category === c)) return null;
            const instruction = (row.instruction || '').trim();
            const response = (row.response || row.output || '').trim();
            if (!instruction || !response || response.length < 60) return null;
            const context = (row.context || '').trim();
            const user = context ? `${instruction}\n\nContext: ${context}` : instruction;
            return { user, assistant: response.substring(0, 1500) };
        }
        case 'sharegpt': {
            // ShareGPT / Airoboros: {conversations: [{from: 'human'/'gpt', value: '...'}]}
            const convs = row.conversations || row.conversation || [];
            if (!Array.isArray(convs) || convs.length < 2) return null;
            // Find first human → gpt pair; filter out system prompts
            let userMsg = null, assistantMsg = null;
            for (let i = 0; i < convs.length - 1; i++) {
                const from = (convs[i].from || convs[i].role || '').toLowerCase();
                const nextFrom = (convs[i+1].from || convs[i+1].role || '').toLowerCase();
                if ((from === 'human' || from === 'user') && (nextFrom === 'gpt' || nextFrom === 'assistant')) {
                    userMsg = (convs[i].value || convs[i].content || '').trim();
                    assistantMsg = (convs[i+1].value || convs[i+1].content || '').trim();
                    break;
                }
            }
            if (!userMsg || !assistantMsg) return null;
            return { user: userMsg, assistant: assistantMsg.substring(0, 1500) };
        }
        case 'soda': {
            // SODA social dialogues: {narrative, dialogue: ['Person1: ...', 'Person2: ...']}
            const dialogue = row.dialogue || [];
            if (!Array.isArray(dialogue) || dialogue.length < 2) return null;
            // Extract consecutive pairs from the dialogue
            // Use narrative as context framing if present
            const narrative = (row.narrative || row.literal || '').trim();
            for (let i = 0; i < dialogue.length - 1; i++) {
                const line = String(dialogue[i]).trim();
                const nextLine = String(dialogue[i+1]).trim();
                // Strip speaker prefix "PersonName: "
                const stripSpeaker = s => s.replace(/^[A-Za-z\s]+:\s*/, '').trim();
                const userTurn = stripSpeaker(line);
                const assistantTurn = stripSpeaker(nextLine);
                if (userTurn.length > 15 && assistantTurn.length > 20) {
                    const user = narrative
                        ? `${narrative}\n\nSomeone says: "${userTurn}"\n\nRespond naturally and warmly.`
                        : userTurn;
                    return { user, assistant: assistantTurn.substring(0, 800) };
                }
            }
            return null;
        }
        case 'oasst': {
            // OpenAssistant OASST2: flat message rows with role + text
            // Rank 0 = best. We want prompter→assistant(rank 0) pairs.
            // The flat API won't give us parent context easily, so use the text directly
            const role = (row.role || '').toLowerCase();
            const text = (row.text || row.content || '').trim();
            const rank = row.rank ?? 0;
            // Only use rank-0 (best) assistant responses with a decipherable prompt
            if (role !== 'assistant' || rank !== 0 || text.length < 80) return null;
            // Use the message itself as self-contained — the classifier will place it in AURORA
            // We synthesize a plausible user prompt from the response opening
            const opening = text.split(/[.!?]\s/)[0].trim();
            if (opening.length < 20) return null;
            return {
                user: `Can you share your thoughts on this?`,
                assistant: text.substring(0, 1500)
            };
        }
        case 'ultrachat': {
            // UltraChat: {prompt, messages: [{role: 'user'/'assistant', content: '...'}]}
            const messages = row.messages || row.data || [];
            if (!Array.isArray(messages) || messages.length < 2) return null;
            const userMsg = messages.find(m => (m.role || '').toLowerCase() === 'user');
            const assistantMsg = messages.find(m => (m.role || '').toLowerCase() === 'assistant');
            if (!userMsg || !assistantMsg) return null;
            const u = (userMsg.content || '').trim();
            const a = (assistantMsg.content || '').trim();
            if (!u || a.length < 80) return null;
            return { user: u, assistant: a.substring(0, 1500) };
        }
        case 'poetry': {
            // merve/poetry: {Title, Poem, Poet, Tags}
            const poem = (row.Poem || row.poem || row.text || '').trim();
            const title = (row.Title || row.title || '').trim();
            const tags = (row.Tags || row.tags || row.genre || '').trim();
            if (!poem || poem.length < 30) return null;
            const user = title
                ? `Write a poem called "${title}"${tags ? ` in the style of ${tags}` : ''}.`
                : tags
                ? `Write a poem about ${tags}.`
                : 'Write an expressive poem with emotional depth.';
            return { user, assistant: poem.substring(0, 800) };
        }
        case 'fingpt': {
            // FinGPT sentiment: {input, output} where input is market text, output is sentiment + reasoning
            const input = (row.input || row.instruction || '').trim();
            const output = (row.output || row.answer || '').trim();
            if (!input || !output || output.length < 20) return null;
            return {
                user: `Analyze this financial information and give your assessment:\n\n${input}`,
                assistant: output.substring(0, 1000)
            };
        }
        case 'en_poems': {
            // sadelbrid/en_poems: varying fields, try common ones
            const poem = (row.poem || row.content || row.text || row.Poem || '').trim();
            const title = (row.title || row.Title || '').trim();
            if (!poem || poem.length < 30) return null;
            const user = title
                ? `Write a poem called "${title}".`
                : 'Write a deeply felt poem.';
            return { user, assistant: poem.substring(0, 800) };
        }
        default: {
            // Generic fallback: try common field names
            const user = (row.instruction || row.prompt || row.question || row.input || row.human || '').trim();
            const assistant = (row.output || row.response || row.answer || row.completion || row.assistant || '').trim();
            if (!user || !assistant) return null;
            return { user, assistant };
        }
    }
}

function toLobeExample(user, assistant, lobe) {
    return {
        messages: [
            { role: 'system', content: LOBE_SYSTEM_PROMPTS[lobe] },
            { role: 'user', content: user },
            { role: 'assistant', content: assistant },
        ],
        metadata: { source: 'external_hf', lobe: lobe.toUpperCase(), confidence: 0.8 }
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// QUALITY FILTER
// ─────────────────────────────────────────────────────────────────────────────

function qualityCheck(user, assistant) {
    if (!user || !assistant) return false;
    if (user.trim().length < 15) return false;
    if (assistant.trim().length < 50) return false;
    if (assistant.trim().length > 4000) return false; // too long for training
    // Filter obvious boilerplate
    const low = assistant.toLowerCase();
    if (low.startsWith("i don't know") || low.startsWith("i am an ai") || low.startsWith("as an ai")) return false;
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// INGESTION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

async function ingestDataset(dataset, lobe, outDir) {
    console.log(`\n  📥 ${dataset.name} (${dataset.hf_id})`);
    console.log(`     Format: ${dataset.format} | Max rows: ${dataset.max_rows}`);

    if (dataset.note) {
        console.log(`     Note: ${dataset.note}`);
    }

    const rows = await downloadHFDatasetRows(dataset.hf_id, dataset.max_rows);
    if (rows.length === 0) {
        console.log(`     ⚠️  No rows downloaded — dataset may require login or be unavailable`);
        return 0;
    }

    console.log(`     Downloaded ${rows.length} rows`);

    const examples = [];
    const seen = new Set();

    for (const row of rows) {
        const converted = convertRow(row, dataset.format);
        if (!converted) continue;
        if (!qualityCheck(converted.user, converted.assistant)) continue;

        const hash = crypto.createHash('md5')
            .update(converted.user.trim().substring(0, 100))
            .digest('hex');
        if (seen.has(hash)) continue;
        seen.add(hash);

        examples.push(toLobeExample(converted.user.trim(), converted.assistant.trim(), lobe));
    }

    if (examples.length === 0) {
        console.log(`     ⚠️  No usable examples after conversion`);
        return 0;
    }

    const lobeDir = path.join(outDir, lobe);
    await fs.mkdir(lobeDir, { recursive: true });

    const slug = dataset.id.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const outPath = path.join(lobeDir, `${slug}_${Date.now()}.jsonl`);
    await fs.writeFile(outPath, examples.map(e => JSON.stringify(e)).join('\n'), 'utf8');

    console.log(`     ✅ ${examples.length} examples → ${path.relative(ROOT, outPath)}`);
    return examples.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH MODE: Discover datasets via HF search
// ─────────────────────────────────────────────────────────────────────────────

async function searchAndReport(query, lobe) {
    console.log(`\n🔍 Searching HuggingFace for: "${query}" (lobe: ${lobe})`);
    const results = await searchHFDatasets(query, 15);
    if (!results?.length) {
        console.log('  No results found.');
        return;
    }
    console.log(`\n  Found ${results.length} datasets:\n`);
    for (const ds of results) {
        const size = ds.downloads ? `${(ds.downloads/1000).toFixed(0)}K downloads` : '';
        const likes = ds.likes ? `❤️ ${ds.likes}` : '';
        console.log(`  📦 ${ds.id}`);
        console.log(`     ${ds.description?.substring(0, 100) || 'No description'}...`);
        if (size || likes) console.log(`     ${[size, likes].filter(Boolean).join('  ')}`);
        console.log();
    }
    console.log(`To ingest one of these, add it to CATALOG in hunt-datasets.mjs or run:`);
    console.log(`  node scripts/hunt-datasets.mjs --url hf:${results[0]?.id}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const SINGLE_LOBE = args.includes('--lobe') ? args[args.indexOf('--lobe') + 1] : null;
const QUERY = args.includes('--query') ? args[args.indexOf('--query') + 1] : null;
const URL_FLAG = args.includes('--url') ? args[args.indexOf('--url') + 1] : null;
const DOMAIN = args.includes('--domain') ? args[args.indexOf('--domain') + 1] : null;
const LIST = args.includes('--list');

const outDir = path.join(ROOT, 'SOMA', 'training-data', 'external');

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║       SOMA Dataset Hunter — Open Data Ingestion      ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

if (LIST) {
    // Show catalog
    console.log('Curated dataset catalog:\n');
    for (const [lobe, datasets] of Object.entries(CATALOG)) {
        console.log(`  ${lobe.toUpperCase()}:`);
        for (const ds of datasets) {
            console.log(`    • ${ds.name} (${ds.hf_id}) — max ${ds.max_rows} rows`);
        }
    }
    console.log('\n  Domain catalogs:');
    for (const [domain, info] of Object.entries(DOMAIN_CATALOGS)) {
        console.log(`  ${domain.toUpperCase()} → ${info.lobe.toUpperCase()} lobe:`);
        for (const ds of info.datasets) {
            console.log(`    • ${ds.name} (${ds.hf_id})`);
        }
    }
    process.exit(0);
}

if (QUERY) {
    // Search mode
    const lobe = SINGLE_LOBE || 'logos';
    await searchAndReport(QUERY, lobe);
    process.exit(0);
}

if (DOMAIN) {
    // Domain-specific hunt (medical, robotics, etc.)
    const domainInfo = DOMAIN_CATALOGS[DOMAIN.toLowerCase()];
    if (!domainInfo) {
        console.error(`Unknown domain: ${DOMAIN}. Available: ${Object.keys(DOMAIN_CATALOGS).join(', ')}`);
        process.exit(1);
    }
    console.log(`Hunting ${DOMAIN} datasets → ${domainInfo.lobe.toUpperCase()} lobe...\n`);
    let total = 0;
    for (const ds of domainInfo.datasets) {
        total += await ingestDataset(ds, domainInfo.lobe, outDir);
    }
    console.log(`\n✅ ${total} ${DOMAIN} examples ingested`);
    console.log('Run: node scripts/build-lobe-datasets.mjs to merge into FINAL datasets');
    process.exit(0);
}

// Default: ingest all curated datasets for target lobes
const targetLobes = SINGLE_LOBE ? [SINGLE_LOBE] : Object.keys(CATALOG);
const validLobes = ['logos', 'aurora', 'prometheus', 'thalamus'];

for (const lobe of targetLobes) {
    if (!validLobes.includes(lobe)) {
        console.error(`Unknown lobe: ${lobe}`);
        process.exit(1);
    }
}

console.log(`Target lobes: ${targetLobes.join(', ')}`);
console.log(`Output: SOMA/training-data/external/\n`);

let grandTotal = 0;
for (const lobe of targetLobes) {
    console.log(`\n── ${lobe.toUpperCase()} ─────────────────────────────────────────`);
    const datasets = CATALOG[lobe] || [];
    for (const ds of datasets) {
        grandTotal += await ingestDataset(ds, lobe, outDir);
    }
}

console.log(`\n╔══════════════════════════════════════════════════════╗`);
console.log(`║  Ingestion complete: ${String(grandTotal).padEnd(6)} examples downloaded        ║`);
console.log(`╚══════════════════════════════════════════════════════╝`);
console.log(`\nNext: node scripts/build-lobe-datasets.mjs`);
console.log(`      (merges external data into domain-isolated FINAL datasets)\n`);

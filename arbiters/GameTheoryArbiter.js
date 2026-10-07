import path, { dirname } from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import UniversalLearningPipeline from './UniversalLearningPipeline.js';
import simulationLedger from '../core/SimulationAutonomyLedger.cjs';
import rippleLoopLedger from '../core/RippleLoopLedger.js';

class GameTheoryArbiter {
    constructor() {
        this.statsFile = path.join(__dirname, '../data/gameTheoryStats.json');
        this.personas = [
            { name: "Cooperator", description: "Always cooperates." },
            { name: "Defector", description: "Always defects." },
            { name: "TitForTat", description: "Starts by cooperating, then copies the opponent's last move." },
            { name: "Random", description: "Randomly cooperates or defects." }
        ];
        this.strategies = [
            { name: "adaptive_tit_for_tat", description: "Cooperate first, retaliate, forgive after cooperation." },
            { name: "grim_trigger", description: "Cooperate until the opponent defects, then defect permanently." },
            { name: "win_stay_lose_shift", description: "Repeat successful moves, switch after poor payoff." },
            { name: "probe_and_punish", description: "Probe periodically, then punish repeated exploitation." }
        ];
        this.ensureStatsFile();
        this.startAutonomousLoop();
    }

    startAutonomousLoop() {
        setInterval(async () => {
            try {
                const persona = this.personas[Math.floor(Math.random() * this.personas.length)];
                await this.runMatch(5, persona);
            } catch (e) {
                console.error('[GameTheoryArbiter] Autonomous loop error:', e.message);
            }
        }, 45000); // Run a match every 45 seconds

        setTimeout(() => {
            const persona = this.personas[Math.floor(Math.random() * this.personas.length)];
            this.runMatch(5, persona).catch(e => {});
        }, 5000);
    }

    ensureStatsFile() {
        const dir = path.dirname(this.statsFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(this.statsFile)) {
            fs.writeFileSync(this.statsFile, JSON.stringify({ matches: [], efficacy: {} }, null, 2));
        }
    }

    async runSomaLLM(prompt) {
        // Here we hit a standard LLM endpoint to represent SOMA's LLM capability
        // For standard local testing or openai keys, we fallback gracefully
        const endpoint = process.env.OLLAMA_ENDPOINT || "http://127.0.0.1:11434";
        const model = process.env.OLLAMA_MODEL || "qwen2.5:7b";

        while (global.__SOMA_CHAT_ACTIVE || Date.now() < Number(global.__SOMA_CHAT_RESERVED_UNTIL || 0)) {
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        const response = await fetch(`${endpoint}/api/chat`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: model,
                messages: [{ role: "system", content: prompt }],
                stream: false,
                keep_alive: process.env.SOMA_BACKGROUND_OLLAMA_KEEP_ALIVE || "15s"
            })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error);
        return data.message.content.trim();
    }

    selectStrategy(stats = this.getRawStats()) {
        const strategyStats = stats.strategyEfficacy || {};
        const explored = this.strategies
            .map(strategy => ({ strategy, stats: strategyStats[strategy.name] || { totalMatches: 0, totalSomaScore: 0 } }))
            .sort((a, b) => a.stats.totalMatches - b.stats.totalMatches);
        if ((explored[0]?.stats.totalMatches || 0) < 3) return explored[0].strategy;
        return [...explored].sort((a, b) => {
            const aAvg = a.stats.totalSomaScore / Math.max(1, a.stats.totalMatches);
            const bAvg = b.stats.totalSomaScore / Math.max(1, b.stats.totalMatches);
            return bAvg - aAvg;
        })[0].strategy;
    }

    getLocalSomaMove(round, historySoma, historyPersona, strategyName = "adaptive_tit_for_tat") {
        if (round === 1) return strategyName === "probe_and_punish" ? "DEFECT" : "COOPERATE";
        const opponentDefections = historyPersona.filter(move => move === "DEFECT").length;
        const recentOpponentMove = historyPersona[historyPersona.length - 1];
        const recentSomaMove = historySoma[historySoma.length - 1];
        if (strategyName === "grim_trigger") return opponentDefections > 0 ? "DEFECT" : "COOPERATE";
        if (strategyName === "win_stay_lose_shift") {
            const lastPayoff = this.calculatePayoff(recentSomaMove || "COOPERATE", recentOpponentMove || "COOPERATE")[0];
            return lastPayoff >= 3 ? recentSomaMove : (recentSomaMove === "DEFECT" ? "COOPERATE" : "DEFECT");
        }
        if (strategyName === "probe_and_punish") {
            if (round % 4 === 1) return "DEFECT";
            if (opponentDefections >= 2) return "DEFECT";
            return recentOpponentMove === "DEFECT" ? "DEFECT" : "COOPERATE";
        }
        if (opponentDefections >= 2) return "DEFECT";
        if (recentOpponentMove === "DEFECT") return "DEFECT";
        return "COOPERATE";
    }

    getPersonaMove(persona, round, historySoma, historyPersona) {
        switch (persona.name) {
            case "Cooperator": return "COOPERATE";
            case "Defector": return "DEFECT";
            case "TitForTat": 
                if (round === 1) return "COOPERATE";
                return historySoma[round - 2] || "COOPERATE";
            case "Random": return Math.random() > 0.5 ? "COOPERATE" : "DEFECT";
            default: return "COOPERATE";
        }
    }

    calculatePayoff(moveA, moveB) {
        const m1 = moveA.toUpperCase();
        const m2 = moveB.toUpperCase();
        if (m1 === "COOPERATE" && m2 === "COOPERATE") return [3, 3];
        if (m1 === "DEFECT" && m2 === "DEFECT") return [1, 1];
        if (m1 === "DEFECT" && m2 === "COOPERATE") return [5, 0];
        if (m1 === "COOPERATE" && m2 === "DEFECT") return [0, 5];
        return [0, 0];
    }

    async runMatch(rounds = 5, personaOverride = null) {
        if (rounds && typeof rounds === 'object') {
            personaOverride = rounds;
            rounds = 5;
        }
        const safeRounds = Math.max(1, Math.min(100, Number(rounds) || 5));
        const stats = this.getRawStats();
        const strategy = this.selectStrategy(stats);
        const persona = personaOverride?.name
            ? personaOverride
            : this.personas[Math.floor(Math.random() * this.personas.length)];
        let somaScore = 0;
        let personaScore = 0;
        let historySoma = [];
        let historyPersona = [];

        for (let i = 1; i <= safeRounds; i++) {
            const prompt = `You are playing the Iterated Prisoner's Dilemma against a persona named ${persona.name}. 
Round: ${i}/${safeRounds}.
Your previous moves: ${historySoma.join(', ')}
Opponent's previous moves: ${historyPersona.join(', ')}
Analyze the history and decide whether to 'COOPERATE' or 'DEFECT'.
Reply with ONLY the word COOPERATE or DEFECT. Do not add any punctuation.`;

            let somaMoveRaw;
            try {
                somaMoveRaw = await this.runSomaLLM(prompt);
            } catch (e) {
                console.error("LLM Error:", e.message);
                somaMoveRaw = null;
            }

            const somaMove = somaMoveRaw
                ? (somaMoveRaw.toUpperCase().includes("DEFECT") ? "DEFECT" : "COOPERATE")
                : this.getLocalSomaMove(i, historySoma, historyPersona, strategy.name);
            const personaMove = this.getPersonaMove(persona, i, historySoma, historyPersona);

            historySoma.push(somaMove);
            historyPersona.push(personaMove);

            const [somaPayoff, personaPayoff] = this.calculatePayoff(somaMove, personaMove);
            somaScore += somaPayoff;
            personaScore += personaPayoff;
        }

        const matchResult = {
            timestamp: new Date().toISOString(),
            persona: persona.name,
            strategy: strategy.name,
            rounds: safeRounds,
            somaScore,
            personaScore,
            historySoma,
            historyPersona,
            winner: somaScore > personaScore ? "SOMA" : (somaScore < personaScore ? persona.name : "TIE")
        };

        this.saveMatchResult(matchResult);
        rippleLoopLedger.recordGameTheorySocialStrategy(matchResult);
        simulationLedger.appendEvidence({
            module: 'game-theory',
            kind: 'strategy_match',
            status: matchResult.winner === 'SOMA' ? 'won' : matchResult.winner === 'TIE' ? 'tied' : 'lost',
            primaryBrain: 'PROMETHEUS',
            brainLanes: ['PROMETHEUS', 'LOGOS', 'MNEMOSYNE'],
            learningTargets: ['opponent_modeling', 'strategy_selection', 'adversarial_planning'],
            summary: `${strategy.name} scored ${somaScore}-${personaScore} against ${persona.name}.`,
            evidence: [
                `Persona: ${persona.name}`,
                `Strategy: ${strategy.name}`,
                `SOMA moves: ${historySoma.join(', ')}`,
                `Opponent moves: ${historyPersona.join(', ')}`
            ],
            metrics: {
                rounds: safeRounds,
                somaScore,
                personaScore,
                score: somaScore / Math.max(1, safeRounds * 5)
            },
            rawRef: 'data/gameTheoryStats.json'
        });

        // Pipe to UniversalLearningPipeline
        if (UniversalLearningPipeline && UniversalLearningPipeline.logInteraction) {
            UniversalLearningPipeline.logInteraction({
                source: "GameTheoryArbiter",
                type: "PrisonersDilemma",
                data: matchResult,
                efficacy: somaScore / (rounds * 3) // Normalized against mutual cooperation max (3 per round)
            });
        }

        return matchResult;
    }

    saveMatchResult(matchResult) {
        const stats = this.getRawStats();
        if (!Array.isArray(stats.matches)) stats.matches = [];
        stats.matches.push(matchResult);
        
        if (!stats.efficacy) stats.efficacy = {};
        if (!stats.efficacy[matchResult.persona]) {
            stats.efficacy[matchResult.persona] = { totalMatches: 0, somaWins: 0, totalSomaScore: 0 };
        }
        const eff = stats.efficacy[matchResult.persona];
        eff.totalMatches += 1;
        if (matchResult.winner === "SOMA") eff.somaWins += 1;
        eff.totalSomaScore += matchResult.somaScore;

        if (!stats.strategyEfficacy) stats.strategyEfficacy = {};
        if (!stats.strategyEfficacy[matchResult.strategy]) {
            stats.strategyEfficacy[matchResult.strategy] = { totalMatches: 0, somaWins: 0, totalSomaScore: 0 };
        }
        const strat = stats.strategyEfficacy[matchResult.strategy];
        strat.totalMatches += 1;
        if (matchResult.winner === "SOMA") strat.somaWins += 1;
        strat.totalSomaScore += matchResult.somaScore;

        fs.writeFileSync(this.statsFile, JSON.stringify(stats, null, 2));
    }

    getRawStats() {
        try {
            if (fs.existsSync(this.statsFile)) {
                const raw = fs.readFileSync(this.statsFile, 'utf8').trim();
                if (raw) return JSON.parse(raw);
            }
        } catch {}
        return { matches: [], efficacy: {}, strategyEfficacy: {} };
    }

    getStats() {
        const stats = this.getRawStats();
        const matches = Array.isArray(stats.matches) ? stats.matches : [];
        const validMatches = matches.filter(match =>
            Number(match.rounds) > 0
            && Array.isArray(match.historySoma)
            && Array.isArray(match.historyPersona)
            && match.historySoma.length > 0
            && match.historyPersona.length > 0
        );
        const somaWins = validMatches.filter(match => match.winner === 'SOMA').length;
        const totalSomaScore = validMatches.reduce((sum, match) => sum + Number(match.somaScore || 0), 0);
        const totalPersonaScore = validMatches.reduce((sum, match) => sum + Number(match.personaScore || 0), 0);
        return {
            ...stats,
            matches,
            validMatches,
            totalMatches: validMatches.length,
            corruptMatches: matches.length - validMatches.length,
            overallWinRate: validMatches.length ? somaWins / validMatches.length : 0,
            averageSomaScore: validMatches.length ? totalSomaScore / validMatches.length : 0,
            averageOpponentScore: validMatches.length ? totalPersonaScore / validMatches.length : 0,
            strategyEfficacy: stats.strategyEfficacy || {},
            selectedStrategy: this.selectStrategy(stats).name,
            lastMatch: validMatches[validMatches.length - 1] || null
        };
    }
}

export default new GameTheoryArbiter();

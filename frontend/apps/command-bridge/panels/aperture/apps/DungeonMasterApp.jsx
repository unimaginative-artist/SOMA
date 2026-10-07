import React, { useState, useEffect } from 'react';
import { Skull, Shield, Zap, Sparkles, Volume2, Mic, Eye, Dice5, Scroll, Flame, BookOpen, Play, Users, ArrowRight, UserCheck } from 'lucide-react';

const CAMPAIGNS = [
  {
    id: 'cthulhu',
    name: 'Call of Cthulhu: Shadow Over Innsmouth',
    genre: 'Cosmic Horror & Madness',
    system: 'd100 Sanity System',
    accent: 'emerald',
    description: 'Investigate dark cosmic rituals, madness, and eldritch horrors in a foggy coastal town.',
    npcVoice: 'Dark Whispering Keeper',
    ambientSound: 'Eerie Ocean Waves & Distant Thunder'
  },
  {
    id: 'dnd5e',
    name: 'D&D 5E: The Curse of Strahd',
    genre: 'Gothic Dark Fantasy',
    system: 'd20 Ruleset',
    accent: 'purple',
    description: 'Traverse the mist-shrouded lands of Barovia, battling vampires, ghouls, and ancient curses.',
    npcVoice: 'Gothic Dungeon Master',
    ambientSound: 'Howling Barovian Winds & Crackling Hearth'
  }
];

const DEFAULT_PARTY = [
  { id: 1, name: 'Owner', handle: 'Dr. Vance', role: 'Arcane Scholar', hp: 24, maxHp: 30, sanity: 80, init: 18, active: true },
  { id: 2, name: 'Chris', handle: 'Chir', role: 'Paladin of Light', hp: 35, maxHp: 35, sanity: 75, init: 16, active: false },
  { id: 3, name: 'Agent M', handle: 'Agent M', role: 'Shadow Rogue', hp: 22, maxHp: 25, sanity: 70, init: 14, active: false },
  { id: 4, name: 'Alex', handle: 'Aegis', role: 'Life Cleric', hp: 28, maxHp: 28, sanity: 85, init: 11, active: false }
];

export default function DungeonMasterApp() {
  const [selectedCampaign, setSelectedCampaign] = useState(CAMPAIGNS[0]);
  const [inSession, setInSession] = useState(false);
  const [party, setParty] = useState(DEFAULT_PARTY);
  const [currentTurnIndex, setCurrentTurnIndex] = useState(0);
  const [logs, setLogs] = useState([]);
  const [playerInput, setPlayerInput] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastDice, setLastDice] = useState(null);

  const activePlayer = party[currentTurnIndex];

  const startSession = () => {
    setInSession(true);
    const intro = selectedCampaign.id === 'cthulhu'
      ? `SOMA (Keeper): Welcome Party! The sea fog rolls over Innsmouth. Hey ${activePlayer.name} (${activePlayer.handle}), you hold the lead lantern. What do you want to do?`
      : `SOMA (DM): Castle Ravenloft looms over Barovia. Initiative order is set! Hey ${activePlayer.name} (${activePlayer.handle}), you take the front rank. What is your move?`;

    setLogs([
      { sender: 'SOMA Game Master', text: intro, type: 'narration', timestamp: new Date().toLocaleTimeString() }
    ]);
  };

  const nextTurn = () => {
    const nextIdx = (currentTurnIndex + 1) % party.length;
    setCurrentTurnIndex(nextIdx);
    const nextPlayer = party[nextIdx];
    
    setParty(prev => prev.map((p, idx) => ({ ...p, active: idx === nextIdx })));

    const turnAnnouncement = `SOMA (DM): Turn advances to ${nextPlayer.name} (${nextPlayer.handle})! Hey ${nextPlayer.handle}, it's your turn. What do you want to do?`;
    
    setLogs(prev => [
      ...prev,
      { sender: 'Turn Manager', text: turnAnnouncement, type: 'turn', timestamp: new Date().toLocaleTimeString() }
    ]);
  };

  const handleRollDice = (sides = 20) => {
    const roll = Math.floor(Math.random() * sides) + 1;
    setLastDice({ sides, roll });

    let resultText = `🎲 ${activePlayer.handle} rolled d${sides}: ${roll}`;
    if (selectedCampaign.id === 'cthulhu' && sides === 100) {
      if (roll <= activePlayer.sanity) {
        resultText += ` (Sanity Check PASSED! Remaining Sanity: ${activePlayer.sanity})`;
      } else {
        const newSanity = Math.max(0, activePlayer.sanity - Math.floor(Math.random() * 8 + 2));
        setParty(prev => prev.map((p, idx) => idx === currentTurnIndex ? { ...p, sanity: newSanity } : p));
        resultText += ` (Sanity Check FAILED! Lost Sanity. Current Sanity: ${newSanity})`;
      }
    }

    setLogs(prev => [
      ...prev,
      { sender: 'Dice Engine', text: resultText, type: 'dice', timestamp: new Date().toLocaleTimeString() }
    ]);
  };

  const handleSendAction = (e) => {
    e.preventDefault();
    if (!playerInput.trim()) return;

    const actionText = playerInput;
    setPlayerInput('');

    setLogs(prev => [
      ...prev,
      { sender: `${activePlayer.name} (${activePlayer.handle})`, text: actionText, type: 'player', timestamp: new Date().toLocaleTimeString() }
    ]);

    // Simulate SOMA AI DM response + address player by name
    setIsSpeaking(true);
    setTimeout(() => {
      let dmResponse = `SOMA (${selectedCampaign.id === 'cthulhu' ? 'Keeper' : 'DM'}): As ${activePlayer.handle} executes "${actionText}", `;
      if (actionText.toLowerCase().includes('examine') || actionText.toLowerCase().includes('look')) {
        dmResponse += "your investigation uncovers ancient runes glowing on the altar!";
      } else if (actionText.toLowerCase().includes('attack') || actionText.toLowerCase().includes('strike')) {
        dmResponse += "your weapon strikes true, dealing 14 damage to the shadow creature!";
      } else {
        dmResponse += "the surrounding shadows react to your movement.";
      }

      // Automatically announce next player's turn
      const nextIdx = (currentTurnIndex + 1) % party.length;
      const nextPlayer = party[nextIdx];
      dmResponse += ` ... Hey ${nextPlayer.name} (${nextPlayer.handle}), you are up next! What do you want to do?`;

      setLogs(prev => [
        ...prev,
        { sender: 'SOMA Game Master', text: dmResponse, type: 'narration', timestamp: new Date().toLocaleTimeString() }
      ]);
      setIsSpeaking(false);
      setCurrentTurnIndex(nextIdx);
      setParty(prev => prev.map((p, idx) => ({ ...p, active: idx === nextIdx })));
    }, 1200);
  };

  return (
    <div className="h-full w-full flex flex-col bg-[#050508] text-slate-100 font-sans overflow-hidden">
      {/* Top Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-purple-600 to-emerald-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
            <Skull size={20} className="text-white animate-pulse" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white flex items-center gap-2">
              SOMA Campaign Master <span className="text-[10px] font-mono bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full border border-purple-500/30">4+ Player Party Tracker</span>
            </h1>
            <p className="text-xs text-slate-400 font-mono">D&D 5E & Call of Cthulhu AI Dungeon Master with Player Recognition</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-purple-500/10 text-purple-300 border border-purple-500/30 px-3 py-1.5 rounded-xl font-mono text-xs">
            <Users size={14} />
            <span>4 Players Registered</span>
          </div>
          <div className="flex items-center gap-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-3 py-1.5 rounded-xl font-mono text-xs">
            <Volume2 size={14} className="animate-bounce" />
            <span>Voice & Audio Active</span>
          </div>
        </div>
      </div>

      {!inSession ? (
        /* Campaign Selection Screen */
        <div className="flex-1 p-8 flex flex-col items-center justify-center max-w-4xl mx-auto text-center gap-6">
          <div className="space-y-2">
            <h2 className="text-2xl font-black text-white tracking-wide">Choose Your Campaign Realm</h2>
            <p className="text-sm text-slate-400">SOMA manages 4+ player parties, initiative turn orders, and addresses each player by name (e.g. "Hey Chir", "Hey Agent M").</p>
          </div>

          {/* Party Roster Setup Preview */}
          <div className="w-full bg-white/[0.02] border border-white/10 rounded-2xl p-4 text-left">
            <h3 className="text-xs font-bold text-purple-300 font-mono uppercase tracking-wider mb-3 flex items-center gap-2">
              <Users size={14} /> Active Party Roster (4 Players)
            </h3>
            <div className="grid grid-cols-4 gap-3">
              {party.map(p => (
                <div key={p.id} className="p-3 bg-white/5 border border-white/10 rounded-xl">
                  <div className="text-xs font-bold text-white">{p.name}</div>
                  <div className="text-[11px] text-purple-300 font-mono font-semibold">"{p.handle}"</div>
                  <div className="text-[10px] text-slate-400 font-mono mt-1">{p.role}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 w-full text-left my-2">
            {CAMPAIGNS.map(camp => (
              <div
                key={camp.id}
                onClick={() => setSelectedCampaign(camp)}
                className={`p-6 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-4 ${
                  selectedCampaign.id === camp.id
                    ? 'bg-purple-900/20 border-purple-500 shadow-xl shadow-purple-500/10'
                    : 'bg-white/[0.02] border-white/10 hover:border-white/20'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-mono px-2.5 py-1 rounded-md bg-white/10 text-purple-300 font-bold">{camp.system}</span>
                    <span className="text-xs font-mono text-slate-400">{camp.genre}</span>
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">{camp.name}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">{camp.description}</p>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={startSession}
            className="px-8 py-3.5 rounded-2xl bg-gradient-to-r from-purple-600 to-emerald-600 text-white font-bold flex items-center gap-2 shadow-lg shadow-purple-500/25 hover:opacity-90 transition-all text-sm"
          >
            <Play size={16} fill="white" /> Launch 4-Player Party Campaign
          </button>
        </div>
      ) : (
        /* In-Session Game Screen */
        <div className="flex-1 flex overflow-hidden">
          {/* Main Game Stream */}
          <div className="flex-1 flex flex-col border-r border-white/10">
            {/* Session Top Bar */}
            <div className="px-6 py-3 border-b border-white/10 bg-white/[0.01] flex items-center justify-between font-mono text-xs">
              <div className="flex items-center gap-4">
                <span className="text-purple-300 font-bold">{selectedCampaign.name}</span>
                <span className="text-slate-500">|</span>
                <span className="text-emerald-400 flex items-center gap-1">
                  <UserCheck size={14} /> Active Turn: <strong className="text-white">{activePlayer.name} ("{activePlayer.handle}")</strong>
                </span>
              </div>

              {isSpeaking && (
                <div className="flex items-center gap-2 text-purple-400 animate-pulse">
                  <Volume2 size={14} /> SOMA DM Addressing {activePlayer.handle}...
                </div>
              )}
            </div>

            {/* Narration Log Stream */}
            <div className="flex-1 p-6 overflow-y-auto space-y-4">
              {logs.map((log, index) => (
                <div
                  key={index}
                  className={`p-4 rounded-2xl border text-sm leading-relaxed ${
                    log.type === 'narration'
                      ? 'bg-purple-950/20 border-purple-500/30 text-purple-100 shadow-md'
                      : log.type === 'dice'
                      ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200 font-mono'
                      : log.type === 'turn'
                      ? 'bg-cyan-950/20 border-cyan-500/30 text-cyan-200 font-mono'
                      : 'bg-white/[0.03] border-white/10 text-slate-200 ml-8'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5 font-mono text-xs">
                    <span className={`font-bold ${log.type === 'narration' ? 'text-purple-300' : 'text-emerald-400'}`}>
                      {log.sender}
                    </span>
                    <span className="text-[10px] text-slate-500">{log.timestamp}</span>
                  </div>
                  <p>{log.text}</p>
                </div>
              ))}
            </div>

            {/* Player Command Bar */}
            <form onSubmit={handleSendAction} className="p-4 border-t border-white/10 flex items-center gap-3 bg-white/[0.01]">
              <div className="text-xs font-mono text-purple-300 font-bold bg-purple-500/20 px-3 py-2 rounded-xl border border-purple-500/30 shrink-0">
                {activePlayer.handle}'s Turn:
              </div>
              <input
                type="text"
                value={playerInput}
                onChange={e => setPlayerInput(e.target.value)}
                placeholder={`What does ${activePlayer.handle} want to do? (e.g. 'I attack the ghoul')`}
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
              <button
                type="submit"
                className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-xs font-mono transition-all flex items-center gap-1.5"
              >
                End Turn & Pass <ArrowRight size={14} />
              </button>
            </form>
          </div>

          {/* Right Party & Initiative Roster Panel */}
          <div className="w-80 p-6 flex flex-col gap-6 bg-white/[0.01]">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-400 font-mono uppercase tracking-wider flex items-center gap-2">
                  <Users size={14} className="text-purple-400" /> Party Turn Order
                </h3>
                <button
                  onClick={nextTurn}
                  className="text-[10px] font-mono bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded-md"
                >
                  Skip Turn
                </button>
              </div>

              <div className="space-y-2">
                {party.map((p, idx) => (
                  <div
                    key={p.id}
                    className={`p-3 rounded-xl border transition-all ${
                      p.active
                        ? 'bg-purple-900/30 border-purple-500 text-white shadow-lg shadow-purple-500/20'
                        : 'bg-white/[0.02] border-white/10 text-slate-400'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="font-bold">{idx + 1}. {p.name} ("{p.handle}")</span>
                      <span className="text-[10px] text-purple-300">Init {p.init}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono mt-1">
                      <span>HP: {p.hp}/{p.maxHp}</span>
                      {selectedCampaign.id === 'cthulhu' && <span>Sanity: {p.sanity}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Action & Dice Engine */}
            <div className="space-y-3 pt-4 border-t border-white/10">
              <h3 className="text-xs font-bold text-slate-400 font-mono uppercase tracking-wider flex items-center gap-2">
                <Dice5 size={14} className="text-emerald-400" /> Roll for {activePlayer.handle}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleRollDice(20)}
                  className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-mono text-xs text-white font-bold flex flex-col items-center"
                >
                  <span className="text-purple-400 text-sm">d20</span>
                  <span>Attack/Check</span>
                </button>
                <button
                  onClick={() => handleRollDice(100)}
                  className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-mono text-xs text-white font-bold flex flex-col items-center"
                >
                  <span className="text-cyan-400 text-sm">d100</span>
                  <span>Sanity Check</span>
                </button>
              </div>
            </div>

            {/* Vision & Speaker Recognition Status */}
            <div className="mt-auto pt-4 border-t border-white/10 flex flex-col gap-1 text-[11px] font-mono text-slate-400">
              <div className="flex items-center gap-2 text-cyan-300 font-semibold">
                <Eye size={12} /> Speaker Recognition Active
              </div>
              <span>Identifies face/voice & prompts turn by name</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

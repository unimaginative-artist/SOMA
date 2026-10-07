import React, { useState, useEffect } from 'react';
import {
    Bot, Mail, MessageSquare, Shield, Zap, Info,
    Smartphone, CheckCircle, XCircle, Terminal,
    Settings, Sliders, Activity, User, HelpCircle,
    Inbox, Cloud, AtSign, MailOpen, ExternalLink, Copy, X
} from 'lucide-react';
import { toast } from 'react-toastify';
import KevinSMSSettings from './KevinSMSSettings';

// Email Provider Setup Instructions
const emailProviders = {
    gmail: {
      name: 'Gmail / Google',
      iconType: 'gmail',
      color: '#EA4335',
      steps: [
        { title: 'Enable 2-Factor Authentication', desc: 'Go to your Google Account security settings and enable 2FA if not already enabled.', link: 'https://myaccount.google.com/security', linkText: 'Google Security Settings' },
        { title: 'Generate App Password', desc: 'After 2FA is enabled, create an App Password specifically for Kevin.', link: 'https://myaccount.google.com/apppasswords', linkText: 'Create App Password' },
        { title: 'Select App Type', desc: 'Choose "Mail" as the app and "Windows Computer" (or Other) as the device.' },
        { title: 'Copy the 16-character password', desc: 'Google will show you a 16-character password. Copy this - you won\'t see it again!' },
        { title: 'Enter in Kevin Settings', desc: 'Paste your Gmail address and the App Password in the fields above.' }
      ],
      imapServer: 'imap.gmail.com',
      imapPort: 993,
      notes: 'Gmail requires an App Password, not your regular Google password. Regular passwords will not work.'
    },
    outlook: {
      name: 'Outlook / Microsoft 365',
      iconType: 'outlook',
      color: '#0078D4',
      steps: [
        { title: 'Enable 2-Factor Authentication', desc: 'Go to Microsoft account security and enable 2FA.', link: 'https://account.microsoft.com/security', linkText: 'Microsoft Security' },
        { title: 'Generate App Password', desc: 'Under Security > Advanced security options, create an app password.', link: 'https://account.live.com/proofs/AppPassword', linkText: 'Create App Password' },
        { title: 'Name your app password', desc: 'Enter "Kevin Email Monitor" or similar as the name.' },
        { title: 'Copy the generated password', desc: 'Microsoft will display a password. Copy it immediately.' },
        { title: 'Enter in Kevin Settings', desc: 'Use your full Outlook email and the App Password above.' }
      ],
      imapServer: 'outlook.office365.com',
      imapPort: 993,
      notes: 'For Microsoft 365 work/school accounts, your admin may need to enable IMAP access.'
    },
    yahoo: {
      name: 'Yahoo Mail',
      iconType: 'yahoo',
      color: '#6001D2',
      steps: [
        { title: 'Go to Account Security', desc: 'Access your Yahoo Account Info and security settings.', link: 'https://login.yahoo.com/myaccount/security', linkText: 'Yahoo Security Settings' },
        { title: 'Enable 2-Step Verification', desc: 'Turn on 2-step verification if not already enabled.' },
        { title: 'Generate App Password', desc: 'Scroll down to "Generate app password" or "Other ways to sign in".', link: 'https://login.yahoo.com/myaccount/security/app-password', linkText: 'App Passwords' },
        { title: 'Select "Other App"', desc: 'Choose "Other App" and enter "Kevin" as the name.' },
        { title: 'Copy and use the password', desc: 'Enter your Yahoo email and the generated app password above.' }
      ],
      imapServer: 'imap.mail.yahoo.com',
      imapPort: 993,
      notes: 'Yahoo requires an App Password for third-party email access.'
    },
    icloud: {
      name: 'iCloud Mail',
      iconType: 'icloud',
      color: '#007AFF',
      steps: [
        { title: 'Go to Apple ID Settings', desc: 'Sign in to your Apple ID account page.', link: 'https://appleid.apple.com/account/manage', linkText: 'Apple ID Settings' },
        { title: 'Enable Two-Factor Auth', desc: 'Ensure two-factor authentication is turned on for your Apple ID.' },
        { title: 'Generate App-Specific Password', desc: 'In Security section, click "Generate Password" under App-Specific Passwords.', link: 'https://appleid.apple.com/account/manage/security/appspecific/password', linkText: 'App-Specific Passwords' },
        { title: 'Label it "Kevin"', desc: 'Enter "Kevin Email Monitor" as the label for this password.' },
        { title: 'Enter credentials above', desc: 'Use your full iCloud email (@icloud.com) and the app-specific password.' }
      ],
      imapServer: 'imap.mail.me.com',
      imapPort: 993,
      notes: 'Use your @icloud.com, @me.com, or @mac.com email address.'
    },
    proton: {
      name: 'ProtonMail',
      iconType: 'proton',
      color: '#6D4AFF',
      steps: [
        { title: 'Get ProtonMail Bridge', desc: 'ProtonMail requires their Bridge app for IMAP access.', link: 'https://proton.me/mail/bridge', linkText: 'Download Bridge' },
        { title: 'Install and Login', desc: 'Install ProtonMail Bridge and sign in with your Proton account.' },
        { title: 'Get Bridge Password', desc: 'In Bridge, click your account and copy the "Password" shown (not your Proton password).' },
        { title: 'Note the IMAP settings', desc: 'Bridge shows IMAP server (127.0.0.1) and port (1143) - Kevin uses these automatically when Bridge is running.' },
        { title: 'Enter Bridge credentials', desc: 'Use your Proton email and the Bridge-generated password above.' }
      ],
      imapServer: '127.0.0.1',
      imapPort: 1143,
      notes: 'ProtonMail Bridge must be running on your computer for Kevin to connect.'
    },
    other: {
      name: 'Other Provider',
      iconType: 'other',
      color: '#6B7280',
      steps: [
        { title: 'Find your IMAP settings', desc: 'Search "[Your Provider] IMAP settings" to find the server address and port.' },
        { title: 'Enable IMAP access', desc: 'Most providers require you to enable IMAP in your email settings.' },
        { title: 'Check for App Passwords', desc: 'If your provider supports 2FA, you likely need an App Password instead of your regular password.' },
        { title: 'Enter your credentials', desc: 'Use your full email address and password (or app password) above.' }
      ],
      imapServer: 'varies',
      imapPort: 993,
      notes: 'Contact your email provider\'s support if you have trouble connecting.'
    }
  };

  // Render provider icon with consistent styling
  const renderProviderIcon = (iconType, size = 'md', color = null) => {
    const sizeClasses = {
      sm: 'w-4 h-4',
      md: 'w-5 h-5',
      lg: 'w-6 h-6',
      xl: 'w-8 h-8'
    };
    const iconClass = `${sizeClasses[size]} ${color ? '' : 'text-zinc-400'}`;
    const style = color ? { color } : {};

    switch (iconType) {
      case 'gmail': return <Mail className={iconClass} style={style} />;
      case 'outlook': return <Inbox className={iconClass} style={style} />;
      case 'yahoo': return <MailOpen className={iconClass} style={style} />;
      case 'icloud': return <Cloud className={iconClass} style={style} />;
      case 'proton': return <Shield className={iconClass} style={style} />;
      case 'other': return <AtSign className={iconClass} style={style} />;
      default: return <Mail className={iconClass} style={style} />;
    }
  };

// --- Kevin Configuration Component ---
const KevinConfig = ({ isConnected }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [verifying, setVerifying] = useState(false);
    const [accounts, setAccounts] = useState([]);
    
    // Setup Wizard State
    const [showEmailSetup, setShowEmailSetup] = useState(false);
    const [selectedProvider, setSelectedProvider] = useState(null);

    // Protocol State
    const [protocols, setProtocols] = useState({
        heuristics: true,
        zeroTrust: true,
        toneAnalysis: true,
        linkDetonation: false,
        autoDraft: false,
        smartPriority: false,
        actionExtract: false,
        styleLearn: false
    });
    
    // Fetch current config
    useEffect(() => {
        if (!isConnected) return;
        fetch('/api/kevin/status').then(res => res.json()).then(data => {
            if (data.success && data.status.config) {
                const cfg = data.status.config;
                // Determine monitored accounts
                if (cfg.monitored_accounts) {
                    setAccounts(cfg.monitored_accounts);
                }
                
                // If we have an email in config (from previous save), set it
                if (cfg.email) {
                    setEmail(cfg.email);
                }

                // Restore protocols
                if (cfg.protocols) {
                    setProtocols(prev => ({ ...prev, ...cfg.protocols }));
                }
            }
        });
    }, [isConnected]);

    // Save protocols whenever they change
    const saveProtocols = async (newProtocols) => {
        setProtocols(newProtocols);
        try {
            await fetch('/api/kevin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ protocols: newProtocols })
            });
        } catch (e) {
            console.error("Failed to save protocols", e);
        }
    };

    const handleVerify = async () => {
        if (!email || !password) {
            toast.error("Enter email and app password");
            return;
        }
        setVerifying(true);
        try {
            // Update monitored list to include this email
            const newAccounts = [...new Set([...accounts, email])];
            
            // 1. Save Credentials
            const envRes = await fetch('/api/setup/env', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    EMAIL_ADDRESS: email,
                    APP_PASSWORD: password
                })
            });
            const envData = await envRes.json();
            
            if (envData.success) {
                // 2. Update Kevin Config
                await fetch('/api/kevin/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        monitored_accounts: newAccounts
                    })
                });
                
                setAccounts(newAccounts);
                toast.success("Kevin is now guarding your inbox!");
                setPassword(''); // Clear UI
            } else {
                toast.error("Verification failed: " + envData.error);
            }
        } catch (e) {
            toast.error("Connection error: " + e.message);
        } finally {
            setVerifying(false);
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in">
            {/* Email Setup Wizard Modal */}
            {showEmailSetup && (
                <div className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
                    <div className="w-full max-w-2xl bg-[#151518] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                        {/* Header */}
                        <div className="p-4 border-b border-white/10 flex items-center justify-between" style={{ backgroundColor: selectedProvider ? emailProviders[selectedProvider]?.color + '10' : '#1a1a1a' }}>
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-black/30 border border-white/10 flex items-center justify-center">
                                    {selectedProvider ? renderProviderIcon(emailProviders[selectedProvider]?.iconType, 'lg', emailProviders[selectedProvider]?.color) : <Mail className="w-6 h-6 text-zinc-400" />}
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-white">
                                        {selectedProvider ? `${emailProviders[selectedProvider]?.name} Setup` : 'Email Setup Guide'}
                                    </h2>
                                    <p className="text-xs text-zinc-400">Follow these steps to connect Kevin to your email</p>
                                </div>
                            </div>
                            <button onClick={() => setShowEmailSetup(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                                <X className="w-5 h-5 text-zinc-400" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {/* Provider Selection (if none selected) */}
                            {!selectedProvider && (
                                <div className="p-6">
                                    <h3 className="text-sm font-bold text-zinc-300 mb-4">Select your email provider:</h3>
                                    <div className="grid grid-cols-2 gap-3">
                                        {Object.entries(emailProviders).map(([key, provider]) => (
                                            <button
                                                key={key}
                                                onClick={() => setSelectedProvider(key)}
                                                className="p-4 rounded-xl border border-white/10 bg-black/20 hover:border-white/30 hover:bg-black/40 transition-all flex items-center gap-3 text-left"
                                            >
                                                <div className="w-10 h-10 rounded-lg bg-black/40 border border-white/10 flex items-center justify-center flex-shrink-0">
                                                    {renderProviderIcon(provider.iconType, 'lg', provider.color)}
                                                </div>
                                                <div>
                                                    <div className="font-bold text-white">{provider.name}</div>
                                                    <div className="text-[10px] text-zinc-500">IMAP: {provider.imapServer}</div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Step by Step Guide */}
                            {selectedProvider && (
                                <div className="p-6">
                                    <div className="space-y-4">
                                        {emailProviders[selectedProvider]?.steps.map((step, idx) => (
                                            <div key={idx} className="flex gap-4">
                                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-fuchsia-500/20 border border-fuchsia-500/30 flex items-center justify-center text-fuchsia-400 font-bold text-sm">
                                                    {idx + 1}
                                                </div>
                                                <div className="flex-1 pt-1">
                                                    <h4 className="font-bold text-white text-sm mb-1">{step.title}</h4>
                                                    <p className="text-xs text-zinc-400 mb-2">{step.desc}</p>
                                                    {step.link && (
                                                        <a
                                                            href={step.link}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded-lg text-xs font-medium hover:bg-blue-500/20 transition-all"
                                                        >
                                                            <ExternalLink className="w-3 h-3" />
                                                            {step.linkText || 'Open Link'}
                                                            <Copy
                                                                className="w-3 h-3 ml-1 opacity-50 hover:opacity-100 cursor-pointer"
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    e.stopPropagation();
                                                                    navigator.clipboard.writeText(step.link);
                                                                    toast.success('Link copied!');
                                                                }}
                                                            />
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    {/* Technical Details */}
                                    <div className="mt-6 p-4 bg-black/30 border border-white/5 rounded-xl">
                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                            <div className="flex justify-between">
                                                <span className="text-zinc-500">IMAP:</span>
                                                <span className="text-zinc-300 font-mono">{emailProviders[selectedProvider]?.imapServer}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-zinc-500">Port:</span>
                                                <span className="text-zinc-300 font-mono">{emailProviders[selectedProvider]?.imapPort}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-white/10 flex items-center justify-between bg-black/20">
                            {selectedProvider ? (
                                <>
                                    <button onClick={() => setSelectedProvider(null)} className="px-4 py-2 text-zinc-400 hover:text-white text-xs font-bold uppercase">← Back</button>
                                    <button onClick={() => setShowEmailSetup(false)} className="px-6 py-2 bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-bold text-xs uppercase rounded-lg">Done</button>
                                </>
                            ) : (
                                <button onClick={() => setShowEmailSetup(false)} className="ml-auto px-4 py-2 text-zinc-400 hover:text-white text-xs font-bold uppercase">Close</button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Email Connection */}
            <div className="bg-black/20 border border-white/5 rounded-xl p-6">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-red-500/10 rounded-lg">
                            <Mail className="w-5 h-5 text-red-400" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Email Sentinel</h3>
                            <p className="text-xs text-zinc-500">Connect Kevin to your Gmail for threat scanning.</p>
                        </div>
                    </div>
                    <button 
                        onClick={() => setShowEmailSetup(true)}
                        className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                    >
                        <HelpCircle className="w-3 h-3" /> Setup Guide
                    </button>
                </div>

                <div className="space-y-4 max-w-md">
                    <div>
                        <label className="text-xs text-zinc-500 font-bold uppercase mb-1 block">Email Address</label>
                        <input 
                            type="email" 
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="redacted@example.com"
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:border-red-500/50 outline-none"
                        />
                    </div>
                    <div>
                        <div className="flex justify-between mb-1">
                            <label className="text-xs text-zinc-500 font-bold uppercase">App Password</label>
                            <a href="https://myaccount.google.com/apppasswords" target="_blank" className="text-[10px] text-blue-400 hover:text-blue-300">Get one here</a>
                        </div>
                        <input 
                            type="password" 
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="xxxx xxxx xxxx xxxx"
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-zinc-200 focus:border-red-500/50 outline-none"
                        />
                    </div>
                    <button 
                        onClick={handleVerify}
                        disabled={verifying}
                        className="w-full py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-50"
                    >
                        {verifying ? "Verifying Access..." : "Verify & Activate"}
                    </button>
                </div>
            </div>

            {/* Active Protocols - RESTORED */}
            <div className="bg-black/20 border border-white/5 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-purple-500/10 rounded-lg">
                        <Zap className="w-5 h-5 text-purple-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-white uppercase tracking-wider">Active Protocols</h3>
                        <p className="text-xs text-zinc-500">Fine-tune Kevin's behavior patterns.</p>
                    </div>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  {[ 
                    { id: 'heuristics', label: 'Hyper-Heuristics', desc: 'Predictive pattern matching', type: 'security' },
                    { id: 'zeroTrust', label: 'Zero-Trust Auth', desc: 'Verify every header', type: 'security' },
                    { id: 'toneAnalysis', label: 'Tone Analysis', desc: 'Detect social engineering', type: 'security' },
                    { id: 'linkDetonation', label: 'Link Detonation', desc: 'Sandbox URL execution', type: 'security' },
                    { id: 'autoDraft', label: 'Auto-Draft', desc: 'Generate smart replies', type: 'productivity' },
                    { id: 'smartPriority', label: 'Smart Priority', desc: 'AI-based inbox sorting', type: 'productivity' },
                    { id: 'actionExtract', label: 'Action Extraction', desc: 'Find tasks & deadlines', type: 'productivity' },
                    { id: 'styleLearn', label: 'Style Learning', desc: 'Adapt to your tone', type: 'productivity' },
                  ].map(p => {
                    const isActive = protocols[p.id];
                    const isSecurity = p.type === 'security';

                    return (
                      <button
                        key={p.id}
                        onClick={() => saveProtocols({ ...protocols, [p.id]: !isActive })}
                        className={`text-left p-3 rounded-lg border transition-all ${isActive
                          ? isSecurity
                            ? 'bg-fuchsia-500/10 border-fuchsia-500/30'
                            : 'bg-emerald-500/10 border-emerald-500/30'
                          : 'bg-zinc-900 border-white/5 opacity-50'
                          }`}
                      >
                        <div className={`text-sm font-bold ${isActive
                          ? isSecurity
                            ? 'text-fuchsia-400'
                            : 'text-emerald-400'
                          : 'text-zinc-400'
                          }`}>
                          {p.label}
                        </div>
                        <div className="text-[10px] text-zinc-500">{p.desc}</div>
                      </button>
                    );
                  })}
                </div>
            </div>

            {/* Monitored Accounts */}
            <div className="bg-black/20 border border-white/5 rounded-xl p-6">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center">
                    <Shield className="w-4 h-4 mr-2 text-emerald-400" />
                    Active Perimeter
                </h3>
                {accounts.length === 0 ? (
                    <div className="text-zinc-600 text-sm italic">No accounts currently monitored.</div>
                ) : (
                    <div className="space-y-2">
                        {accounts.map(acc => (
                            <div key={acc} className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                                <span className="text-sm text-zinc-300">{acc}</span>
                                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded border border-emerald-500/20 uppercase font-bold">Secure</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* SMS / Telegram */}
            <div className="bg-black/20 border border-white/5 rounded-xl p-6">
                <KevinSMSSettings isConnected={isConnected} />
            </div>
        </div>
    );
};

// --- Steve Configuration Component ---
const SteveConfig = ({ isConnected }) => {
    const [sassLevel, setSassLevel] = useState(50); // 0-100
    const [autoFix, setAutoFix] = useState(false);
    const [masks, setMasks] = useState(['Architect', 'Critic', 'Hacker', 'Mentor']);
    const [activeMask, setActiveMask] = useState('Architect');
    
    // Detailed Steve settings
    const [capabilities, setCapabilities] = useState({
        file_create: true,
        file_delete: false,
        exec_shell: true,
        net_access: true,
        git_control: false
    });

    return (
        <div className="space-y-6 animate-in fade-in">
            {/* Personality Core */}
            <div className="bg-black/20 border border-white/5 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-emerald-500/10 rounded-lg">
                        <Bot className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-white uppercase tracking-wider">S.T.E.V.E. Personality Matrix</h3>
                        <p className="text-xs text-zinc-500">Supervised Terminal Execution & Validation Engine</p>
                    </div>
                </div>

                <div className="space-y-6">
                    <div>
                        <div className="flex justify-between mb-2">
                            <label className="text-xs text-zinc-500 font-bold uppercase">Grumpiness / Sass Level</label>
                            <span className="text-xs font-mono text-emerald-400">{sassLevel}%</span>
                        </div>
                        <input 
                            type="range" 
                            min="0" 
                            max="100" 
                            value={sassLevel}
                            onChange={(e) => setSassLevel(parseInt(e.target.value))}
                            className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                        />
                        <div className="flex justify-between mt-1 text-[10px] text-zinc-600 uppercase">
                            <span>Helpful Intern</span>
                            <span>Senior Dev</span>
                        </div>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                        <div>
                            <div className="text-sm font-medium text-zinc-200">Autonomous Refactoring</div>
                            <div className="text-xs text-zinc-500">Allow Steve to fix sloppy code without asking.</div>
                        </div>
                        <button 
                            onClick={() => setAutoFix(!autoFix)}
                            className={`w-10 h-5 rounded-full p-1 transition-colors ${autoFix ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                        >
                            <div className={`w-3 h-3 bg-white rounded-full transition-transform ${autoFix ? 'translate-x-5' : 'translate-x-0'}`} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Role / Mask Selection */}
            <div className="bg-black/20 border border-white/5 rounded-xl p-6">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center">
                    <User className="w-4 h-4 mr-2 text-blue-400" />
                    Active Persona
                </h3>
                <div className="grid grid-cols-4 gap-3">
                    {masks.map(mask => (
                        <button
                            key={mask}
                            onClick={() => setActiveMask(mask)}
                            className={`p-3 rounded-lg border text-center transition-all ${ 
                                activeMask === mask 
                                ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' 
                                : 'bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10'
                            }`}
                        >
                            <div className="text-xs font-bold uppercase">{mask}</div>
                        </button>
                    ))}
                </div>
                <div className="mt-4 p-3 bg-black/40 rounded-lg text-xs text-zinc-400 border border-white/5 italic">
                    {activeMask === 'Architect' && "Focused on structure, patterns, and long-term viability."}
                    {activeMask === 'Critic' && "Finds flaws, bugs, and potential optimizations."}
                    {activeMask === 'Hacker' && "Quick fixes, scripts, and bypasses. Security optional."}
                    {activeMask === 'Mentor' && "Explains concepts clearly and guides implementation."}
                </div>
            </div>

            {/* Capabilities Matrix */}
            <div className="bg-black/20 border border-white/5 rounded-xl p-6">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center">
                    <Terminal className="w-4 h-4 mr-2 text-fuchsia-400" />
                    Operational Capabilities
                </h3>
                <div className="grid grid-cols-2 gap-3">
                    {Object.entries(capabilities).map(([cap, allowed]) => (
                        <button
                            key={cap}
                            onClick={() => setCapabilities(prev => ({...prev, [cap]: !allowed}))}
                            className={`flex items-center justify-between p-3 rounded-lg border transition-all ${ 
                                allowed 
                                ? 'bg-white/10 border-emerald-500/30' 
                                : 'bg-zinc-900 border-white/5 opacity-50'
                            }`}
                        >
                            <span className="text-xs font-medium uppercase text-zinc-300">{cap.replace('_', ' ')}</span>
                            <div className={`w-2 h-2 rounded-full ${allowed ? 'bg-emerald-500 shadow-[0_0_5px_#10b981]' : 'bg-zinc-700'}`} />
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

// --- Main Container ---
const UnifiedAgentSettings = ({ somaBackend }) => {
    const [activeAgent, setActiveAgent] = useState('kevin'); // 'kevin' or 'steve'
    const [isConnected, setIsConnected] = useState(false);

    // Monitor backend connection
    useEffect(() => {
        if (!somaBackend) return;
        setIsConnected(somaBackend.connected);
        
        const onConnect = () => setIsConnected(true);
        const onDisconnect = () => setIsConnected(false);
        
        somaBackend.on('connect', onConnect);
        somaBackend.on('disconnect', onDisconnect);
        
        return () => {
            somaBackend.off('connect', onConnect);
            somaBackend.off('disconnect', onDisconnect);
        };
    }, [somaBackend]);

    return (
        <div className="max-w-4xl mx-auto">
                        {/* Toggle Header */}
                        <div className="flex justify-center mb-8">
                            <div className="bg-black/40 p-1 rounded-xl border border-white/10 flex gap-1 shadow-2xl">
                                <button
                                    onClick={() => setActiveAgent('kevin')}
                                    className={`flex items-center px-6 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition-all ${
                                        activeAgent === 'kevin' 
                                        ? 'bg-red-500/20 text-red-400 shadow-lg border border-red-500/30' 
                                        : 'text-zinc-500 hover:text-zinc-300'
                                    }`}
                                >
                                    <Shield className="w-4 h-4 mr-2" />
                                    K.E.V.I.N. (Guardian)
                                </button>
                                <button
                                    onClick={() => setActiveAgent('steve')}
                                    className={`flex items-center px-6 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition-all ${
                                        activeAgent === 'steve' 
                                        ? 'bg-emerald-500/20 text-emerald-400 shadow-lg border border-emerald-500/30' 
                                        : 'text-zinc-500 hover:text-zinc-300'
                                    }`}
                                >
                                    <Bot className="w-4 h-4 mr-2" />
                                    S.T.E.V.E. (Execution)
                                </button>
                            </div>
                        </div>
            {/* Content Area */}
            <div className="relative min-h-[500px]">
                {activeAgent === 'kevin' ? (
                    <KevinConfig isConnected={isConnected} />
                ) : (
                    <SteveConfig isConnected={isConnected} />
                )}
            </div>
        </div>
    );
};

export default UnifiedAgentSettings;
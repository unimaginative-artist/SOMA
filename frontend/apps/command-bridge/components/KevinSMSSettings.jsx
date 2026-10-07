import React, { useState, useEffect } from 'react';
import { Smartphone, CheckCircle, XCircle, Send, Clock, Shield, MessageSquare, ChevronDown, Loader, Key, AlertTriangle, Cpu } from 'lucide-react';

const KevinSMSSettings = ({ isConnected }) => {
  const [config, setConfig] = useState(null);
  const [carriers, setCarriers] = useState([]);
  const [phone, setPhone] = useState('');
  const [provider, setProvider] = useState('gateway'); // 'gateway' or 'twilio'
  
  // Twilio Specific State
  const [twilioPhone, setTwilioPhone] = useState('');
  const [twilioAccountSid, setTwilioAccountSid] = useState('');
  const [twilioAuthToken, setTwilioAuthToken] = useState('');

  const [selectedCarrier, setSelectedCarrier] = useState('');
  const [briefingTime, setBriefingTime] = useState('07:00');
  const [briefingEnabled, setBriefingEnabled] = useState(false);
  const [liveChatEnabled, setLiveChatEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [testStatus, setTestStatus] = useState(null);
  const [showCarriers, setShowCarriers] = useState(false);

  useEffect(() => {
    fetchCarriers();
    if (isConnected) {
      fetchConfig();
    }
  }, [isConnected]);

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/kevin/sms/config');
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
        if (data.provider) setProvider(data.provider);
        if (data.carrierId) setSelectedCarrier(data.carrierId);
        if (data.phoneNumber) setPhone(formatPhone(data.phoneNumber));
        if (data.morningBriefing) {
          setBriefingTime(data.morningBriefing.time || '07:00');
          setBriefingEnabled(data.morningBriefing.enabled || false);
        }
        if (data.liveChatEnabled !== undefined) setLiveChatEnabled(data.liveChatEnabled);
      }
    } catch (e) {}
  };

  const fetchCarriers = async () => {
    try {
      const res = await fetch('/api/kevin/sms/carriers');
      if (res.ok) {
        const data = await res.json();
        if (data.carriers) {
          setCarriers(data.carriers);
        }
      }
    } catch (e) {
      console.error("Failed to fetch carriers:", e);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setTestStatus(null);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

    try {
      // 1. If Twilio, save secrets to env
      if (provider === 'twilio') {
        if (twilioAccountSid || twilioAuthToken || twilioPhone) {
          const envRes = await fetch('/api/setup/env', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              TWILIO_ACCOUNT_SID: twilioAccountSid.trim(),
              TWILIO_AUTH_TOKEN: twilioAuthToken.trim(),
              TWILIO_PHONE_NUMBER: twilioPhone.replace(/\D/g, '')
            }),
            signal: controller.signal
          });
          const envData = await envRes.json();
          if (!envData.success) {
            throw new Error(envData.error || 'Failed to cache Twilio secrets');
          }
        }
      }

      // 2. Save SMS service config
      const res = await fetch('/api/kevin/sms/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          phoneNumber: phone,
          carrier: provider === 'gateway' ? selectedCarrier : undefined,
          morningBriefing: {
            enabled: briefingEnabled,
            time: briefingTime,
            includeThreats: true,
            includeCalendar: true,
            includeActionItems: true,
            includePendingEmails: true
          }
        }),
        signal: controller.signal
      });
      
      const data = await res.json();
      if (data.success) {
        setConfig(prev => ({
          ...prev,
          enabled: data.enabled,
          provider: data.provider,
          phoneNumber: data.phoneNumber,
          carrier: data.carrier
        }));
        
        // Clear secrets fields from UI for security
        setTwilioAccountSid('');
        setTwilioAuthToken('');
        setTestStatus({ type: 'success', message: 'SMS Configuration Saved!' });
      } else {
        setTestStatus({ type: 'error', message: data.error || 'Configuration failed' });
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        setTestStatus({ type: 'error', message: 'Request timed out' });
      } else {
        setTestStatus({ type: 'error', message: e.message });
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
      setTimeout(() => setTestStatus(null), 4000);
    }
  };

  const handleTest = async () => {
    setLoading(true);
    setTestStatus(null);
    try {
      const res = await fetch('/api/kevin/sms/test', { method: 'POST' });
      const data = await res.json();
      setTestStatus(data.success
        ? { type: 'success', message: 'Test SMS dispatched! Check your device.' }
        : { type: 'error', message: data.error || 'Failed to dispatch test SMS' }
      );
    } catch (e) {
      setTestStatus({ type: 'error', message: 'Network connection failure' });
    }
    setLoading(false);
    setTimeout(() => setTestStatus(null), 6000);
  };

  const formatPhone = (value) => {
    const digits = value.replace(/\D/g, '').slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  };

  return (
    <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-5 shadow-lg space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-zinc-100 font-semibold text-sm flex items-center">
          <Smartphone className="w-4 h-4 mr-2 text-emerald-400" />
          Kevin SMS Dispatch
        </h3>
        <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
          config?.enabled
            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.2)]'
            : 'bg-zinc-700/30 text-zinc-500 border border-zinc-700/30'
        }`}>
          {config?.enabled ? 'Active' : 'Not Configured'}
        </div>
      </div>

      {/* Provider Selector Tabs */}
      <div className="grid grid-cols-2 p-1 bg-black/40 border border-white/5 rounded-lg">
        <button
          onClick={() => setProvider('gateway')}
          className={`py-1.5 text-center text-xs font-bold uppercase tracking-wider rounded transition-all ${
            provider === 'gateway'
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Free Gateway
        </button>
        <button
          onClick={() => setProvider('twilio')}
          className={`py-1.5 text-center text-xs font-bold uppercase tracking-wider rounded transition-all ${
            provider === 'twilio'
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Twilio API
        </button>
      </div>

      {/* Status Bar */}
      {config?.enabled && (
        <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
          <div className="flex items-center gap-2 text-xs text-emerald-300">
            <CheckCircle className="w-3.5 h-3.5" />
            <span>Active: {config.phoneNumber} via {config.provider === 'twilio' ? 'Twilio API' : (config.carrier || 'Gateway')}</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-zinc-500 mt-1 ml-5">
            <MessageSquare className="w-3 h-3" />
            Two-way replies: {liveChatEnabled ? 'ON' : 'OFF'}
            {briefingEnabled && (
              <span className="ml-2">| Briefing: {briefingTime}</span>
            )}
          </div>
        </div>
      )}

      {/* Form Fields */}
      <div className="space-y-3">
        {/* Recipient Phone Number */}
        <div>
          <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold block mb-1">
            Recipient Mobile Phone
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            placeholder="(555) 123-4567"
            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-emerald-500/50 focus:outline-none transition-colors"
          />
        </div>

        {/* Conditional Configuration Fields */}
        {provider === 'gateway' ? (
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold block mb-1">Mobile Carrier</label>
            <div className="relative">
              <button
                onClick={() => setShowCarriers(!showCarriers)}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-left flex items-center justify-between hover:border-white/20 transition-colors"
              >
                <span className={selectedCarrier ? 'text-zinc-200' : 'text-zinc-600'}>
                  {selectedCarrier
                    ? carriers.find(c => c.id === selectedCarrier)?.name || selectedCarrier
                    : 'Select your mobile carrier'
                  }
                </span>
                <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${showCarriers ? 'rotate-180' : ''}`} />
              </button>

              {showCarriers && (
                <div className="absolute z-[100] mt-1 w-full bg-[#1a1a1d] border border-white/10 rounded-lg shadow-xl max-h-48 overflow-y-auto custom-scrollbar">
                  {carriers.map(c => (
                    <button
                      key={c.id}
                      onClick={() => { setSelectedCarrier(c.id); setShowCarriers(false); }}
                      className={`w-full px-3 py-2 text-xs text-left hover:bg-white/5 transition-colors ${
                        selectedCarrier === c.id ? 'text-emerald-400 bg-emerald-500/10' : 'text-zinc-300'
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="text-[9px] text-zinc-600 mt-1 flex items-start gap-1">
              <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />
              Free gateways are rate-limited and often filtered by carriers.
            </p>
          </div>
        ) : (
          <div className="space-y-3 p-3 bg-black/30 border border-white/5 rounded-lg animate-in slide-in-from-top-1 duration-200">
            <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 font-bold uppercase tracking-wide">
              <Key className="w-3.5 h-3.5 text-blue-400" />
              Twilio API Keys
            </div>

            <div>
              <label className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold block mb-1">Twilio Phone Number</label>
              <input
                type="text"
                value={twilioPhone}
                onChange={(e) => setTwilioPhone(formatPhone(e.target.value))}
                placeholder="+1 (555) 000-0000"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-700 focus:border-blue-500/50 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold block mb-1">Account SID</label>
              <input
                type="text"
                value={twilioAccountSid}
                onChange={(e) => setTwilioAccountSid(e.target.value)}
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs font-mono text-zinc-200 placeholder-zinc-700 focus:border-blue-500/50 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold block mb-1">Auth Token</label>
              <input
                type="password"
                value={twilioAuthToken}
                onChange={(e) => setTwilioAuthToken(e.target.value)}
                placeholder="••••••••••••••••••••••••••••••••"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs font-mono text-zinc-200 placeholder-zinc-700 focus:border-blue-500/50 focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Morning Briefing Card */}
        <div className="border border-white/5 rounded-lg p-3 bg-black/20">
          <div className="flex items-center justify-between mb-2">
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold flex items-center">
              <Clock className="w-3 h-3 mr-1.5" /> Morning Briefing
            </label>
            <button
              onClick={() => setBriefingEnabled(!briefingEnabled)}
              className={`w-8 h-4 rounded-full transition-colors relative ${
                briefingEnabled ? 'bg-emerald-500' : 'bg-zinc-700'
              }`}
            >
              <div className={`w-3 h-3 bg-white rounded-full absolute top-0.5 transition-all`}
                style={{ left: briefingEnabled ? '17px' : '2px' }} />
            </button>
          </div>

          {briefingEnabled && (
            <div className="mt-2">
              <input
                type="time"
                value={briefingTime}
                onChange={(e) => setBriefingTime(e.target.value)}
                className="bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-emerald-500/50"
              />
              <p className="text-[9px] text-zinc-600 mt-1">Kevin will text a summary of overnight threats and events.</p>
            </div>
          )}
        </div>

        {/* Live Chat Toggle */}
        <div className="flex items-center justify-between border border-white/5 rounded-lg p-3 bg-black/20">
          <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold flex items-center">
            <MessageSquare className="w-3 h-3 mr-1.5" /> Live Two-Way Chat
          </label>
          <button
            onClick={() => setLiveChatEnabled(!liveChatEnabled)}
            className={`w-8 h-4 rounded-full transition-colors relative ${
              liveChatEnabled ? 'bg-emerald-500' : 'bg-zinc-700'
            }`}
          >
            <div className={`w-3 h-3 bg-white rounded-full absolute top-0.5 transition-all`}
              style={{ left: liveChatEnabled ? '17px' : '2px' }} />
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={loading || !phone || (provider === 'gateway' && !selectedCarrier)}
            className="flex-1 bg-emerald-600/80 hover:bg-emerald-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-xs font-bold py-2 px-3 rounded-lg transition-colors flex items-center justify-center gap-1.5"
          >
            {loading ? <Loader className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
            Save & Guard
          </button>

          {config?.enabled && (
            <button
              onClick={handleTest}
              disabled={loading}
              className="bg-blue-600/80 hover:bg-blue-600 disabled:bg-zinc-700 text-white text-xs font-bold py-2 px-3 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <Send className="w-3 h-3" />
              Test
            </button>
          )}
        </div>

        {/* Status Message */}
        {testStatus && (
          <div className={`p-2 rounded-lg text-xs flex items-center gap-1.5 animate-in fade-in duration-250 ${
            testStatus.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
              : 'bg-red-500/10 border border-red-500/20 text-red-400'
          }`}>
            {testStatus.type === 'success' ? <CheckCircle className="w-3 h-3 animate-bounce" /> : <XCircle className="w-3 h-3" />}
            {testStatus.message}
          </div>
        )}
      </div>
    </div>
  );
};

export default KevinSMSSettings;

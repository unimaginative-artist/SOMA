import React, { useState, useEffect } from 'react';
import { Shield, AlertTriangle, CheckCircle, XCircle, Clock, Play, FileCode, Lock, Zap } from 'lucide-react';

interface SecurityScan {
  id: string;
  type: 'injection' | 'xss' | 'secrets' | 'dependencies' | 'authentication' | 'encryption';
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'scanning' | 'passed' | 'failed';
  message: string;
  details?: string;
  timestamp: number;
}

interface SecurityGatesPanelProps {
  isVisible: boolean;
  blueprint: any[];
}

const SecurityGatesPanel: React.FC<SecurityGatesPanelProps> = ({ isVisible, blueprint }) => {
  const [scans, setScans] = useState<SecurityScan[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [overallScore, setOverallScore] = useState(0);
  const [isExporting, setIsExporting] = useState(false);

  const handleExportGMN = async () => {
    const htmlFile = blueprint.find((f: any) => f.path.endsWith('.html'));
    if (!htmlFile) {
      alert('No HTML file found in blueprint to export.');
      return;
    }
    const siteName = window.prompt('Enter GMN Site Name (e.g. my-site):');
    if (!siteName) return;

    setIsExporting(true);
    try {
      const res = await fetch('/api/pulse/export-gmn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteName, html: htmlFile.content })
      });
      const data = await res.json();
      if (data.success) {
        alert('Cryptographic signature generated! Artifact saved. You can now use `soma publish ' + siteName + '` in the terminal.');
      } else {
        alert('Failed to sign artifact: ' + data.error);
      }
    } catch (err) {
      alert('Export failed: ' + String(err));
    } finally {
      setIsExporting(false);
    }
  };

  const runSecurityScan = async () => {
    setIsScanning(true);
    try {
      const res = await fetch('/api/security/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blueprint })
      });
      
      const data = await res.json();
      if (data.success) {
        setScans(data.scans || []);
        setOverallScore(data.score || 0);
      }
    } catch (err) {
      console.error('Security scan failed', err);
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    if (isVisible && blueprint.length > 0) {
      runSecurityScan();
    }
  }, [isVisible]);

  const criticalIssues = scans.filter(s => s.severity === 'critical' && s.status === 'failed').length;
  const highIssues = scans.filter(s => s.severity === 'high' && s.status === 'failed').length;
  const passedScans = scans.filter(s => s.status === 'passed').length;

  if (!isVisible) return null;

  return (
    <div className="absolute inset-0 bg-zinc-950/95 backdrop-blur-md z-30 flex flex-col overflow-hidden border-l border-red-500/20">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800 bg-gradient-to-r from-red-950/50 to-transparent">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center justify-center">
              <Shield className="w-4 h-4 text-red-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Security Council</h2>
              <p className="text-[10px] text-zinc-500">KEVIN-powered pre-deployment gates</p>
            </div>
          </div>
          <button
            onClick={runSecurityScan}
            disabled={isScanning || blueprint.length === 0}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-lg text-xs font-bold transition-all"
          >
            {isScanning ? (
              <>
                <Zap className="w-3.5 h-3.5 animate-pulse" />
                <span>SCANNING...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>RUN SCAN</span>
              </>
            )}
          </button>
        </div>

        {/* Score Display */}
        <div className="flex items-center justify-between p-3 bg-zinc-900/50 border border-zinc-800 rounded-lg">
          <div>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Security Score</p>
            <div className="flex items-center space-x-2">
              <span className={`text-2xl font-bold ${
                overallScore >= 90 ? 'text-emerald-400' :
                overallScore >= 70 ? 'text-yellow-400' :
                'text-red-400'
              }`}>
                {overallScore}
              </span>
              <span className="text-sm text-zinc-500">/100</span>
            </div>
          </div>
          <div className="flex space-x-3">
            {criticalIssues > 0 && (
              <div className="text-center">
                <p className="text-lg font-bold text-red-400">{criticalIssues}</p>
                <p className="text-[9px] text-zinc-500 uppercase">Critical</p>
              </div>
            )}
            {highIssues > 0 && (
              <div className="text-center">
                <p className="text-lg font-bold text-orange-400">{highIssues}</p>
                <p className="text-[9px] text-zinc-500 uppercase">High</p>
              </div>
            )}
            <div className="text-center">
              <p className="text-lg font-bold text-emerald-400">{passedScans}</p>
              <p className="text-[9px] text-zinc-500 uppercase">Passed</p>
            </div>
          </div>
        </div>
      </div>

      {/* Scan Results */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
        {scans.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-3">
            <div className="w-16 h-16 bg-zinc-900/50 border border-zinc-800 rounded-full flex items-center justify-center">
              <Shield className="w-8 h-8 text-zinc-700" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-400">No security scan results</p>
              <p className="text-xs text-zinc-600 mt-1">
                {blueprint.length === 0 
                  ? 'Create a blueprint first'
                  : 'Click "Run Scan" to start security analysis'}
              </p>
            </div>
          </div>
        ) : (
          scans.map((scan) => (
            <div
              key={scan.id}
              className={`p-3 rounded-lg border ${
                scan.status === 'failed' && scan.severity === 'critical'
                  ? 'bg-red-950/30 border-red-500/30'
                  : scan.status === 'failed' && scan.severity === 'high'
                  ? 'bg-orange-950/30 border-orange-500/30'
                  : scan.status === 'passed'
                  ? 'bg-emerald-950/30 border-emerald-500/30'
                  : 'bg-zinc-900/50 border-zinc-800'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-start space-x-2 flex-1">
                  <div className="mt-0.5">
                    {scan.status === 'passed' && (
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                    )}
                    {scan.status === 'failed' && (
                      <XCircle className={`w-4 h-4 ${
                        scan.severity === 'critical' ? 'text-red-400' :
                        scan.severity === 'high' ? 'text-orange-400' :
                        'text-yellow-400'
                      }`} />
                    )}
                    {scan.status === 'scanning' && (
                      <Clock className="w-4 h-4 text-blue-400 animate-spin" />
                    )}
                    {scan.status === 'pending' && (
                      <Clock className="w-4 h-4 text-zinc-600" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded ${
                        scan.type === 'injection' ? 'bg-red-500/10 text-red-400 border border-red-500/30' :
                        scan.type === 'xss' ? 'bg-orange-500/10 text-orange-400 border border-orange-500/30' :
                        scan.type === 'secrets' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/30' :
                        scan.type === 'dependencies' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30' :
                        scan.type === 'authentication' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' :
                        'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      }`}>
                        {scan.type}
                      </span>
                      {scan.status === 'failed' && (
                        <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded ${
                          scan.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                          scan.severity === 'high' ? 'bg-orange-500/20 text-orange-400' :
                          scan.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-zinc-500/20 text-zinc-400'
                        }`}>
                          {scan.severity}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-white font-medium">{scan.message}</p>
                    {scan.details && (
                      <p className="text-xs text-zinc-400 mt-1">{scan.details}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      {scans.length > 0 && (
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/30">
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-zinc-500">
              Last scan: {new Date().toLocaleTimeString()}
            </div>
            {criticalIssues === 0 && highIssues === 0 ? (
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2 text-emerald-400">
                  <CheckCircle className="w-4 h-4" />
                  <span className="text-xs font-bold">APPROVED FOR DEPLOYMENT</span>
                </div>
                <button
                  onClick={handleExportGMN}
                  disabled={isExporting}
                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold transition-colors disabled:opacity-50"
                >
                  {isExporting ? 'SIGNING...' : 'EXPORT FOR GMN'}
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-2 text-red-400">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-xs font-bold">FIX ISSUES BEFORE DEPLOY</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SecurityGatesPanel;

import React from 'react';
import { AlertTriangle, RefreshCw, Copy, Check, X, ShieldAlert } from 'lucide-react';

export default class WindowErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, copied: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error(`[ApertureOS Self-Healing] App ${this.props.appId || 'unknown'} crashed:`, error, errorInfo);
  }

  handleRestart = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onRestart) {
      this.props.onRestart();
    }
  };

  handleCopy = () => {
    const trace = `Error in App [${this.props.appId}]:\n${this.state.error?.message}\n${this.state.error?.stack || ''}\n${this.state.errorInfo?.componentStack || ''}`;
    navigator.clipboard.writeText(trace);
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 2000);
  };

  render() {
    if (this.state.hasError) {
      const { appId, winId, onClose } = this.props;
      const errorMsg = this.state.error?.message || 'Unexpected application runtime exception';
      const isAssetError = errorMsg.includes('preload CSS') || errorMsg.includes('dynamically imported') || errorMsg.includes('Failed to fetch');

      return (
        <div className="ap-self-healing-overlay">
          <div className="ap-healing-card">
            <div className="ap-healing-header">
              <div className="ap-healing-badge">
                <ShieldAlert size={16} className="text-amber-400" />
                <span>SOMA Self-Healing Ring</span>
              </div>
              {onClose && (
                <button onClick={() => onClose(winId)} className="quiet" title="Close Window">
                  <X size={13} />
                </button>
              )}
            </div>

            <div className="ap-healing-body">
              <h4>Process Fault Contained: <span className="font-mono">{appId}</span></h4>
              <p className="ap-healing-desc">
                The Aperture microkernel isolated an exception within this window sandbox.
                Desktop shell and peer processes remain fully operational.
              </p>

              <div className="ap-healing-trace">
                <strong>Error:</strong> {errorMsg}
                {this.state.error?.stack && (
                  <pre>{this.state.error.stack.split('\n').slice(0, 4).join('\n')}</pre>
                )}
              </div>

              <div className="ap-healing-actions">
                <button onClick={this.handleRestart} className="ap-healing-btn-restart">
                  <RefreshCw size={13} />
                  <span>Restart Process</span>
                </button>
                {isAssetError && (
                  <button onClick={() => window.location.reload()} className="ap-healing-btn-restart" style={{ background: 'rgba(56,189,248,0.2)', borderColor: 'rgba(56,189,248,0.4)', color: '#38bdf8' }}>
                    <RefreshCw size={13} />
                    <span>Reload Page</span>
                  </button>
                )}
                <button onClick={this.handleCopy} className="ap-healing-btn-copy">
                  {this.state.copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                  <span>{this.state.copied ? 'Trace Copied' : 'Copy Trace'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

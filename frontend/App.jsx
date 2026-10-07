import React from 'react';
import './index.css';
import SomaCommandBridge from './apps/command-bridge/SomaCommandBridge';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, background: '#1a1a1a', color: 'red', height: '100vh', overflow: 'auto' }}>
          <h1>⚠️ Application Crashed</h1>
          <h2>{this.state.error && this.state.error.toString()}</h2>
          <details style={{ whiteSpace: 'pre-wrap' }}>
            {this.state.errorInfo && this.state.errorInfo.componentStack}
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}

function App() {
  return (
    <ErrorBoundary>
      <SomaCommandBridge />
    </ErrorBoundary>
  );
}

export default App;
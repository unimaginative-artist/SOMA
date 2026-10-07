import React, { useEffect, useState } from 'react';
import { Activity, Cpu, HardDrive, RefreshCw, Wifi } from 'lucide-react';
import somaBackend from '../../../somaBackend';

function Bar({ label, value, color }) {
  return <div className="ap-status-bar"><div><span>{label}</span><strong>{value == null ? 'Unavailable' : `${value}%`}</strong></div><i><b style={{ width: `${value || 0}%`, background: color }} /></i></div>;
}

export default function SystemStatus() {
  const [snapshot, setSnapshot] = useState(null);
  const [processes, setProcesses] = useState([]);
  const [feed, setFeed] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const [state, processResult, activity] = await Promise.all([
      somaBackend.fetch('/api/system/state'),
      somaBackend.fetch('/api/system/processes').catch(() => ({ processes: [] })),
      somaBackend.fetch('/api/activity/recent?limit=8').catch(() => ({ feed: [] }))
    ]);
    if (state.success) {
      setSnapshot(state.snapshot);
      setHistory(previous => [...previous.slice(-11), { id: Date.now(), at: new Date().toLocaleTimeString([], { minute: '2-digit', second: '2-digit' }), cpu: state.snapshot.cpu, ram: state.snapshot.ram }]);
    }
    setProcesses(processResult.processes || processResult.data || []);
    setFeed(activity.feed || []);
    setLoading(false);
  };

  useEffect(() => {
    refresh().catch(() => setLoading(false));
    const timer = setInterval(() => refresh().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="ap-status-app">
      <header><div><Activity size={17} /><strong>Live System Status</strong></div><button onClick={refresh}><RefreshCw size={14} />Refresh</button></header>
      {loading ? <div className="ap-empty">Loading live telemetry...</div> : (
        <>
          <div className="ap-status-summary">
            <Bar label="CPU load" value={snapshot?.cpu} color="#2898b4" />
            <Bar label="Memory use" value={snapshot?.ram} color="#5c71dd" />
            <Bar label="Network load" value={snapshot?.network} color="#20a676" />
          </div>
          <div className="ap-status-detail">
            <section>
              <h3><Cpu size={13} /> Runtime</h3>
              <p>State <strong>{snapshot?.status || 'unavailable'}</strong></p>
              <p>Uptime <strong>{snapshot ? `${Math.floor(snapshot.uptime / 60)} min` : '--'}</strong></p>
              <p>Cores <strong>{snapshot?.systemDetail?.cpu?.cores ?? '--'}</strong></p>
              <p>Node RSS <strong>{snapshot?.memory?.rss ? `${snapshot.memory.rss} MB` : '--'}</strong></p>
            </section>
            <section>
              <h3><HardDrive size={13} /> Sample History</h3>
              {history.map(sample => <div key={sample.id} className="ap-sample"><span>{sample.at}</span><small>CPU {sample.cpu}%</small><small>RAM {sample.ram}%</small></div>)}
            </section>
            <section>
              <h3><Wifi size={13} /> Recent Activity</h3>
              {feed.slice(0, 6).map(entry => <div key={entry.id} className="ap-feed"><strong>{entry.action}</strong><small>{entry.agent}</small></div>)}
              {!feed.length && <p>No current activity events.</p>}
            </section>
          </div>
          {!!processes.length && <footer>{processes.length} runtime processes reported by the server.</footer>}
        </>
      )}
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { 
  Brain, Database, Search, Plus, Trash2, Edit3, Link2, Sparkles, 
  TrendingUp, Zap, Filter, Download, Upload, RefreshCw, Eye, EyeOff,
  GitBranch, Target, Lightbulb, Network, Activity, Clock, BarChart3
} from 'lucide-react';
import KnowledgeGraph3D from '../../../command-bridge/KnowledgeGraph3D';

/**
 * EnhancedKnowledgeSystem - Interactive knowledge management interface
 * Features:
 * - Real-time knowledge graph exploration
 * - Search and filter capabilities
 * - Add/edit/delete knowledge nodes
 * - Connection strength visualization
 * - Knowledge clustering and patterns
 * - Memory consolidation controls
 * - Export/import knowledge
 */
const EnhancedKnowledgeSystem = ({ knowledgeNodes, fragments, graphData, onRefresh }) => {
  const [selectedNode, setSelectedNode] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [viewMode, setViewMode] = useState('graph'); // 'graph', 'list', 'clusters'
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [stats, setStats] = useState(null);
  const [recentActivity, setRecentActivity] = useState([]);
  
  // Fetch knowledge statistics
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch('/api/knowledge/stats');
        if (response.ok) {
          const data = await response.json();
          setStats(data.stats);
        }
      } catch (error) {
        console.error('Failed to fetch knowledge stats:', error);
      }
    };
    
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);
  
  // Fetch recent knowledge activity
  useEffect(() => {
    const fetchActivity = async () => {
      try {
        const response = await fetch('/api/knowledge/activity');
        if (response.ok) {
          const data = await response.json();
          setRecentActivity(data.activities || []);
        }
      } catch (error) {
        console.error('Failed to fetch activity:', error);
      }
    };
    
    fetchActivity();
    const interval = setInterval(fetchActivity, 10000);
    return () => clearInterval(interval);
  }, []);
  
  // Filter nodes based on search and type
  const filteredNodes = knowledgeNodes.filter(node => {
    const matchesSearch = !searchQuery || 
      node.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      node.content?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || node.type === filterType;
    return matchesSearch && matchesType;
  });
  
  // Calculate knowledge clusters
  const clusters = React.useMemo(() => {
    const clusterMap = {};
    filteredNodes.forEach(node => {
      const type = node.type || 'unknown';
      if (!clusterMap[type]) {
        clusterMap[type] = { type, count: 0, nodes: [], avgConnections: 0 };
      }
      clusterMap[type].count++;
      clusterMap[type].nodes.push(node);
      clusterMap[type].avgConnections += (node.connections || 0);
    });
    
    Object.values(clusterMap).forEach(cluster => {
      cluster.avgConnections = Math.round(cluster.avgConnections / cluster.count);
    });
    
    return Object.values(clusterMap).sort((a, b) => b.count - a.count);
  }, [filteredNodes]);
  
  // Add new knowledge node
  const handleAddNode = async (nodeData) => {
    try {
      const response = await fetch('/api/knowledge/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nodeData)
      });
      
      if (response.ok) {
        setShowAddDialog(false);
        onRefresh?.();
      }
    } catch (error) {
      console.error('Failed to add node:', error);
    }
  };
  
  // Delete knowledge node
  const handleDeleteNode = async (nodeId) => {
    if (!confirm('Are you sure you want to delete this knowledge node?')) return;
    
    try {
      const response = await fetch(`/api/knowledge/delete/${nodeId}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        setSelectedNode(null);
        onRefresh?.();
      }
    } catch (error) {
      console.error('Failed to delete node:', error);
    }
  };
  
  // Consolidate memories
  const handleConsolidate = async () => {
    try {
      const response = await fetch('/api/knowledge/consolidate', {
        method: 'POST'
      });
      
      if (response.ok) {
        const data = await response.json();
        alert(`Consolidated ${data.merged} nodes, strengthened ${data.strengthened} connections`);
        onRefresh?.();
      }
    } catch (error) {
      console.error('Failed to consolidate:', error);
    }
  };
  
  return (
    <div className="space-y-6">
      {/* Header with Stats */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white tracking-tight flex items-center">
          <Brain className="w-6 h-6 mr-3 text-pink-400" /> 
          Cognitive Knowledge System
        </h2>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={onRefresh}
            className="p-2 bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4 text-zinc-400" />
          </button>
          <button
            onClick={() => setShowAddDialog(true)}
            className="p-2 bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 transition-colors flex items-center space-x-2"
            title="Add Knowledge Node"
          >
            <Plus className="w-4 h-4 text-zinc-400" />
            <span className="text-xs font-medium text-zinc-400">Add</span>
          </button>
        </div>
      </div>
      
      {/* Quick Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <Database className="w-4 h-4 text-cyan-400" />
            <TrendingUp className="w-3 h-3 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white">{knowledgeNodes.length}</div>
          <div className="text-xs text-zinc-500 mt-1">Total Nodes</div>
        </div>
        
        <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <Link2 className="w-4 h-4 text-blue-400" />
            <Activity className="w-3 h-3 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {stats?.totalConnections || graphData.edges?.length || 0}
          </div>
          <div className="text-xs text-zinc-500 mt-1">Connections</div>
        </div>
        
        <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <GitBranch className="w-4 h-4 text-purple-400" />
            <Sparkles className="w-3 h-3 text-purple-400" />
          </div>
          <div className="text-2xl font-bold text-white">{clusters.length}</div>
          <div className="text-xs text-zinc-500 mt-1">Clusters</div>
        </div>
        
        <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <Zap className="w-4 h-4 text-amber-400" />
            <BarChart3 className="w-3 h-3 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {Math.round((stats?.avgStrength || 0) * 100)}%
          </div>
          <div className="text-xs text-zinc-500 mt-1">Avg Strength</div>
        </div>
      </div>
      
      {/* Controls Bar */}
      <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-4">
        <div className="flex items-center space-x-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search knowledge..."
              className="w-full bg-zinc-900/50 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-pink-500/50 transition-colors"
            />
          </div>
          
          {/* Filter */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-zinc-900/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-pink-500/50 transition-colors"
          >
            <option value="all">All Types</option>
            <option value="concept">Concepts</option>
            <option value="memory">Memories</option>
            <option value="skill">Skills</option>
            <option value="pattern">Patterns</option>
            <option value="system">System</option>
          </select>
          
          {/* View Mode */}
          <div className="flex items-center space-x-1 bg-zinc-900/50 border border-white/10 rounded-lg p-1">
            {['graph', 'list', 'clusters'].map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  viewMode === mode 
                    ? 'bg-pink-600 text-white' 
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {mode === 'graph' && <Network className="w-3 h-3" />}
                {mode === 'list' && <Database className="w-3 h-3" />}
                {mode === 'clusters' && <GitBranch className="w-3 h-3" />}
              </button>
            ))}
          </div>
          
          {/* Actions */}
          <button
            onClick={handleConsolidate}
            className="px-3 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 rounded-lg border border-purple-500/30 text-xs font-medium transition-colors flex items-center space-x-1"
          >
            <Sparkles className="w-3 h-3" />
            <span>Consolidate</span>
          </button>
        </div>
      </div>
      
      {/* Main Content Area */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left Panel - List/Clusters */}
        <div className="col-span-4 bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-5 h-[600px] flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-zinc-100 font-semibold text-sm uppercase tracking-wider">
              {viewMode === 'clusters' ? 'Knowledge Clusters' : 'Entity Directory'}
            </h3>
            <span className="text-xs text-zinc-500">{filteredNodes.length} items</span>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-2">
            {/* Active Fragments Section */}
            {fragments && fragments.length > 0 && viewMode !== 'clusters' && (
                <div className="mb-4 pb-4 border-b border-white/5">
                    <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-2 flex items-center">
                        <Activity className="w-3 h-3 mr-1" /> Active Fragments
                    </div>
                    {fragments.map(frag => {
                        let colorClass = "bg-cyan-500/5 border-cyan-500/20 text-cyan-200";
                        let badgeClass = "text-cyan-500";
                        
                        if (frag.name.toLowerCase().includes('prometheus')) {
                            colorClass = "bg-lime-500/5 border-lime-500/20 text-lime-200 shadow-[0_0_8px_rgba(132,204,22,0.1)]";
                            badgeClass = "text-lime-500";
                        } else if (frag.load > 50) {
                            colorClass = "bg-blue-500/5 border-blue-500/20 text-blue-200 shadow-[0_0_8px_rgba(59,130,246,0.1)]";
                            badgeClass = "text-blue-500";
                        }

                        return (
                            <div key={frag.id} className={`${colorClass} border p-2 rounded mb-1.5 flex justify-between items-center group hover:bg-white/5 transition-all`}>
                                <span className="text-xs font-mono">{frag.name}</span>
                                <span className={`text-[9px] ${badgeClass} font-bold uppercase tracking-wider`}>{frag.status}</span>
                            </div>
                        );
                    })}
                </div>
            )}

            {viewMode === 'clusters' ? (
              // Cluster View
              clusters.map(cluster => (
                <div
                  key={cluster.type}
                  className="bg-[#09090b]/40 p-4 rounded-lg border border-white/5 hover:border-white/10 transition-all"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-zinc-200 font-semibold text-sm capitalize">{cluster.type}</span>
                    <span className="text-zinc-500 text-xs">{cluster.count} nodes</span>
                  </div>
                  <div className="flex items-center space-x-3 text-xs text-zinc-600">
                    <div className="flex items-center space-x-1">
                      <Link2 className="w-3 h-3" />
                      <span>{cluster.avgConnections} avg</span>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {cluster.nodes.slice(0, 5).map(node => (
                      <button
                        key={node.id}
                        onClick={() => setSelectedNode(node)}
                        className="px-2 py-0.5 bg-white/5 hover:bg-white/10 rounded text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors"
                      >
                        {node.name}
                      </button>
                    ))}
                    {cluster.nodes.length > 5 && (
                      <span className="px-2 py-0.5 text-[10px] text-zinc-600">+{cluster.nodes.length - 5}</span>
                    )}
                  </div>
                </div>
              ))
            ) : (
              // List View
              filteredNodes.length === 0 ? (
                <div className="text-center py-12 text-zinc-600 italic">
                  No knowledge nodes found
                </div>
              ) : (
                filteredNodes.map(node => (
                  <div
                    key={node.id}
                    onClick={() => setSelectedNode(node)}
                    className={`bg-[#09090b]/40 p-3 rounded-lg border transition-all cursor-pointer ${
                      selectedNode?.id === node.id
                        ? 'border-pink-500/50 bg-pink-500/5'
                        : 'border-white/5 hover:border-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <div className={`w-2 h-2 rounded-full ${
                          node.type === 'system' ? 'bg-blue-500' :
                          node.type === 'memory' ? 'bg-purple-500' :
                          node.type === 'skill' ? 'bg-emerald-500' :
                          'bg-cyan-500'
                        } shadow-[0_0_8px_currentColor]`} />
                        <span className="text-zinc-200 font-medium text-xs truncate max-w-[200px]">
                          {node.name}
                        </span>
                      </div>
                      <span className="text-zinc-600 text-[10px] font-mono">
                        {node.connections || 0}L
                      </span>
                    </div>
                    {node.content && (
                      <p className="text-zinc-600 text-[10px] leading-tight line-clamp-2">
                        {node.content}
                      </p>
                    )}
                  </div>
                ))
              )
            )}
          </div>
        </div>
        
        {/* Right Panel - Details/Graph */}
        <div className="col-span-8 bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-6 h-[600px] flex flex-col">
          {viewMode === 'graph' ? (
            // 3D Graph Visualization
            <div className="flex-1">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-zinc-100 font-semibold text-sm uppercase tracking-wider">
                  3D Knowledge Graph
                </h3>
                <span className="text-xs text-zinc-500">Interactive Fractal Visualization</span>
              </div>
              <div className="h-[540px] bg-black/20 rounded-xl overflow-hidden border border-white/5">
                <KnowledgeGraph3D 
                  nodes={filteredNodes.map(node => ({
                    id: node.id,
                    label: node.name,
                    position: node.position || [Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5],
                    color: node.type === 'system' ? '#3b82f6' :
                           node.type === 'memory' ? '#a855f7' :
                           node.type === 'skill' ? '#10b981' : '#06b6d4'
                  }))}
                  edges={graphData.edges.filter(edge => {
                    const sourceId = edge.sourceId || edge.source?.id;
                    const targetId = edge.targetId || edge.target?.id;
                    return filteredNodes.some(n => n.id === sourceId) && 
                           filteredNodes.some(n => n.id === targetId);
                  })}
                  onNodeClick={(nodeId) => {
                    const node = filteredNodes.find(n => n.id === nodeId);
                    if (node) setSelectedNode(node);
                  }}
                />
              </div>
            </div>
          ) : selectedNode ? (
            // Node Details
            <>
              <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/5">
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg ${
                    selectedNode.type === 'system' ? 'bg-blue-500/10' :
                    selectedNode.type === 'memory' ? 'bg-purple-500/10' :
                    selectedNode.type === 'skill' ? 'bg-emerald-500/10' :
                    'bg-cyan-500/10'
                  }`}>
                    <Brain className={`w-5 h-5 ${
                      selectedNode.type === 'system' ? 'text-blue-400' :
                      selectedNode.type === 'memory' ? 'text-purple-400' :
                      selectedNode.type === 'skill' ? 'text-emerald-400' :
                      'text-cyan-400'
                    }`} />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold text-lg">{selectedNode.name}</h3>
                    <p className="text-zinc-500 text-xs capitalize">{selectedNode.type || 'unknown'}</p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <button
                    className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                    title="Edit"
                  >
                    <Edit3 className="w-4 h-4 text-zinc-400" />
                  </button>
                  <button
                    onClick={() => handleDeleteNode(selectedNode.id)}
                    className="p-2 bg-rose-500/10 hover:bg-rose-500/20 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4 text-rose-400" />
                  </button>
                  <button
                    onClick={() => setSelectedNode(null)}
                    className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                    title="Close"
                  >
                    <EyeOff className="w-4 h-4 text-zinc-400" />
                  </button>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-6">
                {/* Content */}
                {selectedNode.content && (
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-400 mb-2">Content</h4>
                    <p className="text-zinc-300 text-sm leading-relaxed bg-[#09090b]/40 p-4 rounded-lg border border-white/5">
                      {selectedNode.content}
                    </p>
                  </div>
                )}
                
                {/* Metadata */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-400 mb-2">Connections</h4>
                    <div className="text-2xl font-bold text-white">{selectedNode.connections || 0}</div>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-400 mb-2">Strength</h4>
                    <div className="text-2xl font-bold text-emerald-400">
                      {Math.round((selectedNode.strength || 0.5) * 100)}%
                    </div>
                  </div>
                  {selectedNode.created && (
                    <div>
                      <h4 className="text-sm font-semibold text-zinc-400 mb-2">Created</h4>
                      <div className="text-sm text-zinc-500">
                        {new Date(selectedNode.created).toLocaleDateString()}
                      </div>
                    </div>
                  )}
                  {selectedNode.accessed && (
                    <div>
                      <h4 className="text-sm font-semibold text-zinc-400 mb-2">Last Accessed</h4>
                      <div className="text-sm text-zinc-500">
                        {new Date(selectedNode.accessed).toLocaleDateString()}
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Tags */}
                {selectedNode.tags && selectedNode.tags.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-400 mb-2">Tags</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedNode.tags.map(tag => (
                        <span
                          key={tag}
                          className="px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-zinc-400"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            // Empty State
            <div className="flex-1 flex items-center justify-center text-center">
              <div>
                <Eye className="w-16 h-16 text-zinc-700 mx-auto mb-4" />
                <p className="text-zinc-500 text-sm mb-2">Select a node to view details</p>
                <p className="text-zinc-600 text-xs">Click on any node in the directory</p>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Recent Activity */}
      {recentActivity.length > 0 && (
        <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-5">
          <h3 className="text-zinc-100 font-semibold mb-4 text-sm uppercase tracking-wider flex items-center">
            <Clock className="w-4 h-4 mr-2 text-amber-400" />
            Recent Activity
          </h3>
          <div className="space-y-2">
            {recentActivity.slice(0, 5).map((activity, idx) => (
              <div key={idx} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <div className="flex items-center space-x-3">
                  <Activity className="w-3 h-3 text-zinc-500" />
                  <span className="text-sm text-zinc-300">{activity.message}</span>
                </div>
                <span className="text-xs text-zinc-600">
                  {new Date(activity.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default EnhancedKnowledgeSystem;

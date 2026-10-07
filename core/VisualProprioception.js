
import fs from 'fs/promises';
import path from 'path';

export class VisualProprioception {
    constructor(knowledgeGraph) {
        this.knowledgeGraph = knowledgeGraph;
    }

    generateHtml(metrics) {
        // Safe data extraction
        const nodes = this.knowledgeGraph.nodes ? Array.from(this.knowledgeGraph.nodes.values()) : [];
        const edges = this.knowledgeGraph.edges ? Array.from(this.knowledgeGraph.edges.values()) : [];
        
        // Prepare graph data for D3/Vis.js (embedded in HTML)
        const graphData = {
            nodes: nodes.map(n => ({ id: n.id, label: n.name, group: n.domain, val: n.confidence })),
            links: edges.map(e => ({ source: e.from, target: e.to, value: e.confidence }))
        };

        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>SOMA Mind Map (Proprioception)</title>
    <script src="https://unpkg.com/force-graph"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { margin: 0; background: #000; color: #fff; overflow: hidden; }
        #graph { width: 100vw; height: 100vh; }
        .overlay { position: absolute; top: 20px; left: 20px; background: rgba(0,0,0,0.7); padding: 20px; border-radius: 8px; border: 1px solid #333; pointer-events: none; }
    </style>
</head>
<body>
    <div id="graph"></div>
    <div class="overlay">
        <h1 class="text-2xl font-bold text-cyan-400 mb-2">SOMA Mind Map</h1>
        <p class="text-sm text-gray-300">Live Knowledge Graph Visualization</p>
        <div class="mt-4 space-y-1 text-xs">
            <div>Nodes: <span class="text-cyan-300">${nodes.length}</span></div>
            <div>Edges: <span class="text-purple-300">${edges.length}</span></div>
            <div>Density: <span class="text-green-300">${(metrics?.density * 100).toFixed(2)}%</span></div>
        </div>
    </div>

    <script>
        const data = ${JSON.stringify(graphData)};
        
        const Graph = ForceGraph()
            (document.getElementById('graph'))
            .graphData(data)
            .nodeId('id')
            .nodeLabel('label')
            .nodeAutoColorBy('group')
            .linkWidth(link => link.value * 2)
            .nodeVal(node => node.val * 5)
            .backgroundColor('#050505');
            
        // Physics settings
        Graph.d3Force('charge').strength(-100);
    </script>
</body>
</html>`;
        return html;
    }

    async saveMap() {
        const html = this.generateHtml(this.knowledgeGraph.metrics);
        await fs.writeFile('MIND_MAP.html', html);
        return 'MIND_MAP.html';
    }
}

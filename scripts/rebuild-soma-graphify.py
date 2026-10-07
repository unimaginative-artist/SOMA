"""Clean, first-party Graphify rebuild with CommonJS support.

Graphify 2.x does not classify .cjs as JavaScript. SOMA's authoritative goal
and autonomy runtime uses .cjs heavily, so the stock updater silently omitted
the architecture that mattered most. This wrapper keeps the fix local and
repeatable without modifying the installed package.
"""

from pathlib import Path
import json

import graphify.detect as detect_module
import graphify.extract as extract_module
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.export import to_json
from graphify.report import generate
from graphify.watch import _relativize_source_files


def rebuild(root: Path) -> None:
    root = root.resolve()
    detect_module.CODE_EXTENSIONS.add('.cjs')
    extract_module._DISPATCH['.cjs'] = extract_module.extract_js
    detected = detect_module.detect(root)
    code_files = [Path(value) for value in detected['files']['code']]
    # Sequential extraction is intentional: worker subprocesses would import
    # Graphify without the local .cjs dispatch extension.
    result = extract_module.extract(code_files, cache_root=root, parallel=False)
    _relativize_source_files(result, root)
    graph = build_from_json(result)
    communities = cluster(graph)
    cohesion = score_all(graph, communities)
    gods = god_nodes(graph)
    surprises = surprising_connections(graph, communities)
    labels = {community_id: f'Community {community_id}' for community_id in communities}
    questions = suggest_questions(graph, communities, labels)
    output = root / 'graphify-out'
    output.mkdir(exist_ok=True)
    to_json(graph, communities, str(output / 'graph.json'), force=True)
    report = generate(
        graph, communities, cohesion, labels, gods, surprises, detected,
        {'input': 0, 'output': 0}, str(root), suggested_questions=questions
    )
    (output / 'GRAPH_REPORT.md').write_text(report, encoding='utf-8')
    (output / '.graphify_root').write_text(str(root), encoding='utf-8')
    detect_module.save_manifest(detected['files'])
    print(json.dumps({
        'success': True,
        'codeFiles': len(code_files),
        'commonJsFiles': sum(path.suffix == '.cjs' for path in code_files),
        'nodes': graph.number_of_nodes(),
        'edges': graph.number_of_edges(),
        'communities': len(communities)
    }))


if __name__ == '__main__':
    rebuild(Path(__file__).resolve().parents[1])

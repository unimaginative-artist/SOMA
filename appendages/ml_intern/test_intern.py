import json
import asyncio
from ml_researcher import MlResearcher

async def test():
    researcher = MlResearcher()
    print("[TEST] Searching arXiv for 'oncology'...")
    result = await researcher.execute("search_papers", {"query": "oncology", "limit": 2})
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    asyncio.run(test())

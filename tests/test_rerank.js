
import MnemonicArbiter from '../arbiters/MnemonicArbiter.js';
import path from 'path';

async function testRerank() {
  console.log('--- Testing MnemonicArbiter with Reranking ---');

  const arbiter = new MnemonicArbiter({
    name: 'MnemonicTest',
    dbPath: path.join(process.cwd(), '.soma', 'test_memory.db'),
    vectorDbPath: path.join(process.cwd(), '.soma', 'test_vectors.json'),
    enableAutoCleanup: false,
    enablePersistence: false, // Don't save to disk to keep it clean
    skipEmbedder: false // We NEED the embedder/reranker
  });

  try {
    await arbiter.initialize();
    
    // Check if reranker loaded
    if (arbiter.reranker) {
      console.log('✅ Reranker loaded successfully');
    } else {
      console.error('❌ Reranker failed to load');
      process.exit(1);
    }

    // Add memories
    console.log('\nStoring memories...');
    await arbiter.remember('The apple is a sweet red fruit.', { category: 'food' });
    await arbiter.remember('Bananas are yellow and long.', { category: 'food' });
    await arbiter.remember('The spaceship flew to Mars.', { category: 'tech' });
    await arbiter.remember('Oranges are high in vitamin C.', { category: 'food' });
    await arbiter.remember('Python is a programming language.', { category: 'tech' });

    // Recall
    const query = 'healthy snack';
    console.log(`\nRecalling: "${query}"...`);
    
    const result = await arbiter.recall(query, 3);
    
    console.log('\nResults:');
    result.results.forEach((r, i) => {
      console.log(`${i+1}. [${r.score ? r.score.toFixed(4) : 'N/A'}] ${r.content}`);
    });

    // Check if we see scores
    const hasScores = result.results.some(r => r.score !== undefined);
    if (hasScores) {
      console.log('\n✅ Reranking scores detected!');
    } else {
      console.log('\n⚠️ No reranking scores found (fallback used?)');
    }

  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await arbiter.shutdown();
  }
}

testRerank();

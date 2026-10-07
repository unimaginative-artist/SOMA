async function testSwanson() {
  const entityA = 'KRAS G12D resistance';
  const entityB = 'Ferroptosis SLC7A11';
  
  const urlA = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=' + encodeURIComponent(entityA) + '&format=json&resultType=core&pageSize=5';
  const urlB = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=' + encodeURIComponent(entityB) + '&format=json&resultType=core&pageSize=5';
  const urlCooccur = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=' + encodeURIComponent('"KRAS G12D" AND "SLC7A11"') + '&format=json&pageSize=1';

  const [resA, resB, resCo] = await Promise.all([
    fetch(urlA).then(r => r.json()),
    fetch(urlB).then(r => r.json()),
    fetch(urlCooccur).then(r => r.json())
  ]);

  console.log('Papers for A (' + entityA + '):', resA.hitCount);
  console.log('Papers for B (' + entityB + '):', resB.hitCount);
  console.log('Co-occurrence count (A AND B):', resCo.hitCount);
}

testSwanson().catch(console.error);

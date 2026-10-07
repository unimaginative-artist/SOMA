import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const BASE_URL = process.env.SOMA_CT_URL || 'http://127.0.0.1:3001';

test('Command Bridge → SOMA CT streams a reply and restores server history after reload', async (t) => {
  try {
    const health = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(15_000) });
    if (!health.ok) return t.skip(`SOMA backend returned ${health.status}`);
  } catch {
    return t.skip('SOMA backend is not running');
  }

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  let serverHistory = [];
  let receivedRequest = null;
  const canaryMessage = `ct-browser-canary-${Date.now()}`;
  const canaryReply = `Verified streamed reply for ${canaryMessage}`;

  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => localStorage.setItem('soma_onboarded', 'true'));
    await page.setRequestInterception(true);
    page.on('request', async request => {
      const url = new URL(request.url());
      if (url.pathname === '/api/soma/history') {
        return request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, messages: serverHistory })
        });
      }
      if (url.pathname === '/api/goals') {
        return request.respond({ status: 200, contentType: 'application/json', body: '[]' });
      }
      if (url.pathname === '/api/soma/chat' && request.method() === 'POST') {
        receivedRequest = JSON.parse(request.postData());
        serverHistory = [
          { role: 'user', content: canaryMessage, timestamp: Date.now() },
          { role: 'assistant', content: canaryReply, timestamp: Date.now() + 1 }
        ];
        const midpoint = Math.floor(canaryReply.length / 2);
        const sse = [
          `data: ${JSON.stringify({ token: canaryReply.slice(0, midpoint) })}\n\n`,
          `data: ${JSON.stringify({ token: canaryReply.slice(midpoint) })}\n\n`,
          `data: ${JSON.stringify({ done: true, response: canaryReply, metadata: { canary: true } })}\n\n`
        ].join('');
        return request.respond({ status: 200, contentType: 'text/event-stream', body: sse });
      }
      return request.continue();
    });

    const openCt = async () => {
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('SOMA CT')));
      await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.includes('SOMA CT')).click());
      await page.waitForSelector('textarea[placeholder="Initialize SOMA..."], textarea[placeholder="Ready..."], input[placeholder="Initialize SOMA..."], input[placeholder="Ready..."]');
    };

    await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
    await openCt();
    const input = await page.$('textarea[placeholder="Initialize SOMA..."], textarea[placeholder="Ready..."], input[placeholder="Initialize SOMA..."], input[placeholder="Ready..."]');
    assert.ok(input, 'CT command input is visible');
    await input.type(canaryMessage);
    await input.press('Enter');
    await page.waitForFunction(expected => document.body.textContent.includes(expected), { timeout: 15_000 }, canaryReply);

    assert.equal(receivedRequest.message, canaryMessage);
    assert.match(receivedRequest.sessionId, /^ct:/);
    assert.equal(Object.hasOwn(receivedRequest, 'history'), false);

    await page.reload({ waitUntil: 'networkidle2' });
    await openCt();
    await page.waitForFunction(expected => document.body.textContent.includes(expected), { timeout: 10_000 }, canaryReply);
    assert.ok(await page.evaluate(expected => document.body.textContent.includes(expected), canaryReply));
  } finally {
    await browser.close();
  }
});

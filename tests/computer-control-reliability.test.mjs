import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateDesktopAction, literalSendKeys, normalizeKey, desktopActionScript, powershellInvocation } from '../core/WindowsDesktopDriver.js';

// All imports/outputs run in a disposable workspace; no native input/browser is used.
const originalCwd = process.cwd();
const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-control-tests-'));
process.chdir(sandbox);
const { ComputerControlArbiter } = await import('../arbiters/ComputerControlArbiter.js');
test.after(async () => { process.chdir(originalCwd); await fs.rm(sandbox, { recursive: true, force: true }); });
const frame = (extra = {}) => ({ frameId: crypto.randomUUID(), observedAt: Date.now(), foreground: '42', inputTick: 456,
    dimensions: { width: 800, height: 600 }, display: { left: -1600, top: 100, width: 1600, height: 1200 }, ...extra });
const action = (f, extra = {}) => ({ type: 'click', frameId: f.frameId, x: 200, y: 100, ...extra });

test('screen pixel coordinates map to the actual display origin and scale', () => {
    const f = frame();
    assert.deepEqual(validateDesktopAction(action(f), f), { type: 'click', x: -1200, y: 300 });
});
test('invalid coordinates, missing frames and stale frames never default to 0,0', () => {
    const f = frame();
    for (const x of [undefined, '2', NaN, Infinity, -1, 800, 1.5]) assert.throws(() => validateDesktopAction(action(f, { x }), f));
    assert.throws(() => validateDesktopAction(action(f), null));
    assert.throws(() => validateDesktopAction(action(f, { frameId: 'wrong' }), f));
    assert.throws(() => validateDesktopAction(action(f), { ...f, observedAt: Date.now() - 31000 }));
});
test('only advertised actions and bounded nonempty text are accepted', () => {
    const f = frame();
    for (const type of ['mouse_move', 'click', 'double_click', 'right_click']) assert.equal(validateDesktopAction(action(f, { type }), f).type, type);
    for (const text of ['', null, 'x'.repeat(2001), '\0']) assert.throws(() => validateDesktopAction({ type: 'type', text, frameId: f.frameId }, f));
    assert.throws(() => validateDesktopAction({ type: 'unknown', frameId: f.frameId }, f));
});
test('literal typing shields SendKeys metacharacters and preserves Unicode', () => {
    assert.equal(literalSendKeys('a+b^c%~(){}[]'), 'a{+}b{^}c{%}{~}{(}{)}{{}{}}{[}{]}');
    assert.equal(literalSendKeys('hello\r\nworld\t漢字🙂'), 'hello{ENTER}world{TAB}漢字🙂');
});
test('key chords are a whitelist, not arbitrary SendKeys syntax', () => {
    assert.equal(normalizeKey('ctrl+c'), '^c');
    assert.equal(normalizeKey('ctrl+shift+left'), '^+{LEFT}');
    assert.equal(normalizeKey('Enter'), '{ENTER}');
    for (const key of ['{ENTER}', 'ctrl+ctrl+c', 'ctrl+evil', '$()', 'win+r']) assert.throws(() => normalizeKey(key));
});
test('PowerShell gets encoded arguments, never a shell-interpolated user string', () => {
    const f = frame();
    const text = '$(Remove-Item "anything") ` powershell & | {ENTER} + 漢字';
    const normalized = validateDesktopAction({ type: 'type', frameId: f.frameId, text }, f);
    const script = desktopActionScript(normalized, f);
    assert.equal(script.includes('Remove-Item'), false);
    assert.ok(script.includes('FromBase64String'));
    assert.ok(script.includes('InputTick() -ne 456'));
    assert.ok(script.includes('Foreground window changed'));
    const invocation = powershellInvocation(script);
    assert.equal(invocation.file, 'powershell.exe');
    assert.ok(invocation.args.includes('-EncodedCommand'));
    const decoded = Buffer.from(invocation.args.at(-1), 'base64').toString('utf16le');
    assert.ok(decoded.includes(script));
    assert.equal(invocation.args.some(arg => arg.includes('Remove-Item')), false);
});
test('right and double click scripts actually issue their advertised button events', () => {
    const f = frame();
    assert.ok(desktopActionScript(validateDesktopAction(action(f, { type: 'right_click' }), f), f).includes('mouse_event(8,'));
    assert.equal(desktopActionScript(validateDesktopAction(action(f, { type: 'double_click' }), f), f).match(/mouse_event\(2,/g).length, 2);
});

test('generated Windows scripts parse without executing any native input', { skip: process.platform !== 'win32' }, async () => {
    const f = frame();
    const scripts = ['click', 'double_click', 'right_click', 'mouse_move'].map(type => desktopActionScript(validateDesktopAction(action(f, { type }), f), f));
    scripts.push(desktopActionScript(validateDesktopAction({ type: 'type', frameId: f.frameId, text: 'literal $() ` & 漢字' }, f), f));
    for (const script of scripts) {
        const encoded = Buffer.from(script, 'utf8').toString('base64');
        const parserOnly = `$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); $tokens = $null; $parseErrors = $null; [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors) | Out-Null; if ($parseErrors.Count) { throw ($parseErrors | Out-String) }; Write-Output 'parsed'`;
        const invocation = powershellInvocation(parserOnly);
        const result = await promisify(execFile)(invocation.file, invocation.args, { windowsHide: true, timeout: 10000 });
        assert.equal(result.stdout.trim(), 'parsed');
    }
});

function arbiter(options = {}) {
    const calls = [];
    const desktopDriver = {
        async execute(...args) { calls.push(args); },
        async capture() { return { buffer: Buffer.from('test-frame'), foreground: '42', inputTick: 456,
            dimensions: { width: 800, height: 600 }, display: { left: 0, top: 0, width: 800, height: 600 } }; }
    };
    const cc = new ComputerControlArbiter({ desktopDriver, ...options });
    const f = frame();
    cc._frames.set(f.frameId, f);
    return { cc, f, calls };
}
test('sending native input produces a new observation, not a verified task claim', async () => {
    const { cc, f, calls } = arbiter();
    const result = await cc.executeAction(action(f));
    assert.equal(calls.length, 1);
    assert.equal(result.success, true);
    assert.equal(result.status, 'submitted');
    assert.equal(result.verified, false);
    assert.equal(result.observation.surface, 'native-desktop');
    assert.ok(result.observation.contentDigest);
    assert.notEqual(result.observation.frameId, f.frameId);
    assert.equal((await cc.executeAction(action(f))).success, false);
});
test('dry run validates actions but never actuates or captures', async () => {
    const { cc, f, calls } = arbiter({ dryRun: true });
    assert.equal((await cc.executeAction(action(f, { type: 'made-up' }))).success, false);
    assert.equal((await cc.executeAction(action(f))).status, 'dry_run');
    assert.equal((await cc.captureScreen()).dryRun, true);
    assert.equal(calls.length, 0);
});
test('native single-flight gate and stop prevent false late success', async () => {
    let settle;
    const { cc, f } = arbiter({ desktopDriver: { execute: () => new Promise(r => { settle = r; }) } });
    const running = cc.executeAction(action(f));
    assert.equal((await cc.executeAction(action(f))).status, 'busy');
    await cc.executeAction({ type: 'stop' });
    settle();
    assert.equal((await running).status, 'cancelled');
    assert.equal((await cc.executeAction(action(f))).status, 'blocked');
    await cc.executeAction({ type: 'resume' });
    assert.equal((await cc.executeAction(action(f))).success, false);
});
test('native driver failures consume the frame and remain failures', async () => {
    const { cc, f } = arbiter({ desktopDriver: { async execute() { throw new Error('Human input since observation'); } } });
    assert.equal((await cc.executeAction(action(f))).success, false);
    assert.equal(cc._frames.size, 0);
});

test('world-model observation reuses explicit frames without starting a screen recorder', async () => {
    let captures = 0;
    const { cc } = arbiter({ desktopDriver: { capture: async () => { captures++; throw new Error('must not capture'); } } });
    cc._frames.clear();
    assert.equal((await cc.observe()).available, false);
    cc._frames.set('old', frame({ observedAt: Date.now() - 60000 }));
    assert.equal((await cc.observe()).available, false);
    assert.equal(captures, 0);
});

function fakeBrowser() {
    const counters = { launches: 0, connects: 0, disconnects: 0, closes: 0, clicks: 0, types: 0, gotos: 0 };
    let currentUrl = 'about:blank';
    const element = { boundingBox: async () => ({ width: 10, height: 10 }), evaluate: async () => false,
        click: async () => { counters.clicks++; }, type: async () => { counters.types++; }, dispose: async () => {} };
    const page = {
        url: () => currentUrl, isClosed: () => false,
        evaluate: async () => ({ url: currentUrl, title: 'Test', text: 'A real fake button', elements: [] }),
        $$: async () => [element],
        goto: async url => { counters.gotos++; currentUrl = url; },
        waitForSelector: async () => element,
        content: async () => '<button>Test</button>'
    };
    const browser = { pages: async () => [page], close: async () => { counters.closes++; }, disconnect: async () => { counters.disconnects++; } };
    const driver = { launch: async () => { counters.launches++; return browser; }, connect: async () => { counters.connects++; return browser; } };
    return { counters, driver, page };
}
test('browser dry run never connects or launches, unknown actions fail', async () => {
    const f = fakeBrowser(), { cc } = arbiter({ dryRun: true, browserDriver: f.driver });
    assert.equal((await cc.handleBrowserAction({ action: 'launch' })).status, 'dry_run');
    assert.equal((await cc.handleBrowserAction({ action: 'unknown' })).success, false);
    assert.equal(f.counters.launches + f.counters.connects, 0);
});
test('Aperture attachment requires explicit tab selection and only disconnects on close', async () => {
    const f = fakeBrowser(), { cc } = arbiter({ browserDriver: f.driver });
    const launched = await cc.handleBrowserAction({ action: 'launch', mode: 'aperture' });
    assert.equal(launched.requiresSelection, true);
    assert.equal(launched.selectedTabId, null);
    assert.equal((await cc.handleBrowserAction({ action: 'observe' })).success, false);
    const selected = await cc.handleBrowserAction({ action: 'select_tab', tabId: launched.tabs[0].id });
    assert.equal(selected.observation.surface, 'attached-browser');
    await cc.handleBrowserAction({ action: 'close' });
    assert.equal(f.counters.closes, 0);
    assert.equal(f.counters.disconnects, 1);
});
test('failed Aperture connection never silently opens a different browser', async () => {
    const f = fakeBrowser();
    f.driver.connect = async () => { throw new Error('CDP unavailable'); };
    const { cc } = arbiter({ browserDriver: f.driver });
    assert.equal((await cc.handleBrowserAction({ action: 'launch', mode: 'aperture' })).success, false);
    assert.equal(f.counters.launches, 0);
});
test('browser mutations require a fresh observation and return unverified post-state', async () => {
    const f = fakeBrowser(), { cc } = arbiter({ browserDriver: f.driver });
    const launched = await cc.handleBrowserAction({ action: 'launch' });
    assert.equal((await cc.handleBrowserAction({ action: 'click', selector: '#button' })).success, false);
    assert.equal(f.counters.clicks, 0);
    const result = await cc.handleBrowserAction({ action: 'click', selector: '#button', observationId: launched.observation.observationId });
    assert.equal(result.status, 'submitted');
    assert.equal(result.verified, false);
    assert.equal(f.counters.clicks, 1);
    assert.equal((await cc.handleBrowserAction({ action: 'click', selector: '#button', observationId: launched.observation.observationId })).success, false);
});
test('ambiguous browser selectors do not click anything', async () => {
    const f = fakeBrowser(), { cc } = arbiter({ browserDriver: f.driver });
    const launched = await cc.handleBrowserAction({ action: 'launch' });
    f.page.$$ = async () => [{ dispose: async () => {} }, { dispose: async () => {} }];
    assert.equal((await cc.handleBrowserAction({ action: 'click', selector: 'button', observationId: launched.observation.observationId })).success, false);
    assert.equal(f.counters.clicks, 0);
});
test('unsafe browser URLs cannot be enabled by model-supplied allowUnsafe', async () => {
    const { cc } = arbiter();
    for (const url of ['file:///x', 'http://localhost', 'http://127.1', 'http://169.254.169.254', 'http://10.0.0.1', 'http://[::1]', 'https://user:password@example.com']) {
        assert.equal((await cc.handleBrowserAction({ action: 'navigate', url, allowUnsafe: true })).success, false, url);
    }
});

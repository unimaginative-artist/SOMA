/**
 * ComputerControlArbiter.js
 * 
 * Provides "Computer Use" capabilities to SOMA:
 * - Vision: Captures screenshots (Eyes) via screenshot-desktop
 * - Action: Controls Mouse/Keyboard via PowerShell (Hands) - Fallback for Windows
 * - Browser: Controls web browser via Puppeteer (Navigator)
 * 
 * SAFETY: Implements a "Safety Stop" - if the mouse is moved by the user during execution,
 * the arbiter will abort the current action to prevent fighting for control.
 */

import { createRequire } from 'module';
import { randomUUID, createHash } from 'node:crypto';
import WindowsDesktopDriver, { validateDesktopAction } from '../core/WindowsDesktopDriver.js';
const require = createRequire(import.meta.url);

// Internal imports
const BaseArbiterModule = require('../core/BaseArbiter.cjs');
const BaseArbiter = BaseArbiterModule.BaseArbiter || BaseArbiterModule.default?.BaseArbiter || BaseArbiterModule;

const MessageBrokerModule = require('../core/MessageBroker.cjs');
const messageBroker = MessageBrokerModule.default || MessageBrokerModule;

// Dependencies
const puppeteer = require('puppeteer');
const screenshot = require('screenshot-desktop'); // Verified working
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

export class ComputerControlArbiter extends BaseArbiter {
  static role = 'implementer';
  static capabilities = ['screen-capture', 'mouse-control', 'keyboard-control', 'browser-automation'];

  constructor(config = {}) {
    super(config);
    this.name = config.name || 'ComputerControlArbiter';

    // Safety Configuration
    this.safetyEnabled = config.safetyEnabled !== false;
    this.safetyThreshold = config.safetyThreshold || 30; // Closer threshold for precise co-presence

    // Automation State
    this.browser = null;
    this.page = null;
    this.dryRun = config.dryRun || false;
    this.desktopDriver = config.desktopDriver || new WindowsDesktopDriver();
    this.browserDriver = config.browserDriver || puppeteer;
    this.browserOwned = false;
    this._frames = new Map();
    this._actionActive = null;
    this._browserActive = false;
    this.stopped = false;
    this._controlEpoch = 0;

    this.screenSize = { width: 1920, height: 1080 };

    // Real-Time Co-Presence State
    this.lastSomaMousePosition = null;
    this.currentPhysicalMousePosition = null;
    this.mouseListenerProcess = null;
    this.lastActionTime = 0;
  }

  async initialize() {
    await super.initialize();

    try {
      // Register with MessageBroker
      this.registerWithBroker();
      this._subscribeBrokerMessages();

      console.log(`[${this.name}] Computer adapter registered; native readiness is established by screen_capture.`);
      // Per-frame GetLastInputInfo checks replace a free-running cursor listener.

    } catch (err) {
      console.error(`[${this.name}] Failed to initialize: ${err.message}`);
    }
  }

  startMouseListener() {
    if (this.dryRun) return;
    try {
      const psCommand = 'Add-Type -AssemblyName System.Windows.Forms; $lastX = 0; $lastY = 0; while ($true) { $pos = [System.Windows.Forms.Cursor]::Position; if ($pos.X -ne $lastX -or $pos.Y -ne $lastY) { $lastX = $pos.X; $lastY = $pos.Y; Write-Output "$lastX,$lastY" }; Start-Sleep -Milliseconds 50 }';
      
      const { spawn } = require('child_process');
      this.mouseListenerProcess = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand], {
        stdio: 'pipe',
        windowsHide: true
      });

      this.mouseListenerProcess.stdout.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        const lastLine = lines[lines.length - 1]?.trim();
        if (!lastLine) return;
        
        const parts = lastLine.split(',');
        if (parts.length === 2) {
          const x = parseInt(parts[0]);
          const y = parseInt(parts[1]);
          if (!isNaN(x) && !isNaN(y)) {
            this.currentPhysicalMousePosition = { x, y };
            if (!this.lastSomaMousePosition) {
              this.lastSomaMousePosition = { x, y };
            }
          }
        }
      });

      this.mouseListenerProcess.on('error', (e) => {
        console.error(`[${this.name}] Mouse listener process error:`, e.message);
      });

      console.log(`[${this.name}] 🖱️  Persistent mouse listener thread started.`);
    } catch (err) {
      console.error(`[${this.name}] Failed to start mouse listener: ${err.message}`);
    }
  }

  registerWithBroker() {
    messageBroker.registerArbiter(this.name, this, {
      type: ComputerControlArbiter.role,
      capabilities: ComputerControlArbiter.capabilities
    });
  }

  _subscribeBrokerMessages() {
    messageBroker.subscribe(this.name, 'computer_action');
    messageBroker.subscribe(this.name, 'capture_screen');
    messageBroker.subscribe(this.name, 'capture_webcam');
    messageBroker.subscribe(this.name, 'browser_action');
  }

  async handleMessage(message = {}) {
    try {
      const { type, payload } = message;

      switch (type) {
        case 'computer_action':
          return await this.executeAction(payload);
        case 'capture_screen':
          return await this.captureScreen(payload);
        case 'capture_webcam':
          return await this.captureWebcam(payload);
        case 'browser_action':
          return await this.handleBrowserAction(payload);
        default:
          return { success: false, error: 'Unknown message type' };
      }
    } catch (err) {
      console.error(`[${this.name}] Error handling message: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ========================================================
  // Vision (Eyes)
  // ========================================================

  async captureScreen(options = {}) {
    if (this.dryRun) return { success: false, dryRun: true, verified: false, error: 'Dry run: no screen captured' };
    try {
      const { buffer, ...state } = await this.desktopDriver.capture();

      const filename = `screen_${Date.now()}_${randomUUID()}.png`;
      const visionDir = path.join(process.cwd(), '.soma', 'vision_temp');
      const savePath = path.join(visionDir, filename);

      fs.mkdirSync(visionDir, { recursive: true });
      fs.writeFileSync(savePath, buffer);

      // Rolling cleanup — keep only the 5 most recent frames.
      // Vision only ever needs the current frame; old ones are dead weight.
      try {
        const files = fs.readdirSync(visionDir)
          .filter(f => f.startsWith('screen_') && f.endsWith('.png'))
          .map(f => ({ name: f, mtime: fs.statSync(path.join(visionDir, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime); // newest first
        for (const old of files.slice(5)) {
          try { fs.unlinkSync(path.join(visionDir, old.name)); } catch { /* already gone */ }
        }
      } catch { /* cleanup failure is never fatal */ }

      const observation = {
        success: true,
        imagePath: savePath,
        timestamp: Date.now(), observedAt: Date.now(), surface: 'native-desktop',
        frameId: randomUUID(), contentDigest: createHash('sha256').update(buffer).digest('hex'),
        ...state
      };
      this.screenSize = observation.dimensions;
      this._frames.set(observation.frameId, observation);
      if (this._frames.size > 5) this._frames.delete(this._frames.keys().next().value);
      return observation;
    } catch (err) {
      console.error(`[${this.name}] Screen capture failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async captureWebcam(options = {}) {
    try {
      const pythonPath = path.join(process.cwd(), '.soma_venv', 'Scripts', 'python.exe');
      const detectorScript = path.join(process.cwd(), 'appendages', 'provenance', 'opencv5_detector.py');

      if (options.inputPath) {
        const savePath = options.outputPath || options.inputPath;
        let detectionResults = null;
        await new Promise((resolve) => {
          const cmd = `"${pythonPath}" "${detectorScript}" --input "${options.inputPath}" --output "${savePath}"`;
          exec(cmd, (err, stdout, stderr) => {
            if (err) {
              console.warn('[ComputerControlArbiter] ⚠️ OpenCV 5 active detection on input file failed:', stderr || err.message);
              resolve();
            } else {
              const prefix = '__OPENCV_DETECTION__:';
              const line = (stdout || '').split('\n').find(l => l.trim().startsWith(prefix));
              if (line) {
                try {
                  detectionResults = JSON.parse(line.trim().substring(prefix.length).trim());
                } catch (parseErr) {
                  console.warn('[ComputerControlArbiter] Failed to parse OpenCV detection JSON:', parseErr.message);
                }
              }
              resolve();
            }
          });
        });

        return {
          success: true,
          imagePath: savePath,
          timestamp: Date.now(),
          opencv: detectionResults
        };
      }

      const FFMPEG_PATH = path.join(process.cwd(), 'ffmpeg', 'ffmpeg-master-latest-win64-gpl', 'bin', 'ffmpeg.exe');

      const device = await new Promise((resolve) => {
        exec(`"${FFMPEG_PATH}" -list_devices true -f dshow -i dummy`, (err, stdout, stderr) => {
          const output = stderr || stdout || '';
          const lines = output.split('\n');
          const devices = [];
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const match = line.match(/\[(?:dshow|in#\d+)\s+@\s+\w+\]\s+"([^"]+)"\s+\(video\)/i);
            if (match) {
              devices.push(match[1]);
            }
          }
          resolve(devices[0] || null);
        });
      });

      if (!device) {
        throw new Error('No webcam device found via FFmpeg directshow');
      }

      const filename = `webcam_${Date.now()}.jpg`;
      const visionDir = path.join(process.cwd(), '.soma', 'vision_temp');
      const savePath = path.join(visionDir, filename);

      fs.mkdirSync(visionDir, { recursive: true });

        let detectionResults = null;
        await new Promise((resolve, reject) => {
          const pythonPath = path.join(process.cwd(), '.soma_venv', 'Scripts', 'python.exe');
          const detectorScript = path.join(process.cwd(), 'appendages', 'provenance', 'opencv5_detector.py');
          const cmd = `"${pythonPath}" "${detectorScript}" --device 0 --output "${savePath}"`;
          
          exec(cmd, (err, stdout, stderr) => {
            if (err) {
              console.warn('[ComputerControlArbiter] ⚠️ OpenCV 5 capture failed, trying FFmpeg fallback...', stderr || err.message);
              // Fallback to original FFmpeg capture
              const ffmpegCmd = `"${FFMPEG_PATH}" -y -f dshow -i video="${device}" -frames:v 1 -update 1 "${savePath}"`;
              exec(ffmpegCmd, (ffErr) => {
                if (ffErr) return reject(new Error(`FFmpeg fallback also failed: ${ffErr.message}`));
                resolve();
              });
            } else {
              console.log('[ComputerControlArbiter] ✅ OpenCV 5 active detector captured frame successfully.');
              const prefix = '__OPENCV_DETECTION__:';
              const line = (stdout || '').split('\n').find(l => l.trim().startsWith(prefix));
              if (line) {
                try {
                  detectionResults = JSON.parse(line.trim().substring(prefix.length).trim());
                } catch (parseErr) {
                  console.warn('[ComputerControlArbiter] Failed to parse OpenCV detection JSON:', parseErr.message);
                }
              }
              resolve();
            }
          });
        });

      try {
        const files = fs.readdirSync(visionDir)
          .filter(f => f.startsWith('webcam_') && f.endsWith('.jpg'))
          .map(f => ({ name: f, mtime: fs.statSync(path.join(visionDir, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);
        for (const old of files.slice(5)) {
          try { fs.unlinkSync(path.join(visionDir, old.name)); } catch {}
        }
      } catch {}

      return {
        success: true,
        imagePath: savePath,
        timestamp: Date.now(),
        device,
        opencv: detectionResults
      };
    } catch (err) {
      console.error(`[${this.name}] Webcam capture failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ========================================================
  // Action (Hands) - PowerShell Implementation
  // ========================================================

  async observe() {
    // World-model polling must not silently turn into continuous screen recording.
    const frame = [...this._frames.values()].at(-1);
    if (!frame || Date.now() - frame.observedAt > 30000) return { available: false, success: false, error: 'No recent explicit screen capture' };
    return frame;
  }

  async executeAction(action) {
    if (action?.type === 'stop') {
      this._controlEpoch++;
      this.stopped = true;
      this._actionActive?.abort();
      this._frames.clear();
      return { success: true, status: 'stopped', verified: true, evidence: { stopped: true } };
    }
    if (action?.type === 'resume') {
      this._controlEpoch++;
      this.stopped = false;
      this._frames.clear();
      return { success: true, status: 'ready', verified: false, message: 'Capture a fresh screen before acting.' };
    }
    if (this.stopped) return { success: false, status: 'blocked', verified: false, error: 'Computer control is stopped. Resume explicitly, then observe.' };
    if (this._actionActive) return { success: false, status: 'busy', verified: false, error: 'Another native action is in flight' };
    let controller;
    try {
      const frame = this._frames.get(action?.frameId);
      const normalized = validateDesktopAction(action, frame);
      if (this.dryRun) return { success: true, status: 'dry_run', dryRun: true, verified: false };
      controller = new AbortController();
      this._actionActive = controller;
      this._frames.clear(); // A frame is consumed once, including failures with uncertain side effects.
      await this.desktopDriver.execute(normalized, frame, { signal: controller.signal, safetyEnabled: this.safetyEnabled });
      if (controller.signal.aborted || this.stopped) return { success: false, status: 'cancelled', verified: false, error: 'Stopped; input may already have been submitted' };
      const observation = await this.captureScreen();
      if (controller.signal.aborted || this.stopped) return { success: false, status: 'cancelled', verified: false, error: 'Stopped during post-action observation; input may already have been submitted' };
      return { success: true, status: 'submitted', verified: false, observation,
        message: 'Input was sent. Inspect the new observation to verify the intended outcome; a changed screen alone is not success.' };
    } catch (error) {
      return { success: false, status: controller?.signal.aborted ? 'cancelled' : 'failed', verified: false, error: error.message };
    } finally {
      if (this._actionActive === controller) this._actionActive = null;
    }
  }

  // ========================================================
  // Browser (Navigator)
  // ========================================================

  async _browserObservation() {
    if (!this.page || this.page.isClosed()) throw new Error('No selected browser tab');
    const value = await this.page.evaluate(() => ({
      url: location.href, title: document.title, text: (document.body?.innerText || '').slice(0, 5000),
      elements: Array.from(document.querySelectorAll('button, a, input, textarea, select')).slice(0, 60).map(el => ({
        tag: el.tagName.toLowerCase(), id: el.id || null, name: el.getAttribute('name'), role: el.getAttribute('role'),
        text: (el.innerText || el.getAttribute('aria-label') || '').slice(0, 120), disabled: !!el.disabled
      }))
    }));
    const observation = { ...value, surface: this.browserOwned ? 'isolated-browser' : 'attached-browser',
      observedAt: Date.now(), observationId: randomUUID(), tabId: this._selectedTabId,
      contentDigest: createHash('sha256').update(JSON.stringify(value)).digest('hex') };
    this._browserFrame = observation;
    return observation;
  }

  async handleBrowserAction(payload = {}) {
    const { action, url, selector, text, observationId } = payload;
    const allowed = ['launch', 'list_tabs', 'select_tab', 'observe', 'navigate', 'goto', 'click', 'type', 'screenshot', 'extract_text', 'extract_html', 'wait_for', 'close'];
    if (!allowed.includes(action)) return { success: false, verified: false, error: 'Unknown browser action' };
    if (this.stopped) return { success: false, status: 'blocked', verified: false, error: 'Computer control is stopped' };
    if (this._browserActive) return { success: false, status: 'busy', verified: false, error: 'Browser action already in flight' };
    if (['navigate', 'goto'].includes(action) && (!url || !this._isSafeUrl(url))) return { success: false, verified: false, error: 'Missing or unsafe URL' };
    if (['click', 'type', 'wait_for'].includes(action) && (typeof selector !== 'string' || !selector.trim() || selector.length > 1000)) return { success: false, verified: false, error: 'A bounded selector is required' };
    if (action === 'type' && (typeof text !== 'string' || text.length > 2000)) return { success: false, verified: false, error: 'text must be a string of at most 2000 characters' };
    const mode = payload.mode || 'isolated';
    if (action === 'launch' && !['isolated', 'aperture'].includes(mode)) return { success: false, verified: false, error: 'Browser mode must be isolated or aperture' };
    if (this.dryRun) return { success: true, status: 'dry_run', dryRun: true, verified: false };
    this._browserActive = true;
    const epoch = this._controlEpoch;
    const ensureRunning = () => { if (this.stopped || epoch !== this._controlEpoch) throw new Error('Stopped; a submitted browser operation may still finish'); };
    const timeout = Math.max(100, Math.min(Number(payload.timeoutMs) || 15000, 30000));
    try {
      if (action === 'launch') {
        if (this.browser) throw new Error('Browser session already active; close/disconnect it before switching environments');
        this._browserTabs = new Map();
        if (mode === 'aperture') {
          // No silent fallback and no guessing which Electron/webview tab the user meant.
          this.browser = await this.browserDriver.connect({ browserURL: 'http://localhost:9222', defaultViewport: null });
          this.browserOwned = false;
          this.page = null;
        } else {
          this.browser = await this.browserDriver.launch({ headless: payload.headless !== false });
          this.browserOwned = true;
          this.page = (await this.browser.pages())[0] || await this.browser.newPage();
        }
      } else if (!this.browser) throw new Error('Launch an explicit browser environment first');
      ensureRunning();
      if (action === 'launch' || action === 'list_tabs') {
        const tabs = [];
        for (const page of await this.browser.pages()) {
          let id = [...this._browserTabs].find(([, value]) => value === page)?.[0];
          if (!id) { id = randomUUID(); this._browserTabs.set(id, page); }
          tabs.push({ id, url: page.url() });
          if (page === this.page) this._selectedTabId = id;
        }
        return { success: true, status: 'ready', verified: false, environment: this.browserOwned ? 'isolated-browser' : 'attached-aperture',
          tabs, selectedTabId: this.page ? this._selectedTabId : null, requiresSelection: !this.page,
          observation: this.page ? await this._browserObservation() : null };
      }
      if (action === 'select_tab') {
        const page = this._browserTabs.get(payload.tabId);
        if (!page || page.isClosed()) throw new Error('Select an existing tab ID from list_tabs');
        this.page = page;
        this._selectedTabId = payload.tabId;
        return { success: true, status: 'observed', verified: false, observation: await this._browserObservation() };
      }
      if (action === 'close') {
        if (this.browserOwned) await this.browser.close();
        else await this.browser.disconnect(); // Never close a user's attached Electron/browser process.
        this.browser = null; this.page = null; this._browserFrame = null;
        return { success: true, status: 'closed', verified: true, evidence: { sessionDisconnected: true } };
      }
      if (!this.page || this.page.isClosed()) throw new Error('Select a browser tab before acting');
      if (['click', 'type', 'navigate', 'goto'].includes(action)) {
        const frame = this._browserFrame;
        if (!frame || frame.observationId !== observationId || frame.tabId !== this._selectedTabId || Date.now() - frame.observedAt > 30000 || frame.url !== this.page.url()) {
          throw new Error('Observe the selected tab and supply its fresh observationId before a browser action');
        }
        this._browserFrame = null;
      }
      ensureRunning();
      let result = {};
      switch (action) {
        case 'navigate':
        case 'goto':
          await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout });
          break;
        case 'click':
        case 'type': {
          const matches = await this.page.$$(selector);
          try {
            if (matches.length !== 1) throw new Error('Selector must match exactly one element');
            const box = await matches[0].boundingBox();
            if (!box || box.width <= 0 || box.height <= 0 || await matches[0].evaluate(el => !!el.disabled || el.getAttribute('aria-disabled') === 'true')) throw new Error('Target is hidden or disabled');
            ensureRunning();
            if (action === 'click') await matches[0].click();
            else await matches[0].type(text);
          } finally { await Promise.all(matches.map(el => el.dispose())); }
          break;
        }
        case 'screenshot': {
          const dir = path.resolve(process.cwd(), '.soma', 'vision_temp');
          const savePath = payload.screenshotPath ? path.resolve(payload.screenshotPath) : path.join(dir, 'page_' + randomUUID() + '.png');
          if (path.dirname(savePath) !== dir || path.extname(savePath).toLowerCase() !== '.png' || fs.existsSync(savePath)) throw new Error('Use a new PNG filename inside .soma/vision_temp');
          fs.mkdirSync(dir, { recursive: true });
          await this.page.screenshot({ path: savePath, fullPage: true });
          result.imagePath = savePath;
          break;
        }
        case 'extract_html': result.html = String(await this.page.content()).slice(0, 20000); break;
        case 'wait_for': {
          const handle = await this.page.waitForSelector(selector, { visible: true, timeout });
          if (!handle) throw new Error('Target was not observed');
          await handle.dispose();
          break;
        }
      }
      const observation = await this._browserObservation();
      ensureRunning();
      if (action === 'extract_text') result.text = observation.text;
      return { success: true, ...result, status: ['click', 'type', 'navigate', 'goto'].includes(action) ? 'submitted' : 'observed',
        verified: false, observation, message: 'Inspect the observation for the intended outcome. Transport success is not task completion.' };
    } catch (error) { return { success: false, status: this.stopped || epoch !== this._controlEpoch ? 'cancelled' : 'failed', verified: false, error: error.message }; }
    finally { this._browserActive = false; }
  }

  // ========================================================
  // Safety
  // ========================================================

  _isSafeUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      const protocol = parsed.protocol.toLowerCase();
      if (protocol !== 'http:' && protocol !== 'https:') return false;

      const host = parsed.hostname.toLowerCase();
      if (parsed.username || parsed.password) return false;
      if (host === 'localhost' || host === '0.0.0.0' || host === '::1' || host === '[::1]' || host.startsWith('[')) return false;
      if (/^(127|169\.254|0)\./.test(host)) return false;
      if (host.endsWith('.local') || host.endsWith('.internal')) return false;

      // Block private network ranges (IPv4)
      if (/^10\./.test(host)) return false;
      if (/^192\.168\./.test(host)) return false;
      if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;

      return true;
    } catch {
      return false;
    }
  }

  async checkUserInterference() {
    if (!this.safetyEnabled) return false;
    
    // Reset target reference if idle for >5s to allow fresh user actions
    const timeSinceLastAction = Date.now() - (this.lastActionTime || 0);
    if (timeSinceLastAction > 5000) {
      this.lastSomaMousePosition = this.currentPhysicalMousePosition || this.lastSomaMousePosition;
    }
    this.lastActionTime = Date.now();

    if (!this.currentPhysicalMousePosition || !this.lastSomaMousePosition) {
      return false;
    }

    const dx = Math.abs(this.currentPhysicalMousePosition.x - this.lastSomaMousePosition.x);
    const dy = Math.abs(this.currentPhysicalMousePosition.y - this.lastSomaMousePosition.y);

    const threshold = this.safetyThreshold || 30;
    if (dx > threshold || dy > threshold) {
      console.warn(`[${this.name}] ⚠️ User interference detected. Mouse moved by (${dx}px, ${dy}px) from SOMA target.`);
      return true;
    }

    return false;
  }

  async onShutdown() {
    this.stopped = true;
    this._actionActive?.abort();
    if (this.browser) {
      try { if (this.browserOwned) await this.browser.close(); else await this.browser.disconnect(); } catch {}
      this.browser = null; this.page = null;
    }
    if (this.mouseListenerProcess) {
      try {
        console.log(`[${this.name}] 🛑 Killing persistent mouse listener process...`);
        this.mouseListenerProcess.kill('SIGTERM');
        // Taskkill on Windows to ensure process tree cleanup
        const { exec } = require('child_process');
        exec(`taskkill /F /T /PID ${this.mouseListenerProcess.pid}`, () => {});
      } catch (e) {}
    }
    await super.onShutdown();
  }
}

export default ComputerControlArbiter;

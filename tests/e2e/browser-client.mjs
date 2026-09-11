import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';

const OBSCURA_PATH = 'D:\\DevEnv\\browsers\\obscura\\obscura.exe';
const CHROME_PATH = 'D:\\DevEnv\\browsers\\chrome-headless-shell\\win64-152.0.7977.54\\chrome-headless-shell-win64\\chrome-headless-shell.exe';

export class BrowserClient {
  constructor(options = {}) {
    this.requestedBrowser = options.browser || 'auto'; // 'obscura' | 'chrome-headless-shell' | 'auto'
    this.port = options.port || 9222 + Math.floor(Math.random() * 500);
    this.verbose = !!options.verbose;
    this.process = null;
    this.ws = null;
    this.msgId = 1;
    this.pendingCallbacks = new Map();
    this.sessionId = null;
    this.targetId = null;
    this.activeBrowser = null;
  }

  log(...args) {
    if (this.verbose) {
      console.log('[BrowserClient]', ...args);
    }
  }

  detectBrowser() {
    if (this.requestedBrowser === 'obscura') {
      if (fs.existsSync(OBSCURA_PATH)) return { type: 'obscura', path: OBSCURA_PATH };
      throw new Error(`Requested browser 'obscura' not found at ${OBSCURA_PATH}`);
    }
    if (this.requestedBrowser === 'chrome-headless-shell') {
      if (fs.existsSync(CHROME_PATH)) return { type: 'chrome-headless-shell', path: CHROME_PATH };
      throw new Error(`Requested browser 'chrome-headless-shell' not found at ${CHROME_PATH}`);
    }

    // Auto detection hierarchy: Obscura 1st priority, chrome-headless-shell fallback
    if (fs.existsSync(OBSCURA_PATH)) {
      return { type: 'obscura', path: OBSCURA_PATH };
    }
    if (fs.existsSync(CHROME_PATH)) {
      return { type: 'chrome-headless-shell', path: CHROME_PATH };
    }
    throw new Error('No supported headless browser found in D:\\DevEnv\\browsers\\');
  }

  async launch() {
    const { type, path: browserExe } = this.detectBrowser();
    this.activeBrowser = type;
    this.log(`Launching ${type} from ${browserExe} on port ${this.port}...`);

    let args = [];
    if (type === 'obscura') {
      args = [
        'serve',
        '--port', String(this.port),
        '--allow-private-network',
        '--allow-file-access'
      ];
    } else {
      args = [
        `--remote-debugging-port=${this.port}`,
        '--headless',
        '--disable-gpu',
        '--allow-file-access-from-files',
        '--no-first-run'
      ];
    }

    this.process = spawn(browserExe, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    this.process.on('error', (err) => {
      console.error(`Browser process error:`, err);
    });

    // Wait for HTTP endpoint to become available
    const wsDebuggerUrl = await this.waitForCdpEndpoint(5000);
    this.log(`Connecting CDP WebSocket to ${wsDebuggerUrl}`);

    await this.connectWebSocket(wsDebuggerUrl);
    await this.initSession();
    this.log(`Browser session initialized successfully. Target: ${this.targetId}, Session: ${this.sessionId}`);
    return this;
  }

  async waitForCdpEndpoint(timeoutMs) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/json/version`);
        if (res.ok) {
          const info = await res.json();
          if (info.webSocketDebuggerUrl) {
            return info.webSocketDebuggerUrl;
          }
        }
      } catch (err) {
        // Retry
      }
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`Timed out waiting for browser CDP endpoint on port ${this.port}`);
  }

  connectWebSocket(url) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        resolve();
      };

      this.ws.onerror = (err) => {
        reject(err);
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.id && this.pendingCallbacks.has(msg.id)) {
            const { resolve: reqResolve, reject: reqReject } = this.pendingCallbacks.get(msg.id);
            this.pendingCallbacks.delete(msg.id);
            if (msg.error) {
              reqReject(new Error(`CDP Error [${msg.error.code}]: ${msg.error.message}`));
            } else {
              reqResolve(msg.result);
            }
          }
        } catch (e) {
          this.log('Failed to parse incoming WS message:', e);
        }
      };

      this.ws.onclose = () => {
        this.log('Browser WebSocket connection closed');
      };
    });
  }

  send(method, params = {}, sessionId = null) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('WebSocket is not open'));
      }
      const id = this.msgId++;
      const payload = { id, method, params };
      if (sessionId) {
        payload.sessionId = sessionId;
      }
      this.pendingCallbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  async initSession() {
    // 1. Create Target
    const createRes = await this.send('Target.createTarget', { url: 'about:blank' });
    this.targetId = createRes.targetId || 'page-1';

    // 2. Attach to Target
    const attachRes = await this.send('Target.attachToTarget', {
      targetId: this.targetId,
      flatten: true
    });
    this.sessionId = attachRes.sessionId;

    // 3. Enable Runtime and Page domains
    await this.send('Runtime.enable', {}, this.sessionId);
    try {
      await this.send('Page.enable', {}, this.sessionId);
    } catch (e) {
      // Obscura may not have full Page domain; Runtime is sufficient for JS/WASM/DOM
    }
  }

  async evaluate(expression, options = {}) {
    const awaitPromise = options.awaitPromise !== false;
    const returnByValue = options.returnByValue !== false;

    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue
    }, this.sessionId);

    if (res.exceptionDetails) {
      const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
      throw new Error(`Evaluation Exception: ${desc}`);
    }

    return res.result?.value;
  }

  async navigate(url) {
    try {
      await this.send('Page.navigate', { url }, this.sessionId);
    } catch (e) {
      // Fallback: evaluate window.location.href = url
      await this.evaluate(`window.location.href = ${JSON.stringify(url)};`);
    }
  }

  async close() {
    this.log('Closing browser client...');
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }
    if (this.process) {
      try {
        this.process.kill('SIGKILL');
      } catch (e) {}
      this.process = null;
    }
    this.log('Browser client closed.');
  }
}

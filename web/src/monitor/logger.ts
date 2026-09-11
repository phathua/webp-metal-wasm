/**
 * Mobile In-App Debug Logger & Terminal Forwarder
 * 
 * Automatically captures errors and logs, shows a floating debug panel on mobile,
 * and streams logs back to the computer's terminal via Vite dev server.
 */

export type LogLevel = 'info' | 'warn' | 'error' | 'metal' | 'wasm';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
}

export class AppLogger {
  private static instance: AppLogger;
  private logs: LogEntry[] = [];
  private logContainer: HTMLElement | null = null;
  private logList: HTMLElement | null = null;
  private badge: HTMLElement | null = null;
  private isOpen = false;

  private constructor() {
    this.createDom();
    this.hookGlobalErrors();
  }

  public static get(): AppLogger {
    if (!AppLogger.instance) {
      AppLogger.instance = new AppLogger();
    }
    return AppLogger.instance;
  }

  public log(message: string, level: LogLevel = 'info'): void {
    const timestamp = new Date().toLocaleTimeString();
    const entry: LogEntry = { timestamp, level, message };
    this.logs.push(entry);
    if (this.logs.length > 200) this.logs.shift();

    this.renderEntry(entry);
    this.updateBadge();
    this.forwardToTerminal(message, level);
  }

  public info(msg: string): void { this.log(msg, 'info'); }
  public warn(msg: string): void { this.log(msg, 'warn'); }
  public error(msg: string): void { this.log(msg, 'error'); }
  public metal(msg: string): void { this.log(`[Metal GPU] ${msg}`, 'metal'); }
  public wasm(msg: string): void { this.log(`[WASM] ${msg}`, 'wasm'); }

  private forwardToTerminal(msg: string, level: LogLevel): void {
    try {
      fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level, msg })
      }).catch(() => {
        // Silently ignore if offline or in production
      });
    } catch {
      // Ignored
    }
  }

  private hookGlobalErrors(): void {
    window.addEventListener('error', (e) => {
      this.error(`Lỗi JS: ${e.message} tại ${e.filename}:${e.lineno}`);
    });

    window.addEventListener('unhandledrejection', (e) => {
      this.error(`Lỗi Promise: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`);
    });
  }

  private createDom(): void {
    // Floating Toggle Button
    const btn = document.createElement('button');
    btn.id = 'debug-toggle-btn';
    btn.innerHTML = `🐞 Logs <span id="debug-badge" style="background:#ef4444;color:#fff;border-radius:10px;padding:1px 6px;font-size:11px;display:none;">0</span>`;
    btn.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 99999;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(6, 182, 212, 0.4);
      color: #06b6d4;
      padding: 10px 16px;
      border-radius: 30px;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    `;

    // Drawer Container
    const drawer = document.createElement('div');
    drawer.id = 'debug-drawer';
    drawer.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 48vh;
      background: rgba(10, 15, 30, 0.96);
      backdrop-filter: blur(16px);
      border-top: 2px solid rgba(6, 182, 212, 0.4);
      z-index: 99998;
      display: none;
      flex-direction: column;
      font-family: monospace;
      font-size: 12px;
      color: #cbd5e1;
      box-shadow: 0 -10px 30px rgba(0,0,0,0.6);
    `;

    drawer.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:rgba(15,23,42,0.8);border-bottom:1px solid rgba(255,255,255,0.1);">
        <strong style="color:#38bdf8;">📱 Mobile Safari & WASM Debug Console</strong>
        <div>
          <button id="btn-clear-logs" style="background:rgba(255,255,255,0.1);border:none;color:#94a3b8;padding:4px 10px;border-radius:6px;font-size:11px;margin-right:8px;cursor:pointer;">Xóa</button>
          <button id="btn-close-drawer" style="background:#ef4444;border:none;color:#fff;padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer;">Đóng</button>
        </div>
      </div>
      <div id="debug-log-list" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:6px;"></div>
    `;

    document.body.appendChild(btn);
    document.body.appendChild(drawer);

    this.logContainer = drawer;
    this.logList = drawer.querySelector('#debug-log-list');
    this.badge = btn.querySelector('#debug-badge');

    btn.addEventListener('click', () => this.toggle());
    drawer.querySelector('#btn-close-drawer')?.addEventListener('click', () => this.toggle(false));
    drawer.querySelector('#btn-clear-logs')?.addEventListener('click', () => {
      this.logs = [];
      if (this.logList) this.logList.innerHTML = '';
      this.updateBadge();
    });
  }

  public toggle(force?: boolean): void {
    this.isOpen = force !== undefined ? force : !this.isOpen;
    if (this.logContainer) {
      this.logContainer.style.display = this.isOpen ? 'flex' : 'none';
      if (this.isOpen && this.logList) {
        this.logList.scrollTop = this.logList.scrollHeight;
      }
    }
  }

  private renderEntry(entry: LogEntry): void {
    if (!this.logList) return;
    const row = document.createElement('div');
    row.style.lineHeight = '1.4';
    row.style.wordBreak = 'break-word';

    let color = '#38bdf8'; // info
    if (entry.level === 'error') color = '#f87171';
    else if (entry.level === 'warn') color = '#fbbf24';
    else if (entry.level === 'metal') color = '#a78bfa';
    else if (entry.level === 'wasm') color = '#34d399';

    row.innerHTML = `<span style="color:#64748b;">[${entry.timestamp}]</span> <strong style="color:${color};">[${entry.level.toUpperCase()}]</strong> ${this.escapeHtml(entry.message)}`;
    this.logList.appendChild(row);
    this.logList.scrollTop = this.logList.scrollHeight;
  }

  private updateBadge(): void {
    if (!this.badge) return;
    const errorCount = this.logs.filter(l => l.level === 'error').length;
    if (errorCount > 0) {
      this.badge.style.display = 'inline-block';
      this.badge.textContent = String(errorCount);
    } else {
      this.badge.style.display = 'none';
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

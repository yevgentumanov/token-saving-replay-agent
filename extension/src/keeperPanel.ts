import * as vscode from "vscode";
import * as http from "http";
import { BackendManager } from "./backendManager";

interface KeeperStatus {
  state: string;
  turn_count: number;
  max_turns: number;
  consecutive_high_drift: number;
  last_reset: string;
  concept_md_loaded: boolean;
  concept_md_path: string;
}

interface KeeperVerdict {
  status: "APPROVED" | "REJECTED" | "WARNING" | "HARD_RESET";
  verdict: string;
  reasoning: string;
  concept_drift: number;
  violated_principles: string[];
  turn: number;
}

export class KeeperPanel {
  private static instance: KeeperPanel | undefined;
  private panel: vscode.WebviewPanel;
  private statusPollTimer: NodeJS.Timeout | null = null;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly backend: BackendManager
  ) {
    this.panel = panel;
    this.panel.webview.html = this._buildHtml();

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.command === "review") {
        await this._handleReview(msg.text);
      } else if (msg.command === "reset") {
        await this._handleReset();
      } else if (msg.command === "ready") {
        await this._pushStatus();
      }
    });

    this.panel.onDidDispose(() => {
      this._stopPoll();
      KeeperPanel.instance = undefined;
    });

    this._startPoll();
  }

  // ── Singleton open/reveal ─────────────────────────────────────────────────

  static open(backend: BackendManager): void {
    if (KeeperPanel.instance) {
      KeeperPanel.instance.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "llamaKeeper",
      "Concept Keeper",
      vscode.ViewColumn.Beside,
      { enableScripts: true, localResourceRoots: [] }
    );
    KeeperPanel.instance = new KeeperPanel(panel, backend);
  }

  static dispose(): void {
    KeeperPanel.instance?.panel.dispose();
    KeeperPanel.instance = undefined;
  }

  // ── Backend communication ─────────────────────────────────────────────────

  private async _getStatus(): Promise<KeeperStatus | null> {
    try {
      const raw = await this._httpGet("/api/keeper/status");
      return JSON.parse(raw) as KeeperStatus;
    } catch {
      return null;
    }
  }

  private async _pushStatus(): Promise<void> {
    const status = await this._getStatus();
    this.panel.webview.postMessage({ command: "status", data: status });
  }

  private async _handleReview(text: string): Promise<void> {
    this.panel.webview.postMessage({ command: "reviewing" });
    try {
      const raw = await this._httpPost("/api/keeper/review", { request: text });
      const verdict = JSON.parse(raw) as KeeperVerdict;
      this.panel.webview.postMessage({ command: "verdict", data: verdict });
      await this._pushStatus();
    } catch (e: any) {
      this.panel.webview.postMessage({
        command: "error",
        message: e.message ?? String(e),
      });
    }
  }

  private async _handleReset(): Promise<void> {
    this.panel.webview.postMessage({ command: "resetting" });
    try {
      await this._httpPost("/api/keeper/reset", {});
      await this._pushStatus();
      this.panel.webview.postMessage({ command: "reset_done" });
    } catch (e: any) {
      this.panel.webview.postMessage({
        command: "error",
        message: e.message ?? String(e),
      });
    }
  }

  // ── Status polling ────────────────────────────────────────────────────────

  private _startPoll(): void {
    this.statusPollTimer = setInterval(() => this._pushStatus(), 8000);
  }

  private _stopPoll(): void {
    if (this.statusPollTimer) {
      clearInterval(this.statusPollTimer);
      this.statusPollTimer = null;
    }
  }

  // ── HTTP helpers ──────────────────────────────────────────────────────────

  private _httpGet(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.get(`${this.backend.baseUrl}${path}`, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          res.statusCode && res.statusCode >= 400
            ? reject(new Error(`HTTP ${res.statusCode}: ${body}`))
            : resolve(body)
        );
      });
      req.on("error", reject);
      req.setTimeout(8000, () => { req.destroy(); reject(new Error("Timeout")); });
    });
  }

  private _httpPost(path: string, body: unknown): Promise<string> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const opts: http.RequestOptions = {
        hostname: "127.0.0.1",
        port: this.backend.port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      };
      const req = http.request(opts, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () =>
          res.statusCode && res.statusCode >= 400
            ? reject(new Error(`HTTP ${res.statusCode}: ${data}`))
            : resolve(data)
        );
      });
      req.on("error", reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error("Timeout")); });
      req.write(payload);
      req.end();
    });
  }

  // ── Webview HTML ──────────────────────────────────────────────────────────

  private _buildHtml(): string {
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';" />
  <style>
    :root {
      --bg:       var(--vscode-editor-background, #1e1e1e);
      --fg:       var(--vscode-editor-foreground, #d4d4d4);
      --border:   var(--vscode-panel-border, #444);
      --input-bg: var(--vscode-input-background, #3c3c3c);
      --input-fg: var(--vscode-input-foreground, #cccccc);
      --btn-bg:   var(--vscode-button-background, #0e639c);
      --btn-fg:   var(--vscode-button-foreground, #fff);
      --btn-hov:  var(--vscode-button-hoverBackground, #1177bb);
      --font:     var(--vscode-font-family, 'Segoe UI', sans-serif);
      --mono:     var(--vscode-editor-font-family, monospace);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg); color: var(--fg);
      font-family: var(--font); font-size: 13px;
      padding: 16px; display: flex; flex-direction: column; gap: 14px;
    }

    /* ── Header ── */
    .header { display: flex; align-items: center; gap: 10px; }
    .header h1 { font-size: 15px; font-weight: 600; }
    .badge-state {
      font-size: 11px; padding: 2px 8px; border-radius: 10px;
      font-weight: 600; letter-spacing: 0.04em;
    }
    .state-fresh   { background: #1a3a1a; color: #6bcb77; border: 1px solid #2d5a2d; }
    .state-active  { background: #0d2a3d; color: #569cd6; border: 1px solid #1a4a6a; }
    .state-needs   { background: #3a1a1a; color: #f48771; border: 1px solid #6a2a2a; }
    .state-offline { background: #2a2a2a; color: #888;    border: 1px solid #444; }

    /* ── Session info bar ── */
    .session-bar {
      display: flex; gap: 16px; align-items: center;
      background: var(--input-bg); border-radius: 6px;
      padding: 8px 12px; font-size: 12px; color: #999;
      flex-wrap: wrap;
    }
    .session-bar span { white-space: nowrap; }
    .session-bar .turn-warn { color: #f48771; font-weight: 600; }

    /* ── Review form ── */
    .section-label { font-size: 11px; color: #888; text-transform: uppercase;
                     letter-spacing: 0.06em; margin-bottom: 4px; }
    textarea {
      width: 100%; min-height: 100px; padding: 10px;
      background: var(--input-bg); color: var(--input-fg);
      border: 1px solid var(--border); border-radius: 4px;
      font-family: var(--mono); font-size: 12px;
      resize: vertical; outline: none;
    }
    textarea:focus { border-color: var(--btn-bg); }

    /* ── Buttons ── */
    .btn-row { display: flex; gap: 8px; }
    button {
      padding: 6px 14px; border: none; border-radius: 4px; cursor: pointer;
      font-size: 12px; font-family: var(--font); font-weight: 500;
    }
    .btn-primary { background: var(--btn-bg); color: var(--btn-fg); }
    .btn-primary:hover { background: var(--btn-hov); }
    .btn-primary:disabled { opacity: 0.45; cursor: default; }
    .btn-danger  { background: #6a1f1f; color: #f48771; }
    .btn-danger:hover  { background: #8a2a2a; }
    .btn-danger:disabled { opacity: 0.45; cursor: default; }

    /* ── Verdict card ── */
    .verdict-card {
      border-radius: 6px; padding: 12px 14px;
      border-left: 4px solid #555;
      background: var(--input-bg);
      display: none; flex-direction: column; gap: 8px;
    }
    .verdict-card.show { display: flex; }
    .verdict-approved { border-color: #6bcb77; }
    .verdict-warning  { border-color: #dcdcaa; }
    .verdict-rejected { border-color: #f48771; }
    .verdict-hard_reset { border-color: #c586c0; }

    .verdict-header {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    }
    .verdict-status {
      font-size: 12px; font-weight: 700; letter-spacing: 0.05em;
      padding: 2px 9px; border-radius: 10px;
    }
    .vs-approved   { background: #1a3a1a; color: #6bcb77; }
    .vs-warning    { background: #2a2a1a; color: #dcdcaa; }
    .vs-rejected   { background: #3a1a1a; color: #f48771; }
    .vs-hard_reset { background: #2a1a2a; color: #c586c0; }

    .drift-pill {
      font-size: 11px; color: #888;
      background: #2a2a2a; padding: 2px 8px; border-radius: 10px;
    }
    .drift-high { color: #f48771; }

    .verdict-text { font-size: 13px; line-height: 1.5; }
    .verdict-reasoning { font-size: 12px; color: #999; line-height: 1.5; }
    .violated-list { font-size: 11px; color: #f48771; }

    /* ── Thinking indicator ── */
    .thinking {
      display: none; align-items: center; gap: 8px;
      color: #888; font-size: 12px;
    }
    .thinking.show { display: flex; }
    .dot-pulse { display: flex; gap: 4px; }
    .dot-pulse span {
      width: 6px; height: 6px; background: #569cd6;
      border-radius: 50%; animation: pulse 1.2s ease-in-out infinite;
    }
    .dot-pulse span:nth-child(2) { animation-delay: 0.2s; }
    .dot-pulse span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes pulse {
      0%, 80%, 100% { opacity: 0.2; transform: scale(0.85); }
      40%            { opacity: 1;   transform: scale(1); }
    }

    /* ── Error notice ── */
    .error-notice {
      display: none; color: #f48771; font-size: 12px;
      background: #3a1a1a; border-radius: 4px; padding: 8px 12px;
    }
    .error-notice.show { display: block; }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <h1>🔒 Concept Keeper <small style="font-weight:400;color:#888">v-1</small></h1>
    <span id="badgeState" class="badge-state state-offline">offline</span>
  </div>

  <!-- Session info -->
  <div class="session-bar" id="sessionBar">
    <span id="turnInfo">Turn —/—</span>
    <span id="driftInfo">Consecutive drift: —</span>
    <span id="resetInfo">Last reset: —</span>
  </div>

  <!-- Review form -->
  <div>
    <div class="section-label">Describe the proposed change or decision</div>
    <textarea id="reviewInput"
      placeholder="e.g. I want to merge Model A and B into a single API call to reduce latency…"
    ></textarea>
  </div>

  <!-- Buttons -->
  <div class="btn-row">
    <button id="btnReview" class="btn-primary" disabled>Submit for Review</button>
    <button id="btnReset"  class="btn-danger">Hard Reset</button>
  </div>

  <!-- Thinking -->
  <div class="thinking" id="thinking">
    <div class="dot-pulse">
      <span></span><span></span><span></span>
    </div>
    <span>Keeper is reviewing…</span>
  </div>

  <!-- Error -->
  <div class="error-notice" id="errorNotice"></div>

  <!-- Verdict -->
  <div class="verdict-card" id="verdictCard">
    <div class="verdict-header">
      <span class="verdict-status" id="vStatus"></span>
      <span class="drift-pill" id="vDrift"></span>
      <span style="font-size:11px;color:#666" id="vTurn"></span>
    </div>
    <div class="verdict-text" id="vVerdict"></div>
    <div class="verdict-reasoning" id="vReasoning"></div>
    <div class="violated-list" id="vViolated"></div>
  </div>

<script>
  const vscode = acquireVsCodeApi();

  const btnReview   = document.getElementById('btnReview');
  const btnReset    = document.getElementById('btnReset');
  const reviewInput = document.getElementById('reviewInput');
  const badgeState  = document.getElementById('badgeState');
  const turnInfo    = document.getElementById('turnInfo');
  const driftInfo   = document.getElementById('driftInfo');
  const resetInfo   = document.getElementById('resetInfo');
  const thinking    = document.getElementById('thinking');
  const errorNotice = document.getElementById('errorNotice');
  const verdictCard = document.getElementById('verdictCard');

  // ── helpers ──────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function setThinking(on) {
    thinking.classList.toggle('show', on);
    btnReview.disabled = on;
    btnReset.disabled  = on;
    if (on) errorNotice.classList.remove('show');
  }

  function showError(msg) {
    errorNotice.textContent = 'Error: ' + msg;
    errorNotice.classList.add('show');
    setThinking(false);
  }

  // ── status render ─────────────────────────────────────────────────────────
  function applyStatus(s) {
    if (!s) {
      badgeState.textContent = 'offline';
      badgeState.className   = 'badge-state state-offline';
      btnReview.disabled     = true;
      return;
    }
    const stateKey = s.state.toLowerCase().replace('_','-');
    const stateClass = {
      fresh: 'state-fresh', active: 'state-active',
      'needs-reset': 'state-needs'
    }[stateKey] || 'state-offline';

    badgeState.textContent = s.state;
    badgeState.className   = 'badge-state ' + stateClass;
    btnReview.disabled     = false;

    const turnsLeft = s.max_turns - s.turn_count;
    const warnClass = turnsLeft <= 5 ? ' class="turn-warn"' : '';
    turnInfo.innerHTML  = \`Turn <span\${warnClass}>\${s.turn_count}/\${s.max_turns}</span>\`;
    driftInfo.textContent = 'Consecutive high drift: ' + s.consecutive_high_drift;

    if (s.last_reset) {
      const d = new Date(s.last_reset);
      resetInfo.textContent = 'Last reset: ' + d.toLocaleTimeString();
    } else {
      resetInfo.textContent = 'Last reset: —';
    }
  }

  // ── verdict render ────────────────────────────────────────────────────────
  const STATUS_CLASSES = {
    APPROVED:   'verdict-approved',
    WARNING:    'verdict-warning',
    REJECTED:   'verdict-rejected',
    HARD_RESET: 'verdict-hard_reset',
  };
  const STATUS_BADGE = {
    APPROVED:   'vs-approved',
    WARNING:    'vs-warning',
    REJECTED:   'vs-rejected',
    HARD_RESET: 'vs-hard_reset',
  };

  function applyVerdict(v) {
    setThinking(false);
    verdictCard.className = 'verdict-card show ' + (STATUS_CLASSES[v.status] || '');

    const vStatus = document.getElementById('vStatus');
    vStatus.textContent = v.status.replace('_',' ');
    vStatus.className   = 'verdict-status ' + (STATUS_BADGE[v.status] || '');

    const driftEl = document.getElementById('vDrift');
    driftEl.textContent = 'Drift ' + v.concept_drift + '/10';
    driftEl.classList.toggle('drift-high', v.concept_drift >= 7);

    document.getElementById('vTurn').textContent     = 'turn ' + v.turn;
    document.getElementById('vVerdict').textContent   = v.verdict;
    document.getElementById('vReasoning').textContent = v.reasoning;

    const violated = document.getElementById('vViolated');
    if (v.violated_principles && v.violated_principles.length > 0) {
      violated.textContent = '⚠ Violated: ' + v.violated_principles.join(', ');
    } else {
      violated.textContent = '';
    }
  }

  // ── message handler ───────────────────────────────────────────────────────
  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.command === 'status')     { applyStatus(msg.data); }
    if (msg.command === 'reviewing')  { setThinking(true); }
    if (msg.command === 'resetting')  { setThinking(true); }
    if (msg.command === 'verdict')    { applyVerdict(msg.data); }
    if (msg.command === 'reset_done') { setThinking(false); verdictCard.classList.remove('show'); }
    if (msg.command === 'error')      { showError(msg.message); }
  });

  // ── user actions ──────────────────────────────────────────────────────────
  btnReview.addEventListener('click', () => {
    const text = reviewInput.value.trim();
    if (!text) { reviewInput.focus(); return; }
    vscode.postMessage({ command: 'review', text });
  });

  btnReset.addEventListener('click', () => {
    if (!confirm('Force a Keeper Hard Reset?\\nThis clears the session and re-reads CONCEPT.md.')) return;
    vscode.postMessage({ command: 'reset' });
  });

  reviewInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      btnReview.click();
    }
  });

  // ── init ──────────────────────────────────────────────────────────────────
  vscode.postMessage({ command: 'ready' });
</script>
</body>
</html>`;
  }
}

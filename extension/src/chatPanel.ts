import * as vscode from "vscode";
import { BackendManager } from "./backendManager";

export class ChatPanel {
  private static instance: ChatPanel | undefined;
  private panel: vscode.WebviewPanel;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly backend: BackendManager
  ) {
    this.panel = panel;
    this.panel.onDidDispose(() => {
      ChatPanel.instance = undefined;
    });
    this._setContent();
  }

  // ── Singleton open/reveal ─────────────────────────────────────────────────

  static open(backend: BackendManager): void {
    if (ChatPanel.instance) {
      ChatPanel.instance.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "llamaChat",
      "Llama Chat",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        // Allow the webview to make requests to our backend
        localResourceRoots: [],
      }
    );

    ChatPanel.instance = new ChatPanel(panel, backend);
  }

  static dispose(): void {
    ChatPanel.instance?.panel.dispose();
    ChatPanel.instance = undefined;
  }

  // ── Webview HTML ──────────────────────────────────────────────────────────

  private _setContent(): void {
    const url = this.backend.baseUrl;
    // The webview wraps our existing UI in an iframe.
    // CSP allows frames only from our localhost backend.
    // ?vscode=1 tells app.ts it is running inside a VS Code webview iframe.
    this.panel.webview.html = this._buildHtml(url);
  }

  private _buildHtml(backendUrl: string): string {
    const iframeSrc = `${backendUrl}/?vscode=1`;
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none';
             frame-src ${backendUrl};
             style-src 'unsafe-inline';"
  />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #1e1e1e; }

    #loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #cccccc;
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 13px;
      gap: 12px;
    }
    .spinner {
      width: 28px; height: 28px;
      border: 3px solid #555;
      border-top-color: #569cd6;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    iframe {
      display: none;
      width: 100%; height: 100%;
      border: none;
    }
  </style>
</head>
<body>
  <div id="loading">
    <div class="spinner"></div>
    <span>Waiting for Llama backend…</span>
    <small style="color:#888">${backendUrl}</small>
  </div>
  <iframe id="chat" src="${iframeSrc}" title="Llama Chat"></iframe>

  <script>
    const iframe  = document.getElementById('chat');
    const loading = document.getElementById('loading');

    function tryLoad() {
      fetch('${backendUrl}/api/status')
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(() => {
          loading.style.display = 'none';
          iframe.style.display  = 'block';
        })
        .catch(() => setTimeout(tryLoad, 1500));
    }

    tryLoad();
  </script>
</body>
</html>`;
  }
}

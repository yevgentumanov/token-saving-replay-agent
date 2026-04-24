import * as vscode from "vscode";
import * as http from "http";
import { BackendManager } from "./backendManager";

export class CompletionProvider implements vscode.InlineCompletionItemProvider {
  private enabled: boolean;
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingResolve: ((items: vscode.InlineCompletionList) => void) | null = null;

  constructor(private readonly backend: BackendManager) {
    this.enabled = vscode.workspace
      .getConfiguration("llama")
      .get<boolean>("completionEnabled", true);
  }

  // ── Toggle ────────────────────────────────────────────────────────────────

  toggle(): boolean {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
  }

  // ── vscode.InlineCompletionItemProvider ──────────────────────────────────

  provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionList> {
    return new Promise((resolve) => {
      // Cancel any in-flight debounce
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.pendingResolve?.({ items: [] });
        this.pendingResolve = null;
      }

      if (!this.enabled) {
        resolve({ items: [] });
        return;
      }

      this.pendingResolve = resolve;

      const debounceMs = vscode.workspace
        .getConfiguration("llama")
        .get<number>("completionDebounceMs", 400);

      this.debounceTimer = setTimeout(async () => {
        this.debounceTimer = null;
        this.pendingResolve = null;

        if (token.isCancellationRequested) {
          resolve({ items: [] });
          return;
        }

        // Only proceed if Model B is healthy
        const status = await this.backend.getStatus();
        if (!status?.b.healthy) {
          resolve({ items: [] });
          return;
        }

        try {
          const suggestion = await this._fetchCompletion(document, position, token);
          if (!suggestion || token.isCancellationRequested) {
            resolve({ items: [] });
            return;
          }
          const item = new vscode.InlineCompletionItem(
            suggestion,
            new vscode.Range(position, position)
          );
          resolve({ items: [item] });
        } catch {
          resolve({ items: [] });
        }
      }, debounceMs);

      // If the token is cancelled while we are waiting, flush immediately
      token.onCancellationRequested(() => {
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
          this.debounceTimer = null;
        }
        resolve({ items: [] });
      });
    });
  }

  // ── Context builder ───────────────────────────────────────────────────────

  private _buildContext(
    document: vscode.TextDocument,
    position: vscode.Position
  ): { prefix: string; suffix: string; language: string } {
    const cfg = vscode.workspace.getConfiguration("llama");
    const contextLines = cfg.get<number>("completionContextLines", 30);

    const startLine = Math.max(0, position.line - contextLines);
    const endLine = Math.min(
      document.lineCount - 1,
      position.line + 10
    );

    const prefixRange = new vscode.Range(
      new vscode.Position(startLine, 0),
      position
    );
    const suffixRange = new vscode.Range(
      position,
      new vscode.Position(endLine, document.lineAt(endLine).text.length)
    );

    return {
      prefix: document.getText(prefixRange),
      suffix: document.getText(suffixRange),
      language: document.languageId,
    };
  }

  // ── Request to Model B ────────────────────────────────────────────────────

  private async _fetchCompletion(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<string | null> {
    const { prefix, suffix, language } = this._buildContext(document, position);
    const maxTokens = vscode.workspace
      .getConfiguration("llama")
      .get<number>("completionMaxTokens", 200);

    const systemPrompt =
      `You are a code completion engine. Complete the code at the <CURSOR> marker.\n` +
      `Language: ${language}\n` +
      `Rules:\n` +
      `- Output ONLY the inserted text (what goes at the cursor), nothing else.\n` +
      `- No markdown fences, no explanations, no line repeating the prefix.\n` +
      `- If no completion is appropriate, output a single space.`;

    const userPrompt = `${prefix}<CURSOR>${suffix}`;

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const body = JSON.stringify({
      messages,
      temperature: 0.1,
      max_tokens: maxTokens,
    });

    return new Promise<string | null>((resolve) => {
      if (token.isCancellationRequested) { resolve(null); return; }

      const options: http.RequestOptions = {
        hostname: "127.0.0.1",
        port: this.backend.port,
        path: "/api/chat/patcher",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      };

      const req = http.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (token.isCancellationRequested) { resolve(null); return; }
          try {
            const json = JSON.parse(data);
            const content: string =
              json?.choices?.[0]?.message?.content?.trim() ?? "";
            // Reject trivial / whitespace-only completions
            resolve(content.length > 1 ? content : null);
          } catch {
            resolve(null);
          }
        });
      });

      req.on("error", () => resolve(null));
      req.setTimeout(8000, () => { req.destroy(); resolve(null); });

      token.onCancellationRequested(() => { req.destroy(); resolve(null); });

      req.write(body);
      req.end();
    });
  }
}

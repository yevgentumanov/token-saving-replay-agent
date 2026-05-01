import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import * as http from "http";

export interface ModelConfig {
  path?: string;
  args?: string;
  port?: number;
  provider?: string;
  api_key?: string;
  cloud_model?: string;
}

export interface BackendStatus {
  a: { running: boolean; healthy: boolean; vram_error: boolean; port: number; provider: string };
  b: { running: boolean; healthy: boolean; vram_error: boolean; port: number; provider: string };
}

export class BackendManager {
  private proc: cp.ChildProcess | null = null;
  private outputChannel: vscode.OutputChannel;
  private statusPollTimer: NodeJS.Timeout | null = null;
  private _onStatusChange = new vscode.EventEmitter<BackendStatus>();
  readonly onStatusChange = this._onStatusChange.event;

  constructor(private readonly repoRoot: string) {
    this.outputChannel = vscode.window.createOutputChannel("Llama Backend");
  }

  get port(): number {
    return vscode.workspace.getConfiguration("llama").get<number>("backendPort", 7860);
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  // ── Process management ────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.proc && this.proc.exitCode === null) {
      return;
    }

    if (await this.isBackendReachable()) {
      this.outputChannel.appendLine(`[BackendManager] Reusing backend at ${this.baseUrl}`);
      this._startStatusPoll();
      return;
    }

    const pythonPath = vscode.workspace
      .getConfiguration("llama")
      .get<string>("pythonPath", "python");

    const mainPy = path.join(this.repoRoot, "main.py");
    this.outputChannel.appendLine(`[BackendManager] Starting: ${pythonPath} ${mainPy}`);
    this.outputChannel.show(true);

    this.proc = cp.spawn(pythonPath, [mainPy], {
      cwd: this.repoRoot,
      env: { ...process.env, LLAMA_NO_BROWSER: "1" },
    });

    this.proc.stdout?.on("data", (chunk: Buffer) => {
      this.outputChannel.append(chunk.toString());
    });

    this.proc.stderr?.on("data", (chunk: Buffer) => {
      this.outputChannel.append(chunk.toString());
    });

    const startTime = Date.now();
    this.proc.on("exit", (code) => {
      this.outputChannel.appendLine(`[BackendManager] Process exited with code ${code}`);
      this._stopStatusPoll();
      this.proc = null;
      // If it crashed within 8 seconds of starting, surface an error notification
      if (code !== 0 && Date.now() - startTime < 8000) {
        vscode.window.showErrorMessage(
          `Llama backend crashed (exit ${code}). Check "Llama Backend" output for details.`,
          "Show Output"
        ).then((choice) => { if (choice === "Show Output") { this.outputChannel.show(); } });
      }
    });

    this._startStatusPoll();
  }

  stop(): void {
    this._stopStatusPoll();
    const proc = this.proc;   // capture before nulling to avoid race
    this.proc = null;
    if (proc && !proc.killed) {
      this.outputChannel.appendLine("[BackendManager] Stopping backend...");
      this._httpPost("/api/stop", {}).catch(() => {});
      setTimeout(() => {
        if (!proc.killed) { proc.kill(); }
      }, 2000);
    }
  }

  dispose(): void {
    this.stop();
    this._onStatusChange.dispose();
    this.outputChannel.dispose();
  }

  showOutput(): void {
    this.outputChannel.show();
  }

  // ── Model control (delegates to our existing /api/start and /api/stop) ────

  async startModels(modelA: ModelConfig, modelB?: ModelConfig): Promise<void> {
    await this.start();
    const body: Record<string, unknown> = {
      model_a: {
        path: modelA.path ?? "",
        args: modelA.args ?? "",
        port: modelA.port ?? 8080,
        provider: modelA.provider ?? "local",
        api_key: modelA.api_key ?? "",
        cloud_model: modelA.cloud_model ?? "",
      },
    };
    if (modelB) {
      body.model_b = {
        path: modelB.path ?? "",
        args: modelB.args ?? "",
        port: modelB.port ?? 8081,
        provider: modelB.provider ?? "local",
        api_key: modelB.api_key ?? "",
        cloud_model: modelB.cloud_model ?? "",
      };
    }
    await this._httpPost("/api/start", body);
  }

  async stopModels(): Promise<void> {
    await this._httpPost("/api/stop", {});
  }

  // ── Status polling ────────────────────────────────────────────────────────

  async getStatus(): Promise<BackendStatus | null> {
    try {
      const raw = await this._httpGet("/api/status");
      return JSON.parse(raw) as BackendStatus;
    } catch {
      return null;
    }
  }

  async isBackendReachable(): Promise<boolean> {
    return (await this.getStatus()) !== null;
  }

  private _startStatusPoll(): void {
    this._stopStatusPoll();
    this.statusPollTimer = setInterval(async () => {
      const status = await this.getStatus();
      if (status) {
        this._onStatusChange.fire(status);
      }
    }, 4000);
  }

  private _stopStatusPoll(): void {
    if (this.statusPollTimer) {
      clearInterval(this.statusPollTimer);
      this.statusPollTimer = null;
    }
  }

  // ── HTTP helpers (no external deps — uses Node built-in http) ────────────

  private _httpGet(urlPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.get(`${this.baseUrl}${urlPath}`, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
          } else {
            resolve(body);
          }
        });
      });
      req.on("error", reject);
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });
    });
  }

  private _httpPost(urlPath: string, body: unknown): Promise<string> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const options: http.RequestOptions = {
        hostname: "127.0.0.1",
        port: this.port,
        path: urlPath,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      };
      const req = http.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          } else {
            resolve(data);
          }
        });
      });
      req.on("error", reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });
      req.write(payload);
      req.end();
    });
  }
}

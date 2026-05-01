import * as vscode from "vscode";
import { BackendManager, BackendStatus } from "./backendManager";

export class StatusBarManager {
  private item: vscode.StatusBarItem;
  private completionEnabled: boolean;

  constructor(
    private readonly backend: BackendManager,
    initialCompletionEnabled: boolean
  ) {
    this.completionEnabled = initialCompletionEnabled;
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.command = "llama.showOutput";
    this.item.tooltip = "Llama Dual-Model Assistant - click to show backend log";
    this._render(null);
    this.item.show();

    backend.onStatusChange((status) => this._render(status));
  }

  setCompletionEnabled(enabled: boolean): void {
    this.completionEnabled = enabled;
    this._renderCurrent();
  }

  private _lastStatus: BackendStatus | null = null;

  private _render(status: BackendStatus | null): void {
    this._lastStatus = status;

    if (!status) {
      this.item.text = "$(circle-slash) Llama: offline";
      this.item.backgroundColor = undefined;
      this.item.tooltip = "Llama backend is not running - click to show output";
      return;
    }

    const aOk = status.a.healthy;
    const bOk = status.b.healthy;
    const aIcon = aOk ? "$(circle-filled)" : "$(circle-outline)";
    const bIcon = bOk ? "$(circle-filled)" : "$(circle-outline)";
    const compIcon = this.completionEnabled ? "$(zap)" : "$(zap-disabled)";

    // VRAM errors get a warning colour
    if (status.a.vram_error || status.b.vram_error) {
      this.item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
      this.item.text = `$(warning) Llama: VRAM error`;
      this.item.tooltip =
        "A model ran out of VRAM - reduce -ngl or lower context size";
      return;
    }

    this.item.backgroundColor = undefined;
    this.item.text = `${aIcon} A  ${bIcon} B  ${compIcon}`;
    this.item.tooltip = [
      `Model A: ${aOk ? "healthy" : "not ready"} (${status.a.provider}, port ${status.a.port})`,
      `Model B: ${bOk ? "healthy" : "not ready"} (${status.b.provider}, port ${status.b.port})`,
      `Inline completion: ${this.completionEnabled ? "on" : "off"}`,
      "",
      "Click to show backend output log",
    ].join("\n");
  }

  private _renderCurrent(): void {
    this._render(this._lastStatus);
  }

  dispose(): void {
    this.item.dispose();
  }
}

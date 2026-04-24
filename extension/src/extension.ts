import * as vscode from "vscode";
import * as path from "path";
import { BackendManager } from "./backendManager";
import { StatusBarManager } from "./statusBar";
import { ChatPanel } from "./chatPanel";
import { KeeperPanel } from "./keeperPanel";
import { CompletionProvider } from "./completionProvider";

let backend: BackendManager | undefined;
let statusBar: StatusBarManager | undefined;
let completionProvider: CompletionProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const repoRoot = _resolveRepoRoot(context);

  // ── Core services ─────────────────────────────────────────────────────────
  backend = new BackendManager(repoRoot);
  completionProvider = new CompletionProvider(backend);

  const completionEnabled = vscode.workspace
    .getConfiguration("llama")
    .get<boolean>("completionEnabled", true);
  statusBar = new StatusBarManager(backend, completionEnabled);

  // ── Register inline completion for all languages ──────────────────────────
  const completionRegistration = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: "**" },
    completionProvider
  );

  // ── Commands ──────────────────────────────────────────────────────────────
  const cmds: [string, () => void][] = [
    ["llama.openChat", () => {
      if (!backend) { return; }
      ChatPanel.open(backend);
    }],

    ["llama.startModels", async () => {
      if (!backend) { return; }
      const cfg = vscode.workspace.getConfiguration("llama");
      const autoStart = cfg.get<boolean>("autoStart", false);
      if (!autoStart) {
        vscode.window.showInformationMessage(
          "Configure models in the Launcher tab, then use 'Start' there. " +
          "Or enable llama.autoStart to launch automatically."
        );
        if (backend) { ChatPanel.open(backend); }
        return;
      }
      await backend.start();
    }],

    ["llama.stopModels", async () => {
      if (!backend) { return; }
      try {
        await backend.stopModels();
        vscode.window.showInformationMessage("Llama: models stopped.");
      } catch (e: any) {
        vscode.window.showErrorMessage(`Llama: stop failed — ${e.message}`);
      }
    }],

    ["llama.toggleCompletion", () => {
      if (!completionProvider || !statusBar) { return; }
      const nowEnabled = completionProvider.toggle();
      statusBar.setCompletionEnabled(nowEnabled);
      vscode.workspace
        .getConfiguration("llama")
        .update("completionEnabled", nowEnabled, vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(
        `Llama inline completion: ${nowEnabled ? "ON" : "OFF"}`,
        2500
      );
    }],

    ["llama.showOutput", () => {
      backend?.showOutput();
    }],

    ["llama.openKeeper", () => {
      if (!backend) { return; }
      KeeperPanel.open(backend);
    }],
  ];

  const cmdDisposables = cmds.map(([id, handler]) =>
    vscode.commands.registerCommand(id, handler)
  );

  // ── Auto-start if configured ──────────────────────────────────────────────
  const autoStart = vscode.workspace
    .getConfiguration("llama")
    .get<boolean>("autoStart", false);
  if (autoStart) {
    backend.start().catch((e) =>
      vscode.window.showErrorMessage(`Llama: backend start failed — ${e.message}`)
    );
  }

  // ── React to settings changes ─────────────────────────────────────────────
  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("llama.completionEnabled") && completionProvider && statusBar) {
      const enabled = vscode.workspace
        .getConfiguration("llama")
        .get<boolean>("completionEnabled", true);
      completionProvider.setEnabled(enabled);
      statusBar.setCompletionEnabled(enabled);
    }
  });

  // ── Register all disposables ──────────────────────────────────────────────
  context.subscriptions.push(
    ...cmdDisposables,
    completionRegistration,
    configListener,
    { dispose: () => backend?.dispose() },
    { dispose: () => statusBar?.dispose() },
    { dispose: () => ChatPanel.dispose() },
    { dispose: () => KeeperPanel.dispose() }
  );
}

export function deactivate(): void {
  backend?.dispose();
  backend = undefined;
  statusBar = undefined;
  completionProvider = undefined;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _resolveRepoRoot(context: vscode.ExtensionContext): string {
  // extension/ is a subdirectory of the repo root, so go one level up
  return path.resolve(context.extensionPath, "..");
}

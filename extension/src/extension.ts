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

  backend = new BackendManager(repoRoot);
  completionProvider = new CompletionProvider(backend);

  const completionEnabled = vscode.workspace
    .getConfiguration("llama")
    .get<boolean>("completionEnabled", true);
  statusBar = new StatusBarManager(backend, completionEnabled);

  const completionRegistration = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: "**" },
    completionProvider
  );

  const cmds: [string, () => void | Promise<void>][] = [
    ["llama.openChat", async () => {
      if (!backend) { return; }
      await backend.start();
      ChatPanel.open(backend);
    }],

    ["llama.startModels", async () => {
      if (!backend) { return; }
      await backend.start();
      ChatPanel.open(backend);
      vscode.window.showInformationMessage(
        "Llama backend is running. Configure and start models in the Launcher tab."
      );
    }],

    ["llama.stopModels", async () => {
      if (!backend) { return; }
      try {
        await backend.stopModels();
        vscode.window.showInformationMessage("Llama: models stopped.");
      } catch (e: any) {
        vscode.window.showErrorMessage(`Llama: stop failed - ${e.message}`);
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

  const autoStart = vscode.workspace
    .getConfiguration("llama")
    .get<boolean>("autoStart", false);
  if (autoStart) {
    backend.start().catch((e) =>
      vscode.window.showErrorMessage(`Llama: backend start failed - ${e.message}`)
    );
  }

  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("llama.completionEnabled") && completionProvider && statusBar) {
      const enabled = vscode.workspace
        .getConfiguration("llama")
        .get<boolean>("completionEnabled", true);
      completionProvider.setEnabled(enabled);
      statusBar.setCompletionEnabled(enabled);
    }
  });

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

function _resolveRepoRoot(context: vscode.ExtensionContext): string {
  return path.resolve(context.extensionPath, "..");
}

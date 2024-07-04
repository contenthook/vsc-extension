import * as vscode from "vscode";
import { ContenthookViewProvider } from "./view";

export function activate(context: vscode.ExtensionContext) {
  vscode.window.showInformationMessage("Contenthook activating...");
  const provider = new ContenthookViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("contenthookView", provider),
  );
  vscode.window.showInformationMessage("Contenthook extension is now active!");
}
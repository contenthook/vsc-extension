import * as vscode from "vscode";
import { ContenthookViewProvider } from "./view.js";

export function activate(context: vscode.ExtensionContext) {
  vscode.window.showInformationMessage("Contenthook extension activated.");
  const provider = new ContenthookViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("contenthookView", provider),
  );
}
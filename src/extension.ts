import * as vscode from "vscode";
import { ContenthookViewProvider } from "./view";

function activate(context: vscode.ExtensionContext) {
  const provider = new ContenthookViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("contenthookView", provider),
  );
}

export { activate };

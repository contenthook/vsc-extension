import * as vscode from "vscode";
import { ContenthookViewProvider } from "./providers/view";

function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "contenthook" is now active!');
  const provider = new ContenthookViewProvider(context.extensionUri);
  console.log("ContenthookViewProvider");
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("contenthookView", provider),
  );
  console.log("registerWebviewViewProvider");
}

export { activate };

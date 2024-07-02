"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContenthookViewProvider = void 0;
const vscode = __importStar(require("vscode"));
class ContenthookViewProvider {
    _extensionUri;
    _view;
    _intervalId;
    constructor(_extensionUri) {
        this._extensionUri = _extensionUri;
    }
    async resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
        };
        await this.checkForConfigFile(webviewView.webview);
        webviewView.onDidDispose(() => {
            if (this._intervalId) {
                clearInterval(this._intervalId);
            }
        });
        webviewView.onDidChangeVisibility(async () => {
            if (webviewView.visible) {
                await this.checkForConfigFile(webviewView.webview);
            }
        });
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case "saveSettings":
                    let autoPush = data.autoPush;
                    let autoPull = data.autoPull;
                    this.updateConfigFile(autoPush, autoPull);
                    return;
                case "alert":
                    vscode.window.showInformationMessage(data.message);
                    return;
                case "log":
                    console.log(data.message);
                    return;
                case "init":
                    this.executeTerminalCommands();
                    return;
            }
        });
    }
    async readConfigFile() {
        try {
            const folderUri = vscode.workspace.workspaceFolders?.[0].uri.with({ path: `${vscode.workspace.workspaceFolders?.[0].uri.path}/.contenthook` });
            if (!folderUri) {
                throw new Error("Workspace folder not found.");
            }
            const fileUri = folderUri.with({ path: `${folderUri.path}/data.json` });
            const data = await vscode.workspace.fs.readFile(fileUri);
            return JSON.parse(Buffer.from(data).toString('utf8'));
        }
        catch (error) {
            return { autopush: false, autopull: false };
        }
    }
    async checkForConfigFile(webview) {
        const configFileData = await this.readConfigFile();
        const configFiles = await vscode.workspace.findFiles('**/contenthook.config.{js,ts,mjs,cjs}', '**/node_modules/**', 1);
        const htmlFile = configFiles.length > 0 ? 'settings.html' : 'index.html';
        webview.html = await this.getHtmlForWebview(webview, htmlFile);
        webview.postMessage({ type: 'configData', data: configFileData });
        if (htmlFile === 'index.html') {
            if (!this._intervalId) {
                this._intervalId = setInterval(async () => await this.checkForConfigFile(webview), 10000);
            }
        }
        else {
            if (this._intervalId) {
                clearInterval(this._intervalId);
                this._intervalId = undefined;
            }
        }
    }
    async updateConfigFile(autoPush, autoPull) {
        const folderUri = vscode.workspace.workspaceFolders?.[0].uri.with({ path: `${vscode.workspace.workspaceFolders?.[0].uri.path}/.contenthook` });
        if (!folderUri) {
            return;
        }
        const fileUri = folderUri.with({ path: `${folderUri.path}/data.json` });
        try {
            await vscode.workspace.fs.readDirectory(folderUri);
        }
        catch (error) {
            await vscode.workspace.fs.createDirectory(folderUri);
        }
        const data = JSON.stringify({ autopush: autoPush, autopull: autoPull }, null, 2);
        const dataBytes = Buffer.from(data, 'utf8');
        await vscode.workspace.fs.writeFile(fileUri, dataBytes);
    }
    async getHtmlForWebview(webview, htmlFileName) {
        const htmlPath = vscode.Uri.joinPath(this._extensionUri, "ui", htmlFileName);
        const htmlContent = await vscode.workspace.fs.readFile(htmlPath);
        let htmlString = Buffer.from(htmlContent).toString("utf8");
        return htmlString;
    }
    executeTerminalCommands() {
        const terminal = vscode.window.createTerminal(`Contenthook Setup`);
        terminal.show();
        terminal.sendText(`npm i @contenthook/cli -g --force`, true);
        terminal.sendText(`contenthook init`, true);
    }
}
exports.ContenthookViewProvider = ContenthookViewProvider;
//# sourceMappingURL=ContenthookViewProvider.js.map
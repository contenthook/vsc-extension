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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContenthookViewProvider = void 0;
require("dotenv/config");
const vscode = __importStar(require("vscode"));
const node_url_1 = require("node:url");
const path = __importStar(require("node:path"));
const gray_matter_1 = __importDefault(require("gray-matter"));
class ContenthookViewProvider {
    _extensionUri;
    _intervalId;
    _activeHtmlFile = "";
    constructor(_extensionUri) {
        this._extensionUri = _extensionUri;
        this.checkEnvVariableInConfigFile();
        this.setupFileSystemWatcher();
    }
    async getNonce() {
        let text = "";
        const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
    async resolveWebviewView(webviewView, context, _token) {
        const nonce = await this.getNonce();
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, "media")],
        };
        await this.checkForConfigFile(webviewView.webview, nonce);
        webviewView.onDidDispose(() => {
            if (this._intervalId) {
                clearInterval(this._intervalId);
            }
        });
        webviewView.onDidChangeVisibility(async () => {
            if (webviewView.visible) {
                await this.checkForConfigFile(webviewView.webview, nonce);
            }
        });
        vscode.window.onDidChangeActiveColorTheme(async () => {
            const htmlContent = await this.getHtmlForWebview(webviewView.webview, this._activeHtmlFile, nonce);
            webviewView.webview.postMessage({ command: "updateTheme", htmlContent });
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
    async checkEnvVariableInConfigFile() {
        const configFiles = await vscode.workspace.findFiles("**/contenthook.config.{js,ts,mjs,cjs}", "**/node_modules/**", 1);
        if (configFiles.length > 0) {
            const configFile = configFiles[0];
            let configFilePath = configFile.fsPath;
            const configPath = path.join(configFilePath);
            let configModule;
            try {
                configModule = await import(`${(0, node_url_1.pathToFileURL)(configPath)}`);
            }
            catch (error) {
                vscode.window.showErrorMessage(`Error: Failed to import config file.\n${error}`);
                return;
            }
            const config = configModule.default;
            if (config.apiKey?.env === "true") {
                if (vscode.workspace.getConfiguration().get("contenthook.apiKey")) {
                    return true;
                }
                else {
                    const action = await vscode.window.showInformationMessage("Your Contenthook API Key is not set. Click here to set it.", "Set API Key");
                    if (action === "Set API Key") {
                        vscode.window
                            .showInputBox({
                            prompt: "Please enter your Contenthook API Key",
                            placeHolder: "API Key",
                            ignoreFocusOut: true,
                        })
                            .then((apiKey) => {
                            if (apiKey) {
                                vscode.workspace
                                    .getConfiguration()
                                    .update("contenthook.apiKey", apiKey, vscode.ConfigurationTarget.Global);
                            }
                        });
                        return false;
                    }
                }
            }
        }
        else {
            return vscode.window.showErrorMessage("Contenthook config file not found.");
        }
    }
    onContentFileChanged = (uri) => {
        this.performYourFunction(uri);
    };
    setupFileSystemWatcher() {
        const watcher = vscode.workspace.createFileSystemWatcher("**/content/*.{md,mdx,markdown}");
        watcher.onDidChange(this.onContentFileChanged);
    }
    async readConfigFile() {
        try {
            const folderUri = vscode.workspace.workspaceFolders?.[0].uri.with({
                path: `${vscode.workspace.workspaceFolders?.[0].uri.path}/.contenthook`,
            });
            if (!folderUri) {
                throw new Error("Workspace folder not found.");
            }
            const fileUri = folderUri.with({ path: `${folderUri.path}/data.json` });
            const data = await vscode.workspace.fs.readFile(fileUri);
            return JSON.parse(Buffer.from(data).toString("utf8"));
        }
        catch (error) {
            return { autopush: false, autopull: false };
        }
    }
    async checkForConfigFile(webview, nonce) {
        const configFileData = await this.readConfigFile();
        const configFiles = await vscode.workspace.findFiles("**/contenthook.config.{js,ts,mjs,cjs}", "**/node_modules/**", 1);
        const htmlFile = configFiles.length > 0 ? "settings.html" : "index.html";
        this._activeHtmlFile = htmlFile;
        webview.html = await this.getHtmlForWebview(webview, htmlFile, nonce);
        webview.postMessage({ type: "configData", data: configFileData });
        if (htmlFile === "index.html") {
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
    async performYourFunction(uri) {
        const configFileData = await this.readConfigFile();
        if (configFileData.autopush) {
            const configFiles = await vscode.workspace.findFiles("**/contenthook.config.{js,ts,mjs,cjs}", "**/node_modules/**", 1);
            if (configFiles.length > 0) {
                const configFile = configFiles[0];
                let configFilePath = configFile.fsPath;
                const configPath = path.join(configFilePath);
                let configModule;
                try {
                    configModule = await import(`${(0, node_url_1.pathToFileURL)(configPath)}`);
                }
                catch (error) {
                    vscode.window.showErrorMessage(`Error: Failed to import config file.\n${error}`);
                    return;
                }
                const config = configModule.default;
                let contentMetaData;
                try {
                    const { ContentMetaData } = await import(`${(0, node_url_1.pathToFileURL)(configPath)}`);
                    contentMetaData = ContentMetaData;
                    if (!contentMetaData) {
                        vscode.window.showErrorMessage("ContentMetaData is not defined in the config file. Read more here: https://docs.contenthook.dev/config/ContentMetaData");
                    }
                }
                catch (error) {
                    vscode.window.showErrorMessage(`Error: Failed to import content file.\n${error}`);
                    return;
                }
                const apiKeyFromSettings = vscode.workspace
                    .getConfiguration()
                    .get("contenthook.apiKey");
                let apiKey = config.apiKey?.env === "true" ? apiKeyFromSettings : config.apiKey;
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Pushing contents to the Contenthook cloud...",
                    cancellable: false,
                }, async (progress) => {
                    const contents = await vscode.workspace.findFiles(`**/${config.contentPath.replace("./", "")}/*.{md,mdx,markdown}`, "**/node_modules/**");
                    if (contents.length > 0) {
                        const contentsData = contents.map(async (content) => {
                            let fileDataRaw = (await vscode.workspace.fs.readFile(content));
                            let buffer = Buffer.from(fileDataRaw);
                            const dataFromMatter = await (0, gray_matter_1.default)(buffer);
                            const fileData = dataFromMatter.content;
                            let metaData = dataFromMatter.data;
                            let file = content;
                            if (Object.keys(metaData).length === 0) {
                                const propertiesList = Object.entries(contentMetaData)
                                    .map(([key, value]) => {
                                    if (typeof value === "function") {
                                        return `${key}: ${value()}`;
                                    }
                                    else if (Array.isArray(value)) {
                                        return `${key}: ${value.join(", ")}`;
                                    }
                                    else {
                                        return `${key}: ${value}`;
                                    }
                                })
                                    .join(", ");
                                const message = `Metadata is missing in ${file}. Please add it. The following properties are required: \n\n ${propertiesList.length > 0
                                    ? propertiesList
                                    : "No metadata properties defined"}`;
                                vscode.window.showErrorMessage(message);
                                return;
                            }
                            let error = false;
                            for (let meta of Object.keys(metaData)) {
                                if (!contentMetaData.hasOwnProperty(meta)) {
                                    vscode.window.showErrorMessage(`Metadata property "${meta}" in file ${content.fsPath} is not defined in the ContentMetaData object in the config file. Please add it to the config and update all your contents, or remove it.`);
                                    error = true;
                                    break;
                                }
                                if (!metaData.hasOwnProperty(meta)) {
                                    vscode.window.showErrorMessage(`Metadata property "${meta}" is missing in ${file}. Please add it.`);
                                    error = true;
                                    break;
                                }
                                if (!contentMetaData.hasOwnProperty(meta)) {
                                    vscode.window.showErrorMessage(`Metadata property "${meta}" is not defined in the content (file: ${content.fsPath}) file. Please add it to the markdown file.`);
                                    error = true;
                                    break;
                                }
                                const expectedType = contentMetaData[meta];
                                const actualValue = metaData[meta];
                                if (expectedType === Date && !(actualValue instanceof Date)) {
                                    vscode.window.showErrorMessage(`Metadata property "${meta}" should be a Date in ${file}. Please correct it.`);
                                    error = true;
                                    break;
                                }
                                if (expectedType instanceof Array &&
                                    !(actualValue instanceof Array)) {
                                    vscode.window.showErrorMessage(`Metadata property "${meta}" should be an Array in ${file}. Please correct it.`);
                                    error = true;
                                    break;
                                }
                                if (expectedType !== Date &&
                                    !Array.isArray(expectedType) &&
                                    typeof actualValue !== expectedType.name.toLowerCase()) {
                                    vscode.window.showErrorMessage(`Metadata property "${meta}" should be a ${expectedType.name.toLowerCase()} in ${file}. Please correct it.`);
                                    error = true;
                                    break;
                                }
                                if (expectedType instanceof Array) {
                                    for (let value of actualValue) {
                                        if (typeof value !== expectedType[0].name.toLowerCase()) {
                                            vscode.window.showErrorMessage(`Metadata property "${meta}" should be an Array of ${expectedType[0].name.toLowerCase()} in ${file}. Please correct it.`);
                                            error = true;
                                            break;
                                        }
                                    }
                                }
                                if (error) {
                                    break;
                                }
                            }
                            if (error) {
                                process.exit(1);
                            }
                            let _fileContent;
                            _fileContent = dataFromMatter.content
                                .replace(/\\/g, "\\\\")
                                .replace(/\n/g, "\\n")
                                .replace(/\r/g, "\\r")
                                .replace(/\t/g, "\\t")
                                .replace(/"/g, '\\"')
                                .replace(/'/g, "\\'");
                            const data = {
                                key: apiKey,
                                content: _fileContent,
                                fileName: path.basename(content.fsPath),
                                metadata: metaData,
                            };
                            const response = await fetch(`https://api.contenthook.dev/v1/content/update`, {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                },
                                body: JSON.stringify(data),
                            }).then((res) => res.json());
                            return response;
                        });
                        class Response {
                            code;
                            message;
                            errors;
                        }
                        const response = (await Promise.all(contentsData));
                        if (response[0]?.errors && response[0]?.errors[0]?.code === 403) {
                            vscode.window.showErrorMessage("Invalid Project API Key. Please check your API Key in the Contenthook extension settings.");
                            return;
                        }
                        if (response.every((res) => res?.code === 200)) {
                            vscode.window.showInformationMessage("Contents pushed successfully.");
                        }
                        else {
                            vscode.window.showErrorMessage("Some contents failed to push.");
                        }
                    }
                    else {
                        vscode.window.showErrorMessage("No content file found.");
                    }
                });
            }
        }
    }
    async updateConfigFile(autoPush, autoPull) {
        const folderUri = vscode.workspace.workspaceFolders?.[0].uri.with({
            path: `${vscode.workspace.workspaceFolders?.[0].uri.path}/.contenthook`,
        });
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
        const dataBytes = Buffer.from(data, "utf8");
        await vscode.workspace.fs.writeFile(fileUri, dataBytes);
    }
    async getHtmlForWebview(webview, htmlFileName, nonce) {
        try {
            const themeKind = vscode.window.activeColorTheme.kind;
            const themeHtmlFile = (await themeKind) === vscode.ColorThemeKind.Dark
                ? `${htmlFileName.replace(".html", "")}-dark.html`
                : `${htmlFileName.replace(".html", "")}-light.html`;
            const htmlPath = vscode.Uri.joinPath(this._extensionUri, "src", "ui", themeHtmlFile);
            const htmlContent = await vscode.workspace.fs.readFile(htmlPath);
            let htmlString = Buffer.from(htmlContent).toString("utf8");
            htmlString = htmlString
                .replace(/%nonce%/g, nonce ? `${nonce}` : "")
                .replace('nonce="%nonce%"', nonce ? `nonce='${nonce}'` : "");
            return htmlString;
        }
        catch (error) {
            let errorId = Math.random().toString(36);
            return `<h1>Error! Please report to the extension developers and maintainers!</h1>
<div>
  <pre><code>${error}</code></pre>
</div>
\n\n<p>Error ID: ${errorId}</p>`;
        }
    }
    executeTerminalCommands() {
        const terminal = vscode.window.createTerminal(`Contenthook Setup`);
        terminal.show();
        terminal.sendText(`npm i @contenthook/cli -g --force`, true);
        terminal.sendText(`contenthook init`, true);
    }
}
exports.ContenthookViewProvider = ContenthookViewProvider;
//# sourceMappingURL=view.js.map
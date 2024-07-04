import "dotenv/config";
import * as vscode from "vscode";
import { pathToFileURL } from "node:url";
import * as path from "node:path";
import matter from "gray-matter";
import WebSocket from "ws";

let customId;
let pulling: boolean;

export class ContenthookViewProvider implements vscode.WebviewViewProvider {
  private _intervalId?: NodeJS.Timeout;
  private _activeHtmlFile: string = "";

  constructor(private readonly _extensionUri: vscode.Uri) {
    vscode.window.showInformationMessage("Contenthook loading...");
    this.checkEnvVariableInConfigFile();
    this.connectToWebserver();
    this.setupFileSystemWatcher();
  }

  private async getNonce() {
    let text = "";
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  private async createClientId({ length = 6 } = {}) {
    const possible = "123456789";
    let clientId = "";
    for (let i = 0; i < length; i++) {
      clientId += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return clientId;
  }

  private async connectToWebserver() {
    const config = await this.readConfigFile();
    if (config.autopull === false) {
      return;
    }

    const apiKeyFromSettings = vscode.workspace
      .getConfiguration()
      .get<string>("contenthook.apiKey");

    if (!apiKeyFromSettings) {
      return;
    }

    customId = await this.createClientId({ length: 64 });

    await fetch("https://api.contenthook.dev/v1/websocket/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apiKey: apiKeyFromSettings,
        clientId: customId,
      }),
    });

    let webserver = "wss://api.contenthook.dev/v1/websocket?id=" + customId;
    let ws = new WebSocket(webserver);

    ws.onopen = () => {
      console.log("Connected to the webserver.");
    };

    ws.onmessage = async (event: any) => {
      const config = await this.readConfigFile();
      const handle = async (event: any) => {
        pulling = true;
        const configFileData = await this.readConfigFile();

        if (configFileData.autopull) {
          const configFiles = await vscode.workspace.findFiles(
            "**/contenthook.config.{js,ts,mjs,cjs}",
            "**/node_modules/**",
            1,
          );

          if (configFiles.length > 0) {
            const configFile = configFiles[0];
            let configFilePath = configFile.fsPath;

            const configPath = path.join(configFilePath);
            let configModule;
            try {
              configModule = await import(`${pathToFileURL(configPath)}`);
            } catch (error) {
              return vscode.window.showErrorMessage(
                `Error: Failed to import config file.\n${error}`,
              );
            }

            const config = configModule.default;

            class Response {
              code: number | undefined;
              message: string | undefined;
              data: any;
              errors: any;
            }

            const response = (await fetch(
              `https://api.contenthook.dev/v1/content/all`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ key: apiKeyFromSettings }),
              },
            ).then((res) => res.json())) as Response;

            if (response?.errors && response?.errors[0]?.code === 403) {
              return vscode.window.showErrorMessage(
                "Invalid Project API Key. Please check your API Key in the Contenthook extension settings.",
              );
            }

            if (
              vscode.workspace.workspaceFolders &&
              vscode.workspace.workspaceFolders.length > 0
            ) {
              const workspaceFolderPath =
                vscode.workspace.workspaceFolders[0].uri.fsPath;
              const _contentsFolder = path.join(
                workspaceFolderPath,
                config.contentPath.replace("./", ""),
              );

              response.data.forEach(
                async (content: {
                  title: string;
                  metadata: any;
                  markdown: string;
                }) => {
                  if (!_contentsFolder) {
                    return;
                  }
                  const filePath = path.join(_contentsFolder, content.title);

                  let frontMatter = "---\n";
                  Object.entries(content.metadata).forEach(([key, value]) => {
                    if (Array.isArray(value)) {
                      frontMatter += `${key}: [${value.map((v) => `"${v}"`).join(", ")}]\n`;
                    } else if (
                      typeof value === "string" &&
                      value.match(
                        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
                      )
                    ) {
                      const formattedDate = value.split("T")[0];
                      frontMatter += `${key}: ${formattedDate}\n`;
                    } else {
                      frontMatter += `${key}: ${value}\n`;
                    }
                  });
                  frontMatter += "---\n";

                  let fileData = frontMatter + content.markdown;

                  fileData = fileData
                    .replace(/\\\\/g, "\\")
                    .replace(/\\n/g, "\n")
                    .replace(/\\r/g, "\r")
                    .replace(/\\t/g, "\t")
                    .replace(/\\"/g, '"')
                    .replace(/\\'/g, "'");

                  const uri = vscode.Uri.file(filePath);

                  const fileExists = await vscode.workspace.fs.stat(uri).then(
                    () => true,
                    () => false,
                  );

                  if (fileExists) {
                    const fileDataRaw = Buffer.from(fileData, "utf8");
                    await vscode.workspace.fs.writeFile(uri, fileDataRaw);
                  } else {
                    const fileDataRaw = Buffer.from(fileData, "utf8");
                    await vscode.workspace.fs.writeFile(uri, fileDataRaw);
                  }
                },
              );
            } else {
              return vscode.window.showErrorMessage(
                "No workspace folder found.",
              );
            }

            pulling = false;
            return vscode.window.showInformationMessage(
              "Contents pulled successfully.",
            );
          }
        }
      };

      if (config.autopull === false) {
        return;
      }
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Pulling contents from the Contenthook cloud...",
          cancellable: false,
        },
        async (progress) => {
          try {
            await handle(event);
            progress.report({ increment: 100 });
          } catch (error) {
            console.error("Error during content pull:", error);
            vscode.window.showErrorMessage(
              "Failed to pull contents from the Contenthook cloud.",
            );
          }
        },
      );
    };
  }

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
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
      const htmlContent = await this.getHtmlForWebview(
        webviewView.webview,
        this._activeHtmlFile,
        nonce,
      );
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

  private async checkEnvVariableInConfigFile() {
    const configFiles = await vscode.workspace.findFiles(
      "**/contenthook.config.{js,ts,mjs,cjs}",
      "**/node_modules/**",
      1,
    );

    if (configFiles.length > 0) {
      const configFile = configFiles[0];
      let configFilePath = configFile.fsPath;

      const configPath = path.join(configFilePath);
      let configModule;
      try {
        configModule = await import(`${pathToFileURL(configPath)}`);
      } catch (error) {
        return vscode.window.showErrorMessage(
          `Error: Failed to import config file.\n${error}`,
        );
      }

      const config = configModule.default;
      if (config.apiKey?.env === "true") {
        if (
          vscode.workspace.getConfiguration().get<string>("contenthook.apiKey")
        ) {
          return true;
        } else {
          const action = await vscode.window.showInformationMessage(
            "Your Contenthook API Key is not set. Click here to set it.",
            "Set API Key",
          );
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
                    .update(
                      "contenthook.apiKey",
                      apiKey,
                      vscode.ConfigurationTarget.Global,
                    );
                }
              });
            return false;
          }
        }
      }
    } else {
      return vscode.window.showErrorMessage(
        "Contenthook config file not found.",
      );
    }
  }

  private onContentFileChanged = (uri: vscode.Uri) => {
    this.contentFileCHanged(uri);
  };

  private setupFileSystemWatcher() {
    const watcher = vscode.workspace.createFileSystemWatcher(
      "**/content/*.{md,mdx,markdown}",
    );

    watcher.onDidChange(this.onContentFileChanged);
  }

  private async readConfigFile(): Promise<{
    autopush: boolean;
    autopull: boolean;
  }> {
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
    } catch (error) {
      return { autopush: false, autopull: false };
    }
  }

  private async checkForConfigFile(webview: vscode.Webview, nonce?: string) {
    const configFileData = await this.readConfigFile();

    const configFiles = await vscode.workspace.findFiles(
      "**/contenthook.config.{js,ts,mjs,cjs}",
      "**/node_modules/**",
      1,
    );
    const htmlFile = configFiles.length > 0 ? "settings.html" : "index.html";
    this._activeHtmlFile = htmlFile;

    webview.html = await this.getHtmlForWebview(webview, htmlFile, nonce);
    webview.postMessage({ type: "configData", data: configFileData });

    if (htmlFile === "index.html") {
      if (!this._intervalId) {
        this._intervalId = setInterval(
          async () => await this.checkForConfigFile(webview),
          10000,
        );
      }
    } else {
      if (this._intervalId) {
        clearInterval(this._intervalId);
        this._intervalId = undefined;
      }
    }
  }

  private async contentFileCHanged(uri: vscode.Uri) {
    if (pulling) {
      return null;
    }
    const configFileData = await this.readConfigFile();

    if (configFileData.autopush) {
      const configFiles = await vscode.workspace.findFiles(
        "**/contenthook.config.{js,ts,mjs,cjs}",
        "**/node_modules/**",
        1,
      );

      if (configFiles.length > 0) {
        const configFile = configFiles[0];
        let configFilePath = configFile.fsPath;

        const configPath = path.join(configFilePath);
        let configModule;
        try {
          configModule = await import(`${pathToFileURL(configPath)}`);
        } catch (error) {
          return vscode.window.showErrorMessage(
            `Error: Failed to import config file.\n${error}`,
          );
        }

        const config = configModule.default;

        let contentMetaData;
        try {
          const { ContentMetaData } = await import(
            `${pathToFileURL(configPath)}`
          );
          contentMetaData = ContentMetaData;
          if (!contentMetaData) {
            return vscode.window.showErrorMessage(
              "ContentMetaData is not defined in the config file. Read more here: https://docs.contenthook.dev/config/ContentMetaData",
            );
          }
        } catch (error) {
          return vscode.window.showErrorMessage(
            `Error: Failed to import content file.\n${error}`,
          );
        }

        const apiKeyFromSettings = vscode.workspace
          .getConfiguration()
          .get<string>("contenthook.apiKey");
        let apiKey =
          config.apiKey?.env === "true" ? apiKeyFromSettings : config.apiKey;

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Pushing contents to the Contenthook cloud...",
            cancellable: false,
          },
          async (progress) => {
            try {
              const contents = await vscode.workspace.findFiles(
                `**/${config.contentPath.replace("./", "")}/*.{md,mdx,markdown}`,
                "**/node_modules/**",
              );
              if (contents.length > 0) {
                const contentsData = contents.map(async (content) => {
                  let fileDataRaw = (await vscode.workspace.fs.readFile(
                    content,
                  )) as Uint8Array;

                  let buffer = Buffer.from(fileDataRaw);

                  const dataFromMatter = await matter(buffer);
                  const fileData = dataFromMatter.content;
                  let metaData = dataFromMatter.data;
                  let file = content;

                  if (Object.keys(metaData).length === 0) {
                    const propertiesList = Object.entries(contentMetaData)
                      .map(([key, value]) => {
                        if (typeof value === "function") {
                          return `${key}: ${value()}`;
                        } else if (Array.isArray(value)) {
                          return `${key}: ${value.join(", ")}`;
                        } else {
                          return `${key}: ${value}`;
                        }
                      })
                      .join(", ");

                    const message = `Metadata is missing in ${file}. Please add it. The following properties are required: \n\n ${
                      propertiesList.length > 0
                        ? propertiesList
                        : "No metadata properties defined"
                    }`;

                    return vscode.window.showErrorMessage(message);
                  }

                  let error = false;
                  for (let meta of Object.keys(metaData)) {
                    if (!contentMetaData.hasOwnProperty(meta)) {
                      vscode.window.showErrorMessage(
                        `Metadata property "${meta}" in file ${content.fsPath} is not defined in the ContentMetaData object in the config file. Please add it to the config and update all your contents, or remove it.`,
                      );
                      error = true;
                      break;
                    }

                    if (!metaData.hasOwnProperty(meta)) {
                      vscode.window.showErrorMessage(
                        `Metadata property "${meta}" is missing in ${file}. Please add it.`,
                      );
                      error = true;
                      break;
                    }

                    if (!contentMetaData.hasOwnProperty(meta)) {
                      vscode.window.showErrorMessage(
                        `Metadata property "${meta}" is not defined in the content (file: ${content.fsPath}) file. Please add it to the markdown file.`,
                      );
                      error = true;
                      break;
                    }

                    const expectedType = contentMetaData[meta];
                    const actualValue = metaData[meta];

                    if (
                      expectedType === Date &&
                      !(actualValue instanceof Date)
                    ) {
                      vscode.window.showErrorMessage(
                        `Metadata property "${meta}" should be a Date in ${file}. Please correct it.`,
                      );
                      error = true;
                      break;
                    }

                    if (
                      expectedType instanceof Array &&
                      !(actualValue instanceof Array)
                    ) {
                      vscode.window.showErrorMessage(
                        `Metadata property "${meta}" should be an Array in ${file}. Please correct it.`,
                      );
                      error = true;
                      break;
                    }

                    if (
                      expectedType !== Date &&
                      !Array.isArray(expectedType) &&
                      typeof actualValue !== expectedType.name.toLowerCase()
                    ) {
                      vscode.window.showErrorMessage(
                        `Metadata property "${meta}" should be a ${expectedType.name.toLowerCase()} in ${file}. Please correct it.`,
                      );
                      error = true;
                      break;
                    }

                    if (expectedType instanceof Array) {
                      for (let value of actualValue) {
                        if (
                          typeof value !== expectedType[0].name.toLowerCase()
                        ) {
                          vscode.window.showErrorMessage(
                            `Metadata property "${meta}" should be an Array of ${expectedType[0].name.toLowerCase()} in ${file}. Please correct it.`,
                          );
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

                  const response = await fetch(
                    `https://api.contenthook.dev/v1/content/update/exte`,
                    {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify(data),
                    },
                  ).then((res) => res.json());

                  return response;
                });

                class Response {
                  code: number | undefined;
                  message: string | undefined;
                  errors: any;
                }

                const response = (await Promise.all(
                  contentsData,
                )) as Response[];

                if (
                  response[0]?.errors &&
                  response[0]?.errors[0]?.code === 403
                ) {
                  return vscode.window.showErrorMessage(
                    "Invalid Project API Key. Please check your API Key in the Contenthook extension settings.",
                  );
                }

                progress.report({ increment: 100 });

                if (response.every((res) => res?.code === 200)) {
                  return vscode.window.showInformationMessage(
                    "Contents pushed successfully.",
                  );
                } else {
                  return vscode.window.showErrorMessage(
                    "Some contents failed to push.",
                  );
                }
              } else {
                return vscode.window.showErrorMessage("No content file found.");
              }
            } catch (error) {
              console.error("Error during content push:", error);
              vscode.window.showErrorMessage(
                "Failed to push contents to the Contenthook cloud.",
              );
            }
          },
        );
      }
    }
  }

  private async updateConfigFile(autoPush: boolean, autoPull: boolean) {
    const folderUri = vscode.workspace.workspaceFolders?.[0].uri.with({
      path: `${vscode.workspace.workspaceFolders?.[0].uri.path}/.contenthook`,
    });

    if (!folderUri) {
      return;
    }

    const fileUri = folderUri.with({ path: `${folderUri.path}/data.json` });

    try {
      await vscode.workspace.fs.readDirectory(folderUri);
    } catch (error) {
      await vscode.workspace.fs.createDirectory(folderUri);
    }

    const data = JSON.stringify(
      { autopush: autoPush, autopull: autoPull },
      null,
      2,
    );
    const dataBytes = Buffer.from(data, "utf8");

    await vscode.workspace.fs.writeFile(fileUri, dataBytes);
  }

  private async getHtml(webview: vscode.Webview, htmlFileName: string) {
    vscode.window.showInformationMessage("Getting HTML...");
    const settingsLight = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource} https://cdn.jsdelivr.net https://www.contenthook.dev; script-src 'nonce-%nonce%' 'self'; img-src https://www.contenthook.dev;"
    />
    <title>Contenthook</title>
    <link
      href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css"
      rel="stylesheet"
    />
  </head>
  <body id="body" class="select-none bg-gray-100">
    <div
      id="main-container"
      class="p-2 max-w-full flex flex-col items-center justify-center"
    >
      <div
        id="logo-container"
        class="flex flex-row mt-6 items-center justify-center w-full"
      >
        <img
          id="logo-img"
          src="https://www.contenthook.dev/img/logo_invert.png"
          alt="Contenthook"
          draggable="false"
          class="w-12 h-12"
        />
        <div id="logo-text" class="text-xl font-medium text-gray-800">
          Contenthook
        </div>
      </div>

      <p id="intro-text" class="text-gray-800 mt-8 text-center">
        Edit some extra feature settings for your Contenthook project.
      </p>

      <div
        id="settings-container"
        class="flex flex-col mt-8 gap-4 items-center justify-center w-full"
      >
        <div
          id="settings-row"
          class="flex flex-row items-center justify-between w-full"
        >
          <label
            for="auto-push"
            id="label-text"
            class="text-gray-800 text-center"
          >
            Auto-push changes to the Cloud
          </label>
          <input
            type="checkbox"
            id="auto-push"
            class="form-checkbox h-5 w-5 text-blue-400"
          />
        </div>
        <div
          id="settings-row"
          class="flex flex-row items-center justify-between w-full"
        >
          <label
            for="auto-pull"
            id="label-text"
            class="text-gray-800 text-center"
          >
            Auto-pull changes from the Cloud
          </label>
          <input
            type="checkbox"
            id="auto-pull"
            class="form-checkbox h-5 w-5 text-blue-400"
          />
        </div>
      </div>

      <div
        id="action-container"
        class="flex flex-col mt-8 gap-4 items-center justify-center w-full"
        style="align-items: center; justify-content: center"
      >
        <button
          id="save-btn"
          class="bg-gradient-to-br cursor-pointer text-center from-blue-400 to-blue-500 hover:opacity-90 w-full text-gray-800 font-bold py-1 px-4 rounded-sm"
        >
          Save settings
        </button>
      </div>
    </div>

    <script nonce="%nonce%">
      const vscode = acquireVsCodeApi();

      let autoPush = document.getElementById("auto-push").checked;
      let autoPull = document.getElementById("auto-pull").checked;

      document.getElementById("auto-push").addEventListener("change", () => {
        autoPush = document.getElementById("auto-push").checked;
      });

      document.getElementById("auto-pull").addEventListener("change", () => {
        autoPull = document.getElementById("auto-pull").checked;
      });

      document.getElementById("save-btn").addEventListener("click", () => {
        vscode.postMessage({
          type: "saveSettings",
          message: "Settings saved",
          autoPush: autoPush,
          autoPull: autoPull,
        });
      });

      window.addEventListener("message", (event) => {
        const message = event.data;
        switch (message.type) {
          case "configData":
            const { autopush, autopull } = message.data;
            document.getElementById("auto-push").checked = autopush;
            document.getElementById("auto-pull").checked = autopull;
            break;
        }
      });
    </script>

    <script nonce="%nonce%">
      window.addEventListener("message", (event) => {
        const message = event.data;
        switch (message.command) {
          case "updateTheme":
            document.documentElement.innerHTML = message.htmlContent;
            break;
        }
      });
    </script>
  </body>
</html>`;
    const settingsDark = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource} https://cdn.jsdelivr.net https://www.contenthook.dev; script-src 'nonce-%nonce%' 'self'; img-src https://www.contenthook.dev;"
    />
    <title>Contenthook</title>
    <link
      href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css"
      rel="stylesheet"
    />
  </head>
  <body id="body" class="select-none">
    <div
      id="main-container"
      class="p-2 max-w-full mx-auto rounded-xl flex flex-col items-center justify-center"
    >
      <div
        id="logo-container"
        class="flex flex-row mt-6 items-center justify-center w-full"
      >
        <img
          id="logo-img"
          src="https://www.contenthook.dev/img/logo.png"
          alt="Contenthook"
          draggable="false"
          class="w-12 h-12"
        />
        <div id="logo-text" class="text-xl font-medium text-white">
          Contenthook
        </div>
      </div>

      <p id="intro-text" class="text-white mt-8 text-center">
        Edit some extra feature settings for your Contenthook project.
      </p>

      <div
        id="settings-container"
        class="flex flex-col mt-8 gap-4 items-center justify-center w-full"
      >
        <div
          id="settings-row"
          class="flex flex-row items-center justify-between w-full"
        >
          <label for="auto-push" id="label-text" class="text-white text-center">
            Auto-push changes to the Cloud
          </label>
          <input
            type="checkbox"
            id="auto-push"
            class="form-checkbox h-5 w-5 text-blue-600"
          />
        </div>
        <div
          id="settings-row"
          class="flex flex-row items-center justify-between w-full"
        >
          <label for="auto-pull" id="label-text" class="text-white text-center">
            Auto-pull changes from the Cloud
          </label>
          <input
            type="checkbox"
            id="auto-pull"
            class="form-checkbox h-5 w-5 text-blue-600"
          />
        </div>
      </div>

      <div
        id="action-container"
        class="flex flex-col mt-8 gap-4 items-center justify-center w-full"
        style="align-items: center; justify-content: center"
      >
        <button
          id="save-btn"
          class="bg-gradient-to-br cursor-pointer text-center from-blue-500 to-blue-600 hover:opacity-90 w-full text-white font-bold py-1 px-4 rounded-sm"
        >
          Save settings
        </button>
      </div>
    </div>

    <script nonce="%nonce%">
      const vscode = acquireVsCodeApi();

      let autoPush = document.getElementById("auto-push").checked;
      let autoPull = document.getElementById("auto-pull").checked;

      document.getElementById("auto-push").addEventListener("change", () => {
        autoPush = document.getElementById("auto-push").checked;
      });

      document.getElementById("auto-pull").addEventListener("change", () => {
        autoPull = document.getElementById("auto-pull").checked;
      });

      document.getElementById("save-btn").addEventListener("click", () => {
        vscode.postMessage({
          type: "saveSettings",
          message: "Settings saved",
          autoPush: autoPush,
          autoPull: autoPull,
        });
      });

      window.addEventListener("message", (event) => {
        const message = event.data;
        switch (message.type) {
          case "configData":
            const { autopush, autopull } = message.data;
            document.getElementById("auto-push").checked = autopush;
            document.getElementById("auto-pull").checked = autopull;
            break;
        }
      });
    </script>

    <script nonce="%nonce%">
      window.addEventListener("message", (event) => {
        const message = event.data;
        switch (message.command) {
          case "updateTheme":
            document.documentElement.innerHTML = message.htmlContent;
            break;
        }
      });
    </script>
  </body>
</html>`;
    const indexLight = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource} https://cdn.jsdelivr.net https://www.contenthook.dev; script-src 'nonce-%nonce%' 'self'; img-src https://www.contenthook.dev;"
    />
    <title>Contenthook</title>
    <link
      href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css"
      rel="stylesheet"
    />
  </head>
  <body id="body" class="select-none">
    <div
      id="main-container"
      class="p-2 max-w-full mx-auto flex flex-col items-center justify-center"
    >
      <div
        id="logo-container"
        class="flex flex-row mt-6 items-center justify-center w-full"
      >
        <img
          id="logo-img"
          class="w-12 h-12"
          src="https://www.contenthook.dev/img/logo_invert.png"
          alt="Contenthook"
          draggable="false"
        />
        <div id="logo-text" class="text-xl font-medium text-gray-800">
          Contenthook
        </div>
      </div>

      <p id="intro-text" class="text-gray-800 mt-8 text-center">
        Initialize a new Contenthook project or open one that already exists.
      </p>

      <div
        id="action-container"
        class="flex flex-col mt-8 gap-4 items-center justify-center w-full"
      >
        <button
          id="init-btn"
          class="bg-gradient-to-br cursor-pointer text-center from-blue-400 to-blue-500 hover:opacity-90 w-full text-gray-800 font-bold py-1 px-4 rounded-sm"
        >
          Initialize new project
        </button>
        <p id="open-instruction" class="text-center text-gray-800">
          to open an existing project, click on the "File" and then "Open
          Folder" button in the top left corner. Select the folder where your
          project is located.
        </p>
      </div>
    </div>

    <script nonce="%nonce%">
      const vscode = acquireVsCodeApi();

      document.getElementById("init-btn").addEventListener("click", () => {
        vscode.postMessage({
          type: "init",
          message: "Initialization started",
        });
      });
    </script>

    <script nonce="%nonce%">
      window.addEventListener("message", (event) => {
        const message = event.data;
        switch (message.command) {
          case "updateTheme":
            document.documentElement.innerHTML = message.htmlContent;
            break;
        }
      });
    </script>
  </body>
</html>`;
    const indexDark = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource} https://cdn.jsdelivr.net https://www.contenthook.dev; script-src 'nonce-%nonce%' 'self'; img-src https://www.contenthook.dev;"
    />
    <title>Contenthook</title>
    <link
      href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css"
      rel="stylesheet"
    />
  </head>
  <body id="body" class="select-none">
    <div
      id="main-container"
      class="p-2 max-w-full mx-auto rounded-xl flex flex-col items-center justify-center"
    >
      <div
        id="logo-container"
        class="flex flex-row mt-6 items-center justify-center w-full"
      >
        <img
          id="logo-img"
          src="https://www.contenthook.dev/img/logo.png"
          alt="Contenthook"
          draggable="false"
          class="w-12 h-12"
        />
        <div id="logo-text" class="text-xl font-medium text-white">
          Contenthook
        </div>
      </div>

      <p id="intro-text" class="text-white mt-8 text-center">
        Initialize a new Contenthook project or open one that already exists.
      </p>

      <div
        id="action-container"
        class="flex flex-col mt-6 gap-2 items-center justify-center w-full"
      >
        <button
          id="init-btn"
          class="bg-gradient-to-br cursor-pointer text-center from-blue-500 to-blue-600 hover:opacity-90 w-full text-white font-bold py-1 px-4 rounded-sm"
        >
          Initialize new project
        </button>
        <p id="open-instruction" class="text-center text-zinc-800">
          to open an existing project, click on the "File" and then "Open
          Folder" button in the top left corner. Select the folder where your
          project is located.
        </p>
      </div>
    </div>

    <script nonce="%nonce%">
      const vscode = acquireVsCodeApi();

      document.getElementById("init-btn").addEventListener("click", () => {
        vscode.postMessage({
          type: "init",
          message: "Initialization started",
        });
      });
    </script>

    <script nonce="%nonce%">
      window.addEventListener("message", (event) => {
        const message = event.data;
        switch (message.command) {
          case "updateTheme":
            document.documentElement.innerHTML = message.htmlContent;
            break;
        }
      });
    </script>
  </body>
</html>`;

    switch (htmlFileName) {
      case "settings-light.html":
        return settingsLight;
      case "settings-dark.html":
        return settingsDark;
      case "index-light.html":
        return indexLight;
      case "index-dark.html":
        return indexDark;
      default:
        return "";
    }
  }

  private async getHtmlForWebview(
    webview: vscode.Webview,
    htmlFileName: string,
    nonce?: string,
  ): Promise<string> {
    try {
      const themeKind = vscode.window.activeColorTheme.kind;

      const themeHtmlFile =
        (await themeKind) === vscode.ColorThemeKind.Dark
          ? `${htmlFileName.replace(".html", "")}-dark.html`
          : `${htmlFileName.replace(".html", "")}-light.html`;

      let htmlString = await this.getHtml(webview, themeHtmlFile);

      htmlString = htmlString
        .replace(/%nonce%/g, nonce ? `${nonce}` : "")
        .replace('nonce="%nonce%"', nonce ? `nonce='${nonce}'` : "");

      return htmlString;
    } catch (error) {
      let errorId = Math.random().toString(36);
      return `<h1>Error! Please report to the extension developers and maintainers!</h1>
<div>
  <pre><code>${error}</code></pre>
</div>
\n\n<p>Error ID: ${errorId}</p>`;
    }
  }

  private executeTerminalCommands() {
    const terminal = vscode.window.createTerminal(`Contenthook Setup`);
    terminal.show();
    terminal.sendText(`npm i @contenthook/cli -g --force`, true);
    terminal.sendText(`contenthook init`, true);
  }
}

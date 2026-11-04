import * as vscode from "vscode";
import type { BedrockAuthMode } from "../bedrock/authResolver";
import {
  DEFAULT_REGION,
  SECRET_ACCESS_KEY_ID,
  SECRET_KEY_NAME,
  SECRET_SECRET_ACCESS_KEY,
  SECRET_SESSION_TOKEN,
  getAuthMode,
  getBedrockModelConfig,
  loadStoredAccessKeys,
  resolveBedrockApiKey
} from "../config/bedrock";
import { maskApiKey } from "../config/env";
import {
  SECRET_OPENAI_API_KEY,
  getProviderId,
  readOpenAIBaseUrl,
  readOpenAIModel,
  resolveOpenAIApiKey
} from "../config/providers";
import { BEDROCK_MODEL_SUGGESTIONS, OPENAI_MODEL_SUGGESTIONS, OPENAI_PRESETS } from "../providers/catalog";
import { ProviderConfigurationError } from "../providers/errors";
import { createModelSession } from "../providers/providerFactory";
import { isLocalBaseUrl } from "../providers/openaiChat";
import { probeOpenAIModels } from "../providers/openaiCompatibleProvider";
import type { ProviderId } from "../providers/types";

type SetupForm = {
  provider: ProviderId;
  authMode: Exclude<BedrockAuthMode, "auto">;
  region: string;
  modelId: string;
  awsProfile: string;
  apiKey: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiModel: string;
};

type SetupMessage =
  | { type: "ready" }
  | { type: "save"; form: SetupForm; test: boolean }
  | { type: "clearSecrets" }
  | { type: "openChat" }
  | { type: "detect9Router" };

const REGION_SUGGESTIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "ap-south-1",
  "eu-central-1",
  "eu-west-1"
];

/**
 * First-run / settings screen for Bedrock and OpenAI-compatible endpoints.
 * Secrets go to VS Code SecretStorage; everything else to user settings.
 */
export class SetupPanel {
  private static current: SetupPanel | undefined;

  static show(context: vscode.ExtensionContext, output: vscode.OutputChannel) {
    if (SetupPanel.current) {
      SetupPanel.current.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel("safegraph.setup", "Safegraph AI Setup", vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: []
    });
    SetupPanel.current = new SetupPanel(panel, context, output);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel
  ) {
    panel.webview.html = renderHtml(panel.webview);
    panel.onDidDispose(() => {
      SetupPanel.current = undefined;
    });
    panel.webview.onDidReceiveMessage((msg: SetupMessage) => {
      this.handle(msg).catch((e) => {
        this.output.appendLine(`[safegraph-ai] setup error: ${String(e)}`);
        this.post({ type: "status", ok: false, text: String(e instanceof Error ? e.message : e) });
      });
    });
  }

  private post(message: unknown) {
    void this.panel.webview.postMessage(message);
  }

  private async handle(msg: SetupMessage) {
    if (msg.type === "ready") {
      this.post({ type: "state", state: await this.currentState() });
      return;
    }
    if (msg.type === "openChat") {
      await vscode.commands.executeCommand("safegraph.openChat");
      return;
    }
    if (msg.type === "clearSecrets") {
      for (const key of [
        SECRET_KEY_NAME,
        SECRET_ACCESS_KEY_ID,
        SECRET_SECRET_ACCESS_KEY,
        SECRET_SESSION_TOKEN,
        SECRET_OPENAI_API_KEY
      ]) {
        await this.context.secrets.delete(key);
      }
      this.output.appendLine("[safegraph-ai] stored credentials cleared");
      this.post({ type: "state", state: await this.currentState() });
      this.post({ type: "status", ok: true, text: "Stored credentials removed." });
      return;
    }
    if (msg.type === "detect9Router") {
      await this.detectNineRouter();
      return;
    }
    if (msg.type === "save") {
      const error = await this.save(msg.form);
      if (error) {
        this.post({ type: "status", ok: false, text: error });
        return;
      }
      this.post({ type: "state", state: await this.currentState() });
      if (!msg.test) {
        this.post({ type: "status", ok: true, text: "Saved." });
        return;
      }
      const provider = msg.form.provider === "openai-compatible" ? "the OpenAI-compatible endpoint" : "Amazon Bedrock";
      this.post({ type: "status", ok: true, pending: true, text: `Saved. Testing connection to ${provider}...` });
      const result = await this.testConnection();
      this.post({ type: "status", ...result });
    }
  }

  private async currentState() {
    const { region, modelId } = getBedrockModelConfig();
    const apiKey = await resolveBedrockApiKey(this.context);
    const openaiKey = await resolveOpenAIApiKey(this.context);
    const accessKeys = await loadStoredAccessKeys(this.context);
    const mode = getAuthMode();
    const authMode: SetupForm["authMode"] =
      mode !== "auto" ? mode : apiKey ? "bearer-token" : accessKeys ? "access-keys" : "bearer-token";
    return {
      provider: getProviderId(),
      authMode,
      region,
      modelId,
      awsProfile: vscode.workspace.getConfiguration("safegraph").get<string>("awsProfile", ""),
      apiKeyMask: apiKey ? maskApiKey(apiKey) : "",
      accessKeyIdMask: accessKeys ? maskApiKey(accessKeys.accessKeyId) : "",
      hasSecretAccessKey: Boolean(accessKeys),
      hasSessionToken: Boolean(accessKeys?.sessionToken),
      openaiBaseUrl: readOpenAIBaseUrl(),
      openaiModel: readOpenAIModel(),
      openaiKeyMask: openaiKey ? maskApiKey(openaiKey) : "",
      models: BEDROCK_MODEL_SUGGESTIONS,
      openaiModels: OPENAI_MODEL_SUGGESTIONS,
      regions: REGION_SUGGESTIONS,
      presets: OPENAI_PRESETS
    };
  }

  /** Returns an error message, or undefined on success. */
  private async save(form: SetupForm): Promise<string | undefined> {
    const cfg = vscode.workspace.getConfiguration("safegraph");
    const target = vscode.ConfigurationTarget.Global;
    const provider: ProviderId = form.provider === "openai-compatible" ? "openai-compatible" : "bedrock";
    await cfg.update("provider", provider, target);

    if (provider === "openai-compatible") {
      const baseUrl = form.openaiBaseUrl.trim();
      const model = form.openaiModel.trim();
      if (!baseUrl) return "Base URL is required.";
      try {
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "Base URL must start with http:// or https://.";
      } catch {
        return "Base URL is not a valid URL.";
      }
      if (!model) return "Model name is required.";
      const key = form.openaiApiKey.trim();
      if (key) await this.context.secrets.store(SECRET_OPENAI_API_KEY, key);
      else if (!(await resolveOpenAIApiKey(this.context)) && !isLocalBaseUrl(baseUrl)) {
        return "Enter an API key. Local 9Router and LiteLLM can stay empty; OpenRouter and OpenAI cannot.";
      }
      await cfg.update("openaiBaseUrl", baseUrl, target);
      await cfg.update("openaiModel", model, target);
      this.output.appendLine(`[safegraph-ai] setup saved: provider=openai-compatible base=${baseUrl} model=${model}`);
      return undefined;
    }

    const region = form.region.trim();
    const modelId = form.modelId.trim();
    if (!region) return "Region is required.";
    if (!modelId) return "Model ID is required.";

    const secrets = this.context.secrets;
    if (form.authMode === "bearer-token") {
      const key = form.apiKey.trim();
      if (key) await secrets.store(SECRET_KEY_NAME, key);
      else if (!(await resolveBedrockApiKey(this.context))) return "Enter your Bedrock API key.";
    }
    if (form.authMode === "access-keys") {
      const stored = await loadStoredAccessKeys(this.context);
      const accessKeyId = form.accessKeyId.trim() || stored?.accessKeyId || "";
      const secretAccessKey = form.secretAccessKey.trim() || stored?.secretAccessKey || "";
      if (!accessKeyId || !secretAccessKey) return "Enter both the AWS Access Key ID and Secret Access Key.";
      await secrets.store(SECRET_ACCESS_KEY_ID, accessKeyId);
      await secrets.store(SECRET_SECRET_ACCESS_KEY, secretAccessKey);
      if (form.sessionToken.trim()) await secrets.store(SECRET_SESSION_TOKEN, form.sessionToken.trim());
      else if (form.accessKeyId.trim() || form.secretAccessKey.trim()) await secrets.delete(SECRET_SESSION_TOKEN);
    }

    await cfg.update("authMode", form.authMode, target);
    await cfg.update("region", region, target);
    await cfg.update("modelId", modelId, target);
    await cfg.update("awsProfile", form.authMode === "aws-credentials" ? form.awsProfile.trim() : cfg.get("awsProfile", ""), target);
    this.output.appendLine(`[safegraph-ai] setup saved: provider=bedrock auth=${form.authMode} region=${region} model=${modelId}`);
    return undefined;
  }

  private async testConnection(): Promise<{ ok: boolean; text: string }> {
    try {
      const session = await createModelSession(this.context, this.output);
      const started = Date.now();
      const result = await session.provider.converse("Reply with exactly: OK", {
        modelId: session.modelId,
        maxTokens: 16,
        temperature: 0,
        retries: 0
      });
      const ms = Date.now() - started;
      const preview = result.text.trim().slice(0, 40);
      this.output.appendLine(`[safegraph-ai] setup test ok in ${ms}ms via ${session.providerId}: ${preview}`);
      const where = session.providerId === "bedrock" ? `${session.modelId} in ${session.label}` : `${session.modelId} at ${session.label}`;
      return { ok: true, text: `Connected to ${where} (${ms} ms). You're ready to go.` };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.output.appendLine(`[safegraph-ai] setup test failed: ${message}`);
      if (e instanceof ProviderConfigurationError) return { ok: false, text: message };
      return { ok: false, text: `Connection failed: ${message}` };
    }
  }

  private async detectNineRouter() {
    const baseUrl = "http://localhost:20128/v1";
    try {
      const models = await probeOpenAIModels(baseUrl, await resolveOpenAIApiKey(this.context));
      const model = models.includes("9router/auto") ? "9router/auto" : models[0] || "9router/auto";
      this.post({
        type: "detected",
        ok: true,
        baseUrl,
        model,
        models: models.length > 0 ? models : OPENAI_MODEL_SUGGESTIONS,
        text: models.length
          ? `9Router is running. Found ${models.length} model${models.length === 1 ? "" : "s"}.`
          : "9Router is running. No model list was returned; 9router/auto is filled in."
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.output.appendLine(`[safegraph-ai] 9Router detect failed: ${message}`);
      const unreachable = /ECONNREFUSED|ENOTFOUND|Cannot reach|timeout/i.test(message);
      this.post({
        type: "detected",
        ok: false,
        text: unreachable
          ? "9Router is not reachable at http://localhost:20128. Start 9Router, then detect again. Safegraph will not switch to Bedrock on its own."
          : message
      });
    }
  }
}

function nonce() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

function renderHtml(webview: vscode.Webview) {
  const n = nonce();
  const csp = [`default-src 'none';`, `style-src 'nonce-${n}';`, `script-src 'nonce-${n}';`].join(" ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Safegraph AI Setup</title>
<style nonce="${n}">
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 24px; }
  .wrap { max-width: 680px; margin: 0 auto; }
  h1 { font-size: 1.5em; margin: 0 0 4px; }
  .sub { color: var(--vscode-descriptionForeground); margin: 0 0 24px; }
  fieldset { border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35)); border-radius: 6px; padding: 16px; margin: 0 0 16px; }
  legend { font-weight: 600; padding: 0 6px; }
  label { display: block; margin: 12px 0 4px; font-weight: 500; }
  .hint { color: var(--vscode-descriptionForeground); font-size: .9em; margin-top: 4px; }
  input[type=text], input[type=password] { width: 100%; box-sizing: border-box; padding: 6px 8px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; font-family: inherit; }
  input:focus { outline: 1px solid var(--vscode-focusBorder); }
  .modes { display: grid; gap: 8px; }
  .mode { display: flex; gap: 8px; align-items: flex-start; padding: 8px; border-radius: 4px; cursor: pointer; margin: 0; font-weight: normal; }
  .mode:hover { background: var(--vscode-list-hoverBackground); }
  .mode b { display: block; }
  .pane[hidden], .section[hidden] { display: none; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  button { padding: 6px 14px; border: none; border-radius: 2px; cursor: pointer; font-family: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button:disabled { opacity: .6; cursor: default; }
  #status { margin-top: 16px; padding: 10px 12px; border-radius: 4px; white-space: pre-wrap; }
  #status.ok { background: rgba(40,160,80,.15); border-left: 3px solid var(--vscode-testing-iconPassed, #3c9); }
  #status.err { background: rgba(220,60,60,.15); border-left: 3px solid var(--vscode-errorForeground); }
  #status.pending { background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-progressBar-background); }
  #status[hidden] { display: none; }
  #next[hidden] { display: none; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Safegraph AI Setup</h1>
  <p class="sub">Use Amazon Bedrock, or any OpenAI-compatible endpoint such as 9Router, OpenRouter, LiteLLM, or the OpenAI API. Secrets stay in VS Code SecretStorage on this machine.</p>

  <fieldset>
    <legend>1. Provider</legend>
    <div class="modes">
      <label class="mode"><input type="radio" name="provider" value="bedrock" /><span><b>Amazon Bedrock</b><span class="hint">Claude on Bedrock. Existing credentials, region, and model keep working.</span></span></label>
      <label class="mode"><input type="radio" name="provider" value="openai-compatible" /><span><b>OpenAI-compatible</b><span class="hint">9Router, OpenRouter, LiteLLM, OpenAI, or any server that implements /v1/chat/completions.</span></span></label>
    </div>
  </fieldset>

  <div class="pane" id="bedrockPane">
    <fieldset>
      <legend>2. Bedrock authentication</legend>
      <div class="modes">
        <label class="mode"><input type="radio" name="authMode" value="bearer-token" /><span><b>Bedrock API key</b><span class="hint">Key generated in the Bedrock console (starts with ABSK… or bedrock-api-key-…).</span></span></label>
        <label class="mode"><input type="radio" name="authMode" value="access-keys" /><span><b>AWS access key</b><span class="hint">IAM Access Key ID + Secret Access Key with bedrock:InvokeModel permission.</span></span></label>
        <label class="mode"><input type="radio" name="authMode" value="aws-credentials" /><span><b>AWS profile / default credential chain</b><span class="hint">Uses ~/.aws credentials, SSO or environment variables already on this machine.</span></span></label>
      </div>

      <div class="section" data-mode="bearer-token">
        <label for="apiKey">Bedrock API key</label>
        <input id="apiKey" type="password" autocomplete="off" />
        <div class="hint" id="apiKeyHint"></div>
      </div>

      <div class="section" data-mode="access-keys">
        <label for="accessKeyId">Access Key ID</label>
        <input id="accessKeyId" type="text" autocomplete="off" spellcheck="false" />
        <label for="secretAccessKey">Secret Access Key</label>
        <input id="secretAccessKey" type="password" autocomplete="off" />
        <label for="sessionToken">Session token <span class="hint">(optional, for temporary credentials)</span></label>
        <input id="sessionToken" type="password" autocomplete="off" />
        <div class="hint" id="accessKeyHint"></div>
      </div>

      <div class="section" data-mode="aws-credentials">
        <label for="awsProfile">AWS profile name</label>
        <input id="awsProfile" type="text" placeholder="default" spellcheck="false" />
        <div class="hint">Leave empty to use the default credential chain.</div>
      </div>
    </fieldset>

    <fieldset>
      <legend>3. Region &amp; model</legend>
      <label for="region">AWS region</label>
      <input id="region" type="text" list="regions" spellcheck="false" />
      <datalist id="regions"></datalist>
      <label for="modelId">Model ID or inference profile ARN</label>
      <input id="modelId" type="text" list="models" spellcheck="false" />
      <datalist id="models"></datalist>
      <div class="hint">Recommended: Claude Haiku 4.5 (fast, low cost). Make sure model access is enabled for your account in the Bedrock console.</div>
    </fieldset>
  </div>

  <div class="pane" id="openaiPane" hidden>
    <fieldset>
      <legend>2. Endpoint</legend>
      <div class="actions" id="presets"></div>
      <label for="openaiBaseUrl">Base URL</label>
      <input id="openaiBaseUrl" type="text" spellcheck="false" placeholder="http://localhost:20128/v1" />
      <label for="openaiApiKey">API key</label>
      <input id="openaiApiKey" type="password" autocomplete="off" />
      <div class="hint" id="openaiKeyHint"></div>
      <label for="openaiModel">Model</label>
      <input id="openaiModel" type="text" list="openaiModels" spellcheck="false" placeholder="9router/auto" />
      <datalist id="openaiModels"></datalist>
      <div class="hint">Type any model id the endpoint accepts, for example 9router/auto or cc/claude-sonnet-4-6. The chat header can switch models later without reopening Setup.</div>
      <div class="hint">Safegraph does not fall back to Bedrock if this endpoint fails, so a Bedrock request is never a surprise bill. Switch the provider above when you want Bedrock again.</div>
    </fieldset>
  </div>

  <div class="actions">
    <button id="saveTest" type="button">Save &amp; test connection</button>
    <button id="save" class="secondary" type="button">Save</button>
    <button id="detect9" class="secondary" type="button">Detect 9Router</button>
    <button id="clear" class="secondary" type="button">Remove stored keys</button>
  </div>
  <div id="status" hidden></div>
  <div class="actions" id="next" hidden><button id="openChat" type="button">Open Safegraph AI chat</button></div>
</div>
<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const providerRadios = Array.from(document.querySelectorAll('input[name=provider]'));
  const authRadios = Array.from(document.querySelectorAll('input[name=authMode]'));
  let presets = [];

  function selected(radios, fallback) {
    const r = radios.find((x) => x.checked);
    return r ? r.value : fallback;
  }
  function sync() {
    const provider = selected(providerRadios, "bedrock");
    $('bedrockPane').hidden = provider !== "bedrock";
    $('openaiPane').hidden = provider !== "openai-compatible";
    const mode = selected(authRadios, "bearer-token");
    document.querySelectorAll('.section').forEach((el) => { el.hidden = el.dataset.mode !== mode; });
  }
  providerRadios.forEach((r) => r.addEventListener('change', sync));
  authRadios.forEach((r) => r.addEventListener('change', sync));

  function fillList(id, values) {
    const list = $(id);
    list.innerHTML = '';
    for (const v of values || []) { const o = document.createElement('option'); o.value = v; list.appendChild(o); }
  }
  function renderPresets() {
    const host = $('presets');
    host.innerHTML = '';
    for (const preset of presets) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'secondary';
      btn.textContent = preset.label;
      btn.addEventListener('click', () => {
        $('openaiBaseUrl').value = preset.baseUrl;
        $('openaiModel').value = preset.model;
      });
      host.appendChild(btn);
    }
  }

  function setBusy(busy) {
    ['saveTest', 'save', 'clear', 'detect9'].forEach((id) => { $(id).disabled = busy; });
  }
  function showStatus(s) {
    const el = $('status');
    el.hidden = false;
    el.textContent = s.text;
    el.className = s.pending ? 'pending' : s.ok ? 'ok' : 'err';
    if (!s.pending) setBusy(false);
    $('next').hidden = !(s.ok && !s.pending);
  }
  function send(test) {
    setBusy(true);
    vscode.postMessage({
      type: 'save',
      test,
      form: {
        provider: selected(providerRadios, "bedrock"),
        authMode: selected(authRadios, "bearer-token"),
        region: $('region').value,
        modelId: $('modelId').value,
        awsProfile: $('awsProfile').value,
        apiKey: $('apiKey').value,
        accessKeyId: $('accessKeyId').value,
        secretAccessKey: $('secretAccessKey').value,
        sessionToken: $('sessionToken').value,
        openaiBaseUrl: $('openaiBaseUrl').value,
        openaiApiKey: $('openaiApiKey').value,
        openaiModel: $('openaiModel').value
      }
    });
  }

  $('saveTest').addEventListener('click', () => send(true));
  $('save').addEventListener('click', () => send(false));
  $('clear').addEventListener('click', () => { setBusy(true); vscode.postMessage({ type: 'clearSecrets' }); });
  $('detect9').addEventListener('click', () => { setBusy(true); vscode.postMessage({ type: 'detect9Router' }); });
  $('openChat').addEventListener('click', () => vscode.postMessage({ type: 'openChat' }));

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'state') {
      const s = msg.state;
      presets = s.presets || [];
      renderPresets();
      providerRadios.forEach((r) => { r.checked = r.value === s.provider; });
      authRadios.forEach((r) => { r.checked = r.value === s.authMode; });
      $('region').value = s.region;
      $('modelId').value = s.modelId;
      $('awsProfile').value = s.awsProfile || '';
      $('openaiBaseUrl').value = s.openaiBaseUrl || 'http://localhost:20128/v1';
      $('openaiModel').value = s.openaiModel || '9router/auto';
      ['apiKey', 'accessKeyId', 'secretAccessKey', 'sessionToken', 'openaiApiKey'].forEach((id) => { $(id).value = ''; });
      $('apiKey').placeholder = s.apiKeyMask ? 'Stored: ' + s.apiKeyMask + ' (leave empty to keep)' : 'Paste your Bedrock API key';
      $('apiKeyHint').textContent = s.apiKeyMask ? 'A key is already stored. Paste a new one to replace it.' : '';
      $('accessKeyId').placeholder = s.accessKeyIdMask ? 'Stored: ' + s.accessKeyIdMask + ' (leave empty to keep)' : 'AKIA...';
      $('secretAccessKey').placeholder = s.hasSecretAccessKey ? 'Stored (leave empty to keep)' : '';
      $('sessionToken').placeholder = s.hasSessionToken ? 'Stored (leave empty to keep)' : '';
      $('accessKeyHint').textContent = s.hasSecretAccessKey ? 'Access keys are already stored. Fill the fields only to replace them.' : '';
      $('openaiApiKey').placeholder = s.openaiKeyMask ? 'Stored: ' + s.openaiKeyMask + ' (leave empty to keep)' : 'Optional on localhost';
      $('openaiKeyHint').textContent = s.openaiKeyMask ? 'A key is already stored in SecretStorage. Paste a new one to replace it.' : 'Stored in SecretStorage, not in settings.json. Leave empty for a local 9Router that does not require a key.';
      fillList('regions', s.regions);
      fillList('models', s.models);
      fillList('openaiModels', s.openaiModels);
      sync();
      setBusy(false);
    } else if (msg.type === 'detected') {
      if (msg.ok) {
        providerRadios.forEach((r) => { r.checked = r.value === 'openai-compatible'; });
        $('openaiBaseUrl').value = msg.baseUrl;
        if (msg.model) $('openaiModel').value = msg.model;
        if (msg.models) fillList('openaiModels', msg.models);
        sync();
      }
      showStatus(msg);
    } else if (msg.type === 'status') {
      showStatus(msg);
    }
  });

  sync();
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}

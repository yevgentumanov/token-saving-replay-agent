"use strict";
// app.ts - Compile: npx tsc --target ES2020 --lib ES2020,DOM --strict --outDir static static/app.ts
// ===== Helpers =====
const $ = (id) => document.getElementById(id);
// Detect VS Code webview iframe mode (chatPanel.ts passes ?vscode=1 in the iframe URL)
const IS_VSCODE = new URLSearchParams(location.search).get("vscode") === "1";
// ========================================================================
// ============ LAUNCHER TAB ==============================================
// ========================================================================
const pathA = $("pathA");
const portA = $("portA");
const pathB = $("pathB");
const portB = $("portB");
const llamaPath = $("llamaPath");
const hostInput = $("host");
const usePatcher = $("usePatcher");
const dotA = $("dotA");
const dotB = $("dotB");
const statusA = $("statusA");
const statusB = $("statusB");
const blockB = $("blockB");
const startBtn = $("startBtn");
const stopBtn = $("stopBtn");
const chatABtn = $("chatA");
const chatBBtn = $("chatB");
const consoleDiv = $("console");
const diagnosticsBtn = $("diagnosticsBtn");
const copyDiagnosticsBtn = $("copyDiagnosticsBtn");
const diagnosticsPanel = $("diagnosticsPanel");
// Cloud / provider elements - Model A
const providerA = $("providerA");
const localFieldsA = $("localFieldsA");
const cloudFieldsA = $("cloudFieldsA");
const cloudModelSelectA = $("cloudModelSelectA");
const customModelFieldA = $("customModelFieldA");
const customModelA = $("customModelA");
const apiKeyA = $("apiKeyA");
// Cloud / provider elements - Model B
const providerB = $("providerB");
const localFieldsB = $("localFieldsB");
const cloudFieldsB = $("cloudFieldsB");
const cloudModelSelectB = $("cloudModelSelectB");
const customModelFieldB = $("customModelFieldB");
const customModelB = $("customModelB");
const apiKeyB = $("apiKeyB");
const CLOUD_MODELS = {
    openai: [
        { value: "gpt-4o", label: "GPT-4o" },
        { value: "gpt-4o-mini", label: "GPT-4o mini" },
        { value: "o3", label: "o3" },
        { value: "o4-mini", label: "o4-mini" },
        { value: "__custom__", label: "Custom model ID..." },
    ],
    anthropic: [
        { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
        { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
        { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
        { value: "__custom__", label: "Custom model ID..." },
    ],
    groq: [
        { value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
        { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B (fast)" },
        { value: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
        { value: "__custom__", label: "Custom model ID..." },
    ],
};
const LAUNCHER_KEYS = [
    "pathA", "portA", "computeA", "ctxA", "threadsA", "flashAttnA", "noMmapA",
    "pathB", "portB", "computeB", "ctxB", "threadsB", "flashAttnB", "noMmapB",
    "llamaPath", "host", "usePatcher",
    "providerA", "cloudModelSelectA", "customModelA", "apiKeyA",
    "providerB", "cloudModelSelectB", "customModelB", "apiKeyB",
];
function buildArgs(which) {
    const compute = $(`compute${which.toUpperCase()}`).value;
    const ctx = $(`ctx${which.toUpperCase()}`).value;
    const threads = $(`threads${which.toUpperCase()}`).value;
    const flashAttn = ($(`flashAttn${which.toUpperCase()}`)).checked;
    const noMmap = ($(`noMmap${which.toUpperCase()}`)).checked;
    const parts = [
        `-c ${ctx}`,
        `-ngl ${compute === "gpu" ? "99" : "0"}`,
        `-t ${threads || "4"}`,
    ];
    if (flashAttn)
        parts.push("--flash-attn on");
    if (noMmap)
        parts.push("--no-mmap");
    return parts.join(" ");
}
function saveLauncherSettings() {
    LAUNCHER_KEYS.forEach(k => {
        const el = $(k);
        localStorage.setItem(k, el.type === "checkbox" ? String(el.checked) : el.value);
    });
}
function loadLauncherSettings() {
    LAUNCHER_KEYS.forEach(k => {
        const v = localStorage.getItem(k);
        if (v === null)
            return;
        const el = $(k);
        if (el.type === "checkbox")
            el.checked = v === "true";
        else
            el.value = v;
    });
}
async function loadConfigFallback() {
    if (pathA.value)
        return;
    try {
        clientLog("info", "launcher.config.load.start");
        const r = await fetch("/api/config");
        if (!r.ok)
            return;
        const c = await r.json();
        if (c.model_a_path)
            pathA.value = c.model_a_path;
        if (c.model_a_port)
            portA.value = String(c.model_a_port);
        if (c.model_b_path)
            pathB.value = c.model_b_path;
        if (c.model_b_port)
            portB.value = String(c.model_b_port);
        if (c.llama_server_path) {
            llamaPath.value = c.llama_server_path;
            localStorage.setItem("llamaPath", c.llama_server_path);
        }
        if (c.host)
            hostInput.value = c.host;
        if (c.use_patcher !== undefined)
            usePatcher.checked = c.use_patcher;
        if (c.model_a_provider)
            providerA.value = c.model_a_provider;
        if (c.model_a_api_key)
            apiKeyA.value = c.model_a_api_key;
        if (c.model_a_cloud_model)
            customModelA.value = c.model_a_cloud_model;
        if (c.model_b_provider)
            providerB.value = c.model_b_provider;
        if (c.model_b_api_key)
            apiKeyB.value = c.model_b_api_key;
        if (c.model_b_cloud_model)
            customModelB.value = c.model_b_cloud_model;
        handleProviderChange("A");
        handleProviderChange("B");
        clientLog("info", "launcher.config.load.done", "", { has_model_a: Boolean(c.model_a_path), has_model_b: Boolean(c.model_b_path) });
    }
    catch (e) {
        clientLog("warn", "launcher.config.load.failed", stringifyLogArg(e));
    }
}
function addLog(text, cls = "") {
    const div = document.createElement("div");
    div.className = "log-entry" + (cls ? " " + cls : "");
    const ts = new Date().toLocaleTimeString();
    div.textContent = `[${ts}] ${text}`;
    consoleDiv.appendChild(div);
    if (consoleDiv.children.length > 600)
        consoleDiv.removeChild(consoleDiv.firstChild);
    consoleDiv.scrollTop = consoleDiv.scrollHeight;
}
const originalConsole = {
    debug: console.debug.bind(console),
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
};
function stringifyLogArg(value) {
    if (value instanceof Error)
        return `${value.name}: ${value.message}\n${value.stack || ""}`.trim();
    if (typeof value === "string")
        return value;
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function clientLog(level, event, message = "", data = {}) {
    const payload = {
        level,
        event,
        message: message.slice(0, 4000),
        data,
        ts: Date.now() / 1000,
        url: location.href,
    };
    try {
        fetch("/api/log/frontend", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            keepalive: true,
        }).catch(() => { });
    }
    catch (_) { }
}
console.debug = (...args) => {
    originalConsole.debug(...args);
    clientLog("debug", "console.debug", args.map(stringifyLogArg).join(" "));
};
console.log = (...args) => {
    originalConsole.log(...args);
    clientLog("info", "console.log", args.map(stringifyLogArg).join(" "));
};
console.warn = (...args) => {
    originalConsole.warn(...args);
    clientLog("warn", "console.warn", args.map(stringifyLogArg).join(" "));
};
console.error = (...args) => {
    originalConsole.error(...args);
    clientLog("error", "console.error", args.map(stringifyLogArg).join(" "));
};
window.addEventListener("error", (event) => {
    clientLog("fatal", "window.error", event.message, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error ? stringifyLogArg(event.error) : "",
    });
});
window.addEventListener("unhandledrejection", (event) => {
    clientLog("fatal", "window.unhandledrejection", stringifyLogArg(event.reason));
});
clientLog("info", "frontend.loaded", "Browser app script loaded", {
    is_vscode: IS_VSCODE,
    user_agent: navigator.userAgent,
});
let lastStatus = null;
function applyStatus(s, dot, label, chatBtn) {
    dot.className = "dot " + (!s.running ? (s.last_error ? "dot-red" : "dot-gray") : s.vram_error ? "dot-red" : s.healthy ? "dot-green" : "dot-yellow");
    if (!s.running) {
        label.textContent = s.last_error ? `Error: ${s.last_error}` : "Stopped";
        label.title = s.last_error || "";
    }
    else if (s.vram_error) {
        label.textContent = "VRAM Error";
        label.title = "";
    }
    else if (s.healthy) {
        label.textContent = s.provider === "local" ? `Running (pid ${s.pid})` : `Ready (${s.provider})`;
        label.title = "";
    }
    else {
        label.textContent = "Starting...";
        label.title = "";
    }
    chatBtn.style.display = (s.running && s.healthy && s.provider === "local") ? "block" : "none";
}
async function pollStatus() {
    try {
        const r = await fetch("/api/status");
        if (!r.ok)
            return;
        const s = await r.json();
        if (!lastStatus ||
            lastStatus.a.running !== s.a.running ||
            lastStatus.a.healthy !== s.a.healthy ||
            lastStatus.b.running !== s.b.running ||
            lastStatus.b.healthy !== s.b.healthy ||
            lastStatus.a.vram_error !== s.a.vram_error ||
            lastStatus.b.vram_error !== s.b.vram_error) {
            clientLog("info", "status.changed", "", {
                a: { running: s.a.running, healthy: s.a.healthy, provider: s.a.provider, vram_error: s.a.vram_error },
                b: { running: s.b.running, healthy: s.b.healthy, provider: s.b.provider, vram_error: s.b.vram_error },
            });
        }
        lastStatus = s;
        const anyRunning = s.a.running || s.b.running;
        startBtn.disabled = anyRunning;
        stopBtn.style.display = anyRunning ? "block" : "none";
        applyStatus(s.a, dotA, statusA, chatABtn);
        if (usePatcher.checked) {
            applyStatus(s.b, dotB, statusB, chatBBtn);
            if (!s.b.running && s.a.running)
                statusB.textContent = "Not started";
        }
        updateChatTabDot(s);
    }
    catch (e) {
        clientLog("warn", "status.poll.failed", stringifyLogArg(e));
    }
}
function syncPatcherBlock() {
    blockB.classList.toggle("disabled", !usePatcher.checked);
    statusB.textContent = usePatcher.checked ? "Stopped" : "Disabled";
    dotB.className = "dot dot-gray";
    const show = usePatcher.checked ? "" : "none";
    const consolidationRow = $("consolidationToggleRow");
    const consolidationCtrls = $("consolidationControlsRow");
    if (consolidationRow)
        consolidationRow.style.display = show;
    if (consolidationCtrls)
        consolidationCtrls.style.display = show;
}
usePatcher.addEventListener("change", () => {
    clientLog("info", "launcher.use_patcher.changed", "", { checked: usePatcher.checked });
    syncPatcherBlock();
    saveLauncherSettings();
});
async function browseFile(type, target, logMsg) {
    try {
        clientLog("info", "launcher.file_dialog.start", "", { type });
        const r = await fetch(`/api/open-file-dialog?type=${type}`);
        const data = await r.json();
        if (data.path) {
            target.value = data.path;
            saveLauncherSettings();
            addLog(logMsg + data.path, "log-info");
        }
        clientLog("info", "launcher.file_dialog.done", "", { type, selected: Boolean(data.path) });
    }
    catch (e) {
        clientLog("error", "launcher.file_dialog.failed", stringifyLogArg(e), { type });
        addLog("File dialog failed: " + e, "log-error");
    }
}
$("browseA").addEventListener("click", () => browseFile("model", pathA, "Model A: "));
$("browseB").addEventListener("click", () => browseFile("model", pathB, "Model B: "));
$("browseBin").addEventListener("click", () => browseFile("binary", llamaPath, "llama-server override: "));
async function loadDiagnostics(copy = false) {
    try {
        clientLog("info", "diagnostics.load.start", "", { copy });
        const r = await fetch("/api/diagnostics");
        const data = await r.json();
        if (!r.ok)
            throw new Error(data.detail || `HTTP ${r.status}`);
        const text = JSON.stringify(data, null, 2);
        diagnosticsPanel.textContent = text;
        diagnosticsPanel.classList.add("show");
        copyDiagnosticsBtn.style.display = "";
        if (copy) {
            await navigator.clipboard.writeText(text);
            addLog("Diagnostics copied to clipboard", "log-info");
        }
        else {
            addLog("Diagnostics loaded", "log-info");
        }
        clientLog("info", "diagnostics.load.done", "", { copy });
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        diagnosticsPanel.textContent = `Diagnostics failed: ${msg}`;
        diagnosticsPanel.classList.add("show");
        addLog("Diagnostics failed: " + msg, "log-error");
        clientLog("error", "diagnostics.load.failed", msg, { copy });
    }
}
diagnosticsBtn.addEventListener("click", () => loadDiagnostics(false));
copyDiagnosticsBtn.addEventListener("click", () => loadDiagnostics(true));
// In VS Code webview (iframe), window.open is blocked; hide these buttons entirely.
if (IS_VSCODE) {
    chatABtn.style.display = "none";
    chatBBtn.style.display = "none";
}
else {
    chatABtn.addEventListener("click", () => window.open(`http://localhost:${portA.value}`, "_blank"));
    chatBBtn.addEventListener("click", () => window.open(`http://localhost:${portB.value}`, "_blank"));
}
// ===== Provider UI helpers =====
function populateCloudModels(select, provider) {
    select.innerHTML = "";
    const models = CLOUD_MODELS[provider] || [{ value: "__custom__", label: "Custom model ID..." }];
    models.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.value;
        opt.textContent = m.label;
        select.appendChild(opt);
    });
}
function handleProviderChange(which) {
    const provider = which === "A" ? providerA : providerB;
    const localFields = which === "A" ? localFieldsA : localFieldsB;
    const cloudFields = which === "A" ? cloudFieldsA : cloudFieldsB;
    const modelSel = which === "A" ? cloudModelSelectA : cloudModelSelectB;
    const customField = which === "A" ? customModelFieldA : customModelFieldB;
    const isLocal = provider.value === "local";
    localFields.style.display = isLocal ? "" : "none";
    cloudFields.style.display = isLocal ? "none" : "";
    if (!isLocal) {
        populateCloudModels(modelSel, provider.value);
        customField.style.display = modelSel.value === "__custom__" ? "" : "none";
    }
    clientLog("info", "launcher.provider.changed", "", { which, provider: provider.value });
    saveLauncherSettings();
}
providerA.addEventListener("change", () => handleProviderChange("A"));
providerB.addEventListener("change", () => handleProviderChange("B"));
cloudModelSelectA.addEventListener("change", () => {
    customModelFieldA.style.display = cloudModelSelectA.value === "__custom__" ? "" : "none";
    saveLauncherSettings();
});
cloudModelSelectB.addEventListener("change", () => {
    customModelFieldB.style.display = cloudModelSelectB.value === "__custom__" ? "" : "none";
    saveLauncherSettings();
});
startBtn.addEventListener("click", async () => {
    clientLog("info", "launcher.start.clicked", "", {
        provider_a: providerA.value,
        provider_b: providerB.value,
        use_patcher: usePatcher.checked,
    });
    const isLocalA = providerA.value === "local";
    if (isLocalA && !pathA.value.trim()) {
        addLog("Select Model A path first", "log-error");
        return;
    }
    if (!isLocalA && !apiKeyA.value.trim()) {
        addLog("Enter API key for Model A", "log-error");
        return;
    }
    saveLauncherSettings();
    startBtn.disabled = true;
    addLog("Starting...", "log-info");
    const cloudModelA = cloudModelSelectA.value === "__custom__" ? customModelA.value.trim() : cloudModelSelectA.value;
    const cloudModelB = cloudModelSelectB.value === "__custom__" ? customModelB.value.trim() : cloudModelSelectB.value;
    const body = {
        model_a: {
            path: pathA.value.trim(), args: buildArgs("a"), port: Number(portA.value),
            provider: providerA.value, api_key: apiKeyA.value.trim(), cloud_model: cloudModelA,
        },
        host: hostInput.value.trim(),
        llama_server_path: llamaPath.value.trim(),
    };
    if (usePatcher.checked && (pathB.value.trim() || providerB.value !== "local")) {
        body.model_b = {
            path: pathB.value.trim(), args: buildArgs("b"), port: Number(portB.value),
            provider: providerB.value, api_key: apiKeyB.value.trim(), cloud_model: cloudModelB,
        };
    }
    try {
        const r = await fetch("/api/start", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await r.json();
        if (!r.ok) {
            clientLog("error", "launcher.start.failed", data.detail || "unknown", { status: r.status });
            addLog("Error: " + (data.detail || "unknown"), "log-error");
            startBtn.disabled = false;
        }
        else {
            if (data.pid_a)
                addLog(`Model A started (pid ${data.pid_a})`, "log-a");
            else
                addLog("Model A connected (cloud)", "log-a");
            if (data.pid_b)
                addLog(`Model B started (pid ${data.pid_b})`, "log-b");
            clientLog("info", "launcher.start.done", "", { pid_a: data.pid_a || null, pid_b: data.pid_b || null });
            connectWs();
        }
    }
    catch (e) {
        clientLog("error", "launcher.start.request_failed", stringifyLogArg(e));
        addLog("Request failed: " + e, "log-error");
        startBtn.disabled = false;
    }
});
stopBtn.addEventListener("click", async () => {
    clientLog("info", "launcher.stop.clicked");
    addLog("Stopping all...", "log-info");
    try {
        await fetch("/api/stop", { method: "POST" });
        clientLog("info", "launcher.stop.done");
        addLog("Stopped", "log-info");
        ws?.close();
        ws = null;
    }
    catch (e) {
        clientLog("error", "launcher.stop.failed", stringifyLogArg(e));
        addLog("Stop failed: " + e, "log-error");
    }
});
let ws = null;
function connectWs() {
    if (ws)
        return;
    clientLog("info", "logs.websocket.connecting");
    ws = new WebSocket(`ws://${location.host}/ws/logs`);
    ws.onmessage = (e) => {
        if (e.data === "\x00")
            return;
        const cls = e.data.startsWith("[A]") ? "log-a" : e.data.startsWith("[B]") ? "log-b" : "";
        addLog(e.data, cls);
    };
    ws.onerror = () => clientLog("warn", "logs.websocket.error");
    ws.onclose = () => {
        clientLog("warn", "logs.websocket.closed");
        ws = null;
        setTimeout(connectWs, 3000);
    };
}
// ========================================================================
// ==================== TAB SWITCHING =====================================
// ========================================================================
document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        clientLog("info", "ui.tab.changed", "", { tab });
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b === btn));
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === `panel-${tab}`));
        if (tab === "chat")
            checkChatReadiness();
    });
});
const tabDotChat = $("tabDotChat");
function updateChatTabDot(s) {
    tabDotChat.classList.toggle("green", s.a.running && s.a.healthy);
}
// ========================================================================
// ==================== ENVIRONMENT PROFILE ===============================
// ========================================================================
const PROFILE_KEY = "envProfile";
const DETECTED_BLOCK_HEADER = "Detected tools:";
let latestEnvironmentDetection = null;
const profileDetectBtn = $("profileDetect");
const profileApplyDetectBtn = $("profileApplyDetect");
const profileCopyDetectBtn = $("profileCopyDetect");
const profileDetectPanel = $("profileDetectPanel");
function loadProfile() {
    const raw = localStorage.getItem(PROFILE_KEY);
    const def = {
        shell: "powershell", os: "Windows",
        python_version: "", package_manager: "uv",
        naming_convention: "", custom_rules: "", detected_summary: "",
    };
    if (!raw)
        return def;
    try {
        return { ...def, ...JSON.parse(raw) };
    }
    catch {
        return def;
    }
}
function stripDetectedToolsBlock(rules) {
    const lines = rules.split("\n");
    const idx = lines.findIndex(line => line.trim() === DETECTED_BLOCK_HEADER);
    return (idx === -1 ? rules : lines.slice(0, idx).join("\n")).trim();
}
function extractDetectedSummary(rules) {
    const lines = rules.split("\n");
    const idx = lines.findIndex(line => line.trim() === DETECTED_BLOCK_HEADER);
    if (idx === -1)
        return "";
    return lines
        .slice(idx + 1)
        .map(line => line.trim().replace(/^-+\s*/, ""))
        .filter(Boolean)
        .slice(0, 15)
        .join("\n");
}
function mergeDetectedToolsBlock(rules, summary) {
    const base = stripDetectedToolsBlock(rules);
    const block = [
        DETECTED_BLOCK_HEADER,
        ...summary.split("\n").map(line => `- ${line.replace(/^-+\s*/, "")}`),
    ].join("\n");
    return [base, block].filter(Boolean).join("\n\n");
}
function saveProfile() {
    const rawRules = ($("prof-rules")).value.trim();
    const p = {
        shell: ($("prof-shell")).value,
        os: ($("prof-os")).value,
        python_version: ($("prof-python")).value.trim(),
        package_manager: ($("prof-pkg")).value,
        naming_convention: ($("prof-naming")).value.trim(),
        custom_rules: rawRules,
        detected_summary: extractDetectedSummary(rawRules),
    };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    clientLog("info", "profile.saved", "", {
        shell: p.shell,
        os: p.os,
        package_manager: p.package_manager,
        has_custom_rules: Boolean(p.custom_rules.trim()),
        has_detected_summary: Boolean(p.detected_summary),
    });
    const saved = $("profileSaved");
    saved.classList.add("show");
    setTimeout(() => saved.classList.remove("show"), 1500);
}
function hydrateProfileForm() {
    const p = loadProfile();
    ($("prof-shell")).value = p.shell;
    ($("prof-os")).value = p.os;
    ($("prof-python")).value = p.python_version;
    ($("prof-pkg")).value = p.package_manager;
    ($("prof-naming")).value = p.naming_convention;
    ($("prof-rules")).value = p.custom_rules;
}
function selectHasValue(select, value) {
    return Array.from(select.options).some(opt => opt.value === value);
}
function toolSummaryLine(detected, key, label) {
    const tool = detected.tools[key];
    if (!tool || !tool.found)
        return `${label}: not found`;
    return `${label}: ${tool.version || "found"}`;
}
function buildDetectedSummary(detected) {
    const osDetails = detected.os.distro || detected.os.platform || detected.os.name;
    const lines = [
        `OS: ${detected.os.name}${osDetails && osDetails !== detected.os.name ? ` (${osDetails})` : ""}`,
        `Shell: ${detected.shell.guess}`,
        toolSummaryLine(detected, "python", "Python"),
        toolSummaryLine(detected, "uv", "uv"),
        toolSummaryLine(detected, "pip", "pip"),
        toolSummaryLine(detected, "node", "Node"),
        toolSummaryLine(detected, "npm", "npm"),
        toolSummaryLine(detected, "pnpm", "pnpm"),
        toolSummaryLine(detected, "yarn", "yarn"),
        toolSummaryLine(detected, "java", "Java"),
        toolSummaryLine(detected, "javac", "javac"),
        toolSummaryLine(detected, "git", "Git"),
        toolSummaryLine(detected, "docker", "Docker"),
        toolSummaryLine(detected, "go", "Go"),
        toolSummaryLine(detected, "rustc", "Rust"),
        toolSummaryLine(detected, "cargo", "Cargo"),
        toolSummaryLine(detected, "dotnet", ".NET"),
    ];
    return lines.slice(0, 15).join("\n");
}
function chooseDetectedPackageManager(detected, current) {
    for (const name of ["uv", "pip", "npm"]) {
        if (detected.tools[name]?.found)
            return name;
    }
    return current;
}
async function detectProfileEnvironment() {
    const originalText = profileDetectBtn.textContent || "Auto-detect";
    profileDetectBtn.disabled = true;
    profileDetectBtn.textContent = "Detecting...";
    profileDetectPanel.classList.add("show");
    profileDetectPanel.textContent = "Detecting environment...";
    clientLog("info", "profile.detect.start");
    try {
        const r = await fetch("/api/environment/detect");
        const data = await r.json();
        if (!r.ok)
            throw new Error(data.detail || `HTTP ${r.status}`);
        latestEnvironmentDetection = data;
        profileDetectPanel.textContent = JSON.stringify(data, null, 2);
        profileApplyDetectBtn.style.display = "";
        profileCopyDetectBtn.style.display = "";
        addLog("Environment detection loaded", "log-info");
        clientLog("info", "profile.detect.done", "", {
            os: data.os.name,
            shell: data.shell.guess,
            tools: Object.fromEntries(Object.entries(data.tools).map(([key, value]) => [key, value.found])),
        });
    }
    catch (e) {
        latestEnvironmentDetection = null;
        const msg = e instanceof Error ? e.message : String(e);
        profileDetectPanel.textContent = `Environment detection failed: ${msg}`;
        profileApplyDetectBtn.style.display = "none";
        addLog("Environment detection failed: " + msg, "log-error");
        clientLog("error", "profile.detect.failed", msg);
    }
    finally {
        profileDetectBtn.disabled = false;
        profileDetectBtn.textContent = originalText;
    }
}
function applyDetectedProfile() {
    if (!latestEnvironmentDetection) {
        clientLog("warn", "profile.apply_detected.no_detection");
        return;
    }
    const detected = latestEnvironmentDetection;
    const shellSelect = $("prof-shell");
    const osSelect = $("prof-os");
    const pkgSelect = $("prof-pkg");
    const shellGuess = detected.shell.guess;
    const osName = detected.os.name;
    if (selectHasValue(shellSelect, shellGuess))
        shellSelect.value = shellGuess;
    if (selectHasValue(osSelect, osName))
        osSelect.value = osName;
    if (detected.tools.python?.found && detected.tools.python.version) {
        ($("prof-python")).value = detected.tools.python.version;
    }
    const pkg = chooseDetectedPackageManager(detected, pkgSelect.value);
    if (selectHasValue(pkgSelect, pkg))
        pkgSelect.value = pkg;
    const summary = buildDetectedSummary(detected);
    const rulesEl = $("prof-rules");
    rulesEl.value = mergeDetectedToolsBlock(rulesEl.value, summary);
    saveProfile();
    addLog("Detected environment applied to Profile", "log-info");
    clientLog("info", "profile.apply_detected.done", "", {
        os: detected.os.name,
        shell: detected.shell.guess,
        package_manager: pkg,
    });
}
async function copyDetectedEnvironment() {
    if (!profileDetectPanel.textContent) {
        clientLog("warn", "profile.copy_detected.empty");
        return;
    }
    try {
        await navigator.clipboard.writeText(profileDetectPanel.textContent);
        addLog("Environment detection copied to clipboard", "log-info");
        clientLog("info", "profile.copy_detected.done");
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        addLog("Copy environment detection failed: " + msg, "log-error");
        clientLog("error", "profile.copy_detected.failed", msg);
    }
}
$("profileSave").addEventListener("click", saveProfile);
profileDetectBtn.addEventListener("click", detectProfileEnvironment);
profileApplyDetectBtn.addEventListener("click", applyDetectedProfile);
profileCopyDetectBtn.addEventListener("click", copyDetectedEnvironment);
["prof-shell", "prof-os", "prof-python", "prof-pkg", "prof-naming", "prof-rules"].forEach(id => {
    $(id).addEventListener("change", saveProfile);
});
function profileToSystemPrompt(p) {
    const parts = [
        `You are assisting a user with the following environment:`,
        `- Shell: ${p.shell}`,
        `- OS: ${p.os}`,
    ];
    if (p.python_version)
        parts.push(`- Python: ${p.python_version}`);
    if (p.package_manager)
        parts.push(`- Package manager: ${p.package_manager}`);
    if (p.naming_convention)
        parts.push(`- Naming: ${p.naming_convention}`);
    if (p.detected_summary) {
        parts.push(`\nDetected tools:`);
        p.detected_summary.split("\n").map(s => s.trim()).filter(Boolean).slice(0, 15).forEach(r => parts.push(`- ${r}`));
    }
    const userRules = stripDetectedToolsBlock(p.custom_rules || "");
    if (userRules) {
        parts.push(`\nUser rules (follow strictly):`);
        userRules.split("\n").map(s => s.trim()).filter(Boolean).forEach(r => parts.push(`- ${r}`));
    }
    parts.push(`\nAlways produce commands for the shell above. Prefer tagged code fences (\`\`\`${p.shell}).`);
    return parts.join("\n");
}
// ========================================================================
// ==================== CHAT ==============================================
// ========================================================================
const chatMessages = $("chatMessages");
const chatInput = $("chatInput");
const chatSend = $("chatSend");
const chatClear = $("chatClear");
const chatBanner = $("chatBanner");
const consolidationEnabledToggle = $("consolidationEnabled"); // Phase 2.5
const CHATS_KEY = "chats_v1";
const ACTIVE_CHAT_KEY = "activeChatId";
const LEGACY_HISTORY_KEY = "chatHistory"; // pre-multi-chat sessionStorage key
let chats = [];
let activeChatId = "";
let chatHistoryArr = []; // live ref to active chat's messages
let streaming = false;
let blockCounter = 0;
let stepCounter = 0;
const newChatBtn = $("newChatBtn");
const chatListEl = $("chatList");
function genChatId() {
    return "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function activeChat() {
    return chats.find(c => c.id === activeChatId) ?? null;
}
function persistChats() {
    localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
    localStorage.setItem(ACTIVE_CHAT_KEY, activeChatId);
}
function deriveTitle(messages) {
    const firstUser = messages.find(m => m.role === "user");
    if (!firstUser)
        return "New chat";
    const t = firstUser.content.trim().replace(/\s+/g, " ");
    return t.length > 40 ? t.slice(0, 40) + "…" : (t || "New chat");
}
function renderChatList() {
    chatListEl.innerHTML = "";
    // Show most recently updated first
    const sorted = chats.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    for (const c of sorted) {
        const item = document.createElement("div");
        item.className = "chat-item" + (c.id === activeChatId ? " active" : "");
        item.dataset.chatId = c.id;
        const title = document.createElement("span");
        title.className = "chat-item-title";
        title.textContent = c.title || "New chat";
        const del = document.createElement("button");
        del.className = "chat-item-del";
        del.title = "Delete chat";
        del.textContent = "×";
        del.addEventListener("click", (e) => { e.stopPropagation(); deleteChat(c.id); });
        item.appendChild(title);
        item.appendChild(del);
        item.addEventListener("click", () => switchChat(c.id));
        chatListEl.appendChild(item);
    }
}
function refreshActiveChat() {
    const c = activeChat();
    chatHistoryArr = c ? c.messages : [];
    blockCounter = 0;
    stepCounter = 0;
    currentTurnPatches = [];
    lastConsolidationSummary = null;
    consolidationHistory = [];
    consolidationVersionCounter = 0;
    chatMessages.innerHTML = "";
    chatHistoryArr.forEach(renderMessage);
    syncUndoBtn();
}
function createNewChat(activate = true) {
    const c = {
        id: genChatId(),
        title: "New chat",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
    };
    chats.push(c);
    if (activate)
        activeChatId = c.id;
    persistChats();
    renderChatList();
    if (activate)
        refreshActiveChat();
    clientLog("info", "chat.session.created", "", { id: c.id });
    return c;
}
function switchChat(id) {
    if (streaming)
        return;
    if (id === activeChatId)
        return;
    const c = chats.find(x => x.id === id);
    if (!c)
        return;
    activeChatId = id;
    persistChats();
    renderChatList();
    refreshActiveChat();
    clientLog("info", "chat.session.switched", "", { id });
}
function deleteChat(id) {
    if (streaming)
        return;
    if (!confirm("Delete this chat?"))
        return;
    const idx = chats.findIndex(c => c.id === id);
    if (idx === -1)
        return;
    chats.splice(idx, 1);
    if (activeChatId === id) {
        if (chats.length === 0) {
            createNewChat(true);
            return;
        }
        const next = chats.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
        activeChatId = next.id;
        persistChats();
        renderChatList();
        refreshActiveChat();
    }
    else {
        persistChats();
        renderChatList();
    }
    clientLog("info", "chat.session.deleted", "", { id });
}
// ===== Phase 2.5 - Consolidation Pass state =====
let currentTurnPatches = [];
let lastConsolidationSummary = null;
let consolidationDebounceTimer = null;
// Versioned history: each successful consolidation appends a ConsolidationEntry
let consolidationHistory = [];
let consolidationVersionCounter = 0;
// Smart-threshold values - loaded from backend at init, updated via UI
let consolidationPatchThreshold = 8;
let consolidationTokenThreshold = 12000;
function loadHistory() {
    try {
        const raw = localStorage.getItem(CHATS_KEY);
        chats = raw ? JSON.parse(raw) : [];
    }
    catch (e) {
        chats = [];
        clientLog("warn", "chat.sessions.load_failed", stringifyLogArg(e));
    }
    // One-time migration from the old single-chat sessionStorage entry.
    if (chats.length === 0) {
        try {
            const legacy = sessionStorage.getItem(LEGACY_HISTORY_KEY);
            if (legacy) {
                const msgs = JSON.parse(legacy);
                if (Array.isArray(msgs) && msgs.length > 0) {
                    chats.push({
                        id: genChatId(),
                        title: deriveTitle(msgs),
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        messages: msgs,
                    });
                    sessionStorage.removeItem(LEGACY_HISTORY_KEY);
                    clientLog("info", "chat.sessions.migrated", "", { messages: msgs.length });
                }
            }
        }
        catch (e) {
            clientLog("warn", "chat.sessions.migration_failed", stringifyLogArg(e));
        }
    }
    activeChatId = localStorage.getItem(ACTIVE_CHAT_KEY) || "";
    if (!chats.find(c => c.id === activeChatId)) {
        activeChatId = chats.length > 0 ? chats[chats.length - 1].id : "";
    }
    if (chats.length === 0) {
        createNewChat(true);
    }
    else {
        persistChats();
        renderChatList();
        refreshActiveChat();
    }
    clientLog("info", "chat.sessions.loaded", "", { count: chats.length, active: activeChatId });
}
function persistHistory() {
    const c = activeChat();
    if (!c)
        return;
    c.updatedAt = Date.now();
    if (c.title === "New chat" || !c.title)
        c.title = deriveTitle(c.messages);
    persistChats();
    renderChatList();
    clientLog("debug", "chat.history.persisted", "", { id: c.id, messages: c.messages.length });
}
function checkChatReadiness() {
    if (!lastStatus || !lastStatus.a.running || !lastStatus.a.healthy) {
        chatBanner.textContent = "Main Model (A) is not running. Go to Launcher tab and Start.";
        chatBanner.classList.add("show");
        chatSend.disabled = true;
    }
    else if (usePatcher.checked && (!lastStatus.b.running || !lastStatus.b.healthy)) {
        chatBanner.textContent = "Chat will work, but patcher (B) is offline - inline fixes disabled.";
        chatBanner.classList.add("show");
        chatSend.disabled = false;
    }
    else {
        chatBanner.classList.remove("show");
        chatSend.disabled = false;
    }
}
function renderMessage(msg) {
    clientLog("debug", "chat.message.render", "", { role: msg.role, chars: msg.content.length });
    const wrap = document.createElement("div");
    wrap.className = "msg " + (msg.role === "user" ? "msg-user" : "msg-asst");
    const role = document.createElement("div");
    role.className = "msg-role";
    role.textContent = msg.role === "user" ? "You" : "Model A";
    const content = document.createElement("div");
    content.className = "msg-content";
    if (msg.role === "assistant") {
        renderAssistantContent(content, msg.content);
    }
    else {
        content.textContent = msg.content;
    }
    wrap.appendChild(role);
    wrap.appendChild(content);
    chatMessages.appendChild(wrap);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return wrap;
}
// ===== Step Extractor + code block wrapping =====
const COMMAND_LANGS = new Set(["bash", "sh", "cmd", "powershell", "ps1", "pwsh", "batch", "bat", "zsh", "fish", "shell", "console"]);
const LATEX_SYMBOLS = {
    rightarrow: "→", to: "→", longrightarrow: "⟶",
    leftarrow: "←", gets: "←", longleftarrow: "⟵",
    Rightarrow: "⇒", implies: "⇒",
    Leftarrow: "⇐", impliedby: "⇐",
    leftrightarrow: "↔", Leftrightarrow: "⇔", iff: "⇔",
    uparrow: "↑", downarrow: "↓", updownarrow: "↕",
    times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓",
    approx: "≈", neq: "≠", ne: "≠",
    leq: "≤", le: "≤", geq: "≥", ge: "≥",
    infty: "∞", sum: "∑", prod: "∏", int: "∫",
    alpha: "α", beta: "β", gamma: "γ", delta: "δ",
    epsilon: "ε", theta: "θ", lambda: "λ", mu: "μ",
    pi: "π", sigma: "σ", phi: "φ", omega: "ω",
    Delta: "Δ", Sigma: "Σ", Omega: "Ω",
};
function decodeLatexInline(md) {
    return md.replace(/\$\\([a-zA-Z]+)\$/g, (m, name) => LATEX_SYMBOLS[name] ?? m);
}
// Returns inline-patch Promises so sendMessage() can await them before running Consolidation Pass.
function renderAssistantContent(container, markdown) {
    clientLog("info", "chat.assistant.render.start", "", { chars: markdown.length });
    const html = DOMPurify.sanitize(marked.parse(decodeLatexInline(markdown)));
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    tmp.querySelectorAll("h1, h2, h3, h4").forEach(el => {
        el.id = `step-${++stepCounter}`;
    });
    tmp.querySelectorAll("ol > li").forEach(el => {
        el.id = `step-${++stepCounter}`;
    });
    tmp.querySelectorAll("pre > code").forEach(codeEl => {
        const pre = codeEl.parentElement;
        const blockId = `code-block-${++blockCounter}`;
        const langMatch = (codeEl.className || "").match(/language-(\S+)/);
        const lang = langMatch ? langMatch[1].toLowerCase() : "";
        const content = codeEl.textContent || "";
        const wrap = document.createElement("div");
        wrap.className = "code-block-wrap";
        wrap.dataset.blockId = blockId;
        wrap.dataset.lang = lang;
        wrap.dataset.original = content;
        const header = document.createElement("div");
        header.className = "code-block-header";
        header.innerHTML = `<span class="lang">${lang || "code"} - ${blockId}</span>
      <span class="actions-small">
        <button class="btn-copy" title="Copy">Copy</button>
        <button class="btn-problem" title="I have a problem with this">Problem?</button>
      </span>`;
        wrap.appendChild(header);
        pre.replaceWith(wrap);
        wrap.appendChild(pre);
        const problemBar = document.createElement("div");
        problemBar.className = "btn-problem-bar";
        problemBar.innerHTML = `<button>Got an error with this command? Click to fix with patcher</button>`;
        wrap.appendChild(problemBar);
        header.querySelector(".btn-copy").addEventListener("click", () => {
            navigator.clipboard.writeText(codeEl.textContent || "");
        });
        header.querySelector(".btn-problem").addEventListener("click", () => openErrorModal(wrap));
        problemBar.querySelector("button").addEventListener("click", () => openErrorModal(wrap));
    });
    container.appendChild(tmp);
    const profile = loadProfile();
    const patcherReady = lastStatus?.b.running && lastStatus.b.healthy && usePatcher.checked;
    console.log(`[step-extractor] steps=${stepCounter} blocks=${blockCounter} patcherReady=${patcherReady}`);
    const patchPromises = [];
    if (patcherReady) {
        container.querySelectorAll(".code-block-wrap").forEach(wrap => {
            const lang = wrap.dataset.lang || "";
            console.log(`[step-extractor] block ${wrap.dataset.blockId} lang="${lang}" isCommand=${COMMAND_LANGS.has(lang)}`);
            if (COMMAND_LANGS.has(lang))
                patchPromises.push(runInlinePatch(wrap, profile));
        });
    }
    else {
        console.log("[step-extractor] patcher skipped - B not healthy or disabled");
    }
    clientLog("info", "chat.assistant.render.done", "", { patcher_ready: Boolean(patcherReady), patch_promises: patchPromises.length });
    return patchPromises;
}
// ===== Patcher helpers =====
function extractPatcherReply(data) {
    const msg = data?.choices?.[0]?.message;
    if (!msg)
        return "";
    const content = (msg.content || "").trim();
    if (content)
        return content;
    const reasoning = (msg.reasoning_content || "").trim();
    if (!reasoning)
        return "";
    console.warn("[patcher] content empty, extracting from reasoning_content");
    const codeBlocks = [...reasoning.matchAll(/```[\w]*\n?([\s\S]*?)```/g)];
    if (codeBlocks.length)
        return codeBlocks[codeBlocks.length - 1][1].trim();
    const lines = reasoning.split("\n").map((l) => l.trim()).filter(Boolean);
    return lines[lines.length - 1] || "";
}
// ===== Inline Patcher =====
async function runInlinePatch(wrap, profile) {
    const original = wrap.dataset.original || "";
    const lang = wrap.dataset.lang || "";
    const prompt = [
        `You are a shell command patcher. The user's environment is:`,
        profileToSystemPrompt(profile),
        ``,
        `The assistant just produced this command block (language: ${lang}):`,
        "```",
        original,
        "```",
        ``,
        `If the command needs rewriting for the user's shell (${profile.shell}) or rules, respond with ONLY the corrected command - no markdown fences, no explanation. If no change is needed, respond with the single word: UNCHANGED`,
    ].join("\n");
    console.log(`[patcher] inline: blockId=${wrap.dataset.blockId} lang=${lang}`);
    clientLog("info", "patcher.inline.start", "", {
        block_id: wrap.dataset.blockId || "",
        lang,
        original_chars: original.length,
    });
    try {
        const r = await fetch("/api/chat/patcher", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: [
                    { role: "system", content: "/no_think" },
                    { role: "user", content: prompt },
                ],
                temperature: 0.1, max_tokens: 1024,
            }),
        });
        const data = await r.json();
        console.log(`[patcher] inline response (status ${r.status}) finish_reason=${data?.choices?.[0]?.finish_reason}:`, data?.choices?.[0]?.message);
        if (!r.ok) {
            console.warn("[patcher] inline: HTTP error", r.status, data);
            clientLog("warn", "patcher.inline.http_error", data?.detail || "", { status: r.status, block_id: wrap.dataset.blockId || "" });
            return;
        }
        const reply = extractPatcherReply(data);
        console.log(`[patcher] inline reply: "${reply}"`);
        if (!reply || reply === "UNCHANGED" || reply === original.trim()) {
            console.log("[patcher] inline: no change needed");
            clientLog("info", "patcher.inline.unchanged", "", { block_id: wrap.dataset.blockId || "" });
            return;
        }
        const cleaned = reply.replace(/^```\w*\n?/, "").replace(/\n?```$/, "").trim();
        if (cleaned.length < 3) {
            console.warn("[patcher] inline: reply too short, skipping");
            clientLog("warn", "patcher.inline.reply_too_short", "", { block_id: wrap.dataset.blockId || "", reply_chars: cleaned.length });
            return;
        }
        applyPatch(wrap, cleaned, `auto-translated to ${profile.shell}`, "inline");
        clientLog("info", "patcher.inline.patched", "", { block_id: wrap.dataset.blockId || "", patched_chars: cleaned.length });
    }
    catch (e) {
        console.error("[patcher] inline error:", e);
        clientLog("error", "patcher.inline.failed", stringifyLogArg(e), { block_id: wrap.dataset.blockId || "" });
    }
}
// applyPatch mutates block content, records the patch for Consolidation Pass, and attaches an undo badge.
function applyPatch(wrap, newContent, badgeText, source = "inline") {
    const pre = wrap.querySelector("pre");
    const code = pre.querySelector("code");
    code.textContent = newContent;
    // Record for Phase 2.5 Consolidation Pass
    currentTurnPatches.push({
        block_id: wrap.dataset.blockId || "",
        lang: wrap.dataset.lang || "",
        original: wrap.dataset.original || "",
        patched: newContent,
        source,
    });
    clientLog("info", "patch.apply", "", {
        block_id: wrap.dataset.blockId || "",
        lang: wrap.dataset.lang || "",
        source,
        original_chars: (wrap.dataset.original || "").length,
        patched_chars: newContent.length,
    });
    wrap.querySelector(".patch-badge")?.remove();
    const badge = document.createElement("div");
    badge.className = "patch-badge";
    badge.innerHTML = `<span>${badgeText}</span><button class="btn-undo">undo</button>`;
    wrap.appendChild(badge);
    badge.querySelector(".btn-undo").addEventListener("click", () => {
        code.textContent = wrap.dataset.original || "";
        const idx = currentTurnPatches.findIndex(p => p.block_id === (wrap.dataset.blockId || ""));
        if (idx !== -1)
            currentTurnPatches.splice(idx, 1);
        badge.remove();
        clientLog("info", "patch.undo", "", { block_id: wrap.dataset.blockId || "", source });
    });
    // Error Popup patches don't go through the inline patcher Promise chain, so trigger
    // Consolidation Pass separately with a short debounce (handles rapid multi-apply).
    if (source === "error_popup")
        scheduleConsolidationAfterErrorPopup(wrap);
}
// Debounced Consolidation Pass trigger for Error Popup applies.
// Finds the parent .msg element (the assistant turn div) by walking up the DOM.
function scheduleConsolidationAfterErrorPopup(wrap) {
    const consolidationOn = consolidationEnabledToggle?.checked ?? false;
    const patcherReady = lastStatus?.b.running && lastStatus.b.healthy && usePatcher.checked;
    if (!consolidationOn || !patcherReady)
        return;
    if (consolidationDebounceTimer !== null)
        clearTimeout(consolidationDebounceTimer);
    consolidationDebounceTimer = setTimeout(() => {
        consolidationDebounceTimer = null;
        const asstDiv = wrap.closest(".msg");
        if (!asstDiv || currentTurnPatches.length === 0)
            return;
        console.log(`[consolidation] error-popup trigger: ${currentTurnPatches.length} patch(es)`);
        clientLog("info", "consolidation.error_popup_trigger", "", { patches: currentTurnPatches.length });
        runConsolidationPass(asstDiv, currentTurnPatches.slice());
    }, 400);
}
// ===== Consolidation Pass (Phase 2.5) =====
function escHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// Rough token estimate - mirrors consolidation.py estimate_tokens()
function estimateTokens(patches) {
    return patches.reduce((sum, p) => sum + Math.floor((p.original.length + p.patched.length) / 4), 0);
}
// Build the string that gets injected into the next system prompt for a single entry
function buildConsolidationContext(data) {
    const modeLabel = data.mode === "full" ? "Consolidation Pass" : "Lightweight Patch Summary";
    const lines = [
        `[${modeLabel} - ${data.patch_count} patch(es) applied to the previous response]`,
        "",
        data.summary,
    ];
    if (data.state_delta)
        lines.push("", `Environment notes: ${data.state_delta}`);
    if (data.changed_steps.length > 0) {
        lines.push("", "Changed blocks:");
        data.changed_steps.forEach(s => lines.push(`  - ${s.step_id}: ${s.reason}`));
    }
    return lines.join("\n");
}
// Update the "Undo Last Consolidation" button state based on history length
function syncUndoBtn() {
    const btn = $("undoConsolidationBtn");
    if (btn)
        btn.disabled = consolidationHistory.length === 0;
}
// Roll back the last N consolidation entries, optionally triggered by the model.
// Injects a rollback notice into the next system prompt so Main-model is informed.
function rollbackConsolidation(n, triggeredBy) {
    if (consolidationHistory.length === 0)
        return;
    const toRemove = Math.min(n, consolidationHistory.length);
    const removed = consolidationHistory.slice(-toRemove);
    const firstV = removed[0].version;
    const lastV = removed[removed.length - 1].version;
    consolidationHistory.splice(-toRemove, toRemove);
    const newStart = consolidationHistory.length > 0
        ? consolidationHistory[consolidationHistory.length - 1].version
        : 0;
    // Build rollback notice - always injected into next turn's system prompt
    const notice = `[CONSOLIDATION UPDATE: Blocks v${firstV} to v${lastV} have been rolled back by ${triggeredBy}. Current consolidation history now starts from v${newStart}.]`;
    // Combine notice with the current top of history (if any), or use notice alone
    if (consolidationHistory.length > 0) {
        const top = consolidationHistory[consolidationHistory.length - 1];
        lastConsolidationSummary = notice + "\n\n" + top.builtSummary;
    }
    else {
        lastConsolidationSummary = notice;
    }
    const logMsg = `Consolidation rollback: removed v${firstV}-${lastV} (triggered by ${triggeredBy})`;
    addLog(logMsg, "log-info");
    console.log(`[consolidation] ${logMsg}`);
    clientLog("info", "consolidation.rollback", logMsg, { first_version: firstV, last_version: lastV, triggered_by: triggeredBy });
    syncUndoBtn();
}
// Check if the model's response contains a ROLLBACK_CONSOLIDATION:N command
function checkForRollbackCommand(text) {
    const m = text.match(/ROLLBACK_CONSOLIDATION:(\d+)/i);
    if (!m)
        return null;
    const n = parseInt(m[1], 10);
    return n > 0 ? n : null;
}
async function runConsolidationPass(asstDiv, patches) {
    const patcherReady = lastStatus?.b.running && lastStatus.b.healthy && usePatcher.checked;
    if (!patcherReady) {
        console.log("[consolidation] skipped - patcher not ready");
        clientLog("warn", "consolidation.skipped_not_ready");
        return;
    }
    if (!patches.length)
        return;
    const estTokens = estimateTokens(patches);
    console.log(`[consolidation] starting pass: ${patches.length} patch(es), ~${estTokens} tokens`);
    clientLog("info", "consolidation.start", "", { patches: patches.length, estimated_tokens: estTokens });
    try {
        const r = await fetch("/api/consolidation", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ patches }),
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            console.warn("[consolidation] server error:", r.status, err.detail || err);
            clientLog("error", "consolidation.server_error", err.detail || "", { status: r.status });
            return;
        }
        const data = await r.json();
        console.log("[consolidation] result:", data);
        if (!data.summary)
            return;
        // Build the injection string and store it as a versioned history entry
        const builtSummary = buildConsolidationContext(data);
        consolidationVersionCounter += 1;
        const entry = {
            version: consolidationVersionCounter,
            timestamp: Date.now(),
            mode: data.mode ?? "full",
            data,
            builtSummary,
        };
        consolidationHistory.push(entry);
        lastConsolidationSummary = builtSummary;
        syncUndoBtn();
        // Badge
        const modeLabel = data.mode === "lightweight" ? "Lightweight Summary" : "Consolidation Pass";
        const badge = document.createElement("div");
        badge.className = "consolidation-badge";
        badge.innerHTML =
            `<span class="consolidation-icon">*</span>` +
                `<span class="consolidation-text">v${consolidationVersionCounter} - ${modeLabel}: ${patches.length} change(s) summarized</span>` +
                `<button class="consolidation-details-btn">Details</button>`;
        asstDiv.appendChild(badge);
        // Details panel
        const details = document.createElement("div");
        details.className = "consolidation-details";
        details.style.display = "none";
        let html = `<div class="consolidation-summary-text">${escHtml(data.summary)}</div>`;
        if (data.changed_steps.length > 0) {
            html += "<ul>";
            data.changed_steps.forEach(s => {
                html += `<li><code>${escHtml(s.step_id)}</code>: ${escHtml(s.reason)}</li>`;
            });
            html += "</ul>";
        }
        if (data.state_delta) {
            html += `<div class="consolidation-state-delta">Env: ${escHtml(data.state_delta)}</div>`;
        }
        details.innerHTML = html;
        asstDiv.appendChild(details);
        badge.querySelector(".consolidation-details-btn").addEventListener("click", () => {
            details.style.display = details.style.display === "none" ? "block" : "none";
        });
        const logMsg = `${modeLabel} v${consolidationVersionCounter}: ${patches.length} change(s) summarized`;
        console.log(`[consolidation] ${logMsg}`);
        addLog(logMsg, "log-info");
        clientLog("info", "consolidation.done", logMsg, {
            version: consolidationVersionCounter,
            mode: data.mode,
            patches: patches.length,
            changed_steps: data.changed_steps.length,
        });
    }
    catch (e) {
        console.error("[consolidation] error:", e);
        clientLog("error", "consolidation.failed", stringifyLogArg(e));
    }
}
// ===== Error Popup =====
const errModal = $("errModal");
const errBlockEl = $("errBlock");
const errStderr = $("errStderr");
const errFixContainer = $("errFixContainer");
const errSubmit = $("errSubmit");
const errCancel = $("errCancel");
const errPaste = $("errPaste");
let errActiveWrap = null;
function openErrorModal(wrap) {
    clientLog("info", "error_popup.open", "", { block_id: wrap.dataset.blockId || "", lang: wrap.dataset.lang || "" });
    errActiveWrap = wrap;
    errBlockEl.textContent = wrap.querySelector("code")?.textContent || "";
    errStderr.value = "";
    errFixContainer.innerHTML = "";
    errSubmit.disabled = false;
    errSubmit.textContent = "Ask patcher";
    errModal.classList.add("show");
    setTimeout(() => errStderr.focus(), 50);
}
function closeErrorModal() {
    clientLog("info", "error_popup.close");
    errModal.classList.remove("show");
    errActiveWrap = null;
}
errCancel.addEventListener("click", closeErrorModal);
errModal.addEventListener("click", (e) => { if (e.target === errModal)
    closeErrorModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && errModal.classList.contains("show"))
    closeErrorModal(); });
errPaste.addEventListener("click", async () => {
    try {
        errStderr.value = await navigator.clipboard.readText();
        clientLog("info", "error_popup.paste.done", "", { chars: errStderr.value.length });
    }
    catch (e) {
        clientLog("error", "error_popup.paste.failed", stringifyLogArg(e));
        alert("Clipboard access denied");
    }
});
errSubmit.addEventListener("click", async () => {
    if (!errActiveWrap || !errStderr.value.trim())
        return;
    const code = errActiveWrap.querySelector("code")?.textContent || "";
    const profile = loadProfile();
    const prompt = [
        `User environment:`,
        profileToSystemPrompt(profile),
        ``,
        `The user ran this command:`,
        "```",
        code,
        "```",
        ``,
        `They got this error:`,
        "```",
        errStderr.value.trim(),
        "```",
        ``,
        `Propose a concrete fix. Respond with two sections: `,
        `1. "Fix:" - a one-line fixed command (no fences)`,
        `2. "Why:" - one short sentence`,
    ].join("\n");
    console.log("[patcher] error-popup prompt:\n" + prompt);
    clientLog("info", "error_popup.submit", "", {
        block_id: errActiveWrap.dataset.blockId || "",
        command_chars: code.length,
        stderr_chars: errStderr.value.trim().length,
    });
    errSubmit.disabled = true;
    errSubmit.textContent = "Thinking...";
    try {
        const r = await fetch("/api/chat/patcher", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: [
                    { role: "system", content: "/no_think" },
                    { role: "user", content: prompt },
                ],
                temperature: 0.2, max_tokens: 1500,
            }),
        });
        const data = await r.json();
        console.log(`[patcher] error-popup response (status ${r.status}) finish_reason=${data?.choices?.[0]?.finish_reason}:`, data?.choices?.[0]?.message);
        if (!r.ok)
            throw new Error(data?.detail || `HTTP ${r.status}`);
        const reply = extractPatcherReply(data);
        if (!reply)
            throw new Error(`No content in response. Keys: ${Object.keys(data).join(", ")}`);
        const fixMatch = reply.match(/Fix:\s*([\s\S]*?)(?:\n\s*Why:|\s*$)/i);
        const whyMatch = reply.match(/Why:\s*([\s\S]*)/i);
        const fix = (fixMatch?.[1] || reply).trim().replace(/^```\w*\n?/, "").replace(/\n?```$/, "").trim();
        const why = (whyMatch?.[1] || "").trim();
        errFixContainer.innerHTML = "";
        const box = document.createElement("div");
        box.className = "err-fix-box";
        box.innerHTML = `<div style="color:#86efac;font-weight:600;margin-bottom:4px">Proposed fix</div>
      <pre></pre>
      ${why ? `<div style="color:#aaa;font-size:12px">${why.replace(/</g, "&lt;")}</div>` : ""}
      <div style="margin-top:8px"><button class="err-btn-apply">Apply to block</button></div>`;
        box.querySelector("pre").textContent = fix;
        errFixContainer.appendChild(box);
        // Pass "error_popup" source so consolidation record distinguishes manual fixes
        box.querySelector(".err-btn-apply").addEventListener("click", () => {
            if (errActiveWrap)
                applyPatch(errActiveWrap, fix, "patched from error", "error_popup");
            clientLog("info", "error_popup.apply_fix", "", { fix_chars: fix.length });
            closeErrorModal();
        });
        clientLog("info", "error_popup.response.done", "", { fix_chars: fix.length, why_chars: why.length });
    }
    catch (e) {
        errFixContainer.innerHTML = `<div style="color:#fca5a5;font-size:13px">Patcher failed: ${e.message || e}</div>`;
        clientLog("error", "error_popup.response.failed", e.message || String(e));
    }
    finally {
        errSubmit.disabled = false;
        errSubmit.textContent = "Ask patcher";
    }
});
// ===== Streaming send =====
async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || streaming)
        return;
    if (!lastStatus?.a.running || !lastStatus.a.healthy) {
        checkChatReadiness();
        return;
    }
    clientLog("info", "chat.send.start", "", {
        user_chars: text.length,
        history_messages: chatHistoryArr.length,
        consolidation_pending: Boolean(lastConsolidationSummary),
        model_a_provider: lastStatus.a.provider,
        patcher_ready: Boolean(lastStatus.b.running && lastStatus.b.healthy && usePatcher.checked),
    });
    chatInput.value = "";
    const userMsg = { role: "user", content: text };
    chatHistoryArr.push(userMsg);
    renderMessage(userMsg);
    // Update sidebar title immediately so the new chat is identifiable while streaming.
    persistHistory();
    const asstMsg = { role: "assistant", content: "" };
    chatHistoryArr.push(asstMsg);
    const asstDiv = renderMessage(asstMsg);
    const asstContent = asstDiv.querySelector(".msg-content");
    asstContent.textContent = "...";
    streaming = true;
    chatSend.disabled = true;
    const profile = loadProfile();
    const systemParts = [profileToSystemPrompt(profile)];
    // Phase 2.5: inject Consolidation Pass summary from the previous turn
    const consolidationOn = consolidationEnabledToggle?.checked ?? false;
    if (consolidationOn && lastConsolidationSummary) {
        systemParts.push("\n\n" + lastConsolidationSummary);
        lastConsolidationSummary = null;
        console.log("[consolidation] injected summary into system prompt");
        clientLog("info", "consolidation.injected_into_prompt");
    }
    const body = {
        messages: [
            { role: "system", content: systemParts.join("") },
            ...chatHistoryArr.filter(m => m.role !== "system").slice(0, -1),
        ],
        stream: true,
        temperature: 0.7,
    };
    try {
        const r = await fetch("/api/chat/main", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok || !r.body) {
            const errText = await r.text();
            clientLog("error", "chat.main.http_error", errText, { status: r.status });
            throw new Error(errText || `HTTP ${r.status}`);
        }
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accumulated = "";
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
                const t = line.trim();
                if (!t.startsWith("data:"))
                    continue;
                const payload = t.slice(5).trim();
                if (payload === "[DONE]")
                    continue;
                try {
                    const obj = JSON.parse(payload);
                    const delta = obj?.choices?.[0]?.delta?.content;
                    if (delta) {
                        accumulated += delta;
                        asstContent.textContent = accumulated;
                        chatMessages.scrollTop = chatMessages.scrollHeight;
                    }
                }
                catch { /* ignore partial JSON */ }
            }
        }
        asstMsg.content = accumulated;
        asstContent.innerHTML = "";
        // Check if model issued a rollback command before rendering
        if (consolidationOn) {
            const rollbackN = checkForRollbackCommand(accumulated);
            if (rollbackN !== null) {
                console.log(`[consolidation] model issued ROLLBACK_CONSOLIDATION:${rollbackN}`);
                clientLog("info", "consolidation.rollback_command_detected", "", { n: rollbackN });
                rollbackConsolidation(rollbackN, "model");
            }
        }
        // Reset patch tracking for this turn before rendering
        currentTurnPatches = [];
        if (consolidationDebounceTimer !== null) {
            clearTimeout(consolidationDebounceTimer);
            consolidationDebounceTimer = null;
        }
        const patchPromises = renderAssistantContent(asstContent, accumulated);
        persistHistory();
        // Phase 2.5: once all inline patches settle, run Consolidation Pass if enabled.
        // Backend decides full vs lightweight based on smart thresholds.
        if (consolidationOn && patchPromises.length > 0) {
            Promise.allSettled(patchPromises).then(() => {
                if (currentTurnPatches.length > 0) {
                    const est = estimateTokens(currentTurnPatches);
                    console.log(`[consolidation] all inline patches done (${currentTurnPatches.length} patch(es), ~${est} tokens), requesting summary`);
                    clientLog("info", "consolidation.inline_patches_done", "", { patches: currentTurnPatches.length, estimated_tokens: est });
                    runConsolidationPass(asstDiv, currentTurnPatches.slice());
                }
                else {
                    console.log("[consolidation] all patches returned UNCHANGED, skipping");
                    clientLog("info", "consolidation.no_changed_inline_patches");
                }
            });
        }
        clientLog("info", "chat.send.done", "", { assistant_chars: accumulated.length });
    }
    catch (e) {
        asstContent.innerHTML = `<span style="color:#fca5a5">Error: ${e.message || e}</span>`;
        chatHistoryArr.pop();
        clientLog("error", "chat.send.failed", e.message || String(e));
    }
    finally {
        streaming = false;
        chatSend.disabled = false;
        chatInput.focus();
    }
}
chatSend.addEventListener("click", sendMessage);
chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});
chatClear.addEventListener("click", () => {
    const c = activeChat();
    if (!c || c.messages.length === 0)
        return;
    if (!confirm("Clear this conversation?"))
        return;
    clientLog("info", "chat.clear", "", { id: c.id, previous_messages: c.messages.length });
    c.messages.length = 0;
    c.title = "New chat";
    c.updatedAt = Date.now();
    persistChats();
    renderChatList();
    refreshActiveChat();
});
newChatBtn.addEventListener("click", () => {
    if (streaming)
        return;
    // If the current chat is empty, just stay on it instead of stacking empties.
    const c = activeChat();
    if (c && c.messages.length === 0)
        return;
    createNewChat(true);
});
// ========================================================================
// ==================== INIT =============================================
// ========================================================================
clientLog("info", "frontend.init.start");
loadLauncherSettings();
loadConfigFallback();
syncPatcherBlock();
hydrateProfileForm();
loadHistory();
clientLog("info", "frontend.init.done");
connectWs();
pollStatus();
setInterval(pollStatus, 3000);
handleProviderChange("A");
handleProviderChange("B");
// Persist Consolidation Pass toggle state across sessions
if (consolidationEnabledToggle) {
    const saved = localStorage.getItem("consolidationEnabled");
    if (saved !== null)
        consolidationEnabledToggle.checked = saved === "true";
    consolidationEnabledToggle.addEventListener("change", () => {
        localStorage.setItem("consolidationEnabled", String(consolidationEnabledToggle.checked));
    });
}
// Consolidation: load thresholds from backend, wire up threshold inputs and Undo button.
(async () => {
    try {
        const r = await fetch("/api/consolidation/config");
        if (r.ok) {
            const cfg = await r.json();
            consolidationPatchThreshold = cfg.patch_threshold ?? 8;
            consolidationTokenThreshold = cfg.token_threshold ?? 12000;
            const patchInput = $("consolidationPatchThreshold");
            const tokenInput = $("consolidationTokenThreshold");
            if (patchInput)
                patchInput.value = String(consolidationPatchThreshold);
            if (tokenInput)
                tokenInput.value = String(consolidationTokenThreshold);
        }
    }
    catch (_) { /* backend not running yet - use defaults */ }
})();
// Save threshold changes to backend and localStorage
async function saveConsolidationThresholds() {
    const patchInput = $("consolidationPatchThreshold");
    const tokenInput = $("consolidationTokenThreshold");
    const patchVal = parseInt(patchInput?.value || "8", 10);
    const tokenVal = parseInt(tokenInput?.value || "12000", 10);
    if (isNaN(patchVal) || isNaN(tokenVal) || patchVal < 1 || tokenVal < 1)
        return;
    consolidationPatchThreshold = patchVal;
    consolidationTokenThreshold = tokenVal;
    localStorage.setItem("consolidationPatchThreshold", String(patchVal));
    localStorage.setItem("consolidationTokenThreshold", String(tokenVal));
    try {
        await fetch("/api/consolidation/config", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ patch_threshold: patchVal, token_threshold: tokenVal }),
        });
    }
    catch (_) { /* ignore if backend not running */ }
}
const consolidationPatchInput = $("consolidationPatchThreshold");
const consolidationTokenInput = $("consolidationTokenThreshold");
if (consolidationPatchInput)
    consolidationPatchInput.addEventListener("change", saveConsolidationThresholds);
if (consolidationTokenInput)
    consolidationTokenInput.addEventListener("change", saveConsolidationThresholds);
// Restore thresholds from localStorage if saved (overrides backend defaults before fetch completes)
{
    const sp = localStorage.getItem("consolidationPatchThreshold");
    const st = localStorage.getItem("consolidationTokenThreshold");
    if (sp)
        consolidationPatchThreshold = parseInt(sp, 10);
    if (st)
        consolidationTokenThreshold = parseInt(st, 10);
}
// "Undo Last Consolidation" button
const undoConsolidationBtn = $("undoConsolidationBtn");
if (undoConsolidationBtn) {
    undoConsolidationBtn.disabled = true;
    undoConsolidationBtn.addEventListener("click", () => rollbackConsolidation(1, "user"));
}

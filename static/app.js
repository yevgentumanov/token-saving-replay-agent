"use strict";
// app.ts — Compile: npx tsc --target ES2020 --lib ES2020,DOM --strict --outDir . app.ts
// ===== Helpers =====
const $ = (id) => document.getElementById(id);
// ========================================================================
// ============ LAUNCHER TAB ==============================================
// ========================================================================
const pathA = $("pathA");
const argsA = $("argsA");
const portA = $("portA");
const pathB = $("pathB");
const argsB = $("argsB");
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
// Cloud / provider elements — Model A
const providerA = $("providerA");
const localFieldsA = $("localFieldsA");
const cloudFieldsA = $("cloudFieldsA");
const cloudModelSelectA = $("cloudModelSelectA");
const customModelFieldA = $("customModelFieldA");
const customModelA = $("customModelA");
const apiKeyA = $("apiKeyA");
// Cloud / provider elements — Model B
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
        { value: "__custom__", label: "Custom model ID…" },
    ],
    anthropic: [
        { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
        { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
        { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
        { value: "__custom__", label: "Custom model ID…" },
    ],
    groq: [
        { value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
        { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B (fast)" },
        { value: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
        { value: "__custom__", label: "Custom model ID…" },
    ],
};
const LAUNCHER_KEYS = [
    "pathA", "argsA", "portA", "pathB", "argsB", "portB", "llamaPath", "host", "usePatcher",
    "providerA", "cloudModelSelectA", "customModelA", "apiKeyA",
    "providerB", "cloudModelSelectB", "customModelB", "apiKeyB",
];
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
        const r = await fetch("/api/config");
        if (!r.ok)
            return;
        const c = await r.json();
        if (c.model_a_path)
            pathA.value = c.model_a_path;
        if (c.model_a_args)
            argsA.value = c.model_a_args;
        if (c.model_a_port)
            portA.value = String(c.model_a_port);
        if (c.model_b_path)
            pathB.value = c.model_b_path;
        if (c.model_b_args)
            argsB.value = c.model_b_args;
        if (c.model_b_port)
            portB.value = String(c.model_b_port);
        if (c.llama_server_path)
            llamaPath.value = c.llama_server_path;
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
    }
    catch (_) { }
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
let lastStatus = null;
function applyStatus(s, dot, label, chatBtn) {
    dot.className = "dot " + (!s.running ? "dot-gray" : s.vram_error ? "dot-red" : s.healthy ? "dot-green" : "dot-yellow");
    label.textContent = !s.running
        ? "Stopped"
        : s.vram_error ? "VRAM Error"
            : s.healthy
                ? (s.provider === "local" ? `Running (pid ${s.pid})` : `Ready (${s.provider})`)
                : "Starting…";
    chatBtn.style.display = (s.running && s.healthy && s.provider === "local") ? "block" : "none";
}
async function pollStatus() {
    try {
        const r = await fetch("/api/status");
        if (!r.ok)
            return;
        const s = await r.json();
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
    catch (_) { }
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
usePatcher.addEventListener("change", () => { syncPatcherBlock(); saveLauncherSettings(); });
async function browseFile(type, target, logMsg) {
    try {
        const r = await fetch(`/api/open-file-dialog?type=${type}`);
        const data = await r.json();
        if (data.path) {
            target.value = data.path;
            saveLauncherSettings();
            addLog(logMsg + data.path, "log-info");
        }
    }
    catch (e) {
        addLog("File dialog failed: " + e, "log-error");
    }
}
$("browseA").addEventListener("click", () => browseFile("model", pathA, "Model A: "));
$("browseB").addEventListener("click", () => browseFile("model", pathB, "Model B: "));
$("browseBin").addEventListener("click", () => browseFile("binary", llamaPath, "llama-server: "));
chatABtn.addEventListener("click", () => window.open(`http://localhost:${portA.value}`, "_blank"));
chatBBtn.addEventListener("click", () => window.open(`http://localhost:${portB.value}`, "_blank"));
// ===== Provider UI helpers =====
function populateCloudModels(select, provider) {
    select.innerHTML = "";
    const models = CLOUD_MODELS[provider] || [{ value: "__custom__", label: "Custom model ID…" }];
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
    addLog("Starting…", "log-info");
    const cloudModelA = cloudModelSelectA.value === "__custom__" ? customModelA.value.trim() : cloudModelSelectA.value;
    const cloudModelB = cloudModelSelectB.value === "__custom__" ? customModelB.value.trim() : cloudModelSelectB.value;
    const body = {
        model_a: {
            path: pathA.value.trim(), args: argsA.value.trim(), port: Number(portA.value),
            provider: providerA.value, api_key: apiKeyA.value.trim(), cloud_model: cloudModelA,
        },
        host: hostInput.value.trim(),
        llama_server_path: llamaPath.value.trim(),
    };
    if (usePatcher.checked && (pathB.value.trim() || providerB.value !== "local")) {
        body.model_b = {
            path: pathB.value.trim(), args: argsB.value.trim(), port: Number(portB.value),
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
            connectWs();
        }
    }
    catch (e) {
        addLog("Request failed: " + e, "log-error");
        startBtn.disabled = false;
    }
});
stopBtn.addEventListener("click", async () => {
    addLog("Stopping all…", "log-info");
    try {
        await fetch("/api/stop", { method: "POST" });
        addLog("Stopped", "log-info");
        ws?.close();
        ws = null;
    }
    catch (e) {
        addLog("Stop failed: " + e, "log-error");
    }
});
let ws = null;
function connectWs() {
    if (ws)
        return;
    ws = new WebSocket(`ws://${location.host}/ws/logs`);
    ws.onmessage = (e) => {
        if (e.data === "\x00")
            return;
        const cls = e.data.startsWith("[A]") ? "log-a" : e.data.startsWith("[B]") ? "log-b" : "";
        addLog(e.data, cls);
    };
    ws.onclose = () => { ws = null; setTimeout(connectWs, 3000); };
}
// ========================================================================
// ==================== TAB SWITCHING =====================================
// ========================================================================
document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
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
function loadProfile() {
    const raw = localStorage.getItem(PROFILE_KEY);
    const def = {
        shell: "powershell", os: "Windows",
        python_version: "", package_manager: "uv",
        naming_convention: "", custom_rules: "",
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
function saveProfile() {
    const p = {
        shell: ($("prof-shell")).value,
        os: ($("prof-os")).value,
        python_version: ($("prof-python")).value.trim(),
        package_manager: ($("prof-pkg")).value,
        naming_convention: ($("prof-naming")).value.trim(),
        custom_rules: ($("prof-rules")).value.trim(),
    };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
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
$("profileSave").addEventListener("click", saveProfile);
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
    if (p.custom_rules) {
        parts.push(`\nUser rules (follow strictly):`);
        p.custom_rules.split("\n").map(s => s.trim()).filter(Boolean).forEach(r => parts.push(`- ${r}`));
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
const HISTORY_KEY = "chatHistory";
let chatHistoryArr = [];
let streaming = false;
let blockCounter = 0;
let stepCounter = 0;
// ===== Phase 2.5 — Consolidation Pass state =====
let currentTurnPatches = [];
let lastConsolidationSummary = null;
let consolidationDebounceTimer = null;
// Versioned history: each successful consolidation appends a ConsolidationEntry
let consolidationHistory = [];
let consolidationVersionCounter = 0;
// Smart-threshold values — loaded from backend at init, updated via UI
let consolidationPatchThreshold = 8;
let consolidationTokenThreshold = 12000;
function loadHistory() {
    try {
        const raw = sessionStorage.getItem(HISTORY_KEY);
        chatHistoryArr = raw ? JSON.parse(raw) : [];
    }
    catch {
        chatHistoryArr = [];
    }
    chatMessages.innerHTML = "";
    chatHistoryArr.forEach(renderMessage);
}
function persistHistory() { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(chatHistoryArr)); }
function checkChatReadiness() {
    if (!lastStatus || !lastStatus.a.running || !lastStatus.a.healthy) {
        chatBanner.textContent = "⚠ Main Model (A) is not running. Go to Launcher tab and Start.";
        chatBanner.classList.add("show");
        chatSend.disabled = true;
    }
    else if (usePatcher.checked && (!lastStatus.b.running || !lastStatus.b.healthy)) {
        chatBanner.textContent = "ℹ Chat will work, but patcher (B) is offline — inline fixes disabled.";
        chatBanner.classList.add("show");
        chatSend.disabled = false;
    }
    else {
        chatBanner.classList.remove("show");
        chatSend.disabled = false;
    }
}
function renderMessage(msg) {
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
// Returns inline-patch Promises so sendMessage() can await them before running Consolidation Pass.
function renderAssistantContent(container, markdown) {
    const html = DOMPurify.sanitize(marked.parse(markdown));
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
        header.innerHTML = `<span class="lang">${lang || "code"} · ${blockId}</span>
      <span class="actions-small">
        <button class="btn-copy" title="Copy">Copy</button>
        <button class="btn-problem" title="I have a problem with this">⚠ Problem?</button>
      </span>`;
        wrap.appendChild(header);
        pre.replaceWith(wrap);
        wrap.appendChild(pre);
        const problemBar = document.createElement("div");
        problemBar.className = "btn-problem-bar";
        problemBar.innerHTML = `<button>⚠ Got an error with this command? Click to fix with patcher</button>`;
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
        console.log("[step-extractor] patcher skipped — B not healthy or disabled");
    }
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
        `If the command needs rewriting for the user's shell (${profile.shell}) or rules, respond with ONLY the corrected command — no markdown fences, no explanation. If no change is needed, respond with the single word: UNCHANGED`,
    ].join("\n");
    console.log(`[patcher] inline: blockId=${wrap.dataset.blockId} lang=${lang}`);
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
            return;
        }
        const reply = extractPatcherReply(data);
        console.log(`[patcher] inline reply: "${reply}"`);
        if (!reply || reply === "UNCHANGED" || reply === original.trim()) {
            console.log("[patcher] inline: no change needed");
            return;
        }
        const cleaned = reply.replace(/^```\w*\n?/, "").replace(/\n?```$/, "").trim();
        if (cleaned.length < 3) {
            console.warn("[patcher] inline: reply too short, skipping");
            return;
        }
        applyPatch(wrap, cleaned, `auto-translated → ${profile.shell}`, "inline");
    }
    catch (e) {
        console.error("[patcher] inline error:", e);
    }
}
// applyPatch — mutates block content, records the patch for Consolidation Pass, attaches undo badge.
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
    wrap.querySelector(".patch-badge")?.remove();
    const badge = document.createElement("div");
    badge.className = "patch-badge";
    badge.innerHTML = `<span>✓ ${badgeText}</span><button class="btn-undo">↶ undo</button>`;
    wrap.appendChild(badge);
    badge.querySelector(".btn-undo").addEventListener("click", () => {
        code.textContent = wrap.dataset.original || "";
        const idx = currentTurnPatches.findIndex(p => p.block_id === (wrap.dataset.blockId || ""));
        if (idx !== -1)
            currentTurnPatches.splice(idx, 1);
        badge.remove();
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
        runConsolidationPass(asstDiv, currentTurnPatches.slice());
    }, 400);
}
// ===== Consolidation Pass (Phase 2.5) =====
function escHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// Rough token estimate — mirrors consolidation.py estimate_tokens()
function estimateTokens(patches) {
    return patches.reduce((sum, p) => sum + Math.floor((p.original.length + p.patched.length) / 4), 0);
}
// Build the string that gets injected into the next system prompt for a single entry
function buildConsolidationContext(data) {
    const modeLabel = data.mode === "full" ? "Consolidation Pass" : "Lightweight Patch Summary";
    const lines = [
        `[${modeLabel} — ${data.patch_count} patch(es) applied to the previous response]`,
        "",
        data.summary,
    ];
    if (data.state_delta)
        lines.push("", `Environment notes: ${data.state_delta}`);
    if (data.changed_steps.length > 0) {
        lines.push("", "Changed blocks:");
        data.changed_steps.forEach(s => lines.push(`  • ${s.step_id}: ${s.reason}`));
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
    // Build rollback notice — always injected into next turn's system prompt
    const notice = `[CONSOLIDATION UPDATE: Blocks v${firstV} to v${lastV} have been rolled back by ${triggeredBy}. Current consolidation history now starts from v${newStart}.]`;
    // Combine notice with the current top of history (if any), or use notice alone
    if (consolidationHistory.length > 0) {
        const top = consolidationHistory[consolidationHistory.length - 1];
        lastConsolidationSummary = notice + "\n\n" + top.builtSummary;
    }
    else {
        lastConsolidationSummary = notice;
    }
    const logMsg = `Consolidation rollback: removed v${firstV}–v${lastV} (triggered by ${triggeredBy})`;
    addLog(logMsg, "log-info");
    console.log(`[consolidation] ${logMsg}`);
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
        console.log("[consolidation] skipped — patcher not ready");
        return;
    }
    if (!patches.length)
        return;
    const estTokens = estimateTokens(patches);
    console.log(`[consolidation] starting pass: ${patches.length} patch(es), ~${estTokens} tokens`);
    try {
        const r = await fetch("/api/consolidation", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ patches }),
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            console.warn("[consolidation] server error:", r.status, err.detail || err);
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
        // ── Badge ──────────────────────────────────────────────────────────────
        const modeLabel = data.mode === "lightweight" ? "Lightweight Summary" : "Consolidation Pass";
        const badge = document.createElement("div");
        badge.className = "consolidation-badge";
        badge.innerHTML =
            `<span class="consolidation-icon">⚡</span>` +
                `<span class="consolidation-text">v${consolidationVersionCounter} · ${modeLabel}: ${patches.length} change(s) summarized</span>` +
                `<button class="consolidation-details-btn">Details</button>`;
        asstDiv.appendChild(badge);
        // ── Details panel ──────────────────────────────────────────────────────
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
    }
    catch (e) {
        console.error("[consolidation] error:", e);
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
    errActiveWrap = wrap;
    errBlockEl.textContent = wrap.querySelector("code")?.textContent || "";
    errStderr.value = "";
    errFixContainer.innerHTML = "";
    errSubmit.disabled = false;
    errSubmit.textContent = "Ask patcher";
    errModal.classList.add("show");
    setTimeout(() => errStderr.focus(), 50);
}
function closeErrorModal() { errModal.classList.remove("show"); errActiveWrap = null; }
errCancel.addEventListener("click", closeErrorModal);
errModal.addEventListener("click", (e) => { if (e.target === errModal)
    closeErrorModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && errModal.classList.contains("show"))
    closeErrorModal(); });
errPaste.addEventListener("click", async () => {
    try {
        errStderr.value = await navigator.clipboard.readText();
    }
    catch {
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
        `1. "Fix:" — a one-line fixed command (no fences)`,
        `2. "Why:" — one short sentence`,
    ].join("\n");
    console.log("[patcher] error-popup prompt:\n" + prompt);
    errSubmit.disabled = true;
    errSubmit.textContent = "Thinking…";
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
      <div style="margin-top:8px"><button class="err-btn-apply">✓ Apply to block</button></div>`;
        box.querySelector("pre").textContent = fix;
        errFixContainer.appendChild(box);
        // Pass "error_popup" source so consolidation record distinguishes manual fixes
        box.querySelector(".err-btn-apply").addEventListener("click", () => {
            if (errActiveWrap)
                applyPatch(errActiveWrap, fix, "patched from error", "error_popup");
            closeErrorModal();
        });
    }
    catch (e) {
        errFixContainer.innerHTML = `<div style="color:#fca5a5;font-size:13px">Patcher failed: ${e.message || e}</div>`;
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
    chatInput.value = "";
    const userMsg = { role: "user", content: text };
    chatHistoryArr.push(userMsg);
    renderMessage(userMsg);
    const asstMsg = { role: "assistant", content: "" };
    chatHistoryArr.push(asstMsg);
    const asstDiv = renderMessage(asstMsg);
    const asstContent = asstDiv.querySelector(".msg-content");
    asstContent.textContent = "…";
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
                    runConsolidationPass(asstDiv, currentTurnPatches.slice());
                }
                else {
                    console.log("[consolidation] all patches returned UNCHANGED, skipping");
                }
            });
        }
    }
    catch (e) {
        asstContent.innerHTML = `<span style="color:#fca5a5">Error: ${e.message || e}</span>`;
        chatHistoryArr.pop();
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
    if (!confirm("Clear conversation?"))
        return;
    chatHistoryArr = [];
    blockCounter = 0;
    stepCounter = 0;
    currentTurnPatches = [];
    lastConsolidationSummary = null;
    consolidationHistory = [];
    consolidationVersionCounter = 0;
    chatMessages.innerHTML = "";
    sessionStorage.removeItem(HISTORY_KEY);
    syncUndoBtn();
});
// ========================================================================
// ==================== INIT =============================================
// ========================================================================
loadLauncherSettings();
loadConfigFallback();
syncPatcherBlock();
hydrateProfileForm();
loadHistory();
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
// ── Consolidation: load thresholds from backend, wire up threshold inputs and Undo button ──
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
    catch (_) { /* backend not running yet — use defaults */ }
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

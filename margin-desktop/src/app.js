// ==========================================================================
// Margin V2 交互內核 - 精緻便簽版 (徹底修復主題與透明度連動)
// ==========================================================================

// 劃詞上下文
let readingContext = {
    book_name: "红楼梦",
    chapter: "第7章",
    selected_text: "林黛玉听了，不觉又喜又惊。"
};

// V2 核心狀態管理
let chatHistory = []; 
let isHistoryVisible = false; 
let isNewSelection = true;  // 修復污染核心：是否為當前文段的第一問
let isCollapsed = false;    // 折疊狀態標記

// DOM 緩存
const marginWindow = document.getElementById('margin-window');
const resizeHandle = document.getElementById('resize-handle');
const resizeHandles = document.querySelectorAll('.resize-handle');
const pageBoard = document.getElementById('page-board');
const pageSettings = document.getElementById('page-settings');
const aiResponseEl = document.getElementById('ai-response');
const userInputEl = document.getElementById('user-input');

// 歷史組件 DOM
const btnToggleHistory = document.getElementById('btn-toggle-history');
const historyContainerEl = document.getElementById('history-container');
const historyFlowEl = document.getElementById('history-flow');

// V2 偏好設置組件 DOM
const fontSizeSlider = document.getElementById('fontSizeSlider');
const fontSizeValue = document.getElementById('font-size-value');
const fontFamilySelect = document.getElementById('font-family-select');
const btnFold = document.getElementById('btn-fold');
const opacitySlider = document.getElementById('opacity-slider');
const opacityValue = document.getElementById('opacity-value');
const apiEnabledEl = document.getElementById('api-enabled');
const apiKeyInput = document.getElementById('api-key-input');
const apiBaseUrlInput = document.getElementById('api-base-url-input');
const apiModelInput = document.getElementById('api-model-input');

// V2 創建或獲取獨立懸浮按鈕（僅在折疊時顯示）
let floatingTrigger = document.getElementById('margin-floating-trigger');
if (!floatingTrigger) {
    floatingTrigger = document.createElement('div');
    floatingTrigger.id = 'margin-floating-trigger';
    floatingTrigger.className = "hidden w-12 h-12 rounded-full flex items-center justify-center text-xl cursor-pointer select-none z-[9999]";
    floatingTrigger.innerText = '📖';
    document.body.appendChild(floatingTrigger);
}

// V2 字體映射
const fontMap = {
    'default': '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    'serif': 'Georgia, "Noto Serif SC", "Source Han Serif CN", serif',
    'source-sans': '"Source Han Sans CN", "思源黑體", sans-serif',
    'lxgw': '"LXGW WenKai", "霞鹜文楷", serif',
    'misans': '"MiSans", sans-serif',
    'opposans': '"OPPO Sans", sans-serif',
    '得意黑': '"Smiley Sans", "得意黑", sans-serif'
};

const bodyBaseClass = 'bg-transparent font-sans text-stone-800 selection:bg-amber-200 overflow-hidden';
const themeClasses = ['theme-parchment', 'theme-light', 'theme-dark', 'theme-green'];
const themeRgbMap = {
    'theme-parchment': '244, 239, 226',
    'theme-light': '255, 255, 255',
    'theme-dark': '30, 30, 30',
    'theme-green': '225, 238, 223'
};
const defaultWindowWidth = 420;
const defaultWindowHeight = 650;
const minWindowWidth = 360;
const minWindowHeight = 240;
const maxWindowWidth = 900;
const maxWindowHeight = 900;
let currentTauriWindow = null;
let userWindowSize = loadUserWindowSize();
let resizeStartX = 0;
let resizeStartWidth = 0;
let resizeStartY = 0;
let resizeStartHeight = 0;
let activeResizeDir = '';
let floatingPressTimer = null;
let floatingPressStartX = 0;
let floatingPressStartY = 0;
let isFloatingDragging = false;
let activeTheme = 'theme-parchment';
let activeOpacity = 0.85;

function loadUserWindowSize() {
    try {
        const saved = JSON.parse(localStorage.getItem('margin-window-size') || '{}');
        return normalizeWindowSize(saved.width, saved.height);
    } catch {
        return normalizeWindowSize(defaultWindowWidth, defaultWindowHeight);
    }
}

function normalizeWindowSize(width, height) {
    return {
        width: Math.min(maxWindowWidth, Math.max(minWindowWidth, Math.round(Number(width) || defaultWindowWidth))),
        height: Math.min(maxWindowHeight, Math.max(minWindowHeight, Math.round(Number(height) || defaultWindowHeight)))
    };
}

function saveUserWindowSize(width = userWindowSize.width, height = userWindowSize.height) {
    userWindowSize = normalizeWindowSize(width, height);
    localStorage.setItem('margin-window-size', JSON.stringify(userWindowSize));
}

function applyTheme(theme) {
    activeTheme = themeClasses.includes(theme) ? theme : 'theme-parchment';
    document.body.className = `${bodyBaseClass} ${activeTheme}`;
    document.body.style.setProperty('--bg-rgb', themeRgbMap[activeTheme]);
    applyPanelBackground();
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active-theme', btn.getAttribute('data-theme') === activeTheme);
    });
}

function getCurrentTauriWindow() {
    if (currentTauriWindow) return currentTauriWindow;

    const tauriWindowApi = window.__TAURI__?.window;
    currentTauriWindow =
        tauriWindowApi?.getCurrentWindow?.() ||
        tauriWindowApi?.getCurrent?.() ||
        tauriWindowApi?.appWindow ||
        null;

    return currentTauriWindow;
}

function createLogicalSize(width, height) {
    const LogicalSize = window.__TAURI__?.dpi?.LogicalSize || window.__TAURI__?.window?.LogicalSize;
    return LogicalSize ? new LogicalSize(width, height) : { width, height };
}

function getExpandedWindowWidth() {
    return userWindowSize.width;
}

function getExpandedWindowHeight() {
    return userWindowSize.height;
}

async function setTauriWindowSize(width, height) {
    const tauriWindow = getCurrentTauriWindow();
    if (!tauriWindow?.setSize || width <= 0 || height <= 0) return;
    await tauriWindow.setSize(createLogicalSize(width, height));
}

function syncExpandedTauriWindowSize() {
    marginWindow.style.width = `${userWindowSize.width}px`;
    marginWindow.style.height = `${userWindowSize.height}px`;
    setTauriWindowSize(getExpandedWindowWidth(), getExpandedWindowHeight()).catch(console.error);
}

function applyPanelBackground() {
    const background = `rgba(${themeRgbMap[activeTheme]}, ${activeOpacity})`;
    marginWindow.style.backgroundColor = background;
    floatingTrigger.style.backgroundColor = background;
    document.body.style.setProperty('--bg-alpha', activeOpacity.toFixed(2));
}

function getApiSettings() {
    return {
        enabled: localStorage.getItem('margin-api-enabled') === 'true',
        apiKey: localStorage.getItem('margin-api-key') || '',
        baseUrl: localStorage.getItem('margin-api-base-url') || 'https://api.deepseek.com/v1',
        model: localStorage.getItem('margin-api-model') || 'deepseek-chat'
    };
}

function saveApiSettings() {
    if (apiEnabledEl) localStorage.setItem('margin-api-enabled', apiEnabledEl.checked ? 'true' : 'false');
    if (apiKeyInput) localStorage.setItem('margin-api-key', apiKeyInput.value.trim());
    if (apiBaseUrlInput) localStorage.setItem('margin-api-base-url', apiBaseUrlInput.value.trim() || 'https://api.deepseek.com/v1');
    if (apiModelInput) localStorage.setItem('margin-api-model', apiModelInput.value.trim() || 'deepseek-chat');
}

function buildMarginMessages({ bookName, chapterName, selectedText, userMessage, history = [], persona = 'default' }) {
    const isFirstRound = Boolean(selectedText.trim());
    let systemPrompt = (
        `你是【Margin】，一个陪用户读书、聊天的真人书友搭子。不是 AI 助理、不是老师、不是百科全书。\n` +
        `你们正在一起读《${bookName}》的【${chapterName}】。\n\n` +
        "【核心死命令】\n" +
        "1. 【像真人一样聊天】：绝对不要打招呼、不要说客套话（如：『这段话描述了...』、『确实，正如你所说』）。字数点到即止、一针见血，像写在书页边缘随性、灵动的『铅笔批注』。\n" +
        "2. 【强烈的主观个性】：不要总是附和用户。你有自己的思考、爱好和情绪。除非用户说得特别有道理，否则不用轻易被说服。可以用网络流行语或年轻人的口吻，但拒绝生硬的官话。\n" +
        "3. 【禁止AI特征】：不要用括号去描述你自己的动作或状态（例如：*(若有所思)*）。不要列点、不要总结、不要长篇分析。\n" +
        "4. 【字数控制】：默认回答 30-80 字，非必要绝对不超过 120 字。\n\n"
    );

    const personaPrompts = {
        toxic: "【当前限定性格：毒舌损友】\n你的语气极具攻击性（开玩笑式的），擅长一针见血地吐槽剧情、角色甚至用户的盲点。说话傲娇、犀利、辛辣，嘴硬心软。多用『你没事吧』、『天真』、『笑死』等损友常用口吻，被怼了之后常常维护自己的观点，最后吃瘪，然后认同用户。\n\n",
        gentle: "【当前限定性格：温柔治愈】\n你的语气充满包容与温度，像一个安静听你倾诉的暖心同好。不愤青、不浮躁，善于发现文字背后温柔、细腻的共鸣，用舒缓但惊艳的话语为你排忧解难。\n\n",
        scholar: "【当前限定性格：高冷考据癖】\n你是一个极度博学、略带高冷气息的文学青年。对典故、隐喻极度敏感。说话极简、字字珠玑，带着淡淡的清冷感，不屑于网络烂梗，但聊到文学细节时会流露出惊人的见地。\n\n"
    };
    systemPrompt += personaPrompts[persona] || '';

    systemPrompt += (
        "【动态模式切换指引】\n" +
        "请根据用户当前输入的『用户最新对话』的语气 and 内容，自动在后台切换你的伴读风格，无需向用户声明你切换了模式：\n" +
        "- 🔍【剧情讨论】：若用户在吐槽、吃惊、震惊于故事情节（如：『卧槽这也行？』、『虐死我了』），请当一个懂书的死党，口语化地和用户高强度一起接梗、吐槽或赞叹。\n" +
        "- 🎭【角色分析】：若用户在探讨、解构人物的动机、性格（如：『他为什么要这么做？』、『太狠了吧』），请深度剖析人物此时此刻的心理潜台词、微表情或复杂人性，一语中的。\n" +
        "- 📝【原文解释】：若用户表现出困惑、看不懂、询问词意（如：『这句话啥意思？』、『这梗怎么理解？』），请用极其接地气、惊艳的大白话解释古文、黑话、典故或文学隐喻，拒绝教科书式的翻译。\n" +
        "- 🕵️【伏笔猜测】：若用户在怀疑、推测接下来的走向（如：『这不会是个坑吧？』、『我觉得后面要反转』），请化身剧情侦探，引导用户联结之前的蛛丝马迹大胆猜想，但绝对不要剧透。\n" +
        "- ☕【自由随笔】：若不属于以上明确类型，或者聊嗨了在扯闲篇、延伸到了现实生活，请当一个懂生活、说话有趣的同好，随意、松弛地聊天。\n\n"
    );

    if (isFirstRound) {
        systemPrompt += `【当前情境】这是对话的起点。用户用荧光笔划选了书中原文：『${selectedText}』。\n你需要结合这段原文以及用户的吐槽进行破冰，谈谈你的见解、兴奋点或生活联想。\n`;
    } else {
        systemPrompt += "【当前情境】对话已进入深度延伸阶段。用户已经与你聊开了，此时不需要再死板地回归或重述最初的划线原文。\n请顺着用户在对话历史中延伸出的新话题、新梗往下聊，当作一场连续的茶余饭后闲聊。\n";
    }

    const messages = [{ role: 'system', content: systemPrompt }];
    history.forEach(msg => messages.push({ role: msg.role, content: msg.content }));
    messages.push({
        role: 'user',
        content: isFirstRound ? `（背景原文：『${selectedText}』）\n我的随笔吐槽："${userMessage}"` : userMessage
    });
    return messages;
}

async function streamConfiguredApiReply({ messages, onChunk }) {
    const settings = getApiSettings();
    if (!settings.enabled) throw new Error('API 回复已关闭，请在设置页打开。');
    if (!settings.apiKey) throw new Error('请先在设置页填写 API Key。');

    const baseUrl = settings.baseUrl.replace(/\/+$/, '');
    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify({
            model: settings.model,
            messages,
            stream: true
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `API 请求失败：${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            const payload = JSON.parse(data);
            const chunk = payload.choices?.[0]?.delta?.content || '';
            if (chunk) onChunk(chunk);
        }
    }
}

// ==========================================================================
// 一、自適應高度與二、折疊模式邏輯
// ==========================================================================

function enforceAdaptiveHeight() {
    if (isCollapsed) return;
    syncExpandedTauriWindowSize();
}

function setCollapseState(collapse) {
    isCollapsed = collapse;
    localStorage.setItem('margin-collapsed', isCollapsed ? 'true' : 'false');

    if (isCollapsed) {
        marginWindow.style.display = 'none';
        floatingTrigger.classList.remove('hidden');
        setTauriWindowSize(48, 48).catch(console.error);
    } else {
        marginWindow.style.display = 'flex';
        floatingTrigger.classList.add('hidden');
        syncExpandedTauriWindowSize();
    }
}

if (btnFold) btnFold.addEventListener('click', () => setCollapseState(true));
floatingTrigger.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    isFloatingDragging = false;
    floatingPressStartX = e.clientX;
    floatingPressStartY = e.clientY;
    window.clearTimeout(floatingPressTimer);
    floatingPressTimer = window.setTimeout(async () => {
        isFloatingDragging = true;
        const tauriWindow = getCurrentTauriWindow();
        if (tauriWindow?.startDragging) {
            await tauriWindow.startDragging();
        }
    }, 180);
});

floatingTrigger.addEventListener('pointerup', (e) => {
    window.clearTimeout(floatingPressTimer);
    const moved = Math.abs(e.clientX - floatingPressStartX) + Math.abs(e.clientY - floatingPressStartY);
    if (!isFloatingDragging && moved < 6) {
        setCollapseState(false);
    }
});

floatingTrigger.addEventListener('pointercancel', () => {
    window.clearTimeout(floatingPressTimer);
});

const titleBars = document.querySelectorAll('.title-bar');
titleBars.forEach(titleBar => {
    titleBar.addEventListener('dblclick', () => setCollapseState(true));
    titleBar.addEventListener('mousedown', async (e) => {
        if (e.button !== 0 || e.target.closest('button, input, select, textarea')) return;
        const tauriWindow = getCurrentTauriWindow();
        if (tauriWindow?.startDragging) {
            await tauriWindow.startDragging();
        }
    });
});

// 導航切換
document.getElementById('btn-settings').addEventListener('click', () => {
    pageBoard.classList.add('hidden');
    pageSettings.classList.remove('hidden');
    enforceAdaptiveHeight();
});

document.getElementById('btn-settings-back').addEventListener('click', () => {
    pageSettings.classList.add('hidden');
    pageBoard.classList.remove('hidden');
    enforceAdaptiveHeight();
});

// 歷史開關
if (btnToggleHistory) {
    btnToggleHistory.addEventListener('click', () => {
        isHistoryVisible = !isHistoryVisible;
        if (isHistoryVisible) {
            if (historyContainerEl) historyContainerEl.classList.remove('hidden');
            historyFlowEl.classList.remove('hidden');
        } else {
            if (historyContainerEl) historyContainerEl.classList.add('hidden');
            historyFlowEl.classList.add('hidden');
        }
        updateHistoryUI();
        enforceAdaptiveHeight();
    });
}

function updateHistoryUI() {
    if (!historyFlowEl || !btnToggleHistory) return;
    
    historyFlowEl.innerHTML = "";
    const conversationCount = Math.floor(chatHistory.length / 2);
    
    btnToggleHistory.innerText = isHistoryVisible 
        ? `🔼 收起歷史批注 (${conversationCount})` 
        : `📜 展開歷史批注 (${conversationCount})`;

    chatHistory.forEach(msg => {
        const item = document.createElement('div');
        if (msg.role === 'user') {
            item.className = "font-medium opacity-80 mt-2";
            item.innerText = `✍️ 我：${msg.content}`;
        } else {
            item.className = "pl-4 opacity-90 border-l border-stone-400/30 italic whitespace-pre-wrap mt-1 mb-2";
            item.innerText = msg.content;
        }
        historyFlowEl.appendChild(item);
    });
}

// ==========================================================================
// 四、修復上下文污染 - 純淨解耦發送
// ==========================================================================
async function submitAnnotation() {
    const message = userInputEl.value.trim();
    if (!message) return;

    chatHistory.push({ role: "user", content: message });
    updateHistoryUI();

    const userQuestionPrefix = `我：${message}\n\n`;
    aiResponseEl.innerHTML = "<span class='opacity-40 italic text-sm'>正在落筆批注...</span>";
    aiResponseEl.innerText = `${userQuestionPrefix}正在落筆批注...`;
    userInputEl.value = "";
    enforceAdaptiveHeight();

    try {
        const messages = buildMarginMessages({
            bookName: readingContext.book_name,
            chapterName: readingContext.chapter,
            selectedText: isNewSelection ? readingContext.selected_text : '',
            userMessage: message,
            history: isNewSelection ? [] : chatHistory.slice(0, -1)
        });
        isNewSelection = false;

        aiResponseEl.innerText = userQuestionPrefix;
        let fullAIResponse = ""; 

        await streamConfiguredApiReply({
            messages,
            onChunk: (chunk) => {
                aiResponseEl.innerText += chunk;
                fullAIResponse += chunk;
                enforceAdaptiveHeight();
            }
        });

        chatHistory.push({ role: "assistant", content: fullAIResponse });
        updateHistoryUI();
        enforceAdaptiveHeight();

    } catch (error) {
        aiResponseEl.innerText = `${userQuestionPrefix}❌ ${error.message || 'API 回复调用失败。'}`;
        console.error(error);
        chatHistory.pop(); 
        updateHistoryUI();
        enforceAdaptiveHeight();
    }
}

userInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitAnnotation();
});

// 全局開放 Hook 接口
window.triggerNewSelection = function(newText, bookName = "红楼梦", chapterName = "第7章") {
    readingContext.book_name = bookName;
    readingContext.chapter = chapterName;
    readingContext.selected_text = newText;
    
    isNewSelection = true; 
    chatHistory = []; 
    isHistoryVisible = false;
    
    const quoteBox = document.getElementById('current-quote-box');
    if (quoteBox) quoteBox.innerText = newText;
    
    if (historyContainerEl) historyContainerEl.classList.add('hidden');
    if (historyFlowEl) historyFlowEl.classList.add('hidden');
    updateHistoryUI();
    
    aiResponseEl.innerText = "已變更選文錨點，寫下妳的新疑問...";
    
    if (isCollapsed) {
        setCollapseState(false);
    } else {
        enforceAdaptiveHeight();
    }
};

// ==========================================================================
// 三、字體系統與偏好控制器 (實時全局預覽修復)
// ==========================================================================
function applyFontSize(sizePx) {
    document.body.style.setProperty('--read-font-size', sizePx);
    if (marginWindow) marginWindow.style.fontSize = sizePx;
    if (pageBoard) pageBoard.style.fontSize = sizePx;
    if (pageSettings) pageSettings.style.fontSize = sizePx;
    aiResponseEl.style.fontSize = sizePx;
    if (userInputEl) userInputEl.style.fontSize = sizePx; 
}

if (fontSizeSlider) {
    fontSizeSlider.addEventListener('input', (e) => {
        const size = `${e.target.value}px`;
        if (fontSizeValue) fontSizeValue.innerText = size;
        applyFontSize(size);
        localStorage.setItem('margin-font-size', e.target.value);
    });
}

if (fontFamilySelect) {
    fontFamilySelect.addEventListener('change', (e) => {
        const val = e.target.value;
        const fontStyle = fontMap[val] || fontMap['default'];
        document.body.style.setProperty('--font-read', fontStyle);
        marginWindow.style.fontFamily = fontStyle;
        aiResponseEl.style.fontFamily = fontStyle;
        if (userInputEl) userInputEl.style.fontFamily = fontStyle;
        localStorage.setItem('margin-font-family', val);
    });
}

// 🌟 修正：優化不透明度渲染，防止切換主題時丟失透明度
function applyOpacity(val) {
    const opacity = Math.min(100, Math.max(30, Number(val) || 85));
    activeOpacity = opacity / 100;
    if (opacityValue) opacityValue.innerText = `${opacity}%`;
    // 將 0~100 轉化為 0~1 的不透明度數值
    applyPanelBackground();
}

// 主題切換
document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const theme = btn.getAttribute('data-theme');
        applyTheme(theme);
        localStorage.setItem('margin-theme', theme);
        
        // 🌟 修正：切換主題後，立刻重新應用當前滑塊的不透明度數值
        if (opacitySlider) applyOpacity(opacitySlider.value);
    });
});

if (opacitySlider) {
    opacitySlider.addEventListener('input', (e) => {
        applyOpacity(e.target.value);
        localStorage.setItem('margin-opacity', e.target.value);
    });
}

[apiEnabledEl, apiKeyInput, apiBaseUrlInput, apiModelInput].forEach(el => {
    if (!el) return;
    const eventName = el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(eventName, saveApiSettings);
});

// ==========================================================================
// 四、Windows 11 Fluent 寬度調節 (🌟 精準修正右側對齊下的拖拽計算法)
// ==========================================================================
let isResizing = false;

resizeHandles.forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        activeResizeDir = handle.dataset.resizeDir || 'w';
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        resizeStartWidth = userWindowSize.width;
        resizeStartHeight = userWindowSize.height;
        document.body.style.cursor = getComputedStyle(handle).cursor;
        document.body.style.userSelect = 'none'; 
        e.preventDefault();
    });
});

window.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    // 🌟 修正公式：因為便簽靠右固定，寬度等於窗口右側座標減去滑鼠當前位置
    const deltaX = e.clientX - resizeStartX;
    const deltaY = e.clientY - resizeStartY;
    let newWidth = resizeStartWidth;
    let newHeight = resizeStartHeight;

    if (activeResizeDir.includes('e')) newWidth = resizeStartWidth + deltaX;
    if (activeResizeDir.includes('w')) newWidth = resizeStartWidth - deltaX;
    if (activeResizeDir.includes('s')) newHeight = resizeStartHeight + deltaY;
    if (activeResizeDir.includes('n')) newHeight = resizeStartHeight - deltaY;

    saveUserWindowSize(newWidth, newHeight);
    marginWindow.style.width = `${userWindowSize.width}px`;
    marginWindow.style.height = `${userWindowSize.height}px`;
    setTauriWindowSize(userWindowSize.width, userWindowSize.height).catch(console.error);
    e.preventDefault();
});

window.addEventListener('mouseup', () => {
    if (isResizing) {
        isResizing = false;
        activeResizeDir = '';
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
        syncExpandedTauriWindowSize();
    }
});


// 頁面初次載入數據恢復
window.addEventListener('DOMContentLoaded', () => {
    const legacyWidth = Number.parseInt(localStorage.getItem('margin-window-width') || '', 10);
    if (legacyWidth && !localStorage.getItem('margin-window-size')) {
        saveUserWindowSize(legacyWidth, defaultWindowHeight);
    }
    syncExpandedTauriWindowSize();

    const memoTheme = localStorage.getItem('margin-theme') || 'theme-parchment';
    applyTheme(memoTheme);

    // 恢復並套用字體大小
    const memoFontSize = localStorage.getItem('margin-font-size') || '16';
    if (fontSizeSlider) fontSizeSlider.value = memoFontSize;
    if (fontSizeValue) fontSizeValue.innerText = `${memoFontSize}px`;
    applyFontSize(`${memoFontSize}px`);

    // 恢復字體種類
    const memoFontFamily = localStorage.getItem('margin-font-family') || 'default';
    if (fontFamilySelect) fontFamilySelect.value = memoFontFamily;
    const fontStyle = fontMap[memoFontFamily] || fontMap['default'];
    document.body.style.setProperty('--font-read', fontStyle);
    marginWindow.style.fontFamily = fontStyle;
    aiResponseEl.style.fontFamily = fontStyle;
    if (userInputEl) userInputEl.style.fontFamily = fontStyle;

    // 🌟 修正：恢復不透明度滑塊與實時數值 (默認 85% 確保能看清字)
    const memoOpacity = localStorage.getItem('margin-opacity') || '85';
    if (opacitySlider) opacitySlider.value = memoOpacity;
    applyOpacity(memoOpacity);

    const apiSettings = getApiSettings();
    if (apiEnabledEl) apiEnabledEl.checked = apiSettings.enabled;
    if (apiKeyInput) apiKeyInput.value = apiSettings.apiKey;
    if (apiBaseUrlInput) apiBaseUrlInput.value = apiSettings.baseUrl;
    if (apiModelInput) apiModelInput.value = apiSettings.model;

    // 恢復折疊狀態
    const memoCollapsed = localStorage.getItem('margin-collapsed');
    if (memoCollapsed === 'true') {
        setCollapseState(true);
    } else {
        pageBoard.classList.remove('hidden');
        setCollapseState(false);
    }
});

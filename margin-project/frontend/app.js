// ==========================================================================
// Margin V2 交互內核 - 精緻便簽版 (徹底修復主題與透明度連動)
// ==========================================================================

const USER_TOKEN = "user_token_123456"; 

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
const pageBoard = document.getElementById('page-board');
const pageSettings = document.getElementById('page-settings');
const aiResponseEl = document.getElementById('ai-response');
const userInputEl = document.getElementById('user-input');

// 歷史組件 DOM
const btnToggleHistory = document.getElementById('btn-toggle-history');
const historyFlowEl = document.getElementById('history-flow');

// V2 偏好設置組件 DOM
const fontSizeSlider = document.getElementById('fontSizeSlider');
const fontSizeValue = document.getElementById('font-size-value');
const fontFamilySelect = document.getElementById('font-family-select');
const btnFold = document.getElementById('btn-fold');
const opacitySlider = document.getElementById('opacity-slider');
const opacityValue = document.getElementById('opacity-value');

// V2 創建或獲取獨立懸浮按鈕（僅在折疊時顯示）
let floatingTrigger = document.getElementById('margin-floating-trigger');
if (!floatingTrigger) {
    floatingTrigger = document.createElement('div');
    floatingTrigger.id = 'margin-floating-trigger';
    floatingTrigger.className = "fixed hidden right-6 bottom-12 w-12 h-12 rounded-full flex items-center justify-center text-xl cursor-pointer select-none z-[9999]";
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

// ==========================================================================
// 一、自適應高度與二、折疊模式邏輯
// ==========================================================================

function enforceAdaptiveHeight() {
    if (isCollapsed) return;
    marginWindow.style.height = "auto"; 
}

function setCollapseState(collapse) {
    isCollapsed = collapse;
    localStorage.setItem('margin-collapsed', isCollapsed ? 'true' : 'false');

    if (isCollapsed) {
        marginWindow.style.display = 'none';
        floatingTrigger.classList.remove('hidden');
    } else {
        marginWindow.style.display = 'flex';
        floatingTrigger.classList.add('hidden');
        
        const memoWidth = localStorage.getItem('margin-window-width') || '420px';
        marginWindow.style.width = memoWidth;
        
        marginWindow.style.height = "650px";
        setTimeout(() => { enforceAdaptiveHeight(); }, 150);
    }
}

if (btnFold) btnFold.addEventListener('click', () => setCollapseState(true));
floatingTrigger.addEventListener('click', () => setCollapseState(false));

const titleBar = document.querySelector('.title-bar');
if (titleBar) {
    titleBar.addEventListener('dblclick', () => setCollapseState(true));
}

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
            historyFlowEl.classList.remove('hidden');
        } else {
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

    aiResponseEl.innerHTML = "<span class='opacity-40 italic text-sm'>正在落筆批注...</span>";
    userInputEl.value = "";
    enforceAdaptiveHeight();

    let payload = {};

    if (isNewSelection) {
        payload = {
            book_name: readingContext.book_name,
            chapter: readingContext.chapter,
            selected_text: readingContext.selected_text,
            user_message: message,
            history: [] 
        };
        isNewSelection = false; 
    } else {
        payload = {
            user_message: message,            
            history: chatHistory.slice(0, -1) 
        };
    }

    try {
        const response = await fetch('http://127.0.0.1:8000/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': USER_TOKEN
            },
            body: JSON.stringify(payload)
        });

        if (response.status === 401) {
            aiResponseEl.innerText = "❌ 身份驗證失敗。";
            return;
        }

        aiResponseEl.innerText = ""; 
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullAIResponse = ""; 

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            aiResponseEl.innerText += chunk; 
            fullAIResponse += chunk; 
            enforceAdaptiveHeight();
        }

        chatHistory.push({ role: "assistant", content: fullAIResponse });
        updateHistoryUI();
        enforceAdaptiveHeight();

    } catch (error) {
        aiResponseEl.innerText = "❌ 無法連接到本地 Margin 服務。";
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
    if (pageBoard) pageBoard.style.fontSize = sizePx;
    aiResponseEl.style.fontSize = sizePx;
    if (userInputEl) userInputEl.style.fontSize = sizePx; 
}

if (fontSizeSlider) {
    fontSizeSlider.addEventListener('input', (e) => {
        const size = `${e.target.value}px`;
        if (fontSizeValue) fontSizeValue.innerText = size;
        applyFontSize(size);
        localStorage.setItem('margin-font-size', e.target.value);
        enforceAdaptiveHeight();
    });
}

if (fontFamilySelect) {
    fontFamilySelect.addEventListener('change', (e) => {
        const val = e.target.value;
        const fontStyle = fontMap[val] || fontMap['default'];
        document.body.style.setProperty('--font-read', fontStyle);
        aiResponseEl.style.fontFamily = fontStyle;
        localStorage.setItem('margin-font-family', val);
    });
}

// 🌟 修正：優化不透明度渲染，防止切換主題時丟失透明度
function applyOpacity(val) {
    if (opacityValue) opacityValue.innerText = `${val}%`;
    // 將 0~100 轉化為 0~1 的不透明度數值
    const alpha = (val / 100).toFixed(2);
    marginWindow.style.setProperty('background-color', `var(--bg-base)`.replace('0.85', alpha), 'important');
    marginWindow.style.backgroundColor = `var(--bg-base)`.replace('0.85', alpha);
}

// 主題切換
document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const theme = btn.getAttribute('data-theme');
        document.body.className = theme; 

        btn.parentElement.querySelector('.active-theme').classList.remove('active-theme');
        btn.classList.add('active-theme');

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

// ==========================================================================
// 四、Windows 11 Fluent 寬度調節 (🌟 精準修正右側對齊下的拖拽計算法)
// ==========================================================================
let isResizing = false;

if (resizeHandle) {
    resizeHandle.addEventListener('mousedown', () => {
        isResizing = true;
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none'; 
    });
}

window.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    // 🌟 修正公式：因為便簽靠右固定，寬度等於窗口右側座標減去滑鼠當前位置
    let newWidth = window.innerWidth - e.clientX;
    if (newWidth < 420) newWidth = 420;
    if (newWidth > 700) newWidth = 700;
    marginWindow.style.width = `${newWidth}px`;
});

window.addEventListener('mouseup', () => {
    if (isResizing) {
        isResizing = false;
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
        localStorage.setItem('margin-window-width', marginWindow.style.width);
    }
});

// 頁面初次載入數據恢復
window.addEventListener('DOMContentLoaded', () => {
    const memoWidth = localStorage.getItem('margin-window-width');
    if (memoWidth) marginWindow.style.width = memoWidth;

    const memoTheme = localStorage.getItem('margin-theme') || 'theme-parchment';
    document.body.className = memoTheme;
    document.querySelectorAll('.theme-btn').forEach(b => {
        b.classList.toggle('active-theme', b.getAttribute('data-theme') === memoTheme);
    });

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
    aiResponseEl.style.fontFamily = fontStyle;

    // 🌟 修正：恢復不透明度滑塊與實時數值 (默認 85% 確保能看清字)
    const memoOpacity = localStorage.getItem('margin-opacity') || '85';
    if (opacitySlider) opacitySlider.value = memoOpacity;
    applyOpacity(memoOpacity);

    // 恢復折疊狀態
    const memoCollapsed = localStorage.getItem('margin-collapsed');
    if (memoCollapsed === 'true') {
        setCollapseState(true);
    } else {
        pageBoard.classList.remove('hidden');
        setCollapseState(false);
    }
});
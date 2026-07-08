const readerContent = document.getElementById('reader-content');
const bookFileInput = document.getElementById('book-file');
const bookTitleEl = document.getElementById('book-title');
const themeSelect = document.getElementById('theme-select');
const fontFamilySelect = document.getElementById('font-family');
const textColorInput = document.getElementById('text-color');
const fontSizeInput = document.getElementById('font-size');
const fontSizeValue = document.getElementById('font-size-value');
const lineHeightInput = document.getElementById('line-height');
const lineHeightValue = document.getElementById('line-height-value');
const prevPageButton = document.getElementById('prev-page');
const nextPageButton = document.getElementById('next-page');
const pageCurrentEl = document.getElementById('page-current');
const pageTotalEl = document.getElementById('page-total');

const fontMap = {
    system: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    serif: '"Songti SC", SimSun, Georgia, serif',
    kai: '"Kaiti SC", KaiTi, "楷体", serif',
    hei: '"Microsoft YaHei", "PingFang SC", sans-serif'
};

let pages = [];
let currentPageIndex = 0;

function applyReaderSettings() {
    document.body.className = themeSelect.value === 'paper' ? '' : `theme-${themeSelect.value}`;
    document.documentElement.style.setProperty('--reader-font', fontMap[fontFamilySelect.value]);
    document.documentElement.style.setProperty('--text-color', textColorInput.value);
    document.documentElement.style.setProperty('--reader-font-size', `${fontSizeInput.value}px`);
    document.documentElement.style.setProperty('--reader-line-height', lineHeightInput.value);
    fontSizeValue.textContent = `${fontSizeInput.value}px`;
    lineHeightValue.textContent = lineHeightInput.value;
}

function escapeHtml(text) {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function textToParagraphs(text) {
    return text
        .replace(/\r\n/g, '\n')
        .split(/\n{2,}/)
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`)
        .join('');
}

function htmlToSafeBody(text) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/html');
    doc.querySelectorAll('script, iframe, object, embed, style').forEach(node => node.remove());
    return doc.body.innerHTML || textToParagraphs(doc.body.textContent || text);
}

function splitIntoPages(html) {
    const source = html.trim();
    if (!source) return [];

    const chunks = source.match(/(<p[\s\S]*?<\/p>|<h[1-6][\s\S]*?<\/h[1-6]>|[\s\S]{1,1200})/g) || [source];
    const result = [];
    let page = '';

    chunks.forEach(chunk => {
        if ((page + chunk).length > 5200 && page) {
            result.push(page);
            page = chunk;
        } else {
            page += chunk;
        }
    });

    if (page) result.push(page);
    return result;
}

function renderPage(index) {
    if (!pages.length) return;
    currentPageIndex = Math.min(Math.max(index, 0), pages.length - 1);
    readerContent.innerHTML = pages[currentPageIndex];
    pageCurrentEl.textContent = String(currentPageIndex + 1);
    pageTotalEl.textContent = String(pages.length);
    readerContent.scrollTop = 0;
}

function goToPreviousPage() {
    renderPage(currentPageIndex - 1);
}

function goToNextPage() {
    renderPage(currentPageIndex + 1);
}

async function importBook(file) {
    if (!file) return;

    const text = await file.text();
    const lowerName = file.name.toLowerCase();
    const html = lowerName.endsWith('.html') || lowerName.endsWith('.htm')
        ? htmlToSafeBody(text)
        : textToParagraphs(text);

    pages = splitIntoPages(html);
    if (!pages.length) {
        alert('导入失败：书籍内容为空。');
        return;
    }

    bookTitleEl.textContent = file.name;
    renderPage(0);
    readerContent.focus();
}

function handleSelectionCapture() {
    // 关键防错：只有真的选中了 5 个字以上，才触发后续逻辑，避免盲点页面造成空请求。
    const selectedText = window.getSelection().toString().trim();
    if (selectedText.length <= 5) return;

    alert(`【前端捕获成功】你选中的句子是：${selectedText}`);
}

[themeSelect, fontFamilySelect, textColorInput, fontSizeInput, lineHeightInput].forEach(control => {
    control.addEventListener('input', applyReaderSettings);
    control.addEventListener('change', applyReaderSettings);
});

bookFileInput.addEventListener('change', event => {
    importBook(event.target.files[0]);
});

prevPageButton.addEventListener('click', goToPreviousPage);
nextPageButton.addEventListener('click', goToNextPage);

// 必须监听阅读区域 mouseup，用户划线结束后在这里捕获选中文本。
readerContent.addEventListener('mouseup', handleSelectionCapture);

document.addEventListener('keydown', event => {
    if (event.target.matches('input, select, textarea')) return;

    if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        goToPreviousPage();
    }

    if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        goToNextPage();
    }
});

applyReaderSettings();
pages = [readerContent.innerHTML];
renderPage(0);

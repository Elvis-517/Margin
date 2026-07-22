let currentFontSize = 18;
let currentLineHeight = 1.8;
let totalPagesMock = 1;
let currentPageMock = 1;
let pageMode = 'paged';
let activePageChunks = [];
let activeBookTitle = '';
let pageScrollPositions = new Map();
let scrollPageArmedDirection = null;
let scrollPageArmedAt = 0;
let scrollPageArmedReady = false;
let isPageTransitionLocked = false;
const importedBookStore = new Map();
const shelfCategories = [];
const deletedBookIds = new Set();
let activeContextBookId = '';
let activeTauriBook = null;
let activeTauriBookPromise = null;
let activeSelectionPayload = null;
let pendingTauriSelectionTimer = null;
let pendingTauriSelectionPayload = null;
const tauriSelectionIdleDelay = 2500;
let activeSelectionRange = null;
let activeSelectionPageIndex = -1;
let activeSelectionOffsets = null;
let activeBookKey = '';
let activeClickedAnnotationId = '';
let readerHighlightColor = localStorage.getItem('margin-reader-highlight-color') || '#facc15';
let readerNoteColor = localStorage.getItem('margin-reader-note-color') || '#60a5fa';
let annotationStore = loadAnnotationStore();
const annotationStoreKey = 'margin-reader-annotations-v1';
const selectionActionBar = document.getElementById('selection-action-bar');


function loadAnnotationStore() {
    try {
        return JSON.parse(localStorage.getItem('margin-reader-annotations-v1') || '{}');
    } catch {
        return {};
    }
}

function saveAnnotationStore() {
    localStorage.setItem(annotationStoreKey, JSON.stringify(annotationStore));
}

function getBookAnnotations(bookKey = activeBookKey) {
    if (!bookKey) return [];
    if (!annotationStore[bookKey]) annotationStore[bookKey] = [];
    return annotationStore[bookKey];
}

function makeBookKey(title, storedBook) {
    return storedBook?.id || storedBook?.title || title || 'margin-default-book';
}

function getPageAnnotations(pageIndex) {
    return getBookAnnotations().filter(item => item.pageIndex === pageIndex);
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}

function findOverlappingAnnotations(pageIndex, startOffset, endOffset) {
    return getPageAnnotations(pageIndex).filter(item => rangesOverlap(item.startOffset, item.endOffset, startOffset, endOffset));
}

function getSelectionOffsetsInRenderedPage(range) {
    const page = range?.commonAncestorContainer?.parentElement?.closest?.('.reader-page')
        || range?.commonAncestorContainer?.closest?.('.reader-page')
        || readerTextArea.querySelector(`.reader-page[data-page="${currentPageMock}"]`);
    const pageBody = page?.querySelector('.reader-page-body');
    if (!pageBody || !range) return null;
    const beforeRange = document.createRange();
    beforeRange.selectNodeContents(pageBody);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const selectedRange = range.cloneRange();
    return {
        pageIndex: Math.max(0, Number(page.dataset.page || currentPageMock) - 1),
        startOffset: beforeRange.toString().length,
        endOffset: beforeRange.toString().length + selectedRange.toString().length
    };
}


function setAnnotationColors() {
    document.documentElement.style.setProperty('--reader-highlight-color', readerHighlightColor);
    document.documentElement.style.setProperty('--reader-note-color', readerNoteColor);
    const highlightInput = document.getElementById('highlight-color-picker');
    const noteInput = document.getElementById('note-color-picker');
    if (highlightInput) highlightInput.value = readerHighlightColor;
    if (noteInput) noteInput.value = readerNoteColor;
}




function hideSelectionActionBar() {
    if (selectionActionBar) selectionActionBar.classList.add('hidden');
}

function cancelPendingTauriSelectionSync() {
    if (pendingTauriSelectionTimer) window.clearTimeout(pendingTauriSelectionTimer);
    pendingTauriSelectionTimer = null;
    pendingTauriSelectionPayload = null;
}

function hasCompleteTauriQuotePayload(payload) {
    return Boolean(
        payload?.quote_text &&
        payload?.book_id &&
        payload?.chapter_id &&
        Number.isInteger(payload?.start_offset) &&
        Number.isInteger(payload?.end_offset) &&
        payload.end_offset > payload.start_offset
    );
}

function scheduleTauriSelectionSync(payload) {
    cancelPendingTauriSelectionSync();
    if (!payload?.quote_text) return;
    pendingTauriSelectionPayload = payload;
    pendingTauriSelectionTimer = window.setTimeout(async () => {
        const nextPayload = pendingTauriSelectionPayload;
        pendingTauriSelectionTimer = null;
        pendingTauriSelectionPayload = null;
        if (hasCompleteTauriQuotePayload(nextPayload)) {
            await invokeTauriCommand('sync_selected_quote', nextPayload);
        } else {
            console.warn('Skip Tauri quote sync: incomplete spoiler-safe context.', nextPayload);
        }
    }, tauriSelectionIdleDelay);
}

function setSelectionActionBarMode(hasExistingAnnotation) {
    if (!selectionActionBar) return;
    const highlightButton = selectionActionBar.querySelector('[data-action="highlight"]');
    const noteButton = selectionActionBar.querySelector('[data-action="note"]');
    const removeButton = selectionActionBar.querySelector('[data-action="remove"]');
    if (highlightButton) highlightButton.hidden = hasExistingAnnotation;
    if (noteButton) noteButton.hidden = hasExistingAnnotation;
    if (removeButton) removeButton.hidden = !hasExistingAnnotation;
}

function showSelectionActionBarFromRange(range, hasExistingAnnotation = false) {
    if (!selectionActionBar || !range) return;
    setSelectionActionBarMode(hasExistingAnnotation);
    const rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return;
    selectionActionBar.style.left = `${Math.min(window.innerWidth - 190, rect.right + 12)}px`;
    selectionActionBar.style.top = `${Math.max(12, rect.top + rect.height / 2 - 18)}px`;
    selectionActionBar.classList.remove('hidden');
}

function showSelectionActionBarAtRect(rect, hasExistingAnnotation = false) {
    if (!selectionActionBar || !rect) return;
    setSelectionActionBarMode(hasExistingAnnotation);
    selectionActionBar.style.left = `${Math.min(window.innerWidth - 190, rect.right + 12)}px`;
    selectionActionBar.style.top = `${Math.max(12, rect.top + rect.height / 2 - 18)}px`;
    selectionActionBar.classList.remove('hidden');
}

function updateActivePageChunkFromDom(pageIndex = activeSelectionPageIndex) {
    const page = readerTextArea.querySelector(`.reader-page[data-page="${pageIndex + 1}"] .reader-page-body`);
    if (!page || !activePageChunks[pageIndex]) return;
    activePageChunks[pageIndex] = page.innerHTML;
}

function applyAnnotationsToChunk(chunkHtml, pageIndex) {
    const template = document.createElement('template');
    template.innerHTML = chunkHtml;
    const annotations = getPageAnnotations(pageIndex)
        .slice()
        .sort((a, b) => b.startOffset - a.startOffset || b.endOffset - a.endOffset);

    annotations.forEach(annotation => wrapAnnotationInFragment(template.content, annotation));
    return template.innerHTML;
}

function wrapAnnotationInFragment(root, annotation) {
    let cursor = 0;
    const targets = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    });

    while (walker.nextNode()) {
        const node = walker.currentNode;
        const start = cursor;
        const end = cursor + node.nodeValue.length;
        if (rangesOverlap(start, end, annotation.startOffset, annotation.endOffset)) {
            targets.push({
                node,
                startOffset: Math.max(0, annotation.startOffset - start),
                endOffset: Math.min(node.nodeValue.length, annotation.endOffset - start)
            });
        }
        cursor = end;
    }

    targets.reverse().forEach(target => wrapAnnotationTextNode(target.node, target.startOffset, target.endOffset, annotation));
}

function wrapAnnotationTextNode(node, startOffset, endOffset, annotation) {
    if (!node || startOffset >= endOffset) return;
    const range = document.createRange();
    range.setStart(node, startOffset);
    range.setEnd(node, endOffset);
    const mark = document.createElement('mark');
    mark.className = annotation.type === 'note' ? 'reader-highlight reader-note-highlight' : 'reader-highlight';
    mark.dataset.annotationId = annotation.id;
    mark.dataset.annotationType = annotation.type;
    mark.style.setProperty('--annotation-color', annotation.color || (annotation.type === 'note' ? readerNoteColor : readerHighlightColor));
    if (annotation.type === 'note') {
        mark.dataset.note = annotation.note || '';
        mark.title = annotation.note || 'note';
    }
    const fragment = range.extractContents();
    mark.appendChild(fragment);
    range.insertNode(mark);
}

function addAnnotation(type, noteText = '') {
    cancelPendingTauriSelectionSync();
    if (!activeSelectionOffsets || activeSelectionOffsets.startOffset < 0 || activeSelectionOffsets.endOffset <= activeSelectionOffsets.startOffset) return false;
    const overlaps = findOverlappingAnnotations(activeSelectionOffsets.pageIndex, activeSelectionOffsets.startOffset, activeSelectionOffsets.endOffset);
    if (overlaps.length) {
        alert('\u8fd9\u6bb5\u6587\u5b57\u5df2\u7ecf\u6709\u9ad8\u5149\u6216 note \u4e86\uff0c\u4e0d\u80fd\u53e0\u52a0\u3002\u8bf7\u5148\u53d6\u6d88\u539f\u6807\u6ce8\u3002');
        hideSelectionActionBar();
        return false;
    }

    const annotation = {
        id: `ann-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        type,
        bookKey: activeBookKey,
        bookTitle: activeBookTitle,
        pageIndex: activeSelectionOffsets.pageIndex,
        startOffset: activeSelectionOffsets.startOffset,
        endOffset: activeSelectionOffsets.endOffset,
        text: activeSelectionOffsets.text,
        note: noteText,
        color: type === 'note' ? readerNoteColor : readerHighlightColor,
        createdAt: new Date().toISOString()
    };

    getBookAnnotations().push(annotation);
    saveAnnotationStore();
    renderVirtualPages({ restoreScroll: true });
    renderNotesSummary();
    window.getSelection().removeAllRanges();
    hideSelectionActionBar();
    activeSelectionRange = null;
    activeSelectionOffsets = null;
    activeSelectionPageIndex = -1;
    return true;
}

function applyReaderHighlight() {
    addAnnotation('highlight');
}

function applyReaderNote() {
    cancelPendingTauriSelectionSync();
    openNoteEditor({
        title: '\u5199 note',
        text: activeSelectionOffsets?.text || '',
        note: '',
        onSave(note) {
            addAnnotation('note', note);
        }
    });
}

function removeAnnotationById(annotationId) {
    cancelPendingTauriSelectionSync();
    if (!annotationId || !activeBookKey) return;
    annotationStore[activeBookKey] = getBookAnnotations().filter(item => item.id !== annotationId);
    saveAnnotationStore();
    activeClickedAnnotationId = '';
    renderVirtualPages({ restoreScroll: true });
    renderNotesSummary();
    hideSelectionActionBar();
}

function removeSelectedAnnotations() {
    cancelPendingTauriSelectionSync();
    if (activeClickedAnnotationId) {
        removeAnnotationById(activeClickedAnnotationId);
        return;
    }
    if (!activeSelectionOffsets) return;
    const removeIds = new Set(findOverlappingAnnotations(activeSelectionOffsets.pageIndex, activeSelectionOffsets.startOffset, activeSelectionOffsets.endOffset).map(item => item.id));
    if (!removeIds.size) return;
    annotationStore[activeBookKey] = getBookAnnotations().filter(item => !removeIds.has(item.id));
    saveAnnotationStore();
    renderVirtualPages({ restoreScroll: true });
    renderNotesSummary();
    hideSelectionActionBar();
}

function ensureNoteModal() {
    let modal = document.getElementById('note-editor-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'note-editor-modal';
        modal.className = 'note-editor-modal hidden';
        document.body.appendChild(modal);
    }
    return modal;
}

function openNoteEditor({ title, text, note, onSave, onDelete }) {
    const modal = ensureNoteModal();
    modal.classList.remove('hidden');
    modal.innerHTML = `
        <div class="note-editor-card">
            <div class="note-editor-head">
                <strong>${escapeHtml(title)}</strong>
                <button type="button" data-note-close aria-label="\u5173\u95ed">&times;</button>
            </div>
            <blockquote>${escapeHtml(text || '')}</blockquote>
            <textarea id="note-editor-textarea" placeholder="\u5199\u4e0b\u4f60\u7684\u60f3\u6cd5\uff0c\u50cf\u7ed9\u8fd9\u53e5\u8bdd\u7559\u4e00\u6761\u77ed\u8bc4\u3002">${escapeHtml(note || '')}</textarea>
            <div class="note-editor-actions">
                ${onDelete ? '<button type="button" data-note-delete>删除 note</button>' : ''}
                <button type="button" data-note-close>\u53d6\u6d88</button>
                <button type="button" data-note-save>\u4fdd\u5b58</button>
            </div>
        </div>`;
    modal.querySelectorAll('[data-note-close]').forEach(button => button.onclick = () => modal.classList.add('hidden'));
    const deleteButton = modal.querySelector('[data-note-delete]');
    if (deleteButton) {
        deleteButton.onclick = () => {
            onDelete?.();
            modal.classList.add('hidden');
        };
    }
    modal.querySelector('[data-note-save]').onclick = () => {
        const value = modal.querySelector('#note-editor-textarea').value.trim();
        if (!value) return;
        onSave(value);
        modal.classList.add('hidden');
    };
}

function changeAnnotationColor(type, value) {
    if (type === 'note') {
        readerNoteColor = value;
        localStorage.setItem('margin-reader-note-color', value);
    } else {
        readerHighlightColor = value;
        localStorage.setItem('margin-reader-highlight-color', value);
    }
    setAnnotationColors();
}

function renderNotesSummary() {
    const panel = document.getElementById('notes-summary');
    if (!panel) return;
    const notes = Object.values(annotationStore)
        .flat()
        .filter(item => item.type === 'note')
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (!notes.length) {
        panel.innerHTML = '<h4>\u6211\u7684 note</h4><p class="notes-empty">\u8fd8\u6ca1\u6709 note\u3002\u5212\u7ebf\u540e\u9009\u62e9 note\uff0c\u5c31\u4f1a\u6c47\u603b\u5230\u8fd9\u91cc\u3002</p>';
        return;
    }
    panel.innerHTML = '<h4>\u6211\u7684 note</h4><div class="notes-list"></div>';
    const list = panel.querySelector('.notes-list');
    notes.forEach(note => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'note-summary-item';
        item.innerHTML = `<strong>${escapeHtml(note.bookTitle || '\u672a\u77e5\u4e66\u7c4d')}</strong><span>${escapeHtml(note.text || '')}</span><em>${escapeHtml(note.note || '')}</em>`;
        item.onclick = () => openNoteEditor({
            title: '\u67e5\u770b note',
            text: note.text || '',
            note: note.note || '',
            onSave(value) {
                note.note = value;
                note.updatedAt = new Date().toISOString();
                saveAnnotationStore();
                renderNotesSummary();
                if (activeBookKey === note.bookKey) renderVirtualPages({ restoreScroll: true });
            },
            onDelete() {
                annotationStore[note.bookKey] = (annotationStore[note.bookKey] || []).filter(item => item.id !== note.id);
                saveAnnotationStore();
                renderNotesSummary();
                if (activeBookKey === note.bookKey) renderVirtualPages({ restoreScroll: true });
            }
        });
        list.appendChild(item);
    });
}


if (selectionActionBar) {
    selectionActionBar.addEventListener('mousedown', event => event.preventDefault());
    selectionActionBar.addEventListener('click', event => {
        const action = event.target?.dataset?.action;
        if (action === 'highlight') applyReaderHighlight();
        if (action === 'note') applyReaderNote();
        if (action === 'remove') removeSelectedAnnotations();
    });
}

function getTauriInvoke() {
    return window.__TAURI__?.core?.invoke || window.__TAURI__?.tauri?.invoke || window.__TAURI__?.invoke || null;
}

async function invokeTauriCommand(command, payload) {
    const invoke = getTauriInvoke();
    if (invoke) {
        try {
            return await invoke(command, payload ? { payload } : undefined);
        } catch (error) {
            console.warn(`Tauri command ${command} failed`, error);
        }
    }

    return await invokeMarginBridge(command, payload);
}

async function invokeMarginBridge(command, payload) {
    const bridgeMap = {
        import_book_content: '/import_book_content',
        sync_selected_quote: '/sync_selected_quote'
    };
    const path = bridgeMap[command];
    if (!path) return null;

    try {
        const response = await fetch(`http://127.0.0.1:37521${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || `Margin bridge failed: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.warn(`Margin bridge ${command} failed`, error);
        return null;
    }
}

function buildBackendChaptersFromPages() {
    return activePageChunks.map((chunk, index) => ({
        title: `\u7b2c ${index + 1} \u9875`,
        plain_text: stripHtml(chunk).trim(),
        html_content: chunk
    })).filter(chapter => chapter.plain_text.length > 0);
}

async function ensureActiveBookRegistered(storedBook, contentMode) {
    if (storedBook?.tauriBook && storedBook.tauriBook.pageCount === activePageChunks.length) {
        activeTauriBook = storedBook.tauriBook;
        return activeTauriBook;
    }

    const chapters = buildBackendChaptersFromPages();
    if (!chapters.length) return null;

    const response = await invokeTauriCommand('import_book_content', {
        file_name: `${activeBookTitle || 'untitled'}.html`,
        file_type: contentMode || 'html',
        title: activeBookTitle || 'Untitled Book',
        author: storedBook?.typeLabel || null,
        chapters
    });

    if (!response?.book_id || !Array.isArray(response.chapters)) return null;

    activeTauriBook = {
        bookId: response.book_id,
        title: response.title || activeBookTitle,
        chapters: response.chapters,
        pageCount: activePageChunks.length
    };
    if (storedBook) storedBook.tauriBook = activeTauriBook;
    return activeTauriBook;
}


function findTextOffsetsLoose(sourceText, selectedText) {
    const sourceChars = Array.from(sourceText);
    const selectedChars = Array.from(selectedText);
    const normalizedSource = [];
    const sourceIndexMap = [];
    const normalizedSelected = selectedChars.filter(character => !/\s/.test(character));

    sourceChars.forEach((character, index) => {
        if (/\s/.test(character)) return;
        normalizedSource.push(character);
        sourceIndexMap.push(index);
    });

    if (!normalizedSelected.length) return { startOffset: null, endOffset: null };

    const haystack = normalizedSource.join('');
    const needle = normalizedSelected.join('');
    const normalizedIndex = haystack.indexOf(needle);
    if (normalizedIndex < 0) return { startOffset: null, endOffset: null };

    const startOffset = sourceIndexMap[normalizedIndex];
    const lastMatchedOriginalIndex = sourceIndexMap[normalizedIndex + normalizedSelected.length - 1];
    return {
        startOffset,
        endOffset: lastMatchedOriginalIndex + 1
    };
}

function buildSelectionSyncPayload(selectedText) {
    const pageIndex = Math.max(0, currentPageMock - 1);
    const pagePlainText = stripHtml(activePageChunks[pageIndex] || '');
    const { startOffset, endOffset } = findTextOffsetsLoose(pagePlainText, selectedText);
    const chapter = activeTauriBook?.chapters?.[pageIndex];
    const quoteId = `quote-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return {
        quote_id: quoteId,
        book_id: activeTauriBook?.bookId || activeTauriBook?.book_id || null,
        chapter_id: chapter?.id || null,
        book_name: activeTauriBook?.title || activeBookTitle || 'Untitled Book',
        chapter_name: chapter?.title || `\u7b2c ${currentPageMock} \u9875`,
        quote_text: selectedText,
        start_offset: startOffset,
        end_offset: endOffset
    };
}

const readerScrollContainer = document.getElementById('reader-scroll-container');
const readerTextArea = document.getElementById('reader-text-area');
const readerTitle = document.getElementById('active-book-title');
function switchTab(tabId) {
    document.querySelectorAll('.tab-view').forEach(view => view.classList.add('hidden'));
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.getElementById('reader-view').classList.add('hidden');

    document.getElementById(`tab-${tabId}`).classList.remove('hidden');
    document.getElementById(`nav-${tabId}`).classList.add('active');
    if (tabId === 'mine') renderNotesSummary();
}

function setGlobalTheme(mode) {
    const body = document.body;
    if (mode === 'dark') {
        body.className = 'theme-global-dark';
        changeReaderTheme('dark');
    } else {
        body.className = 'theme-global-light';
        changeReaderTheme('light');
    }
}

document.getElementById('file-uploader').addEventListener('change', async function(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const book = await convertToHtml(file);
        if (!book.content.trim()) {
            alert('没有识别到可阅读内容，请换 TXT、MD、HTML、DOC 或 DOCX 文件试试。');
            return;
        }
        appendBookToGrid(book.title, book.content, book.typeLabel, book.mode || 'text');
        e.target.value = '';
    } catch (error) {
        console.error(error);
        alert('导入失败：当前文件内容无法解析。');
    }
});

async function convertToHtml(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    const title = file.name.replace(/\.[^.]+$/, '') || file.name;
    const buffer = await file.arrayBuffer();
    const decodedText = decodeBestText(buffer);

    if (extension === 'html' || extension === 'htm') {
        return { title, content: htmlToReadableHtml(decodedText), typeLabel: 'HTML 文档', mode: 'html' };
    }
    if (extension === 'md' || extension === 'markdown') {
        return { title, content: textToHtmlParagraphs(markdownToReadableText(decodedText)), typeLabel: 'Markdown', mode: 'html' };
    }
    if (extension === 'epub') {
        return { title, content: await epubToHtml(buffer), typeLabel: 'EPUB', mode: 'html' };
    }
    if (extension === 'docx') {
        return { title, content: await docxToHtml(buffer), typeLabel: 'Word 文档', mode: 'html' };
    }
    if (extension === 'doc') {
        return { title, content: textToHtmlParagraphs(legacyDocToReadableText(buffer)), typeLabel: 'Word 文档', mode: 'html' };
    }
    return { title, content: textToHtmlParagraphs(decodedText), typeLabel: 'TXT 文本', mode: 'html' };
}

function appendBookToGrid(title, content, typeLabel) {
    const bookId = `imported-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    importedBookStore.set(bookId, { id: bookId, title, content, typeLabel, mode: arguments[3] || 'text', cover: '', categoryId: '' });
    renderShelf();
}

function createManagedBookCard(book) {
    const card = document.createElement('div');
    card.className = 'book-card managed-book-card';
    card.draggable = true;
    card.dataset.bookId = book.id;
    card.dataset.contentMode = book.mode;
    card.onclick = function() { openBook(this); };
    card.addEventListener('contextmenu', event => openBookContextMenu(event, book.id));
    card.addEventListener('dragstart', event => {
        event.dataTransfer.setData('text/plain', book.id);
        event.dataTransfer.effectAllowed = 'move';
    });

    card.innerHTML = `
        <div class="book-cover ${book.cover ? 'has-custom-cover' : ''}" ${book.cover ? `style="background-image:url('${book.cover}')"` : ''}><span class="cover-text">${book.cover ? '' : escapeHtml(book.title)}</span></div>
        <div class="book-title">${escapeHtml(book.title)}</div>
        <div class="book-author">${escapeHtml(book.typeLabel)}</div>
    `;
    return card;
}

document.getElementById('tab-home').addEventListener('contextmenu', event => {
    if (event.target.closest('.book-card, .category-shelf, .trash-shelf, button, input')) return;
    event.preventDefault();
    const menu = ensureContextMenu();
    menu.innerHTML = '<button data-action="new-category">新建分类</button>';
    showContextMenu(menu, event.clientX, event.clientY);
});

document.getElementById('book-grid').addEventListener('dragover', event => event.preventDefault());
document.getElementById('book-grid').addEventListener('drop', event => {
    event.preventDefault();
    const bookId = event.dataTransfer.getData('text/plain');
    const book = importedBookStore.get(bookId);
    if (!book || deletedBookIds.has(bookId)) return;
    book.categoryId = '';
    renderShelf();
});

document.addEventListener('click', event => {
    if (!event.target.closest('#shelf-context-menu')) hideContextMenu();
});

function renderShelf() {
    const grid = document.getElementById('book-grid');
    const importCard = document.querySelector('.import-book-card');
    document.querySelectorAll('.managed-book-card').forEach(card => card.remove());

    Array.from(importedBookStore.values())
        .filter(book => !deletedBookIds.has(book.id) && !book.categoryId)
        .forEach(book => grid.insertBefore(createManagedBookCard(book), importCard));

    renderCategories();
    renderTrashShelf();
}

function openBookContextMenu(event, bookId) {
    event.preventDefault();
    activeContextBookId = bookId;
    const menu = ensureContextMenu();
    menu.innerHTML = `
        <button data-action="rename-book">更改书籍名字</button>
        <button data-action="change-cover">更改书籍封面</button>
        <button data-action="delete-book">删除</button>
    `;
    showContextMenu(menu, event.clientX, event.clientY);
}

function ensureContextMenu() {
    let menu = document.getElementById('shelf-context-menu');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'shelf-context-menu';
        menu.className = 'shelf-context-menu hidden';
        document.body.appendChild(menu);
        menu.addEventListener('click', handleContextMenuClick);
    }
    return menu;
}

function showContextMenu(menu, x, y) {
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.classList.remove('hidden');
}

function hideContextMenu() {
    document.getElementById('shelf-context-menu')?.classList.add('hidden');
}

function handleContextMenuClick(event) {
    const action = event.target.dataset.action;
    if (!action) return;
    hideContextMenu();

    if (action === 'new-category') createCategory();
    if (action === 'rename-book') renameBook(activeContextBookId);
    if (action === 'change-cover') changeBookCover(activeContextBookId);
    if (action === 'delete-book') deleteBook(activeContextBookId);
    if (action === 'edit-category') openCategoryEditor(event.target.dataset.categoryId);
    if (action === 'delete-category') deleteCategory(event.target.dataset.categoryId);
}

function renameBook(bookId) {
    const book = importedBookStore.get(bookId);
    if (!book) return;
    openTextEditModal({
        title: '更改书籍名字',
        label: '书籍名称',
        value: book.title,
        onSave: value => {
            book.title = value;
            renderShelf();
        }
    });
}

function openTextEditModal({ title, label, value, onSave }) {
    const modal = ensureCategoryModal();
    modal.innerHTML = `
        <div class="category-modal-card">
            <h3>${escapeHtml(title)}</h3>
            <label>${escapeHtml(label)}<input id="text-edit-input" type="text" value="${escapeHtml(value)}"></label>
            <div class="category-modal-actions">
                <button type="button" data-modal-cancel>取消</button>
                <button type="button" data-modal-save>保存</button>
            </div>
        </div>
    `;
    modal.classList.remove('hidden');
    modal.querySelector('#text-edit-input').focus();
    modal.querySelector('[data-modal-cancel]').onclick = () => modal.classList.add('hidden');
    modal.querySelector('[data-modal-save]').onclick = () => {
        const nextValue = modal.querySelector('#text-edit-input').value.trim();
        if (!nextValue) return;
        onSave(nextValue);
        modal.classList.add('hidden');
    };
}

function changeBookCover(bookId) {
    const book = importedBookStore.get(bookId);
    if (!book) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            book.cover = String(reader.result || '');
            renderShelf();
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

function deleteBook(bookId) {
    if (!importedBookStore.has(bookId)) return;
    deletedBookIds.add(bookId);
    const book = importedBookStore.get(bookId);
    if (book) book.categoryId = '';
    renderShelf();
}

function createCategory() {
    openCategoryEditor('');
}

function openCategoryEditor(categoryId = '') {
    const existing = shelfCategories.find(item => item.id === categoryId);
    const modal = ensureCategoryModal();
    const colors = ['#ffffff', '#f6ead6', '#e5f0dd', '#dfeaf7', '#f3dfe7', '#ebe5fb', '#e7e5e4'];
    const initialColor = normalizeCategoryColor(existing?.color || '#ffffff88');
    modal.innerHTML = `
        <div class="category-modal-card">
            <h3>${existing ? '编辑分类' : '新建分类'}</h3>
            <label>分类名称<input id="category-name-input" type="text" value="${escapeHtml(existing?.name || '新分类')}"></label>
            <div class="category-color-title">推荐颜色</div>
            <div class="category-color-palette">
                ${colors.map(color => `<button type="button" class="${initialColor.hex === color ? 'active' : ''}" data-color="${color}" style="background:${color}"></button>`).join('')}
                <button type="button" class="custom-color-plus" data-custom-color>+</button>
            </div>
            <input id="category-custom-color" class="hidden" type="color" value="${initialColor.hex}">
            <label class="category-opacity-row">透明度 <span id="category-opacity-value">${initialColor.alpha}</span>%
                <input id="category-opacity-input" type="range" min="18" max="100" value="${initialColor.alpha}">
            </label>
            <div class="category-modal-actions">
                <button type="button" data-modal-cancel>取消</button>
                <button type="button" data-modal-save>保存</button>
            </div>
        </div>
    `;
    let selectedHex = initialColor.hex;
    let selectedAlpha = initialColor.alpha;
    modal.classList.remove('hidden');
    modal.querySelector('#category-name-input').focus();
    modal.querySelectorAll('[data-color]').forEach(button => {
        button.onclick = () => {
            selectedHex = button.dataset.color;
            modal.querySelector('#category-custom-color').value = selectedHex;
            modal.querySelectorAll('[data-color]').forEach(item => item.classList.toggle('active', item === button));
        };
    });
    modal.querySelector('[data-custom-color]').onclick = () => modal.querySelector('#category-custom-color').click();
    modal.querySelector('#category-custom-color').oninput = event => {
        selectedHex = event.target.value;
        modal.querySelectorAll('[data-color]').forEach(item => item.classList.remove('active'));
    };
    modal.querySelector('#category-opacity-input').oninput = event => {
        selectedAlpha = Number(event.target.value);
        modal.querySelector('#category-opacity-value').textContent = selectedAlpha;
    };
    modal.querySelector('[data-modal-cancel]').onclick = () => modal.classList.add('hidden');
    modal.querySelector('[data-modal-save]').onclick = () => {
        const name = modal.querySelector('#category-name-input').value.trim();
        if (!name) return;
        const finalColor = colorWithAlpha(selectedHex, selectedAlpha);
        if (existing) {
            existing.name = name;
            existing.color = finalColor;
        } else {
            shelfCategories.push({ id: `category-${Date.now()}-${Math.random().toString(16).slice(2)}`, name, color: finalColor, collapsed: false });
        }
        modal.classList.add('hidden');
        renderShelf();
    };
}

function normalizeCategoryColor(color) {
    const match = String(color).match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
    if (!match) return { hex: '#ffffff', alpha: 72 };
    const alpha = match[2] ? Math.round(parseInt(match[2], 16) / 255 * 100) : 72;
    return { hex: `#${match[1]}`, alpha };
}

function colorWithAlpha(hex, alpha) {
    const value = Math.max(18, Math.min(100, Number(alpha) || 72));
    const alphaHex = Math.round(value / 100 * 255).toString(16).padStart(2, '0');
    return `${hex}${alphaHex}`;
}

function ensureCategoryModal() {
    let modal = document.getElementById('category-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'category-modal';
        modal.className = 'category-modal hidden';
        document.body.appendChild(modal);
        modal.addEventListener('click', event => {
            if (event.target === modal) modal.classList.add('hidden');
        });
    }
    return modal;
}

function renderCategories() {
    const board = document.getElementById('category-board');
    board.innerHTML = '';
    shelfCategories.forEach(category => {
        const shelf = document.createElement('section');
        shelf.className = `category-shelf ${category.collapsed ? 'collapsed' : ''}`;
        shelf.style.setProperty('--category-color', category.color);
        shelf.dataset.categoryId = category.id;
        shelf.innerHTML = `
            <div class="category-head">
                <button class="category-toggle" type="button">${category.collapsed ? '›' : '⌄'}</button>
                <strong>${escapeHtml(category.name)}</strong>
                <button class="category-action" type="button" data-category-menu="${category.id}">···</button>
            </div>
            <div class="category-books"></div>
        `;
        const body = shelf.querySelector('.category-books');
        Array.from(importedBookStore.values())
            .filter(book => !deletedBookIds.has(book.id) && book.categoryId === category.id)
            .forEach(book => body.appendChild(createManagedBookCard(book)));

        shelf.querySelector('.category-toggle').onclick = () => {
            category.collapsed = !category.collapsed;
            renderShelf();
        };
        shelf.querySelector('[data-category-menu]').onclick = event => openCategoryMenu(event, category.id);
        shelf.addEventListener('dragover', event => event.preventDefault());
        shelf.addEventListener('drop', event => {
            event.preventDefault();
            const bookId = event.dataTransfer.getData('text/plain');
            const book = importedBookStore.get(bookId);
            if (!book || deletedBookIds.has(bookId)) return;
            book.categoryId = category.id;
            renderShelf();
        });
        board.appendChild(shelf);
    });
}

function openCategoryMenu(event, categoryId) {
    event.preventDefault();
    event.stopPropagation();
    const menu = ensureContextMenu();
    menu.innerHTML = `
        <button data-action="edit-category" data-category-id="${categoryId}">修改分类名称</button>
        <button data-action="edit-category" data-category-id="${categoryId}">切换颜色</button>
        <button data-action="delete-category" data-category-id="${categoryId}">删除</button>
    `;
    showContextMenu(menu, event.clientX, event.clientY);
}

function deleteCategory(categoryId) {
    const category = shelfCategories.find(item => item.id === categoryId);
    if (!category) return;
    Array.from(importedBookStore.values()).forEach(book => {
        if (book.categoryId === categoryId) book.categoryId = '';
    });
    const index = shelfCategories.findIndex(item => item.id === categoryId);
    if (index >= 0) shelfCategories.splice(index, 1);
    renderShelf();
}

function renderTrashShelf() {
    const shelf = document.getElementById('trash-shelf');
    const deletedBooks = Array.from(deletedBookIds).map(id => importedBookStore.get(id)).filter(Boolean);
    shelf.classList.toggle('hidden', deletedBooks.length === 0);
    if (!deletedBooks.length) {
        shelf.innerHTML = '';
        return;
    }
    shelf.innerHTML = `
        <div class="trash-head">
            <strong>废弃书架</strong>
            <div>
                <button type="button" id="restore-all-books">一键恢复</button>
                <button type="button" id="clear-all-books">一键清空</button>
            </div>
        </div>
        <div class="trash-books"></div>
    `;
    const body = shelf.querySelector('.trash-books');
    deletedBooks.forEach(book => {
        const row = document.createElement('div');
        row.className = 'trash-book-row';
        row.innerHTML = `<span>${escapeHtml(book.title)}</span><button type="button" data-restore="${book.id}">恢复</button><button type="button" data-clear="${book.id}">清空</button>`;
        body.appendChild(row);
    });
    shelf.querySelector('#restore-all-books').onclick = () => {
        deletedBookIds.clear();
        renderShelf();
    };
    shelf.querySelector('#clear-all-books').onclick = () => {
        deletedBooks.forEach(book => {
            deletedBookIds.delete(book.id);
            importedBookStore.delete(book.id);
        });
        renderShelf();
    };
    shelf.querySelectorAll('[data-restore]').forEach(button => {
        button.onclick = () => {
            deletedBookIds.delete(button.dataset.restore);
            renderShelf();
        };
    });
    shelf.querySelectorAll('[data-clear]').forEach(button => {
        button.onclick = () => {
            importedBookStore.delete(button.dataset.clear);
            deletedBookIds.delete(button.dataset.clear);
            renderShelf();
        };
    });
}

function normalizeBookContent(content) {
    return String(content || '')
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function escapeHtml(text) {
    return String(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function htmlToReadableText(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, iframe, object, embed').forEach(node => node.remove());
    doc.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
    doc.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, section, article').forEach(node => node.append('\n'));
    return normalizeBookContent(doc.body.textContent || '');
}

function htmlToReadableHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach(node => node.remove());
    doc.querySelectorAll('[style], [class], [id], [onclick]').forEach(node => {
        preserveSafeInlineStyle(node);
        node.removeAttribute('class');
        node.removeAttribute('id');
        node.removeAttribute('onclick');
    });

    const allowedTags = new Set(['P', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'STRONG', 'B', 'EM', 'I', 'U', 'BLOCKQUOTE', 'IMG', 'FIGURE']);
    doc.body.querySelectorAll('*').forEach(node => {
        if (allowedTags.has(node.tagName)) return;
        const fragment = doc.createDocumentFragment();
        while (node.firstChild) fragment.appendChild(node.firstChild);
        node.replaceWith(fragment);
    });
    doc.body.querySelectorAll('img').forEach(img => sanitizeImportedImage(img));
    doc.body.querySelectorAll('table').forEach(table => table.classList.add('docx-table'));
    return doc.body.innerHTML.trim() || textToHtmlParagraphs(doc.body.textContent || '');
}

function preserveSafeInlineStyle(node) {
    const style = node.getAttribute('style') || '';
    const safe = [];
    style.split(';').forEach(rule => {
        const [rawName, rawValue] = rule.split(':');
        if (!rawName || !rawValue) return;
        const name = rawName.trim().toLowerCase();
        const value = rawValue.trim();
        if (!/^[#\w\s.,()%+-]+$/.test(value)) return;
        if (['text-align', 'font-weight', 'font-style', 'text-decoration'].includes(name)) safe.push(`${name}:${value}`);
        if (name === 'font-size' && /^(\d+(\.\d+)?)(px|pt|em|rem|%)$/.test(value)) safe.push(`${name}:${value}`);
    });
    if (safe.length) node.setAttribute('style', safe.join(';'));
    else node.removeAttribute('style');
}

function sanitizeImportedImage(img) {
    const src = img.getAttribute('src') || '';
    if (!/^(data:image\/|blob:|https?:\/\/)/i.test(src)) {
        img.remove();
        return;
    }
    Array.from(img.attributes).forEach(attr => {
        if (!['src', 'alt', 'style'].includes(attr.name)) img.removeAttribute(attr.name);
    });
    img.classList.add('docx-inline-image');
}

function textToHtmlParagraphs(text) {
    return normalizeBookContent(text)
        .split(/\n+/)
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => `<p>${escapeHtml(part)}</p>`)
        .join('');
}

function markdownToReadableText(markdown) {
    return normalizeBookContent(markdown)
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
}

function legacyDocToReadableText(buffer) {
    const candidates = [];
    ['utf-8', 'gb18030', 'utf-16le'].forEach(encoding => {
        try {
            const decoded = new TextDecoder(encoding).decode(buffer);
            candidates.push(cleanBinaryText(decoded));
        } catch {}
    });
    return candidates.sort((a, b) => b.length - a.length)[0] || '';
}

function cleanBinaryText(text) {
    return normalizeBookContent(text)
        .replace(/[\uE000-\uF8FF]/g, '')
        .replace(/[^\S\n]+/g, ' ')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 1 && !/^[\W_]+$/.test(line))
        .join('\n');
}

function decodeBestText(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        return new TextDecoder('utf-8').decode(buffer);
    }
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
        return new TextDecoder('utf-16le').decode(buffer);
    }

    const encodings = ['utf-8', 'gb18030', 'utf-16le'];
    const decoded = encodings.map(encoding => {
        try {
            const text = new TextDecoder(encoding).decode(buffer);
            const badCount = (text.match(/\uFFFD/g) || []).length;
            const chineseCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
            const controlCount = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
            const readableCount = (text.match(/[A-Za-z0-9\u4e00-\u9fa5，。！？；：、“”‘’（）《》\s]/g) || []).length;
            const readableRatio = readableCount / Math.max(text.length, 1);
            const utf8Bonus = encoding === 'utf-8' && badCount === 0 ? 20 : 0;
            return {
                text,
                score: readableRatio * 100 + chineseCount * 0.6 + utf8Bonus - badCount * 30 - controlCount * 8
            };
        } catch {
            return { text: '', score: -Infinity };
        }
    });
    return decoded.sort((a, b) => b.score - a.score)[0].text;
}


async function epubToHtml(buffer) {
    const files = parseZipEntries(buffer);
    const containerEntry = files.find(file => file.name === 'META-INF/container.xml');
    if (!containerEntry) return '';

    const containerXml = await inflateZipEntry(buffer, containerEntry);
    const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml');
    const rootfile = Array.from(containerDoc.getElementsByTagName('*')).find(node => node.localName === 'rootfile');
    const opfPath = rootfile?.getAttribute('full-path');
    if (!opfPath) return '';

    const opfEntry = files.find(file => file.name === opfPath);
    if (!opfEntry) return '';

    const opfXml = await inflateZipEntry(buffer, opfEntry);
    const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml');
    const opfBase = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const manifest = new Map();

    Array.from(opfDoc.getElementsByTagName('*')).forEach(node => {
        if (node.localName !== 'item') return;
        const id = node.getAttribute('id');
        const href = node.getAttribute('href');
        const mediaType = node.getAttribute('media-type') || '';
        if (!id || !href) return;
        manifest.set(id, {
            href,
            mediaType,
            path: normalizeZipPath(opfBase + href)
        });
    });

    const imageMap = await loadEpubImages(buffer, files, manifest);
    const spineItems = Array.from(opfDoc.getElementsByTagName('*'))
        .filter(node => node.localName === 'itemref')
        .map(node => manifest.get(node.getAttribute('idref')))
        .filter(Boolean)
        .filter(item => /xhtml|html|xml/.test(item.mediaType) || /\.x?html?$/.test(item.href));

    const chapters = [];
    for (const item of spineItems) {
        const entry = files.find(file => file.name === item.path);
        if (!entry) continue;
        const chapterHtml = await inflateZipEntry(buffer, entry);
        const html = epubChapterToReadableHtml(chapterHtml, item.path, imageMap);
        if (stripHtml(html).trim()) chapters.push(html);
    }

    return chapters.join('\n<div data-page-break="true"></div>\n');
}

async function loadEpubImages(buffer, files, manifest) {
    const imageMap = new Map();
    const mimeFallback = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml'
    };

    for (const item of manifest.values()) {
        if (!item.mediaType.startsWith('image/')) continue;
        const entry = files.find(file => file.name === item.path);
        if (!entry) continue;
        const bytes = await inflateZipEntry(buffer, entry, true);
        const ext = item.path.split('.').pop().toLowerCase();
        const blob = new Blob([bytes], { type: item.mediaType || mimeFallback[ext] || 'application/octet-stream' });
        imageMap.set(item.path, URL.createObjectURL(blob));
    }
    return imageMap;
}

function epubChapterToReadableHtml(chapterHtml, chapterPath, imageMap) {
    const doc = new DOMParser().parseFromString(chapterHtml, 'text/html');
    doc.querySelectorAll('script, style, link').forEach(node => node.remove());
    doc.querySelectorAll('img, image').forEach(node => {
        const rawSrc = node.getAttribute('src') || node.getAttribute('href') || node.getAttribute('xlink:href') || '';
        const resolved = resolveZipRelativePath(chapterPath, rawSrc);
        if (imageMap.has(resolved)) node.setAttribute('src', imageMap.get(resolved));
        node.removeAttribute('srcset');
    });

    const body = doc.body || doc.documentElement;
    const html = body ? body.innerHTML : chapterHtml;
    return htmlToReadableHtml(html);
}

function resolveZipRelativePath(fromPath, href) {
    if (!href) return '';
    const cleanHref = href.split('#')[0].split('?')[0];
    if (!cleanHref) return '';
    if (/^[a-z]+:/i.test(cleanHref)) return cleanHref;
    const base = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1) : '';
    return normalizeZipPath(base + cleanHref);
}

function normalizeZipPath(path) {
    const parts = [];
    path.replace(/\\/g, '/').split('/').forEach(part => {
        if (!part || part === '.') return;
        if (part === '..') parts.pop();
        else parts.push(part);
    });
    return parts.join('/');
}

async function docxToHtml(buffer) {
    const files = parseZipEntries(buffer);
    const documentEntry = files.find(file => file.name === 'word/document.xml');
    if (!documentEntry) return '';
    const xml = await inflateZipEntry(buffer, documentEntry);
    const relsEntry = files.find(file => file.name === 'word/_rels/document.xml.rels');
    const relsXml = relsEntry ? await inflateZipEntry(buffer, relsEntry) : '';
    const rels = parseDocxRelationships(relsXml);
    const media = await loadDocxMedia(buffer, files);
    return wordXmlToHtml(xml, rels, media);
}

function parseDocxRelationships(xml) {
    if (!xml) return new Map();
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const rels = new Map();
    Array.from(doc.getElementsByTagName('*')).forEach(node => {
        if (node.localName !== 'Relationship') return;
        const id = node.getAttribute('Id');
        const target = node.getAttribute('Target');
        if (!id || !target) return;
        const normalizedTarget = target.startsWith('word/') ? target : `word/${target.replace(/^\.\//, '')}`;
        rels.set(id, normalizedTarget);
    });
    return rels;
}

async function loadDocxMedia(buffer, files) {
    const media = new Map();
    const mimeMap = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        bmp: 'image/bmp',
        webp: 'image/webp',
        svg: 'image/svg+xml'
    };

    for (const file of files.filter(item => item.name.startsWith('word/media/'))) {
        const bytesText = await inflateZipEntry(file.__buffer || buffer, file, true);
        const bytes = bytesText instanceof Uint8Array ? bytesText : new TextEncoder().encode(bytesText);
        const ext = file.name.split('.').pop().toLowerCase();
        const blob = new Blob([bytes], { type: mimeMap[ext] || 'application/octet-stream' });
        media.set(file.name, URL.createObjectURL(blob));
    }
    return media;
}

function parseZipEntries(buffer) {
    const centralEntries = parseZipCentralDirectory(buffer);
    if (centralEntries.length) return centralEntries;
    return parseZipLocalEntries(buffer);
}

function parseZipCentralDirectory(buffer) {
    const view = new DataView(buffer);
    const entries = [];
    let eocdOffset = -1;

    for (let offset = view.byteLength - 22; offset >= Math.max(0, view.byteLength - 66000); offset--) {
        if (view.getUint32(offset, true) === 0x06054b50) {
            eocdOffset = offset;
            break;
        }
    }
    if (eocdOffset < 0) return entries;

    const totalEntries = view.getUint16(eocdOffset + 10, true);
    let offset = view.getUint32(eocdOffset + 16, true);

    for (let index = 0; index < totalEntries && offset + 46 < view.byteLength; index++) {
        if (view.getUint32(offset, true) !== 0x02014b50) break;
        const method = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const uncompressedSize = view.getUint32(offset + 24, true);
        const fileNameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localHeaderOffset = view.getUint32(offset + 42, true);
        const name = new TextDecoder().decode(new Uint8Array(buffer, offset + 46, fileNameLength));

        if (view.getUint32(localHeaderOffset, true) === 0x04034b50) {
            const localNameLength = view.getUint16(localHeaderOffset + 26, true);
            const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
            entries.push({
                name,
                method,
                compressedSize,
                uncompressedSize,
                dataStart: localHeaderOffset + 30 + localNameLength + localExtraLength
            });
        }
        offset += 46 + fileNameLength + extraLength + commentLength;
    }
    return entries;
}

function parseZipLocalEntries(buffer) {
    const view = new DataView(buffer);
    const entries = [];
    let offset = 0;

    while (offset + 30 < view.byteLength) {
        if (view.getUint32(offset, true) !== 0x04034b50) break;
        const method = view.getUint16(offset + 8, true);
        const compressedSize = view.getUint32(offset + 18, true);
        const uncompressedSize = view.getUint32(offset + 22, true);
        const fileNameLength = view.getUint16(offset + 26, true);
        const extraLength = view.getUint16(offset + 28, true);
        const nameStart = offset + 30;
        const dataStart = nameStart + fileNameLength + extraLength;
        const nameBytes = new Uint8Array(buffer, nameStart, fileNameLength);
        const name = new TextDecoder().decode(nameBytes);

        entries.push({ name, method, compressedSize, uncompressedSize, dataStart });
        offset = dataStart + compressedSize;
    }
    return entries;
}

async function inflateZipEntry(buffer, entry, asBytes = false) {
    const bytes = new Uint8Array(buffer, entry.dataStart, entry.compressedSize);
    if (entry.method === 0) return asBytes ? bytes : new TextDecoder().decode(bytes);
    if (entry.method !== 8) return asBytes ? new Uint8Array() : '';
    if (!('DecompressionStream' in window)) return asBytes ? new Uint8Array() : '';

    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const inflated = await new Response(stream).arrayBuffer();
    return asBytes ? new Uint8Array(inflated) : new TextDecoder().decode(inflated);
}

function wordXmlToHtml(xml, rels = new Map(), media = new Map()) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const body = Array.from(doc.getElementsByTagName('*')).find(node => node.localName === 'body');
    if (!body) return '';

    return Array.from(body.children).map(node => {
        if (node.localName === 'tbl') return wordTableToHtml(node, rels, media);
        if (node.localName === 'p') {
            const inlineHtml = extractWordInlineHtml(node, rels, media).trim();
            const text = stripHtml(inlineHtml).trim();
            const pageBreak = hasWordPageBreak(node) ? '<div data-page-break="true"></div>' : '';
            if (!text && !/<img\b/i.test(inlineHtml)) return pageBreak;
            const tagName = getWordParagraphTag(node);
            const alignClass = getWordParagraphAlignClass(node);
            const styleClass = getWordParagraphStyleClass(node);
            const className = [alignClass, styleClass].filter(Boolean).join(' ');
            return `<${tagName}${className ? ` class="${className}"` : ''}>${inlineHtml}</${tagName}>${pageBreak}`;
        }
        return '';
    }).filter(Boolean).join('\n');
}

function wordTableToHtml(tableNode, rels, media) {
    const rows = Array.from(tableNode.children).filter(node => node.localName === 'tr');
    const body = rows.map(row => {
        const cells = Array.from(row.children).filter(node => node.localName === 'tc');
        const htmlCells = cells.map(cell => {
            const colSpan = getWordGridSpan(cell);
            const paragraphs = Array.from(cell.getElementsByTagName('*'))
                .filter(node => node.localName === 'p')
                .map(paragraph => extractWordInlineHtml(paragraph, rels, media).trim())
                .filter(Boolean);
            return `<td${colSpan > 1 ? ` colspan="${colSpan}"` : ''}>${paragraphs.join('<br>') || '&nbsp;'}</td>`;
        }).join('');
        return `<tr>${htmlCells}</tr>`;
    }).join('');
    return `<table class="docx-table"><tbody>${body}</tbody></table>`;
}

function getWordParagraphTag(paragraph) {
    const styleNode = Array.from(paragraph.getElementsByTagName('*'))
        .find(node => node.localName === 'pStyle');
    const style = getWordNodeValue(styleNode);
    if (/Title|标题|Heading1|1$/i.test(style)) return 'h1';
    if (/Heading2|2$/i.test(style)) return 'h2';
    return 'p';
}

function getWordParagraphStyleClass(paragraph) {
    const styleNode = Array.from(paragraph.getElementsByTagName('*'))
        .find(node => node.localName === 'pStyle');
    const style = getWordNodeValue(styleNode);
    if (/Title|标题/i.test(style)) return 'doc-title';
    return '';
}

function getWordParagraphAlignClass(paragraph) {
    const alignNode = Array.from(paragraph.getElementsByTagName('*'))
        .find(node => node.localName === 'jc');
    const align = getWordNodeValue(alignNode);
    if (align === 'center') return 'align-center';
    if (align === 'right') return 'align-right';
    return '';
}

function getWordGridSpan(cell) {
    const spanNode = Array.from(cell.getElementsByTagName('*'))
        .find(node => node.localName === 'gridSpan');
    const span = getWordNodeValue(spanNode);
    return Math.max(1, Number(span) || 1);
}

function getWordNodeValue(node) {
    return node?.getAttribute('w:val') || node?.getAttribute('val') || '';
}

function hasWordPageBreak(node) {
    return Array.from(node.getElementsByTagName('*')).some(child => {
        if (child.localName === 'lastRenderedPageBreak') return true;
        return child.localName === 'br' && getWordNodeType(child) === 'page';
    });
}

function getWordNodeType(node) {
    return node?.getAttribute('w:type') || node?.getAttribute('type') || '';
}

function extractWordText(node) {
    let text = '';
    node.childNodes.forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) {
            text += child.textContent;
            return;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) return;
        if (child.localName === 't') text += child.textContent;
        else if (child.localName === 'tab') text += '    ';
        else if (child.localName === 'br' || child.localName === 'cr') text += '\n';
        else text += extractWordText(child);
    });
    return text;
}

function extractWordInlineHtml(node, rels = new Map(), media = new Map()) {
    return Array.from(node.childNodes).map(child => {
        if (child.nodeType === Node.TEXT_NODE) return escapeHtml(child.textContent);
        if (child.nodeType !== Node.ELEMENT_NODE) return '';
        if (child.localName === 'r') return wordRunToHtml(child, rels, media);
        if (child.localName === 'hyperlink') return extractWordInlineHtml(child, rels, media);
        if (child.localName === 'drawing' || child.localName === 'pict') return wordImageToHtml(child, rels, media);
        if (child.localName === 'br' || child.localName === 'cr') return '<br>';
        if (child.localName === 'tab') return '&emsp;';
        return extractWordInlineHtml(child, rels, media);
    }).join('');
}

function wordRunToHtml(runNode, rels = new Map(), media = new Map()) {
    let html = '';
    runNode.childNodes.forEach(child => {
        if (child.nodeType !== Node.ELEMENT_NODE) return;
        if (child.localName === 't') html += escapeHtml(child.textContent);
        else if (child.localName === 'tab') html += '&emsp;';
        else if (child.localName === 'br' || child.localName === 'cr') html += '<br>';
        else if (child.localName === 'drawing' || child.localName === 'pict') html += wordImageToHtml(child, rels, media);
        else if (child.localName !== 'rPr') html += extractWordInlineHtml(child, rels, media);
    });
    if (!html) return '';

    const props = Array.from(runNode.children).find(child => child.localName === 'rPr');
    const styles = [];
    let className = '';
    if (props) {
        const children = Array.from(props.children);
        if (children.some(child => child.localName === 'b')) html = `<strong>${html}</strong>`;
        if (children.some(child => child.localName === 'i')) html = `<em>${html}</em>`;
        if (children.some(child => child.localName === 'u')) html = `<u>${html}</u>`;
        const sizeNode = children.find(child => child.localName === 'sz');
        const size = Number(getWordNodeValue(sizeNode));
        if (size) styles.push(`font-size:calc(var(--reader-size) * ${Math.max(0.65, Math.min(2.6, (size / 2) / 18)).toFixed(3)})`);
    }
    return styles.length || className ? `<span${className ? ` class="${className}"` : ''}${styles.length ? ` style="${styles.join(';')}"` : ''}>${html}</span>` : html;
}

function wordImageToHtml(node, rels, media) {
    const embedNode = Array.from(node.getElementsByTagName('*'))
        .find(child => child.localName === 'blip' && (child.getAttribute('r:embed') || child.getAttribute('embed')));
    const relId = embedNode?.getAttribute('r:embed') || embedNode?.getAttribute('embed');
    const target = rels.get(relId);
    const src = media.get(target);
    if (!src) return '';

    const extent = Array.from(node.getElementsByTagName('*')).find(child => child.localName === 'extent');
    const cx = Number(extent?.getAttribute('cx')) || 0;
    const width = cx ? Math.min(760, Math.round(cx / 9525)) : '';
    return `<figure class="docx-image-wrap"><img src="${src}"${width ? ` style="max-width:${width}px"` : ''} alt=""></figure>`;
}

function stripHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    return template.content.textContent || '';
}

function openBook(bookElement) {
    const storedBook = importedBookStore.get(bookElement.dataset.bookId);
    activeBookTitle = storedBook?.title || bookElement.querySelector('.book-title').innerText;
    activeBookKey = makeBookKey(activeBookTitle, storedBook || { id: bookElement.dataset.bookId || '', title: activeBookTitle });
    setAnnotationColors();
    const content = storedBook?.content || normalizeBookContent(bookElement.dataset.content || bookElement.getAttribute('data-content') || '');
    const contentMode = storedBook?.mode || bookElement.dataset.contentMode || 'text';

    document.getElementById('global-navbar').classList.add('hidden');
    document.getElementById('reader-navbar').classList.remove('hidden');
    document.getElementById('reader-view').classList.remove('hidden');

    readerTitle.innerText = activeBookTitle;
    activePageChunks = splitContentIntoChunks(content, contentMode);
    activeTauriBook = storedBook?.tauriBook || null;
    activeTauriBookPromise = ensureActiveBookRegistered(storedBook, contentMode);
    totalPagesMock = Math.max(activePageChunks.length, 1);
    currentPageMock = 1;
    pageScrollPositions = new Map();
    syncControlSliders();
    renderVirtualPages();
}

function splitContentIntoChunks(content, mode = 'text') {
    if (mode === 'html') return splitHtmlIntoChunks(content);

    const paragraphs = normalizeBookContent(content)
        .split(/\n+/)
        .map(part => part.trim())
        .filter(Boolean);

    if (!paragraphs.length) return ['<p>暂无可阅读内容。</p>'];

    const chunks = [];
    let current = '';
    let currentLength = 0;
    const maxLength = 1800;

    paragraphs.forEach(paragraph => {
        const html = `<p>${escapeHtml(paragraph)}</p>`;
        if (currentLength + paragraph.length > maxLength && current) {
            chunks.push(current);
            current = html;
            currentLength = paragraph.length;
        } else {
            current += html;
            currentLength += paragraph.length;
        }
    });
    if (current) chunks.push(current);
    return chunks;
}

function splitHtmlIntoChunks(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    let blocks = Array.from(template.content.children);
    if (!blocks.length) return splitContentIntoChunks(template.content.textContent || '', 'text');

    const chunks = [];
    const firstBreakIndex = blocks.findIndex(block => block.hasAttribute('data-page-break'));
    if (firstBreakIndex > 0) {
        const titleBlocks = blocks.slice(0, firstBreakIndex);
        const titleTextLength = titleBlocks.reduce((sum, block) => sum + block.textContent.trim().length, 0);
        const centeredCount = titleBlocks.filter(block => block.classList.contains('align-center') || block.matches('h1, h2, .doc-title')).length;
        if (titleTextLength > 0 && titleTextLength < 1400 && centeredCount >= Math.ceil(titleBlocks.length * 0.5)) {
            chunks.push(`<div class="title-page-content">${titleBlocks.map(block => block.outerHTML).join('')}</div>`);
            blocks = blocks.slice(firstBreakIndex + 1);
        }
    }

    let current = '';
    let currentLength = 0;
    const maxLength = 1800;

    blocks.forEach(block => {
        if (block.hasAttribute('data-page-break')) {
            if (current) chunks.push(current);
            current = '';
            currentLength = 0;
            return;
        }
        const blockHtml = block.outerHTML;
        const isTitlePageBlock = isLikelyTitlePageBlock(block);
        const blockLength = Math.max(block.textContent.trim().length, block.matches('table') ? 900 : 0);
        if (isTitlePageBlock && !current && chunks.length === 0) {
            chunks.push(`<div class="title-page-content">${blockHtml}</div>`);
            current = '';
            currentLength = 0;
            return;
        }
        if (current && currentLength + blockLength > maxLength) {
            chunks.push(current);
            current = blockHtml;
            currentLength = blockLength;
        } else {
            current += blockHtml;
            currentLength += blockLength;
        }
    });
    if (current) chunks.push(current);
    return chunks.length ? chunks : ['<p>暂无可阅读内容。</p>'];
}

function isLikelyTitlePageBlock(block) {
    const textLength = block.textContent.trim().length;
    return textLength > 0 && textLength < 260 && (block.matches('h1, h2, .doc-title') || block.classList.contains('align-center'));
}

function renderVirtualPages(options = {}) {
    const isScrollMode = pageMode === 'scroll';
    const start = isScrollMode ? 0 : Math.max(0, currentPageMock - 2);
    const end = isScrollMode ? activePageChunks.length - 1 : Math.min(activePageChunks.length - 1, currentPageMock);
    const html = [];

    for (let index = start; index <= end; index++) {
        const isActive = index === currentPageMock - 1;
        const isTitlePage = /title-page-content/.test(activePageChunks[index]);
        const renderedChunk = applyAnnotationsToChunk(activePageChunks[index], index);
        html.push(`<section class="reader-page ${isActive ? 'active-reader-page' : ''} ${isTitlePage ? 'title-page' : ''}" data-page="${index + 1}"><div class="reader-page-body">${renderedChunk}</div><div class="reader-page-label">第 ${index + 1} 页</div></section>`);
    }
    readerTextArea.innerHTML = html.join('');
    document.getElementById('reader-view').classList.toggle('scroll-page-mode', isScrollMode);
    updateMockPageUI();
    requestAnimationFrame(() => {
        if (isScrollMode) {
            if (options.restoreScroll === false || options.scrollToCurrent) scrollToRenderedPage(currentPageMock);
            syncPageByVisibleArea();
            return;
        }
        const savedTop = pageScrollPositions.get(currentPageMock) || 0;
        readerScrollContainer.scrollTop = options.restoreScroll === false ? 0 : savedTop;
    });
}

function closeBook() {
    document.getElementById('reader-navbar').classList.add('hidden');
    document.getElementById('global-navbar').classList.remove('hidden');
    document.getElementById('reader-view').classList.add('hidden');
    switchTab('home');
}

function toggleLeftPanel() {
    const panel = document.getElementById('settings-panel');
    const quickTools = document.getElementById('top-quick-tools');
    const toggleBtn = panel.querySelector('.panel-toggle');
    const navToggleBtn = document.getElementById('reader-panel-toggle');

    panel.classList.toggle('collapsed');

    if (panel.classList.contains('collapsed')) {
        toggleBtn.innerText = '展开';
        navToggleBtn.innerText = '☷';
        quickTools.style.visibility = 'visible';
        quickTools.style.opacity = '1';
    } else {
        toggleBtn.innerText = '收起';
        navToggleBtn.innerText = '☰';
        quickTools.style.visibility = 'hidden';
        quickTools.style.opacity = '0';
    }
}

function changeReaderTheme(theme) {
    const root = document.documentElement;
    document.querySelectorAll('.theme-options .theme-dot').forEach(d => d.classList.remove('active'));
    const targetDot = document.querySelector(`.t-${theme}`);
    if (targetDot) targetDot.classList.add('active');

    if (theme === 'light') {
        root.style.setProperty('--reader-bg', '#fcfaf2');
        root.style.setProperty('--reader-text-color', '#2c3e50');
    } else if (theme === 'dark') {
        root.style.setProperty('--reader-bg', '#1f1f1f');
        root.style.setProperty('--reader-text-color', '#d4d4d4');
    } else if (theme === 'sepia') {
        root.style.setProperty('--reader-bg', '#f4ecd8');
        root.style.setProperty('--reader-text-color', '#433422');
    }
    document.getElementById('custom-bg-picker').value = root.style.getPropertyValue('--reader-bg').trim();
    document.getElementById('custom-text-picker').value = root.style.getPropertyValue('--reader-text-color').trim();
}

function applyCustomColors() {
    const root = document.documentElement;
    const bg = document.getElementById('custom-bg-picker').value;
    const text = document.getElementById('custom-text-picker').value;

    root.style.setProperty('--reader-bg', bg);
    root.style.setProperty('--reader-text-color', text);
    document.querySelectorAll('.theme-options .theme-dot').forEach(d => d.classList.remove('active'));
}

function changeFontStyle(fontFamily) {
    document.documentElement.style.setProperty('--reader-font-family', fontFamily);
    document.getElementById('font-style-select').style.fontFamily = fontFamily;
}

function changeFontSize(step) {
    currentFontSize = Math.max(12, Math.min(38, currentFontSize + step));
    document.documentElement.style.setProperty('--reader-size', currentFontSize + 'px');
    document.getElementById('font-size-val').innerText = currentFontSize;
    document.getElementById('font-size-slider').value = currentFontSize;
}

function onFontSizeSlider(value) {
    currentFontSize = Number(value);
    changeFontSize(0);
}

function changeLineHeight(step) {
    currentLineHeight = Math.max(1.2, Math.min(3.2, Number((currentLineHeight + step).toFixed(2))));
    document.documentElement.style.setProperty('--reader-height', currentLineHeight);
    document.getElementById('line-height-val').innerText = currentLineHeight.toFixed(1);
    document.getElementById('line-height-slider').value = Math.round(currentLineHeight * 10);
}

function onLineHeightSlider(val) {
    currentLineHeight = Number((val / 10).toFixed(2));
    document.documentElement.style.setProperty('--reader-height', currentLineHeight);
    document.getElementById('line-height-val').innerText = currentLineHeight.toFixed(1);
}

function syncControlSliders() {
    document.getElementById('font-size-slider').value = currentFontSize;
    document.getElementById('line-height-slider').value = Math.round(currentLineHeight * 10);
    document.documentElement.style.setProperty('--reader-size', currentFontSize + 'px');
    document.documentElement.style.setProperty('--reader-height', currentLineHeight);
}

function onProgressSlider(val) {
    saveCurrentPageScroll();
    currentPageMock = Math.max(1, Math.min(totalPagesMock, Number(val) || 1));
    renderVirtualPages({ restoreScroll: false, scrollToCurrent: true });
}

function jumpToInputPage() {
    const inputVal = parseInt(document.getElementById('direct-page-input').value);
    if (inputVal >= 1 && inputVal <= totalPagesMock) {
        saveCurrentPageScroll();
        currentPageMock = inputVal;
        renderVirtualPages({ restoreScroll: false, scrollToCurrent: true });
    } else {
        alert(`无效页码！请输入 1 至 ${totalPagesMock} 之间的数字。`);
    }
}

function updateMockPageUI() {
    document.getElementById('page-info').innerText = `第 ${currentPageMock} / ${totalPagesMock} 页`;
    const pageInput = document.getElementById('direct-page-input');
    pageInput.value = currentPageMock;
    pageInput.max = totalPagesMock;
    const percent = totalPagesMock <= 1 ? 100 : Math.round((currentPageMock / totalPagesMock) * 100);
    const progressBar = document.getElementById('read-progress-bar');
    progressBar.min = 1;
    progressBar.max = totalPagesMock;
    progressBar.step = 1;
    progressBar.value = currentPageMock;
    progressBar.style.setProperty('--progress-percent', percent + '%');
    document.getElementById('progress-percent').innerText = percent + '%';
}

function goToRelativePage(step) {
    if (isPageTransitionLocked) return;
    const previousPage = currentPageMock;
    const nextPage = Math.max(1, Math.min(totalPagesMock, currentPageMock + step));
    if (nextPage === currentPageMock) return;
    isPageTransitionLocked = true;
    saveCurrentPageScroll();
    currentPageMock = nextPage;
    scrollPageArmedDirection = null;
    scrollPageArmedAt = 0;
    scrollPageArmedReady = false;
    renderVirtualPages({ restoreScroll: pageMode !== 'scroll' && pageScrollPositions.has(currentPageMock) && Math.abs(currentPageMock - previousPage) === 1, scrollToCurrent: pageMode === 'scroll' });
    window.setTimeout(() => {
        isPageTransitionLocked = false;
        syncPageByVisibleArea();
    }, 260);
}

function changePageMode(mode) {
    saveCurrentPageScroll();
    pageMode = mode === 'scroll' ? 'scroll' : 'paged';
    renderVirtualPages({ scrollToCurrent: true });
}

readerScrollContainer.addEventListener('wheel', event => {
    if (pageMode !== 'scroll') return;
    resetScrollPageArm();
}, { passive: false });

readerScrollContainer.addEventListener('scroll', () => {
    pageScrollPositions.set(currentPageMock, readerScrollContainer.scrollTop);
    window.requestAnimationFrame(syncPageByVisibleArea);
});

function saveCurrentPageScroll() {
    pageScrollPositions.set(currentPageMock, readerScrollContainer.scrollTop);
}

function isReaderAtBottom() {
    return readerScrollContainer.scrollTop + readerScrollContainer.clientHeight >= readerScrollContainer.scrollHeight - 72;
}

function isReaderAtTop() {
    return readerScrollContainer.scrollTop <= 72;
}

function resetScrollPageArm() {
    scrollPageArmedDirection = null;
    scrollPageArmedAt = 0;
    scrollPageArmedReady = false;
}

function scrollToRenderedPage(pageNumber) {
    const page = readerTextArea.querySelector(`.reader-page[data-page="${pageNumber}"]`);
    if (!page) return;
    readerScrollContainer.scrollTop = page.offsetTop;
}

function syncPageByVisibleArea() {
    if (isPageTransitionLocked) return;
    const pages = Array.from(readerTextArea.querySelectorAll('.reader-page'));
    if (!pages.length) return;
    const containerRect = readerScrollContainer.getBoundingClientRect();
    let bestPage = currentPageMock;
    let bestRatio = 0;

    pages.forEach(page => {
        const rect = page.getBoundingClientRect();
        const visibleHeight = Math.min(rect.bottom, containerRect.bottom) - Math.max(rect.top, containerRect.top);
        const ratio = Math.max(0, visibleHeight) / Math.max(1, Math.min(rect.height, containerRect.height));
        if (ratio > bestRatio) {
            bestRatio = ratio;
            bestPage = Number(page.dataset.page) || bestPage;
        }
    });

    if (bestRatio >= 0.5 && bestPage !== currentPageMock) {
        currentPageMock = bestPage;
        updateMockPageUI();
    }
}

readerTextArea.addEventListener('click', event => {
    const mark = event.target.closest?.('.reader-highlight');
    if (!mark) return;
    const annotation = getBookAnnotations().find(item => item.id === mark.dataset.annotationId);
    if (!annotation) return;
    activeClickedAnnotationId = annotation.id;
    activeSelectionOffsets = {
        pageIndex: annotation.pageIndex,
        startOffset: annotation.startOffset,
        endOffset: annotation.endOffset,
        text: annotation.text
    };
    if (annotation.type === 'note') {
        openNoteEditor({
            title: '\u67e5\u770b note',
            text: annotation.text,
            note: annotation.note || '',
            onSave(note) {
                annotation.note = note;
                annotation.updatedAt = new Date().toISOString();
                saveAnnotationStore();
                renderVirtualPages({ restoreScroll: true });
                renderNotesSummary();
            },
            onDelete() {
                removeAnnotationById(annotation.id);
            }
        });
    }
    hideSelectionActionBar();
});

readerTextArea.addEventListener('mouseup', async function() {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    if (!selectedText) {
        hideSelectionActionBar();
        activeSelectionRange = null;
        activeSelectionOffsets = null;
        activeSelectionPageIndex = -1;
        return;
    }
    const shouldSyncToTauri = selectedText.length >= 4;

    activeSelectionRange = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    activeSelectionPageIndex = Math.max(0, currentPageMock - 1);
    activeClickedAnnotationId = '';

    if (activeTauriBookPromise) await activeTauriBookPromise;
    if (!activeTauriBook) {
        activeTauriBook = await ensureActiveBookRegistered(null, 'html');
    }
    activeSelectionPayload = buildSelectionSyncPayload(selectedText);
    const renderedOffsets = getSelectionOffsetsInRenderedPage(activeSelectionRange);
    activeSelectionOffsets = {
        pageIndex: renderedOffsets?.pageIndex ?? activeSelectionPageIndex,
        startOffset: renderedOffsets?.startOffset ?? activeSelectionPayload.start_offset,
        endOffset: renderedOffsets?.endOffset ?? activeSelectionPayload.end_offset,
        text: selectedText
    };
    activeSelectionPayload.start_offset = activeSelectionOffsets.startOffset;
    activeSelectionPayload.end_offset = activeSelectionOffsets.endOffset;
    const hasExistingAnnotation = findOverlappingAnnotations(activeSelectionOffsets.pageIndex, activeSelectionOffsets.startOffset, activeSelectionOffsets.endOffset).length > 0;
    if (activeSelectionRange) showSelectionActionBarFromRange(activeSelectionRange, hasExistingAnnotation);
    if (shouldSyncToTauri && !hasExistingAnnotation) scheduleTauriSelectionSync(activeSelectionPayload);
});

setAnnotationColors();
renderNotesSummary();

document.addEventListener('mousedown', event => {
    if (event.target.closest?.('#selection-action-bar, .reader-highlight, #note-editor-modal')) return;
    const currentSelection = window.getSelection();
    if (!currentSelection || currentSelection.toString().trim().length <= 5) hideSelectionActionBar();
});

document.addEventListener('keydown', event => {
    if (event.key === 'Escape') hideSelectionActionBar();
    if (event.target.matches('input, select, textarea')) return;
    if (document.getElementById('reader-view').classList.contains('hidden')) return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        goToRelativePage(1);
    }
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        goToRelativePage(-1);
    }
});

// content.js – simplified, no sign‑in, no limits, no icon

(function injectPageHook() {
    try {
        const root = document.documentElement;
        if (root && root.dataset.kahoothackHook === '1') return;
        if (root) root.dataset.kahoothackHook = '1';
    } catch (_) { /* ignore */ }

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('scripts/injected.js');
    script.onload = () => {
        console.log('[Content] Injected script loaded');
        script.remove();
    };
    (document.head || document.documentElement).appendChild(script);
})();

let currentQuestion = null;
const QGPT_PANEL_ID = 'kahoothack-panel';
const QGPT_STYLE_ID = 'kahoothack-panel-styles';

const qgptState = {
    mounted: false,
    collapsed: false,
    status: 'Ready',
    statusTone: 'idle',
    settings: {
        highlight: true,
        autoClick: true,
        silentMode: false,
        answerDelay: 0
    }
};

const QGPT_IS_TOP_FRAME = (() => {
    try { return window.top === window.self; } catch (_) { return false; }
})();

function whenBodyReady(cb) {
    if (document.body) return cb();
    const obs = new MutationObserver(() => {
        if (document.body) {
            obs.disconnect();
            cb();
        }
    });
    obs.observe(document.documentElement, { childList: true });
}

function injectPanelStyles() {
    if (document.getElementById(QGPT_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = QGPT_STYLE_ID;
    style.textContent = `
        #${QGPT_PANEL_ID} {
            position: fixed;
            top: 14px;
            right: 14px;
            z-index: 2147483600;
            font-family: "Segoe UI", Tahoma, system-ui, sans-serif;
            color: #f5f5f5;
            font-size: 12.5px;
            line-height: 1.35;
            -webkit-font-smoothing: antialiased;
            pointer-events: none;
        }
        #${QGPT_PANEL_ID} * { box-sizing: border-box; }
        #${QGPT_PANEL_ID} .qgpt-card,
        #${QGPT_PANEL_ID} .qgpt-pill {
            pointer-events: auto;
            background: linear-gradient(180deg, #1f1f24 0%, #17171c 100%);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.35);
            backdrop-filter: blur(6px);
        }
        #${QGPT_PANEL_ID}[data-collapsed="true"] .qgpt-card { display: none; }
        #${QGPT_PANEL_ID}[data-collapsed="false"] .qgpt-pill { display: none; }

        .qgpt-pill {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 10px 6px 6px;
            cursor: pointer;
            transition: transform .15s ease, border-color .15s ease;
            user-select: none;
            font-weight: 600;
            font-size: 12px;
            color: #eee;
        }
        .qgpt-pill:hover { transform: translateY(-1px); border-color: rgba(218,112,214,0.5); }

        .qgpt-card {
            width: 240px;
            overflow: hidden;
        }

        .qgpt-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            border-bottom: 1px solid rgba(255,255,255,0.06);
            background: linear-gradient(90deg, rgba(138,43,226,0.12), rgba(218,112,214,0.05));
            font-weight: 600;
            font-size: 13px;
            color: #fff;
        }
        .qgpt-header .qgpt-title { flex: 1; }
        .qgpt-header .qgpt-icon-btn {
            all: unset;
            width: 24px; height: 24px;
            display: flex; align-items: center; justify-content: center;
            border-radius: 6px;
            cursor: pointer;
            color: #b0b0b0;
            transition: background .15s ease, color .15s ease;
        }
        .qgpt-header .qgpt-icon-btn:hover { background: rgba(255,255,255,0.08); color: #fff; }

        .qgpt-section { padding: 10px 12px; }
        .qgpt-section + .qgpt-section { border-top: 1px solid rgba(255,255,255,0.05); }

        .qgpt-row {
            display: flex; align-items: center; gap: 8px;
            padding: 4px 0;
            font-size: 12px;
            color: #ddd;
        }
        .qgpt-row + .qgpt-row { border-top: 1px solid rgba(255,255,255,0.04); }
        .qgpt-row-label {
            flex: 1; min-width: 0;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }

        .qgpt-toggle {
            appearance: none;
            -webkit-appearance: none;
            margin: 0;
            width: 42px; height: 24px;
            background: #3a3f48;
            border-radius: 999px;
            position: relative;
            cursor: pointer;
            transition: background .15s ease;
            flex-shrink: 0;
            border: none;
            outline: none;
        }
        .qgpt-toggle::after {
            content: '';
            position: absolute;
            top: 3px; left: 3px;
            width: 18px; height: 18px;
            border-radius: 50%;
            background: #fff;
            transition: transform .15s ease;
            box-shadow: 0 1px 2px rgba(0,0,0,0.35);
        }
        .qgpt-toggle:checked {
            background: linear-gradient(135deg, #8A2BE2, #DA70D6);
        }
        .qgpt-toggle:checked::after { transform: translateX(18px); }

        .qgpt-delay-row {
            display: flex; align-items: center; gap: 8px;
            padding: 6px 0 2px;
            font-size: 12px;
            color: #ddd;
            border-top: 1px solid rgba(255,255,255,0.04);
        }
        .qgpt-delay-slider {
            -webkit-appearance: none;
            appearance: none;
            flex: 1;
            height: 4px;
            background: rgba(255,255,255,0.1);
            border-radius: 2px;
            outline: none;
            cursor: pointer;
            min-width: 0;
        }
        .qgpt-delay-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 12px; height: 12px;
            border-radius: 50%;
            background: linear-gradient(135deg, #8A2BE2, #DA70D6);
            cursor: pointer;
            border: none;
            box-shadow: 0 1px 3px rgba(0,0,0,0.4);
        }
        .qgpt-delay-slider::-moz-range-thumb {
            width: 12px; height: 12px;
            border-radius: 50%;
            background: linear-gradient(135deg, #8A2BE2, #DA70D6);
            cursor: pointer;
            border: none;
        }
        .qgpt-delay-value {
            width: 34px;
            text-align: right;
            font-variant-numeric: tabular-nums;
            color: #fff; font-weight: 600;
            flex-shrink: 0;
        }

        .qgpt-status-section {
            padding: 8px 12px;
            border-top: 1px solid rgba(255,255,255,0.05);
        }
        .qgpt-status {
            display: flex; align-items: center; gap: 8px;
            font-size: 11.5px; color: #cfcfcf;
        }
        .qgpt-status-dot {
            width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
            background: #4CAF50;
            box-shadow: 0 0 6px rgba(76,175,80,0.45);
            transition: background .2s ease, box-shadow .2s ease;
        }
        .qgpt-status[data-tone="busy"] .qgpt-status-dot {
            background: #FFB74D;
            box-shadow: 0 0 6px rgba(255,183,77,0.6);
            animation: qgptPulse 1.2s ease-in-out infinite;
        }
        .qgpt-status[data-tone="success"] .qgpt-status-dot { background: #4CAF50; }
        .qgpt-status[data-tone="error"] .qgpt-status-dot {
            background: #ff6b6b;
            box-shadow: 0 0 6px rgba(255,107,107,0.6);
        }
        .qgpt-status-text { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        @keyframes qgptPulse { 0%,100%{opacity:1} 50%{opacity:.45} }
    `;
    (document.head || document.documentElement).appendChild(style);
}

function mountPanel() {
    if (qgptState.mounted) return;
    if (!QGPT_IS_TOP_FRAME) return;
    injectPanelStyles();

    const root = document.createElement('div');
    root.id = QGPT_PANEL_ID;
    root.setAttribute('data-collapsed', qgptState.collapsed ? 'true' : 'false');

    root.innerHTML = `
        <div class="qgpt-pill" role="button" title="Expand kahoothack">
            <span>⚡ kahoothack</span>
        </div>
        <div class="qgpt-card" role="region" aria-label="kahoothack panel">
            <div class="qgpt-header">
                <span class="qgpt-title">⚡ kahoothack</span>
                <button type="button" class="qgpt-icon-btn" data-qgpt="collapse" title="Collapse" aria-label="Collapse kahoothack">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="pointer-events:none"><path d="M5 12h14"/></svg>
                </button>
            </div>

            <div class="qgpt-section">
                <label class="qgpt-row">
                    <span class="qgpt-row-label">Highlight answer</span>
                    <input type="checkbox" class="qgpt-toggle" data-qgpt="t-highlight"/>
                </label>
                <label class="qgpt-row">
                    <span class="qgpt-row-label">Auto-click</span>
                    <input type="checkbox" class="qgpt-toggle" data-qgpt="t-autoclick"/>
                </label>
                <label class="qgpt-row">
                    <span class="qgpt-row-label">Incognito mode</span>
                    <input type="checkbox" class="qgpt-toggle" data-qgpt="t-silent"/>
                </label>
                <div class="qgpt-delay-row">
                    <span class="qgpt-delay-label">Delay</span>
                    <input type="range" class="qgpt-delay-slider" data-qgpt="delay-slider" min="0" max="10" step="0.5" value="0"/>
                    <span class="qgpt-delay-value" data-qgpt="delay-value">0s</span>
                </div>
            </div>

            <div class="qgpt-status-section">
                <div class="qgpt-status" data-qgpt="status" data-tone="idle">
                    <span class="qgpt-status-dot"></span>
                    <span class="qgpt-status-text" data-qgpt="status-text">Ready</span>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(root);

    // Collapse/expand
    const collapseBtn = root.querySelector('[data-qgpt="collapse"]');
    const expandPill = root.querySelector('.qgpt-pill');
    let collapseGuardUntil = 0;
    collapseBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        collapseGuardUntil = Date.now() + 400;
        setCollapsed(true);
    }, true);
    expandPill.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (Date.now() < collapseGuardUntil) return;
        setCollapsed(false);
    }, true);

    // Toggles
    const tHighlight = root.querySelector('[data-qgpt="t-highlight"]');
    tHighlight.addEventListener('change', () => {
        qgptState.settings.highlight = tHighlight.checked;
        chrome.storage.sync.set({ highlightOption: tHighlight.checked }).catch(() => {});
    });

    const tAutoclick = root.querySelector('[data-qgpt="t-autoclick"]');
    tAutoclick.addEventListener('change', () => {
        qgptState.settings.autoClick = tAutoclick.checked;
        chrome.storage.sync.set({ autoClickOption: tAutoclick.checked }).catch(() => {});
    });

    const tSilent = root.querySelector('[data-qgpt="t-silent"]');
    tSilent.addEventListener('change', () => {
        qgptState.settings.silentMode = tSilent.checked;
        chrome.storage.sync.set({ silentMode: tSilent.checked }).catch(() => {});
        if (tSilent.checked) {
            destroyPanel();
        } else {
            mountPanel();
        }
    });

    const slider = root.querySelector('[data-qgpt="delay-slider"]');
    const delayValue = root.querySelector('[data-qgpt="delay-value"]');
    slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        qgptState.settings.answerDelay = v;
        delayValue.textContent = `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}s`;
        chrome.storage.sync.set({ answerDelay: v }).catch(() => {});
    });

    qgptState.mounted = true;
    renderPanel();
    // Load saved settings
    chrome.storage.sync.get(['highlightOption', 'autoClickOption', 'silentMode', 'answerDelay', 'kahoothackPanelCollapsed'], (data) => {
        if (typeof data.kahoothackPanelCollapsed === 'boolean') {
            qgptState.collapsed = data.kahoothackPanelCollapsed;
            root.setAttribute('data-collapsed', qgptState.collapsed ? 'true' : 'false');
        }
        qgptState.settings.highlight = data.highlightOption !== false;
        qgptState.settings.autoClick = data.autoClickOption !== false;
        qgptState.settings.silentMode = !!data.silentMode;
        qgptState.settings.answerDelay = typeof data.answerDelay === 'number' ? data.answerDelay : 0;
        renderPanel();
        if (qgptState.settings.silentMode) destroyPanel();
    });
}

function destroyPanel() {
    const root = document.getElementById(QGPT_PANEL_ID);
    if (root) root.remove();
    qgptState.mounted = false;
}

function setCollapsed(collapsed) {
    qgptState.collapsed = !!collapsed;
    const root = document.getElementById(QGPT_PANEL_ID);
    if (root) root.setAttribute('data-collapsed', qgptState.collapsed ? 'true' : 'false');
    chrome.storage.local.set({ kahoothackPanelCollapsed: qgptState.collapsed }).catch(() => {});
}

function renderPanel() {
    if (!qgptState.mounted) return;
    const root = document.getElementById(QGPT_PANEL_ID);
    if (!root) return;

    root.setAttribute('data-collapsed', qgptState.collapsed ? 'true' : 'false');

    const tHighlight = root.querySelector('[data-qgpt="t-highlight"]');
    const tAutoclick = root.querySelector('[data-qgpt="t-autoclick"]');
    const tSilent = root.querySelector('[data-qgpt="t-silent"]');
    const slider = root.querySelector('[data-qgpt="delay-slider"]');
    const delayValue = root.querySelector('[data-qgpt="delay-value"]');

    if (tHighlight) tHighlight.checked = !!qgptState.settings.highlight;
    if (tAutoclick) tAutoclick.checked = !!qgptState.settings.autoClick;
    if (tSilent) tSilent.checked = !!qgptState.settings.silentMode;
    if (slider) {
        const v = qgptState.settings.answerDelay || 0;
        slider.value = String(v);
        if (delayValue) delayValue.textContent = `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}s`;
    }

    const statusEl = root.querySelector('[data-qgpt="status"]');
    if (statusEl) statusEl.setAttribute('data-tone', qgptState.statusTone || 'idle');
    const statusText = root.querySelector('[data-qgpt="status-text"]');
    if (statusText) statusText.textContent = qgptState.status || 'Ready';
}

function updateStatus(message, forceShow = false) {
    console.log('[Content] Status:', message);
    qgptState.status = message;
    qgptState.statusTone = deriveStatusTone(message);

    if (qgptState.settings.silentMode && !forceShow) {
        destroyPanel();
        return;
    }
    if (!document.body) {
        whenBodyReady(() => { mountPanel(); renderPanel(); });
        return;
    }
    if (!qgptState.mounted) mountPanel();
    renderPanel();
}

function deriveStatusTone(message) {
    const m = (message || '').toLowerCase();
    if (m.includes('error') || m.includes('invalid') || m.includes('auth error')) return 'error';
    if (m.includes('sending') || m.includes('highlight') || m.includes('detect') || m.includes('restored') || m.includes('looking') || m.includes('reconnect')) return 'busy';
    if (m.includes('sent') || m.includes('loaded') || m.includes('answer from')) return 'success';
    if (m === 'ready') return 'idle';
    return 'idle';
}

// ---------- Question detection & deepseek integration ----------
let lastSentQuestionHash = null;
let lastQuestionPayload = null;
let lastSentQuestionIndex = null;
let lastSentHadText = false;

function scrapeQuestionFromDom() {
    const titleSelectors = [
        '[data-functional-selector="question-title"]',
        '[data-functional-selector="block-title"]',
        '[data-functional-selector="question-title-text"]',
        '[data-functional-selector*="question-title"]',
        'h1[data-functional-selector]',
        '[class*="question-title"]'
    ];
    let title = null;
    for (const sel of titleSelectors) {
        const el = document.querySelector(sel);
        const text = el && el.textContent && el.textContent.replace(/\s+/g, ' ').trim();
        if (!text || text.length < 2) continue;
        if (/^questions?\s*\d+$/i.test(text)) continue;
        title = text;
        break;
    }

    const choiceEls = findAnswerElements();
    const choices = choiceEls.map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);

    if (!title || choices.length < 2) return null;
    return { title, choices };
}

function findAnswerElements() {
    const selectors = [
        '[data-functional-selector="answer-option"]',
        '[data-functional-selector^="question-choice"]',
        '[data-functional-selector*="answer-"]',
        '[data-functional-selector="answer"]',
        '[data-functional-selector="answer-button"]',
        'button[data-functional-selector*="answer"]',
        'button[data-functional-selector*="choice"]',
        '.answer-option',
        '.answer-button',
        '.answer',
        'button[class*="answer"]',
        '[class*="answer-button"]'
    ];
    for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length >= 2) {
            console.log('[Content] Found elements with selector:', selector, elements.length);
            return Array.from(elements);
        }
    }
    return [];
}

// Listen for question events from injected script
window.addEventListener('kahootQuestionParsed', (event) => {
    console.log('[Content] Received question event:', event.detail);
    updateStatus('Question detected');

    const question = { ...(event.detail || {}) };
    if (!question || typeof question.questionIndex !== 'number') {
        if (!question || !question.title || !Array.isArray(question.choices)) {
            console.error('[Content] Invalid question data:', question);
            updateStatus('Invalid question data');
            return;
        }
    }

    if (!(question.title && Array.isArray(question.choices) && question.choices.length)) {
        const scraped = scrapeQuestionFromDom();
        if (scraped) {
            question.title = scraped.title;
            question.choices = scraped.choices;
            console.log('[Content] Scraped question from DOM:', scraped.title, scraped.choices.length);
        } else {
            setTimeout(() => {
                if (lastSentQuestionHash && lastQuestionPayload && lastQuestionPayload.questionIndex === question.questionIndex && lastQuestionPayload.title) return;
                const late = scrapeQuestionFromDom();
                if (!late || typeof question.questionIndex !== 'number') return;
                const enriched = { ...question, title: late.title, choices: late.choices };
                console.log('[Content] Late DOM scrape:', late.title);
                if (!(lastSentQuestionIndex === question.questionIndex && lastSentHadText)) {
                    lastSentHadText = false;
                    window.dispatchEvent(new CustomEvent('kahootQuestionParsed', { detail: enriched }));
                }
            }, 600);
        }
    }

    const hasText = !!(question.title && Array.isArray(question.choices) && question.choices.length);
    const qIndex = typeof question.questionIndex === 'number' ? question.questionIndex : null;
    const forceResend = !!question._reconnectAnswer && !(hasText && qIndex != null && qIndex === lastSentQuestionIndex && lastSentHadText);

    const isNewIndex = qIndex == null || qIndex !== lastSentQuestionIndex;
    const isTextUpgrade = hasText && qIndex != null && qIndex === lastSentQuestionIndex && !lastSentHadText;
    const alreadyHandled = !isNewIndex && !isTextUpgrade && (lastSentHadText || (!hasText && lastSentQuestionIndex === qIndex));
    const isDuplicate = !forceResend && alreadyHandled;

    if (hasText) {
        currentQuestion = { title: question.title, choices: question.choices };
    }

    if (!isDuplicate) {
        lastQuestionPayload = question;
        if (qIndex != null) lastSentQuestionIndex = qIndex;
        if (hasText) lastSentHadText = true;
        else if (isNewIndex) lastSentHadText = false;
        updateStatus(hasText ? 'Resolving answer...' : 'Waiting for question text...');

        // Send to background for deepseek processing
        chrome.runtime.sendMessage({
            action: 'processQuestion',
            question: question
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('[Content] Error sending message:', chrome.runtime.lastError);
                updateStatus('Error: ' + chrome.runtime.lastError.message);
            } else {
                console.log('[Content] Message sent successfully:', response);
                updateStatus(hasText ? 'Question sent' : 'Waiting for question text...');
            }
        });
    } else {
        console.log('[Content] Duplicate question detected, not sending again.', {
            qIndex,
            hasText,
            lastSentQuestionIndex,
            lastSentHadText
        });
        lastQuestionPayload = question;
    }

    if (hasText) {
        chrome.runtime.sendMessage({
            action: 'updateQuestion',
            question: { title: question.title, choices: question.choices }
        });
    }
});

// Handle messages from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[Content] Received message:', request);
    if (request.action === "highlightAnswer") {
        updateStatus('Highlighting answer...');
        highlightAnswer(request.answer, {
            ...qgptState.settings, // Spreads current toggle state (autoClick, highlight, etc.)
            questionIndex: request.questionIndex,
            answerText: request.answer,
            choiceIndex: request.choiceIndex
        }, 40, request.choiceIndex);
        sendResponse({ success: true });
    } else if (request.action === "clearAnsweredQuestion") {
        const msg = { source: 'kahoothack', type: 'clearAnsweredQuestion', questionIndex: request.questionIndex };
        try { window.postMessage(msg, '*'); } catch (_) {}
        try { if (window.top) window.top.postMessage(msg, '*'); } catch (_) {}
        sendResponse({ ok: true });
    } else if (request.action === "getQuestion") {
        sendResponse({ question: currentQuestion });
    } else if (request.action === "showAuthError") {
        updateStatus('Error: ' + request.message, true);
        sendResponse({ success: true });
    } else if (request.action === "checkStatus") {
        sendResponse({ status: 'running', currentQuestion, timestamp: new Date().toISOString() });
    }
    return true;
});

// ---------- Highlight & Auto‑click logic (unchanged) ----------
function applyHighlightStyles(correctElement) {
    if (correctElement.querySelector('.kahoothack-checkmark')) return;
    const checkmark = document.createElement('span');
    checkmark.className = 'kahoothack-checkmark';
    checkmark.textContent = '✅';
    checkmark.setAttribute('aria-hidden', 'true');
    checkmark.style.cssText = [
        'display:inline-flex',
        'align-items:center',
        'margin-left:8px',
        'font-size:1.15em',
        'line-height:1',
        'vertical-align:middle',
        'pointer-events:none',
        'user-select:none'
    ].join(';');
    correctElement.appendChild(checkmark);
}

function dispatchAutoClick(choiceIndex, questionIndex) {
    const choice = Number(choiceIndex);
    const qIndex = typeof questionIndex === 'number' ? questionIndex : undefined;
    if (Number.isNaN(choice) || choice < 0) {
        console.warn('[Content] Auto-click aborted — invalid choiceIndex', choiceIndex);
        return;
    }
    const msg = { source: 'kahoothack', type: 'autoClickAnswer', choice, questionIndex: qIndex, t: Date.now() };
    console.log('[Content] Auto-click by index:', choice, 'questionIndex:', qIndex);

    const targets = new Set([window]);
    try { if (window.parent) targets.add(window.parent); } catch (_) {}
    try { if (window.top) targets.add(window.top); } catch (_) {}
    targets.forEach((w) => { try { w.postMessage(msg, '*'); } catch (_) {} });

    // DOM bridge fallback
    try {
        let bridge = document.getElementById('kahoothack-click-bridge');
        if (!bridge) {
            bridge = document.createElement('div');
            bridge.id = 'kahoothack-click-bridge';
            bridge.style.display = 'none';
            (document.documentElement || document.body).appendChild(bridge);
        }
        bridge.removeAttribute('data-payload');
        bridge.setAttribute('data-payload', JSON.stringify(msg));
    } catch (_) {}
}

function autoClickByIndex(choiceIndex, answerElements, options) {
    const answerDelay = typeof options.answerDelay === 'number' ? options.answerDelay : 0;
    const questionIndex = options.questionIndex;
    const fire = () => dispatchAutoClick(choiceIndex, questionIndex);
    if (answerDelay > 0 && !options.silentMode) {
        showTimerOverlay(answerDelay, fire);
    } else if (answerDelay > 0 && options.silentMode) {
        setTimeout(fire, answerDelay * 1000);
    } else {
        fire();
    }
}

function highlightAnswer(answer, options = {}, pollTries = 40, choiceIndex) {
    console.log('[Content] Highlighting answer:', answer, 'choiceIndex:', choiceIndex, 'options:', options);
    const answerElements = findAnswerElements();
    console.log('[Content] Found answer elements:', answerElements.length);

    if (typeof choiceIndex === 'number') {
        const byIndex = answerElements[choiceIndex] || null;
        if (options.highlight !== false && byIndex) applyHighlightStyles(byIndex);
        if (byIndex) {
            if (options.autoClick !== false && !options._wsSubmitted) {
                options._wsSubmitted = true;
                waitAndAutoClick(byIndex, answerElements, { ...options, choiceIndex, questionIndex: options.questionIndex });
            }
            return;
        }
        if (pollTries > 0) {
            if (pollTries <= 5 && options.autoClick !== false && !options._wsSubmitted) {
                options._wsSubmitted = true;
                console.log('[Content] DOM buttons missing — WS-only click fallback');
                autoClickByIndex(choiceIndex, answerElements, options);
            }
            setTimeout(() => highlightAnswer(answer, options, pollTries - 1, choiceIndex), 200);
            return;
        }
        if (options.autoClick !== false && !options._wsSubmitted) {
            options._wsSubmitted = true;
            autoClickByIndex(choiceIndex, answerElements, options);
        }
        return;
    }

    if (answerElements.length === 0 && pollTries > 0) {
        setTimeout(() => highlightAnswer(answer, options, pollTries - 1, choiceIndex), 300);
        return;
    }
    if (answerElements.length === 0) {
        console.log('[Content] No matching answer element found (after polling)');
        return;
    }

    const answerLower = (answer || '').toLowerCase().trim();
    if (!answerLower) { console.log('[Content] No answer text and no choiceIndex'); return; }

    let correctElement = null;
    let bestMatch = null;
    let bestMatchScore = 0;
    answerElements.forEach(element => {
        let text = element.textContent.toLowerCase().trim().replace(/icon/g, '').replace(/\s+/g, ' ').trim();
        if (text.length >= 3) {
            const third = Math.floor(text.length / 3);
            const firstPart = text.substring(0, third);
            const secondPart = text.substring(third, third * 2);
            const thirdPart = text.substring(third * 2);
            if (firstPart === secondPart && secondPart === thirdPart) text = firstPart;
        }
        let score = 0;
        if (text === answerLower) score = 100;
        else if (text.includes(answerLower)) score = 80;
        else if (answerLower.includes(text)) score = 60;
        else {
            const words1 = text.split(/\s+/);
            const words2 = answerLower.split(/\s+/);
            const commonWords = words1.filter(word => words2.includes(word));
            score = (commonWords.length / Math.max(words1.length, words2.length)) * 40;
        }
        if (score > bestMatchScore) { bestMatchScore = score; bestMatch = element; }
        if (score === 100) { correctElement = element; console.log('[Content] Found exact match:', text); }
    });

    if (!correctElement && bestMatch && bestMatchScore >= 60) {
        correctElement = bestMatch;
        console.log('[Content] Using best match with score:', bestMatchScore);
    }

    if (correctElement) {
        console.log('[Content] Found matching answer element');
        if (options.highlight !== false) applyHighlightStyles(correctElement);
        if (options.autoClick !== false) waitAndAutoClick(correctElement, answerElements, options);
    } else {
        console.log('[Content] No matching answer element found');
    }
}

function simulateRealClick(element) {
    if (!element) return false;
    try {
        const opts = { bubbles: true, cancelable: true, view: window, composed: true };
        element.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, pointerType: 'mouse' }));
        element.dispatchEvent(new MouseEvent('mousedown', opts));
        element.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, pointerType: 'mouse' }));
        element.dispatchEvent(new MouseEvent('mouseup', opts));
        element.dispatchEvent(new MouseEvent('click', opts));
        if (typeof element.click === 'function') element.click();
        return true;
    } catch (err) {
        console.warn('[Content] simulateRealClick failed:', err);
        try { element.click(); return true; } catch (_) { return false; }
    }
}

function waitAndAutoClick(element, answerElements, options, retries = 20) {
    if (!element) return;
    const answerDelay = typeof options.answerDelay === 'number' ? options.answerDelay : 0;
    let choiceIndex = typeof options.choiceIndex === 'number' ? options.choiceIndex : Array.from(answerElements).indexOf(element);
    if ((typeof choiceIndex !== 'number' || choiceIndex < 0) && options.answerText) {
        const want = String(options.answerText).toLowerCase().trim();
        choiceIndex = answerElements.findIndex((el) => {
            const t = (el.textContent || '').toLowerCase().replace(/\s+/g, ' ').trim();
            return t === want || t.includes(want) || want.includes(t);
        });
    }
    if (typeof choiceIndex !== 'number' || choiceIndex < 0) {
        console.warn('[Content] AutoClick: could not resolve choiceIndex');
        return;
    }
    const fire = () => {
        const clicked = simulateRealClick(element);
        console.log('[Content] DOM click', clicked ? 'ok' : 'failed', 'choice', choiceIndex);
        dispatchAutoClick(choiceIndex, options.questionIndex);
    };
    if (!element.disabled && element.offsetParent !== null) {
        if (answerDelay > 0 && !options.silentMode) showTimerOverlay(answerDelay, fire);
        else if (answerDelay > 0 && options.silentMode) setTimeout(fire, answerDelay * 1000);
        else fire();
    } else if (retries > 0) {
        setTimeout(() => waitAndAutoClick(element, answerElements, options, retries - 1), 250);
    } else {
        console.warn('[Content] AutoClick: Button was never enabled — WS fallback');
        dispatchAutoClick(choiceIndex, options.questionIndex);
    }
}

function showTimerOverlay(duration, callback) {
    const existingTimer = document.getElementById('kahoothack-timer-overlay');
    if (existingTimer) existingTimer.remove();

    const timerOverlay = document.createElement('div');
    timerOverlay.id = 'kahoothack-timer-overlay';
    timerOverlay.style.cssText = `
        position: fixed; top: 20px; right: 20px;
        background: linear-gradient(135deg, rgba(138,43,226,0.95), rgba(218,112,214,0.95));
        color: white; padding: 15px 20px; border-radius: 12px; z-index: 10000;
        font-family: 'Segoe UI', Arial, sans-serif; font-size: 14px; font-weight: 600;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.2);
        text-align: center; min-width: 180px;
        animation: slideIn 0.3s ease-out; cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
    `;
    const timerText = document.createElement('div');
    timerText.style.cssText = 'margin-bottom:8px; font-size:13px; opacity:0.9;';
    timerText.textContent = 'Auto-clicking in';
    const cancelHint = document.createElement('div');
    cancelHint.style.cssText = 'font-size:11px; opacity:0.7; margin-bottom:8px; cursor:pointer;';
    cancelHint.textContent = '(Click to cancel)';
    const countdownDisplay = document.createElement('div');
    countdownDisplay.style.cssText = 'font-size:24px; font-weight:700; color:#fff; text-shadow:0 2px 4px rgba(0,0,0,0.3);';
    const progressBar = document.createElement('div');
    progressBar.style.cssText = 'width:100%; height:3px; background:rgba(255,255,255,0.3); border-radius:2px; margin-top:10px; overflow:hidden;';
    const progressFill = document.createElement('div');
    progressFill.style.cssText = 'height:100%; background:#fff; border-radius:2px; width:100%; transition: width linear; transition-duration:' + duration + 's;';
    progressBar.appendChild(progressFill);
    timerOverlay.appendChild(timerText);
    timerOverlay.appendChild(cancelHint);
    timerOverlay.appendChild(countdownDisplay);
    timerOverlay.appendChild(progressBar);

    if (!document.querySelector('#kahoothack-timer-styles')) {
        const timerStyles = document.createElement('style');
        timerStyles.id = 'kahoothack-timer-styles';
        timerStyles.textContent = `
            @keyframes slideIn { from { transform: translateX(100%); opacity:0; } to { transform: translateX(0); opacity:1; } }
            @keyframes slideOut { from { transform: translateX(0); opacity:1; } to { transform: translateX(100%); opacity:0; } }
            #kahoothack-timer-overlay:hover { transform: scale(1.05); box-shadow: 0 6px 25px rgba(0,0,0,0.4); }
        `;
        document.head.appendChild(timerStyles);
    }
    document.body.appendChild(timerOverlay);

    setTimeout(() => { progressFill.style.width = '0%'; }, 100);

    let timeLeft = duration;
    countdownDisplay.textContent = timeLeft.toFixed(1);
    const countdownInterval = setInterval(() => {
        timeLeft -= 0.1;
        if (timeLeft <= 0) {
            clearInterval(countdownInterval);
            timerOverlay.style.animation = 'slideOut 0.3s ease-in';
            setTimeout(() => { if (timerOverlay.parentNode) timerOverlay.remove(); callback(); }, 300);
        } else {
            countdownDisplay.textContent = timeLeft.toFixed(1);
        }
    }, 100);

    timerOverlay.addEventListener('click', () => {
        clearInterval(countdownInterval);
        timerText.textContent = 'Auto-click canceled';
        cancelHint.style.display = 'none';
        countdownDisplay.textContent = '✕';
        progressFill.style.width = '0%';
        progressFill.style.background = '#ff6b6b';
        setTimeout(() => {
            timerOverlay.style.animation = 'slideOut 0.3s ease-in';
            setTimeout(() => { if (timerOverlay.parentNode) timerOverlay.remove(); }, 300);
        }, 800);
    });
}

// Initialize panel
whenBodyReady(() => {
    mountPanel();
});

// Storage changes for settings
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'sync') return;
    const relevant = ['highlightOption', 'autoClickOption', 'silentMode', 'answerDelay'];
    if (!relevant.some(k => k in changes)) return;
    chrome.storage.sync.get(relevant, (data) => {
        qgptState.settings.highlight = data.highlightOption !== false;
        qgptState.settings.autoClick = data.autoClickOption !== false;
        qgptState.settings.silentMode = !!data.silentMode;
        qgptState.settings.answerDelay = typeof data.answerDelay === 'number' ? data.answerDelay : 0;
        if (qgptState.settings.silentMode) destroyPanel();
        else { mountPanel(); renderPanel(); }
    });
});
(() => {
// Content script can inject this more than once (all_frames / re-inject). Guard before any const.
if (window.__kahoothackInjected) return;
window.__kahoothackInjected = true;

const TAG = '[ KAHOOT HACK ALERT ]';
const IS_TOP_FRAME = (() => {
    try { return window.top === window.self; } catch (_) { return false; }
})();

// ---------- Logging (human readable, de-duplicated, quiet in sub-frames) ----------
const lastLogAt = new Map();
function emit(level, message, force) {
    // Sub-frames only speak up if they actually hold the game connection.
    if (!force && !IS_TOP_FRAME && !window.__kahootWS) return;
    const now = Date.now();
    const key = level + message;
    if (now - (lastLogAt.get(key) || 0) < 1500) return; // drop identical repeats
    lastLogAt.set(key, now);
    console[level](`${TAG} ${message}`);
}
const log = {
    info: (m) => emit('log', m),
    warn: (m) => emit('warn', m),
    error: (m) => emit('error', m, true)
};

function shorten(text, max = 70) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
const humanQ = (idx) => (typeof idx === 'number' ? `#${idx + 1}` : '(unknown number)');
const letterOf = (idx) => (typeof idx === 'number' && idx >= 0 ? String.fromCharCode(65 + idx) : '?');

const OldWebSocket = window.WebSocket;
window.__kahootWS = null;
window.kahootClientId = null;
window.kahootGameId = null;
window.kahootQuestionIndex = 0;
window.kahootMessageId = 0;
window.kahootDataId = 45; // Fixed value for answer submissions based on Burp Suite analysis

// ---------- Console commands (type these in DevTools → Console) ----------
if (IS_TOP_FRAME) {
    const send = (type) => { try { window.postMessage({ source: 'kahoothack', type }, '*'); } catch (_) {} };
    const api = {
        show() { send('showPanel'); return 'Panel restored.'; },
        hide() { send('hidePanel'); return 'Panel hidden.'; },
        help() {
            const text =
                `${TAG} Console commands:\n` +
                '  kahootHack.show()  → bring the panel back (turns Incognito mode off)\n' +
                '  kahootHack.hide()  → hide the panel (turns Incognito mode on)\n' +
                '  kahootHack.help()  → show this list';
            console.log(text);
            return 'ok';
        }
    };
    try {
        Object.defineProperty(window, 'kahootHack', { value: Object.freeze(api), enumerable: false, configurable: true });
    } catch (_) { window.kahootHack = api; }
    log.info('Ready. Type kahootHack.help() in the console to see the commands.');
}

// ---------- Image helpers ----------
function pickImageUrl(value) {
    if (!value) return null;
    if (typeof value === 'string') return /^(https?:)?\/\//i.test(value.trim()) ? value.trim() : null;
    if (typeof value === 'object') return pickImageUrl(value.url || value.src || value.image || null);
    return null;
}

function extractQuestionImage(content) {
    const direct = pickImageUrl(content.image) || pickImageUrl(content.imageUrl);
    if (direct) return direct;
    if (Array.isArray(content.media)) {
        for (const m of content.media) {
            if (m && (!m.type || String(m.type).toLowerCase() === 'image')) {
                const url = pickImageUrl(m.image || m.url || m.src);
                if (url) return url;
            }
        }
    }
    return null;
}

function extractChoiceImage(choice) {
    if (!choice || typeof choice !== 'object') return null;
    return pickImageUrl(choice.image) || pickImageUrl(choice.imageUrl) || pickImageUrl(choice.media);
}

function handleParsedContent(content, dataId) {
    if (!content || typeof content !== 'object') return;

    // START_QUIZ (id 9): game started — clear reconnect flags
    if (dataId === 9) {
        clearExpectingReconnect();
        window.__kahootSoftReconnect = false;
        log.info('The game has started.');
    }

    const questionIndex = typeof content.questionIndex === 'number'
        ? content.questionIndex
        : (typeof content.questionNumber === 'number' ? content.questionNumber : null);

    // Full question (host enabled "show questions on players' devices")
    if (content.type === 'quiz' && content.title && Array.isArray(content.choices)) {
        clearGetReadyFallback();
        // Prefer this over any pending index-only QuestionStart emit
        window.__kahootPendingFullQuestion = null;
        if (window.__kahootQuestionStartTimer) {
            clearTimeout(window.__kahootQuestionStartTimer);
            window.__kahootQuestionStartTimer = null;
        }
        const question = {
            title: content.title,
            choices: content.choices.map(c => (typeof c === 'string' ? c : (c && c.answer) || '')),
            image: extractQuestionImage(content),
            choiceImages: content.choices.map(extractChoiceImage),
            questionIndex: questionIndex != null ? questionIndex : window.kahootQuestionIndex,
            _fromQuestionStart: true
        };
        window.kahootQuestionIndex = question.questionIndex;
        const imageNote = question.image ? ', has an image' : '';
        const choiceImageCount = question.choiceImages.filter(Boolean).length;
        log.info(
            `Question ${humanQ(question.questionIndex)} received: "${shorten(question.title)}" ` +
            `(${question.choices.length} choices${imageNote}${choiceImageCount ? `, ${choiceImageCount} choice image(s)` : ''}).`
        );
        window.dispatchEvent(new CustomEvent("kahootQuestionParsed", { detail: question }));
        return;
    }

    // GetReady (id 1): track index. Answer immediately only after soft reconnect
    // (mid-question rejoin often never gets QuestionStart again).
    if (questionIndex != null && dataId === 1) {
        window.kahootQuestionIndex = questionIndex;
        persistLastQuestionIndex(questionIndex);
        log.info(`Get ready – question ${humanQ(questionIndex)} is about to start.`);
        if (window.__kahootSoftReconnect || isExpectingReconnect()) {
            scheduleGetReadyFallback(questionIndex);
        }
        return;
    }

    // QuestionStart (id 2) — delay briefly so a full type=quiz payload can win (show-questions).
    // Emitting index-only/scrape first caused "duplicate" drops of the real question.
    if (questionIndex != null && dataId === 2) {
        clearGetReadyFallback();
        window.__kahootSoftReconnect = false;
        clearExpectingReconnect();
        if (window.__kahoothackAnsweredQ !== questionIndex) {
            window.__kahoothackAnsweredQ = null;
        }
        window.kahootQuestionIndex = questionIndex;
        persistLastQuestionIndex(questionIndex);
        log.info(`Question ${humanQ(questionIndex)} started, waiting for its text…`);

        window.__kahootPendingFullQuestion = questionIndex;
        if (window.__kahootQuestionStartTimer) {
            clearTimeout(window.__kahootQuestionStartTimer);
        }
        window.__kahootQuestionStartTimer = setTimeout(() => {
            window.__kahootQuestionStartTimer = null;
            if (window.__kahootPendingFullQuestion !== questionIndex) return;
            window.__kahootPendingFullQuestion = null;
            const question = {
                title: null,
                choices: null,
                questionIndex,
                _fromQuestionStart: true
            };
            log.info(`No question text arrived for ${humanQ(questionIndex)}; reading it from the page instead.`);
            window.dispatchEvent(new CustomEvent("kahootQuestionParsed", { detail: question }));
        }, 200);
        return;
    }

    // Recovery / other payloads during reconnect may include questionIndex without id 1/2
    if (window.__kahootSoftReconnect && questionIndex != null) {
        window.kahootQuestionIndex = questionIndex;
        persistLastQuestionIndex(questionIndex);
        scheduleGetReadyFallback(questionIndex);
    }
}

function persistLastQuestionIndex(questionIndex) {
    try {
        const prev = JSON.parse(sessionStorage.getItem('kahoothack_quiz_meta') || '{}');
        sessionStorage.setItem('kahoothack_quiz_meta', JSON.stringify({
            lastQuestionIndex: questionIndex,
            gameid: window.kahootGameId || prev.gameid || null,
            pendingAnswer: prev.pendingAnswer || window.__kahoothackPendingAnswer || null
        }));
    } catch (_) { /* ignore */ }
}

function isExpectingReconnect() {
    try {
        return sessionStorage.getItem('kahoothack_expect_reconnect') === '1';
    } catch (_) {
        return false;
    }
}

function setExpectingReconnect() {
    try { sessionStorage.setItem('kahoothack_expect_reconnect', '1'); } catch (_) { /* ignore */ }
}

function clearExpectingReconnect() {
    try { sessionStorage.removeItem('kahoothack_expect_reconnect'); } catch (_) { /* ignore */ }
}

function emitAnswerForQuestionIndex(questionIndex, reason) {
    if (typeof questionIndex !== 'number') return;
    const now = Date.now();
    if (window.__kahootLastEmitIndex === questionIndex && now - (window.__kahootLastEmitAt || 0) < 2000) {
        return; // duplicate, stay quiet
    }
    window.__kahootLastEmitIndex = questionIndex;
    window.__kahootLastEmitAt = now;
    const softReconnect = !!window.__kahootSoftReconnect;
    const question = {
        title: null,
        choices: null,
        questionIndex,
        fromGetReadyFallback: true,
        // Only mark reconnect when we actually soft-reconnected — otherwise this
        // falsely force-resends AI and burns extra free usages every round.
        _reconnectAnswer: softReconnect,
        _fromQuestionStart: true
    };
    log.info(`Answering question ${humanQ(questionIndex)} (${reason}${softReconnect ? ', after reconnect' : ''}).`);
    window.dispatchEvent(new CustomEvent('kahootQuestionParsed', { detail: question }));
}

function clearGetReadyFallback() {
    if (window.__kahootGetReadyTimer) {
        clearTimeout(window.__kahootGetReadyTimer);
        window.__kahootGetReadyTimer = null;
    }
    window.__kahootPendingGetReady = null;
}

function scheduleGetReadyFallback(questionIndex) {
    clearGetReadyFallback();
    window.__kahootPendingGetReady = questionIndex;
    // Reconnect mid-question often only sends GetReady, never QuestionStart again
    window.__kahootGetReadyTimer = setTimeout(() => {
        if (window.__kahootPendingGetReady !== questionIndex) return;
        window.__kahootPendingGetReady = null;
        window.__kahootGetReadyTimer = null;
        emitAnswerForQuestionIndex(questionIndex, 'rejoined mid-question');
    }, 500);
}

// Restore gameid for reconnect UX
try {
    const raw = sessionStorage.getItem('kahoothack_quiz_meta');
    if (raw) {
        const data = JSON.parse(raw);
        if (data.gameid && !window.kahootGameId) {
            window.kahootGameId = data.gameid;
        }
    }
} catch (_) { /* ignore */ }

// Hook into the WebSocket constructor
window.WebSocket = function (url, protocols) {
    let host = String(url);
    try { host = new URL(url).host; } catch (_) { /* keep raw */ }

    let ws;
    if (protocols) {
        ws = new OldWebSocket(url, protocols);
    } else {
        ws = new OldWebSocket(url);
    }
    window.__kahootWS = ws;
    log.info(`Game connection opening (${host}).`);

    ws.addEventListener("message", function (event) {
        try {
            const data = JSON.parse(event.data);
            const items = Array.isArray(data) ? data : [data];

            items.forEach(item => {
                if (item.clientId) {
                    const prevClient = window.kahootClientId;
                    window.kahootClientId = item.clientId;
                    if (prevClient && prevClient !== item.clientId) {
                        log.info('Session refreshed (new client ID).');
                        // New CometD session after socket swap — resend pending answer with new clientId
                        if (window.__kahoothackPendingAnswer) {
                            window.__kahoothackAnsweredQ = null;
                            schedulePendingAnswerResend();
                        }
                    } else if (!prevClient) {
                        log.info('Joined the game session (client ID received).');
                        if (window.__kahoothackAwaitingResend) {
                            window.__kahoothackAwaitingResend = false;
                            schedulePendingAnswerResend();
                        }
                    }
                }

                if (item.data?.gameid) {
                    const incomingId = item.data.gameid;
                    const previousId = window.kahootGameId;

                    if (previousId !== incomingId) {
                        window.kahootGameId = incomingId;

                        // null → pin after WS reconnect is NOT a new quiz
                        const isSoftReconnect = previousId == null;
                        const isHardNewGame = previousId != null && String(previousId) !== String(incomingId);

                        if (isHardNewGame) {
                            window.kahootQuestionIndex = 0;
                            window.__kahoothackAnsweredQ = null;
                            window.__kahoothackPendingAnswer = null;
                            try { sessionStorage.removeItem('kahoothack_quiz_meta'); } catch (_) { /* ignore */ }
                            log.info(`A new game was detected (game ID ${incomingId}).`);
                            window.dispatchEvent(new CustomEvent("kahootGameReset", {
                                detail: { gameid: incomingId, soft: false }
                            }));
                        } else if (isSoftReconnect) {
                            log.info(`Reconnected to game ${incomingId}.`);
                            window.__kahootSoftReconnect = true;
                            window.__kahoothackAnsweredQ = null;
                            window.dispatchEvent(new CustomEvent("kahootGameReset", {
                                detail: { gameid: incomingId, soft: true }
                            }));
                            const savedIdx = (() => {
                                if (typeof window.__kahootLastQuestionIndex === 'number') {
                                    return window.__kahootLastQuestionIndex;
                                }
                                try {
                                    const raw = sessionStorage.getItem('kahoothack_quiz_meta');
                                    const n = raw ? JSON.parse(raw).lastQuestionIndex : null;
                                    return typeof n === 'number' ? n : null;
                                } catch (_) { return null; }
                            })();
                            if (typeof savedIdx === 'number') {
                                window.kahootQuestionIndex = savedIdx;
                                scheduleGetReadyFallback(savedIdx);
                            }
                            schedulePendingAnswerResend();
                        }
                    } else if (window.__kahoothackAwaitingResend && window.kahootClientId) {
                        window.__kahoothackAwaitingResend = false;
                        schedulePendingAnswerResend();
                    }
                }

                if (item.data?.content) {
                    try {
                        const raw = item.data.content;
                        const content = typeof raw === 'string' ? JSON.parse(raw) : raw;
                        handleParsedContent(content, item.data.id);
                    } catch (e) {
                        log.warn(`Could not read a game message (${e.message}).`);
                    }
                }

                if (item.id) {
                    const msgId = parseInt(item.id, 10);
                    if (!isNaN(msgId) && msgId > window.kahootMessageId) {
                        window.kahootMessageId = msgId;
                    }
                }
            });
        } catch (e) {
            // Non-JSON frames (pings, binary) are normal; nothing worth printing.
        }
    });

    ws.addEventListener("open", () => {
        log.info('Game connection established.');
        if (window.__kahoothackPendingAnswer) {
            window.__kahoothackAwaitingResend = true;
            window.__kahoothackAnsweredQ = null;
            // clientId usually arrives with the first message on this socket
            schedulePendingAnswerResend();
        }
    });

    ws.addEventListener("close", () => {
        log.warn('Game connection closed. Your last answer will be resent after reconnecting.');
        setExpectingReconnect();
        try {
            const prev = JSON.parse(sessionStorage.getItem('kahoothack_quiz_meta') || '{}');
            sessionStorage.setItem('kahoothack_quiz_meta', JSON.stringify({
                lastQuestionIndex: typeof window.kahootQuestionIndex === 'number'
                    ? window.kahootQuestionIndex
                    : prev.lastQuestionIndex,
                gameid: window.kahootGameId || prev.gameid || null,
                pendingAnswer: window.__kahoothackPendingAnswer || prev.pendingAnswer || null
            }));
        } catch (_) { /* ignore */ }
        // Keep gameid/clientId — needed to resend on the next socket. Only drop the dead WS handle.
        if (window.__kahootWS === ws) {
            window.__kahootWS = null;
        }
        window.__kahootLastQuestionIndex = window.kahootQuestionIndex;
        window.__kahoothackAnsweredQ = null;
        clearGetReadyFallback();
    });

    ws.addEventListener("error", () => {
        log.error('Game connection error.');
    });

    return ws;
};

window.WebSocket.prototype = OldWebSocket.prototype;

// Sends the answer through WebSocket.
// Pass explicitQuestionIndex when known — do not rely on a possibly stale window value.
window.sendAutoClickMessage = function (answerChoice, explicitQuestionIndex) {
    const gameid = window.kahootGameId;
    const clientId = window.kahootClientId;
    const questionIndex = typeof explicitQuestionIndex === 'number'
        ? explicitQuestionIndex
        : window.kahootQuestionIndex;
    const choice = Number(answerChoice);

    if (!gameid || !clientId || !window.__kahootWS) {
        const missing = [!gameid && 'game ID', !clientId && 'client ID', !window.__kahootWS && 'connection'].filter(Boolean).join(', ');
        log.warn(`Cannot send the answer yet – missing: ${missing}.`);
        return;
    }

    if (typeof questionIndex !== 'number' || Number.isNaN(choice) || choice < 0) {
        log.warn(`Cannot send the answer – unknown question number or option (question ${questionIndex}, option ${answerChoice}).`);
        return;
    }

    // One WS submit per question (prevents multi-frame postMessage spam)
    if (window.__kahoothackAnsweredQ === questionIndex
        && Date.now() - (window.__kahoothackAnsweredAt || 0) < 8000) {
        return; // already answered, stay quiet
    }

    window.kahootQuestionIndex = questionIndex;
    window.kahootMessageId++;

    const payload = [{
        id: window.kahootMessageId.toString(),
        channel: "/service/controller",
        data: {
            gameid,
            type: "message",
            host: "kahoot.it",
            id: window.kahootDataId,
            content: JSON.stringify({
                type: "quiz",
                choice,
                questionIndex
            })
        },
        clientId,
        ext: {}
    }];

    if (window.__kahootWS.readyState === 1) {
        window.__kahootWS.send(JSON.stringify(payload));
        window.__kahoothackAnsweredQ = questionIndex;
        window.__kahoothackAnsweredAt = Date.now();
        window.__kahoothackPendingAnswer = {
            choice,
            questionIndex,
            gameid,
            at: Date.now()
        };
        log.info(`Answer sent for question ${humanQ(questionIndex)}: option ${letterOf(choice)}.`);
    } else {
        log.error('Game connection is not open yet; the answer will be sent once it reconnects.');
        window.__kahoothackPendingAnswer = {
            choice,
            questionIndex,
            gameid,
            at: Date.now()
        };
    }
};

function schedulePendingAnswerResend() {
    const pending = window.__kahoothackPendingAnswer;
    if (!pending || typeof pending.choice !== 'number' || typeof pending.questionIndex !== 'number') return;
    if (Date.now() - (pending.at || 0) > 20000) {
        window.__kahoothackPendingAnswer = null;
        window.__kahoothackAwaitingResend = false;
        return;
    }

    // Avoid stacking multiple resend loops
    const token = (window.__kahoothackResendToken = (window.__kahoothackResendToken || 0) + 1);
    let tries = 0;
    const tick = () => {
        if (token !== window.__kahoothackResendToken) return;
        tries += 1;
        if (!window.__kahootWS || window.__kahootWS.readyState !== 1 || !window.kahootClientId || !window.kahootGameId) {
            if (tries < 30) setTimeout(tick, 200);
            return;
        }
        if (pending.gameid != null && String(pending.gameid) !== String(window.kahootGameId)) {
            window.__kahoothackPendingAnswer = null;
            window.__kahoothackAwaitingResend = false;
            return;
        }
        pending.resendCount = (pending.resendCount || 0) + 1;
        if (pending.resendCount > 2) {
            log.warn(`Gave up resending the answer for question ${humanQ(pending.questionIndex)}. Rejoin the game if it was not counted.`);
            window.__kahoothackPendingAnswer = null;
            window.__kahoothackAwaitingResend = false;
            return;
        }
        log.info(`Resending the answer for question ${humanQ(pending.questionIndex)} after reconnecting (attempt ${pending.resendCount} of 2).`);
        window.__kahoothackAnsweredQ = null;
        window.__kahoothackAwaitingResend = false;
        window.sendAutoClickMessage(pending.choice, pending.questionIndex);
        pending.at = Date.now();
    };
    setTimeout(tick, 300);
}

window.addEventListener("autoClickAnswer", function (event) {
    const detail = event.detail;
    let choice;
    let questionIndex;

    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
        choice = detail.choice;
        questionIndex = detail.questionIndex;
    } else {
        choice = detail;
    }

    window.sendAutoClickMessage(choice, questionIndex);
});

function handlekahoothackPageMessage(data) {
    if (!data || data.source !== 'kahoothack') return false;
    if (data.type === 'autoClickAnswer') {
        window.sendAutoClickMessage(data.choice, data.questionIndex);
        return true;
    }
    if (data.type === 'clearAnsweredQuestion') {
        if (typeof data.questionIndex === 'number' && window.__kahoothackAnsweredQ === data.questionIndex) {
            window.__kahoothackAnsweredQ = null;
        }
        return true;
    }
    if (data.type === 'answerCurrentQuestion') {
        let idx = typeof window.kahootQuestionIndex === 'number' ? window.kahootQuestionIndex : null;
        if (typeof idx !== 'number') {
            try {
                const raw = sessionStorage.getItem('kahoothack_quiz_meta');
                const n = raw ? JSON.parse(raw).lastQuestionIndex : null;
                if (typeof n === 'number') idx = n;
            } catch (_) { /* ignore */ }
        }
        if (typeof data.questionIndex === 'number') idx = data.questionIndex;
        if (typeof idx === 'number') {
            window.__kahootSoftReconnect = true;
            emitAnswerForQuestionIndex(idx, 'requested by the page');
        } else {
            log.info('No question number is known yet, so there is nothing to answer.');
        }
        return true;
    }
    return false; // showPanel / hidePanel are handled by the content script
}

// Content-script → page bridge (CustomEvent does not cross isolated worlds)
window.addEventListener('message', function (event) {
    handlekahoothackPageMessage(event.data);
});

// DOM attribute bridge (works even when postMessage frame targeting fails)
(function watchClickBridge() {
    const ensure = () => {
        let bridge = document.getElementById('kahoothack-click-bridge');
        if (!bridge) {
            bridge = document.createElement('div');
            bridge.id = 'kahoothack-click-bridge';
            bridge.style.display = 'none';
            (document.documentElement || document.body || document).appendChild(bridge);
        }
        return bridge;
    };

    const run = () => {
        try {
            const bridge = ensure();
            const obs = new MutationObserver(() => {
                const raw = bridge.getAttribute('data-payload');
                if (!raw) return;
                bridge.removeAttribute('data-payload');
                try {
                    handlekahoothackPageMessage(JSON.parse(raw));
                } catch (e) {
                    log.warn(`Could not read a click request (${e.message}).`);
                }
            });
            obs.observe(bridge, { attributes: true, attributeFilter: ['data-payload'] });
        } catch (e) {
            log.warn(`Click bridge could not start (${e.message}).`);
        }
    };

    if (document.documentElement) run();
    else document.addEventListener('DOMContentLoaded', run);
})();

})(); // end kahoothack inject guard
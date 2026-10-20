// background.js – talks to OpenRouter (DeepSeek vision) and returns the answer to the page

const TAG = '[ KAHOOT HACK ALERT ]';
const MODEL = 'deepseek/deepseek-v4-flash-vision-exp';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // skip inlining anything bigger than 4 MB
const MAX_CHOICE_IMAGES = 8;

let cachedKeys = null;
let currentKeyIndex = 0;

// ---------- Logging (human readable, de-duplicated) ----------
const lastLogAt = new Map();
function emit(level, message) {
    const now = Date.now();
    const key = level + message;
    if (now - (lastLogAt.get(key) || 0) < 1500) return; // drop identical repeats
    lastLogAt.set(key, now);
    console[level](`${TAG} ${message}`);
}
const log = {
    info: (m) => emit('log', m),
    warn: (m) => emit('warn', m),
    error: (m) => emit('error', m)
};

function shorten(text, max = 80) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

// ---------- API keys ----------
async function getApiKeys() {
    if (cachedKeys) return cachedKeys;
    try {
        const response = await fetch(chrome.runtime.getURL('keys.json'));
        const data = await response.json();
        cachedKeys = Array.isArray(data.API_KEYS) ? data.API_KEYS : [];
        log.info(`Loaded ${cachedKeys.length} API key(s) from keys.json.`);
        return cachedKeys;
    } catch (err) {
        log.error(`Could not read keys.json (${err.message}). Make sure it sits next to manifest.json.`);
        return [];
    }
}

// ---------- Messaging ----------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'processQuestion') {
        handleProcessQuestion(request, sender, sendResponse);
        return true; // async
    }
    sendResponse({ ok: true });
    return true;
});

async function handleProcessQuestion(request, sender, sendResponse) {
    const { question } = request;
    if (!question || (!question.title && !question.choices)) {
        log.warn('Ignored a question with no title and no choices.');
        sendResponse({ error: 'Invalid question' });
        return;
    }

    const choices = Array.isArray(question.choices) ? question.choices : [];
    const choiceImageCount = (question.choiceImages || []).filter(Boolean).length;
    log.info(
        `Asking ${MODEL} about question ${typeof question.questionIndex === 'number' ? question.questionIndex + 1 : '?'}: ` +
        `"${shorten(question.title) || '(no text)'}" ` +
        `[${choices.length} choices, ${question.image ? 'question image' : 'no question image'}, ${choiceImageCount} choice image(s)]`
    );

    try {
        const content = await buildMessageContent(question);
        const answer = await callOpenRouter(content);
        if (!answer) {
            sendResponse({ error: 'No answer from OpenRouter' });
            return;
        }

        const { choiceIndex, answerText } = parseAnswer(answer, choices);
        const letter = String.fromCharCode(65 + choiceIndex);
        log.info(`AI picked ${letter}${answerText ? ` – "${shorten(answerText)}"` : ''} (raw reply: "${shorten(answer, 60)}").`);

        chrome.tabs.sendMessage(
            sender.tab.id,
            {
                action: 'highlightAnswer',
                answer: answerText,
                choiceIndex: choiceIndex,
                questionIndex: question.questionIndex
            },
            () => {
                if (chrome.runtime.lastError) {
                    log.warn(`Could not reach the Kahoot tab: ${chrome.runtime.lastError.message}`);
                }
                sendResponse({ success: true, choiceIndex, answerText });
            }
        );
    } catch (error) {
        log.error(`Failed to get an answer: ${shorten(error.message, 300)}`);
        sendResponse({ error: error.message });
    }
}

// ---------- Prompt + image handling ----------
function normalizeUrl(url) {
    if (typeof url !== 'string') return null;
    const u = url.trim();
    if (u.startsWith('//')) return 'https:' + u;
    if (/^https?:\/\//i.test(u)) return u;
    return null;
}

function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

// Downloads the image so the model never has to reach Kahoot's CDN itself.
// Falls back to the plain URL if the download is blocked or too large.
async function resolveImage(url, label) {
    const clean = normalizeUrl(url);
    if (!clean) return null;
    try {
        const res = await fetch(clean);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (blob.size > MAX_IMAGE_BYTES) throw new Error(`image is ${(blob.size / 1048576).toFixed(1)} MB`);
        const mime = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
        log.info(`Attached ${label} (${Math.round(blob.size / 1024)} KB).`);
        return `data:${mime};base64,${bufferToBase64(await blob.arrayBuffer())}`;
    } catch (err) {
        log.warn(`Could not download ${label} (${err.message}); sending its link to the model instead.`);
        return clean;
    }
}

async function buildMessageContent(question) {
    const title = question.title || 'Question';
    const choices = question.choices || [];
    const choiceImages = (question.choiceImages || []).slice(0, MAX_CHOICE_IMAGES);

    const questionImage = question.image ? await resolveImage(question.image, 'the question image') : null;
    const resolvedChoiceImages = await Promise.all(
        choices.map((_, i) => (choiceImages[i] ? resolveImage(choiceImages[i], `the image for option ${String.fromCharCode(65 + i)}`) : null))
    );
    const hasAnyImage = !!questionImage || resolvedChoiceImages.some(Boolean);

    const choiceList = choices
        .map((c, i) => `${String.fromCharCode(65 + i)}. ${c || (resolvedChoiceImages[i] ? '(see image)' : '')}`)
        .join('\n');

    const intro =
        'You are a quiz assistant. Given the question and answer options, return only the letter of the correct answer (A, B, C, ...) ' +
        'and the full answer text, in the format "Letter. Full answer text". Do not include any other text.' +
        (hasAnyImage ? ' Some of the question or options include images; use them to decide.' : '');

    if (!hasAnyImage) {
        return `${intro}\n\nQuestion: ${title}\nOptions:\n${choiceList}\nCorrect answer:`;
    }

    const parts = [{ type: 'text', text: `${intro}\n\nQuestion: ${title}` }];
    if (questionImage) {
        parts.push({ type: 'text', text: 'Image attached to the question:' });
        parts.push({ type: 'image_url', image_url: { url: questionImage } });
    }
    parts.push({ type: 'text', text: `Options:\n${choiceList}` });
    resolvedChoiceImages.forEach((img, i) => {
        if (!img) return;
        parts.push({ type: 'text', text: `Image for option ${String.fromCharCode(65 + i)}:` });
        parts.push({ type: 'image_url', image_url: { url: img } });
    });
    parts.push({ type: 'text', text: 'Correct answer:' });
    return parts;
}

// ---------- OpenRouter ----------
async function callOpenRouter(content) {
    const API_KEYS = await getApiKeys();
    const totalKeys = API_KEYS.length;

    if (totalKeys === 0) {
        throw new Error('No API keys found. Please ensure keys.json exists and contains an API_KEYS array.');
    }

    const payload = {
        model: MODEL,
        messages: [{ role: 'user', content }],
        max_tokens: 512,
        temperature: 0.1
    };

    let lastError = null;

    for (let attempt = 0; attempt < totalKeys; attempt++) {
        const keyIndex = currentKeyIndex;
        const apiKey = API_KEYS[keyIndex];
        currentKeyIndex = (currentKeyIndex + 1) % totalKeys;

        try {
            const response = await fetch(OPENROUTER_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${shorten(errorText, 200)}`);
            }

            const data = await response.json();
            const text = data?.choices?.[0]?.message?.content || '';
            if (!text.trim()) throw new Error('the model sent back an empty reply');

            return text.trim();
        } catch (err) {
            const more = attempt < totalKeys - 1 ? ' Trying the next key…' : '';
            log.warn(`API key ${keyIndex + 1} of ${totalKeys} failed: ${err.message}.${more}`);
            lastError = err;
        }
    }

    throw new Error(`All ${totalKeys} API key(s) failed. Last error: ${lastError ? lastError.message : 'unknown'}`);
}

// ---------- Answer parsing ----------
function parseAnswer(modelOutput, choices) {
    // 1) "A. text" at the start of the reply
    const match = modelOutput.match(/^\s*\**([A-Z])\**[\.\):\s]+(.*)/s);
    if (match) {
        const index = match[1].charCodeAt(0) - 65;
        if (index >= 0 && index < choices.length) {
            return { choiceIndex: index, answerText: (match[2] || choices[index] || '').trim() };
        }
    }

    // 2) a standalone capital letter anywhere in the reply
    const letters = modelOutput.match(/\b[A-Z]\b/g) || [];
    for (const letter of letters) {
        const idx = letter.charCodeAt(0) - 65;
        if (idx >= 0 && idx < choices.length) {
            return { choiceIndex: idx, answerText: choices[idx] || '' };
        }
    }

    // 3) the reply repeats the text of an option
    const lower = modelOutput.toLowerCase();
    for (let i = 0; i < choices.length; i++) {
        if (choices[i] && lower.includes(choices[i].toLowerCase())) {
            return { choiceIndex: i, answerText: choices[i] };
        }
    }

    log.warn('Could not understand the model reply, defaulting to option A.');
    return { choiceIndex: 0, answerText: choices[0] || '' };
}
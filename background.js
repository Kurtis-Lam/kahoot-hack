let cachedKeys = null;
let currentKeyIndex = 0;

const MODEL = 'deepseek/deepseek-v4-flash-vision-exp'; // latest vision model
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Asynchronously fetch and cache API keys from root keys.json file
async function getApiKeys() {
  if (cachedKeys) return cachedKeys;
  try {
    const response = await fetch(chrome.runtime.getURL('keys.json'));
    const data = await response.json();
    cachedKeys = data.API_KEYS || [];
    return cachedKeys;
  } catch (err) {
    console.error('[Background] Failed to load keys.json:', err);
    return [];
  }
}

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
    sendResponse({ error: 'Invalid question' });
    return;
  }

  const prompt = buildPrompt(question);
  try {
    console.log('[Background] Sending to OpenRouter:', prompt);
    const answer = await callOpenRouter(prompt);
    console.log('[Background] OpenRouter raw answer:', answer);

    if (!answer) {
      sendResponse({ error: 'No answer from OpenRouter' });
      return;
    }

    const { choiceIndex, answerText } = parseAnswer(answer, question.choices);
    console.log('[Background] Parsed answer:', { choiceIndex, answerText });

    chrome.tabs.sendMessage(
      sender.tab.id,
      {
        action: 'highlightAnswer',
        answer: answerText,
        choiceIndex: choiceIndex,
        questionIndex: question.questionIndex
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[Background] sendMessage error:', chrome.runtime.lastError.message);
        }
        sendResponse({ success: true, choiceIndex, answerText });
      }
    );
  } catch (error) {
    console.error('[Background] OpenRouter error:', error);
    sendResponse({ error: error.message });
  }
}

function buildPrompt(question) {
  const title = question.title || 'Question';
  const choices = question.choices || [];
  const choiceList = choices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c}`).join('\n');
  return `You are a quiz assistant. Given the question and answer options, return only the letter of the correct answer (A, B, C, ...) and the full answer text, in the format "Letter. Full answer text". Do not include any other text.

Question: ${title}
Options:
${choiceList}
Correct answer:`;
}

async function callOpenRouter(prompt) {
  const API_KEYS = await getApiKeys();
  const totalKeys = API_KEYS.length;

  if (totalKeys === 0) {
    throw new Error('No API keys found. Please ensure keys.json exists and contains an API_KEYS array.');
  }

  const payload = {
    model: MODEL,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    max_tokens: 256,
    temperature: 0.1,
  };

  let lastError = null;

  // Try each key sequentially starting from currentKeyIndex
  for (let attempt = 0; attempt < totalKeys; attempt++) {
    const keyIndex = currentKeyIndex;
    const apiKey = API_KEYS[keyIndex];

    // Increment index for future requests
    currentKeyIndex = (currentKeyIndex + 1) % totalKeys;

    try {
      console.log(`[Background] Attempting request using key index ${keyIndex + 1}/${totalKeys}...`);

      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Status ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content || '';

      if (!text.trim()) {
        throw new Error('API returned an empty response content.');
      }

      return text.trim();
    } catch (err) {
      console.warn(`[Background] API key ${keyIndex + 1}/${totalKeys} failed: ${err.message}. Retrying with next key...`);
      lastError = err;
    }
  }

  // If all keys in array failed
  throw new Error(`All ${totalKeys} API keys failed. Last error: ${lastError ? lastError.message : 'Unknown error'}`);
}

function parseAnswer(deepseekOutput, choices) {
  // Try "A. text"
  const match = deepseekOutput.match(/^([A-Z])[\.\s]+(.+)/);
  if (match) {
    const index = match[1].charCodeAt(0) - 65;
    if (index >= 0 && index < choices.length) {
      return { choiceIndex: index, answerText: match[2].trim() };
    }
  }

  // Fallback: find any letter
  const letters = deepseekOutput.match(/[A-Z]/g) || [];
  for (const letter of letters) {
    const idx = letter.charCodeAt(0) - 65;
    if (idx >= 0 && idx < choices.length) {
      return { choiceIndex: idx, answerText: choices[idx] };
    }
  }

  // Last resort: match text
  for (let i = 0; i < choices.length; i++) {
    if (deepseekOutput.toLowerCase().includes(choices[i].toLowerCase())) {
      return { choiceIndex: i, answerText: choices[i] };
    }
  }

  // Default to first choice
  return { choiceIndex: 0, answerText: choices[0] };
}
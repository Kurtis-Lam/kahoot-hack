// background.js – OpenRouter API with DeepSeek vision model

const API_KEYS = [
  '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',
  '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',
  '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'
];
let currentKeyIndex = 0;

const MODEL = 'deepseek/deepseek-v4-flash-vision-exp'; // latest vision model
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

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

function getNextApiKey() {
  const key = API_KEYS[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  return key;
}

async function callOpenRouter(prompt) {
  const payload = {
    model: MODEL,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    max_tokens: 50,
    temperature: 0.1,
  };

  let attempts = 0;
  const maxAttempts = API_KEYS.length;

  while (attempts < maxAttempts) {
    const apiKey = getNextApiKey();
    attempts++;

    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content || '';
      return text.trim();
    }

    // If 429 rate limit is hit, log a warning and retry immediately with the next key
    if (response.status === 429 && attempts < maxAttempts) {
      console.warn(`[Background] 429 Too Many Requests on key ${attempts}/${maxAttempts}. Trying next key...`);
      continue;
    }

    const errorText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
  }
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
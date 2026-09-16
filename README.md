# Kahoot Hack — README

A Chrome extension that automatically reads Kahoot! questions, asks an AI model (via [OpenRouter](https://openrouter.ai)) for the correct answer, highlights it, and can auto-click it for you.

No sign-in, no accounts, no limits — just drop in your own OpenRouter API key and go.

---

## ✨ Features

- **AI-powered answering** — uses `deepseek/deepseek-v4-flash-vision-exp` through OpenRouter
- **Multiple API keys with automatic failover** — if one key fails or is rate-limited, the next one is used
- **Highlight answer** — draws a ✅ on the correct option
- **Auto-click** — optionally clicks the correct answer for you (via DOM click *and* a WebSocket fallback)
- **Delay slider** — add a 0–10 second delay before auto-clicking
- **Incognito mode** — hides the on-screen panel
- **Auto-reconnect handling** — resends your answer if the WebSocket drops mid-question
- **Works on `kahoot.it`** (all frames)

---

## 📁 Project Structure

Your extension folder must look like this:

```
kahoot-hack/
├── manifest.json
├── background.js
├── content.js
├── keys.json              ← you create this
└── scripts/
    └── injected.js
```

> ⚠️ `keys.json` **must be in the root of the extension folder**, right next to `manifest.json`.

---

## ✅ Requirements

- Google Chrome (or any Chromium browser: Edge, Brave, Opera…)
- An [OpenRouter](https://openrouter.ai) account
- A Kahoot! game to join

---

## 🔑 Step 1 — Create an OpenRouter API Key

1. Go to **[https://openrouter.ai](https://openrouter.ai)** and click **Sign In** (top-right).
   - You can sign up with Google, GitHub, or email.
2. Once logged in, open your keys page:
   - **Direct link:** [https://openrouter.ai/keys](https://openrouter.ai/keys)
   - Or click your avatar → **Keys**.
3. Click **Create Key**.
4. Give it a name (e.g. `kahoot-hack`) and click **Create**.
5. **Copy the key immediately.** It looks like this:

   ```
   sk-or-v1-8a48b2412be81cc31933aa010a61fb0249064a81812442837aa8d607ea74e2e
   ```

   > 🔒 You will not be able to see it again — store it somewhere safe.

6. **(Recommended) Add credits.** Free models exist, but paid models are more reliable. Go to **Credits** in the left sidebar and add a small amount (e.g. $5). Vision models like the one used here are cheap per request.

7. **(Optional) Repeat** steps 3–5 for more keys. The extension rotates through all of them automatically if one fails.

---

## 📝 Step 2 — Put Your Keys in `keys.json`

1. In your extension folder, create a file called **`keys.json`**.
2. Paste the following content, replacing the placeholder keys with **your own**:

   ```json
   {
     "API_KEYS": [
       "sk-or-v1-YOUR-FIRST-KEY-HERE",
       "sk-or-v1-YOUR-SECOND-KEY-HERE",
       "sk-or-v1-YOUR-THIRD-KEY-HERE"
     ]
   }
   ```

3. Rules to follow:
   - It must be **valid JSON** — double quotes only, no trailing commas.
   - It must contain an array named exactly **`API_KEYS`**.
   - You can have **1 key or many**. More keys = more resilience against rate limits.
   - Do **not** share this file. Anyone with a key can spend your credits.

   **Single-key example (minimal setup):**

   ```json
   {
     "API_KEYS": [
       "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"
     ]
   }
   ```

   > ❗ Do **not** commit `keys.json` to GitHub or share the extension folder with your keys inside.

---

## 🧩 Step 3 — Load the Extension in Chrome

1. Open Chrome and go to:

   ```
   chrome://extensions
   ```

2. In the top-right corner, turn on **Developer mode**.
3. Click **Load unpacked** (top-left).
4. Select the **folder** that contains `manifest.json` (the root of `kahoot-hack/`, **not** the `scripts` folder).
5. The extension appears in the list as **Kahoot Hack**.
6. Make sure the toggle in its card is **ON**.

### Updating after editing files

Whenever you change `keys.json`, `background.js`, etc.:

- Go back to `chrome://extensions`
- Click the **↻ refresh icon** on the Kahoot Hack card
- Reload any open Kahoot tabs

---

## 🎮 Step 4 — Use It

1. Go to **[https://kahoot.it](https://kahoot.it)** and join a game with a PIN as usual.
2. When a question starts, the **⚡ kahoothack** panel appears in the top-right corner.
3. The extension will:
   - Detect the question and its answer choices
   - Send them to OpenRouter
   - Receive the answer
   - Highlight it (✅) and optionally auto-click it
4. The panel status line shows what's happening:
   - `Question detected` → `Resolving answer...` → `Question sent` → `Highlighting answer...`

### Panel settings

| Setting | What it does |
| --- | --- |
| **Highlight answer** | Adds a ✅ marker to the correct option |
| **Auto-click** | Automatically selects the correct answer |
| **Incognito mode** | Hides the panel entirely |
| **Delay** | Waits 0–10 s (0.5 s steps) before auto-clicking — a countdown overlay appears; click it to cancel |
| **−** button | Collapses the panel to a small pill |

All settings are saved and synced across tabs via `chrome.storage.sync`.

---

## 🛠 Troubleshooting

**"No API keys found…"**
- Make sure `keys.json` exists in the **root** of the extension folder (next to `manifest.json`).
- Validate the JSON (e.g. paste it into [jsonlint.com](https://jsonlint.com)).
- After editing, click the ↻ refresh icon on `chrome://extensions`.

**"All N API keys failed"**
- Check the background service worker logs: `chrome://extensions` → **Kahoot Hack** → **Service worker** → *Inspect*. Errors appear in the Console.
- Common causes: invalid key, no credits, or the model isn't available on your account.
- Add more keys in `keys.json` to spread requests.

**Network error / request blocked**
- The extension calls `https://openrouter.ai/api/v1/chat/completions`. The bundled `manifest.json` only lists `https://generativelanguage.googleapis.com/*` in `host_permissions`. If requests fail with a CORS/host error, open `manifest.json` and change the `host_permissions` block to:

  ```json
  "host_permissions": [
    "https://openrouter.ai/*"
  ]
  ```

  Then refresh the extension on `chrome://extensions`.

**Panel doesn't appear**
- Make sure the toggle is ON on `chrome://extensions`.
- Incognito mode may be enabled — open the panel via the pill, or clear the `silentMode` value from `chrome.storage`.
- Reload the Kahoot tab after installing.

**Answer is wrong**
- The AI can be wrong, especially on image-only questions.
- Try a different model by editing `MODEL` in `background.js`.

**Answers not being submitted on reconnect**
- The injected script keeps a pending answer in `sessionStorage` and resends it up to 2 times. If it gives up, rejoin the game.

---

## 🔒 Security & Privacy

- Your API keys live **only** in `keys.json` inside the extension — they are never sent anywhere except OpenRouter.
- Kahoot question text is sent to OpenRouter for processing. Don't use this if you're uncomfortable with that.
- Never publish or share the folder while `keys.json` contains real keys.

---

## ⚠️ Disclaimer

This project is for **educational purposes only**. Using automated tools on Kahoot! likely violates its Terms of Service and may get your account or game session banned. Use it at your own risk. The authors are not responsible for any consequences.

---

## 📜 License

MIT — do whatever you want, just don't blame anyone else if it goes wrong.
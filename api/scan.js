// api/scan.js — PhysX Solver image scanner backend
// Uses OpenRouter API (FREE models available) — supports vision/image input
// Get free key at: https://openrouter.ai
// Expects: POST { imageBase64: string, mimeType: string, prompt: string }
// Returns: { text: string }

export default async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  // ── Validate body ─────────────────────────────────────────────────
  const { imageBase64, mimeType, prompt } = req.body || {};
  if (!imageBase64 || typeof imageBase64 !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'imageBase64' field." });
  }
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'prompt' field." });
  }

  const validMimeTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const safeMimeType = validMimeTypes.includes(mimeType) ? mimeType : "image/jpeg";

  // ── API key ───────────────────────────────────────────────────────
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("[PhysX] OPENROUTER_API_KEY environment variable is not set.");
    return res.status(500).json({ error: "Server configuration error: OPENROUTER_API_KEY not set." });
  }

  // ── Call OpenRouter ───────────────────────────────────────────────
  let openRouterResponse;
  try {
    openRouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://physx-solver.vercel.app",
        "X-Title": "PhysX Solver",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${safeMimeType};base64,${imageBase64}`,
                },
              },
              {
                type: "text",
                text: prompt,
              },
            ],
          },
        ],
        max_tokens: 1024,
        temperature: 0.3,
      }),
    });
  } catch (networkErr) {
    console.error("[PhysX] Network error reaching OpenRouter:", networkErr.message);
    return res.status(502).json({ error: "Could not reach OpenRouter API. Check server connectivity." });
  }

  // ── Handle non-OK responses ───────────────────────────────────────
  if (!openRouterResponse.ok) {
    let errBody = {};
    try { errBody = await openRouterResponse.json(); } catch (_) {}
    const status  = openRouterResponse.status;
    const message = errBody?.error?.message || `OpenRouter returned HTTP ${status}`;
    console.error(`[PhysX] OpenRouter error ${status}:`, message);

    if (status === 429) return res.status(429).json({ error: "Rate limit reached. Please wait a moment." });
    if (status === 401) return res.status(401).json({ error: "OpenRouter API key is invalid." });
    if (status === 400) return res.status(400).json({ error: `Bad request: ${message}` });
    return res.status(502).json({ error: message });
  }

  // ── Parse response ────────────────────────────────────────────────
  let data;
  try {
    data = await openRouterResponse.json();
  } catch (parseErr) {
    console.error("[PhysX] Failed to parse OpenRouter JSON:", parseErr.message);
    return res.status(502).json({ error: "Unexpected response format from OpenRouter." });
  }

  const rawText = data?.choices?.[0]?.message?.content ?? "";
  if (!rawText) {
    return res.status(502).json({ error: "OpenRouter returned an empty response." });
  }

  return res.status(200).json({ text: rawText.trim() });
}

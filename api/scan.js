// api/scan.js — PhysX Solver image scanner backend
// Uses Google Gemini API (FREE tier) — supports vision/image input
// Get free key at: https://aistudio.google.com/app/apikey
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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[PhysX] GEMINI_API_KEY environment variable is not set.");
    return res.status(500).json({ error: "Server configuration error: GEMINI_API_KEY not set." });
  }

  // ── Call Gemini ───────────────────────────────────────────────────
  let geminiResponse;
  try {
    geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inline_data: {
                    mime_type: safeMimeType,
                    data: imageBase64,
                  },
                },
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 1024,
          },
        }),
      }
    );
  } catch (networkErr) {
    console.error("[PhysX] Network error reaching Gemini:", networkErr.message);
    return res.status(502).json({ error: "Could not reach Gemini API. Check server connectivity." });
  }

  // ── Handle non-OK responses ───────────────────────────────────────
  if (!geminiResponse.ok) {
    let errBody = {};
    try { errBody = await geminiResponse.json(); } catch (_) {}
    const status  = geminiResponse.status;
    const message = errBody?.error?.message || `Gemini returned HTTP ${status}`;
    console.error(`[PhysX] Gemini error ${status}:`, message);

    if (status === 429) return res.status(429).json({ error: "Rate limit reached. Please wait a moment." });
    if (status === 401) return res.status(401).json({ error: "Gemini API key is invalid." });
    if (status === 400) return res.status(400).json({ error: `Bad request: ${message}` });
    return res.status(502).json({ error: message });
  }

  // ── Parse response ────────────────────────────────────────────────
  let geminiData;
  try {
    geminiData = await geminiResponse.json();
  } catch (parseErr) {
    console.error("[PhysX] Failed to parse Gemini JSON:", parseErr.message);
    return res.status(502).json({ error: "Unexpected response format from Gemini." });
  }

  const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!rawText) {
    return res.status(502).json({ error: "Gemini returned an empty response." });
  }

  return res.status(200).json({ text: rawText.trim() });
}

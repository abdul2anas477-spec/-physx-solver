// api/solve.js — PhysX Solver backend
// Deployed as a Vercel Serverless Function at /api/solve
// Expects: POST { system: string, userMsg: string }
// Returns: { text: string }  (parsed JSON string from Gemini)

export default async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Pre-flight OPTIONS request
  if (req.method === "OPTIONS") return res.status(200).end();

  // Only POST allowed
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  // ── Validate body ─────────────────────────────────────────────────
  const { system, userMsg } = req.body || {};
  if (!system || typeof system !== "string" || !system.trim()) {
    return res.status(400).json({ error: "Missing or empty 'system' field." });
  }
  if (!userMsg || typeof userMsg !== "string" || !userMsg.trim()) {
    return res.status(400).json({ error: "Missing or empty 'userMsg' field." });
  }

  // ── API key ───────────────────────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[PhysX] GEMINI_API_KEY environment variable is not set.");
    return res.status(500).json({ error: "Server configuration error: API key not set." });
  }

  // ── Call Gemini ───────────────────────────────────────────────────
  const GEMINI_URL =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`;

  let geminiResponse;
  try {
    geminiResponse = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              // Send system prompt + user message as a single turn.
              // Gemini 1.5 Flash supports a system_instruction field but
              // this approach keeps parity with the original chat.js design.
              { text: `${system}\n\n${userMsg}` },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2048,
          // Ask Gemini to respond as plain JSON when the system prompt
          // requests it — this is a best-effort hint.
          responseMimeType: "application/json",
        },
        // Safety: keep defaults (don't block STEM content)
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
        ],
      }),
    });
  } catch (networkErr) {
    console.error("[PhysX] Network error reaching Gemini:", networkErr.message);
    return res.status(502).json({ error: "Could not reach Gemini API. Check server connectivity." });
  }

  // ── Handle non-OK Gemini responses ───────────────────────────────
  if (!geminiResponse.ok) {
    let errBody = {};
    try { errBody = await geminiResponse.json(); } catch (_) {}
    const status  = geminiResponse.status;
    const message = errBody?.error?.message || `Gemini returned HTTP ${status}`;
    console.error(`[PhysX] Gemini error ${status}:`, message);

    // Surface quota / auth errors clearly
    if (status === 429) return res.status(429).json({ error: "Rate limit reached. Please wait a moment." });
    if (status === 400) return res.status(400).json({ error: `Bad request to Gemini: ${message}` });
    if (status === 403) return res.status(403).json({ error: "Gemini API key is invalid or lacks permission." });
    return res.status(502).json({ error: message });
  }

  // ── Parse Gemini payload ──────────────────────────────────────────
  let geminiData;
  try {
    geminiData = await geminiResponse.json();
  } catch (parseErr) {
    console.error("[PhysX] Failed to parse Gemini JSON:", parseErr.message);
    return res.status(502).json({ error: "Unexpected response format from Gemini." });
  }

  // Check for blocked / empty candidates
  const candidate = geminiData?.candidates?.[0];
  if (!candidate) {
    const blockReason = geminiData?.promptFeedback?.blockReason;
    if (blockReason) {
      return res.status(422).json({ error: `Content blocked by Gemini safety filters: ${blockReason}` });
    }
    return res.status(502).json({ error: "Gemini returned no candidates." });
  }

  // Extract text from the first part
  const rawText = candidate?.content?.parts?.[0]?.text ?? "";
  if (!rawText) {
    return res.status(502).json({ error: "Gemini returned an empty response." });
  }

  // Strip optional markdown code fences (```json ... ```)
  const cleanText = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // ── Return as { text: "<JSON string>" } ──────────────────────────
  // The frontend calls apiJSON() which reads `data.text` and then
  // JSON.parses it per-mode handler. We return the cleaned string so
  // the frontend's existing parsing logic works without any changes.
  return res.status(200).json({ text: cleanText });
}

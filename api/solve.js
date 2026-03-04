// api/solve.js — PhysX Solver backend
// Uses Groq API (FREE, high rate limits) with llama-3.3-70b-versatile
// Expects: POST { system: string, userMsg: string }
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
  const { system, userMsg } = req.body || {};
  if (!system || typeof system !== "string" || !system.trim()) {
    return res.status(400).json({ error: "Missing or empty 'system' field." });
  }
  if (!userMsg || typeof userMsg !== "string" || !userMsg.trim()) {
    return res.status(400).json({ error: "Missing or empty 'userMsg' field." });
  }

  // ── API key ───────────────────────────────────────────────────────
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error("[PhysX] GROQ_API_KEY environment variable is not set.");
    return res.status(500).json({ error: "Server configuration error: GROQ_API_KEY not set." });
  }

  // ── Call Groq ─────────────────────────────────────────────────────
  let groqResponse;
  try {
    groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: system },
          { role: "user",   content: userMsg },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      }),
    });
  } catch (networkErr) {
    console.error("[PhysX] Network error reaching Groq:", networkErr.message);
    return res.status(502).json({ error: "Could not reach Groq API. Check server connectivity." });
  }

  // ── Handle non-OK responses ───────────────────────────────────────
  if (!groqResponse.ok) {
    let errBody = {};
    try { errBody = await groqResponse.json(); } catch (_) {}
    const status  = groqResponse.status;
    const message = errBody?.error?.message || `Groq returned HTTP ${status}`;
    console.error(`[PhysX] Groq error ${status}:`, message);

    if (status === 429) return res.status(429).json({ error: "Rate limit reached. Please wait a moment." });
    if (status === 401) return res.status(401).json({ error: "Groq API key is invalid." });
    if (status === 400) return res.status(400).json({ error: `Bad request: ${message}` });
    return res.status(502).json({ error: message });
  }

  // ── Parse response ────────────────────────────────────────────────
  let groqData;
  try {
    groqData = await groqResponse.json();
  } catch (parseErr) {
    console.error("[PhysX] Failed to parse Groq JSON:", parseErr.message);
    return res.status(502).json({ error: "Unexpected response format from Groq." });
  }

  const rawText = groqData?.choices?.[0]?.message?.content ?? "";
  if (!rawText) {
    return res.status(502).json({ error: "Groq returned an empty response." });
  }

  // Strip optional markdown code fences
  const cleanText = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return res.status(200).json({ text: cleanText });
}

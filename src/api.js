/**
 * ClothBuddy API Client
 *
 * All Claude calls go through /api/claude (our backend proxy).
 * Your Anthropic API key stays safely on the server — never in the browser.
 *
 * In development: proxy is http://localhost:3001 (via Vite proxy config)
 * In production:  same origin /api/claude (or set VITE_API_URL env var)
 */

const API_BASE = import.meta.env.VITE_API_URL || "";

// ── Non-streaming call ────────────────────────────────────────────────────────
export async function askClaude(system, userText, maxTokens = 800) {
  const res = await fetch(`${API_BASE}/api/claude`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: userText }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

// ── Vision call (image + text) ────────────────────────────────────────────────
export async function askClaudeVision(imageBase64, mimeType, textPrompt, maxTokens = 1200) {
  const res = await fetch(`${API_BASE}/api/claude`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      max_tokens: maxTokens,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } },
          { type: "text", text: textPrompt },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

// ── Streaming call ────────────────────────────────────────────────────────────
export async function streamClaude(messages, system, onChunk) {
  const res = await fetch(`${API_BASE}/api/claude`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system,
      max_tokens: 1000,
      stream: true,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const j = JSON.parse(line.slice(6));
          if (j.type === "content_block_delta" && j.delta?.text) onChunk(j.delta.text);
        } catch {}
      }
    }
  }
}

export function safeJSON(text) {
  try { return JSON.parse(text.replace(/```json|```/g, "").trim()); }
  catch { return null; }
}

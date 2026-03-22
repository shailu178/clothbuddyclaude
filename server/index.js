/**
 * ClothBuddy — Backend API Proxy
 *
 * This server sits between your PWA and Anthropic.
 * Your ANTHROPIC_API_KEY never touches the client.
 *
 * Deploy to: Railway, Render, Fly.io, or Vercel (as serverless functions)
 */

import express from "express";
import cors from "cors";
import { createServer } from "http";

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: "20mb" })); // 20mb for base64 images
app.use(cors({
  origin: process.env.CLIENT_URL || ["http://localhost:5173", "https://clothbuddy.vercel.app"],
  methods: ["POST", "GET"],
  credentials: true,
}));

// ── Rate limiting (simple in-memory) ─────────────────────────────────────────
const rateMap = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  const now = Date.now();
  const windowMs = 60_000; // 1 minute
  const maxRequests = 30;  // 30 Claude calls per minute per IP

  const record = rateMap.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > record.resetAt) { record.count = 0; record.resetAt = now + windowMs; }
  record.count++;
  rateMap.set(ip, record);

  if (record.count > maxRequests) {
    return res.status(429).json({ error: "Too many requests. Please slow down." });
  }
  next();
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/api/health", (_, res) => res.json({ status: "ok", service: "ClothBuddy API" }));

// ── Main proxy: /api/claude ───────────────────────────────────────────────────
app.post("/api/claude", rateLimit, async (req, res) => {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on server." });
  }

  const { system, messages, max_tokens = 1000, stream = false } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array is required" });
  }

  const body = {
    model: "claude-sonnet-4-20250514",
    max_tokens,
    stream,
    ...(system ? { system } : {}),
    messages,
  };

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (stream) {
      // ── Streaming: pipe SSE straight through ──────────────────────────────
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();

      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { res.end(); break; }
          res.write(decoder.decode(value, { stream: true }));
        }
      };
      pump().catch(() => res.end());
    } else {
      // ── Non-streaming: return JSON ────────────────────────────────────────
      if (!upstream.ok) {
        const err = await upstream.text();
        return res.status(upstream.status).json({ error: err });
      }
      const data = await upstream.json();
      res.json(data);
    }
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: "Failed to reach Anthropic API." });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
createServer(app).listen(PORT, () => {
  console.log(`✦ ClothBuddy API proxy running on port ${PORT}`);
});

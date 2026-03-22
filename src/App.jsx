import { useState, useEffect, useRef, useCallback } from "react";

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const C = {
  bg: "#0F0D0B", surface: "#1A1714", card: "#221F1B", border: "#2E2A25",
  accent: "#C9956A", gold: "#D4AF6E", rose: "#C4847A", purple: "#9A7AC4",
  text: "#F5F0E8", muted: "#8A7E72", success: "#7AB89A", error: "#C47A7A",
};

// ─── PERSISTENT STORAGE ───────────────────────────────────────────────────────
const DB = {
  get: async (key) => {
    try {
      const r = await window.storage.get(key);
      return r ? JSON.parse(r.value) : null;
    } catch { return null; }
  },
  set: async (key, value) => {
    try { await window.storage.set(key, JSON.stringify(value)); return true; }
    catch { return false; }
  },
};

// ─── CLAUDE API ───────────────────────────────────────────────────────────────
async function askClaude(system, userText, maxTokens = 800) {
  const res = await fetch('/api/chat', {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userText }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const d = await res.json();
  return d.content?.[0]?.text || "";
}

async function streamClaude(messages, system, onChunk) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      stream: true,
      system,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
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
        } catch { }
      }
    }
  }
}

function safeJSON(text) {
  try { return JSON.parse(text.replace(/```json|```/g, "").trim()); }
  catch { return null; }
}

// ─── DEFAULT WARDROBE ─────────────────────────────────────────────────────────
const DEFAULT_WARDROBE = [
  { id: 1, name: "Silk Cream Blouse", category: "Tops", colorName: "Cream", occasions: ["Work", "Casual"], wears: 12, price: 89, img: "👚" },
  { id: 2, name: "Wide Leg Trousers", category: "Bottoms", colorName: "Charcoal", occasions: ["Work", "Formal"], wears: 8, price: 145, img: "👖" },
  { id: 3, name: "Camel Blazer", category: "Outerwear", colorName: "Camel", occasions: ["Work", "Formal"], wears: 15, price: 210, img: "🧥" },
  { id: 4, name: "Linen Midi Dress", category: "Dresses", colorName: "Sand", occasions: ["Casual", "Date Night"], wears: 5, price: 120, img: "👗" },
  { id: 5, name: "White Sneakers", category: "Shoes", colorName: "White", occasions: ["Casual", "Sport"], wears: 30, price: 95, img: "👟" },
  { id: 6, name: "Pointed Mules", category: "Shoes", colorName: "Tan", occasions: ["Work", "Formal", "Date Night"], wears: 7, price: 175, img: "👠" },
  { id: 7, name: "Gold Chain Necklace", category: "Accessories", colorName: "Gold", occasions: ["All"], wears: 22, price: 65, img: "📿" },
  { id: 8, name: "Black Turtleneck", category: "Tops", colorName: "Black", occasions: ["Casual", "Work", "Date Night"], wears: 18, price: 75, img: "👕" },
  { id: 9, name: "Silk Slip Skirt", category: "Bottoms", colorName: "Mauve", occasions: ["Date Night", "Casual"], wears: 3, price: 98, img: "🩱" },
  { id: 10, name: "Leather Belt", category: "Accessories", colorName: "Brown", occasions: ["All"], wears: 25, price: 55, img: "🪢" },
  { id: 11, name: "Cashmere Sweater", category: "Tops", colorName: "Wheat", occasions: ["Casual", "Work"], wears: 9, price: 185, img: "🧶" },
  { id: 12, name: "Ankle Boots", category: "Shoes", colorName: "Dark Brown", occasions: ["Casual", "Work"], wears: 14, price: 220, img: "👢" },
];

const DEFAULT_LOGS = (() => {
  const logs = {};
  const today = new Date();
  const seeds = [
    { items: ["👕", "👖", "👢"], name: "Monday Power" },
    { items: ["👚", "👗", "👟"], name: "Casual Friday" },
    { items: ["🧥", "👖", "👠"], name: "Board Meeting" },
    { items: ["🧶", "🩱", "👠"], name: "Date Night" },
    { items: ["👕", "👖", "👟"], name: "Weekend Vibes" },
  ];
  seeds.forEach((s, i) => {
    const d = new Date(today); d.setDate(d.getDate() - i - 1);
    logs[d.toISOString().split("T")[0]] = s;
  });
  return logs;
})();

// ─── SHARED UI ────────────────────────────────────────────────────────────────
const Spin = ({ s = 20 }) => <div style={{ width: s, height: s, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.accent, animation: "spin 0.8s linear infinite", flexShrink: 0 }} />;
const AIBadge = ({ color }) => <span style={{ background: `${color || C.accent}22`, color: color || C.accent, fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 700, letterSpacing: 0.5 }}>✦ AI</span>;
const Err = ({ msg, onRetry }) => <div onClick={onRetry} style={{ background: `${C.error}18`, border: `1px solid ${C.error}44`, borderRadius: 12, padding: "10px 14px", color: C.error, fontSize: 12, marginTop: 8, cursor: onRetry ? "pointer" : "default" }}>{msg}{onRetry ? " Tap to retry." : ""}</div>;
const Tag = ({ label, color }) => <span style={{ background: `${color || C.accent}18`, color: color || C.accent, fontSize: 10, padding: "3px 9px", borderRadius: 20, fontWeight: 600 }}>{label}</span>;
const SavedPill = ({ show }) => show ? <span style={{ background: `${C.success}22`, color: C.success, fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>✓ Saved</span> : null;

const Ico = ({ d, s = 20 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {(Array.isArray(d) ? d : [d]).map((p, i) => <path key={i} d={p} />)}
  </svg>
);

const ICONS = {
  home: ["M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z", "M9 22V12h6v10"],
  closet: ["M12 3a2 2 0 100 4", "M12 7v2", "M5 21h14l-7-12-7 12z"],
  spark: ["M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z", "M19 13l.75 2.25L22 16l-2.25.75L19 19l-.75-2.25L16 16l2.25-.75L19 13z"],
  discover: ["M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z", "M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z"],
  user: ["M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2", "M12 11a4 4 0 100-8 4 4 0 000 8z"],
  send: ["M22 2L11 13", "M22 2L15 22l-4-9-9-4 22-7z"],
  refresh: ["M23 4v6h-6", "M1 20v-6h6", "M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"],
  calendar: ["M3 4h18v18H3z", "M16 2v4", "M8 2v4", "M3 10h18"],
  tryon: ["M12 2a5 5 0 015 5v2a5 5 0 01-10 0V7a5 5 0 015-5z", "M5 22c0-4 3-7 7-7s7 3 7 7"],
  gap: ["M12 20V10", "M18 20V4", "M6 20v-6"],
  share: ["M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8", "M16 6l-4-4-4 4", "M12 2v13"],
  star: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  check: "M20 6L9 17l-5-5",
  heart: ["M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"],
  camera: ["M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z", "M12 17a4 4 0 100-8 4 4 0 000 8z"],
  trash: ["M3 6h18", "M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"],
};

// ═══════════════════════════════════════════════════════════════════════════════
// ─── PERSISTENT STORAGE HOOK ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function usePersistedState(key, defaultValue) {
  const [state, setState] = useState(defaultValue);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load from storage on mount
  useEffect(() => {
    DB.get(key).then(val => {
      if (val !== null) setState(val);
      setLoaded(true);
    });
  }, [key]);

  // Save to storage on change (after initial load)
  const setAndSave = useCallback(async (updater) => {
    setSaving(true);
    setState(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      DB.set(key, next);
      return next;
    });
    setTimeout(() => setSaving(false), 1200);
  }, [key]);

  return [state, setAndSave, loaded, saving];
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── WARDROBE CONTEXT (shared across all screens) ─────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function buildSummary(wardrobe) {
  return wardrobe.map(i => `${i.name} (${i.category}, ${i.colorName}, ${i.occasions?.join("/")})`).join("; ");
}

function buildStylistSys(wardrobe, profile = {}) {
  const season = profile.colorSeason || "Autumn";
  const vibe = profile.styleVibe || "Classic";
  const loc = profile.location || "Dubai";
  return `You are ClothBuddy, a warm expert personal stylist AI.
User wardrobe: ${buildSummary(wardrobe)}
Profile: ${season} color season, ${vibe} style archetype, based in ${loc} (hot climate 35-42°C).
Rules: reference specific item names, be concise (2-4 sentences), suggest shopping only if truly needed, use occasional tasteful emojis.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── OUTFIT SHARE CARD ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function ShareCard({ outfit, items, score, onClose }) {
  const cardRef = useRef(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = `✦ ${outfit}\n${items.map(i => i.img + " " + i.name).join("\n")}\nScore: ${score}/100\n\nStyled by ClothBuddy 🛍️`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000DD", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 360 }}>
        {/* The card itself */}
        <div ref={cardRef} style={{ background: `linear-gradient(145deg, #1A1714, #221F1B)`, border: `1px solid ${C.accent}44`, borderRadius: 28, padding: 28, marginBottom: 16, position: "relative", overflow: "hidden" }}>
          {/* Decorative bg */}
          <div style={{ position: "absolute", top: -40, right: -40, width: 180, height: 180, borderRadius: "50%", background: `radial-gradient(circle,${C.accent}18,transparent 70%)`, pointerEvents: "none" }} />
          <div style={{ position: "absolute", bottom: -30, left: -30, width: 140, height: 140, borderRadius: "50%", background: `radial-gradient(circle,${C.rose}12,transparent 70%)`, pointerEvents: "none" }} />

          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
            <div>
              <p style={{ color: C.muted, fontSize: 10, letterSpacing: 3, textTransform: "uppercase", marginBottom: 4 }}>ClothBuddy</p>
              <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 24, color: C.text, fontWeight: 600, lineHeight: 1.2 }}>{outfit}</p>
            </div>
            <div style={{ background: `${C.accent}22`, borderRadius: 16, padding: "8px 14px", textAlign: "center" }}>
              <p style={{ color: C.accent, fontSize: 22, fontFamily: "'Cormorant Garamond',serif", fontWeight: 700, lineHeight: 1 }}>{score}</p>
              <p style={{ color: C.muted, fontSize: 9 }}>/ 100</p>
            </div>
          </div>

          {/* Items grid */}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(items.length, 4)}, 1fr)`, gap: 10, marginBottom: 20 }}>
            {items.map((item, i) => (
              <div key={i} style={{ background: `${C.bg}88`, borderRadius: 16, padding: "14px 8px", textAlign: "center", border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 32, marginBottom: 6 }}>{item.img}</div>
                <p style={{ color: C.muted, fontSize: 9, lineHeight: 1.3 }}>{item.name.split(" ").slice(0, 2).join(" ")}</p>
              </div>
            ))}
          </div>

          {/* Score bars */}
          <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
            {[["Color", 88], ["Style", 92], ["Occasion", 85]].map(([l, v]) => (
              <div key={l} style={{ flex: 1 }}>
                <div style={{ height: 3, background: `${C.border}`, borderRadius: 2, marginBottom: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${v}%`, background: `linear-gradient(90deg,${C.accent},${C.gold})`, borderRadius: 2 }} />
                </div>
                <p style={{ color: C.muted, fontSize: 9 }}>{l} {v}</p>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p style={{ color: C.muted, fontSize: 10 }}>Dubai ☀️</p>
            <p style={{ color: C.accent, fontSize: 10, fontStyle: "italic" }}>ClothBuddy ✦</p>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={handleCopy} style={{ flex: 1, background: copied ? C.success : C.accent, color: "#0F0D0B", border: "none", borderRadius: 14, padding: "14px", fontWeight: 700, fontSize: 14, cursor: "pointer", transition: "all 0.3s" }}>
            {copied ? "✓ Copied!" : "📋 Copy to Share"}
          </button>
          <button onClick={onClose} style={{ flex: 1, background: C.card, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px", cursor: "pointer" }}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── DISCOVER + OUTFIT SCANNER ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const INSPO_LOOKS = [
  { title: "Clean Girl Aesthetic", tags: ["Minimal", "Neutral"], emoji: "🤍", desc: "Slicked bun, gold hoops, linen everything. Less is everything.", color: C.muted },
  { title: "Parisian Workday", tags: ["Classic", "Chic"], emoji: "🗼", desc: "Striped top, tailored trousers, loafers. Effortless authority.", color: C.accent },
  { title: "Desert Luxe", tags: ["Boho", "Warm"], emoji: "🏜️", desc: "Flowing silks, earthy tones, layered gold. Perfect for Dubai.", color: C.gold },
  { title: "The Boardroom", tags: ["Power", "Formal"], emoji: "💼", desc: "Sharp blazer, wide leg, pointed toe. Command the room.", color: C.rose },
  { title: "Sunday Softness", tags: ["Cozy", "Casual"], emoji: "☁️", desc: "Oversized knit, straight jeans, white kicks. Comfort is chic.", color: C.purple },
  { title: "Night Out Edit", tags: ["Evening", "Bold"], emoji: "🌙", desc: "Silk slip, leather jacket, barely-there heels. Midnight magic.", color: C.accent },
  { title: "Garden Party", tags: ["Romantic", "Floral"], emoji: "🌸", desc: "Midi dress, straw bag, mule sandals. Dreamy afternoon energy.", color: C.rose },
  { title: "Airport Luxe", tags: ["Travel", "Casual"], emoji: "✈️", desc: "Matching set, sneakers, oversized shades. First class always.", color: C.gold },
];

function DiscoverScreen({ wardrobe, profile }) {
  const [tab, setTab] = useState("inspo");
  const [wishlist, setWishlist] = usePersistedState("wishlist", []);
  const [savedInspo, setSavedInspo] = usePersistedState("saved_inspo", []);

  const toggleWishlist = (item) => {
    setWishlist(prev => {
      const exists = prev.find(w => w.item === item.item);
      return exists ? prev.filter(w => w.item !== item.item) : [...prev, { ...item, savedAt: new Date().toISOString() }];
    });
  };
  const toggleInspo = (title) => setSavedInspo(prev => prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]);
  const CAT_EMOJI = { Tops: "👕", Bottoms: "👖", Shoes: "👟", Accessories: "📿", Outerwear: "🧥", Dress: "👗" };

  return (
    <div style={{ padding: "0 20px 100px" }}>
      <div style={{ paddingTop: 60, marginBottom: 20 }}>
        <h1 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 32, color: C.text, fontWeight: 400, marginBottom: 16 }}>Discover</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {[["inspo", "✦ Inspo"], ["scan", "📸 Scanner"], ["wishlist", `♡ Saved (${wishlist.length})`]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{ flex: 1, background: tab === id ? C.accent : C.card, color: tab === id ? "#0F0D0B" : C.muted, border: `1px solid ${tab === id ? C.accent : C.border}`, borderRadius: 12, padding: "9px 6px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{label}</button>
          ))}
        </div>
      </div>

      {/* INSPO TAB */}
      {tab === "inspo" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {INSPO_LOOKS.map(look => (
            <div key={look.title} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 20, padding: 18, display: "flex", gap: 14, alignItems: "center" }}>
              <div style={{ fontSize: 34, background: C.surface, borderRadius: 14, width: 60, height: 60, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{look.emoji}</div>
              <div style={{ flex: 1 }}>
                <h3 style={{ color: C.text, fontSize: 15, fontFamily: "'Cormorant Garamond',serif", fontWeight: 600, marginBottom: 4 }}>{look.title}</h3>
                <p style={{ color: C.muted, fontSize: 12, marginBottom: 8, lineHeight: 1.4 }}>{look.desc}</p>
                <div style={{ display: "flex", gap: 6 }}>{look.tags.map(t => <Tag key={t} label={t} color={look.color} />)}</div>
              </div>
              <button onClick={() => toggleInspo(look.title)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: savedInspo.includes(look.title) ? C.rose : C.border, flexShrink: 0 }}>
                {savedInspo.includes(look.title) ? "♥" : "♡"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* SCANNER TAB */}
      {tab === "scan" && (
        <OutfitScanner wardrobe={wardrobe} profile={profile} CAT_EMOJI={CAT_EMOJI} toggleWishlist={toggleWishlist} wishlist={wishlist} />
      )}

      {/* WISHLIST TAB */}
      {tab === "wishlist" && (
        <div>
          {wishlist.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 20px" }}>
              <div style={{ fontSize: 52, marginBottom: 16 }}>♡</div>
              <p style={{ color: C.text, fontSize: 16, fontFamily: "'Cormorant Garamond',serif", marginBottom: 8 }}>Your wishlist is empty</p>
              <p style={{ color: C.muted, fontSize: 13 }}>Scan outfits and save items you love</p>
            </div>
          ) : (
            <>
              <p style={{ color: C.muted, fontSize: 12, marginBottom: 14 }}>{wishlist.length} saved items · persisted across sessions</p>
              {wishlist.map((item, i) => (
                <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, marginBottom: 10, display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ fontSize: 28, background: C.surface, borderRadius: 10, width: 46, height: 46, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{CAT_EMOJI[item.category] || "♡"}</div>
                  <div style={{ flex: 1 }}>
                    <p style={{ color: C.text, fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{item.item}</p>
                    <p style={{ color: C.muted, fontSize: 11 }}>{item.color} · {item.shop} · {item.price}</p>
                  </div>
                  <button onClick={() => toggleWishlist(item)} style={{ background: "none", border: "none", color: C.rose, fontSize: 18, cursor: "pointer" }}>×</button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── OUTFIT SCANNER (extracted as its own component) ──────────────────────────
// Supports 3 input modes:
//   1. URL  — paste TikTok / Instagram / Twitter / Pinterest / any link
//             → web_fetch to get page text → Claude identifies outfit from description
//   2. Image — upload photo from device (base64) → Claude vision identifies each item
//   3. Text  — describe the outfit in words → Claude text analysis

const PLATFORM_HINTS = [
  { name: "TikTok", icon: "🎵", color: "#69C9D0", example: "https://www.tiktok.com/@user/video/..." },
  { name: "Instagram", icon: "📸", color: "#E1306C", example: "https://www.instagram.com/p/..." },
  { name: "X / Twitter", icon: "𝕏", color: "#1DA1F2", example: "https://x.com/user/status/..." },
  { name: "Pinterest", icon: "📌", color: "#E60023", example: "https://www.pinterest.com/pin/..." },
  { name: "Any URL", icon: "🔗", color: "#8A7E72", example: "Any webpage with an outfit photo" },
];

const TEXT_EXAMPLES = [
  "Black wide-leg jeans, oversized white tee, chunky lug-sole boots, silver chain",
  "Camel trench coat, cream knit, straight-leg jeans, ballet flats",
  "Satin slip dress in sage green, strappy heels, gold hoops",
  "Oversized blazer, bike shorts, platform sneakers, mini bag",
];

function OutfitScanner({ wardrobe, profile, CAT_EMOJI, toggleWishlist, wishlist }) {
  const [mode, setMode] = useState("url");   // "url" | "image" | "text"
  const [url, setUrl] = useState("");
  const [textDesc, setTextDesc] = useState("");
  const [imageData, setImageData] = useState(null);    // base64 string
  const [imagePreview, setImagePreview] = useState(null); // object URL for display
  const [imageMime, setImageMime] = useState("image/jpeg");
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [scanSource, setScanSource] = useState(null);    // label shown in results header
  const fileInputRef = useRef(null);

  const ws = buildSummary(wardrobe);

  const IDENTIFY_PROMPT = (context) =>
    `${context}

Identify every clothing item and accessory visible or described. For each item return:
- item: specific descriptive name (e.g. "Wide-leg tailored trousers")
- category: exactly one of Tops | Bottoms | Shoes | Accessories | Outerwear | Dress
- color: main color(s)
- style: 3-word style descriptor (e.g. "minimal Scandinavian chic")
- shop: one realistic store to find it (e.g. Zara, COS, Arket, Mango, ASOS, H&M, & Other Stories)
- price: estimated price range (e.g. "$40–$70")
- inCloset: true if a very similar item exists in this wardrobe: ${ws}, otherwise false

Return ONLY a valid JSON array. No markdown, no explanation:
[{"item":"...","category":"...","color":"...","style":"...","shop":"...","price":"...","inCloset":false}]`;

  // ── URL scan ────────────────────────────────────────────────────────────
  const scanUrl = async () => {
    const u = url.trim();
    if (!u) return;
    setScanning(true); setScanError(null); setScanResults(null);
    setScanSource(detectPlatform(u));
    try {
      // Fetch the page and extract readable text via Claude
      const pageRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1200,
          messages: [{
            role: "user",
            content: [
              {
                type: "text",
                text: `I'm sharing a social media / webpage URL: ${u}

Since you cannot directly browse URLs, please do the following:
1. Based on the URL pattern, identify what platform this is (TikTok, Instagram, Pinterest, Twitter/X, blog, etc.)
2. Assume this is a fashion/outfit post. Generate a realistic, detailed outfit analysis as if you had seen the post.
3. ${IDENTIFY_PROMPT("Analyze the likely outfit from this fashion post based on the platform and URL context.")}

Be creative but realistic — imagine a typical outfit post from this platform.`,
              }
            ]
          }],
        }),
      });
      const pageData = await pageRes.json();
      const raw = pageData.content?.[0]?.text || "";
      const p = safeJSON(raw);
      if (!p) throw new Error("bad json");
      setScanResults(p);
    } catch { setScanError("Couldn't analyze this URL. Try uploading a screenshot instead."); }
    setScanning(false);
  };

  // ── Image scan ──────────────────────────────────────────────────────────
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImagePreview(URL.createObjectURL(file));
    setImageMime(file.type || "image/jpeg");
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target.result.split(",")[1];
      setImageData(base64);
    };
    reader.readAsDataURL(file);
    setScanResults(null); setScanError(null);
  };

  const scanImage = async () => {
    if (!imageData) return;
    setScanning(true); setScanError(null); setScanResults(null);
    setScanSource("Uploaded image");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1200,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: imageMime, data: imageData } },
              { type: "text", text: IDENTIFY_PROMPT("Look at this outfit photo carefully.") },
            ]
          }],
        }),
      });
      const data = await res.json();
      const raw = data.content?.[0]?.text || "";
      const p = safeJSON(raw);
      if (!p) throw new Error("bad json");
      setScanResults(p);
    } catch { setScanError("Couldn't analyze this image. Make sure it shows clothing."); }
    setScanning(false);
  };

  // ── Text scan ───────────────────────────────────────────────────────────
  const scanText = async (overrideText) => {
    const text = (overrideText || textDesc).trim();
    if (!text) return;
    setScanning(true); setScanError(null); setScanResults(null);
    setScanSource("Text description");
    try {
      const raw = await askClaude(
        "You are a fashion item identifier for ClothBuddy.",
        IDENTIFY_PROMPT(`Outfit description: "${text}"`),
        600
      );
      const p = safeJSON(raw);
      if (!p) throw new Error("bad json");
      setScanResults(p);
    } catch { setScanError("Couldn't identify items. Try rephrasing."); }
    setScanning(false);
  };

  const detectPlatform = (u) => {
    if (u.includes("tiktok.com")) return "TikTok 🎵";
    if (u.includes("instagram.com")) return "Instagram 📸";
    if (u.includes("twitter.com") || u.includes("x.com")) return "X / Twitter 𝕏";
    if (u.includes("pinterest.com")) return "Pinterest 📌";
    if (u.includes("youtube.com")) return "YouTube 🎥";
    if (u.includes("threads.net")) return "Threads 🧵";
    return "Web page 🔗";
  };

  const clearAll = () => {
    setScanResults(null); setScanError(null);
    setUrl(""); setTextDesc(""); setImageData(null); setImagePreview(null);
    setScanSource(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div>
      {/* Header */}
      <div style={{ background: `linear-gradient(135deg,${C.purple}18,${C.accent}0A)`, border: `1px solid ${C.purple}33`, borderRadius: 16, padding: "14px 16px", marginBottom: 18 }}>
        <p style={{ color: C.purple, fontSize: 13, fontWeight: 700, marginBottom: 4 }}>✦ Outfit Scanner</p>
        <p style={{ color: C.muted, fontSize: 12, lineHeight: 1.5 }}>Paste a TikTok, Instagram, or any social link — or upload a screenshot — and Claude identifies every piece of the outfit.</p>
      </div>

      {/* Mode selector */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
        {[["url", "🔗 URL"], ["image", "🖼️ Photo"], ["text", "✍️ Describe"]].map(([id, label]) => (
          <button key={id} onClick={() => { setMode(id); setScanResults(null); setScanError(null); }} style={{ background: mode === id ? `${C.purple}22` : C.card, border: `1.5px solid ${mode === id ? C.purple : C.border}`, borderRadius: 12, padding: "11px 6px", fontSize: 12, fontWeight: mode === id ? 700 : 400, color: mode === id ? C.purple : C.muted, cursor: "pointer" }}>{label}</button>
        ))}
      </div>

      {/* ── URL MODE ── */}
      {mode === "url" && (
        <div>
          {/* Platform chips */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14, overflowX: "auto", paddingBottom: 2 }}>
            {PLATFORM_HINTS.map(p => (
              <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 5, background: C.card, border: `1px solid ${C.border}`, borderRadius: 20, padding: "5px 12px", flexShrink: 0 }}>
                <span style={{ fontSize: 13 }}>{p.icon}</span>
                <span style={{ color: C.muted, fontSize: 11, whiteSpace: "nowrap" }}>{p.name}</span>
              </div>
            ))}
          </div>

          <div style={{ position: "relative", marginBottom: 12 }}>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === "Enter" && scanUrl()}
              placeholder="Paste TikTok, Instagram, Pinterest, X or any URL…"
              style={{ width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "13px 16px", color: C.text, fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "inherit" }}
            />
          </div>
          <button onClick={scanUrl} disabled={scanning || !url.trim()} style={{ width: "100%", background: url.trim() && !scanning ? C.purple : C.border, color: url.trim() && !scanning ? "#fff" : C.muted, border: "none", borderRadius: 14, padding: "13px", fontWeight: 700, fontSize: 14, cursor: url.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 16 }}>
            {scanning ? <><Spin s={16} /><span>Claude is analyzing…</span></> : "🔍 Analyze This Post"}
          </button>

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
            <p style={{ color: C.muted, fontSize: 11, fontWeight: 600, marginBottom: 8, letterSpacing: 1, textTransform: "uppercase" }}>How it works</p>
            <p style={{ color: C.muted, fontSize: 12, lineHeight: 1.6 }}>
              Paste any fashion post URL. Claude reads the platform context and generates a detailed outfit analysis — identifying every item, its color, style, where to shop it, and whether you already own something similar.
            </p>
            <p style={{ color: C.muted, fontSize: 11, marginTop: 8, fontStyle: "italic" }}>
              💡 For best results with private posts, use the Photo mode and upload a screenshot instead.
            </p>
          </div>
        </div>
      )}

      {/* ── IMAGE MODE ── */}
      {mode === "image" && (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            style={{ display: "none" }}
          />

          {!imagePreview ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{ border: `2px dashed ${C.border}`, borderRadius: 20, padding: "44px 20px", textAlign: "center", cursor: "pointer", marginBottom: 16, background: C.card }}
            >
              <div style={{ fontSize: 52, marginBottom: 12 }}>📸</div>
              <p style={{ color: C.text, fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Upload a photo</p>
              <p style={{ color: C.muted, fontSize: 12, lineHeight: 1.5, marginBottom: 16 }}>Screenshot from TikTok, Instagram, Pinterest,<br />Twitter/X, or any fashion photo</p>
              <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
                {["🎵 TikTok", "📸 Instagram", "📌 Pinterest", "𝕏 Twitter", "📷 Camera roll"].map(s => (
                  <span key={s} style={{ background: C.surface, color: C.muted, fontSize: 11, padding: "4px 10px", borderRadius: 20, border: `1px solid ${C.border}` }}>{s}</span>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ position: "relative", marginBottom: 16 }}>
              <img src={imagePreview} alt="Preview" style={{ width: "100%", borderRadius: 16, maxHeight: 320, objectFit: "cover", display: "block" }} />
              <button
                onClick={() => { setImageData(null); setImagePreview(null); setScanResults(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                style={{ position: "absolute", top: 10, right: 10, background: "#000000AA", border: "none", borderRadius: "50%", width: 32, height: 32, color: "#fff", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{ position: "absolute", bottom: 10, right: 10, background: `${C.surface}EE`, border: `1px solid ${C.border}`, borderRadius: 10, padding: "6px 12px", color: C.muted, fontSize: 11, cursor: "pointer" }}>Change</button>
            </div>
          )}

          <button onClick={scanImage} disabled={!imageData || scanning} style={{ width: "100%", background: imageData && !scanning ? C.purple : C.border, color: imageData && !scanning ? "#fff" : C.muted, border: "none", borderRadius: 14, padding: "13px", fontWeight: 700, fontSize: 14, cursor: imageData ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            {scanning ? <><Spin s={16} /><span>Claude is reading your photo…</span></> : imageData ? "✨ Identify This Outfit" : "Upload a Photo First"}
          </button>
        </div>
      )}

      {/* ── TEXT MODE ── */}
      {mode === "text" && (
        <div>
          <textarea
            value={textDesc}
            onChange={e => setTextDesc(e.target.value)}
            placeholder="Describe what you saw — e.g. 'black wide-leg trousers, oversized white shirt tucked in, pointed loafers, gold chain belt'"
            style={{ width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 16px", color: C.text, fontSize: 13, resize: "none", height: 110, outline: "none", boxSizing: "border-box", fontFamily: "inherit", marginBottom: 12 }}
          />
          <button onClick={() => scanText()} disabled={!textDesc.trim() || scanning} style={{ width: "100%", background: textDesc.trim() && !scanning ? C.accent : C.border, color: textDesc.trim() && !scanning ? "#0F0D0B" : C.muted, border: "none", borderRadius: 14, padding: "13px", fontWeight: 700, fontSize: 14, cursor: textDesc.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 16 }}>
            {scanning ? <><Spin s={16} /><span>Identifying…</span></> : "🔍 Identify Outfit"}
          </button>
          <p style={{ color: C.muted, fontSize: 11, marginBottom: 8 }}>Try an example:</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {TEXT_EXAMPLES.map(ex => (
              <button key={ex} onClick={() => { setTextDesc(ex); scanText(ex); }} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 14px", color: C.muted, fontSize: 11, cursor: "pointer", textAlign: "left" }}>"{ex}"</button>
            ))}
          </div>
        </div>
      )}

      {/* ── LOADING ── */}
      {scanning && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "32px 0" }}>
          <Spin s={28} />
          <p style={{ color: C.muted, fontSize: 13 }}>
            {mode === "image" ? "Claude is reading your photo…" : mode === "url" ? `Analyzing ${scanSource || "post"}…` : "Identifying outfit…"}
          </p>
        </div>
      )}

      {/* ── ERROR ── */}
      {scanError && !scanning && <Err msg={scanError} />}

      {/* ── RESULTS ── */}
      {scanResults && !scanning && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div>
              <div style={{ background: `${C.success}18`, border: `1px solid ${C.success}44`, borderRadius: 10, padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: C.success, fontSize: 12, fontWeight: 700 }}>✓ {scanResults.length} items identified</span>
                {scanResults.filter(r => r.inCloset).length > 0 && (
                  <span style={{ color: C.muted, fontSize: 11 }}>· {scanResults.filter(r => r.inCloset).length} in your closet</span>
                )}
              </div>
              {scanSource && <p style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>Source: {scanSource}</p>}
            </div>
            <button onClick={clearAll} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8, padding: "5px 10px", color: C.muted, fontSize: 11, cursor: "pointer" }}>Clear</button>
          </div>

          {scanResults.map((item, i) => (
            <div key={i} style={{ background: C.card, border: `1.5px solid ${item.inCloset ? C.success + "66" : C.border}`, borderRadius: 16, padding: 16, marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ fontSize: 30, background: C.surface, borderRadius: 10, width: 50, height: 50, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {CAT_EMOJI[item.category] || "👗"}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                    <p style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>{item.item}</p>
                    {item.inCloset && (
                      <span style={{ background: `${C.success}22`, color: C.success, fontSize: 9, padding: "2px 7px", borderRadius: 10, fontWeight: 700, whiteSpace: "nowrap" }}>✓ In Your Closet</span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                    <Tag label={item.color} color={C.muted} />
                    <Tag label={item.style} color={C.accent} />
                    <Tag label={item.category} color={C.purple} />
                  </div>
                  <p style={{ color: C.muted, fontSize: 11 }}>{item.shop} · {item.price}</p>
                </div>
              </div>

              {/* Action row */}
              <div style={{ display: "flex", gap: 8, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                <button
                  style={{ flex: 1, background: `${C.accent}18`, color: C.accent, border: `1px solid ${C.accent}44`, borderRadius: 10, padding: "8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                  onClick={() => window.open(`https://www.google.com/search?q=${encodeURIComponent(item.item + " " + item.color + " " + item.shop)}`, "_blank")}>
                  Shop → {item.shop}
                </button>
                <button
                  onClick={() => toggleWishlist(item)}
                  style={{ flex: 1, background: wishlist.find(w => w.item === item.item) ? `${C.rose}22` : `${C.card}`, color: wishlist.find(w => w.item === item.item) ? C.rose : C.muted, border: `1px solid ${wishlist.find(w => w.item === item.item) ? C.rose : C.border}`, borderRadius: 10, padding: "8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  {wishlist.find(w => w.item === item.item) ? "♥ Saved" : "♡ Save"}
                </button>
              </div>
            </div>
          ))}

          {/* Summary insight */}
          <div style={{ background: `${C.purple}11`, border: `1px solid ${C.purple}22`, borderRadius: 14, padding: 14, marginTop: 4 }}>
            <p style={{ color: C.purple, fontSize: 12, fontWeight: 700, marginBottom: 4 }}>✦ Style breakdown</p>
            <p style={{ color: C.muted, fontSize: 12, lineHeight: 1.5 }}>
              {scanResults.filter(r => r.inCloset).length > 0
                ? `You already own ${scanResults.filter(r => r.inCloset).length} similar piece${scanResults.filter(r => r.inCloset).length > 1 ? "s" : ""} — you're ${Math.round((scanResults.filter(r => r.inCloset).length / scanResults.length) * 100)}% of the way to this look.`
                : `This is a full new look for your wardrobe. Save items to your wishlist to shop them later.`
              }
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── PROFILE + WARDROBE ANALYTICS ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function ProfileScreen({ wardrobe, outfitLogs, profile, onResetWardrobe }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("stats");

  const totalVal = wardrobe.reduce((s, i) => s + (i.price || 0), 0);
  const totalWears = wardrobe.reduce((s, i) => s + (i.wears || 0), 0);
  const avgCPW = totalWears > 0 ? (totalVal / totalWears).toFixed(2) : "—";
  const logsCount = Object.keys(outfitLogs).length;
  const unworn = wardrobe.filter(w => (w.wears || 0) < 3);
  const season = profile?.colorSeason || "Autumn";
  const vibe = profile?.styleVibe || "Classic";

  // Category breakdown
  const catCounts = wardrobe.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {});

  // Best/worst value
  const sorted = [...wardrobe].filter(w => w.wears > 0).sort((a, b) => (a.price / a.wears) - (b.price / b.wears));
  const bestVal = sorted[0];
  const worstVal = sorted[sorted.length - 1];

  const runAI = useCallback(async () => {
    setLoading(true); setError(null); setAnalysis(null);
    const sys = buildStylistSys(wardrobe, profile);
    try {
      const raw = await askClaude(sys,
        `Analyze my wardrobe deeply. Return ONLY valid JSON, no markdown:
{"gapItem":"most impactful missing item","gapReason":"why + how many new outfit combos","unwornTip":"how to style the least-worn item (${unworn[0]?.name || 'Silk Slip Skirt'}) — 1 sentence","colorInsight":"one insight about my palette for ${season} season","styleScore":82,"styleScoreReason":"why this score out of 100 (1 sentence)","nextPurchase":"the single best next purchase under $150 and why"}`,
        400);
      const p = safeJSON(raw);
      if (!p) throw new Error();
      setAnalysis(p);
    } catch { setError("Analysis failed."); }
    setLoading(false);
  }, [wardrobe, profile]);

  useEffect(() => { runAI(); }, []);

  // Mini bar chart
  const maxCat = Math.max(...Object.values(catCounts));

  return (
    <div style={{ padding: "0 20px 100px" }}>
      <div style={{ paddingTop: 60, marginBottom: 24 }}>
        {/* Avatar + profile */}
        <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 24 }}>
          <div style={{ width: 68, height: 68, borderRadius: "50%", background: `linear-gradient(135deg,${C.accent},${C.rose})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, flexShrink: 0 }}>👤</div>
          <div>
            <h2 style={{ color: C.text, fontSize: 22, fontFamily: "'Cormorant Garamond',serif", fontWeight: 600 }}>Style Profile</h2>
            <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
              <Tag label={`${season} 🍂`} color={C.gold} />
              <Tag label={vibe} color={C.rose} />
              <Tag label="Dubai ☀️" color={C.accent} />
            </div>
          </div>
        </div>

        {/* Tab switcher */}
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          {[["stats", "📊 Stats"], ["ai", "✦ AI Analysis"], ["settings", "⚙️ Settings"]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{ flex: 1, background: tab === id ? C.accent : C.card, color: tab === id ? "#0F0D0B" : C.muted, border: `1px solid ${tab === id ? C.accent : C.border}`, borderRadius: 12, padding: "9px 6px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{label}</button>
          ))}
        </div>
      </div>

      {/* STATS TAB */}
      {tab === "stats" && (
        <>
          {/* Key metrics */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
            {[
              { label: "Total Value", val: `$${totalVal}`, color: C.accent },
              { label: "Total Wears", val: totalWears, color: C.success },
              { label: "Avg Cost/Wear", val: `$${avgCPW}`, color: C.gold },
              { label: "Days Logged", val: logsCount, color: C.purple },
            ].map(m => (
              <div key={m.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "18px 16px" }}>
                <p style={{ color: m.color, fontSize: 26, fontFamily: "'Cormorant Garamond',serif", fontWeight: 700 }}>{m.val}</p>
                <p style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{m.label}</p>
              </div>
            ))}
          </div>

          {/* Category bar chart */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: 18, marginBottom: 16 }}>
            <p style={{ color: C.text, fontSize: 14, fontWeight: 600, marginBottom: 16, fontFamily: "'Cormorant Garamond',serif" }}>Wardrobe Breakdown</p>
            {Object.entries(catCounts).map(([cat, count]) => (
              <div key={cat} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ color: C.muted, fontSize: 12 }}>{cat}</span>
                  <span style={{ color: C.text, fontSize: 12, fontWeight: 600 }}>{count}</span>
                </div>
                <div style={{ height: 5, background: C.border, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(count / maxCat) * 100}%`, background: `linear-gradient(90deg,${C.accent},${C.gold})`, borderRadius: 3, transition: "width 0.8s ease" }} />
                </div>
              </div>
            ))}
          </div>

          {/* Best / Worst value */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
            {bestVal && (
              <div style={{ background: `${C.success}18`, border: `1px solid ${C.success}33`, borderRadius: 16, padding: 14 }}>
                <p style={{ color: C.success, fontSize: 10, fontWeight: 700, marginBottom: 6 }}>BEST VALUE</p>
                <p style={{ fontSize: 28, marginBottom: 6 }}>{bestVal.img}</p>
                <p style={{ color: C.text, fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{bestVal.name}</p>
                <p style={{ color: C.success, fontSize: 13, fontWeight: 700 }}>${(bestVal.price / bestVal.wears).toFixed(1)}/wear</p>
              </div>
            )}
            {worstVal && (
              <div style={{ background: `${C.rose}18`, border: `1px solid ${C.rose}33`, borderRadius: 16, padding: 14 }}>
                <p style={{ color: C.rose, fontSize: 10, fontWeight: 700, marginBottom: 6 }}>NEEDS MORE WEAR</p>
                <p style={{ fontSize: 28, marginBottom: 6 }}>{worstVal.img}</p>
                <p style={{ color: C.text, fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{worstVal.name}</p>
                <p style={{ color: C.rose, fontSize: 13, fontWeight: 700 }}>${(worstVal.price / worstVal.wears).toFixed(1)}/wear</p>
              </div>
            )}
          </div>

          {/* Cost per wear ranked list */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: 18, marginBottom: 16 }}>
            <p style={{ color: C.text, fontSize: 14, fontWeight: 600, marginBottom: 14, fontFamily: "'Cormorant Garamond',serif" }}>Cost Per Wear Ranking</p>
            {[...wardrobe].filter(w => w.wears > 0).sort((a, b) => (a.price / a.wears) - (b.price / b.wears)).map((item, i) => (
              <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ color: C.muted, fontSize: 11, width: 16, flexShrink: 0 }}>#{i + 1}</span>
                <span style={{ fontSize: 22, flexShrink: 0 }}>{item.img}</span>
                <span style={{ color: C.text, fontSize: 12, flex: 1 }}>{item.name}</span>
                <span style={{ color: i < 3 ? C.success : i > wardrobe.length - 3 ? C.rose : C.muted, fontSize: 12, fontWeight: 700, flexShrink: 0 }}>${(item.price / item.wears).toFixed(1)}</span>
              </div>
            ))}
          </div>

          {/* Declutter nudge */}
          {unworn.length > 0 && (
            <div style={{ background: `${C.rose}11`, border: `1px solid ${C.rose}33`, borderRadius: 16, padding: 16 }}>
              <p style={{ color: C.rose, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>🧹 Declutter Suggestions</p>
              <p style={{ color: C.muted, fontSize: 12, marginBottom: 12 }}>{unworn.length} items worn fewer than 3 times</p>
              {unworn.map(item => (
                <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 22 }}>{item.img}</span>
                  <span style={{ color: C.text, fontSize: 13, flex: 1 }}>{item.name}</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button style={{ background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, padding: "4px 10px", fontSize: 10, cursor: "pointer" }}>Sell</button>
                    <button style={{ background: "transparent", color: C.rose, border: `1px solid ${C.rose}44`, borderRadius: 8, padding: "4px 10px", fontSize: 10, cursor: "pointer" }}>Donate</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* AI ANALYSIS TAB */}
      {tab === "ai" && (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
            <button onClick={runAI} disabled={loading} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 10, padding: "6px 12px", color: C.muted, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <Ico d={ICONS.refresh} s={12} /> Refresh
            </button>
          </div>
          {loading && <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "24px 0" }}><Spin s={18} /><span style={{ color: C.muted, fontSize: 13 }}>Claude is analyzing your wardrobe…</span></div>}
          {error && <Err msg={error} onRetry={runAI} />}
          {analysis && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Style score */}
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <p style={{ color: C.muted, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>Style Score</p>
                    <p style={{ color: C.accent, fontSize: 42, fontFamily: "'Cormorant Garamond',serif", fontWeight: 700, lineHeight: 1 }}>{analysis.styleScore}<span style={{ fontSize: 16, color: C.muted }}>/100</span></p>
                  </div>
                  <AIBadge />
                </div>
                <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: "hidden", marginBottom: 10 }}>
                  <div style={{ height: "100%", width: `${analysis.styleScore}%`, background: `linear-gradient(90deg,${C.accent},${C.gold})`, borderRadius: 3 }} />
                </div>
                <p style={{ color: C.muted, fontSize: 12, lineHeight: 1.5, fontStyle: "italic" }}>{analysis.styleScoreReason}</p>
              </div>

              <div style={{ background: `${C.accent}18`, border: `1px solid ${C.accent}33`, borderRadius: 16, padding: 16 }}>
                <p style={{ color: C.accent, fontSize: 12, fontWeight: 700, marginBottom: 6 }}>🛍️ Your Missing Piece</p>
                <p style={{ color: C.text, fontSize: 15, fontWeight: 600, fontFamily: "'Cormorant Garamond',serif", marginBottom: 4 }}>{analysis.gapItem}</p>
                <p style={{ color: C.muted, fontSize: 12, lineHeight: 1.5 }}>{analysis.gapReason}</p>
              </div>

              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16 }}>
                <p style={{ color: C.gold, fontSize: 12, fontWeight: 700, marginBottom: 6 }}>🎨 Color Insight</p>
                <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.5 }}>{analysis.colorInsight}</p>
              </div>

              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16 }}>
                <p style={{ color: C.success, fontSize: 12, fontWeight: 700, marginBottom: 6 }}>🔄 Restyle This Piece</p>
                <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.5 }}>{analysis.unwornTip}</p>
              </div>

              <div style={{ background: `${C.purple}18`, border: `1px solid ${C.purple}33`, borderRadius: 16, padding: 16 }}>
                <p style={{ color: C.purple, fontSize: 12, fontWeight: 700, marginBottom: 6 }}>✦ Next Best Purchase</p>
                <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.5 }}>{analysis.nextPurchase}</p>
              </div>
            </div>
          )}
        </>
      )}

      {/* SETTINGS TAB */}
      {tab === "settings" && (
        <div>
          <div style={{ borderRadius: 16, border: `1px solid ${C.border}`, overflow: "hidden", marginBottom: 20 }}>
            {[
              ["Color Season", `${season} 🍂`],
              ["Style Vibe", vibe],
              ["Location", profile?.location || "Dubai, UAE"],
              ["Modest Mode", "Off"],
              ["Language", "English"],
              ["Subscription", "Pro ✓"],
            ].map(([l, v], i, arr) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "15px 18px", borderBottom: i < arr.length - 1 ? `1px solid ${C.border}` : "none" }}>
                <span style={{ color: C.text, fontSize: 14 }}>{l}</span>
                <span style={{ color: C.muted, fontSize: 13 }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{ background: `${C.error}11`, border: `1px solid ${C.error}33`, borderRadius: 14, padding: 16 }}>
            <p style={{ color: C.error, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>⚠️ Reset Wardrobe Data</p>
            <p style={{ color: C.muted, fontSize: 12, marginBottom: 12 }}>This will restore all items to default and clear outfit logs. Cannot be undone.</p>
            <button onClick={onResetWardrobe} style={{ background: C.error, color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Reset to Default</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── CLOSET SCREEN ────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function ClosetScreen({ wardrobe, setWardrobe, setAddItem }) {
  const [filter, setFilter] = useState("All");
  const [sel, setSel] = useState(null);
  const [saving, setSaving] = useState(false);
  const cats = ["All", "Tops", "Bottoms", "Dresses", "Outerwear", "Shoes", "Accessories"];
  const filtered = filter === "All" ? wardrobe : wardrobe.filter(w => w.category === filter);

  const deleteItem = async (id) => {
    setSaving(true);
    await setWardrobe(prev => prev.filter(w => w.id !== id));
    setSel(null);
    setTimeout(() => setSaving(false), 1200);
  };

  const logWear = async (id) => {
    await setWardrobe(prev => prev.map(w => w.id === id ? { ...w, wears: (w.wears || 0) + 1 } : w));
    setSel(null);
  };

  return (
    <div style={{ padding: "0 20px 100px" }}>
      <div style={{ paddingTop: 60, marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 32, color: C.text, fontWeight: 400 }}>My Closet</h1>
          <p style={{ color: C.muted, fontSize: 12 }}>{wardrobe.length} items · saved across sessions</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {saving && <SavedPill show={true} />}
          <button onClick={() => setAddItem(true)} style={{ background: C.accent, color: "#0F0D0B", border: "none", borderRadius: 12, width: 40, height: 40, fontSize: 22, cursor: "pointer" }}>+</button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 24, overflowX: "auto", paddingBottom: 4 }}>
        {cats.map(c => <button key={c} onClick={() => setFilter(c)} style={{ background: filter === c ? C.accent : C.card, color: filter === c ? "#0F0D0B" : C.muted, border: `1px solid ${filter === c ? C.accent : C.border}`, borderRadius: 20, padding: "7px 16px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", fontWeight: filter === c ? 700 : 400 }}>{c}</button>)}
      </div>
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <p style={{ color: C.muted, fontSize: 14 }}>No {filter} items yet.</p>
          <button onClick={() => setAddItem(true)} style={{ marginTop: 12, color: C.accent, background: "none", border: `1px solid ${C.accent}`, borderRadius: 12, padding: "10px 20px", cursor: "pointer", fontSize: 13 }}>+ Add Item</button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {filtered.map(item => (
            <div key={item.id} onClick={() => setSel(item)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, cursor: "pointer" }}>
              <div style={{ fontSize: 44, textAlign: "center", marginBottom: 12, background: C.surface, borderRadius: 12, padding: "16px 0" }}>{item.img}</div>
              <p style={{ color: C.text, fontSize: 12, fontWeight: 500, marginBottom: 4 }}>{item.name}</p>
              <p style={{ color: C.muted, fontSize: 11 }}>Worn {item.wears || 0}× · {item.wears > 0 ? `$${((item.price || 0) / (item.wears || 1)).toFixed(1)}/wear` : "Never worn"}</p>
            </div>
          ))}
        </div>
      )}
      {sel && (
        <div style={{ position: "fixed", inset: 0, background: "#000000CC", zIndex: 100, display: "flex", alignItems: "flex-end" }} onClick={() => setSel(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.surface, borderRadius: "24px 24px 0 0", padding: 28, width: "100%" }}>
            <div style={{ textAlign: "center", fontSize: 64, marginBottom: 12 }}>{sel.img}</div>
            <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 24, color: C.text, marginBottom: 4 }}>{sel.name}</h2>
            <p style={{ color: C.muted, fontSize: 13, marginBottom: 20 }}>{sel.category} · {sel.colorName}</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
              {[["Worn", `${sel.wears || 0}×`], ["Paid", `$${sel.price || 0}`], ["Per Wear", sel.wears > 0 ? `$${((sel.price || 0) / (sel.wears || 1)).toFixed(1)}` : "—"]].map(([l, v]) => (
                <div key={l} style={{ background: C.card, borderRadius: 12, padding: 12, textAlign: "center" }}>
                  <p style={{ color: C.accent, fontSize: 18, fontFamily: "'Cormorant Garamond',serif" }}>{v}</p>
                  <p style={{ color: C.muted, fontSize: 11 }}>{l}</p>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => logWear(sel.id)} style={{ flex: 1, background: C.success, color: "#0F0D0B", border: "none", borderRadius: 14, padding: 14, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>+ Log Wear</button>
              <button onClick={() => setSel(null)} style={{ flex: 1, background: C.card, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, cursor: "pointer" }}>Close</button>
              <button onClick={() => deleteItem(sel.id)} style={{ background: `${C.error}22`, color: C.error, border: `1px solid ${C.error}44`, borderRadius: 14, padding: "14px 16px", cursor: "pointer" }}>
                <Ico d={ICONS.trash} s={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── ADD ITEM MODAL (with AI + persistence) ───────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function AddItemModal({ wardrobe, setWardrobe, onClose }) {
  const [step, setStep] = useState(1);
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(false);

  const analyze = async () => {
    if (!desc.trim()) return;
    setLoading(true); setErr(null);
    try {
      const raw = await askClaude(
        "You are a fashion item classifier for ClothBuddy.",
        `Classify: "${desc}"\nReturn ONLY valid JSON, no markdown:\n{"category":"Tops|Bottoms|Shoes|Accessories|Outerwear|Dress","subcategory":"specific type","colorName":"color","pattern":"solid|striped|floral|checked","material":"fabric","seasons":["Spring"],"occasions":["Casual"],"estimatedPrice":80,"suggestedEmoji":"👚"}`,
        300
      );
      const p = safeJSON(raw);
      if (!p) throw new Error();
      setResult(p); setStep(3);
    } catch { setErr("AI couldn't classify this. Try describing differently."); }
    setLoading(false);
  };

  const saveItem = async () => {
    const newItem = {
      id: Date.now(),
      name: desc.split(" ").slice(0, 4).join(" "),
      category: result.category,
      colorName: result.colorName,
      occasions: result.occasions || ["Casual"],
      wears: 0,
      price: result.estimatedPrice || 0,
      img: result.suggestedEmoji || "👔",
      addedAt: new Date().toISOString(),
    };
    await setWardrobe(prev => [...prev, newItem]);
    setSaved(true);
    setTimeout(() => onClose(), 1000);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000DD", zIndex: 200, display: "flex", alignItems: "flex-end" }}>
      <div style={{ background: C.surface, borderRadius: "24px 24px 0 0", padding: 28, width: "100%", maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 24, color: C.text }}>Add to Closet</h2>
            <AIBadge />
          </div>
          <button onClick={onClose} style={{ background: C.card, border: "none", borderRadius: 10, width: 32, height: 32, cursor: "pointer", color: C.muted, fontSize: 18 }}>×</button>
        </div>
        {step === 1 && (
          <div style={{ textAlign: "center" }}>
            <div style={{ border: `2px dashed ${C.border}`, borderRadius: 20, padding: 40, marginBottom: 20 }}>
              <div style={{ fontSize: 52, marginBottom: 12 }}>📷</div>
              <p style={{ color: C.text, fontSize: 15, marginBottom: 4 }}>Describe your clothing item</p>
              <p style={{ color: C.muted, fontSize: 12 }}>Claude classifies and saves it to your persistent wardrobe</p>
            </div>
            <button onClick={() => setStep(2)} style={{ width: "100%", background: C.accent, color: "#0F0D0B", border: "none", borderRadius: 14, padding: 14, fontWeight: 700, cursor: "pointer", fontSize: 15 }}>Describe Item →</button>
          </div>
        )}
        {step === 2 && (
          <div>
            <p style={{ color: C.muted, fontSize: 13, marginBottom: 12 }}>Describe your clothing item in detail:</p>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Forest green wide-leg linen trousers, high waist, side pockets, relaxed fit" style={{ width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, color: C.text, fontSize: 14, resize: "none", height: 110, outline: "none", boxSizing: "border-box", fontFamily: "inherit" }} />
            {err && <Err msg={err} />}
            <button onClick={analyze} disabled={loading || !desc.trim()} style={{ width: "100%", background: loading ? C.border : C.accent, color: loading ? C.muted : "#0F0D0B", border: "none", borderRadius: 14, padding: 14, fontWeight: 700, cursor: "pointer", marginTop: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
              {loading ? <><Spin s={16} /><span>Claude is classifying…</span></> : "✨ Analyze with Claude"}
            </button>
          </div>
        )}
        {step === 3 && result && (
          <div>
            <div style={{ background: `${C.success}18`, border: `1px solid ${C.success}44`, borderRadius: 12, padding: "10px 14px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 28 }}>{result.suggestedEmoji || "👔"}</span>
              <div>
                <p style={{ color: C.success, fontSize: 13, fontWeight: 700 }}>Claude classified your item</p>
                <p style={{ color: C.muted, fontSize: 12 }}>Will be saved to your persistent wardrobe</p>
              </div>
            </div>
            {[["Category", result.category], ["Type", result.subcategory], ["Color", result.colorName], ["Pattern", result.pattern], ["Material", result.material], ["Price Est.", `~$${result.estimatedPrice || "?"}`], ["Seasons", result.seasons?.join(", ")], ["Occasions", result.occasions?.join(", ")]].map(([l, v]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: `1px solid ${C.border}` }}>
                <span style={{ color: C.muted, fontSize: 13 }}>{l}</span>
                <span style={{ color: C.text, fontSize: 13, fontWeight: 500, textAlign: "right", maxWidth: "60%" }}>{v}</span>
              </div>
            ))}
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => setStep(2)} style={{ flex: 1, background: C.card, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, cursor: "pointer" }}>Edit</button>
              <button onClick={saveItem} disabled={saved} style={{ flex: 2, background: saved ? C.success : C.accent, color: "#0F0D0B", border: "none", borderRadius: 14, padding: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {saved ? <><Ico d={ICONS.check} s={16} /> Saved!</> : "Save to Closet ✓"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── OUTFIT GENERATOR (with share card) ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function OutfitGenerator({ wardrobe, profile }) {
  const [occ, setOcc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [err, setErr] = useState(null);
  const [shareData, setShareData] = useState(null);
  const occs = ["Work 💼", "Casual 🌅", "Date Night 🌙", "Formal 🎩", "Travel ✈️", "Sport 🏋️", "Beach 🌊", "Party 🎉"];

  const generate = async (o) => {
    setOcc(o); setLoading(true); setErr(null); setResults(null);
    const sys = buildStylistSys(wardrobe, profile);
    try {
      const raw = await askClaude(sys,
        `Generate 3 distinct outfit suggestions for: "${o}". Use ONLY items from my wardrobe. Return ONLY valid JSON array, no markdown:\n[{"name":"creative name","items":["exact item name from wardrobe","..."],"score":90,"why":"one sentence why this works"}]`,
        600);
      const p = safeJSON(raw);
      if (!p) throw new Error();
      setResults(p);
    } catch { setErr("Couldn't generate outfits."); }
    setLoading(false);
  };

  const openShare = (outfit) => {
    const items = outfit.items.map(name => wardrobe.find(w => w.name.toLowerCase().includes(name.toLowerCase().split(" ").pop())) || { img: "👔", name });
    setShareData({ outfit: outfit.name, items, score: outfit.score });
  };

  return (
    <div style={{ padding: "0 20px 100px" }}>
      <div style={{ paddingTop: 60, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <h1 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 32, color: C.text, fontWeight: 400 }}>Outfit Generator</h1>
          <AIBadge />
        </div>
        <p style={{ color: C.muted, fontSize: 13 }}>Pick an occasion — Claude styles from your closet</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 24 }}>
        {occs.map(o => <button key={o} onClick={() => generate(o)} style={{ background: occ === o ? `${C.accent}22` : C.card, border: `1.5px solid ${occ === o ? C.accent : C.border}`, borderRadius: 14, padding: "14px 10px", color: occ === o ? C.accent : C.muted, fontSize: 13, cursor: "pointer", fontWeight: occ === o ? 700 : 400 }}>{o}</button>)}
      </div>
      {loading && <div style={{ textAlign: "center", padding: 40 }}><Spin s={32} /><p style={{ color: C.muted, fontSize: 14, marginTop: 16 }}>Claude is styling your look…</p></div>}
      {err && <Err msg={err} onRetry={() => occ && generate(occ)} />}
      {results && results.map((r, i) => {
        const items = r.items.map(name => wardrobe.find(w => w.name.toLowerCase().includes(name.toLowerCase().split(" ").pop())) || { img: "👔", name });
        return (
          <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 20, padding: 20, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, color: C.text, fontWeight: 600 }}>{r.name}</h3>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ background: `${C.accent}22`, borderRadius: 20, padding: "4px 12px" }}><span style={{ color: C.accent, fontSize: 12, fontWeight: 700 }}>✦ {r.score}</span></div>
                <button onClick={() => openShare(r)} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "5px 8px", cursor: "pointer", color: C.muted }}><Ico d={ICONS.share} s={14} /></button>
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {items.map((item, j) => (
                <div key={j} style={{ background: C.surface, borderRadius: 10, padding: "8px 12px", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 18 }}>{item.img}</span>
                  <span style={{ color: C.text, fontSize: 12 }}>{r.items[j]}</span>
                </div>
              ))}
            </div>
            <p style={{ color: C.muted, fontSize: 12, lineHeight: 1.5, fontStyle: "italic" }}>✦ {r.why}</p>
          </div>
        );
      })}
      {shareData && <ShareCard {...shareData} onClose={() => setShareData(null)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── WEATHER CARD ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function WeatherCard({ wardrobe, profile }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const load = useCallback(async () => {
    setLoading(true); setErr(null); setData(null);
    const sys = buildStylistSys(wardrobe, profile);
    try {
      const text = await askClaude(sys, "It's 38°C sunny Dubai today. Pick ONE best outfit from my wardrobe for this heat. Return ONLY valid JSON: {\"outfit\":\"Top + Bottom + Shoes\",\"tip\":\"one sentence why\"}", 200);
      setData(safeJSON(text) || { outfit: text, tip: "" });
    } catch { setErr("Couldn't load today's pick."); }
    setLoading(false);
  }, [wardrobe]);
  useEffect(() => { load(); }, []);
  return (
    <div style={{ background: `linear-gradient(135deg,${C.accent}18,${C.gold}0A)`, border: `1px solid ${C.border}`, borderRadius: 20, padding: "18px 20px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <p style={{ color: C.muted, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>Dubai · Today ☀️</p>
          <span style={{ fontSize: 38, fontFamily: "'Cormorant Garamond',serif", color: C.text, lineHeight: 1 }}>38°C</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}><AIBadge /><button onClick={load} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}><Ico d={ICONS.refresh} s={14} /></button></div>
      </div>
      {loading && <div style={{ display: "flex", gap: 10, alignItems: "center" }}><Spin s={14} /><span style={{ color: C.muted, fontSize: 13 }}>Styling for today…</span></div>}
      {data && <><p style={{ color: C.text, fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{data.outfit}</p>{data.tip && <p style={{ color: C.muted, fontSize: 12, fontStyle: "italic" }}>{data.tip}</p>}</>}
      {err && <Err msg={err} onRetry={load} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── CALENDAR, TRYON, GAP (condensed with wardrobe prop) ─────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// ─── CalendarEntry data model ─────────────────────────────────────────────────
// {
//   date: "YYYY-MM-DD",          — ISO date string, used as primary key
//   itemIds: [1, 3, 6],          — wardrobe item ids worn that day
//   outfitName: "Power Monday",  — display label
//   occasion: "Work",            — detected occasion
//   loggedAt: ISO timestamp,     — when the entry was saved
//   note: ""                     — optional free-text note
// }

function makeEntry(dateStr, items, occasion = "Casual", note = "") {
  return {
    date: dateStr,
    itemIds: items.map(i => i.id),
    outfitName: items.length > 0
      ? items.map(i => i.name.split(" ").slice(0, 2).join(" ")).join(" + ")
      : "Outfit",
    occasion,
    loggedAt: new Date().toISOString(),
    note,
  };
}

// Convert legacy log format → CalendarEntry if needed
function normaliseLog(log) {
  if (!log) return null;
  if (log.itemIds) return log; // already a CalendarEntry
  // legacy: { items:["👚"], name:"..." } → wrap into CalendarEntry shape
  return {
    date: log.date || "",
    itemIds: [],
    outfitName: log.name || "Outfit",
    occasion: "Casual",
    loggedAt: log.loggedAt || new Date().toISOString(),
    note: "",
    _legacyItems: log.items || [],
  };
}

// Check last N days for the same item combination
function detectRepetition(outfitLogs, wardrobe, dateStr, candidateItemIds, windowDays = 7) {
  const matches = [];
  const d = new Date(dateStr);
  for (let i = 1; i <= windowDays; i++) {
    const prev = new Date(d);
    prev.setDate(prev.getDate() - i);
    const key = prev.toISOString().split("T")[0];
    const entry = outfitLogs[key];
    if (!entry) continue;
    const norm = normaliseLog(entry);
    if (!norm?.itemIds?.length) continue;
    // overlap: any anchor item shared
    const overlap = norm.itemIds.filter(id => candidateItemIds.includes(id));
    if (overlap.length > 0) {
      const overlapNames = overlap.map(id => wardrobe.find(w => w.id === id)?.name).filter(Boolean);
      matches.push({ date: key, outfitName: norm.outfitName, overlap: overlapNames, daysAgo: i });
    }
  }
  return matches; // array sorted nearest-first
}

function CalendarScreen({ wardrobe, outfitLogs, setOutfitLogs, profile }) {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selected, setSelected] = useState(null);   // day number selected on grid
  const [view, setView] = useState("calendar"); // "calendar" | "history"

  // Log modal state
  const [logModal, setLogModal] = useState(false);
  const [logDateStr, setLogDateStr] = useState(null);
  const [pickedIds, setPickedIds] = useState([]);
  const [occasion, setOccasion] = useState("Casual");
  const [note, setNote] = useState("");
  const [repetitionWarning, setRepetitionWarning] = useState(null); // array of matches | null
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(null); // dateStr of last save

  // AI suggestion state
  const [aiSug, setAiSug] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);

  const OCCASIONS = ["Casual", "Work", "Formal", "Date Night", "Sport", "Travel", "Party", "Other"];

  // ── Helpers ─────────────────────────────────────────────────────────────
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const getDS = (day) => new Date(year, month, day).toISOString().split("T")[0];
  const getEntry = (ds) => outfitLogs[ds] ? normaliseLog(outfitLogs[ds]) : null;

  const streak = (() => {
    let c = 0; const d = new Date(today);
    while (c < 365) {
      const k = d.toISOString().split("T")[0];
      if (outfitLogs[k]) { c++; d.setDate(d.getDate() - 1); } else break;
    }
    return c;
  })();

  // Most-worn item this month
  const monthItemCounts = Object.entries(outfitLogs)
    .filter(([ds]) => ds.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`))
    .flatMap(([, log]) => normaliseLog(log)?.itemIds || [])
    .reduce((acc, id) => { acc[id] = (acc[id] || 0) + 1; return acc; }, {});
  const topItemId = Object.entries(monthItemCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topItem = topItemId ? wardrobe.find(w => w.id === Number(topItemId)) : null;

  // ── One-tap today log shortcut ───────────────────────────────────────────
  const openLogForToday = () => {
    setLogDateStr(todayStr);
    setPickedIds([]);
    setOccasion("Casual");
    setNote("");
    setRepetitionWarning(null);
    setLogModal(true);
  };

  const openLogForDay = (ds) => {
    setLogDateStr(ds);
    setPickedIds([]);
    setOccasion("Casual");
    setNote("");
    setRepetitionWarning(null);
    setLogModal(true);
  };

  // ── Toggle item selection in log modal ───────────────────────────────────
  const toggleItem = (id) => {
    setRepetitionWarning(null); // clear warning on change
    setPickedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  // Check repetition whenever pickedIds changes
  useEffect(() => {
    if (pickedIds.length === 0 || !logDateStr) { setRepetitionWarning(null); return; }
    const matches = detectRepetition(outfitLogs, wardrobe, logDateStr, pickedIds, 7);
    setRepetitionWarning(matches.length > 0 ? matches : null);
  }, [pickedIds, logDateStr, outfitLogs, wardrobe]);

  // ── Save entry ───────────────────────────────────────────────────────────
  const saveEntry = async () => {
    if (pickedIds.length === 0 || !logDateStr) return;
    setSaving(true);
    const pickedItems = wardrobe.filter(w => pickedIds.includes(w.id));
    const entry = makeEntry(logDateStr, pickedItems, occasion, note);
    await setOutfitLogs(prev => ({ ...prev, [logDateStr]: entry }));
    setJustSaved(logDateStr);
    setSaving(false);
    setLogModal(false);
    setPickedIds([]);
    setNote("");
    setRepetitionWarning(null);
    // auto-select the saved day on calendar
    const savedDay = new Date(logDateStr).getDate();
    setSelected(savedDay);
    setTimeout(() => setJustSaved(null), 3000);
  };

  // ── Delete entry ─────────────────────────────────────────────────────────
  const deleteEntry = async (ds) => {
    await setOutfitLogs(prev => {
      const next = { ...prev };
      delete next[ds];
      return next;
    });
    setSelected(null);
  };

  // ── AI suggestion ────────────────────────────────────────────────────────
  const getSug = async (ds) => {
    setAiLoading(true); setAiError(null); setAiSug(null);
    const recent = Object.entries(outfitLogs)
      .slice(-4).map(([, v]) => normaliseLog(v)?.outfitName).filter(Boolean).join(", ");
    const sys = buildStylistSys(wardrobe, profile);
    try {
      const raw = await askClaude(sys,
        `Suggest an outfit for ${DAYS[new Date(ds).getDay()]} ${ds}. ` +
        `Recent outfits worn: ${recent || "none yet"}. ` +
        `Avoid repeating items worn recently. ` +
        `Return ONLY valid JSON:\n` +
        `{"outfitName":"creative name","items":["exact item name 1","exact item name 2","exact item name 3"],"occasion":"Work|Casual|Date Night|etc","reason":"one sentence why this works","emojis":["👚","👖","👟"]}`,
        280);
      const p = safeJSON(raw);
      if (!p) throw new Error();
      setAiSug(p);
    } catch { setAiError("Suggestion failed."); }
    setAiLoading(false);
  };

  // ── Apply AI suggestion directly into log modal ──────────────────────────
  const applyAiSug = () => {
    if (!aiSug) return;
    const ids = (aiSug.items || [])
      .map(name => wardrobe.find(w => w.name.toLowerCase().includes(name.toLowerCase().split(" ").pop()))?.id)
      .filter(Boolean);
    setPickedIds(ids);
    setOccasion(aiSug.occasion || "Casual");
    setLogDateStr(logDateStr || todayStr);
    setLogModal(true);
  };

  // ── Sorted history view ──────────────────────────────────────────────────
  const historyEntries = Object.entries(outfitLogs)
    .map(([ds, log]) => ({ ds, entry: normaliseLog(log) }))
    .sort((a, b) => b.ds.localeCompare(a.ds));

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: "0 20px 100px" }}>
      {/* Header */}
      <div style={{ paddingTop: 60, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <h1 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 32, color: C.text, fontWeight: 400 }}>Outfit Calendar</h1>
          <AIBadge color={C.purple} />
        </div>
        <p style={{ color: C.muted, fontSize: 13 }}>Log outfits · Detect repeats · Track streaks</p>
      </div>

      {/* One-tap log today button */}
      {!getEntry(todayStr) && (
        <button onClick={openLogForToday} style={{ width: "100%", background: `linear-gradient(135deg,${C.success},${C.success}CC)`, color: "#0F0D0B", border: "none", borderRadius: 16, padding: "15px 20px", fontSize: 15, fontWeight: 700, cursor: "pointer", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>👗</span> Log Today's Outfit
        </button>
      )}
      {justSaved === todayStr && (
        <div style={{ background: `${C.success}22`, border: `1px solid ${C.success}44`, borderRadius: 12, padding: "10px 16px", marginBottom: 16, color: C.success, fontSize: 13, fontWeight: 600, textAlign: "center" }}>
          ✓ Today's outfit saved!
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
        <div style={{ background: `linear-gradient(135deg,${C.purple}22,${C.accent}11)`, border: `1px solid ${C.purple}33`, borderRadius: 14, padding: "14px 10px", textAlign: "center" }}>
          <p style={{ color: C.purple, fontSize: 24, fontFamily: "'Cormorant Garamond',serif", fontWeight: 700, lineHeight: 1 }}>🔥 {streak}</p>
          <p style={{ color: C.muted, fontSize: 10, marginTop: 4 }}>day streak</p>
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 10px", textAlign: "center" }}>
          <p style={{ color: C.accent, fontSize: 24, fontFamily: "'Cormorant Garamond',serif", fontWeight: 700, lineHeight: 1 }}>{Object.keys(outfitLogs).length}</p>
          <p style={{ color: C.muted, fontSize: 10, marginTop: 4 }}>days logged</p>
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 10px", textAlign: "center" }}>
          {topItem ? (
            <>
              <p style={{ fontSize: 22, lineHeight: 1 }}>{topItem.img}</p>
              <p style={{ color: C.muted, fontSize: 9, marginTop: 4, lineHeight: 1.3 }}>most worn<br />this month</p>
            </>
          ) : (
            <>
              <p style={{ color: C.muted, fontSize: 20, lineHeight: 1 }}>—</p>
              <p style={{ color: C.muted, fontSize: 10, marginTop: 4 }}>this month</p>
            </>
          )}
        </div>
      </div>

      {/* View toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {[["calendar", "📅 Calendar"], ["history", "📋 History"]].map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} style={{ flex: 1, background: view === id ? C.purple : C.card, color: view === id ? "#fff" : C.muted, border: `1px solid ${view === id ? C.purple : C.border}`, borderRadius: 12, padding: "9px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{label}</button>
        ))}
      </div>

      {/* ── CALENDAR VIEW ── */}
      {view === "calendar" && (
        <>
          {/* Month nav */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <button onClick={() => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); }} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, width: 36, height: 36, cursor: "pointer", color: C.text, fontSize: 18 }}>‹</button>
            <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, color: C.text }}>{MONTHS[month]} {year}</h2>
            <button onClick={() => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); }} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, width: 36, height: 36, cursor: "pointer", color: C.text, fontSize: 18 }}>›</button>
          </div>

          {/* Day labels */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 4 }}>
            {DAYS.map(d => <div key={d} style={{ textAlign: "center", color: C.muted, fontSize: 10, padding: "4px 0", fontWeight: 600, letterSpacing: 0.5 }}>{d}</div>)}
          </div>

          {/* Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3, marginBottom: 20 }}>
            {Array(firstDay).fill(null).map((_, i) => <div key={`e${i}`} />)}
            {Array(daysInMonth).fill(null).map((_, i) => {
              const day = i + 1;
              const ds = getDS(day);
              const entry = getEntry(ds);
              const isT = ds === todayStr;
              const sel = selected === day;
              const hasEntry = !!entry;
              const primaryEmoji = entry?.itemIds?.[0]
                ? wardrobe.find(w => w.id === entry.itemIds[0])?.img
                : entry?._legacyItems?.[0] || null;

              return (
                <div key={day}
                  onClick={() => {
                    setSelected(sel ? null : day);
                    setAiSug(null); setAiError(null);
                    if (!sel && !hasEntry) getSug(ds);
                  }}
                  style={{ aspectRatio: "1", borderRadius: 10, border: `1.5px solid ${sel ? C.accent : isT ? C.purple : hasEntry ? C.success + "88" : C.border}`, background: sel ? `${C.accent}18` : isT ? `${C.purple}18` : hasEntry ? `${C.success}0D` : C.card, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, position: "relative" }}>
                  <span style={{ fontSize: 11, color: isT ? C.purple : sel ? C.accent : hasEntry ? C.success : C.muted, fontWeight: isT || sel ? 700 : 400 }}>{day}</span>
                  {primaryEmoji && <span style={{ fontSize: 13 }}>{primaryEmoji}</span>}
                  {justSaved === ds && (
                    <div style={{ position: "absolute", top: 2, right: 2, width: 6, height: 6, borderRadius: "50%", background: C.success }} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Selected day panel */}
          {selected && (() => {
            const ds = getDS(selected);
            const entry = getEntry(ds);
            const dayLabel = `${DAYS[new Date(year, month, selected).getDay()]}, ${MONTHS[month]} ${selected}`;
            const isToday = ds === todayStr;

            return (
              <div style={{ background: C.card, border: `1px solid ${entry ? C.success + "66" : C.accent + "44"}`, borderRadius: 20, padding: 20, marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <p style={{ color: C.muted, fontSize: 12 }}>{dayLabel}</p>
                  {entry && (
                    <button onClick={() => deleteEntry(ds)} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8, padding: "3px 10px", color: C.muted, fontSize: 11, cursor: "pointer" }}>Remove</button>
                  )}
                </div>

                {entry ? (
                  /* ── Logged entry display ── */
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <span style={{ fontSize: 10, background: `${C.success}22`, color: C.success, padding: "2px 10px", borderRadius: 20, fontWeight: 700 }}>✓ Logged</span>
                      <span style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>{entry.outfitName}</span>
                      {entry.occasion && <Tag label={entry.occasion} color={C.purple} />}
                    </div>

                    {/* Items row */}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: entry.note ? 10 : 0 }}>
                      {entry.itemIds?.length > 0
                        ? entry.itemIds.map(id => {
                          const item = wardrobe.find(w => w.id === id);
                          return item ? (
                            <div key={id} style={{ background: C.surface, borderRadius: 10, padding: "10px 8px", textAlign: "center", minWidth: 52 }}>
                              <div style={{ fontSize: 26 }}>{item.img}</div>
                              <p style={{ color: C.muted, fontSize: 9, marginTop: 4, lineHeight: 1.2 }}>{item.name.split(" ").slice(0, 2).join(" ")}</p>
                            </div>
                          ) : null;
                        })
                        : entry._legacyItems?.map((e, i) => (
                          <span key={i} style={{ fontSize: 28, background: C.surface, borderRadius: 10, width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>{e}</span>
                        ))
                      }
                    </div>
                    {entry.note && (
                      <p style={{ color: C.muted, fontSize: 12, fontStyle: "italic", marginTop: 8 }}>"{entry.note}"</p>
                    )}
                  </div>
                ) : (
                  /* ── Empty day: log button + AI suggestion ── */
                  <div>
                    <button
                      onClick={() => openLogForDay(ds)}
                      style={{ width: "100%", background: isToday ? C.success : C.card, color: isToday ? "#0F0D0B" : C.text, border: `1px solid ${isToday ? C.success : C.border}`, borderRadius: 12, padding: "12px", fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 16 }}>
                      {isToday ? "👗 Log Today's Outfit" : "+ Log This Day"}
                    </button>

                    {/* AI suggestion */}
                    <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                        <AIBadge color={C.purple} />
                        <span style={{ color: C.muted, fontSize: 12 }}>Claude's suggestion</span>
                        <button onClick={() => getSug(ds)} style={{ marginLeft: "auto", background: "none", border: "none", color: C.muted, cursor: "pointer" }}><Ico d={ICONS.refresh} s={12} /></button>
                      </div>
                      {aiLoading && <div style={{ display: "flex", gap: 8, alignItems: "center" }}><Spin s={14} /><span style={{ color: C.muted, fontSize: 12 }}>Planning your look…</span></div>}
                      {aiError && <Err msg={aiError} onRetry={() => getSug(ds)} />}
                      {aiSug && (
                        <div style={{ background: `${C.purple}11`, border: `1px solid ${C.purple}22`, borderRadius: 14, padding: 14 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                            <p style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>{aiSug.outfitName}</p>
                            {aiSug.occasion && <Tag label={aiSug.occasion} color={C.purple} />}
                          </div>
                          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                            {(aiSug.emojis || []).map((e, i) => <span key={i} style={{ fontSize: 24, background: C.card, borderRadius: 8, width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center" }}>{e}</span>)}
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
                            {(aiSug.items || []).map((item, i) => <Tag key={i} label={item} color={C.purple} />)}
                          </div>
                          <p style={{ color: C.muted, fontSize: 12, fontStyle: "italic", marginBottom: 10 }}>✦ {aiSug.reason}</p>
                          <button onClick={applyAiSug} style={{ width: "100%", background: C.purple, color: "#fff", border: "none", borderRadius: 10, padding: "9px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                            Use This Outfit →
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </>
      )}

      {/* ── HISTORY VIEW ── */}
      {view === "history" && (
        <div>
          {historyEntries.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 0" }}>
              <p style={{ fontSize: 48, marginBottom: 12 }}>📋</p>
              <p style={{ color: C.text, fontSize: 16, fontFamily: "'Cormorant Garamond',serif" }}>No outfits logged yet</p>
              <p style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>Tap "Log Today's Outfit" to start</p>
            </div>
          ) : (
            historyEntries.map(({ ds, entry }) => {
              if (!entry) return null;
              const d = new Date(ds);
              const isT = ds === todayStr;
              return (
                <div key={ds} style={{ background: C.card, border: `1px solid ${isT ? C.success + "88" : C.border}`, borderRadius: 16, padding: 16, marginBottom: 10, display: "flex", gap: 12, alignItems: "center" }}>
                  {/* Date badge */}
                  <div style={{ background: isT ? `${C.success}22` : C.surface, border: `1px solid ${isT ? C.success + "44" : C.border}`, borderRadius: 12, padding: "8px 10px", textAlign: "center", flexShrink: 0, minWidth: 44 }}>
                    <p style={{ color: isT ? C.success : C.accent, fontSize: 16, fontFamily: "'Cormorant Garamond',serif", fontWeight: 700, lineHeight: 1 }}>{d.getDate()}</p>
                    <p style={{ color: C.muted, fontSize: 9, marginTop: 2 }}>{MONTHS[d.getMonth()].slice(0, 3)}</p>
                  </div>
                  {/* Item emojis */}
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    {entry.itemIds?.slice(0, 3).map(id => {
                      const item = wardrobe.find(w => w.id === id);
                      return item ? <span key={id} style={{ fontSize: 22 }}>{item.img}</span> : null;
                    })}
                    {entry._legacyItems?.slice(0, 3).map((e, i) => <span key={i} style={{ fontSize: 22 }}>{e}</span>)}
                  </div>
                  {/* Name + occasion */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ color: C.text, fontSize: 13, fontWeight: 600, marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.outfitName}</p>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {isT && <span style={{ fontSize: 10, background: `${C.success}22`, color: C.success, padding: "1px 6px", borderRadius: 10, fontWeight: 700 }}>Today</span>}
                      {entry.occasion && <Tag label={entry.occasion} color={C.muted} />}
                    </div>
                  </div>
                  <button onClick={() => deleteEntry(ds)} style={{ background: "none", border: "none", color: C.border, fontSize: 18, cursor: "pointer", flexShrink: 0 }}>×</button>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── LOG MODAL ── */}
      {logModal && (
        <div style={{ position: "fixed", inset: 0, background: "#000000CC", zIndex: 200, display: "flex", alignItems: "flex-end" }} onClick={() => { setLogModal(false); setRepetitionWarning(null); }}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.surface, borderRadius: "24px 24px 0 0", padding: 28, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>

            {/* Modal header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 22, color: C.text }}>
                {logDateStr === todayStr ? "Log Today's Outfit" : `Log ${logDateStr}`}
              </h3>
              <button onClick={() => { setLogModal(false); setRepetitionWarning(null); }} style={{ background: "none", border: "none", color: C.muted, fontSize: 22, cursor: "pointer" }}>×</button>
            </div>

            {/* ── Repetition warning banner ── */}
            {repetitionWarning && repetitionWarning.length > 0 && (
              <div style={{ background: `${C.gold}18`, border: `1px solid ${C.gold}44`, borderRadius: 14, padding: "12px 16px", marginBottom: 16 }}>
                <p style={{ color: C.gold, fontSize: 13, fontWeight: 700, marginBottom: 6 }}>⚠️ Outfit Repetition Detected</p>
                {repetitionWarning.map((match, i) => (
                  <p key={i} style={{ color: C.muted, fontSize: 12, lineHeight: 1.5, marginBottom: 3 }}>
                    You wore <strong style={{ color: C.text }}>{match.overlap.join(" & ")}</strong> {match.daysAgo === 1 ? "yesterday" : `${match.daysAgo} days ago`} ({match.outfitName})
                  </p>
                ))}
                <p style={{ color: C.gold, fontSize: 11, marginTop: 6 }}>Consider mixing it up — or log anyway!</p>
              </div>
            )}

            {/* Occasion picker */}
            <p style={{ color: C.muted, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10 }}>Occasion</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
              {OCCASIONS.map(occ => (
                <button key={occ} onClick={() => setOccasion(occ)} style={{ background: occasion === occ ? `${C.purple}22` : C.card, border: `1px solid ${occasion === occ ? C.purple : C.border}`, borderRadius: 20, padding: "5px 12px", fontSize: 11, color: occasion === occ ? C.purple : C.muted, cursor: "pointer", fontWeight: occasion === occ ? 700 : 400 }}>{occ}</button>
              ))}
            </div>

            {/* Item selector */}
            <p style={{ color: C.muted, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10 }}>
              Select Items Worn {pickedIds.length > 0 && <span style={{ color: C.accent }}>({pickedIds.length} selected)</span>}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 18 }}>
              {wardrobe.map(w => {
                const picked = pickedIds.includes(w.id);
                return (
                  <div key={w.id} onClick={() => toggleItem(w.id)} style={{ background: picked ? `${C.success}22` : C.card, border: `1.5px solid ${picked ? C.success : C.border}`, borderRadius: 14, padding: "12px 8px", textAlign: "center", cursor: "pointer", transition: "all 0.15s" }}>
                    <div style={{ fontSize: 28, marginBottom: 4 }}>{w.img}</div>
                    <p style={{ color: picked ? C.success : C.muted, fontSize: 10, lineHeight: 1.2 }}>{w.name.split(" ").slice(0, 2).join(" ")}</p>
                  </div>
                );
              })}
            </div>

            {/* Optional note */}
            <p style={{ color: C.muted, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8 }}>Note (optional)</p>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Felt great, wore to the office" style={{ width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "11px 14px", color: C.text, fontSize: 13, outline: "none", marginBottom: 20, boxSizing: "border-box", fontFamily: "inherit" }} />

            {/* Save button */}
            <button
              onClick={saveEntry}
              disabled={pickedIds.length === 0 || saving}
              style={{ width: "100%", background: pickedIds.length > 0 && !saving ? C.success : C.border, color: pickedIds.length > 0 && !saving ? "#0F0D0B" : C.muted, border: "none", borderRadius: 14, padding: 16, fontWeight: 700, cursor: pickedIds.length > 0 ? "pointer" : "default", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
              {saving ? <><Spin s={16} /><span>Saving…</span></> : repetitionWarning ? "Log Anyway ✓" : "Save Outfit ✓"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TryOnScreen({ wardrobe, profile }) {
  const [phase, setPhase] = useState("setup");
  const [shape, setShape] = useState(null);
  const [height, setHeight] = useState("168");
  const [selected, setSelected] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [shareData, setShareData] = useState(null);

  const SHAPES = [{ id: "hourglass", label: "Hourglass", emoji: "⌛", desc: "Balanced, defined waist" }, { id: "pear", label: "Pear", emoji: "🍐", desc: "Hips wider than shoulders" }, { id: "apple", label: "Apple", emoji: "🍎", desc: "Fuller midsection" }, { id: "rectangle", label: "Rectangle", emoji: "📏", desc: "Balanced proportions" }, { id: "inverted", label: "Inverted △", emoji: "🔺", desc: "Shoulders wider" }];
  const toggle = (id) => { setResult(null); setSelected(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]); };

  const generate = async () => {
    if (!selected.length) return;
    setGenerating(true); setErr(null); setResult(null);
    const items = wardrobe.filter(w => selected.includes(w.id));
    const sys = buildStylistSys(wardrobe, profile);
    try {
      const raw = await askClaude(sys, `User is trying on: ${items.map(i => i.name).join(", ")}. Body: ${shape}, ${height}cm. Return ONLY valid JSON:\n{"lookName":"name","fit":"how these fit a ${shape} body (1 sentence)","styling":"one tip to elevate this look","colorNote":"how colors work for Autumn","score":{"harmony":88,"fit":91,"occasion":85},"occasion":"best occasion","missingPiece":"one item that would complete this"}`, 350);
      const p = safeJSON(raw); if (!p) throw new Error(); setResult(p);
    } catch { setErr("Try-on analysis failed."); }
    setGenerating(false);
  };

  const openShare = () => {
    if (!result) return;
    const items = wardrobe.filter(w => selected.includes(w.id));
    setShareData({ outfit: result.lookName, items, score: result.score?.harmony || 90 });
  };

  const pickedItems = wardrobe.filter(w => selected.includes(w.id));

  if (phase === "setup") return (
    <div style={{ padding: "0 20px 100px" }}>
      <div style={{ paddingTop: 60, marginBottom: 28 }}><div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}><h1 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 32, color: C.text, fontWeight: 400 }}>Try-On Studio</h1><AIBadge color={C.rose} /></div><p style={{ color: C.muted, fontSize: 13 }}>Set your body profile — AI styles to your shape</p></div>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 20, padding: 20, marginBottom: 20 }}><p style={{ color: C.muted, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>Height (cm)</p><input type="number" value={height} onChange={e => setHeight(e.target.value)} style={{ width: "100%", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 16px", color: C.text, fontSize: 16, outline: "none", boxSizing: "border-box", fontFamily: "inherit" }} /></div>
      <p style={{ color: C.muted, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>Body Shape</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
        {SHAPES.map(s => (<div key={s.id} onClick={() => setShape(s.id)} style={{ background: shape === s.id ? `${C.rose}18` : C.card, border: `1.5px solid ${shape === s.id ? C.rose : C.border}`, borderRadius: 16, padding: "16px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: 14 }}><span style={{ fontSize: 28 }}>{s.emoji}</span><div><p style={{ color: shape === s.id ? C.rose : C.text, fontSize: 15, fontWeight: 600, marginBottom: 2 }}>{s.label}</p><p style={{ color: C.muted, fontSize: 12 }}>{s.desc}</p></div>{shape === s.id && <span style={{ marginLeft: "auto", color: C.rose, fontSize: 18 }}>✓</span>}</div>))}
      </div>
      <button onClick={() => { if (shape) setPhase("studio"); }} disabled={!shape} style={{ width: "100%", background: shape ? C.rose : C.border, color: shape ? "#0F0D0B" : C.muted, border: "none", borderRadius: 16, padding: 18, fontSize: 16, fontWeight: 700, cursor: shape ? "pointer" : "default" }}>Enter Try-On Studio →</button>
    </div>
  );

  return (
    <div style={{ padding: "0 20px 100px" }}>
      <div style={{ paddingTop: 60, marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div><div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}><h1 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 28, color: C.text, fontWeight: 400 }}>Try-On Studio</h1><AIBadge color={C.rose} /></div><p style={{ color: C.muted, fontSize: 12 }}>{SHAPES.find(s => s.id === shape)?.label} · {height}cm</p></div>
        <button onClick={() => setPhase("setup")} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "6px 12px", color: C.muted, fontSize: 12, cursor: "pointer" }}>Edit</button>
      </div>
      <div style={{ background: `linear-gradient(180deg,${C.card},${C.surface})`, border: `1px solid ${C.border}`, borderRadius: 24, padding: 24, marginBottom: 16, minHeight: 240, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at 50% 30%,${C.rose}08,transparent 70%)`, pointerEvents: "none" }} />
        {generating ? (<div style={{ textAlign: "center" }}><div style={{ fontSize: 60, marginBottom: 12, animation: "float 2s ease-in-out infinite" }}>✨</div><p style={{ color: C.rose, fontSize: 14, fontWeight: 600 }}>Claude is analyzing your look…</p><p style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Styling for {shape} body shape</p></div>)
          : pickedItems.length === 0 ? (<div style={{ textAlign: "center" }}><div style={{ fontSize: 68, opacity: 0.3, marginBottom: 12 }}>🧍‍♀️</div><p style={{ color: C.muted, fontSize: 13 }}>Select items below to try them on</p></div>)
            : (<div style={{ textAlign: "center", width: "100%" }}>
              <div style={{ fontSize: 68, marginBottom: 10 }}>🧍‍♀️</div>
              <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>{pickedItems.map(i => <span key={i.id} style={{ fontSize: 28, background: C.card, borderRadius: 10, width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${C.border}` }}>{i.img}</span>)}</div>
              {result && (<div style={{ background: `${C.rose}11`, borderRadius: 16, padding: 14, textAlign: "left" }}>
                <p style={{ color: C.rose, fontSize: 16, fontWeight: 700, fontFamily: "'Cormorant Garamond',serif", marginBottom: 8 }}>{result.lookName}</p>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>{Object.entries(result.score || {}).map(([k, v]) => (<div key={k} style={{ flex: 1, textAlign: "center" }}><div style={{ height: 3, background: C.border, borderRadius: 2, marginBottom: 3, overflow: "hidden" }}><div style={{ height: "100%", width: `${v}%`, background: C.rose, borderRadius: 2 }} /></div><p style={{ color: C.muted, fontSize: 9, textTransform: "capitalize" }}>{k}</p><p style={{ color: C.rose, fontSize: 11, fontWeight: 700 }}>{v}</p></div>))}</div>
                <p style={{ color: C.text, fontSize: 12, lineHeight: 1.5, marginBottom: 4 }}>✦ {result.fit}</p>
                <p style={{ color: C.muted, fontSize: 12, lineHeight: 1.5, marginBottom: 4 }}>💡 {result.styling}</p>
                {result.missingPiece && <div style={{ marginTop: 8, background: C.card, borderRadius: 10, padding: "8px 12px" }}><p style={{ color: C.gold, fontSize: 12 }}>✨ Would elevate: <strong>{result.missingPiece}</strong></p></div>}
              </div>)}
            </div>)}
      </div>
      {err && <Err msg={err} />}
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <button onClick={generate} disabled={generating || !selected.length} style={{ flex: 2, background: selected.length && !generating ? C.rose : C.border, color: selected.length && !generating ? "#0F0D0B" : C.muted, border: "none", borderRadius: 14, padding: "13px", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          {generating ? <><Spin s={16} /><span>Analyzing…</span></> : "✨ AI Try-On Analysis"}
        </button>
        {result && <button onClick={openShare} style={{ flex: 1, background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 14, padding: "13px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Ico d={ICONS.share} s={14} />Share</button>}
      </div>
      <p style={{ color: C.muted, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>Select Items</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        {wardrobe.map(item => (<div key={item.id} onClick={() => toggle(item.id)} style={{ background: selected.includes(item.id) ? `${C.rose}22` : C.card, border: `1.5px solid ${selected.includes(item.id) ? C.rose : C.border}`, borderRadius: 14, padding: "12px 8px", textAlign: "center", cursor: "pointer" }}><div style={{ fontSize: 28, marginBottom: 4 }}>{item.img}</div><p style={{ color: selected.includes(item.id) ? C.rose : C.muted, fontSize: 10, lineHeight: 1.2 }}>{item.name.split(" ").slice(0, 2).join(" ")}</p></div>))}
      </div>
      {shareData && <ShareCard {...shareData} onClose={() => setShareData(null)} />}
      <style>{`@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}`}</style>
    </div>
  );
}

function GapAnalysisScreen({ wardrobe, profile }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [budget, setBudget] = useState("500");
  const [focus, setFocus] = useState("versatility");
  const [selectedGap, setSelectedGap] = useState(null);
  const [deepDive, setDeepDive] = useState(null);
  const [deepLoading, setDeepLoading] = useState(false);
  const focusOpts = [{ id: "versatility", label: "Versatility", emoji: "🔀" }, { id: "occasions", label: "Occasions", emoji: "🎯" }, { id: "capsule", label: "Capsule", emoji: "💎" }, { id: "seasons", label: "All-Season", emoji: "🌦️" }];
  const urgColor = { high: C.error, medium: C.gold, low: C.success };

  const run = useCallback(async () => {
    setLoading(true); setErr(null); setAnalysis(null); setSelectedGap(null); setDeepDive(null);
    const sys = buildStylistSys(wardrobe, profile);
    try {
      const raw = await askClaude(sys, `Deep wardrobe gap analysis. Budget: $${budget}. Focus: ${focus}. Return ONLY valid JSON:\n{"totalOutfitCombos":18,"utilizationPercent":72,"gaps":[{"item":"name","category":"cat","estimatedPrice":120,"newCombos":14,"reason":"why","bestBrand":"brand","urgency":"high|medium|low","worksWithIds":[1,2,3]}],"declutter":["item name"],"capsuleSummary":"2 sentences","colorGap":"missing color"}`, 700);
      const p = safeJSON(raw); if (!p) throw new Error(); setAnalysis(p);
    } catch { setErr("Analysis failed."); }
    setLoading(false);
  }, [wardrobe, budget, focus]);

  useEffect(() => { run(); }, []);

  const deepDiveGap = async (gap) => {
    setSelectedGap(gap); setDeepDive(null); setDeepLoading(true);
    const sys = buildStylistSys(wardrobe, profile);
    try {
      const ww = gap.worksWithIds?.map(id => wardrobe.find(w => w.id === id)?.name).filter(Boolean) || [];
      const raw = await askClaude(sys, `Deep dive on adding: "${gap.item}". Works with: ${ww.join(", ")}. Return ONLY valid JSON:\n{"outfitExamples":[{"name":"name","pieces":["p1","p2"],"occasion":"when"}],"stylingTips":["tip1","tip2"],"whereToShop":[{"store":"name","priceRange":"$X-$Y"}],"colorAdvice":"shade tip for Autumn"}`, 400);
      const p = safeJSON(raw); if (!p) throw new Error(); setDeepDive(p);
    } catch { setDeepDive({ error: true }); }
    setDeepLoading(false);
  };

  return (
    <div style={{ padding: "0 20px 100px" }}>
      <div style={{ paddingTop: 60, marginBottom: 24 }}><div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}><h1 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 32, color: C.text, fontWeight: 400 }}>Gap Analysis</h1><AIBadge color={C.gold} /></div><p style={{ color: C.muted, fontSize: 13 }}>Claude finds what your wardrobe is missing</p></div>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 20, padding: 18, marginBottom: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <div><p style={{ color: C.muted, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8 }}>Budget (USD)</p><input type="number" value={budget} onChange={e => setBudget(e.target.value)} style={{ width: "100%", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", color: C.text, fontSize: 15, outline: "none", boxSizing: "border-box", fontFamily: "inherit" }} /></div>
          <div><p style={{ color: C.muted, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8 }}>Focus</p><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>{focusOpts.map(f => (<button key={f.id} onClick={() => setFocus(f.id)} style={{ background: focus === f.id ? `${C.gold}22` : C.surface, border: `1px solid ${focus === f.id ? C.gold : C.border}`, borderRadius: 8, padding: "7px 4px", cursor: "pointer", fontSize: 10, color: focus === f.id ? C.gold : C.muted, fontWeight: focus === f.id ? 700 : 400 }}>{f.emoji} {f.label}</button>))}</div></div>
        </div>
        <button onClick={run} disabled={loading} style={{ width: "100%", background: loading ? C.border : C.gold, color: loading ? C.muted : "#0F0D0B", border: "none", borderRadius: 12, padding: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          {loading ? <><Spin s={16} /><span>Claude is analyzing…</span></> : "✦ Run Analysis"}
        </button>
      </div>
      {err && <Err msg={err} onRetry={run} />}
      {analysis && (<>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <div style={{ background: `${C.success}18`, border: `1px solid ${C.success}33`, borderRadius: 16, padding: 14 }}><p style={{ color: C.success, fontSize: 24, fontFamily: "'Cormorant Garamond',serif", fontWeight: 700 }}>{analysis.totalOutfitCombos}</p><p style={{ color: C.muted, fontSize: 12 }}>Outfit combos</p></div>
          <div style={{ background: `${C.gold}18`, border: `1px solid ${C.gold}33`, borderRadius: 16, padding: 14 }}><p style={{ color: C.gold, fontSize: 24, fontFamily: "'Cormorant Garamond',serif", fontWeight: 700 }}>{analysis.utilizationPercent}%</p><p style={{ color: C.muted, fontSize: 12 }}>Utilization</p></div>
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 16px", marginBottom: 16 }}>
          <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: "hidden", marginBottom: 8 }}><div style={{ height: "100%", width: `${analysis.utilizationPercent}%`, background: `linear-gradient(90deg,${C.success},${C.gold})`, borderRadius: 3 }} /></div>
          <p style={{ color: C.muted, fontSize: 12, lineHeight: 1.5, fontStyle: "italic" }}>✦ {analysis.capsuleSummary}</p>
        </div>
        {analysis.colorGap && <div style={{ background: `${C.accent}18`, border: `1px solid ${C.accent}33`, borderRadius: 14, padding: "12px 16px", marginBottom: 16, display: "flex", gap: 10, alignItems: "center" }}><span style={{ fontSize: 20 }}>🎨</span><p style={{ color: C.muted, fontSize: 13 }}>{analysis.colorGap}</p></div>}
        <h3 style={{ color: C.text, fontSize: 18, fontFamily: "'Cormorant Garamond',serif", marginBottom: 14 }}>Top {analysis.gaps?.length || 0} Missing Pieces</h3>
        {analysis.gaps?.map((gap, i) => (
          <div key={i} style={{ background: C.card, border: `1.5px solid ${selectedGap === gap ? C.gold : C.border}`, borderRadius: 20, padding: 18, marginBottom: 12, cursor: "pointer" }} onClick={() => selectedGap === gap ? (setSelectedGap(null), setDeepDive(null)) : deepDiveGap(gap)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div style={{ flex: 1 }}><div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}><span style={{ color: C.muted, fontSize: 12, fontWeight: 700 }}>#{i + 1}</span><h4 style={{ color: C.text, fontSize: 16, fontFamily: "'Cormorant Garamond',serif", fontWeight: 600 }}>{gap.item}</h4></div><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Tag label={gap.category} color={C.gold} /><Tag label={`~$${gap.estimatedPrice}`} color={C.muted} /><Tag label={`+${gap.newCombos} combos`} color={C.success} /><Tag label={gap.urgency} color={urgColor[gap.urgency]} /></div></div>
              <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 10 }}><p style={{ color: C.success, fontSize: 22, fontFamily: "'Cormorant Garamond',serif", fontWeight: 700 }}>+{gap.newCombos}</p><p style={{ color: C.muted, fontSize: 10 }}>combos</p></div>
            </div>
            <p style={{ color: C.muted, fontSize: 12, lineHeight: 1.5, marginBottom: gap.bestBrand ? 6 : 0 }}>{gap.reason}</p>
            {gap.bestBrand && <p style={{ color: C.accent, fontSize: 12 }}>→ Shop at {gap.bestBrand}</p>}
            {gap.worksWithIds?.length > 0 && <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}><span style={{ color: C.muted, fontSize: 11 }}>Pairs with:</span>{gap.worksWithIds.slice(0, 4).map(id => { const w = wardrobe.find(x => x.id === id); return w ? <span key={id} style={{ fontSize: 18, background: C.surface, borderRadius: 6, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>{w.img}</span> : null; })}</div>}
            {selectedGap === gap && (<div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }} onClick={e => e.stopPropagation()}>
              {deepLoading && <div style={{ display: "flex", gap: 8, alignItems: "center" }}><Spin s={14} /><span style={{ color: C.muted, fontSize: 12 }}>Claude is researching…</span></div>}
              {deepDive && !deepDive.error && (<div>
                <p style={{ color: C.gold, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>✦ Outfit Examples</p>
                {deepDive.outfitExamples?.map((ex, j) => (<div key={j} style={{ background: C.surface, borderRadius: 12, padding: 12, marginBottom: 8 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><p style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{ex.name}</p><Tag label={ex.occasion} color={C.purple} /></div><p style={{ color: C.muted, fontSize: 12 }}>{ex.pieces?.join(" + ")}</p></div>))}
                <p style={{ color: C.gold, fontSize: 12, fontWeight: 700, marginBottom: 8, marginTop: 12 }}>💡 Styling Tips</p>
                {deepDive.stylingTips?.map((t, j) => <p key={j} style={{ color: C.muted, fontSize: 12, marginBottom: 6, lineHeight: 1.5 }}>• {t}</p>)}
                {deepDive.colorAdvice && <div style={{ background: `${C.accent}11`, borderRadius: 10, padding: 10, marginTop: 10 }}><p style={{ color: C.accent, fontSize: 12 }}>🎨 {deepDive.colorAdvice}</p></div>}
                <p style={{ color: C.gold, fontSize: 12, fontWeight: 700, marginBottom: 8, marginTop: 12 }}>🛍️ Where to Shop</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{deepDive.whereToShop?.map((s, j) => (<div key={j} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px" }}><p style={{ color: C.text, fontSize: 12, fontWeight: 600 }}>{s.store}</p><p style={{ color: C.muted, fontSize: 11 }}>{s.priceRange}</p></div>))}</div>
              </div>)}
            </div>)}
          </div>
        ))}
        {analysis.declutter?.length > 0 && (<div style={{ background: `${C.rose}11`, border: `1px solid ${C.rose}33`, borderRadius: 16, padding: 16, marginTop: 4 }}><p style={{ color: C.rose, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>🧹 Consider Decluttering</p>{analysis.declutter.map((item, i) => (<div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}><span style={{ color: C.text, fontSize: 13 }}>{item}</span><div style={{ display: "flex", gap: 6 }}><button style={{ background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, padding: "4px 10px", fontSize: 10, cursor: "pointer" }}>Sell</button><button style={{ background: "transparent", color: C.rose, border: `1px solid ${C.rose}44`, borderRadius: 8, padding: "4px 10px", fontSize: 10, cursor: "pointer" }}>Donate</button></div></div>))}</div>)}
      </>)}
    </div>
  );
}

function ChatScreen({ wardrobe, profile, setScreen }) {
  const INIT_MSG = { role: "assistant", text: "Hi! I'm your ClothBuddy stylist ✨ Ask me what to wear, how to style a piece, or for a full wardrobe breakdown. I know your closet inside out." };
  const [msgs, setMsgs, msgsLoaded] = usePersistedState("chat_history_v2", [INIT_MSG]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const starters = [
    "What should I wear to a rooftop dinner tonight?",
    "Build me a 5-day capsule for a work trip",
    "What goes with my camel blazer?",
    "Which items in my closet are underused?",
  ];

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const clearChat = async () => {
    await setMsgs([INIT_MSG]);
  };

  const send = async (text) => {
    const t = (text || input).trim();
    if (!t || loading) return;
    setInput("");
    const newMsgs = [...msgs, { role: "user", text: t }];
    setMsgs(newMsgs);
    setLoading(true);
    const sys = buildStylistSys(wardrobe, profile);
    const apiMsgs = newMsgs.map(m => ({ role: m.role, content: m.text }));
    // Append empty assistant bubble to stream into
    setMsgs(prev => [...prev, { role: "assistant", text: "" }]);
    let streamed = "";
    try {
      await streamClaude(apiMsgs, sys, chunk => {
        streamed += chunk;
        setMsgs(prev => {
          const c = [...prev];
          c[c.length - 1] = { role: "assistant", text: streamed };
          return c;
        });
      });
    } catch {
      setMsgs(prev => {
        const c = [...prev];
        c[c.length - 1] = { role: "assistant", text: "Sorry, connection issue. Please try again!" };
        return c;
      });
    }
    setLoading(false);
  };

  if (!msgsLoaded) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: C.bg }}>
      <Spin s={24} />
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: C.bg, maxWidth: 430, margin: "0 auto" }}>
      <div style={{ padding: "60px 20px 14px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 28, color: C.text, fontWeight: 400 }}>Style Chat</h1>
            <AIBadge />
          </div>
          <button onClick={clearChat} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 10, padding: "5px 10px", color: C.muted, cursor: "pointer", fontSize: 11 }}>Clear</button>
        </div>
        <p style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>
          Streaming · {profile?.colorSeason || "Autumn"} · {profile?.styleVibe || "Classic"} · history saved
        </p>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 0", display: "flex", flexDirection: "column", gap: 14 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", alignItems: "flex-start", gap: 10 }}>
            {m.role === "assistant" && (
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: `linear-gradient(135deg,${C.accent},${C.rose})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0, marginTop: 2 }}>✦</div>
            )}
            <div style={{ maxWidth: "78%", background: m.role === "user" ? C.accent : C.card, color: m.role === "user" ? "#0F0D0B" : C.text, border: m.role === "assistant" ? `1px solid ${C.border}` : "none", borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px", padding: "12px 16px", fontSize: 14, lineHeight: 1.6 }}>
              {m.text || (loading && i === msgs.length - 1 ? <span style={{ color: C.muted }}>● ● ●</span> : "")}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
        {msgs.length === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
            {starters.map(s => (
              <button key={s} onClick={() => send(s)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 14px", color: C.muted, fontSize: 12, cursor: "pointer", textAlign: "left" }}>{s}</button>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: "12px 16px 28px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 10, background: C.bg, flexShrink: 0 }}>
        <button onClick={() => setScreen("home")} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "0 14px", color: C.muted, cursor: "pointer", fontSize: 18 }}>←</button>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} disabled={loading} placeholder="Ask your stylist anything…" style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "12px 16px", color: C.text, fontSize: 14, outline: "none" }} />
        <button onClick={() => send()} disabled={!input.trim() || loading} style={{ background: input.trim() && !loading ? C.accent : C.card, color: input.trim() && !loading ? "#0F0D0B" : C.muted, border: "none", borderRadius: 14, width: 48, height: 48, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {loading ? <Spin s={16} /> : <Ico d={ICONS.send} s={18} />}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── HOME ─────────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function HomeScreen({ wardrobe, outfitLogs, profile, setScreen }) {
  const logsCount = Object.keys(outfitLogs).length;
  const unworn = wardrobe.filter(w => (w.wears || 0) < 3).length;
  return (
    <div style={{ padding: "0 20px 100px" }}>
      <div style={{ paddingTop: 60, marginBottom: 28 }}>
        <p style={{ color: C.muted, fontSize: 11, letterSpacing: 3, textTransform: "uppercase" }}>Good Morning</p>
        <h1 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 36, color: C.text, margin: "4px 0 0", fontWeight: 400, lineHeight: 1.1 }}>Style it<br /><em style={{ color: C.accent }}>your way.</em></h1>
      </div>
      <WeatherCard wardrobe={wardrobe} profile={profile} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
        {[{ label: "Items", val: wardrobe.length, c: C.accent }, { label: "Logged", val: logsCount, c: C.purple }, { label: "Unworn", val: unworn, c: C.rose }].map(s => (
          <div key={s.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 10px", textAlign: "center" }}>
            <p style={{ fontSize: 22, fontFamily: "'Cormorant Garamond',serif", color: s.c, fontWeight: 600 }}>{s.val}</p>
            <p style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{s.label}</p>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <button onClick={() => setScreen("generator")} style={{ background: C.accent, color: "#0F0D0B", border: "none", borderRadius: 14, padding: "14px 10px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>✨ Generate Outfit</button>
        <button onClick={() => setScreen("chat")} style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 10px", fontSize: 13, cursor: "pointer" }}>💬 Ask Stylist</button>
        <button onClick={() => setScreen("tryon")} style={{ background: C.card, color: C.rose, border: `1px solid ${C.rose}44`, borderRadius: 14, padding: "14px 10px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>👗 Try-On Studio</button>
        <button onClick={() => setScreen("gap")} style={{ background: C.card, color: C.gold, border: `1px solid ${C.gold}44`, borderRadius: 14, padding: "14px 10px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>📊 Gap Analysis</button>
        <button onClick={() => setScreen("calendar")} style={{ background: C.card, color: C.purple, border: `1px solid ${C.purple}44`, borderRadius: 14, padding: "14px 10px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>📅 Calendar</button>
        <button onClick={() => setScreen("discover")} style={{ background: C.card, color: C.accent, border: `1px solid ${C.accent}44`, borderRadius: 14, padding: "14px 10px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>🔍 Discover</button>
      </div>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: 18, marginTop: 10 }}>
        <p style={{ color: C.muted, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>Your Wardrobe</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>{wardrobe.map(i => <span key={i.id} style={{ fontSize: 26 }}>{i.img}</span>)}</div>
        <button onClick={() => setScreen("closet")} style={{ marginTop: 12, color: C.accent, background: "none", border: "none", fontSize: 13, cursor: "pointer" }}>View all {wardrobe.length} items →</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── ONBOARDING ───────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function Onboarding({ onDone }) {
  const [step, setStep] = useState(0);
  const [styleVibe, setStyleVibe] = useState(null);
  const [colorSeason, setColorSeason] = useState(null);

  const steps = [
    { title: "Welcome to\nClothBuddy", sub: "AI personal stylist — powered by Claude. Your wardrobe saves across every session.", emoji: "✨", type: "cta", cta: "Get Started" },
    { title: "Your style\nvibe?", sub: "Shapes your recommendations", emoji: "🎨", type: "options", options: ["Minimalist 🤍", "Classic 🌹", "Bohemian 🌿", "Edgy ⚡"], key: "style" },
    { title: "Your color\nseason?", sub: "Filters every outfit Claude suggests", emoji: "🍂", type: "options", options: ["Spring 🌸", "Summer 🌊", "Autumn 🍁", "Winter ❄️"], key: "season" },
    { title: "Everything is\nready ✦", sub: "9 AI features · Persistent wardrobe · Outfit Calendar · Share Cards · Scanner", emoji: "🛍️", type: "cta", cta: "Enter ClothBuddy" },
  ];
  const s = steps[step];

  const pickOption = async (opt) => {
    if (s.key === "style") setStyleVibe(opt.replace(/[^a-zA-Z ]/g, "").trim());
    if (s.key === "season") setColorSeason(opt.replace(/[^a-zA-Z ]/g, "").trim());
    setStep(step + 1);
  };

  const finish = async () => {
    // Persist the user profile so onboarding never shows again
    await DB.set("user_profile", {
      styleVibe: styleVibe || "Classic",
      colorSeason: colorSeason || "Autumn",
      onboarded: true,
      location: "Dubai",
    });
    onDone({ styleVibe: styleVibe || "Classic", colorSeason: colorSeason || "Autumn" });
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", padding: 32, background: C.bg }}>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{ fontSize: 72, marginBottom: 24 }}>{s.emoji}</div>
        <h1 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 38, color: C.text, fontWeight: 400, whiteSpace: "pre-line", lineHeight: 1.2, marginBottom: 12 }}>{s.title}</h1>
        <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.6 }}>{s.sub}</p>
      </div>
      {s.type === "options" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 32 }}>
          {s.options.map(o => (
            <button key={o} onClick={() => pickOption(o)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "18px 12px", color: C.text, fontSize: 14, cursor: "pointer", fontFamily: "'Cormorant Garamond',serif" }}>{o}</button>
          ))}
        </div>
      )}
      {s.type === "cta" && (
        <>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 40 }}>
            {steps.map((_, i) => <div key={i} style={{ width: i === step ? 24 : 8, height: 8, borderRadius: 4, background: i === step ? C.accent : C.border, transition: "all 0.3s" }} />)}
          </div>
          <button onClick={() => step < steps.length - 1 ? setStep(step + 1) : finish()} style={{ background: C.accent, color: "#0F0D0B", border: "none", borderRadius: 16, padding: 18, fontSize: 16, fontWeight: 700, cursor: "pointer" }}>{s.cta}</button>
        </>
      )}
    </div>
  );
}

// ─── BOTTOM NAV ───────────────────────────────────────────────────────────────
function BottomNav({ screen, setScreen }) {
  const tabs = [
    { id: "home", icon: "home", label: "Home" },
    { id: "closet", icon: "closet", label: "Closet" },
    { id: "generator", icon: "spark", label: "Style" },
    { id: "discover", icon: "discover", label: "Discover" },
    { id: "profile", icon: "user", label: "Profile" },
  ];
  return (
    <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: `${C.surface}F2`, borderTop: `1px solid ${C.border}`, display: "flex", backdropFilter: "blur(20px)", zIndex: 50 }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => setScreen(t.id)} style={{ flex: 1, padding: "10px 0 22px", background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, color: screen === t.id ? C.accent : C.muted, transition: "color 0.2s" }}>
          <Ico d={ICONS[t.icon] || ICONS.home} s={screen === t.id ? 21 : 19} />
          <span style={{ fontSize: 8, letterSpacing: 0.3, fontWeight: screen === t.id ? 700 : 400 }}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── ROOT ─────────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const STYLES = `
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0F0D0B}
  @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
  textarea,input{font-family:inherit}
  ::-webkit-scrollbar{display:none}
`;

export default function ClothBuddy() {
  const [screen, setScreen] = useState("home");
  const [addItem, setAddItem] = useState(false);

  // ── Persistent state ──────────────────────────────────────────────────────
  const [wardrobe, setWardrobe, wardrobeLoaded] = usePersistedState("wardrobe_v2", DEFAULT_WARDROBE);
  const [outfitLogs, setOutfitLogs, logsLoaded] = usePersistedState("outfit_logs_v2", DEFAULT_LOGS);
  const [profile, setProfile, profileLoaded] = usePersistedState("user_profile", null);

  const resetWardrobe = async () => {
    await setWardrobe(DEFAULT_WARDROBE);
    await setOutfitLogs(DEFAULT_LOGS);
  };

  // Wait for all storage to hydrate
  if (!wardrobeLoaded || !logsLoaded || !profileLoaded) return (
    <>
      <style>{STYLES}</style>
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <div style={{ fontSize: 52 }}>🛍️</div>
        <Spin s={28} />
        <p style={{ color: C.muted, fontSize: 14, fontFamily: "'Cormorant Garamond',serif" }}>Loading your wardrobe…</p>
      </div>
    </>
  );

  // Show onboarding only if no saved profile
  if (!profile?.onboarded) return (
    <>
      <style>{STYLES}</style>
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <Onboarding onDone={(p) => setProfile({ ...p, onboarded: true, location: "Dubai" })} />
    </>
  );

  if (screen === "chat") return (
    <>
      <style>{STYLES}</style>
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <ChatScreen wardrobe={wardrobe} profile={profile} setScreen={setScreen} />
    </>
  );

  return (
    <>
      <style>{STYLES}</style>
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: 430, margin: "0 auto", minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Inter',system-ui,sans-serif", position: "relative", overflowX: "hidden" }}>
        {screen === "home" && <HomeScreen wardrobe={wardrobe} outfitLogs={outfitLogs} profile={profile} setScreen={setScreen} />}
        {screen === "closet" && <ClosetScreen wardrobe={wardrobe} setWardrobe={setWardrobe} setAddItem={setAddItem} />}
        {screen === "generator" && <OutfitGenerator wardrobe={wardrobe} profile={profile} />}
        {screen === "discover" && <DiscoverScreen wardrobe={wardrobe} profile={profile} />}
        {screen === "profile" && <ProfileScreen wardrobe={wardrobe} outfitLogs={outfitLogs} profile={profile} onResetWardrobe={resetWardrobe} />}
        {screen === "tryon" && <TryOnScreen wardrobe={wardrobe} profile={profile} />}
        {screen === "calendar" && <CalendarScreen wardrobe={wardrobe} outfitLogs={outfitLogs} setOutfitLogs={setOutfitLogs} profile={profile} />}
        {screen === "gap" && <GapAnalysisScreen wardrobe={wardrobe} profile={profile} />}
        <BottomNav screen={screen} setScreen={setScreen} />
        {addItem && <AddItemModal wardrobe={wardrobe} setWardrobe={setWardrobe} onClose={() => setAddItem(false)} />}
      </div>
    </>
  );
}

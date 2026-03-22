import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { registerSW } from "virtual:pwa-register";

// ── PWA Service Worker Registration ──────────────────────────────────────────
// Auto-updates the SW and shows a refresh prompt to the user
const updateSW = registerSW({
  onNeedRefresh() {
    // Show a non-blocking update banner
    const banner = document.createElement("div");
    banner.id = "pwa-update-banner";
    banner.innerHTML = `
      <div style="
        position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
        background:#C9956A; color:#0F0D0B; border-radius:20px;
        padding:12px 20px; font-size:13px; font-weight:700;
        display:flex; align-items:center; gap:12px;
        box-shadow:0 4px 24px rgba(0,0,0,0.4); z-index:9999;
        font-family:Inter,system-ui,sans-serif; white-space:nowrap;
        animation: slideUp 0.3s ease;
      ">
        ✨ ClothBuddy just got better!
        <button id="pwa-update-btn" style="
          background:#0F0D0B; color:#C9956A; border:none;
          border-radius:12px; padding:6px 14px; font-size:12px;
          font-weight:700; cursor:pointer;
        ">Update</button>
        <button id="pwa-dismiss-btn" style="
          background:none; border:none; color:#0F0D0B;
          font-size:18px; cursor:pointer; line-height:1;
        ">×</button>
      </div>
      <style>@keyframes slideUp{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}</style>
    `;
    document.body.appendChild(banner);
    document.getElementById("pwa-update-btn").onclick = () => { updateSW(true); banner.remove(); };
    document.getElementById("pwa-dismiss-btn").onclick = () => banner.remove();
  },
  onOfflineReady() {
    console.log("ClothBuddy is ready to work offline");
  },
  immediate: true,
});

// ── Override window.storage for persistent state ──────────────────────────────
// In the real PWA, window.storage maps to localStorage
// (In the Claude artifact environment it was provided by the platform)
if (!window.storage) {
  window.storage = {
    get: async (key) => {
      try {
        const val = localStorage.getItem(`clothbuddy:${key}`);
        return val ? { key, value: val } : null;
      } catch { return null; }
    },
    set: async (key, value) => {
      try {
        localStorage.setItem(`clothbuddy:${key}`, value);
        return { key, value };
      } catch { return null; }
    },
    delete: async (key) => {
      try {
        localStorage.removeItem(`clothbuddy:${key}`);
        return { key, deleted: true };
      } catch { return null; }
    },
    list: async (prefix) => {
      try {
        const keys = Object.keys(localStorage)
          .filter(k => k.startsWith(`clothbuddy:${prefix || ""}`))
          .map(k => k.replace("clothbuddy:", ""));
        return { keys };
      } catch { return { keys: [] }; }
    },
  };
}

// ── Mount the App ─────────────────────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

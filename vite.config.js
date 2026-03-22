import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png", "icons/*.png"],
      manifest: {
        name: "ClothBuddy — AI Stylist",
        short_name: "ClothBuddy",
        description: "Your AI personal stylist and digital wardrobe",
        theme_color: "#0F0D0B",
        background_color: "#0F0D0B",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          { src: "/icons/icon-72.png",   sizes: "72x72",   type: "image/png" },
          { src: "/icons/icon-96.png",   sizes: "96x96",   type: "image/png" },
          { src: "/icons/icon-128.png",  sizes: "128x128", type: "image/png" },
          { src: "/icons/icon-144.png",  sizes: "144x144", type: "image/png" },
          { src: "/icons/icon-152.png",  sizes: "152x152", type: "image/png" },
          { src: "/icons/icon-192.png",  sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: "/icons/icon-384.png",  sizes: "384x384", type: "image/png" },
          { src: "/icons/icon-512.png",  sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
        screenshots: [
          {
            src: "/screenshots/mobile.png",
            sizes: "390x844",
            type: "image/png",
            form_factor: "narrow",
            label: "ClothBuddy Home Screen"
          }
        ],
        categories: ["lifestyle", "fashion", "shopping"],
        shortcuts: [
          {
            name: "Log Today's Outfit",
            url: "/?screen=calendar",
            icons: [{ src: "/icons/icon-96.png", sizes: "96x96" }]
          },
          {
            name: "Generate Outfit",
            url: "/?screen=generator",
            icons: [{ src: "/icons/icon-96.png", sizes: "96x96" }]
          }
        ]
      },
      workbox: {
        // Cache strategies
        runtimeCaching: [
          {
            // Google Fonts — cache first
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Anthropic API calls — network only (never cache AI responses)
            urlPattern: /^https:\/\/api\.anthropic\.com\/.*/i,
            handler: "NetworkOnly",
          },
          {
            // Our own backend proxy — network first, fall back to cache
            urlPattern: /\/api\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 },
              networkTimeoutSeconds: 10,
            },
          },
          {
            // Static assets — stale while revalidate
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "images",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
        // Pre-cache all Vite build assets
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
      },
      devOptions: {
        enabled: true, // Enable PWA in dev mode for testing
        type: "module",
      },
    }),
  ],
  server: {
    port: 5173,
    // Proxy API calls to the backend in development
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split large chunks for better caching
        manualChunks: {
          react: ["react", "react-dom"],
        },
      },
    },
  },
});

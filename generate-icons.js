/**
 * Icon Generator for ClothBuddy PWA
 *
 * Run: node generate-icons.js
 * Requires: npm install sharp
 *
 * Generates all required PWA icon sizes from favicon.svg
 */

import { createCanvas } from "canvas";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// Icon sizes required for full PWA compliance
const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

// We'll create simple canvas-based icons since we can't run sharp here
// In production, replace with: sharp("public/favicon.svg").resize(size).toFile(...)

function generateIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#0F0D0B";
  const radius = size * 0.234;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(size - radius, 0);
  ctx.arcTo(size, 0, size, radius, radius);
  ctx.lineTo(size, size - radius);
  ctx.arcTo(size, size, size - radius, size, radius);
  ctx.lineTo(radius, size);
  ctx.arcTo(0, size, 0, size - radius, radius);
  ctx.lineTo(0, radius);
  ctx.arcTo(0, 0, radius, 0, radius);
  ctx.closePath();
  ctx.fill();

  // Hanger
  const cx = size / 2;
  const scale = size / 512;

  ctx.strokeStyle = "#C9956A";
  ctx.lineWidth = 22 * scale;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(cx, 140 * scale);
  ctx.lineTo(cx, 172 * scale);
  ctx.bezierCurveTo(200 * scale, 172 * scale, 120 * scale, 220 * scale, 100 * scale, 280 * scale);
  ctx.bezierCurveTo(90 * scale, 310 * scale, 110 * scale, 330 * scale, 130 * scale, 330 * scale);
  ctx.lineTo(382 * scale, 330 * scale);
  ctx.bezierCurveTo(402 * scale, 330 * scale, 422 * scale, 310 * scale, 412 * scale, 280 * scale);
  ctx.bezierCurveTo(392 * scale, 220 * scale, 312 * scale, 172 * scale, cx, 172 * scale);
  ctx.stroke();

  // Hook
  ctx.beginPath();
  ctx.moveTo(cx, 140 * scale);
  ctx.bezierCurveTo(cx, 120 * scale, 270 * scale, 108 * scale, 284 * scale, 112 * scale);
  ctx.bezierCurveTo(298 * scale, 116 * scale, 304 * scale, 130 * scale, 296 * scale, 142 * scale);
  ctx.stroke();

  // Gold dot
  ctx.fillStyle = "#D4AF6E";
  ctx.beginPath();
  ctx.arc(370 * scale, 190 * scale, 8 * scale, 0, Math.PI * 2);
  ctx.fill();

  return canvas.toBuffer("image/png");
}

const iconsDir = join("public", "icons");
mkdirSync(iconsDir, { recursive: true });

for (const size of SIZES) {
  try {
    const buf = generateIcon(size);
    writeFileSync(join(iconsDir, `icon-${size}.png`), buf);
    console.log(`✓ Generated icon-${size}.png`);
  } catch (err) {
    console.log(`⚠ Skipped icon-${size}.png (run: npm install canvas)`);
  }
}

console.log("\nDone! Icons saved to public/icons/");
console.log("For production, use a design tool to create polished icons.");

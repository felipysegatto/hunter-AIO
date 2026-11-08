'use strict';

// Where the character actually stands inside the Armory render (a 1600×1200 PNG with lots of empty space).
// A gnome fills a third of the picture's height, a tauren two thirds: knowing the box lets the app
// zoom every race to the same size in the summoning circle.
const { net, nativeImage } = require('electron');

const cache = new Map();

/** Bounding box of the opaque pixels, as fractions of the picture (null when there is nothing) */
function boxOf(img) {
  const { width: w, height: h } = img.getSize();
  if (!w || !h) return null;
  const px = img.toBitmap(); // 4 bytes per pixel, alpha last
  let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
  for (let y = 0; y < h; y += 2) {
    const row = y * w * 4;
    for (let x = 0; x < w; x += 2) {
      if (px[row + x * 4 + 3] > 40) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 <= x0 || y1 <= y0) return null;
  const r = (n) => Math.round(n * 1000) / 1000;
  return { x0: r(x0 / w), y0: r(y0 / h), x1: r(x1 / w), y1: r(y1 / h), ratio: r(w / h) };
}

async function measure(url) {
  if (!url || !/^https:\/\/render\.worldofwarcraft\.com\//.test(url)) return null;
  if (cache.has(url)) return cache.get(url);
  let box = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await net.fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
    if (res.ok) {
      box = boxOf(nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer())));
    }
  } catch { box = null; }
  if (box) cache.set(url, box); // a failed download is tried again on the next reading
  return box;
}

/** Adds media.box (and media.fallbackBox) to the Armory media, in place. Never throws. */
async function annotate(media) {
  if (!media) return media;
  const [main, fallback] = await Promise.all([measure(media.main), measure(media.fallback)]);
  if (main) media.box = main;
  if (fallback) media.fallbackBox = fallback;
  return media;
}

module.exports = { measure, annotate, boxOf };

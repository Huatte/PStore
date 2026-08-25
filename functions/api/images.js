import { readJson, json } from '../_lib/github.js';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);

  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  );

  let images = await readJson(env, 'data/images.json', []);
  if (!Array.isArray(images)) images = [];

  // Single-image lookup by key (used by detail page)
  const key = url.searchParams.get('key');
  if (key) {
    const found = images.find((i) => i.key === key);
    return json({ image: found || null });
  }

  images.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

  if (q) {
    images = images.filter((img) => (img.name || '').toLowerCase().includes(q));
  }

  const total = images.length;
  const page = images.slice(offset, offset + limit);

  return json({ images: page, total, offset, limit });
}
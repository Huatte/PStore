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

  // Lookup all images in a group (used by detail page for grouped uploads)
  const group = url.searchParams.get('group');
  if (group) {
    const list = images.filter((i) => i.group === group).sort((a, b) => b.addedAt - a.addedAt);
    return json({ images: list, total: list.length });
  }

  // Browse/list mode.
  // Default (dedup=1): collapse each group into ONE representative card (homepage).
  // dedup=0: return every image individually (admin manage page needs all).
  const dedup = (url.searchParams.get('dedup') || '1') !== '0';

  let working = images;
  if (dedup) {
    const byGroup = new Map();
    const standalone = [];
    for (const img of images) {
      if (img.group) {
        const cur = byGroup.get(img.group);
        if (!cur || (img.addedAt || 0) > (cur.addedAt || 0)) byGroup.set(img.group, img);
      } else {
        standalone.push(img);
      }
    }
    working = [...byGroup.values(), ...standalone];
  }

  working.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

  if (q) {
    const filtered = working.filter((img) => (img.name || '').toLowerCase().includes(q));
    return json({ images: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit });
  }

  const total = working.length;
  const page = working.slice(offset, offset + limit);

  return json({ images: page, total, offset, limit });
}
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

  // Browse/list mode: collapse each group into ONE representative card.
  // Non-grouped images stay as-is. This keeps the list small even when a
  // group has hundreds of members, so pagination is efficient.
  const byGroup = new Map();
  const standalone = [];
  for (const img of images) {
    if (img.group) {
      const cur = byGroup.get(img.group);
      // keep the newest member of the group as its representative
      if (!cur || (img.addedAt || 0) > (cur.addedAt || 0)) byGroup.set(img.group, img);
    } else {
      standalone.push(img);
    }
  }
  const deduped = [...byGroup.values(), ...standalone];

  deduped.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

  if (q) {
    return json({
      images: deduped.filter((img) => (img.name || '').toLowerCase().includes(q)),
      total: deduped.filter((img) => (img.name || '').toLowerCase().includes(q)).length,
      offset,
      limit,
    });
  }

  const total = deduped.length;
  const page = deduped.slice(offset, offset + limit);

  return json({ images: page, total, offset, limit });
}
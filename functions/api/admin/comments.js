import { readJson, json } from '../../_lib/github.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function onRequestGet(context) {
  const { env, request } = context;

  if (!env.ADMIN_TOKEN || request.headers.get('x-admin-token') !== env.ADMIN_TOKEN) {
    return json({ error: 'unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  );

  const comments = await readJson(env, 'data/comments.json', {});
  const flattened = [];
  for (const img of Object.keys(comments || {})) {
    for (const c of comments[img]) {
      flattened.push({ ...c, image: img });
    }
  }
  flattened.sort((a, b) => b.createdAt - a.createdAt);

  // Search by comment ID or content (or image key), case-insensitive
  const filtered = q
    ? flattened.filter((c) => {
        const haystack = `${c.id} ${c.text} ${c.author} ${c.image}`.toLowerCase();
        return haystack.includes(q);
      })
    : flattened;

  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);
  return json({ comments: page, total, offset, limit });
}
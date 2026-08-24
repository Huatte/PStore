import { gh, readJson, json } from '../../_lib/github.js';

export async function onRequestGet(context) {
  const { env, request } = context;

  if (!env.ADMIN_TOKEN || request.headers.get('x-admin-token') !== env.ADMIN_TOKEN) {
    return json({ error: 'unauthorized' }, 401);
  }

  // Read admin password to expose pending moderation data
  const url = new URL(request.url);
  const image = url.searchParams.get('image') || '';

  const comments = await readJson(env, 'data/comments.json', {});
  if (image) {
    const list = (comments[image] || []).sort((a, b) => b.createdAt - a.createdAt);
    return json({ count: list.length, comments: list });
  }

  // Flatten all
  const flattened = [];
  for (const img of Object.keys(comments)) {
    for (const c of comments[img]) {
      flattened.push({ ...c, image: img });
    }
  }
  flattened.sort((a, b) => b.createdAt - a.createdAt);
  return json({ count: flattened.length, comments: flattened });
}

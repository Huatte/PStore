import { gh, readJson, writeJson, json } from '../_lib/github.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const image = url.searchParams.get('image') || '';

  const comments = await readJson(env, 'data/comments.json', {});
  const list = (comments[image] || []).filter((c) => c.status === 'approved');
  list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return json({ comments: list });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'invalid body' }, 400);
  }

  const image = String(body.image || '').trim();
  const author = String(body.author || '').trim().slice(0, 40);
  const text = String(body.text || '').trim().slice(0, 500);

  if (!image || !image.match(/^[a-f0-9]+\.[a-z0-9]+$/)) {
    return json({ error: 'invalid image' }, 400);
  }
  if (!author) return json({ error: 'name required' }, 400);
  if (!text) return json({ error: 'message required' }, 400);

  const comments = await readJson(env, 'data/comments.json', {});
  const list = comments[image] || [];
  list.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    author,
    text,
    status: 'pending',
    createdAt: Date.now(),
  });
  comments[image] = list;

  let sha = null;
  try {
    const meta = await gh(env).getContents('data/comments.json');
    if (meta && meta.sha) sha = meta.sha;
  } catch (_) {}

  await writeJson(env, 'data/comments.json', comments, `new comment submitted (pending)`, sha);
  return json({ ok: true, message: 'submitted for review' });
}

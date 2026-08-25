import { gh, readJson, writeJson, json, withLock } from '../_lib/github.js';

function pad(n) { return String(n).padStart(2, '0'); }

// Generate comment ID: 0d00 + YYYYMMDDHHmmss + 4 random letters
// e.g. 0d00202608251933axkt
export function makeCommentId(now = new Date()) {
  const ts =
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds());
  let suffix = '';
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  for (let i = 0; i < 4; i++) suffix += letters[Math.floor(Math.random() * 26)];
  return `0d00${ts}${suffix}`;
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const image = url.searchParams.get('image') || '';

  const comments = await readJson(env, 'data/comments.json', {});
  // Only show visible comments to the public
  const list = (comments[image] || []).filter((c) => c.status !== 'hidden' && c.status !== 'deleted');
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

  await withLock('comments', async () => {
    const comments = await readJson(env, 'data/comments.json', {});
    const list = comments[image] || [];
    const createdAt = Date.now();
    list.push({
      id: makeCommentId(new Date(createdAt)),
      author,
      text,
      status: 'visible', // comments show immediately by default
      createdAt,
    });
    comments[image] = list;

    let sha = null;
    try {
      const meta = await gh(env).getContents('data/comments.json');
      if (meta && meta.sha) sha = meta.sha;
    } catch (_) {}

    await writeJson(env, 'data/comments.json', comments, `new comment ${createdAt}`, sha);
  });
  return json({ ok: true, message: 'posted' });
}
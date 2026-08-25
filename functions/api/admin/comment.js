import { gh, readJson, writeJson, json, withLock } from '../../_lib/github.js';

export async function onRequestPost(context) {
  const { env, request } = context;

  if (!env.ADMIN_TOKEN || request.headers.get('x-admin-token') !== env.ADMIN_TOKEN) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'invalid body' }, 400);
  }

  const image = String(body.image || '');
  const id = String(body.id || '');
  const action = body.action; // 'delete' | 'hide' | 'show'
  if (!image || !id || !['delete', 'hide', 'show'].includes(action)) {
    return json({ error: 'invalid request' }, 400);
  }

  return await withLock('comments', async () => {
    const comments = await readJson(env, 'data/comments.json', {});
    const list = comments[image] || [];
    const target = list.find((c) => c.id === id);
    if (!target) return json({ error: 'comment not found' }, 404);

    if (action === 'delete') {
      // Permanently remove the comment from storage (no soft-delete residue)
      const remaining = list.filter((c) => c.id !== id);
      if (remaining.length === 0) {
        delete comments[image];
      } else {
        comments[image] = remaining;
      }
    } else if (action === 'hide') {
      target.status = 'hidden';
      comments[image] = list;
    } else if (action === 'show') {
      target.status = 'visible';
      comments[image] = list;
    }

    let sha = null;
    try {
      const meta = await gh(env).getContents('data/comments.json');
      if (meta && meta.sha) sha = meta.sha;
    } catch (_) {}

    await writeJson(env, 'data/comments.json', comments, `comment ${action}: ${id}`, sha);
    return json({ ok: true });
  });
}
import { gh, readJson, writeJson, json } from '../../_lib/github.js';

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

  const key = String(body.key || '').trim();
  const newName = String(body.name || '').trim().slice(0, 200);
  if (!key || !newName) {
    return json({ error: 'invalid request' }, 400);
  }

  const g = gh(env);
  const images = await readJson(env, 'data/images.json', []);
  const target = (images || []).find((i) => i.key === key);
  if (!target) return json({ error: 'image not found' }, 404);

  target.name = newName;

  let sha = null;
  try {
    const m = await g.getContents('data/images.json');
    if (m && m.sha) sha = m.sha;
  } catch (_) {}
  await writeJson(env, 'data/images.json', images, `rename image ${key}`, sha);

  return json({ ok: true });
}
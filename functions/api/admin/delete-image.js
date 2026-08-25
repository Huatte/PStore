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
  if (!key) return json({ error: 'invalid request' }, 400);

  const g = gh(env);
  const imagePath = `images/${key}`;

  // Delete the file from GitHub
  const meta = await g.getContents(imagePath).catch(() => null);
  if (meta && meta.sha) {
    await g.deleteFile(imagePath, `delete image ${key}`, meta.sha);
  }

  // Remove from images.json index
  const images = await readJson(env, 'data/images.json', []);
  const remaining = (Array.isArray(images) ? images : []).filter((i) => i.key !== key);

  let sha = null;
  try {
    const m = await g.getContents('data/images.json');
    if (m && m.sha) sha = m.sha;
  } catch (_) {}
  await writeJson(env, 'data/images.json', remaining, `remove image index (${key})`, sha);

  return json({ ok: true });
}
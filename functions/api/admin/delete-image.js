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

  const key = String(body.key || '').trim();
  if (!key) return json({ error: 'invalid request' }, 400);

  const g = gh(env);

  // Delete the file from GitHub — check both possible locations
  // (approved images may live in pending_images/ without being moved)
  for (const dir of ['images', 'pending_images']) {
    const path = `${dir}/${key}`;
    const meta = await g.getContents(path).catch(() => null);
    if (meta && meta.sha) {
      await g.deleteFile(path, `delete image ${key}`, meta.sha);
    }
  }

  // Remove from images.json index AND pending_images.json (under lock)
  await withLock('index:images', async () => {
    const images = await readJson(env, 'data/images.json', []);
    const remaining = (Array.isArray(images) ? images : []).filter((i) => i.key !== key);
    let sha = null;
    try {
      const m = await g.getContents('data/images.json');
      if (m && m.sha) sha = m.sha;
    } catch (_) {}
    await writeJson(env, 'data/images.json', remaining, `remove image index (${key})`, sha);

    const pendings = await readJson(env, 'data/pending_images.json', []);
    const pRemaining = (Array.isArray(pendings) ? pendings : []).filter((p) => p.key !== key);
    let psha = null;
    try {
      const m2 = await g.getContents('data/pending_images.json');
      if (m2 && m2.sha) psha = m2.sha;
    } catch (_) {}
    await writeJson(env, 'data/pending_images.json', pRemaining, `remove pending index (${key})`, psha);
  });

  return json({ ok: true });
}
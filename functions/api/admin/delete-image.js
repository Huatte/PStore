import { gh, readJson, writeJson, json, withLock } from '../../_lib/github.js';

// Support both single key and batch keys for speed (same as image review).
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

  const rawKeys = Array.isArray(body.keys) ? body.keys : (body.key ? [body.key] : []);
  const keys = rawKeys.map((k) => String(k).trim()).filter(Boolean);
  if (keys.length === 0) return json({ error: 'invalid request' }, 400);

  const g = gh(env);

  // FAST PATH: index-only removal. The image files themselves are left in the
  // repo and cleaned up lazily (orphans are purged via a bulk git-data cleanup
  // or when the same key is re-uploaded). This keeps deletion as fast as
  // image review — a batch of N images is just 2 index writes regardless of N.
  await withLock('index:images', async () => {
    // images.json
    const images = await readJson(env, 'data/images.json', []);
    const remaining = (Array.isArray(images) ? images : []).filter((i) => !keys.includes(i.key));
    let sha = null;
    try {
      const m = await g.getContents('data/images.json');
      if (m && m.sha) sha = m.sha;
    } catch (_) {}
    await writeJson(env, 'data/images.json', remaining, `remove ${keys.length} image(s)`, sha);

    // pending_images.json
    const pendings = await readJson(env, 'data/pending_images.json', []);
    const pRemaining = (Array.isArray(pendings) ? pendings : []).filter((p) => !keys.includes(p.key));
    let psha = null;
    try {
      const m2 = await g.getContents('data/pending_images.json');
      if (m2 && m2.sha) psha = m2.sha;
    } catch (_) {}
    await writeJson(env, 'data/pending_images.json', pRemaining, `remove ${keys.length} pending(s)`, psha);
  });

  return json({ ok: true, count: keys.length });
}
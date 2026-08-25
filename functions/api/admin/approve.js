import {
  gh,
  readJson,
  writeJson,
  rawFileBase64,
  json,
} from '../../_lib/github.js';

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
  const action = body.action; // 'approve' | 'reject'
  if (!key || !['approve', 'reject'].includes(action)) {
    return json({ error: 'invalid request' }, 400);
  }

  const g = gh(env);
  const pendings = await readJson(env, 'data/pending_images.json', []);
  const target = (pendings || []).find((p) => p.key === key);
  if (!target) return json({ error: 'pending image not found' }, 404);

  const pendingPath = `pending_images/${key}`;
  const pendingMeta = await g.getContents(pendingPath).catch(() => null);

  if (action === 'approve') {
    if (pendingMeta) {
      // Move file: pending_images/<key> -> images/<key>
      const b64 = await rawFileBase64(env, pendingPath);
      if (!b64) return json({ error: 'failed to read pending file' }, 500);

      const destPath = `images/${key}`;
      const destExists = await g.getContents(destPath).catch(() => null);
      if (!destExists) {
        await g.putFile(destPath, b64, `approve image ${key}`);
      }
      await g.deleteFile(pendingPath, `remove pending ${key}`, pendingMeta.sha);
    }
    // else: pending file already gone (moved previously) -> just fix the index below

    // Add to images.json index (idempotent)
    const images = await readJson(env, 'data/images.json', []);
    const record = {
      key,
      url: `/img/${key}`,
      name: target.name || key,
      size: target.size || 0,
      type: target.type || '',
      uploader: target.uploader || '',
      addedAt: Date.now(),
    };
    const idx = images.findIndex((i) => i.key === key);
    if (idx >= 0) images[idx] = { ...images[idx], addedAt: record.addedAt };
    else images.push(record);
    images.sort((a, b) => b.addedAt - a.addedAt);
    let isha = null;
    try {
      const m = await g.getContents('data/images.json');
      if (m && m.sha) isha = m.sha;
    } catch (_) {}
    await writeJson(env, 'data/images.json', images, `approve index add (${key})`, isha);
  } else {
    // reject: remove the pending file if it still exists
    if (pendingMeta) {
      await g.deleteFile(pendingPath, `reject image ${key}`, pendingMeta.sha);
    }
  }

  // Always remove from pending_images.json (fixes stale/ghost records too)
  const remaining = (pendings || []).filter((p) => p.key !== key);
  let psha = null;
  try {
    const m = await g.getContents('data/pending_images.json');
    if (m && m.sha) psha = m.sha;
  } catch (_) {}
  await writeJson(env, 'data/pending_images.json', remaining, `pending index remove (${key})`, psha);

  return json({ ok: true });
}
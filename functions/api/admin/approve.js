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

  const action = body.action; // 'approve' | 'reject'
  const rawKeys = Array.isArray(body.keys) ? body.keys : (body.key ? [body.key] : []);
  const keys = rawKeys.map((k) => String(k).trim()).filter(Boolean);
  if (keys.length === 0 || !['approve', 'reject'].includes(action)) {
    return json({ error: 'invalid request' }, 400);
  }

  const g = gh(env);
  const pendings = await readJson(env, 'data/pending_images.json', []);
  const pendingList = Array.isArray(pendings) ? pendings : [];

  // Read images.json once up front (shared across all approved keys)
  const images = await readJson(env, 'data/images.json', []);
  const imageList = Array.isArray(images) ? images : [];

  let okCount = 0;
  let failCount = 0;
  const removedPendingKeys = new Set();

  for (const key of keys) {
    const target = pendingList.find((p) => p.key === key);
    if (!target) { failCount++; continue; }

    const pendingPath = `pending_images/${key}`;
    const pendingMeta = await g.getContents(pendingPath).catch(() => null);

    try {
      if (action === 'approve') {
        if (pendingMeta) {
          const b64 = await rawFileBase64(env, pendingPath);
          if (!b64) throw new Error('read pending failed');
          const destPath = `images/${key}`;
          const destExists = await g.getContents(destPath).catch(() => null);
          if (!destExists) {
            await g.putFile(destPath, b64, `approve image ${key}`);
          }
          await g.deleteFile(pendingPath, `remove pending ${key}`, pendingMeta.sha);
        }
        // index add (idempotent) — done in bulk after loop
        const record = {
          key,
          url: `/img/${key}`,
          name: target.name || key,
          size: target.size || 0,
          type: target.type || '',
          uploader: target.uploader || '',
          addedAt: Date.now(),
        };
        if (target.group) record.group = target.group;
        const idx = imageList.findIndex((i) => i.key === key);
        if (idx >= 0) imageList[idx] = { ...imageList[idx], addedAt: record.addedAt };
        else imageList.push(record);
      } else {
        // reject: remove the pending file if it still exists
        if (pendingMeta) {
          await g.deleteFile(pendingPath, `reject image ${key}`, pendingMeta.sha);
        }
      }
      removedPendingKeys.add(key);
      okCount++;
    } catch (e) {
      failCount++;
    }
  }

  // Write images.json once if anything approved
  if (action === 'approve' && okCount > 0) {
    imageList.sort((a, b) => b.addedAt - a.addedAt);
    let isha = null;
    try {
      const m = await g.getContents('data/images.json');
      if (m && m.sha) isha = m.sha;
    } catch (_) {}
    await writeJson(env, 'data/images.json', imageList, `approve batch (${okCount})`, isha);
  }

  // Write pending_images.json once if anything removed
  if (removedPendingKeys.size > 0) {
    const remaining = pendingList.filter((p) => !removedPendingKeys.has(p.key));
    let psha = null;
    try {
      const m = await g.getContents('data/pending_images.json');
      if (m && m.sha) psha = m.sha;
    } catch (_) {}
    await writeJson(env, 'data/pending_images.json', remaining, `pending batch remove (${removedPendingKeys.size})`, psha);
  }

  return json({ ok: true, okCount, failCount });
}
import { gh, readJson, writeJson, json, imgGroups } from '../../_lib/github.js';

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

  try {
    const g = gh(env);

    // ---- FAST PATH ----
    // Image files already live in the repo (pending_images/<key>). /img/<key>
    // reads from both pending_images/ and images/. Approving only updates the
    // index (no file byte transfer) -> a single approve is a couple of JSON
    // writes; a batch of N images is the same 2 writes regardless of N.
    const pendings = await readJson(env, 'data/pending_images.json', []);
    const pendingList = Array.isArray(pendings) ? pendings : [];
    const images = await readJson(env, 'data/images.json', []);
    const imageList = Array.isArray(images) ? images : [];

    let okCount = 0;
    let failCount = 0;
    const removedKeys = new Set();

    for (const key of keys) {
      const target = pendingList.find((p) => p.key === key);
      if (!target) { failCount++; continue; }

      if (action === 'approve') {
        const record = {
          key,
          url: `/img/${key}`,
          name: target.name || key,
          size: target.size || 0,
          type: target.type || '',
          uploader: target.uploader || '',
          addedAt: Date.now(),
        };
        const gs = imgGroups(target);
        if (gs.length > 0) record.groups = gs;
        const idx = imageList.findIndex((i) => i.key === key);
        if (idx >= 0) imageList[idx] = { ...imageList[idx], addedAt: record.addedAt };
        else imageList.push(record);
        okCount++;
      } else {
        // reject: index-only, same fast path as approve.
        // The pending file is left in pending_images/ and cleaned up lazily
        // (deleted via the admin delete-image endpoint or later).
        okCount++;
      }
      removedKeys.add(key);
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

      // Register any new groups introduced by the approved images
      const groups = await readJson(env, 'data/groups.json', []);
      const groupList = Array.isArray(groups) ? groups : [];
      let changed = false;
      for (const key of keys) {
        const target = pendingList.find((p) => p.key === key);
        if (!target) continue;
        for (const gid of imgGroups(target)) {
          if (!groupList.find((gr) => gr.id === gid)) {
            groupList.push({ id: gid, name: gid, createdAt: Date.now() });
            changed = true;
          }
        }
      }
      if (changed) {
        let gsha = null;
        try {
          const gm = await g.getContents('data/groups.json');
          if (gm && gm.sha) gsha = gm.sha;
        } catch (_) {}
        await writeJson(env, 'data/groups.json', groupList, `register groups on approve`, gsha);
      }
    }

    // Write pending_images.json once (drop the processed keys)
    if (removedKeys.size > 0) {
      const remaining = pendingList.filter((p) => !removedKeys.has(p.key));
      let psha = null;
      try {
        const m = await g.getContents('data/pending_images.json');
        if (m && m.sha) psha = m.sha;
      } catch (_) {}
      await writeJson(env, 'data/pending_images.json', remaining, `pending batch remove (${removedKeys.size})`, psha);
    }

    return json({ ok: true, okCount, failCount });
  } catch (e) {
    console.error('APPROVE ERROR', e, String((e && e.stack) || ''));
    return json({ error: String((e && e.message) || e) }, 500);
  }
}
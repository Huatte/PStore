import {
  gh,
  readJson,
  writeJson,
  bytesToBase64,
  json,
  withLock,
} from '../../_lib/github.js';

const MAX_BYTES = 40 * 1024 * 1024; // 40MB limit
const ALLOWED = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif']; // no svg for safety

export async function onRequestPost(context) {
  try {
    return await handle(context);
  } catch (e) {
    console.error('USER UPLOAD ERROR', e, String((e && e.stack) || ''));
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

async function handle(context) {
  const { request, env } = context;

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return json({ error: 'invalid form' }, 400);
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return json({ error: 'no file' }, 400);
  }
  if (file.size > MAX_BYTES) {
    return json({ error: 'file too large (max 40MB)' }, 413);
  }

  const uploader = String(form.get('uploader') || '').trim().slice(0, 30);
  if (!uploader) {
    return json({ error: '昵称不能为空' }, 400);
  }
  // groupName: user enters a name for a merged album; we look up or create it.
  // group (legacy): a pre-assigned group id.
  const groupName = String(form.get('groupName') || '').trim().slice(0, 60) || undefined;
  const group = groupName ? undefined : (String(form.get('group') || '').trim().slice(0, 40) || undefined);

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const name = (file.name || 'image').toLowerCase();
  const match = name.match(/\.([a-z0-9]+)$/);
  const ext = match ? match[1].toLowerCase() : '';
  if (!ALLOWED.includes(ext)) {
    return json({ error: 'unsupported file type' }, 400);
  }

  const hash = await sha256(bytes);
  const key = `${hash}.${ext}`;
  const imagePath = `pending_images/${key}`;
  const g = gh(env);

  // Store into pending_images/
  const existing = await g.getContents(imagePath).catch(() => null);
  if (!existing) {
    await g.putFile(imagePath, bytesToBase64(bytes), `pending upload ${key}`);
  }

  // Record in pending_images.json (under lock to avoid clobbering concurrent uploads)
  const record = await withLock('index:images', async () => {
    const pendings = await readJson(env, 'data/pending_images.json', []);
    const ts = Date.now();

    // Resolve target group id: by name (create/reuse) or legacy id
    let groupId = group;
    if (groupName) {
      const groups = await readJson(env, 'data/groups.json', []);
      const groupList = Array.isArray(groups) ? groups : [];
      const existing = groupList.find((gr) => gr.name === groupName);
      if (existing) {
        groupId = existing.id;
      } else {
        const gid = `g${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
        groupList.push({ id: gid, name: groupName, createdAt: ts });
        groupId = gid;
        let gsha = null;
        try {
          const gm = await g.getContents('data/groups.json');
          if (gm && gm.sha) gsha = gm.sha;
        } catch (_) {}
        await writeJson(env, 'data/groups.json', groupList, `create group ${groupName}`, gsha);
      }
    }

    const rec = {
      key,
      url: `/img/${key}`,
      name: file.name || key,
      size: file.size,
      type: file.type,
      uploader,
      addedAt: ts,
      status: 'pending',
    };
    if (groupId) rec.groups = [groupId];
    const idx = pendings.findIndex((p) => p.key === key);
    if (idx >= 0) pendings[idx] = { ...pendings[idx], addedAt: ts, uploader };
    else pendings.push(rec);

    // If using a legacy group id not registered yet, register it
    if (groupId && !groupName) {
      const groups = await readJson(env, 'data/groups.json', []);
      const groupList = Array.isArray(groups) ? groups : [];
      if (!groupList.find((gr) => gr.id === groupId)) {
        groupList.push({ id: groupId, name: groupId, createdAt: ts });
        let gsha = null;
        try {
          const gm = await g.getContents('data/groups.json');
          if (gm && gm.sha) gsha = gm.sha;
        } catch (_) {}
        await writeJson(env, 'data/groups.json', groupList, `register group ${groupId}`, gsha);
      }
    }

    let sha = null;
    try {
      const meta = await g.getContents('data/pending_images.json');
      if (meta && meta.sha) sha = meta.sha;
    } catch (_) {}
    await writeJson(env, 'data/pending_images.json', pendings, `pending index update (${key})`, sha);
    return rec;
  });

  return json({ ok: true, ...record });
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const arr = new Uint8Array(digest);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}
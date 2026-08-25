import {
  gh,
  readJson,
  writeJson,
  bytesToBase64,
  decodeBase64ToString,
  json,
  withLock,
} from '../_lib/github.js';

const MAX_BYTES = 40 * 1024 * 1024; // 40MB limit

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    return await handle(context);
  } catch (e) {
    console.error('UPLOAD ERROR', e, String(e && e.stack || ''));
    return json({ error: String(e && e.message || e), stack: String(e && e.stack || '') }, 500);
  }
}

async function handle(context) {
  const { request, env } = context;

  if (!env.ADMIN_TOKEN || request.headers.get('x-admin-token') !== env.ADMIN_TOKEN) {
    return json({ error: 'unauthorized' }, 401);
  }

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
  const group = String(form.get('group') || '').trim().slice(0, 40) || undefined;

  if (file.size > MAX_BYTES) {
    return json({ error: 'file too large (max 40MB)' }, 413);
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const name = (file.name || 'image').toLowerCase();
  const match = name.match(/\.([a-z0-9]+)$/);
  const ext = match ? match[1].toLowerCase() : 'png';
  const allowed = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];
  if (!allowed.includes(ext)) {
    return json({ error: 'unsupported file type' }, 400);
  }

  const hash = await sha256(bytes);
  const key = `${hash}.${ext}`;
  const imagePath = `images/${key}`;
  const g = gh(env);

  // Upload binary to GitHub (putFile retries on 409/503)
  const existing = await g.getContents(imagePath).catch(() => null);
  if (!existing) {
    await g.putFile(imagePath, bytesToBase64(bytes), `upload image ${key}`);
  }

  // Read + update images.json index under lock (avoid concurrent clobber)
  return await withLock('index:images', async () => {
    const indexMeta = await g.getContents('data/images.json').catch(() => null);
    let images = [];
    if (indexMeta && indexMeta.content) {
      try {
        images = JSON.parse(decodeBase64ToString(indexMeta.content.replace(/\n/g, '')));
        if (!Array.isArray(images)) images = [];
      } catch (_) { images = []; }
    }
    const indexSha = indexMeta ? indexMeta.sha : null;

  const ts = Date.now();
  const record = {
    key,
    url: `/img/${key}`,
    name: file.name || key,
    size: file.size,
    type: file.type,
    uploader: 'admin',
    addedAt: ts,
  };
  if (group) record.group = group;
  const idx = images.findIndex((i) => i.key === key);
  if (idx >= 0) images[idx] = { ...images[idx], addedAt: ts };
  else images.push(record);
  images.sort((a, b) => b.addedAt - a.addedAt);

    // If this image belongs to a group not registered yet, register it
    if (group) {
      const groups = await readJson(env, 'data/groups.json', []);
      const groupList = Array.isArray(groups) ? groups : [];
      if (!groupList.find((gr) => gr.id === group)) {
        groupList.push({ id: group, name: group, createdAt: ts });
        let gsha = null;
        try {
          const gm = await g.getContents('data/groups.json');
          if (gm && gm.sha) gsha = gm.sha;
        } catch (_) {}
        await writeJson(env, 'data/groups.json', groupList, `register group ${group}`, gsha);
      }
    }

    await writeJson(env, 'data/images.json', images, `update images index (${key})`, indexSha);

    return json({ ok: true, ...record });
  });
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const arr = new Uint8Array(digest);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

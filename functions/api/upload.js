import {
  gh,
  readJson,
  writeJson,
  bytesToBase64,
  json,
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

  // Upload binary to GitHub
  const existing = await g.getContents(imagePath).catch(() => null);
  if (!existing) {
    await g.putFile(imagePath, bytesToBase64(bytes), `upload image ${key}`);
  }

  // Only continue if the image file actually exists in the repo now
  const verified = await g.getContents(imagePath).catch(() => null);
  if (!verified) {
    return json({ error: 'image upload failed; not indexed' }, 500);
  }

  // Update images.json metadata
  const images = await readJson(env, 'data/images.json', []);
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

  let sha = null;
  try {
    const meta = await g.getContents('data/images.json');
    if (meta && meta.sha) sha = meta.sha;
  } catch (_) {}
  await writeJson(env, 'data/images.json', images, `update images index (${key})`, sha);

  return json({ ok: true, ...record });
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const arr = new Uint8Array(digest);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

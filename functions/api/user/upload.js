import {
  gh,
  readJson,
  writeJson,
  bytesToBase64,
  json,
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

  const uploader = String(form.get('uploader') || '用户').trim().slice(0, 30);
  const group = String(form.get('group') || '').trim().slice(0, 40) || undefined;

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
  const verified = await g.getContents(imagePath).catch(() => null);
  if (!verified) {
    return json({ error: 'upload failed' }, 500);
  }

  // Record in pending_images.json
  const pendings = await readJson(env, 'data/pending_images.json', []);
  const ts = Date.now();
  const record = {
    key,
    url: `/img/${key}`,
    name: file.name || key,
    size: file.size,
    type: file.type,
    uploader,
    addedAt: ts,
    status: 'pending',
  };
  if (group) record.group = group;
  const idx = pendings.findIndex((p) => p.key === key);
  if (idx >= 0) pendings[idx] = { ...pendings[idx], addedAt: ts, uploader };
  else pendings.push(record);

  let sha = null;
  try {
    const meta = await g.getContents('data/pending_images.json');
    if (meta && meta.sha) sha = meta.sha;
  } catch (_) {}
  await writeJson(env, 'data/pending_images.json', pendings, `pending index update (${key})`, sha);

  return json({ ok: true, ...record });
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const arr = new Uint8Array(digest);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}
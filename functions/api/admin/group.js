import { gh, readJson, writeJson, json, withLock } from '../../_lib/github.js';

function makeGroupId() {
  return `g${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

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

  const action = body.action; // 'create' | 'rename' | 'delete' | 'add' | 'remove'
  if (!['create', 'rename', 'delete', 'add', 'remove'].includes(action)) {
    return json({ error: 'invalid action' }, 400);
  }

  const g = gh(env);

  return await withLock('index:images', async () => {
    const groups = await readJson(env, 'data/groups.json', []);
    const groupList = Array.isArray(groups) ? groups : [];
    const images = await readJson(env, 'data/images.json', []);
    const imageList = Array.isArray(images) ? images : [];

    if (action === 'create') {
      const name = String(body.name || '').trim().slice(0, 60) || '未命名合集';
      const id = makeGroupId();
      groupList.push({ id, name, createdAt: Date.now() });
      let sha = null;
      try {
        const m = await g.getContents('data/groups.json');
        if (m && m.sha) sha = m.sha;
      } catch (_) {}
      await writeJson(env, 'data/groups.json', groupList, `create group ${id}`, sha);
      return json({ ok: true, id, name });
    }

    const id = String(body.id || '').trim();
    if (!id) return json({ error: 'missing id' }, 400);
    const target = groupList.find((gr) => gr.id === id);

    if (action === 'rename') {
      const name = String(body.name || '').trim().slice(0, 60);
      if (!name) return json({ error: 'name required' }, 400);
      if (!target) return json({ error: 'group not found' }, 404);
      target.name = name;
      let sha = null;
      try {
        const m = await g.getContents('data/groups.json');
        if (m && m.sha) sha = m.sha;
      } catch (_) {}
      await writeJson(env, 'data/groups.json', groupList, `rename group ${id}`, sha);
      return json({ ok: true });
    }

    if (action === 'delete') {
      // remove group record + clear group on all its images
      const remaining = groupList.filter((gr) => gr.id !== id);
      let gsha = null;
      try {
        const m = await g.getContents('data/groups.json');
        if (m && m.sha) gsha = m.sha;
      } catch (_) {}
      await writeJson(env, 'data/groups.json', remaining, `delete group ${id}`, gsha);

      const changed = imageList.map((img) => {
        if (img.group === id) { const c = { ...img }; delete c.group; return c; }
        return img;
      });
      let isha = null;
      try {
        const m = await g.getContents('data/images.json');
        if (m && m.sha) isha = m.sha;
      } catch (_) {}
      await writeJson(env, 'data/images.json', changed, `clear group ${id} images`, isha);
      return json({ ok: true });
    }

    if (action === 'add' || action === 'remove') {
      const rawKeys = Array.isArray(body.keys) ? body.keys : (body.key ? [body.key] : []);
      const keys = rawKeys.map((k) => String(k).trim()).filter(Boolean);
      if (keys.length === 0) return json({ error: 'no keys' }, 400);

      const changed = imageList.map((img) => {
        if (!keys.includes(img.key)) return img;
        if (action === 'add') {
          return { ...img, group: id };
        } else {
          const c = { ...img };
          delete c.group;
          return c;
        }
      });
      let isha = null;
      try {
        const m = await g.getContents('data/images.json');
        if (m && m.sha) isha = m.sha;
      } catch (_) {}
      await writeJson(env, 'data/images.json', changed, `group ${action} ${keys.length} images`, isha);
      return json({ ok: true });
    }

    return json({ error: 'invalid request' }, 400);
  });
}
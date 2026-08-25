import { readJson, json, imgInGroup } from '../../_lib/github.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.ADMIN_TOKEN || request.headers.get('x-admin-token') !== env.ADMIN_TOKEN) {
    return json({ error: 'unauthorized' }, 401);
  }

  const groups = await readJson(env, 'data/groups.json', []);
  const images = await readJson(env, 'data/images.json', []);
  const groupList = (Array.isArray(groups) ? groups : []).map((g) => {
    const members = (Array.isArray(images) ? images : []).filter((i) => imgInGroup(i, g.id));
    return {
      id: g.id,
      name: g.name || g.id,
      createdAt: g.createdAt || 0,
      count: members.length,
    };
  });

  return json({ groups: groupList });
}
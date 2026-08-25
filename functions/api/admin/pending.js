import { readJson, json } from '../../_lib/github.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.ADMIN_TOKEN || request.headers.get('x-admin-token') !== env.ADMIN_TOKEN) {
    return json({ error: 'unauthorized' }, 401);
  }
  const pendings = await readJson(env, 'data/pending_images.json', []);
  const list = (pendings || []).sort((a, b) => b.addedAt - a.addedAt);
  return json({ count: list.length, pendings: list });
}
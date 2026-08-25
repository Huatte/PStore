import { readJson, json, imgGroups, imgInGroup } from '../_lib/github.js';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);

  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  );

  let images = await readJson(env, 'data/images.json', []);
  if (!Array.isArray(images)) images = [];

  // Single-image lookup by key (used by detail page)
  const key = url.searchParams.get('key');
  if (key) {
    const found = images.find((i) => i.key === key);
    return json({ image: found || null });
  }

  // Lookup all images in a group (used by detail page for grouped uploads)
  const group = url.searchParams.get('group');
  if (group) {
    const list = images.filter((i) => imgInGroup(i, group)).sort((a, b) => b.addedAt - a.addedAt);
    return json({ images: list, total: list.length });
  }

  // Browse/list mode.
  // Default (dedup=1): collapse each group into ONE representative card (homepage).
  // dedup=0: return every image individually (admin manage page needs all).
  const dedup = (url.searchParams.get('dedup') || '1') !== '0';

  // Load group names once so homepage can show the group's real name.
  const groups = await readJson(env, 'data/groups.json', []);
  const groupNameMap = new Map();
  for (const gr of (Array.isArray(groups) ? groups : [])) {
    if (gr && gr.id) groupNameMap.set(gr.id, gr.name || gr.id);
  }

  let working = images;
  if (dedup) {
    const byGroup = new Map();
    const standalone = [];
    for (const img of images) {
      const gs = imgGroups(img);
      if (gs.length > 0) {
        // an image in multiple groups is represented by its first group card
        const gid = gs[0];
        const cur = byGroup.get(gid);
        if (!cur || (img.addedAt || 0) > (cur.addedAt || 0)) byGroup.set(gid, img);
      } else {
        standalone.push(img);
      }
    }
    // For each group representative, override name with the group name (if known)
    const groupCards = [];
    for (const img of byGroup.values()) {
      const gid = imgGroups(img)[0];
      const groupName = groupNameMap.get(gid);
      groupCards.push({ ...img, name: groupName || img.name, groupName: groupName || '' });
    }
    working = [...groupCards, ...standalone];
  }

  working.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

  // Filters used by the group image picker:
  //  - ungrouped=1 : only images not in any group
  //  - from / to   : addedAt timestamp range (ms)
  const ungrouped = (url.searchParams.get('ungrouped') || '') === '1';
  const fromTs = parseInt(url.searchParams.get('from') || '', 10);
  const toTs = parseInt(url.searchParams.get('to') || '', 10);

  if (ungrouped) {
    working = working.filter((img) => imgGroups(img).length === 0);
  }
  if (!isNaN(fromTs)) {
    working = working.filter((img) => (img.addedAt || 0) >= fromTs);
  }
  if (!isNaN(toTs)) {
    working = working.filter((img) => (img.addedAt || 0) <= toTs);
  }

  if (q) {
    const filtered = working.filter((img) => {
      const haystack = `${img.name || ''} ${img.groupName || ''}`.toLowerCase();
      return haystack.includes(q);
    });
    return json({ images: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit });
  }

  const total = working.length;
  const page = working.slice(offset, offset + limit);

  return json({ images: page, total, offset, limit });
}
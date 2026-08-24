import { readJson, json } from '../_lib/github.js';

export async function onRequestGet(context) {
  const { env } = context;
  const images = await readJson(env, 'data/images.json', []);
  return json({ images });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const gh = (env) => {
  const REPO = env.GH_REPO;
  const BRANCH = env.GH_BRANCH || 'main';
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'PStore-pages',
  };

  async function getContents(path) {
    const url = `https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}`;
    const r = await fetch(url, { headers });
    if (r.status === 200) return await r.json();
    if (r.status === 404) return null;
    throw new Error(`GitHub get failed: ${r.status} ${await r.text()}`);
  }

  async function putFile(path, contentBase64, commitMsg, sha, retries = 5) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const body = { message: commitMsg, content: contentBase64, branch: BRANCH };
      if (sha) body.sha = sha;
      const url = `https://api.github.com/repos/${REPO}/contents/${path}`;
      const r = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
      if (r.status === 200 || r.status === 201) {
        return await r.json();
      }
      const text = await r.text();
      if (r.status === 409 && attempt < retries) {
        // sha conflict: re-read the latest sha and retry with it
        try {
          const latest = await getContents(path);
          if (latest && latest.sha) sha = latest.sha;
        } catch (_) {}
        await sleep(250 * (attempt + 1));
        continue;
      }
      if ((r.status === 503 || r.status === 429 || r.status === 403) && attempt < retries) {
        // rate limited / overloaded: respect Retry-After if provided, else back off
        const retryAfter = parseInt(r.headers.get('retry-after') || '0', 10);
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * (attempt + 1) + Math.random() * 400);
        continue;
      }
      throw new Error(`GitHub put failed: ${r.status} ${text}`);
    }
    throw new Error(`GitHub put failed after ${retries + 1} attempts`);
  }

  async function deleteFile(path, commitMsg, sha, retries = 3) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const body = { message: commitMsg, branch: BRANCH };
      if (sha) body.sha = sha;
      const url = `https://api.github.com/repos/${REPO}/contents/${path}`;
      const r = await fetch(url, { method: 'DELETE', headers, body: JSON.stringify(body) });
      if (r.status === 200) {
        return await r.json();
      }
      const text = await r.text();
      if (r.status === 503 || r.status === 429) {
        const retryAfter = parseInt(r.headers.get('retry-after') || '0', 10);
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * (attempt + 1) + Math.random() * 400);
        continue;
      }
      throw new Error(`GitHub delete failed: ${r.status} ${text}`);
    }
    throw new Error(`GitHub delete failed after ${retries + 1} attempts`);
  }

  return { getContents, putFile, deleteFile, REPO, BRANCH };
};

// Helper: read a file's content as UTF-8 string, handling size >1MB via raw
export async function readUtf8(env, path) {
  const g = gh(env);
  // Prefer auth'd contents API (higher priority, sees latest)
  try {
    const meta = await g.getContents(path);
    if (!meta) return null;
    if (meta.content) {
      return decodeBase64ToString(meta.content.replace(/\n/g, ''));
    }
    return null;
  } catch (e) {
    return null;
  }
}

// Helper: read all entries in a JSON object file (used by comments)
export async function readJson(env, path, fallback) {
  const text = await readUtf8(env, path);
  if (text === null || text === '') return fallback;
  try {
    return JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

// Download a file's bytes from the raw githubusercontent URL and return base64
export async function rawFileBase64(env, path) {
  const g = gh(env);
  const url = `https://raw.githubusercontent.com/${g.REPO}/${g.BRANCH}/${path}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const buf = await r.arrayBuffer();
  return bytesToBase64(new Uint8Array(buf));
}

export async function writeJson(env, path, data, commitMsg, currentSha) {
  const g = gh(env);
  const json = JSON.stringify(data, null, 2);
  const b64 = stringToBase64(json);
  return g.putFile(path, b64, commitMsg, currentSha);
}

// --- base64 helpers (browser/worker compatible, no Buffer) ---
export function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function stringToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  return bytesToBase64(bytes);
}

export function decodeBase64ToString(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

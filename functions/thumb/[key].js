const KEY_RE = /^[a-f0-9]+\.(png|jpg|jpeg|gif|webp|svg|bmp|avif)$/i;

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const key = segments.length > 0 ? decodeURIComponent(segments[segments.length - 1]) : '';

  if (!key || !KEY_RE.test(key)) {
    return new Response('Not Found', { status: 404 });
  }

  const repo = env.GH_REPO;
  const branch = env.GH_BRANCH || 'main';
  const thumbKey = `${key}.webp`;
  const thumbUpstream = `https://raw.githubusercontent.com/${repo}/${branch}/thumbs/${thumbKey}`;
  const origUpstream = `https://raw.githubusercontent.com/${repo}/${branch}/images/${key}`;

  try {
    // 1. Serve the pre-generated thumbnail if it exists
    const thumb = await fetch(thumbUpstream, {
      cf: { cacheEverything: true, cacheTtl: 86400 },
    });
    if (thumb.ok && thumb.status === 200) {
      const body = await thumb.arrayBuffer();
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'image/webp',
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    // 2. Fallback: original image (no thumbnail generated yet) - short cache so
    //    once a thumbnail is generated, it replaces this quickly.
    const orig = await fetch(origUpstream, {
      cf: { cacheEverything: true, cacheTtl: 300 },
    });
    if (orig.ok && orig.status === 200) {
      const body = await orig.arrayBuffer();
      const contentType = orig.headers.get('Content-Type') || 'image/png';
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=300',
          'Access-Control-Allow-Origin': '*',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    return new Response('Not Found', { status: 404 });
  } catch (e) {
    return new Response('Error', { status: 502 });
  }
}
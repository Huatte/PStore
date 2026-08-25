const KEY_RE = /^[a-f0-9]+\.(png|jpg|jpeg|gif|webp|svg|bmp|avif)$/i;

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  // Parse key from pathname only (query string may pollute params on some routes)
  const segments = url.pathname.split('/').filter(Boolean);
  const key = segments.length > 0 ? decodeURIComponent(segments[segments.length - 1]) : '';

  if (!key || !KEY_RE.test(key)) {
    return new Response('Not Found', { status: 404 });
  }

  const repo = env.GH_REPO;
  const branch = env.GH_BRANCH || 'main';
  const candidatePaths = [`images/${key}`, `pending_images/${key}`];

  const wRaw = url.searchParams.get('w');
  const width = wRaw ? parseInt(wRaw, 10) : 0;

  try {
    for (const path of candidatePaths) {
      const upstream = `https://raw.githubusercontent.com/${repo}/${branch}/${path}`;

      // Cloudflare Image Resizing when width requested
      if (width > 0 && width <= 3000) {
        try {
          const resized = await fetch(upstream, {
            cf: {
              image: {
                fit: 'scale-down',
                width,
                format: 'auto',
                quality: 85,
              },
            },
          });
          if (resized.ok && resized.status === 200) {
            const contentType = resized.headers.get('Content-Type') || 'image/webp';
            return new Response(resized.body, {
              status: 200,
              headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=86400',
                'Access-Control-Allow-Origin': '*',
                'X-Content-Type-Options': 'nosniff',
              },
            });
          }
        } catch (e) {
          // resizing unavailable -> fall through
        }
      }

      // Original image (no resize or resizing not available)
      const resp = await fetch(upstream, {
        cf: { cacheEverything: true, cacheTtl: 86400 },
      });
      if (resp.ok && resp.status === 200) {
        const body = await resp.arrayBuffer();
        const contentType = resp.headers.get('Content-Type') || 'image/png';
        return new Response(body, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=86400',
            'Access-Control-Allow-Origin': '*',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }
    }
    return new Response('Not Found', { status: 404 });
  } catch (e) {
    return new Response('Error', { status: 502 });
  }
}
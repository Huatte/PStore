document.addEventListener('DOMContentLoaded', () => {
  const gallery = document.getElementById('gallery');
  const searchBox = document.getElementById('search-box');
  const statusEl = document.createElement('div');
  statusEl.className = 'empty';
  statusEl.textContent = '加载中…';

  const PAGE = 30;
  let q = '';
  let offset = 0;
  let total = Infinity;
  let loading = false;
  let done = false;

  function setStatus(text) {
    if (text) {
      statusEl.textContent = text;
      if (!statusEl.parentNode) gallery.appendChild(statusEl);
    } else if (statusEl.parentNode) {
      statusEl.parentNode.removeChild(statusEl);
    }
  }

  function appendImages(images) {
    images.forEach((img) => {
      const a = document.createElement('a');
      a.className = 'item';
      a.href = `/image.html?key=${encodeURIComponent(img.key)}`;
      const thumb = document.createElement('img');
      thumb.className = 'thumb';
      thumb.loading = 'lazy';
      thumb.decoding = 'async';
      thumb.src = `/img/${encodeURIComponent(img.key)}?w=400`;
      thumb.onerror = () => { thumb.style.visibility = 'hidden'; };
      thumb.alt = img.name || img.key;
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = img.name || img.key;
      a.appendChild(thumb);
      a.appendChild(name);
      gallery.appendChild(a);
    });
  }

  async function loadMore() {
    if (loading || done) return;
    loading = true;
    if (offset === 0) setStatus(q ? '搜索中…' : '加载中…');
    try {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (q) params.set('q', q);
      const res = await fetch(`/api/images?${params.toString()}`);
      const data = await res.json();
      const items = data.images || [];
      total = typeof data.total === 'number' ? data.total : items.length;
      appendImages(items);
      offset += items.length;
      if (offset >= total || items.length < PAGE) {
        done = true;
      }
      if (offset === 0 && items.length === 0) {
        setStatus(q ? '没有匹配的图片' : '暂无图片');
      } else if (!done) {
        setStatus('加载中…');
      } else {
        setStatus('');
      }
    } catch (e) {
      setStatus('加载失败，请刷新重试');
    } finally {
      loading = false;
    }
  }

  // debounced server-side search
  let debounceTimer = null;
  function onSearch() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const newQ = (searchBox.value || '').trim().toLowerCase();
      if (newQ === q) return;
      q = newQ;
      offset = 0;
      done = false;
      total = Infinity;
      gallery.innerHTML = '';
      loadMore();
    }, 300);
  }
  searchBox.addEventListener('input', onSearch);

  // infinite scroll: load more when near bottom
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      if (done || loading) return;
      const body = document.body;
      const html = document.documentElement;
      const docHeight = Math.max(body.scrollHeight, body.offsetHeight, html.clientHeight, html.scrollHeight);
      const scrollPos = window.scrollY + window.innerHeight;
      if (docHeight - scrollPos < window.innerHeight * 1.2) {
        loadMore();
      }
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  // initial load
  loadMore();
});
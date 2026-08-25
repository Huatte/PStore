document.addEventListener('DOMContentLoaded', () => {
  const gallery = document.getElementById('gallery');
  const searchBox = document.getElementById('search-box');
  const statusEl = document.createElement('div');
  statusEl.className = 'empty';
  statusEl.textContent = '加载中…';

  // Load 3 rows per request: compute how many columns fit, then × 3.
  function pageSize() {
    const minCard = 240;
    const gap = 16;
    const width = gallery.clientWidth || 800;
    const cols = Math.max(1, Math.floor((width + gap) / (minCard + gap)));
    return cols * 3;
  }

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

  const shownKeys = new Set();

  function appendImages(images) {
    images.forEach((img) => {
      // skip already-shown keys (safety, backend already dedupes groups)
      if (shownKeys.has(img.key)) return;

      const a = document.createElement('a');
      a.className = 'item';
      a.href = `/image.html?key=${encodeURIComponent(img.key)}`;

      const thumb = document.createElement('img');
      thumb.className = 'thumb';
      thumb.loading = 'lazy';
      thumb.decoding = 'async';
      thumb.src = `/img/${encodeURIComponent(img.key)}`;
      thumb.onerror = () => { thumb.style.visibility = 'hidden'; };
      thumb.alt = img.name || img.key;

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = img.name || img.key;

      const meta = document.createElement('div');
      meta.className = 'item-meta';
      meta.textContent = (img.uploader === 'admin') ? '管理员' : (img.uploader || '用户');
      if (img.group) {
        meta.textContent += ' · 合集';
      }

      a.appendChild(thumb);
      a.appendChild(name);
      a.appendChild(meta);
      gallery.appendChild(a);

      shownKeys.add(img.key);
    });
  }

  async function loadMore() {
    if (loading || done) return;
    loading = true;
    if (offset === 0) {
      // clear the static placeholder from index.html before first render
      gallery.innerHTML = '';
    }
    try {
      const params = new URLSearchParams({ limit: String(pageSize()), offset: String(offset) });
      if (q) params.set('q', q);
      const res = await fetch(`/api/images?${params.toString()}`);
      const data = await res.json();
      const items = data.images || [];
      total = typeof data.total === 'number' ? data.total : items.length;
      appendImages(items);
      offset += items.length;
      if (offset >= total || items.length < pageSize()) {
        done = true;
      }
      if (offset === 0 && items.length === 0) {
        setStatus(q ? '没有匹配的图片' : '暂无图片');
      } else if (done) {
        setStatus('');
      }
    } catch (e) {
      setStatus('加载失败，请刷新重试');
    } finally {
      loading = false;
    }
    // If the page still has no scrollbar (e.g. few visible cards), keep loading
    // more pages until there is something to scroll, or everything is loaded.
    if (!done && !hasScrollbar()) {
      loadMore();
    }
  }

  function hasScrollbar() {
    const html = document.documentElement;
    return html.scrollHeight > html.clientHeight + 4;
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
      shownKeys.clear();
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

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
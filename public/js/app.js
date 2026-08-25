document.addEventListener('DOMContentLoaded', async () => {
  const gallery = document.getElementById('gallery');
  try {
    const res = await fetch('/api/images');
    const data = await res.json();
    const images = data.images || [];
    if (images.length === 0) {
      gallery.innerHTML = '<div class="empty">暂无图片</div>';
      return;
    }
    gallery.innerHTML = '';
    images.forEach((img) => {
      const a = document.createElement('a');
      a.className = 'item';
      a.href = `/image.html?key=${encodeURIComponent(img.key)}`;
      const thumb = document.createElement('img');
      thumb.className = 'thumb';
      thumb.loading = 'lazy';
      thumb.src = `/img/${encodeURIComponent(img.key)}`;
      thumb.onerror = () => { thumb.src = ''; thumb.alt = '图片加载失败'; };
      thumb.alt = img.name || img.key;
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = img.name || img.key;
      a.appendChild(thumb);
      a.appendChild(name);
      gallery.appendChild(a);
    });
  } catch (e) {
    gallery.innerHTML = '<div class="empty">加载失败，请稍后重试</div>';
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  const gallery = document.getElementById('gallery');
  const searchBox = document.getElementById('search-box');
  let images = [];

  async function render() {
    const q = (searchBox.value || '').trim().toLowerCase();
    const list = images.filter((img) => {
      if (!q) return true;
      return (img.name || '').toLowerCase().includes(q);
    });

    if (list.length === 0) {
      gallery.innerHTML = q
        ? '<div class="empty">没有匹配的图片</div>'
        : '<div class="empty">暂无图片</div>';
      return;
    }

    gallery.innerHTML = '';
    list.forEach((img) => {
      const a = document.createElement('a');
      a.className = 'item';
      a.href = `/image.html?key=${encodeURIComponent(img.key)}`;
      const thumb = document.createElement('img');
      thumb.className = 'thumb';
      thumb.loading = 'lazy';
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

  searchBox.addEventListener('input', render);

  try {
    const res = await fetch('/api/images');
    const data = await res.json();
    images = data.images || [];
    await render();
  } catch (e) {
    gallery.innerHTML = '<div class="empty">加载失败，请稍后重试</div>';
  }
});
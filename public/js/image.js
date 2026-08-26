document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(location.search);
  const key = params.get('key');
  if (!key) {
    location.href = '/';
    return;
  }

  const detailImgs = document.getElementById('detail-imgs');
  const groupTitle = document.getElementById('group-title');
  const meta = document.getElementById('meta');
  const listEl = document.getElementById('comment-list');
  const form = document.getElementById('comment-form');

  // Load image metadata
  let imageInfo = null;
  try {
    const res = await fetch(`/api/images?key=${encodeURIComponent(key)}`);
    const data = await res.json();
    imageInfo = data.image || null;
  } catch (e) {}

  // Determine the set of images to show (single or whole group)
  const imgGroups = (img) => (img && Array.isArray(img.groups) ? img.groups : (img && img.group ? [img.group] : []));
  let images = [];
  const groups = imgGroups(imageInfo);
  if (groups.length > 0) {
    try {
      const res = await fetch(`/api/images?group=${encodeURIComponent(groups[0])}`);
      const data = await res.json();
      images = (data.images || []).sort((a, b) => b.addedAt - a.addedAt);
    } catch (e) { images = imageInfo ? [imageInfo] : []; }
  } else {
    images = imageInfo ? [imageInfo] : [];
  }

  if (images.length > 1) {
    groupTitle.textContent = `共 ${images.length} 张（合并详情页）`;
    groupTitle.style.display = 'block';
  }

  // Render each image with a wrapper so aspect ratio is preserved (no shrink)
  if (images.length === 0) {
    meta.innerHTML = '<div style="color:#ff5c7a">图片加载失败：文件可能已被删除</div>';
    return;
  }
  detailImgs.innerHTML = '';
  images.forEach((img) => {
    const fig = document.createElement('figure');
    fig.className = 'detail-figure';
    const cap = document.createElement('figcaption');
    cap.textContent = img.name || img.key;
    const im = document.createElement('img');
    im.className = 'detail-image';
    im.loading = 'lazy';
    im.decoding = 'async';
    im.src = `/img/${encodeURIComponent(img.key)}`;
    im.alt = img.name || img.key;
    im.onerror = () => { im.style.display = 'none'; cap.textContent = `${cap.textContent}（加载失败）`; };
    fig.appendChild(im);
    fig.appendChild(cap);
    detailImgs.appendChild(fig);
  });

  // Metadata (from first/primary image)
  const primary = imageInfo || images[0];
  if (primary) {
    meta.innerHTML = `
      <div>上传者：${escapeHtml(primary.uploader === 'admin' ? '管理员' : (primary.uploader || '用户'))}</div>
      <div>${escapeHtml(primary.name || primary.key)} · ${formatBytes(primary.size)} · 上传于：${new Date(primary.addedAt).toLocaleString()}</div>`;
  }

  async function loadComments() {
    try {
      const res = await fetch(`/api/comments?image=${encodeURIComponent(key)}`);
      const data = await res.json();
      const list = data.comments || [];
      if (list.length === 0) {
        listEl.innerHTML = '<div class="empty-comments">暂无留言，来抢沙发吧</div>';
        return;
      }
      listEl.innerHTML = '';
      list.forEach((c) => {
        const div = document.createElement('div');
        div.className = 'comment';
        div.innerHTML = `
          <div class="c-head"><span class="c-author">${escapeHtml(c.author)}</span><span>${new Date(c.createdAt).toLocaleString()}</span></div>
          <div class="c-text">${escapeHtml(c.text)}</div>
          <div class="c-id">ID:${escapeHtml(c.id)}</div>`;
        listEl.appendChild(div);
      });
    } catch (e) {
      listEl.innerHTML = '<div class="empty-comments">留言加载失败</div>';
    }
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const author = document.getElementById('c-author').value.trim();
    const text = document.getElementById('c-text').value.trim();
    const btn = form.querySelector('button');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '提交中…';
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: key, author, text }),
      });
      const data = await res.json();
      if (res.ok) {
        document.getElementById('c-text').value = '';
        showMsg(form, '留言发表成功。', 'ok');
        loadComments();
      } else {
        showMsg(form, data.error || '提交失败', 'err');
      }
    } catch (e) {
      showMsg(form, '网络错误', 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  });

  await loadComments();
});

function showMsg(el, text, cls) {
  const div = document.createElement('div');
  div.className = `msg ${cls}`;
  div.textContent = text;
  el.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${units[i]}`;
}
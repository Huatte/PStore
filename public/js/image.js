document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(location.search);
  const key = params.get('key');
  if (!key) {
    location.href = '/';
    return;
  }

  const bigImg = document.getElementById('big-img');
  const meta = document.getElementById('meta');
  const listEl = document.getElementById('comment-list');
  const form = document.getElementById('comment-form');

  // Load image metadata
  let imageInfo = null;
  try {
    const res = await fetch('/api/images');
    const data = await res.json();
    imageInfo = (data.images || []).find((i) => i.key === key);
  } catch (e) {}

  bigImg.src = `/img/${encodeURIComponent(key)}`;
  bigImg.onerror = () => {
    bigImg.style.display = 'none';
    meta.innerHTML = '<div style="color:#ff5c7a">图片加载失败：文件可能已被删除</div>';
  };

  if (imageInfo) {
    bigImg.alt = imageInfo.name || key;
    meta.innerHTML = `
      <div>文件名：${escapeHtml(imageInfo.name || key)}</div>
      <div>大小：${formatBytes(imageInfo.size)} · 上传于：${new Date(imageInfo.addedAt).toLocaleString()}</div>`;
  } else {
    bigImg.alt = key;
    meta.textContent = `图片标识：${key}`;
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
          <div class="c-text">${escapeHtml(c.text)}</div>`;
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
        showMsg(form, '提交成功，等待管理员审核。', 'ok');
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

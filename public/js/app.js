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

  // --- user upload modal ---
  const modal = document.getElementById('upload-modal');
  const openBtn = document.getElementById('upload-open');
  const closeBtn = document.getElementById('upload-close');
  const uploadFile = document.getElementById('upload-file');
  const uploadNick = document.getElementById('upload-nickname');
  const uploadSubmit = document.getElementById('upload-submit');
  const uploadMsg = document.getElementById('upload-msg');

  function showMsg(text, cls) {
    uploadMsg.textContent = text;
    uploadMsg.className = `msg ${cls}`;
  }

  openBtn.addEventListener('click', () => modal.classList.remove('hidden'));
  closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

  uploadSubmit.addEventListener('click', async () => {
    const file = uploadFile.files && uploadFile.files[0];
    if (!file) { showMsg('请先选择图片', 'err'); return; }
    showMsg('上传中…', '');
    uploadSubmit.disabled = true;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('uploader', uploadNick.value || '');
    try {
      const res = await fetch('/api/user/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (res.ok) {
        showMsg('上传成功，等待管理员审核。', 'ok');
        uploadFile.value = '';
      } else {
        showMsg(data.error || '上传失败', 'err');
      }
    } catch (e) {
      showMsg('网络错误', 'err');
    } finally {
      uploadSubmit.disabled = false;
    }
  });

  try {
    const res = await fetch('/api/images');
    const data = await res.json();
    images = data.images || [];
    await render();
  } catch (e) {
    gallery.innerHTML = '<div class="empty">加载失败，请稍后重试</div>';
  }
});
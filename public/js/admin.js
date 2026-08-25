document.addEventListener('DOMContentLoaded', () => {
  const loginView = document.getElementById('login-view');
  const panelView = document.getElementById('panel-view');
  const loginBtn = document.getElementById('login-btn');
  const adminPass = document.getElementById('admin-pass');
  const loginMsg = document.getElementById('login-msg');
  const logoutBtn = document.getElementById('logout-btn');

  const fileInput = document.getElementById('file-input');
  const uploadBtn = document.getElementById('upload-btn');
  const uploadProgress = document.getElementById('upload-progress');
  const uploadResults = document.getElementById('upload-results');

  const moderateList = document.getElementById('moderate-list');
  const pendingCount = document.getElementById('pending-count');
  const manageList = document.getElementById('manage-list');
  const imageReviewList = document.getElementById('image-review-list');
  const imagePendingCount = document.getElementById('image-pending-count');

  // --- auth ---
  function token() { return localStorage.getItem('pstore_admin_token') || ''; }
  async function setToken(t) {
    localStorage.setItem('pstore_admin_token', t);
    if (t) { showPanel(); await Promise.all([loadModerate(), loadImageReview(), loadManage()]); }
    else { loginView.classList.remove('hidden'); panelView.classList.add('hidden'); }
  }

  loginBtn.addEventListener('click', async () => {
    const pass = adminPass.value.trim();
    if (!pass) return;
    loginMsg.textContent = '验证中…';
    loginMsg.className = 'msg';
    // Verify by calling a protected endpoint
    const res = await fetch('/api/admin/comments', { headers: { 'x-admin-token': pass } });
    if (res.ok) { setToken(pass); loginMsg.textContent = ''; }
    else { loginMsg.textContent = '密码错误'; loginMsg.className = 'msg err'; }
  });
  adminPass.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginBtn.click(); });

  logoutBtn.addEventListener('click', () => { setToken(''); });

  function showPanel() {
    loginView.classList.add('hidden');
    panelView.classList.remove('hidden');
  }

  // --- tabs ---
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
      tab.classList.add('active');
      const id = tab.dataset.tab;
      document.getElementById('tab-' + id).classList.remove('hidden');
    });
  });

  // --- upload ---
  let uploading = false;
  uploadBtn.addEventListener('click', async () => {
    if (uploading) return; // block re-entry while an upload is in progress
    const files = Array.from(fileInput.files || []);
    if (files.length === 0) { uploadProgress.textContent = '请选择图片'; uploadProgress.className = 'msg err'; return; }

    const mode = document.querySelector('input[name="admin-upload-mode"]:checked').value;
    const group = mode === 'merge' ? `g${Date.now()}${Math.random().toString(36).slice(2, 8)}` : '';

    uploading = true;
    uploadBtn.disabled = true;
    const originalText = uploadBtn.textContent;
    uploadBtn.textContent = '上传中…';
    uploadResults.innerHTML = '';
    const t = token();
    let ok = 0, fail = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fd = new FormData();
      fd.append('file', file);
      if (group) fd.append('group', group);
      uploadProgress.textContent = `正在上传 ${i + 1}/${files.length}：${file.name}`;
      uploadProgress.className = 'msg';
      try {
        const res = await fetch('/api/upload', { method: 'POST', headers: { 'x-admin-token': t }, body: fd });
        const data = await res.json();
        if (res.ok) {
          ok++;
          const li = document.createElement('li');
          li.textContent = `${file.name} — 上传成功`;
          uploadResults.appendChild(li);
        } else {
          fail++;
          const li = document.createElement('li');
          li.textContent = `${file.name} — 失败：${data.error || '未知错误'}`;
          uploadResults.appendChild(li);
        }
      } catch (e) {
        fail++;
        const li = document.createElement('li');
        li.textContent = `${file.name} — 网络错误`;
        uploadResults.appendChild(li);
      }
    }
    // clear file input only after all uploads finish
    fileInput.value = '';
    uploadBtn.disabled = false;
    uploadBtn.textContent = originalText;
    uploadProgress.textContent = `上传完成：成功 ${ok} 张${fail ? `，失败 ${fail} 张` : ''}`;
    uploadProgress.className = fail > 0 ? 'msg err' : 'msg ok';
    uploading = false;
    await loadManage();
    reloadGalleryCache();
  });

  // --- moderate ---
  async function loadModerate() {
    const t = token();
    try {
      const res = await fetch('/api/admin/comments', { headers: { 'x-admin-token': t } });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const list = data.comments || [];
      renderModerate(list);
    } catch (e) { moderateList.innerHTML = '<div class="empty-list">加载失败</div>'; }
  }

  function renderModerate(list) {
    const pending = list.filter((c) => c.status === 'pending');
    pendingCount.textContent = pending.length;
    if (pending.length === 0) {
      moderateList.innerHTML = '<div class="empty-list">暂无待审核留言</div>';
      return;
    }
    moderateList.innerHTML = '';
    pending.forEach((c) => {
      const div = document.createElement('div');
      div.className = 'comment';
      div.innerHTML = `
        <div class="c-head">
          <span class="c-author">${escapeHtml(c.author)}</span>
          <span class="c-status status-pending">待审核</span>
          <span>${new Date(c.createdAt).toLocaleString()}</span>
        </div>
        <div class="c-text">${escapeHtml(c.text)}</div>
        <div class="hint" style="margin-top:4px">图片：${escapeHtml(c.image)}</div>
        <div class="actions">
          <button class="btn-approve" data-action="approve" data-id="${c.id}" data-image="${escapeHtml(c.image)}">通过</button>
          <button class="btn-reject" data-action="reject" data-id="${c.id}" data-image="${escapeHtml(c.image)}">拒绝</button>
        </div>`;
      moderateList.appendChild(div);
    });
  }

  moderateList.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const image = btn.dataset.image;
    btn.disabled = true;
    try {
      const res = await fetch('/api/admin/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token() },
        body: JSON.stringify({ action, id, image }),
      });
      if (res.ok) await loadModerate();
      else { btn.disabled = false; alert('操作失败'); }
    } catch (err) { btn.disabled = false; alert('网络错误'); }
  });

  // --- image review (pending user uploads) ---
  async function loadImageReview() {
    const t = token();
    try {
      const res = await fetch('/api/admin/pending', { headers: { 'x-admin-token': t } });
      if (!res.ok) throw new Error();
      const data = await res.json();
      renderImageReview(data.pendings || []);
    } catch (e) {
      imageReviewList.innerHTML = '<div class="empty-list">加载失败</div>';
    }
  }

  function renderImageReview(list) {
    const pending = list.filter((p) => p.status === 'pending');
    imagePendingCount.textContent = pending.length;
    if (pending.length === 0) {
      imageReviewList.innerHTML = '<div class="empty-list">暂无待审核图片</div>';
      return;
    }
    imageReviewList.innerHTML = '';
    pending.forEach((p) => {
      const div = document.createElement('div');
      div.className = 'review-item';
      div.innerHTML = `
        <label class="item-check"><input type="checkbox" class="review-check" value="${escapeHtml(p.key)}" /></label>
        <a class="review-thumb-link" href="/img/${encodeURIComponent(p.key)}" target="_blank" rel="noopener">
          <img class="review-thumb" src="/img/${encodeURIComponent(p.key)}?w=300" alt="" onerror="this.style.visibility='hidden'" />
        </a>
        <div class="review-info">
          <div class="c-head"><span class="c-author">${escapeHtml(p.uploader || '用户')}</span><span>${new Date(p.addedAt).toLocaleString()}</span></div>
          <div class="c-text">${escapeHtml(p.name)} · ${formatBytes(p.size)}</div>
          <div class="actions">
            <a class="btn-view" href="/img/${encodeURIComponent(p.key)}" target="_blank" rel="noopener">查看大图</a>
            <button class="btn-approve" data-a="approve" data-key="${escapeHtml(p.key)}">通过</button>
            <button class="btn-reject" data-a="reject" data-key="${escapeHtml(p.key)}">拒绝</button>
          </div>
        </div>`;
      imageReviewList.appendChild(div);
    });
  }

  imageReviewList.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-a]');
    if (!btn) return;
    const action = btn.dataset.a;
    const key = btn.dataset.key;
    btn.disabled = true;
    try {
      const res = await fetch('/api/admin/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token() },
        body: JSON.stringify({ action, key }),
      });
      if (res.ok) {
        await loadImageReview();
        await loadManage();
      } else {
        btn.disabled = false;
        alert('操作失败');
      }
    } catch (err) {
      btn.disabled = false;
      alert('网络错误');
    }
  });

  // --- bulk review ---
  const reviewSelectAll = document.getElementById('review-select-all');
  const reviewBulkApprove = document.getElementById('review-bulk-approve');
  const reviewBulkReject = document.getElementById('review-bulk-reject');

  function reviewSelectedKeys() {
    return Array.from(imageReviewList.querySelectorAll('.review-check:checked')).map((c) => c.value);
  }
  reviewSelectAll.addEventListener('change', () => {
    imageReviewList.querySelectorAll('.review-check').forEach((c) => { c.checked = reviewSelectAll.checked; });
  });

  async function bulkReview(action) {
    const keys = reviewSelectedKeys();
    if (keys.length === 0) { alert('请先勾选要操作的图片'); return; }
    if (!confirm(`确定要批量${action === 'approve' ? '通过' : '拒绝'}选中的 ${keys.length} 张图片吗？`)) return;
    const btn = action === 'approve' ? reviewBulkApprove : reviewBulkReject;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '处理中…';
    try {
      const res = await fetch('/api/admin/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token() },
        body: JSON.stringify({ action, keys }),
      });
      const data = await res.json();
      if (res.ok) {
        const ok = data.okCount || keys.length;
        const fail = data.failCount || 0;
        alert(`批量操作完成：成功 ${ok} 张${fail ? `，失败 ${fail} 张` : ''}`);
      } else {
        alert('操作失败：' + (data.error || '未知错误'));
      }
    } catch (e) {
      alert('网络错误');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
      reviewSelectAll.checked = false;
      await Promise.all([loadImageReview(), loadManage()]);
    }
  }
  reviewBulkApprove.addEventListener('click', () => bulkReview('approve'));
  reviewBulkReject.addEventListener('click', () => bulkReview('reject'));

  // --- manage ---
  const manageSearch = document.getElementById('manage-search');
  let manageImages = [];

  async function loadManage() {
    try {
      const all = [];
      let offset = 0;
      const PAGE = 100;
      while (true) {
        const res = await fetch(`/api/images?limit=${PAGE}&offset=${offset}`);
        const data = await res.json();
        const items = data.images || [];
        all.push(...items);
        offset += items.length;
        if (!data.total || offset >= data.total || items.length === 0) break;
      }
      manageImages = all;
      renderManage();
    } catch (e) { manageList.innerHTML = '<div class="empty-list">加载失败</div>'; }
  }

  function renderManage() {
    const q = (manageSearch.value || '').trim().toLowerCase();
    const list = manageImages.filter((img) => {
      if (!q) return true;
      return (img.name || '').toLowerCase().includes(q);
    });

    if (list.length === 0) {
      manageList.innerHTML = q
        ? '<div class="empty-list">没有匹配的图片</div>'
        : '<div class="empty-list">暂无图片</div>';
      return;
    }
    manageList.innerHTML = '';
    list.forEach((img) => {
      const div = document.createElement('div');
      div.className = 'manage-item';
      div.innerHTML = `
        <div class="manage-item-top">
          <label class="item-check"><input type="checkbox" class="manage-check" value="${escapeHtml(img.key)}" /></label>
          <img class="thumb" src="/img/${encodeURIComponent(img.key)}" alt="" onerror="this.style.visibility='hidden'" />
        </div>
        <div class="row">
          <a href="/img/${encodeURIComponent(img.key)}" target="_blank" download="${escapeHtml(img.name || img.key)}">下载</a>
          <button class="btn-delete-img" data-key="${escapeHtml(img.key)}">删除</button>
        </div>`;
      manageList.appendChild(div);
    });
  }

  manageSearch.addEventListener('input', renderManage);

  const manageSelectAll = document.getElementById('manage-select-all');
  const manageBulkDelete = document.getElementById('manage-bulk-delete');
  const manageBulkDownload = document.getElementById('manage-bulk-download');

  function manageSelectedKeys() {
    return Array.from(manageList.querySelectorAll('.manage-check:checked')).map((c) => c.value);
  }
  manageSelectAll.addEventListener('change', () => {
    manageList.querySelectorAll('.manage-check').forEach((c) => { c.checked = manageSelectAll.checked; });
  });

  function downloadBlob(url, filename) {
    return fetch(url)
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        const objectUrl = URL.createObjectURL(blob);
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      });
  }

  manageBulkDownload.addEventListener('click', async () => {
    const keys = manageSelectedKeys();
    if (keys.length === 0) { alert('请先勾选要下载的图片'); return; }
    const btn = manageBulkDownload;
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = '下载中…';
    let ok = 0, fail = 0;
    for (const key of keys) {
      const img = manageImages.find((i) => i.key === key);
      const filename = (img && img.name) || key;
      try {
        await downloadBlob(`/img/${encodeURIComponent(key)}`, filename);
        ok++;
      } catch (e) { fail++; }
    }
    btn.disabled = false;
    btn.textContent = originalText;
    if (fail > 0) alert(`批量下载完成：成功 ${ok} 张，失败 ${fail} 张`);
    else alert(`已下载 ${ok} 张图片`);
  });

  manageBulkDelete.addEventListener('click', async () => {
    const keys = manageSelectedKeys();
    if (keys.length === 0) { alert('请先勾选要删除的图片'); return; }
    if (!confirm(`确定要批量删除选中的 ${keys.length} 张图片吗？此操作不可恢复。`)) return;
    let ok = 0, fail = 0;
    for (const key of keys) {
      try {
        const res = await fetch('/api/admin/delete-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-token': token() },
          body: JSON.stringify({ key }),
        });
        if (res.ok) ok++; else fail++;
      } catch (e) { fail++; }
    }
    alert(`批量删除完成：成功 ${ok} 张，失败 ${fail} 张`);
    manageSelectAll.checked = false;
    await loadManage();
  });

  manageList.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-delete-img');
    if (!btn) return;
    const key = btn.dataset.key;
    if (!confirm(`确定删除图片 ${key} 吗？此操作不可恢复。`)) return;
    btn.disabled = true;
    btn.textContent = '删除中…';
    try {
      const res = await fetch('/api/admin/delete-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token() },
        body: JSON.stringify({ key }),
      });
      if (res.ok) {
        await loadManage();
      } else {
        btn.disabled = false;
        btn.textContent = '删除';
        alert('删除失败');
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '删除';
      alert('网络错误');
    }
  });

  // gallery cache bust
  function reloadGalleryCache() {
    if ('caches' in window) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
    }
  }

  // --- init ---
  if (token()) showPanel();
  if (token()) { loadModerate(); loadImageReview(); loadManage(); }
});

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${units[i]}`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

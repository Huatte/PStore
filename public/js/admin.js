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

  // --- auth ---
  function token() { return localStorage.getItem('pstore_admin_token') || ''; }
  async function setToken(t) {
    localStorage.setItem('pstore_admin_token', t);
    if (t) { showPanel(); await Promise.all([loadModerate(), loadManage()]); }
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
  uploadBtn.addEventListener('click', async () => {
    const files = Array.from(fileInput.files || []);
    if (files.length === 0) { uploadProgress.textContent = '请选择图片'; uploadProgress.className = 'msg err'; return; }
    uploadResults.innerHTML = '';
    uploadBtn.disabled = true;
    const t = token();
    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file);
      uploadProgress.textContent = `正在上传：${file.name}`;
      uploadProgress.className = 'msg';
      try {
        const res = await fetch('/api/upload', { method: 'POST', headers: { 'x-admin-token': t }, body: fd });
        const data = await res.json();
        if (res.ok) {
          const li = document.createElement('li');
          li.textContent = `${file.name} — 上传成功`;
          uploadResults.appendChild(li);
        } else {
          const li = document.createElement('li');
          li.textContent = `${file.name} — 失败：${data.error || '未知错误'}`;
          uploadResults.appendChild(li);
        }
      } catch (e) {
        const li = document.createElement('li');
        li.textContent = `${file.name} — 网络错误`;
        uploadResults.appendChild(li);
      }
      fileInput.value = '';
    }
    uploadBtn.disabled = false;
    uploadProgress.textContent = '上传完成';
    uploadProgress.className = 'msg ok';
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

  // --- manage ---
  async function loadManage() {
    try {
      const res = await fetch('/api/images');
      const data = await res.json();
      const list = data.images || [];
      if (list.length === 0) { manageList.innerHTML = '<div class="empty-list">暂无图片</div>'; return; }
      manageList.innerHTML = '';
      list.forEach((img) => {
        const div = document.createElement('div');
        div.className = 'manage-item';
        div.innerHTML = `
          <img class="thumb" src="/img/${encodeURIComponent(img.key)}" alt="" onerror="this.style.visibility='hidden'" />
          <div class="row">
            <a href="/img/${encodeURIComponent(img.key)}" target="_blank" download="${escapeHtml(img.name || img.key)}">下载</a>
          </div>`;
        manageList.appendChild(div);
      });
    } catch (e) { manageList.innerHTML = '<div class="empty-list">加载失败</div>'; }
  }

  // gallery cache bust
  function reloadGalleryCache() {
    if ('caches' in window) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
    }
  }

  // --- init ---
  if (token()) showPanel();
  if (token()) { loadModerate(); loadManage(); }
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

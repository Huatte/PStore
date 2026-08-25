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
  const moderateSearch = document.getElementById('moderate-search');
  const moderatePrev = document.getElementById('moderate-prev');
  const moderateNext = document.getElementById('moderate-next');
  const moderateInfo = document.getElementById('moderate-info');
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

  // --- upload helpers ---
  function formatSpeed(bytesPerSec) {
    if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
    if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
    return `${bytesPerSec} B/s`;
  }

  function createUploadItem(file) {
    const div = document.createElement('div');
    div.className = 'upload-item';
    div.innerHTML = `
      <div class="ui-head">
        <span class="ui-name">${escapeHtml(file.name)}</span>
        <span class="ui-status">等待中</span>
      </div>
      <div class="ui-bar"><div class="ui-fill" style="width:0%"></div></div>
      <div class="ui-meta"><span class="ui-speed">0 KB/s</span><span class="ui-pct">0%</span></div>`;
    uploadResults.appendChild(div);
    return {
      root: div,
      fill: div.querySelector('.ui-fill'),
      status: div.querySelector('.ui-status'),
      speedEl: div.querySelector('.ui-speed'),
      pctEl: div.querySelector('.ui-pct'),
    };
  }

  // Upload one file via XHR to get real progress events.
  function uploadFileXhr(file, url, headers, extraFields, ui) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.responseType = 'json';
      for (const k in headers) xhr.setRequestHeader(k, headers[k]);

      let lastLoaded = 0;
      let lastTime = Date.now();
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.round((e.loaded / e.total) * 100);
        const now = Date.now();
        const dt = (now - lastTime) / 1000;
        const speed = dt > 0 ? (e.loaded - lastLoaded) / dt : 0;
        lastLoaded = e.loaded;
        lastTime = now;
        if (ui) {
          ui.fill.style.width = pct + '%';
          ui.pctEl.textContent = pct + '%';
          ui.speedEl.textContent = formatSpeed(speed);
          ui.status.textContent = '上传中';
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
        else reject((xhr.response && xhr.response.error) || `HTTP ${xhr.status}`);
      };
      xhr.onerror = () => reject('网络错误');
      xhr.onabort = () => reject('已取消');

      const fd = new FormData();
      fd.append('file', file);
      for (const k in extraFields) fd.append(k, extraFields[k]);
      xhr.send(fd);
    });
  }

  // --- upload ---
  let uploading = false;
  let adminFailed = []; // { file, extra }

  function updateAdminRetryBtn() {
    const btn = document.getElementById('admin-retry-failed');
    if (!btn) return;
    if (adminFailed.length) {
      btn.classList.remove('hidden');
      btn.style.display = 'inline-block';
    } else {
      btn.classList.add('hidden');
      btn.style.display = 'none';
    }
    btn.textContent = `重试失败的上传 (${adminFailed.length})`;
  }

  async function runAdminUploads(uploads) {
    const MAX_CONCURRENT = 3;
    let ok = 0, fail = 0;
    const newlyFailed = [];

    const items = uploads.map(({ file }) => ({ file, ui: createUploadItem(file) }));
    uploadProgress.textContent = `开始上传 ${uploads.length} 个文件（并行）`;
    uploadProgress.className = 'msg';

    let cursor = 0;
    async function worker() {
      while (true) {
        const idx = cursor++;
        if (idx >= uploads.length) break;
        const { file, extra } = uploads[idx];
        const { ui } = items[idx];
        ui.status.textContent = '上传中';
        try {
          await uploadFileXhr(file, '/api/upload', { 'x-admin-token': token() }, extra, ui);
          ui.fill.style.width = '100%';
          ui.pctEl.textContent = '100%';
          ui.speedEl.textContent = '完成';
          ui.status.textContent = '成功';
          ui.status.classList.add('st-ok');
          ok++;
        } catch (err) {
          fail++;
          ui.status.textContent = '失败';
          ui.status.classList.add('st-err');
          ui.speedEl.textContent = err || '失败';
          newlyFailed.push({ file, extra });
        }
      }
    }

    const workerCount = Math.min(MAX_CONCURRENT, uploads.length);
    const workers = [];
    for (let i = 0; i < workerCount; i++) workers.push(worker());
    await Promise.all(workers);

    adminFailed = newlyFailed;
    updateAdminRetryBtn();
    uploadProgress.textContent = `上传完成：成功 ${ok} 张${fail ? `，失败 ${fail} 张` : ''}`;
    uploadProgress.className = fail > 0 ? 'msg err' : 'msg ok';
    await loadManage();
    reloadGalleryCache();
  }

  const adminRetryBtn = document.getElementById('admin-retry-failed');
  if (adminRetryBtn) {
    adminRetryBtn.addEventListener('click', () => {
      if (uploading || adminFailed.length === 0) return;
      const retries = adminFailed;
      uploadResults.innerHTML = '';
      runAdminUploads(retries);
    });
  }

  // Toggle the group-name field when switching admin upload mode
  document.querySelectorAll('input[name="admin-upload-mode"]').forEach((r) => {
    r.addEventListener('change', () => {
      const isMerge = document.querySelector('input[name="admin-upload-mode"]:checked').value === 'merge';
      const gn = document.getElementById('admin-upload-group-name');
      if (gn) gn.style.display = isMerge ? 'block' : 'none';
    });
  });

  uploadBtn.addEventListener('click', async () => {
    if (uploading) return; // block re-entry while an upload is in progress
    const files = Array.from(fileInput.files || []);
    if (files.length === 0) { uploadProgress.textContent = '请选择图片'; uploadProgress.className = 'msg err'; return; }

    const mode = document.querySelector('input[name="admin-upload-mode"]:checked').value;
    let groupName = '';
    if (mode === 'merge') {
      const gn = document.getElementById('admin-upload-group-name');
      groupName = gn.value.trim();
      if (!groupName) { uploadProgress.textContent = '请填写合集名称'; uploadProgress.className = 'msg err'; gn.focus(); return; }
    }

    const uploads = files.map((file) => {
      const extra = {};
      if (groupName) extra.groupName = groupName;
      return { file, extra };
    });

    uploading = true;
    uploadBtn.disabled = true;
    const originalText = uploadBtn.textContent;
    uploadBtn.textContent = '上传中…';
    uploadResults.innerHTML = '';

    await runAdminUploads(uploads);

    fileInput.value = '';
    uploadBtn.disabled = false;
    uploadBtn.textContent = originalText;
    uploading = false;
  });

  // --- moderate (comment management) ---
  const MODERATE_PAGE = 20;
  let modOffset = 0;
  let modTotal = 0;

  async function loadModerate() {
    const t = token();
    try {
      const q = (moderateSearch.value || '').trim();
      const params = new URLSearchParams({ limit: String(MODERATE_PAGE), offset: String(modOffset) });
      if (q) params.set('q', q);
      const res = await fetch(`/api/admin/comments?${params.toString()}`, { headers: { 'x-admin-token': t } });
      if (!res.ok) throw new Error();
      const data = await res.json();
      modTotal = data.total || 0;
      renderModerate(data.comments || []);
      moderateInfo.textContent = modTotal === 0 ? '0 条留言' : `第 ${modOffset + 1}-${Math.min(modOffset + MODERATE_PAGE, modTotal)} 条 / 共 ${modTotal} 条`;
      moderatePrev.disabled = modOffset <= 0;
      moderateNext.disabled = modOffset + MODERATE_PAGE >= modTotal;
    } catch (e) { moderateList.innerHTML = '<div class="empty-list">加载失败</div>'; }
  }

  function renderModerate(list) {
    if (list.length === 0) {
      moderateList.innerHTML = '<div class="empty-list">没有留言</div>';
      return;
    }
    moderateList.innerHTML = '';
    list.forEach((c) => {
      const div = document.createElement('div');
      div.className = 'comment';
      const statusMap = {
        visible: '<span class="c-status status-approved">显示中</span>',
        hidden: '<span class="c-status status-rejected">已隐藏</span>',
        deleted: '<span class="c-status status-rejected">已删除</span>',
      };
      div.innerHTML = `
        <div class="c-head">
          <span class="c-author">${escapeHtml(c.author)}</span>
          ${statusMap[c.status] || ''}
          <span>${new Date(c.createdAt).toLocaleString()}</span>
        </div>
        <div class="c-text">${escapeHtml(c.text)}</div>
        <div class="c-id">ID:${escapeHtml(c.id)}</div>
        <div class="hint" style="margin-top:4px">图片：${escapeHtml(c.image)}</div>
        <div class="actions">
          <button class="btn-reject" data-action="hide" data-id="${c.id}" data-image="${escapeHtml(c.image)}">隐藏</button>
          <button class="btn-approve" data-action="show" data-id="${c.id}" data-image="${escapeHtml(c.image)}">显示</button>
          <button class="btn-bulk-bad" data-action="delete" data-id="${c.id}" data-image="${escapeHtml(c.image)}">删除</button>
        </div>`;
      moderateList.appendChild(div);
    });
  }

  moderateSearch.addEventListener('input', () => {
    clearTimeout(moderateSearch._t);
    moderateSearch._t = setTimeout(() => { modOffset = 0; loadModerate(); }, 300);
  });
  moderatePrev.addEventListener('click', () => { if (modOffset > 0) { modOffset -= MODERATE_PAGE; loadModerate(); } });
  moderateNext.addEventListener('click', () => { if (modOffset + MODERATE_PAGE < modTotal) { modOffset += MODERATE_PAGE; loadModerate(); } });

  moderateList.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const image = btn.dataset.image;
    if (action === 'delete' && !confirm('确定删除这条留言吗？')) return;
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
        const res = await fetch(`/api/images?dedup=0&limit=${PAGE}&offset=${offset}`);
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
        <div class="manage-name" title="${escapeHtml(img.name || img.key)}">${escapeHtml(img.name || img.key)}</div>
        <div class="row">
          <button class="btn-rename-img" data-key="${escapeHtml(img.key)}">改名</button>
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
    const btn = manageBulkDelete;
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = '删除中…';
    try {
      const res = await fetch('/api/admin/delete-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token() },
        body: JSON.stringify({ keys }),
      });
      const data = await res.json();
      if (res.ok) alert(`批量删除完成：成功 ${data.count || keys.length} 张`);
      else alert('删除失败');
    } catch (e) { alert('网络错误'); }
    btn.disabled = false;
    btn.textContent = originalText;
    manageSelectAll.checked = false;
    await loadManage();
  });

  manageList.addEventListener('click', async (e) => {
    const renameBtn = e.target.closest('.btn-rename-img');
    if (renameBtn) {
      const key = renameBtn.dataset.key;
      const img = manageImages.find((i) => i.key === key);
      const currentName = (img && img.name) || key;
      const newName = prompt('输入新的图片名称：', currentName);
      if (newName === null) return;
      const trimmed = newName.trim();
      if (!trimmed) { alert('名称不能为空'); return; }
      renameBtn.disabled = true;
      try {
        const res = await fetch('/api/admin/rename-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-token': token() },
          body: JSON.stringify({ key, name: trimmed }),
        });
        if (res.ok) {
          await loadManage();
        } else {
          renameBtn.disabled = false;
          alert('改名失败');
        }
      } catch (err) {
        renameBtn.disabled = false;
        alert('网络错误');
      }
      return;
    }

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

  // --- groups (合集管理) ---
  const groupListEl = document.getElementById('group-list');
  const groupCreateBtn = document.getElementById('group-create-btn');

  async function loadGroups() {
    const t = token();
    try {
      const res = await fetch('/api/admin/groups', { headers: { 'x-admin-token': t } });
      if (!res.ok) throw new Error();
      const data = await res.json();
      renderGroups(data.groups || []);
    } catch (e) { groupListEl.innerHTML = '<div class="empty-list">加载失败</div>'; }
  }

  function renderGroups(groups) {
    if (groups.length === 0) {
      groupListEl.innerHTML = '<div class="empty-list">暂无合集，点击“新建合集”创建</div>';
      return;
    }
    groupListEl.innerHTML = '';
    groups.forEach((g) => {
      const div = document.createElement('div');
      div.className = 'group-card';
      div.innerHTML = `
        <div class="group-head">
          <span class="group-name">${escapeHtml(g.name)}</span>
          <span class="group-count">${g.count} 张图片</span>
          <span class="group-actions">
            <button class="btn-rename-group" data-id="${escapeHtml(g.id)}">重命名</button>
            <button class="btn-add-group-img" data-id="${escapeHtml(g.id)}">添加图片</button>
            <button class="btn-del-group" data-id="${escapeHtml(g.id)}">删除合集</button>
          </span>
        </div>
        <div class="group-members" id="gm-${escapeHtml(g.id)}"><span class="empty-list">加载成员中…</span></div>`;
      groupListEl.appendChild(div);
      loadGroupMembers(g.id, div.querySelector('.group-members'));
    });
  }

  const GROUP_PREVIEW_COUNT = 12;

  async function loadGroupMembers(id, container) {
    try {
      const res = await fetch(`/api/images?group=${encodeURIComponent(id)}`);
      const data = await res.json();
      const members = data.images || [];
      if (members.length === 0) {
        container.innerHTML = '<div class="empty-list">该合集暂无图片</div>';
        return;
      }
      container.dataset.members = JSON.stringify(members.map((m) => ({ key: m.key, name: m.name || m.key })));
      container.dataset.gid = id;
      renderGroupMembers(container, members, false);
    } catch (e) {
      container.innerHTML = '<div class="empty-list">加载失败</div>';
    }
  }

  function renderGroupMembers(container, members, expanded) {
    const id = container.dataset.gid;
    container.innerHTML = '';
    const shown = expanded ? members : members.slice(0, GROUP_PREVIEW_COUNT);
    shown.forEach((img) => {
      const item = document.createElement('div');
      item.className = 'group-member';
      item.innerHTML = `
        <img class="gm-thumb" src="/img/${encodeURIComponent(img.key)}" alt="" onerror="this.style.visibility='hidden'" />
        <span class="gm-name">${escapeHtml(img.name || img.key)}</span>
        <button class="btn-remove-group-img" data-id="${escapeHtml(id)}" data-key="${escapeHtml(img.key)}">移除</button>`;
      container.appendChild(item);
    });
    if (members.length > GROUP_PREVIEW_COUNT) {
      const toggle = document.createElement('button');
      toggle.className = 'btn-group-toggle';
      toggle.textContent = expanded ? `折叠（显示前 ${GROUP_PREVIEW_COUNT} 张）` : `展开全部（共 ${members.length} 张）`;
      toggle.addEventListener('click', () => renderGroupMembers(container, members, !expanded));
      container.appendChild(toggle);
    }
  }

  groupCreateBtn.addEventListener('click', async () => {
    const name = prompt('输入新合集名称：');
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) { alert('名称不能为空'); return; }
    try {
      const res = await fetch('/api/admin/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token() },
        body: JSON.stringify({ action: 'create', name: trimmed }),
      });
      if (res.ok) { await loadGroups(); }
      else alert('创建失败');
    } catch (e) { alert('网络错误'); }
  });

  groupListEl.addEventListener('click', async (e) => {
    const renameBtn = e.target.closest('.btn-rename-group');
    if (renameBtn) {
      const id = renameBtn.dataset.id;
      const name = prompt('输入新名称：');
      if (name === null) return;
      const trimmed = name.trim();
      if (!trimmed) { alert('名称不能为空'); return; }
      try {
        const res = await fetch('/api/admin/group', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-token': token() },
          body: JSON.stringify({ action: 'rename', id, name: trimmed }),
        });
        if (res.ok) await loadGroups();
        else alert('重命名失败');
      } catch (err) { alert('网络错误'); }
      return;
    }

    const delBtn = e.target.closest('.btn-del-group');
    if (delBtn) {
      const id = delBtn.dataset.id;
      if (!confirm('确定删除该合集吗？合集下的图片不会被删除，但会取消合集分组。')) return;
      try {
        const res = await fetch('/api/admin/group', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-token': token() },
          body: JSON.stringify({ action: 'delete', id }),
        });
        if (res.ok) { await loadGroups(); await loadManage(); }
        else alert('删除失败');
      } catch (err) { alert('网络错误'); }
      return;
    }

    const addBtn = e.target.closest('.btn-add-group-img');
    if (addBtn) {
      const id = addBtn.dataset.id;
      openGroupPicker(id);
      return;
    }

    const removeBtn = e.target.closest('.btn-remove-group-img');
    if (removeBtn) {
      const id = removeBtn.dataset.id;
      const key = removeBtn.dataset.key;
      if (!confirm('确定将该图片移出合集吗？')) return;
      try {
        const res = await fetch('/api/admin/group', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-token': token() },
          body: JSON.stringify({ action: 'remove', id, keys: [key] }),
        });
        if (res.ok) { await loadGroups(); await loadManage(); }
        else alert('移除失败');
      } catch (err) { alert('网络错误'); }
      return;
    }
  });

  // --- group image picker (visual multi-select from all images) ---
  const pickerModal = document.getElementById('group-picker-modal');
  const pickerSearch = document.getElementById('group-picker-search');
  const pickerGrid = document.getElementById('group-picker-grid');
  const pickerConfirm = document.getElementById('group-picker-confirm');
  const pickerClose = document.getElementById('group-picker-close');
  const pickerCount = document.getElementById('group-picker-count');
  let pickerGroupId = null;
  let pickerAllImages = [];
  let pickerLoading = false;
  const pickerSelected = new Set();

  const pickerUngrouped = document.getElementById('picker-ungrouped');
  const pickerTime = document.getElementById('picker-time');

  // Compute the 'from' timestamp for the selected time filter.
  function pickerFromTs() {
    const v = pickerTime ? pickerTime.value : '';
    if (!v) return '';
    const now = Date.now();
    if (v === 'today') {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return String(d.getTime());
    }
    if (v === '7d') return String(now - 7 * 24 * 3600 * 1000);
    if (v === '30d') return String(now - 30 * 24 * 3600 * 1000);
    return '';
  }

  // Load images for the picker. Combines search + filters.
  async function pickerLoad(q) {
    if (pickerLoading) return;
    pickerLoading = true;
    pickerGrid.innerHTML = '<div class="empty-list">加载中…</div>';
    try {
      const params = new URLSearchParams({ dedup: '0', limit: '100', offset: '0' });
      if (q) params.set('q', q);
      if (pickerUngrouped && pickerUngrouped.checked) params.set('ungrouped', '1');
      const fromTs = pickerFromTs();
      if (fromTs) params.set('from', fromTs);
      const res = await fetch(`/api/images?${params.toString()}`);
      const data = await res.json();
      pickerAllImages = data.images || [];
      renderPicker();
    } catch (e) {
      pickerGrid.innerHTML = '<div class="empty-list">加载失败</div>';
    } finally {
      pickerLoading = false;
    }
  }

  async function openGroupPicker(groupId) {
    pickerGroupId = groupId;
    pickerSelected.clear();
    pickerSearch.value = '';
    pickerModal.classList.remove('hidden');
    pickerCount.textContent = '已选 0 张';
    await pickerLoad('');
  }

  function renderPicker() {
    const list = pickerAllImages;
    pickerGrid.innerHTML = '';
    if (list.length === 0) {
      pickerGrid.innerHTML = '<div class="empty-list">没有匹配的图片</div>';
      return;
    }
    list.forEach((img) => {
      const label = document.createElement('label');
      label.className = 'picker-item';
      label.innerHTML = `
        <input type="checkbox" class="picker-check" value="${escapeHtml(img.key)}" ${pickerSelected.has(img.key) ? 'checked' : ''} />
        <img class="picker-thumb" src="/img/${encodeURIComponent(img.key)}" alt="" onerror="this.style.visibility='hidden'" />
        <span class="picker-name">${escapeHtml(img.name || img.key)}</span>`;
      label.querySelector('.picker-check').addEventListener('change', (e) => {
        if (e.target.checked) pickerSelected.add(img.key);
        else pickerSelected.delete(img.key);
        pickerCount.textContent = `已选 ${pickerSelected.size} 张`;
      });
      pickerGrid.appendChild(label);
    });
    pickerCount.textContent = `已选 ${pickerSelected.size} 张`;
  }

  let pickerDebounce = null;
  function pickerReload() {
    clearTimeout(pickerDebounce);
    pickerDebounce = setTimeout(() => pickerLoad((pickerSearch.value || '').trim()), 300);
  }
  pickerSearch.addEventListener('input', pickerReload);
  if (pickerUngrouped) pickerUngrouped.addEventListener('change', pickerReload);
  if (pickerTime) pickerTime.addEventListener('change', pickerReload);
  pickerClose.addEventListener('click', () => pickerModal.classList.add('hidden'));
  pickerModal.addEventListener('click', (e) => { if (e.target === pickerModal) pickerModal.classList.add('hidden'); });

  pickerConfirm.addEventListener('click', async () => {
    if (pickerSelected.size === 0) { alert('请先选择图片'); return; }
    const keys = Array.from(pickerSelected);
    pickerConfirm.disabled = true;
    try {
      const res = await fetch('/api/admin/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token() },
        body: JSON.stringify({ action: 'add', id: pickerGroupId, keys }),
      });
      if (res.ok) {
        pickerModal.classList.add('hidden');
        await loadGroups();
        await loadManage();
      } else alert('添加失败');
    } catch (err) { alert('网络错误'); }
    pickerConfirm.disabled = false;
  });

  // gallery cache bust
  function reloadGalleryCache() {
    if ('caches' in window) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
    }
  }

  // --- init ---
  if (token()) showPanel();
  if (token()) { loadModerate(); loadImageReview(); loadManage(); loadGroups(); }
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

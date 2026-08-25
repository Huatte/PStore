document.addEventListener('DOMContentLoaded', () => {
  const gallery = document.getElementById('gallery');
  const searchBox = document.getElementById('search-box');
  const statusEl = document.createElement('div');
  statusEl.className = 'empty';
  statusEl.textContent = '加载中…';

  const PAGE = 10;
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

  const shownGroups = new Set();
  const shownKeys = new Set();

  function appendImages(images) {
    images.forEach((img) => {
      // skip already-shown keys (dedup across pagination)
      if (shownKeys.has(img.key)) return;

      // if this image belongs to a group already displayed, skip it (group card shown once)
      if (img.group && shownGroups.has(img.group)) return;

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
      name.textContent = img.group ? `${img.name || img.key}` : (img.name || img.key);

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
      if (img.group) shownGroups.add(img.group);
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
      } else if (done) {
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
      shownKeys.clear();
      shownGroups.clear();
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

  // --- user upload modal ---
  const modal = document.getElementById('upload-modal');
  const openBtn = document.getElementById('upload-open');
  const closeBtn = document.getElementById('upload-close');
  const uploadFile = document.getElementById('upload-file');
  const uploadNick = document.getElementById('upload-nickname');
  const uploadSubmit = document.getElementById('upload-submit');
  const uploadMsg = document.getElementById('upload-msg');
  const uploadList = document.getElementById('upload-list');

  let uploading = false;

  function showUploadMsg(text, cls) {
    uploadMsg.textContent = text;
    uploadMsg.className = `msg ${cls}`;
  }

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
    uploadList.appendChild(div);
    return {
      root: div,
      fill: div.querySelector('.ui-fill'),
      status: div.querySelector('.ui-status'),
      speedEl: div.querySelector('.ui-speed'),
      pctEl: div.querySelector('.ui-pct'),
    };
  }

  // Upload one file via XHR to get real progress events.
  function uploadFileXhr(file, extraFields, ui) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/user/upload');
      xhr.responseType = 'json';

      let lastLoaded = 0;
      let lastTime = Date.now();
      const startTime = Date.now();
      let simulatePct = 0;

      // Fallback simulation so the bar always moves even if the browser
      // doesn't fire lengthComputable progress events (common behind proxies/CDN).
      const simTimer = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        // ease toward ~90% then slow down; real completion is set on load
        const target = 90;
        simulatePct = Math.min(target, simulatePct + Math.max(0.3, (target - simulatePct) * 0.15));
        const pct = Math.round(simulatePct);
        // estimated speed = bytes transferred so far / elapsed
        const estimatedBytes = file.size * (simulatePct / 100);
        const speed = elapsed > 0 ? estimatedBytes / elapsed : 0;
        if (ui) {
          ui.fill.style.width = pct + '%';
          ui.pctEl.textContent = pct + '%';
          ui.speedEl.textContent = formatSpeed(speed);
          ui.status.textContent = '上传中';
        }
      }, 200);

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        clearInterval(simTimer);
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
        clearInterval(simTimer);
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
        else reject((xhr.response && xhr.response.error) || `HTTP ${xhr.status}`);
      };
      xhr.onerror = () => { clearInterval(simTimer); reject('网络错误'); };
      xhr.onabort = () => { clearInterval(simTimer); reject('已取消'); };

      const fd = new FormData();
      fd.append('file', file);
      for (const k in extraFields) fd.append(k, extraFields[k]);
      xhr.send(fd);
    });
  }

  openBtn.addEventListener('click', () => { if (!uploading) modal.classList.remove('hidden'); });
  closeBtn.addEventListener('click', () => { if (!uploading) modal.classList.add('hidden'); });
  modal.addEventListener('click', (e) => { if (e.target === modal && !uploading) modal.classList.add('hidden'); });

  uploadSubmit.addEventListener('click', async () => {
    if (uploading) return; // block while an upload is in progress
    const files = Array.from(uploadFile.files || []);
    if (files.length === 0) { showUploadMsg('请先选择图片', 'err'); return; }

    const mode = document.querySelector('input[name="upload-mode"]:checked').value;
    // one group id shared by all files when merging
    const group = mode === 'merge' ? `g${Date.now()}${Math.random().toString(36).slice(2, 8)}` : '';

    uploading = true;
    uploadSubmit.disabled = true;
    uploadSubmit.textContent = '上传中…';
    uploadList.innerHTML = '';

    let ok = 0, fail = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      showUploadMsg(`正在上传 ${i + 1}/${files.length}`, '');
      const ui = createUploadItem(file);
      const extra = { uploader: uploadNick.value || '' };
      if (group) extra.group = group;
      try {
        const data = await uploadFileXhr(file, extra, ui);
        ui.fill.style.width = '100%';
        ui.pctEl.textContent = '100%';
        ui.speedEl.textContent = '完成';
        ui.status.textContent = '成功';
        ui.status.classList.add('st-ok');
        ok++;
      } catch (err) {
        ui.status.textContent = '失败';
        ui.status.classList.add('st-err');
        ui.speedEl.textContent = err || '失败';
        fail++;
      }
    }

    uploading = false;
    uploadSubmit.disabled = false;
    uploadSubmit.textContent = '提交审核';
    if (fail === 0) {
      showUploadMsg(`上传成功 ${ok} 张，等待管理员审核。`, 'ok');
      uploadFile.value = '';
    } else {
      showUploadMsg(`完成：成功 ${ok} 张，失败 ${fail} 张`, 'err');
    }
  });

  // initial load
  loadMore();
});
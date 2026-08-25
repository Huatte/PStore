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
      setStatus(q ? '搜索中…' : '加载中…');
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
      } else if (!done) {
        setStatus('加载中…');
      } else {
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

  let uploading = false;

  function showUploadMsg(text, cls) {
    uploadMsg.textContent = text;
    uploadMsg.className = `msg ${cls}`;
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

    let ok = 0, fail = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      showUploadMsg(`正在上传 ${i + 1}/${files.length}：${file.name}`, '');
      const fd = new FormData();
      fd.append('file', file);
      fd.append('uploader', uploadNick.value || '');
      if (group) fd.append('group', group);
      try {
        const res = await fetch('/api/user/upload', { method: 'POST', body: fd });
        const data = await res.json();
        if (res.ok) ok++;
        else {
          fail++;
          showUploadMsg(`${file.name} 失败：${data.error || '未知错误'}`, 'err');
        }
      } catch (e) {
        fail++;
        showUploadMsg(`${file.name} 失败：网络错误`, 'err');
      }
    }

    uploading = false;
    uploadSubmit.disabled = false;
    uploadSubmit.textContent = '提交审核';
    if (fail === 0) {
      showUploadMsg(`上传成功 ${ok} 张，等待管理员审核。`, 'ok');
      uploadFile.value = '';
    } else {
      showUploadMsg(`完成：成功 ${ok} 张，失败 ${fail} 张`, fail > 0 ? 'err' : 'ok');
    }
  });

  // initial load
  loadMore();
});
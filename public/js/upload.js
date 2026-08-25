document.addEventListener('DOMContentLoaded', () => {
  const uploadFile = document.getElementById('upload-file');
  const uploadNick = document.getElementById('upload-nickname');
  const uploadSubmit = document.getElementById('upload-submit');
  const uploadMsg = document.getElementById('upload-msg');
  const uploadList = document.getElementById('upload-list');
  const uploadGroupName = document.getElementById('upload-group-name');
  const retryBtn = document.getElementById('retry-failed');

  // Toggle the group-name field when switching upload mode
  document.querySelectorAll('input[name="upload-mode"]').forEach((r) => {
    r.addEventListener('change', () => {
      const isMerge = document.querySelector('input[name="upload-mode"]:checked').value === 'merge';
      if (uploadGroupName) uploadGroupName.style.display = isMerge ? 'block' : 'none';
    });
  });

  let uploading = false;
  let failedUploads = []; // each: { file, extra }

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
        const target = 90;
        simulatePct = Math.min(target, simulatePct + Math.max(0.3, (target - simulatePct) * 0.15));
        const pct = Math.round(simulatePct);
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

  // Show/hide the retry button based on pending failures
  function updateRetryBtn() {
    if (!retryBtn) return;
    if (failedUploads.length) {
      retryBtn.classList.remove('hidden');
      retryBtn.style.display = 'inline-block';
    } else {
      retryBtn.classList.add('hidden');
      retryBtn.style.display = 'none';
    }
    retryBtn.textContent = `重试失败的上传 (${failedUploads.length})`;
  }

  // Upload all files in parallel (limited concurrency to avoid hammering the
  // GitHub API / Cloudflare). Each file gets its own progress bar.
  async function runUploads(uploads) {
    const MAX_CONCURRENT = 3;
    let ok = 0, fail = 0;
    const newlyFailed = [];

    // Create UI entries for all files up front
    const items = uploads.map(({ file }) => ({ file, ui: createUploadItem(file) }));
    showUploadMsg(`开始上传 ${uploads.length} 个文件（并行）`, '');

    let cursor = 0;
    async function worker() {
      while (true) {
        const idx = cursor++;
        if (idx >= uploads.length) break;
        const { file, extra } = uploads[idx];
        const { ui } = items[idx];
        ui.status.textContent = '上传中';
        try {
          await uploadFileXhr(file, extra, ui);
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
          newlyFailed.push({ file, extra });
        }
      }
    }

    // Start N concurrent workers
    const workerCount = Math.min(MAX_CONCURRENT, uploads.length);
    const workers = [];
    for (let i = 0; i < workerCount; i++) workers.push(worker());
    await Promise.all(workers);

    failedUploads = newlyFailed;
    updateRetryBtn();
    if (fail === 0) {
      showUploadMsg(`上传成功 ${ok} 张，等待管理员审核。`, 'ok');
      uploadFile.value = '';
    } else {
      showUploadMsg(`完成：成功 ${ok} 张，失败 ${fail} 张`, 'err');
    }
  }

  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      if (uploading || failedUploads.length === 0) return;
      const retries = failedUploads;
      uploadList.innerHTML = '';
      runUploads(retries);
    });
  }

  uploadSubmit.addEventListener('click', async () => {
    if (uploading) return; // block while an upload is in progress
    const files = Array.from(uploadFile.files || []);
    if (files.length === 0) { showUploadMsg('请先选择图片', 'err'); return; }
    const nickname = uploadNick.value.trim();
    if (!nickname) { showUploadMsg('请填写昵称', 'err'); uploadNick.focus(); return; }

    const mode = document.querySelector('input[name="upload-mode"]:checked').value;
    let groupName = '';
    if (mode === 'merge') {
      groupName = uploadGroupName.value.trim();
      if (!groupName) { showUploadMsg('请填写合集名称', 'err'); uploadGroupName.focus(); return; }
    }

    const uploads = files.map((file) => {
      const extra = { uploader: nickname };
      if (groupName) extra.groupName = groupName;
      return { file, extra };
    });

    uploading = true;
    uploadSubmit.disabled = true;
    uploadSubmit.textContent = '上传中…';
    uploadList.innerHTML = '';

    await runUploads(uploads);

    uploading = false;
    uploadSubmit.disabled = false;
    uploadSubmit.textContent = '提交审核';
  });
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

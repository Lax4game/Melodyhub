/**
 * MelodyHub - Frontend Application
 * YouTube/TikTok Downloader & Audio Studio
 */

// ==================== STATE ====================
const state = {
    yt: { format: 'mp4', quality: '720p', taskId: null, title: '' },
    tt: { format: 'mp4', taskId: null, title: '' },
    convert: { file: null, format: 'wav', bitrate: '320k', taskId: null },
    separate: { file: null, model: 'htdemucs', stems: 'all', taskId: null, stemFiles: {} }
};

// ==================== TAB NAVIGATION ====================
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
});

function switchStudioTab(tab) {
    document.querySelectorAll('.studio-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.studio-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`[data-subtab="${tab}"]`).classList.add('active');
    document.getElementById(`subtab-${tab}`).classList.add('active');
}

// ==================== HELPERS ====================
function formatDuration(seconds) {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatNumber(n) {
    if (!n) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
}

function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes > 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
    if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes > 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return bytes + ' B';
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icons = { error: 'fa-circle-xmark', success: 'fa-circle-check', info: 'fa-circle-info' };
    toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(40px)'; setTimeout(() => toast.remove(), 300); }, 4000);
}

function setLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (loading) { btn.classList.add('loading'); btn.disabled = true; }
    else { btn.classList.remove('loading'); btn.disabled = false; }
}

async function apiPost(url, data) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return res.json();
}

async function apiPostForm(url, formData) {
    const res = await fetch(url, { method: 'POST', body: formData });
    return res.json();
}

function pollTask(taskId, onProgress, onComplete, onError) {
    const interval = setInterval(async () => {
        try {
            const res = await fetch(`/api/task/${taskId}`);
            const data = await res.json();
            if (data.status === 'processing') { onProgress(data); }
            else if (data.status === 'completed') { clearInterval(interval); onComplete(data); }
            else if (data.status === 'error') { clearInterval(interval); onError(data.message); }
        } catch (e) { clearInterval(interval); onError('Mất kết nối đến server'); }
    }, 1000);
    return interval;
}

// ==================== YOUTUBE ====================
async function fetchYouTubeInfo() {
    const url = document.getElementById('yt-url').value.trim();
    if (!url) { showToast('Vui lòng nhập URL YouTube', 'error'); return; }

    setLoading('yt-fetch-btn', true);
    document.getElementById('yt-result').classList.add('hidden');

    try {
        const data = await apiPost('/api/youtube/info', { url });
        if (data.error) { showToast(data.error, 'error'); return; }

        state.yt.title = data.title;
        document.getElementById('yt-thumbnail').src = data.thumbnail;
        document.getElementById('yt-title').textContent = data.title;
        document.getElementById('yt-duration').textContent = formatDuration(data.duration);
        document.getElementById('yt-uploader').innerHTML = `<i class="fas fa-user"></i> ${data.uploader}`;
        document.getElementById('yt-views').innerHTML = `<i class="fas fa-eye"></i> ${formatNumber(data.view_count)} lượt xem`;

        // Render quality options
        const qualityList = document.getElementById('yt-quality-list');
        qualityList.innerHTML = '';
        const videoFormats = data.formats.filter(f => f.height > 0);
        videoFormats.forEach((f, i) => {
            const btn = document.createElement('button');
            btn.className = `quality-btn${i === 0 ? ' active' : ''}`;
            btn.dataset.quality = f.quality;
            const sizeStr = f.filesize ? ` (${formatFileSize(f.filesize)})` : '';
            btn.textContent = f.quality + sizeStr;
            btn.onclick = () => selectQuality(btn);
            qualityList.appendChild(btn);
        });

        if (videoFormats.length > 0) state.yt.quality = videoFormats[0].quality;

        document.getElementById('yt-result').classList.remove('hidden');
        showToast('Phân tích video thành công!', 'success');
    } catch (e) {
        showToast('Lỗi kết nối đến server', 'error');
    } finally {
        setLoading('yt-fetch-btn', false);
    }
}

function selectQuality(btn) {
    document.querySelectorAll('#yt-quality-list .quality-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.yt.quality = btn.dataset.quality;
}

function selectYTFormat(fmt) {
    state.yt.format = fmt;
    document.getElementById('yt-format-mp4').classList.toggle('active', fmt === 'mp4');
    document.getElementById('yt-format-mp3').classList.toggle('active', fmt === 'mp3');
    document.getElementById('yt-quality-group').classList.toggle('hidden', fmt === 'mp3');
}

async function downloadYouTube() {
    const url = document.getElementById('yt-url').value.trim();
    if (!url) return;

    setLoading('yt-download-btn', true);
    const progressEl = document.getElementById('yt-progress');
    const actionsEl = document.getElementById('yt-download-actions');
    progressEl.classList.remove('hidden');
    actionsEl.classList.add('hidden');

    try {
        const data = await apiPost('/api/youtube/download', {
            url, quality: state.yt.quality, format: state.yt.format
        });

        if (data.error) { showToast(data.error, 'error'); setLoading('yt-download-btn', false); return; }

        state.yt.taskId = data.task_id;

        pollTask(data.task_id,
            (d) => {
                document.getElementById('yt-progress-bar').style.width = d.progress + '%';
                document.getElementById('yt-progress-pct').textContent = Math.round(d.progress) + '%';
                document.getElementById('yt-progress-label').textContent = d.message;
            },
            (d) => {
                document.getElementById('yt-progress-bar').style.width = '100%';
                document.getElementById('yt-progress-pct').textContent = '100%';
                document.getElementById('yt-progress-label').textContent = 'Tải xong!';
                const ext = state.yt.format;
                const safeName = state.yt.title.replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF\s\-_.]/g, '').trim() || 'video';
                const downloadUrl = `/api/download/${d.filename}?name=${encodeURIComponent(safeName + '.' + ext)}`;
                const link = document.getElementById('yt-download-link');
                link.href = downloadUrl;
                actionsEl.classList.remove('hidden');
                setLoading('yt-download-btn', false);
                showToast('Tải video thành công!', 'success');
                openDownloadModal(safeName + '.' + ext, ext, state.yt.quality, 'YouTube', downloadUrl);
            },
            (msg) => {
                document.getElementById('yt-progress-label').textContent = msg;
                setLoading('yt-download-btn', false);
                showToast(msg, 'error');
            }
        );
    } catch (e) {
        showToast('Lỗi kết nối', 'error');
        setLoading('yt-download-btn', false);
    }
}

// ==================== TIKTOK ====================
async function fetchTikTokInfo() {
    const url = document.getElementById('tt-url').value.trim();
    if (!url) { showToast('Vui lòng nhập URL TikTok', 'error'); return; }

    setLoading('tt-fetch-btn', true);
    document.getElementById('tt-result').classList.add('hidden');

    try {
        const data = await apiPost('/api/tiktok/info', { url });
        if (data.error) { showToast(data.error, 'error'); return; }

        state.tt.title = data.title;
        document.getElementById('tt-thumbnail').src = data.thumbnail;
        document.getElementById('tt-title').textContent = data.title;
        document.getElementById('tt-duration').textContent = formatDuration(data.duration);
        document.getElementById('tt-uploader').innerHTML = `<i class="fas fa-user"></i> ${data.uploader}`;
        document.getElementById('tt-likes').innerHTML = `<i class="fas fa-heart"></i> ${formatNumber(data.like_count)} likes`;

        document.getElementById('tt-result').classList.remove('hidden');
        showToast('Phân tích video TikTok thành công!', 'success');
    } catch (e) {
        showToast('Lỗi kết nối đến server', 'error');
    } finally {
        setLoading('tt-fetch-btn', false);
    }
}

function selectTTFormat(fmt) {
    state.tt.format = fmt;
    document.getElementById('tt-format-mp4').classList.toggle('active', fmt === 'mp4');
    document.getElementById('tt-format-mp3').classList.toggle('active', fmt === 'mp3');
}

async function downloadTikTok() {
    const url = document.getElementById('tt-url').value.trim();
    if (!url) return;

    setLoading('tt-download-btn', true);
    const progressEl = document.getElementById('tt-progress');
    const actionsEl = document.getElementById('tt-download-actions');
    progressEl.classList.remove('hidden');
    actionsEl.classList.add('hidden');

    try {
        const data = await apiPost('/api/tiktok/download', { url, format: state.tt.format });
        if (data.error) { showToast(data.error, 'error'); setLoading('tt-download-btn', false); return; }

        state.tt.taskId = data.task_id;
        pollTask(data.task_id,
            (d) => {
                document.getElementById('tt-progress-bar').style.width = d.progress + '%';
                document.getElementById('tt-progress-pct').textContent = Math.round(d.progress) + '%';
                document.getElementById('tt-progress-label').textContent = d.message;
            },
            (d) => {
                document.getElementById('tt-progress-bar').style.width = '100%';
                document.getElementById('tt-progress-pct').textContent = '100%';
                document.getElementById('tt-progress-label').textContent = 'Tải xong!';
                const ext = state.tt.format;
                const safeName = (state.tt.title || 'tiktok_video').substring(0, 50).replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF\s\-_.]/g, '').trim() || 'tiktok';
                const downloadUrl = `/api/download/${d.filename}?name=${encodeURIComponent(safeName + '.' + ext)}`;
                const link = document.getElementById('tt-download-link');
                link.href = downloadUrl;
                actionsEl.classList.remove('hidden');
                setLoading('tt-download-btn', false);
                showToast('Tải video TikTok thành công!', 'success');
                openDownloadModal(safeName + '.' + ext, ext, 'Original', 'TikTok', downloadUrl);
            },
            (msg) => {
                document.getElementById('tt-progress-label').textContent = msg;
                setLoading('tt-download-btn', false);
                showToast(msg, 'error');
            }
        );
    } catch (e) {
        showToast('Lỗi kết nối', 'error');
        setLoading('tt-download-btn', false);
    }
}

// ==================== AUDIO CONVERT ====================
const convertInput = document.getElementById('convert-file-input');
const convertDrop = document.getElementById('convert-drop-area');

convertInput.addEventListener('change', (e) => { if (e.target.files[0]) setConvertFile(e.target.files[0]); });

convertDrop.addEventListener('dragover', (e) => { e.preventDefault(); convertDrop.classList.add('drag-over'); });
convertDrop.addEventListener('dragleave', () => convertDrop.classList.remove('drag-over'));
convertDrop.addEventListener('drop', (e) => {
    e.preventDefault(); convertDrop.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) setConvertFile(e.dataTransfer.files[0]);
});
convertDrop.addEventListener('click', () => convertInput.click());

function setConvertFile(file) {
    state.convert.file = file;
    document.getElementById('convert-file-name').textContent = file.name;
    document.getElementById('convert-file-size').textContent = formatFileSize(file.size);
    document.getElementById('convert-drop-area').classList.add('hidden');
    document.getElementById('convert-file-preview').classList.remove('hidden');
    document.getElementById('convert-options').classList.remove('hidden');
}

function removeConvertFile() {
    state.convert.file = null;
    convertInput.value = '';
    document.getElementById('convert-drop-area').classList.remove('hidden');
    document.getElementById('convert-file-preview').classList.add('hidden');
    document.getElementById('convert-options').classList.add('hidden');
}

function selectConvertFormat(btn) {
    document.querySelectorAll('.format-card').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.convert.format = btn.dataset.fmt;
    // Show/hide bitrate for lossy formats
    const lossyFormats = ['mp3', 'ogg', 'aac', 'wma'];
    document.getElementById('bitrate-group').classList.toggle('hidden', !lossyFormats.includes(btn.dataset.fmt));
}

function selectBitrate(btn) {
    document.querySelectorAll('.bitrate-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.convert.bitrate = btn.dataset.bitrate;
}

async function convertAudio() {
    if (!state.convert.file) { showToast('Vui lòng chọn file nhạc', 'error'); return; }

    setLoading('convert-btn', true);
    const progressEl = document.getElementById('convert-progress');
    const actionsEl = document.getElementById('convert-download-actions');
    progressEl.classList.remove('hidden');
    actionsEl.classList.add('hidden');

    const formData = new FormData();
    formData.append('file', state.convert.file);
    formData.append('format', state.convert.format);
    formData.append('bitrate', state.convert.bitrate);

    try {
        const data = await apiPostForm('/api/audio/convert', formData);
        if (data.error) { showToast(data.error, 'error'); setLoading('convert-btn', false); return; }

        state.convert.taskId = data.task_id;
        pollTask(data.task_id,
            (d) => {
                document.getElementById('convert-progress-bar').style.width = d.progress + '%';
                document.getElementById('convert-progress-pct').textContent = Math.round(d.progress) + '%';
                document.getElementById('convert-progress-label').textContent = d.message;
            },
            (d) => {
                document.getElementById('convert-progress-bar').style.width = '100%';
                document.getElementById('convert-progress-pct').textContent = '100%';
                document.getElementById('convert-progress-label').textContent = 'Chuyển đổi xong!';
                const origName = state.convert.file.name.replace(/\.[^.]+$/, '');
                const downloadUrl = `/api/download/${d.filename}?name=${encodeURIComponent(origName + '.' + state.convert.format)}`;
                const link = document.getElementById('convert-download-link');
                link.href = downloadUrl;
                actionsEl.classList.remove('hidden');
                setLoading('convert-btn', false);
                showToast('Chuyển đổi thành công!', 'success');
                openDownloadModal(origName + '.' + state.convert.format, state.convert.format, state.convert.bitrate, 'Audio Studio', downloadUrl);
            },
            (msg) => {
                document.getElementById('convert-progress-label').textContent = msg;
                setLoading('convert-btn', false);
                showToast(msg, 'error');
            }
        );
    } catch (e) {
        showToast('Lỗi kết nối', 'error');
        setLoading('convert-btn', false);
    }
}

// ==================== AUDIO SEPARATE ====================
const separateInput = document.getElementById('separate-file-input');
const separateDrop = document.getElementById('separate-drop-area');

separateInput.addEventListener('change', (e) => { if (e.target.files[0]) setSeparateFile(e.target.files[0]); });

separateDrop.addEventListener('dragover', (e) => { e.preventDefault(); separateDrop.classList.add('drag-over'); });
separateDrop.addEventListener('dragleave', () => separateDrop.classList.remove('drag-over'));
separateDrop.addEventListener('drop', (e) => {
    e.preventDefault(); separateDrop.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) setSeparateFile(e.dataTransfer.files[0]);
});
separateDrop.addEventListener('click', () => separateInput.click());

function setSeparateFile(file) {
    if (file.size > 100 * 1024 * 1024) { showToast('File quá lớn! Tối đa 100MB', 'error'); return; }
    state.separate.file = file;
    document.getElementById('separate-file-name').textContent = file.name;
    document.getElementById('separate-file-size').textContent = formatFileSize(file.size);
    document.getElementById('separate-drop-area').classList.add('hidden');
    document.getElementById('separate-file-preview').classList.remove('hidden');
    document.getElementById('separate-options').classList.remove('hidden');
}

function removeSeparateFile() {
    state.separate.file = null;
    separateInput.value = '';
    document.getElementById('separate-drop-area').classList.remove('hidden');
    document.getElementById('separate-file-preview').classList.add('hidden');
    document.getElementById('separate-options').classList.add('hidden');
}

function selectModel(btn) {
    document.querySelectorAll('.model-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.separate.model = btn.dataset.model;
}

function selectStems(btn) {
    document.querySelectorAll('.stems-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.separate.stems = btn.dataset.stems;
}

const stemLabels = {
    vocals: { name: 'Vocals', desc: 'Giọng hát', icon: 'fa-microphone-alt' },
    drums: { name: 'Drums', desc: 'Trống & Percussion', icon: 'fa-drum' },
    bass: { name: 'Bass', desc: 'Bass Guitar & Sub', icon: 'fa-guitar' },
    other: { name: 'Other', desc: 'Nhạc cụ khác', icon: 'fa-music' },
    no_vocals: { name: 'Instrumental', desc: 'Nhạc nền (không giọng)', icon: 'fa-sliders' }
};

async function separateAudio() {
    if (!state.separate.file) { showToast('Vui lòng chọn file nhạc', 'error'); return; }

    setLoading('separate-btn', true);
    const progressEl = document.getElementById('separate-progress');
    const resultEl = document.getElementById('stems-result');
    progressEl.classList.remove('hidden');
    resultEl.classList.add('hidden');

    const formData = new FormData();
    formData.append('file', state.separate.file);
    formData.append('model', state.separate.model);
    formData.append('stems', state.separate.stems);

    try {
        const data = await apiPostForm('/api/audio/separate', formData);
        if (data.error) { showToast(data.error, 'error'); setLoading('separate-btn', false); return; }

        state.separate.taskId = data.task_id;
        pollTask(data.task_id,
            (d) => {
                document.getElementById('separate-progress-bar').style.width = d.progress + '%';
                document.getElementById('separate-progress-pct').textContent = Math.round(d.progress) + '%';
                document.getElementById('separate-progress-label').textContent = d.message;
            },
            (d) => {
                progressEl.classList.add('hidden');
                setLoading('separate-btn', false);

                state.separate.stemFiles = d.stems;
                const grid = document.getElementById('stems-grid');
                grid.innerHTML = '';
                const origName = state.separate.file.name.replace(/\.[^.]+$/, '');

                for (const [stemKey, filename] of Object.entries(d.stems)) {
                    const label = stemLabels[stemKey] || { name: stemKey, desc: '', icon: 'fa-file-audio' };
                    const card = document.createElement('div');
                    card.className = 'stem-card';
                    card.innerHTML = `
                        <div class="stem-icon stem-${stemKey}"><i class="fas ${label.icon}"></i></div>
                        <div class="stem-info">
                            <div class="stem-name">${label.name}</div>
                            <div class="stem-desc">${label.desc}</div>
                        </div>
                        <a class="stem-download" href="/api/download/${filename}?name=${encodeURIComponent(origName + '_' + label.name + '.mp3')}" download title="Tải ${label.name}">
                            <i class="fas fa-download"></i>
                        </a>`;
                    grid.appendChild(card);
                }

                resultEl.classList.remove('hidden');
                showToast('Tách nhạc AI thành công!', 'success');
            },
            (msg) => {
                document.getElementById('separate-progress-label').textContent = msg;
                setLoading('separate-btn', false);
                showToast(msg, 'error');
            }
        );
    } catch (e) {
        showToast('Lỗi kết nối', 'error');
        setLoading('separate-btn', false);
    }
}

function downloadAllStems() {
    for (const [stemKey, filename] of Object.entries(state.separate.stemFiles)) {
        const label = stemLabels[stemKey] || { name: stemKey };
        const origName = state.separate.file ? state.separate.file.name.replace(/\.[^.]+$/, '') : 'audio';
        const a = document.createElement('a');
        a.href = `/api/download/${filename}?name=${encodeURIComponent(origName + '_' + label.name + '.mp3')}`;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        a.remove();
    }
}

// ==================== DOWNLOAD MODAL ====================
function openDownloadModal(filename, format, quality, source, downloadUrl) {
    const modal = document.getElementById('download-modal');
    document.getElementById('modal-filename').textContent = filename;
    document.getElementById('modal-format').textContent = format.toUpperCase();
    
    const qualityRow = document.getElementById('modal-quality-row');
    if (quality && format.toLowerCase() === 'mp4') {
        qualityRow.classList.remove('hidden');
        document.getElementById('modal-quality').textContent = quality;
    } else {
        qualityRow.classList.add('hidden');
    }
    
    document.getElementById('modal-source').textContent = source;
    document.getElementById('modal-download-btn').href = downloadUrl;
    
    modal.classList.remove('hidden');
}

function closeDownloadModal() {
    document.getElementById('download-modal').classList.add('hidden');
}

// ==================== ENTER KEY SUPPORT ====================
document.getElementById('yt-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchYouTubeInfo(); });
document.getElementById('tt-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchTikTokInfo(); });

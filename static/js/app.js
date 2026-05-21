/**
 * MelodyHub - Frontend Application
 * Multi-Platform Media Downloader
 */

// ==================== STATE ====================
const state = {
    yt: { format: 'mp4', quality: '720p', taskId: null, title: '' },
    tt: { format: 'mp4', taskId: null, title: '' },
    ig: { format: 'mp4', taskId: null, title: '' },
    sc: { taskId: null, title: '' },
    pin: { taskId: null, title: '' },
    fb: { format: 'mp4', taskId: null, title: '' }
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

// ==================== GENERIC PLATFORM DOWNLOAD ====================
// This is a reusable function for platforms that share the same flow:
// fetchInfo -> show preview -> download

function createPlatformDownloader(config) {
    const { prefix, apiInfoUrl, apiDownloadUrl, platformName } = config;

    return {
        async fetchInfo() {
            const url = document.getElementById(`${prefix}-url`).value.trim();
            if (!url) { showToast(`Vui lòng nhập URL ${platformName}`, 'error'); return; }

            setLoading(`${prefix}-fetch-btn`, true);
            document.getElementById(`${prefix}-result`).classList.add('hidden');

            try {
                const data = await apiPost(apiInfoUrl, { url });
                if (data.error) { showToast(data.error, 'error'); return; }

                state[prefix].title = data.title;
                document.getElementById(`${prefix}-thumbnail`).src = data.thumbnail;
                document.getElementById(`${prefix}-title`).textContent = data.title;

                // Optional fields
                const uploaderEl = document.getElementById(`${prefix}-uploader`);
                if (uploaderEl) uploaderEl.innerHTML = `<i class="fas fa-user"></i> ${data.uploader || 'Unknown'}`;
                
                const durationEl = document.getElementById(`${prefix}-duration`);
                if (durationEl) durationEl.textContent = formatDuration(data.duration);

                const viewsEl = document.getElementById(`${prefix}-views`);
                if (viewsEl) viewsEl.innerHTML = `<i class="fas fa-eye"></i> ${formatNumber(data.view_count)} lượt xem`;

                const likesEl = document.getElementById(`${prefix}-likes`);
                if (likesEl) likesEl.innerHTML = `<i class="fas fa-heart"></i> ${formatNumber(data.like_count)} likes`;

                const playsEl = document.getElementById(`${prefix}-plays`);
                if (playsEl) playsEl.innerHTML = `<i class="fas fa-play"></i> ${formatNumber(data.play_count || data.view_count)} plays`;

                document.getElementById(`${prefix}-result`).classList.remove('hidden');
                showToast(`Phân tích ${platformName} thành công!`, 'success');
            } catch (e) {
                showToast('Lỗi kết nối đến server', 'error');
            } finally {
                setLoading(`${prefix}-fetch-btn`, false);
            }
        },

        async download() {
            const url = document.getElementById(`${prefix}-url`).value.trim();
            if (!url) return;

            setLoading(`${prefix}-download-btn`, true);
            const progressEl = document.getElementById(`${prefix}-progress`);
            const actionsEl = document.getElementById(`${prefix}-download-actions`);
            progressEl.classList.remove('hidden');
            actionsEl.classList.add('hidden');

            try {
                const format = state[prefix].format || 'mp4';
                const data = await apiPost(apiDownloadUrl, { url, format });
                if (data.error) { showToast(data.error, 'error'); setLoading(`${prefix}-download-btn`, false); return; }

                state[prefix].taskId = data.task_id;
                pollTask(data.task_id,
                    (d) => {
                        document.getElementById(`${prefix}-progress-bar`).style.width = d.progress + '%';
                        document.getElementById(`${prefix}-progress-pct`).textContent = Math.round(d.progress) + '%';
                        document.getElementById(`${prefix}-progress-label`).textContent = d.message;
                    },
                    (d) => {
                        document.getElementById(`${prefix}-progress-bar`).style.width = '100%';
                        document.getElementById(`${prefix}-progress-pct`).textContent = '100%';
                        document.getElementById(`${prefix}-progress-label`).textContent = 'Tải xong!';
                        const ext = state[prefix].format || 'mp4';
                        const safeName = (state[prefix].title || `${platformName}_media`).substring(0, 50).replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF\s\-_.]/g, '').trim() || platformName.toLowerCase();
                        const downloadUrl = `/api/download/${d.filename}?name=${encodeURIComponent(safeName + '.' + ext)}`;
                        const link = document.getElementById(`${prefix}-download-link`);
                        link.href = downloadUrl;
                        actionsEl.classList.remove('hidden');
                        setLoading(`${prefix}-download-btn`, false);
                        showToast(`Tải ${platformName} thành công!`, 'success');
                        openDownloadModal(safeName + '.' + ext, ext, 'Original', platformName, downloadUrl);
                    },
                    (msg) => {
                        document.getElementById(`${prefix}-progress-label`).textContent = msg;
                        setLoading(`${prefix}-download-btn`, false);
                        showToast(msg, 'error');
                    }
                );
            } catch (e) {
                showToast('Lỗi kết nối', 'error');
                setLoading(`${prefix}-download-btn`, false);
            }
        }
    };
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

// ==================== INSTAGRAM ====================
const igDownloader = createPlatformDownloader({
    prefix: 'ig',
    apiInfoUrl: '/api/instagram/info',
    apiDownloadUrl: '/api/instagram/download',
    platformName: 'Instagram'
});

function fetchInstagramInfo() { igDownloader.fetchInfo(); }
function downloadInstagram() { igDownloader.download(); }
function selectIGFormat(fmt) {
    state.ig.format = fmt;
    document.getElementById('ig-format-mp4').classList.toggle('active', fmt === 'mp4');
    document.getElementById('ig-format-mp3').classList.toggle('active', fmt === 'mp3');
}

// ==================== SOUNDCLOUD ====================
const scDownloader = createPlatformDownloader({
    prefix: 'sc',
    apiInfoUrl: '/api/soundcloud/info',
    apiDownloadUrl: '/api/soundcloud/download',
    platformName: 'SoundCloud'
});

function fetchSoundCloudInfo() { scDownloader.fetchInfo(); }
function downloadSoundCloud() { scDownloader.download(); }

// ==================== PINTEREST ====================
const pinDownloader = createPlatformDownloader({
    prefix: 'pin',
    apiInfoUrl: '/api/pinterest/info',
    apiDownloadUrl: '/api/pinterest/download',
    platformName: 'Pinterest'
});

function fetchPinterestInfo() { pinDownloader.fetchInfo(); }
function downloadPinterest() { pinDownloader.download(); }

// ==================== FACEBOOK ====================
const fbDownloader = createPlatformDownloader({
    prefix: 'fb',
    apiInfoUrl: '/api/facebook/info',
    apiDownloadUrl: '/api/facebook/download',
    platformName: 'Facebook'
});

function fetchFacebookInfo() { fbDownloader.fetchInfo(); }
function downloadFacebook() { fbDownloader.download(); }
function selectFBFormat(fmt) {
    state.fb.format = fmt;
    document.getElementById('fb-format-mp4').classList.toggle('active', fmt === 'mp4');
    document.getElementById('fb-format-mp3').classList.toggle('active', fmt === 'mp3');
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
document.getElementById('ig-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchInstagramInfo(); });
document.getElementById('sc-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchSoundCloudInfo(); });
document.getElementById('pin-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchPinterestInfo(); });
document.getElementById('fb-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchFacebookInfo(); });

"""
MelodyHub - Backend Server
YouTube/TikTok Downloader & Audio Processing Studio
"""

import os
import sys
import json
import uuid
import shutil
import subprocess
import threading
import time
from pathlib import Path
from flask import Flask, render_template, request, jsonify, send_file, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder='static', template_folder='templates')
CORS(app)

# Configuration
BASE_DIR = Path(__file__).parent
DOWNLOAD_DIR = BASE_DIR / 'downloads'
TEMP_DIR = BASE_DIR / 'temp'
UPLOAD_DIR = BASE_DIR / 'uploads'

for d in [DOWNLOAD_DIR, TEMP_DIR, UPLOAD_DIR]:
    d.mkdir(exist_ok=True)

# Track task progress
tasks = {}


def find_ffmpeg():
    """Find ffmpeg executable - check local folder first, then PATH."""
    # Check in project's extracted ffmpeg folder
    for pattern in [
        BASE_DIR / 'ffmpeg-master-latest-win64-gpl' / 'bin' / 'ffmpeg.exe',
        BASE_DIR / 'ffmpeg' / 'bin' / 'ffmpeg.exe',
        BASE_DIR / 'ffmpeg.exe',
    ]:
        if pattern.exists():
            return str(pattern)
    # Also check common install paths
    for p in [
        Path(os.environ.get('LOCALAPPDATA', '')) / 'Microsoft' / 'WinGet' / 'Links' / 'ffmpeg.exe',
        Path('C:/ffmpeg/bin/ffmpeg.exe'),
    ]:
        if p.exists():
            return str(p)
    # Fallback to PATH
    return 'ffmpeg'


FFMPEG_PATH = find_ffmpeg()


def get_yt_dlp_cmd():
    """Get yt-dlp command as a list (uses python -m to avoid PATH issues)."""
    cmd = [sys.executable, '-m', 'yt_dlp']
    # Tell yt-dlp where ffmpeg is
    if FFMPEG_PATH != 'ffmpeg':
        ffmpeg_dir = str(Path(FFMPEG_PATH).parent)
        cmd.extend(['--ffmpeg-location', ffmpeg_dir])
    # Bypass YouTube bot detection & enable high resolutions
    cmd.extend([
        '--force-ipv4',
        '--geo-bypass',
        '--extractor-args', 'youtube:player-client=web,android;formats=missing_pot'
    ])
    return cmd


def get_ffmpeg_path():
    """Get ffmpeg executable path."""
    return FFMPEG_PATH


def get_subprocess_env():
    """Get environment dictionary for subprocesses, adding local ffmpeg to PATH."""
    env = os.environ.copy()
    if FFMPEG_PATH != 'ffmpeg':
        ffmpeg_dir = str(Path(FFMPEG_PATH).parent)
        env['PATH'] = ffmpeg_dir + os.pathsep + env.get('PATH', '')
    
    # Giới hạn số lượng thread của PyTorch/CPU để tránh bị văng RAM (OOM) trên Cloud
    env['OMP_NUM_THREADS'] = '1'
    env['MKL_NUM_THREADS'] = '1'
    env['PYTORCH_ENABLE_MPS_FALLBACK'] = '1'
    return env


def find_downloaded_file(task_id):
    """Find downloaded file by task_id prefix - handles yt-dlp format suffixes."""
    best = None
    for f in DOWNLOAD_DIR.iterdir():
        if not f.is_file():
            continue
        # Exact stem match (ideal case after merge)
        if f.stem == task_id:
            return f
        # Prefix match for format-specific files (e.g., taskid.f399.mp4)
        if f.name.startswith(task_id + '.'):
            # Prefer larger file (the video, not just audio)
            if best is None or f.stat().st_size > best.stat().st_size:
                best = f
    return best


# ==================== ROUTES ====================

@app.route('/')
def index():
    return render_template('index.html')


# ==================== YOUTUBE ====================

@app.route('/api/youtube/info', methods=['POST'])
def youtube_info():
    """Get YouTube video information."""
    data = request.get_json()
    url = data.get('url', '').strip()

    if not url:
        return jsonify({'error': 'URL không được để trống'}), 400

    try:
        cmd = [
            *get_yt_dlp_cmd(),
            '--dump-json',
            '--no-playlist',
            url
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, env=get_subprocess_env())

        if result.returncode != 0:
            err_msg = result.stderr.strip().splitlines()[-1] if result.stderr.strip() else 'Lỗi không xác định'
            return jsonify({'error': f'Không thể lấy thông tin: {err_msg}'}), 400

        info = json.loads(result.stdout)

        # Extract available formats
        formats = []
        seen_qualities = set()

        for f in info.get('formats', []):
            height = f.get('height')
            if height and f.get('vcodec', 'none') != 'none':
                quality_label = f'{height}p'
                if quality_label not in seen_qualities:
                    seen_qualities.add(quality_label)
                    formats.append({
                        'quality': quality_label,
                        'height': height,
                        'ext': f.get('ext', 'mp4'),
                        'filesize': f.get('filesize') or f.get('filesize_approx', 0),
                    })

        formats.sort(key=lambda x: x['height'], reverse=True)

        # Always add audio-only option
        formats.append({
            'quality': 'Audio Only (MP3)',
            'height': 0,
            'ext': 'mp3',
            'filesize': 0,
        })

        response = {
            'title': info.get('title', 'Unknown'),
            'thumbnail': info.get('thumbnail', ''),
            'duration': info.get('duration', 0),
            'uploader': info.get('uploader') or info.get('uploader_id') or info.get('channel') or 'Unknown',
            'view_count': info.get('view_count', 0),
            'formats': formats
        }

        return jsonify(response)

    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Timeout khi lấy thông tin video'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/youtube/download', methods=['POST'])
def youtube_download():
    """Download YouTube video."""
    data = request.get_json()
    url = data.get('url', '').strip()
    quality = data.get('quality', '720p')
    format_type = data.get('format', 'mp4')  # mp4 or mp3

    if not url:
        return jsonify({'error': 'URL không được để trống'}), 400

    task_id = str(uuid.uuid4())
    tasks[task_id] = {'status': 'processing', 'progress': 0, 'message': 'Đang bắt đầu tải...'}

    def download_task():
        try:
            output_path = str(DOWNLOAD_DIR / f'{task_id}.%(ext)s')

            if format_type == 'mp3':
                cmd = [
                    *get_yt_dlp_cmd(),
                    '-x',
                    '--audio-format', 'mp3',
                    '--audio-quality', '0',
                    '--no-playlist',
                    '-o', output_path,
                    '--newline',
                    url
                ]
            else:
                height = quality.replace('p', '')
                cmd = [
                    *get_yt_dlp_cmd(),
                    '-f', f'bestvideo[height<={height}]+bestaudio/best[height<={height}]',
                    '--merge-output-format', 'mp4',
                    '--no-playlist',
                    '-o', output_path,
                    '--newline',
                    url
                ]

            process = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1, env=get_subprocess_env()
            )

            full_output = []
            for line in process.stdout:
                line = line.strip()
                if not line:
                    continue
                full_output.append(line)
                print(f"[YT-DL] {line}")  # Log to flask console
                if '[download]' in line and '%' in line:
                    try:
                        pct = float(line.split('%')[0].split()[-1])
                        tasks[task_id]['progress'] = pct
                        tasks[task_id]['message'] = f'Đang tải: {pct:.1f}%'
                    except (ValueError, IndexError):
                        pass
                elif '[Merger]' in line or '[ExtractAudio]' in line or '[Metadata]' in line:
                    tasks[task_id]['message'] = 'Đang xử lý file...'

            process.wait()

            if process.returncode == 0:
                # Find the downloaded file
                downloaded_file = find_downloaded_file(task_id)

                if downloaded_file:
                    tasks[task_id]['status'] = 'completed'
                    tasks[task_id]['progress'] = 100
                    tasks[task_id]['filename'] = downloaded_file.name
                    tasks[task_id]['message'] = 'Tải xong!'
                else:
                    tasks[task_id]['status'] = 'error'
                    tasks[task_id]['message'] = 'Không tìm thấy file đã tải'
            else:
                tasks[task_id]['status'] = 'error'
                # Show the last line of the error to the user
                err_msg = full_output[-1] if full_output else 'Unknown error'
                tasks[task_id]['message'] = f'Lỗi: {err_msg}'

        except Exception as e:
            tasks[task_id]['status'] = 'error'
            tasks[task_id]['message'] = str(e)

    thread = threading.Thread(target=download_task)
    thread.start()

    return jsonify({'task_id': task_id})


# ==================== TIKTOK ====================

@app.route('/api/tiktok/info', methods=['POST'])
def tiktok_info():
    """Get TikTok video information."""
    data = request.get_json()
    url = data.get('url', '').strip()

    if not url:
        return jsonify({'error': 'URL không được để trống'}), 400

    try:
        cmd = [
            *get_yt_dlp_cmd(),
            '--dump-json',
            '--no-playlist',
            url
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, env=get_subprocess_env())

        if result.returncode != 0:
            err_msg = result.stderr.strip().splitlines()[-1] if result.stderr.strip() else 'Lỗi không xác định'
            return jsonify({'error': f'Không thể lấy thông tin TikTok: {err_msg}'}), 400

        info = json.loads(result.stdout)

        response = {
            'title': info.get('title', info.get('description', 'TikTok Video')),
            'thumbnail': info.get('thumbnail', ''),
            'duration': info.get('duration', 0),
            'uploader': info.get('uploader', info.get('creator', 'Unknown')),
            'like_count': info.get('like_count', 0),
        }

        return jsonify(response)

    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Timeout'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/tiktok/download', methods=['POST'])
def tiktok_download():
    """Download TikTok video."""
    data = request.get_json()
    url = data.get('url', '').strip()
    format_type = data.get('format', 'mp4')  # mp4 or mp3

    if not url:
        return jsonify({'error': 'URL không được để trống'}), 400

    task_id = str(uuid.uuid4())
    tasks[task_id] = {'status': 'processing', 'progress': 0, 'message': 'Đang bắt đầu tải...'}

    def download_task():
        try:
            output_path = str(DOWNLOAD_DIR / f'{task_id}.%(ext)s')

            if format_type == 'mp3':
                cmd = [
                    *get_yt_dlp_cmd(),
                    '-x',
                    '--audio-format', 'mp3',
                    '--audio-quality', '0',
                    '--no-playlist',
                    '-o', output_path,
                    '--newline',
                    url
                ]
            else:
                cmd = [
                    *get_yt_dlp_cmd(),
                    '--no-playlist',
                    '-o', output_path,
                    '--newline',
                    url
                ]

            process = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1, env=get_subprocess_env()
            )

            full_output = []
            for line in process.stdout:
                line = line.strip()
                if not line:
                    continue
                full_output.append(line)
                print(f"[TT-DL] {line}")  # Log to flask console
                if '[download]' in line and '%' in line:
                    try:
                        pct = float(line.split('%')[0].split()[-1])
                        tasks[task_id]['progress'] = pct
                        tasks[task_id]['message'] = f'Đang tải: {pct:.1f}%'
                    except (ValueError, IndexError):
                        pass

            process.wait()

            if process.returncode == 0:
                downloaded_file = find_downloaded_file(task_id)

                if downloaded_file:
                    tasks[task_id]['status'] = 'completed'
                    tasks[task_id]['progress'] = 100
                    tasks[task_id]['filename'] = downloaded_file.name
                    tasks[task_id]['message'] = 'Tải xong!'
                else:
                    tasks[task_id]['status'] = 'error'
                    tasks[task_id]['message'] = 'Không tìm thấy file đã tải'
            else:
                tasks[task_id]['status'] = 'error'
                err_msg = full_output[-1] if full_output else 'Unknown error'
                tasks[task_id]['message'] = f'Lỗi: {err_msg}'

        except Exception as e:
            tasks[task_id]['status'] = 'error'
            tasks[task_id]['message'] = str(e)

    thread = threading.Thread(target=download_task)
    thread.start()

    return jsonify({'task_id': task_id})


# ==================== AUDIO STUDIO ====================

@app.route('/api/audio/convert', methods=['POST'])
def audio_convert():
    """Convert audio file to different format."""
    if 'file' not in request.files:
        return jsonify({'error': 'Chưa chọn file'}), 400

    file = request.files['file']
    target_format = request.form.get('format', 'wav')
    bitrate = request.form.get('bitrate', '320k')

    if file.filename == '':
        return jsonify({'error': 'Chưa chọn file'}), 400

    task_id = str(uuid.uuid4())
    tasks[task_id] = {'status': 'processing', 'progress': 0, 'message': 'Đang upload file...'}

    # Save uploaded file
    input_ext = Path(file.filename).suffix
    input_path = UPLOAD_DIR / f'{task_id}{input_ext}'
    file.save(str(input_path))

    def convert_task():
        try:
            tasks[task_id]['message'] = 'Đang chuyển đổi...'
            tasks[task_id]['progress'] = 30

            output_filename = f'{task_id}.{target_format}'
            output_path = DOWNLOAD_DIR / output_filename

            cmd = [get_ffmpeg_path(), '-i', str(input_path), '-y']

            # Format-specific options
            if target_format == 'mp3':
                cmd.extend(['-codec:a', 'libmp3lame', '-b:a', bitrate])
            elif target_format == 'flac':
                cmd.extend(['-codec:a', 'flac'])
            elif target_format == 'wav':
                cmd.extend(['-codec:a', 'pcm_s24le'])
            elif target_format == 'ogg':
                cmd.extend(['-codec:a', 'libvorbis', '-q:a', '10'])
            elif target_format == 'aac':
                cmd.extend(['-codec:a', 'aac', '-b:a', bitrate])
            elif target_format == 'aiff':
                cmd.extend(['-codec:a', 'pcm_s24le'])
            elif target_format == 'wma':
                cmd.extend(['-codec:a', 'wmav2', '-b:a', bitrate])
            elif target_format == 'alac':
                cmd.extend(['-codec:a', 'alac'])

            cmd.append(str(output_path))

            tasks[task_id]['progress'] = 50

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300, env=get_subprocess_env())

            if result.returncode == 0:
                tasks[task_id]['status'] = 'completed'
                tasks[task_id]['progress'] = 100
                tasks[task_id]['filename'] = output_filename
                tasks[task_id]['message'] = 'Chuyển đổi xong!'
            else:
                tasks[task_id]['status'] = 'error'
                tasks[task_id]['message'] = f'Lỗi chuyển đổi: {result.stderr[:200]}'

            # Clean up input file
            try:
                input_path.unlink()
            except:
                pass

        except subprocess.TimeoutExpired:
            tasks[task_id]['status'] = 'error'
            tasks[task_id]['message'] = 'Timeout khi chuyển đổi'
        except Exception as e:
            tasks[task_id]['status'] = 'error'
            tasks[task_id]['message'] = str(e)

    thread = threading.Thread(target=convert_task)
    thread.start()

    return jsonify({'task_id': task_id})


@app.route('/api/audio/separate', methods=['POST'])
def audio_separate():
    """Separate audio into stems using Demucs."""
    if 'file' not in request.files:
        return jsonify({'error': 'Chưa chọn file'}), 400

    file = request.files['file']
    model = request.form.get('model', 'htdemucs')
    stems = request.form.get('stems', 'all')  # all, vocals, drums, bass, other

    if file.filename == '':
        return jsonify({'error': 'Chưa chọn file'}), 400

    task_id = str(uuid.uuid4())
    original_name = Path(file.filename).stem
    tasks[task_id] = {
        'status': 'processing',
        'progress': 0,
        'message': 'Đang upload file...',
        'original_name': original_name
    }

    # Save uploaded file
    input_ext = Path(file.filename).suffix
    input_path = UPLOAD_DIR / f'{task_id}{input_ext}'
    file.save(str(input_path))

    def separate_task():
        try:
            tasks[task_id]['message'] = 'Đang tách nhạc với AI (có thể mất vài phút)...'
            tasks[task_id]['progress'] = 10

            output_dir = TEMP_DIR / task_id

            # Use demucs CLI
            cmd = [
                sys.executable, '-m', 'demucs',
                '--out', str(output_dir),
                '-n', model,
                '-j', '1',          # Disable parallel jobs to save RAM
                '--segment', '2',   # Reduce segment size to save RAM
                '--mp3',
                str(input_path)
            ]

            if stems == 'vocals':
                cmd.extend(['--two-stems', 'vocals'])

            process = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1, env=get_subprocess_env()
            )

            full_output = []
            for line in process.stdout:
                line = line.strip()
                if not line:
                    continue
                full_output.append(line)
                print(f"[DEMUCS] {line}")
                if '%' in line:
                    try:
                        pct_str = line.split('%')[0].strip().split()[-1]
                        pct = float(pct_str)
                        tasks[task_id]['progress'] = min(10 + pct * 0.85, 95)
                        tasks[task_id]['message'] = f'Đang xử lý AI: {pct:.0f}%'
                    except (ValueError, IndexError):
                        pass
                else:
                    tasks[task_id]['message'] = f'Đang xử lý: {line[:60]}'

            process.wait()

            if process.returncode == 0:
                # Find output stems
                stem_dir = output_dir / model / task_id
                if not stem_dir.exists():
                    # Try to find the correct directory
                    for d in (output_dir / model).iterdir():
                        if d.is_dir():
                            stem_dir = d
                            break

                stem_files = {}
                if stem_dir.exists():
                    for stem_file in stem_dir.iterdir():
                        if stem_file.is_file():
                            stem_name = stem_file.stem
                            # Copy to downloads
                            dest = DOWNLOAD_DIR / f'{task_id}_{stem_name}{stem_file.suffix}'
                            shutil.copy2(str(stem_file), str(dest))
                            stem_files[stem_name] = dest.name

                if stem_files:
                    tasks[task_id]['status'] = 'completed'
                    tasks[task_id]['progress'] = 100
                    tasks[task_id]['stems'] = stem_files
                    tasks[task_id]['message'] = 'Tách nhạc xong!'
                else:
                    tasks[task_id]['status'] = 'error'
                    tasks[task_id]['message'] = 'Không tìm thấy file output'

                # Cleanup
                try:
                    shutil.rmtree(str(output_dir))
                except:
                    pass
            else:
                tasks[task_id]['status'] = 'error'
                if full_output:
                    err_msg = " | ".join(full_output[-3:])
                else:
                    err_msg = f'No output, return code: {process.returncode} (Có thể do Server bị văng RAM - OOM)'
                tasks[task_id]['message'] = f'Lỗi: {err_msg}'

            # Clean up input file
            try:
                input_path.unlink()
            except:
                pass

        except Exception as e:
            tasks[task_id]['status'] = 'error'
            tasks[task_id]['message'] = str(e)

    thread = threading.Thread(target=separate_task)
    thread.start()

    return jsonify({'task_id': task_id})


# ==================== TASK STATUS & FILE DOWNLOAD ====================

@app.route('/api/task/<task_id>', methods=['GET'])
def task_status(task_id):
    """Get task status."""
    if task_id not in tasks:
        return jsonify({'error': 'Task not found'}), 404
    return jsonify(tasks[task_id])


@app.route('/api/download/<filename>', methods=['GET'])
def download_file(filename):
    """Download a processed file."""
    file_path = DOWNLOAD_DIR / filename
    if not file_path.exists():
        return jsonify({'error': 'File not found'}), 404

    # Determine a friendly name
    original_name = request.args.get('name', filename)

    return send_file(
        str(file_path),
        as_attachment=True,
        download_name=original_name
    )


@app.route('/api/cleanup/<task_id>', methods=['DELETE'])
def cleanup_task(task_id):
    """Clean up task files."""
    if task_id in tasks:
        task = tasks[task_id]

        # Clean up single file
        if 'filename' in task:
            try:
                (DOWNLOAD_DIR / task['filename']).unlink(missing_ok=True)
            except:
                pass

        # Clean up stem files
        if 'stems' in task:
            for stem_name, filename in task['stems'].items():
                try:
                    (DOWNLOAD_DIR / filename).unlink(missing_ok=True)
                except:
                    pass

        del tasks[task_id]

    return jsonify({'ok': True})


if __name__ == '__main__':
    print("=" * 60)
    print("  MelodyHub - Media Download & Audio Studio")
    print("  URL: http://localhost:5000")
    print("=" * 60)
    app.run(host='0.0.0.0', port=5000, debug=True)

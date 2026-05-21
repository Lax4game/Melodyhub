import json
import subprocess
import sys

url = "https://youtu.be/fs7tlxVMqGw?si=dT0Lc_jjaWjBPn2m"
cmd = [
    sys.executable, "-m", "yt_dlp", 
    "--extractor-args", "youtube:player-client=android,web;formats=missing_pot", 
    "--dump-json", "--no-playlist", url
]
result = subprocess.run(cmd, capture_output=True, text=True)

if result.returncode == 0:
    info = json.loads(result.stdout)
    print("Uploader:", info.get('uploader'))
    print("Uploader ID:", info.get('uploader_id'))
    print("Channel:", info.get('channel'))
    print("Channel ID:", info.get('channel_id'))
    print("Author:", info.get('author'))
else:
    print("Error:", result.stderr)

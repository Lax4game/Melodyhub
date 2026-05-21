import json
import subprocess
import sys

url = "https://youtu.be/fs7tlxVMqGw?si=dT0Lc_jjaWjBPn2m"

clients = [
    "android",
    "ios",
    "web",
    "ios,android",
    "web,android",
    "mweb",
    "android_creator"
]

for client in clients:
    print(f"\n--- Testing player-client: {client} ---")
    cmd = [
        sys.executable, "-m", "yt_dlp", 
        "--extractor-args", f"youtube:player-client={client}", 
        "--dump-json", "--no-playlist", url
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.returncode == 0:
        info = json.loads(result.stdout)
        formats = info.get('formats', [])
        heights = sorted(list(set([f.get('height') for f in formats if f.get('height') is not None])))
        print(f"Success! Found {len(formats)} formats. Available heights: {heights}")
    else:
        print(f"Failed: {result.stderr.strip().splitlines()[-1] if result.stderr.strip() else 'No output'}")

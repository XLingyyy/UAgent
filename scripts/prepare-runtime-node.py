"""Prepare the pinned Windows runtime and its bundled third-party notices."""
from pathlib import Path
import hashlib
import shutil
import sys
import urllib.request
import zipfile

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
VERSION = "24.22.2"
NAME = f"node-v{VERSION}-win-x64"
SHA256 = "ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2"
CACHE = ROOT / ".local-dev" / "downloads" / f"{NAME}.zip"
DESTINATION = ROOT / "apps" / "desktop" / "src-tauri" / "resources" / "runtime-host"


def main():
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    if not CACHE.exists():
        temporary = CACHE.with_suffix(".download")
        with urllib.request.urlopen(f"https://nodejs.org/dist/v{VERSION}/{NAME}.zip", timeout=60) as response:
            with temporary.open("wb") as output:
                shutil.copyfileobj(response, output)
        temporary.replace(CACHE)
    # This executable is distributed with the application. Verify the pinned
    # official archive before extracting; never use the developer's PATH copy.
    with CACHE.open("rb") as archive:
        actual = hashlib.file_digest(archive, "sha256").hexdigest()
    if actual != SHA256:
        raise RuntimeError("Node archive differs from the pinned official release")
    DESTINATION.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(CACHE) as archive:
        for source, target in [("node.exe", "node.exe"), ("LICENSE", "NODE-LICENSE.txt")]:
            with archive.open(f"{NAME}/{source}") as content:
                with (DESTINATION / target).open("wb") as output:
                    shutil.copyfileobj(content, output)
    print(f"Prepared official Node {VERSION} win-x64 and license notices")


if __name__ == "__main__":
    main()

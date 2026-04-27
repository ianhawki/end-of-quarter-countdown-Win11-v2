"""Regenerate assets/icon.ico so it contains a 256x256 image (electron-builder
requirement for shortcut/exe icon embedding).

Loads the existing .ico, takes the largest available image, and writes a new
.ico containing 16, 24, 32, 48, 64, 128 and 256 px sizes (256 is upscaled
from the largest source via LANCZOS).
"""

from pathlib import Path
from PIL import Image, IcoImagePlugin

ROOT = Path(__file__).resolve().parent.parent
ICON = ROOT / "assets" / "icon.ico"

with open(ICON, "rb") as f:
    ico = IcoImagePlugin.IcoFile(f)
    largest_size = max(((e.width, e.height) for e in ico.entry),
                       key=lambda s: s[0] * s[1])
    base = ico.getimage(largest_size).convert("RGBA")

print(f"Loaded largest source frame: {base.size}")

if base.size != (256, 256):
    base_256 = base.resize((256, 256), Image.LANCZOS)
else:
    base_256 = base

sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
base_256.save(ICON, format="ICO", sizes=sizes)
print(f"Wrote {ICON} with sizes: {sizes}")

"""Build the optimized portrait used by the bio-link page.

Reads assets/davi-vera.jpg (the original 2152x2152 photo) and writes
assets/davi-vera-profile.jpg: a 720x720 square crop centered on the face,
compressed for the web. Run with:  python tools/build-assets.py
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "davi-vera.jpg"
TARGET = ROOT / "assets" / "davi-vera-profile.jpg"
SIZE = 720
# The face sits in the upper half of the original frame; keep it inside the
# square crop and leave room above the head.
CROP_BOX = (560, 130, 1640, 1210)


def main() -> None:
    with Image.open(SOURCE) as image:
        image = image.convert("RGB")
        square = image.crop(CROP_BOX).resize((SIZE, SIZE), Image.LANCZOS)
        square.save(TARGET, "JPEG", quality=84, optimize=True, progressive=True)
    print(f"{TARGET.relative_to(ROOT)} -> {TARGET.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()

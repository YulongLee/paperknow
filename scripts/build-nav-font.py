#!/usr/bin/env python3
"""Regenerate the checked-in homepage navigation font; not part of deployment."""

import argparse
import hashlib
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "dist/workspace/assets/fonts/NotoSansSC-Regular.otf"
SOURCE_SHA256 = "faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9"
OUTPUT = ROOT / "dist/brand/fonts/paperknow-nav.woff2"
NAVIGATION_TEXT = (
    "首页 AI 写作文献研读降重复率 降AI率 免费查重 PPT 创作 格式排版 "
    "科研工具 客户端下载 方案与权益 开通会员 注册并开始 开始使用 进入工作台 登录 "
    "我的账户 导航 论文与科研工作台 新 热 免费"
)
UNICODES = set(range(0x20, 0x7F)) | {ord(char) for char in NAVIGATION_TEXT}
FAMILY = "PaperKnow Navigation"
POSTSCRIPT = "PaperKnowNavigation-Regular"


def build(output):
    source_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    if source_hash != SOURCE_SHA256:
        raise SystemExit("The source font changed; review its license and update SOURCE_SHA256.")

    font = TTFont(SOURCE, recalcTimestamp=False)
    missing = UNICODES - set(font.getBestCmap())
    if missing:
        raise SystemExit(f"Source is missing required characters: {sorted(missing)}")

    options = subset.Options()
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 13, 14, 16, 17]
    options.name_languages = [0x409]
    options.name_legacy = False
    options.notdef_glyph = True
    options.notdef_outline = True
    options.recalc_timestamp = False
    options.canonical_order = True
    # Keep kerning and standard Latin ligatures without unused regional alternates.
    options.layout_features = ["kern", "liga"]
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=UNICODES)
    subsetter.subset(font)

    replacements = {
        1: FAMILY,
        2: "Regular",
        3: "PaperKnowNavigation;1.0;Regular",
        4: f"{FAMILY} Regular",
        6: POSTSCRIPT,
        16: FAMILY,
        17: "Regular",
    }
    for name_id, text in replacements.items():
        font["name"].removeNames(nameID=name_id)
        font["name"].setName(text, name_id, 3, 1, 0x409)

    cff = font["CFF "].cff
    cff.fontNames = [POSTSCRIPT]
    cff.topDictIndex[0].FamilyName = FAMILY
    cff.topDictIndex[0].FullName = f"{FAMILY} Regular"
    font.flavor = "woff2"
    output.parent.mkdir(parents=True, exist_ok=True)
    font.save(output, reorderTables=True)
    font.close()

    with TTFont(output, recalcTimestamp=False) as generated:
        missing = UNICODES - set(generated.getBestCmap())
        if missing:
            raise SystemExit(f"Output is missing required characters: {sorted(missing)}")
        names = [n.toUnicode() for n in generated["name"].names if n.nameID in (1, 4, 6, 16)]
        if any("Noto" in name or "Source" in name for name in names):
            raise SystemExit("Output still contains an original primary font name.")
    size = output.stat().st_size
    if size > 40 * 1024:
        raise SystemExit(f"Navigation font exceeds the 40 KiB budget: {size} bytes")
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    print(f"{output}: {size} bytes; {len(UNICODES)} required codepoints; coverage complete")
    print(f"SHA-256: {digest}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    build(parser.parse_args().output.resolve())

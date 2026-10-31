#!/usr/bin/env python3
"""Build the checked-in, licensed homepage font subset (maintenance only)."""
import argparse
import hashlib
from html.parser import HTMLParser
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'dist/workspace/assets/fonts/NotoSansSC-Regular.otf'
SOURCE_SHA256 = 'faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9'
OUTPUT = ROOT / 'dist/brand/fonts/paperknow-home-v1.woff2'

class VisibleText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.hidden += 1
    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.hidden = max(0, self.hidden - 1)
    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def build(source=SOURCE, output=OUTPUT, weight='Regular', source_sha=SOURCE_SHA256, font_number=-1):
    if hashlib.sha256(source.read_bytes()).hexdigest() != source_sha:
        raise SystemExit('Review the upstream source and its license before rebuilding.')
    parser = VisibleText()
    parser.feed((ROOT / 'dist/index.html').read_text())
    # Dynamic public pricing, availability and account UI use the same font.
    content = ''.join(parser.parts) + (ROOT / 'dist/home-app.js').read_text()
    required = set(range(0x20, 0x7f)) | {ord(c) for c in content if ord(c) > 0x7f and not c.isspace()}
    font = TTFont(source, fontNumber=font_number, recalcTimestamp=False)
    missing = required - set(font.getBestCmap())
    if missing:
        raise SystemExit('Required characters missing: ' + repr(sorted(missing)))
    options = subset.Options()
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 13, 14, 16, 17]
    options.name_languages = [0x409]
    options.name_legacy = False
    options.recalc_timestamp = False
    options.canonical_order = True
    options.layout_features = ['kern', 'liga']
    options.notdef_glyph = True
    options.notdef_outline = True
    builder = subset.Subsetter(options=options)
    builder.populate(unicodes=required)
    builder.subset(font)
    family = 'PaperKnow Home'
    postscript = 'PaperKnowHome-' + weight
    for name_id, name in {1: family, 2: weight, 3: 'PaperKnowHome;1.0;' + weight, 4: family + ' ' + weight, 6: postscript, 16: family, 17: weight}.items():
        font['name'].removeNames(nameID=name_id)
        font['name'].setName(name, name_id, 3, 1, 0x409)
    cff = font['CFF '].cff
    cff.fontNames = [postscript]
    cff.topDictIndex[0].FamilyName = family
    cff.topDictIndex[0].FullName = family + ' ' + weight
    font.flavor = 'woff2'
    font.save(output, reorderTables=True)
    font.close()
    with TTFont(output) as result:
        assert required <= set(result.getBestCmap())
        assert not any('Noto' in n.toUnicode() or 'Source' in n.toUnicode() for n in result['name'].names if n.nameID in (1, 4, 6, 16))
    if output.stat().st_size > 180 * 1024:
        raise SystemExit('Homepage font exceeds its 180 KiB budget.')
    print(f'{len(required)} characters, {output.stat().st_size} bytes, sha256={hashlib.sha256(output.read_bytes()).hexdigest()}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bold-source', type=Path, required=True, help='Licensed NotoSansCJK-Bold.ttc (source hash pinned below)')
    args = parser.parse_args()
    build()
    build(args.bold_source, ROOT / 'dist/brand/fonts/paperknow-home-v1-bold.woff2', 'Bold', 'faa5f3656a78b2e2d450d27fe8382c778bc2b6bb5ea29c986664a6a435056ceb', 2)

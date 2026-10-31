PaperKnow Navigation Regular
============================

Self-hosted WOFF2 subset derived from Noto Sans SC Regular (version 2.004).
Upstream: https://github.com/notofonts/noto-cjk/tree/main/Sans/SubsetOTF/SC
Source in this repository: dist/workspace/assets/fonts/NotoSansSC-Regular.otf
Source SHA-256: faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9

Copyright 2014-2021 Adobe (http://www.adobe.com/).
Distributed under the SIL Open Font License 1.1; see OFL.txt.
This modified subset is renamed PaperKnow Navigation, including its CFF and
OpenType primary name records. The font retains the upstream copyright and
license metadata. The original reserved font name is not used as its identity.

Coverage: printable ASCII U+0020-U+007E and the Chinese characters used in the
homepage navigation, account controls and navigation labels. See
NAVIGATION_TEXT in scripts/build-nav-font.py for the maintained character list.
Other content and user names must retain a system-font fallback.

Regenerate from the repository root (maintenance only):

    python3 -m venv /tmp/paperknow-nav-font-venv
    /tmp/paperknow-nav-font-venv/bin/python -m pip install 'fonttools[woff]==4.60.2' 'brotli==1.2.0' 'zopfli==0.2.3.post1'
    /tmp/paperknow-nav-font-venv/bin/python scripts/build-nav-font.py

The script checks the source hash, glyph coverage, primary font names and a
40 KiB size budget. Deployment serves the checked-in WOFF2 asset directly;
Python and the font-building packages are not required to run or build the app.
Use font-display: swap and system fallbacks in the consuming CSS.

Homepage body font
==================
paperknow-home-v1.woff2 is a separate, renamed subset of the same licensed
Noto Sans SC Regular source and SHA-256 above. Family: PaperKnow Home.
It covers printable ASCII and the visible homepage / dynamic homepage UI
characters from dist/index.html and dist/home-app.js. Unrecognized user and
product names retain system fallbacks. paperknow-home-v1-bold.woff2 provides an actual 700 weight; no proprietary
system fonts are redistributed. Bold source is Noto Sans CJK SC Bold 2.004,
face 2 of the fonts-noto-cjk NotoSansCJK-Bold.ttc collection, SHA-256
faa5f3656a78b2e2d450d27fe8382c778bc2b6bb5ea29c986664a6a435056ceb.
Upstream: https://github.com/notofonts/noto-cjk (SIL OFL 1.1).

Regenerate: python scripts/build-home-font.py --bold-source /path/to/NotoSansCJK-Bold.ttc
Use fonttools[woff]==4.60.2 and
brotli==1.2.0. The source is local and hash-checked; no network access is needed.
The generated WOFF2 is checked in and limited to 180 KiB per weight. Font creation is a
maintenance task, not a runtime or deployment dependency. SIL OFL 1.1 applies.

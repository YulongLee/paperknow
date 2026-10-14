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

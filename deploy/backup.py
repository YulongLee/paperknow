#!/usr/bin/env python3
"""Root-only PaperKnow snapshot; never copy a live SQLite main file alone."""
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
import json
import os
import shutil
import sqlite3
import stat
import tempfile
import time

BASE = Path('/opt/paperknow')
DATA = Path('/var/lib/paperknow')
CONFIG = Path('/etc/paperknow/paperknow.env')


def snapshot_database(source, target):
    deadline = time.monotonic() + 120

    def progress(_status, _remaining, _total):
        if time.monotonic() > deadline:
            raise TimeoutError('SQLite snapshot exceeded 120 seconds')

    with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True, timeout=10)) as src:
        with closing(sqlite3.connect(str(target))) as dst:
            src.backup(dst, pages=100, progress=progress, sleep=0.1)
            if dst.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                raise RuntimeError('SQLite snapshot integrity check failed')
    target.chmod(0o600)


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Run the installed backup script with sudo')
    os.umask(0o077)
    root = BASE / 'backups'
    for directory in (BASE, DATA, CONFIG.parent, root):
        if directory.is_symlink() or not directory.is_dir():
            raise RuntimeError(f'Expected dedicated directory: {directory}')
    if root.stat().st_uid != 0 or stat.S_IMODE(root.stat().st_mode) != 0o700:
        raise RuntimeError('The backup directory must be root-owned with mode 0700')
    source = DATA / 'paperknow.sqlite'
    for path in (source, CONFIG):
        if path.is_symlink() or not path.is_file():
            raise RuntimeError(f'Expected regular file: {path}')
    # Verify the configured data location without evaluating shell/environment code.
    values = {}
    with CONFIG.open() as config:
        for line in config:
            if '=' in line and not line.lstrip().startswith('#'):
                key, value = line.strip().split('=', 1)
                values[key.strip()] = value.strip().strip('"\'')
    if values.get('PK_DATA_DIR') != str(DATA):
        raise RuntimeError('PK_DATA_DIR does not match the dedicated backup source')
    timestamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    folder = Path(tempfile.mkdtemp(prefix=timestamp + '-', dir=root))
    try:
        snapshot_database(source, folder / 'paperknow.sqlite')
        with CONFIG.open('rb') as source_file, (folder / 'paperknow.env').open('xb') as target:
            shutil.copyfileobj(source_file, target)
        (folder / 'paperknow.env').chmod(0o600)
        metadata = {'createdAt': timestamp, 'release': str((BASE / 'current').resolve()),
                    'database': str(source), 'configuration': str(CONFIG),
                    'scope': 'SQLite (including local upload blobs) and environment; external OSS objects excluded'}
        (folder / 'snapshot.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
    except BaseException:
        shutil.rmtree(folder)
        raise
    print(folder)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not echo configuration contents or credentials on failures.
        raise SystemExit(f'PaperKnow backup failed: {type(error).__name__}: {error}')

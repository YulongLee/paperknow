#!/usr/bin/env python3
"""Verify a PaperKnow database snapshot by restoring it into an isolated copy.

This never replaces the live database and does not inspect or print user records.
OSS objects are outside the snapshot and require separate backup and verification.
"""
from contextlib import closing
from pathlib import Path
import argparse
import json
import os
import sqlite3
import tempfile


def verify_snapshot(folder):
    folder = Path(folder)
    if folder.is_symlink() or not folder.is_dir():
        raise ValueError('snapshot directory is unavailable or is a symlink')
    metadata_path, source = folder / 'snapshot.json', folder / 'paperknow.sqlite'
    for path in (metadata_path, source):
        if path.is_symlink() or not path.is_file():
            raise ValueError('snapshot metadata or database is missing')
    metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
    if not isinstance(metadata, dict) or not metadata.get('createdAt') or 'SQLite' not in str(metadata.get('scope', '')):
        raise ValueError('snapshot metadata is invalid')
    # SQLite can leave an empty WAL after closing a completed snapshot. A
    # nonempty WAL or rollback journal may contain committed state, and cannot
    # safely be ignored by the immutable single-file reader below.
    wal, journal = Path(str(source) + '-wal'), Path(str(source) + '-journal')
    if wal.is_symlink() or journal.is_symlink() or journal.exists() or (wal.exists() and wal.stat().st_size != 0):
        raise ValueError('database has a live sidecar; use a completed snapshot')
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix='paperknow-restore-check-') as tmp:
        target = Path(tmp) / 'restored.sqlite'
        uri = source.resolve().as_uri() + '?mode=ro&immutable=1'
        with closing(sqlite3.connect(uri, uri=True, timeout=10)) as src:
            with closing(sqlite3.connect(str(target))) as restored:
                src.backup(restored)
                if restored.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                    raise ValueError('restored database integrity check failed')
                if restored.execute('PRAGMA foreign_key_check').fetchone() is not None:
                    raise ValueError('restored database foreign key check failed')
                tables = {row[0] for row in restored.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                if not {'users', 'jobs', 'orders'}.issubset(tables):
                    raise ValueError('snapshot lacks required application tables')
    return {'createdAt': metadata['createdAt'], 'databaseRestore': 'passed',
            'scope': 'isolated structural and foreign-key checks only; source completeness and business recovery not verified',
            'ossObjects': 'not included; verify separately'}


def main():
    parser = argparse.ArgumentParser(description='Restore a database snapshot into a temporary isolated copy and verify it.')
    parser.add_argument('snapshot_directory')
    args = parser.parse_args()
    try:
        print(json.dumps(verify_snapshot(args.snapshot_directory), ensure_ascii=False))
    except (OSError, ValueError, sqlite3.Error, json.JSONDecodeError) as error:
        # Never print paths, configuration values or database contents.
        raise SystemExit('Snapshot verification failed: ' + type(error).__name__)


if __name__ == '__main__':
    main()

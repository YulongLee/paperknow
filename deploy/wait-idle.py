#!/usr/bin/env python3
"""Read-only activation guard. Never cancels or restarts a user's task."""
import sqlite3
import sys
import time
from pathlib import Path


def active_tasks(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError('database unavailable')
    c = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=5)
    try:
        total = 0
        for table in ('jobs', 'thesis_runs', 'aigc_detections'):
            if c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                total += c.execute('SELECT count(*) FROM '+table+" WHERE status IN ('preparing','queued','running','cancelling')").fetchone()[0]
        if not c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='jobs'").fetchone():
            raise ValueError('task schema unavailable')
        return total
    finally:
        c.close()


if __name__ == '__main__':
    try:
        if sys.argv[1:] not in ([], ['--once']):
            raise ValueError('unsupported argument')
        deadline = time.monotonic() + (0 if sys.argv[1:] else 7200)
        while active_tasks('/var/lib/paperknow/paperknow.sqlite'):
            if time.monotonic() >= deadline:
                raise ValueError('active tasks remain')
            print('PaperKnow activation waiting for existing tasks; current service unchanged.', flush=True)
            time.sleep(15)
        print('PaperKnow activation check: no active tasks.')
    except Exception:
        raise SystemExit('Activation deferred: tasks are active or their status could not be verified. Current service unchanged.')

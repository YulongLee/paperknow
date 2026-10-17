#!/usr/bin/env python3
"""Bounded, project-only release retention. Database/config snapshots are never deleted.

No arguments prints a plan; --apply keeps current and two newest rollback builds.
--legacy-archives additionally verifies old code-only tarballs before removing them.
Never extracts archives, follows directory links, or touches another application's paths.
"""
from pathlib import Path, PurePosixPath
import argparse
import fcntl
import json
import os
import re
import shutil
import subprocess
import tarfile
import time

BASE = Path('/opt/paperknow')
SHA = re.compile(r'^[a-f0-9]{7,40}$')
ARCHIVE = re.compile(r'^(?:inactive|archived)-release-([a-f0-9]{7,40})\.tar\.gz$')
CODE_ROOTS = {'backend', 'src', 'dist', 'node_modules', 'package-lock.json', 'docs',
              'server.mjs', 'scripts', 'design', 'deploy', '.env.example',
              'FULL-AUDIT-REPORT.md', 'ACTION-PLAN.md', 'package.json', 'README.md',
              'tests', '.paperknow-commit', '.gitignore'}


def publish_capacity_summary():
    """Expose numbers only; never grant the app access to root-only backup contents."""
    directory = Path('/run/paperknow-ops')
    if directory.is_symlink():
        raise RuntimeError('Unsafe metrics directory.')
    directory.mkdir(mode=0o755, exist_ok=True)
    if directory.stat().st_uid != 0 or directory.stat().st_mode & 0o022:
        raise RuntimeError('Untrusted metrics directory.')
    values = {}
    for name, path in [('releases', BASE / 'releases'), ('backups', BASE / 'backups'),
                       ('cache', BASE / 'build-home' / 'npm-cache')]:
        if path.is_symlink() or not path.is_dir():
            continue
        raw = subprocess.check_output(['du', '-x', '-B1', '-s', str(path)],
                                      text=True, stderr=subprocess.DEVNULL, timeout=60)
        values[name] = {'bytes': int(raw.split()[0]), 'partial': False}
    value = {'at': time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime()), 'directories': values}
    target = directory / 'storage.json'
    # The private directory is root-owned. Refuse preexisting symlink temp targets.
    temporary = directory / ('.storage-' + str(os.getpid()))
    with temporary.open('x') as out:
        out.write(json.dumps(value) + '\n')
    temporary.chmod(0o644)
    temporary.replace(target)


def code_only_archive(path, sha, max_seconds=180):
    """Return False for anything not a reproducible immutable code tree."""
    started = time.monotonic()
    roots = set()
    try:
        with tarfile.open(path, 'r|gz') as archive:
            for number, member in enumerate(archive):
                if number > 300000 or time.monotonic() - started > max_seconds:
                    return False
                p = PurePosixPath(member.name)
                if p.is_absolute() or '..' in p.parts or not p.parts or p.parts[0] != sha:
                    return False
                if len(p.parts) == 1:
                    if not member.isdir():
                        return False
                    continue
                root = p.parts[1]
                if root not in CODE_ROOTS:
                    return False
                roots.add(root)
                # Runtime secrets/data are not build dependencies and may never be pruned.
                if root != 'node_modules' and any(x in {'.env', '.data', 'paperknow.env',
                                                        'paperknow.sqlite', 'uploads'} for x in p.parts[1:]):
                    return False
                if member.isdev() or member.isfifo():
                    return False
        return {'server.mjs', 'package-lock.json', 'node_modules'} <= roots
    except (OSError, tarfile.TarError, EOFError):
        return False


def referenced_releases(base):
    active = {(base / 'current').resolve(strict=True)}
    # A pinned process cwd must survive even if the current symlink just changed.
    for proc in Path('/proc').iterdir():
        if proc.name.isdigit():
            try:
                cwd = (proc / 'cwd').resolve(strict=True)
                for parent in [cwd, *cwd.parents]:
                    if parent.parent == base / 'releases':
                        active.add(parent)
                        break
            except (OSError, RuntimeError):
                pass
    return active


def known_commit(sha):
    command = ['runuser', '-u', 'paperknow-build', '--', 'git',
               '--git-dir=/opt/paperknow/repository', 'cat-file', '-e', sha + '^{commit}']
    return subprocess.run(command, stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL, timeout=10).returncode == 0


def release_plan(base, protected):
    releases = []
    for p in (base / 'releases').iterdir():
        if not SHA.fullmatch(p.name) or p.is_symlink() or not p.is_dir():
            continue
        if p.stat().st_uid != 0 or not (p / 'server.mjs').is_file() or not (p / 'package-lock.json').is_file():
            continue
        if (p / '.env').exists() or (p / '.data').exists():
            continue
        releases.append(p)
    releases.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    keep = set(protected)
    for p in releases:
        if len(keep) >= 3:
            break
        keep.add(p)
    return keep, [p for p in releases if p not in keep]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--legacy-archives', action='store_true')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('Run the installed PaperKnow retention tool with sudo.')
    for folder in [BASE, BASE / 'releases', BASE / 'backups']:
        if folder.is_symlink() or not folder.is_dir() or folder.stat().st_uid != 0:
            raise SystemExit('Unsafe project directory; no cleanup performed.')
    if not (BASE / 'current').is_symlink():
        raise SystemExit('Current release link is missing; no cleanup performed.')
    lock = BASE / '.deploy.lock'
    if lock.is_symlink():
        raise SystemExit('Unsafe deployment lock.')
    with lock.open('a') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        protected = referenced_releases(BASE)
        if not all(p.parent == BASE / 'releases' and SHA.fullmatch(p.name) for p in protected):
            raise SystemExit('Active release is outside the dedicated release tree.')
        keep, remove = release_plan(BASE, protected)
        removed, skipped = [], []
        for p in remove:
            if not known_commit(p.name):
                skipped.append(p.name)
                continue
            if args.apply:
                shutil.rmtree(p)
            removed.append(str(p.relative_to(BASE)))
        # Legacy archives are not recreated by this tool. Preserve all env/DB snapshots.
        if args.legacy_archives:
            for p in sorted((BASE / 'backups').iterdir()):
                m = ARCHIVE.fullmatch(p.name)
                if not m or p.is_symlink() or not p.is_file() or p.stat().st_uid != 0:
                    continue
                if any(x.name == m[1] for x in keep) or not known_commit(m[1]):
                    skipped.append(p.name)
                    continue
                before = p.stat()
                if not code_only_archive(p, m[1]):
                    skipped.append(p.name)
                    continue
                after = p.stat()
                if (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
                    raise RuntimeError('Archive changed during inspection; stopped.')
                if args.apply:
                    p.unlink()
                removed.append(str(p.relative_to(BASE)))
                print(json.dumps({'verifiedCodeArchive': p.name, 'applied': args.apply}), flush=True)
        result = {'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                  'applied': args.apply, 'keptReleases': sorted(p.name for p in keep),
                  'removedCode': removed, 'skipped': skipped,
                  'databaseAndConfigSnapshots': 'untouched'}
        if args.apply:
            log = BASE / 'retention-last.json'
            temporary = BASE / '.retention-last.tmp'
            temporary.write_text(json.dumps(result, indent=2) + '\n')
            temporary.chmod(0o600)
            temporary.replace(log)
            publish_capacity_summary()
        print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()

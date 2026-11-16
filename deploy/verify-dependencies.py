#!/usr/bin/env python3
"""Read-only validation. Extraction remains under the unprivileged build user."""
from pathlib import Path
import hashlib
import json
import os
import posixpath
import re
import subprocess
import sys
import tarfile


def digest(path):
    with open(path, 'rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def validate_archive(path):
    names = set()
    total = 0
    with tarfile.open(path, 'r:gz') as archive:
        for entry in archive:
            name = entry.name.rstrip('/')
            if (not name or '\\' in name or any(ord(c) < 32 for c in name)
                    or posixpath.normpath(name) != name or name in names
                    or not (name == 'node_modules' or name.startswith('node_modules/'))):
                raise ValueError('invalid dependency archive path')
            names.add(name)
            if len(names) > 300000 or not (entry.isfile() or entry.isdir() or entry.issym()):
                raise ValueError('invalid dependency archive entry')
            if entry.mode & 0o7000:
                raise ValueError('privileged archive mode')
            total += entry.size
            if total > 4 * 1024**3 or entry.size > 1024**3:
                raise ValueError('dependency archive too large')
            if entry.issym():
                target = entry.linkname
                resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), target))
                if (not target or target.startswith('/') or '\\' in target
                        or any(ord(c) < 32 for c in target)
                        or not resolved.startswith('node_modules/')):
                    raise ValueError('dependency symlink escapes archive')
    if 'node_modules' not in names or 'node_modules/.package-lock.json' not in names:
        raise ValueError('dependency archive is incomplete')


def verify(archive, expected, source, runtime):
    archive, source, runtime = Path(archive), Path(source), Path(runtime)
    cache = Path('/opt/paperknow/dependency-cache')
    if (archive.parent != cache or not re.fullmatch(r'[a-f0-9]{64}\.tar\.gz', archive.name)
            or archive.name != expected + '.tar.gz'):
        raise ValueError('use the dedicated content-addressed dependency cache')
    for p in (cache, archive, Path(str(archive) + '.json')):
        s = p.lstat()
        if p.is_symlink() or s.st_uid != 0 or s.st_mode & 0o022:
            raise ValueError('dependency cache must be root-owned and read-only for others')
    if archive.stat().st_size > 2 * 1024**3 or Path(str(archive)+'.json').stat().st_size > 4096:
        raise ValueError('dependency metadata or archive too large')
    manifest = json.loads(Path(str(archive)+'.json').read_text())
    observed = json.loads(subprocess.check_output([str(runtime/'node'), '-e',
        'console.log(JSON.stringify({node:process.version,abi:process.versions.modules,platform:process.platform,arch:process.arch}))'], text=True))
    observed.update(npm=subprocess.check_output([str(runtime/'node'), str(runtime/'../lib/node_modules/npm/bin/npm-cli.js'), '--version'], text=True).strip(),
                    runtimeSha256=digest(runtime/'node'), packageSha256=digest(source/'package.json'),
                    lockSha256=digest(source/'package-lock.json'), archiveSha256=digest(archive), version=1)
    if manifest != observed or observed['archiveSha256'] != expected:
        raise ValueError('dependency identity does not match source and server runtime')
    validate_archive(archive)


if __name__ == '__main__':
    try:
        if os.geteuid() != 0 or len(sys.argv) != 5:
            raise ValueError('run the installed release workflow')
        verify(*sys.argv[1:])
        print('Dependencies match archive hash, lockfile, exact runtime and safe archive boundaries.')
    except Exception:
        raise SystemExit('Dependency validation failed; release not activated.')

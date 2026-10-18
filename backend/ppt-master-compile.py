#!/usr/bin/env python3
"""Fixed trusted entry point to PPT Master's unmodified native compiler.

No model-authored Python, shell, paths, images, URLs, or package templates are
accepted. The Node boundary validates the resource-free SVG subset first.
"""
import hashlib
import json
import os
from pathlib import Path
import sys
sys.dont_write_bytecode = True


def remove_default_printer_settings(output):
    """Drop the python-pptx base template's opaque Windows printer defaults.

    Slides, shapes, text, notes and all other native output remain unchanged.
    This is not slide conversion or an alternate rendering implementation.
    """
    import zipfile
    from xml.etree import ElementTree as ET
    relation_ns = 'http://schemas.openxmlformats.org/package/2006/relationships'
    content_ns = 'http://schemas.openxmlformats.org/package/2006/content-types'
    revised = output.with_suffix('.clean.pptx')
    with zipfile.ZipFile(output) as source, zipfile.ZipFile(revised, 'w', zipfile.ZIP_DEFLATED) as target:
        for info in source.infolist():
            if info.filename.startswith('ppt/printerSettings/'):
                continue
            data = source.read(info.filename)
            if info.filename.endswith('.rels'):
                root = ET.fromstring(data)
                for child in list(root):
                    if child.get('Type', '').endswith('/printerSettings'):
                        root.remove(child)
                ET.register_namespace('', relation_ns)
                data = ET.tostring(root, encoding='utf-8', xml_declaration=True)
            elif info.filename == '[Content_Types].xml':
                root = ET.fromstring(data)
                for child in list(root):
                    if child.get('PartName', '').startswith('/ppt/printerSettings/') or child.get('Extension') == 'bin':
                        root.remove(child)
                ET.register_namespace('', content_ns)
                data = ET.tostring(root, encoding='utf-8', xml_declaration=True)
            target.writestr(info, data)
    os.replace(revised, output)


def limits():
    import resource
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CPU, (60, 60))
    resource.setrlimit(resource.RLIMIT_FSIZE, (20 * 1024 * 1024, 20 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
    if sys.platform.startswith('linux'):
        resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))


def main():
    limits()
    if len(sys.argv) != 3:
        raise ValueError('invalid fixed compiler invocation')
    official = Path(sys.argv[1]).resolve(strict=True)
    workspace = Path(sys.argv[2]).resolve(strict=True)
    lock = json.loads((official / 'source-lock.json').read_text())
    if lock['commit'] != 'b113d23720260c411ee47b2b05a73615f954deeb':
        raise ValueError('unsupported compiler revision')
    for item in lock['files']:
        candidate = (official / item['path']).resolve(strict=True)
        if not candidate.is_relative_to(official) or candidate.is_symlink():
            raise ValueError('invalid compiler distribution')
        data = candidate.read_bytes()
        if len(data) != item['bytes'] or hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError('compiler source integrity failed')
    sys.path.insert(0, str(official / 'scripts'))
    from attribution_guard import require_skill_integrity
    require_skill_integrity()
    from svg_to_pptx import create_pptx_with_native_svg
    plan = json.loads((workspace / 'manifest.json').read_text())
    if not 1 <= len(plan['slides']) <= 40:
        raise ValueError('invalid slide count')
    files = []
    notes = {}
    for i, slide in enumerate(plan['slides'], 1):
        expected = f'{i:03d}.svg'
        if slide['file'] != expected:
            raise ValueError('invalid slide path')
        source = (workspace / 'slides' / expected).resolve(strict=True)
        if source.parent != workspace / 'slides':
            raise ValueError('invalid slide boundary')
        files.append(source)
        notes[source.stem] = slide['notes']
    # Defensive network denial also covers optional upstream imports. This
    # process has no cloud credentials and never launches a model subprocess.
    import socket
    import subprocess
    def denied(*args, **kwargs):
        raise RuntimeError('network and child processes are disabled')
    socket.socket = denied
    socket.create_connection = denied
    subprocess.Popen = denied
    output = workspace / 'presentation.pptx'
    result = create_pptx_with_native_svg(
        files, output, resource_root=workspace,
        canvas_format='ppt169', expected_viewbox='0 0 1280 720',
        verbose=False, use_native_shapes=True, use_compat_mode=False,
        pptx_structure='flat', structure_name='PaperKnow',
        enable_notes=True, notes=notes, workers=1,
        transition=None, animation=None, image_optimize=False,
        text_flow='preserve',
        doc_metadata={'title': 'PaperKnow presentation', 'creator': 'PaperKnow'},
    )
    if not result or not output.is_file() or output.stat().st_size > min(plan['maxOutputBytes'], 20 * 1024 * 1024):
        raise ValueError('native compiler did not produce a bounded deck')
    remove_default_printer_settings(output)
    print(json.dumps({'ok': True, 'slides': len(files)}))


if __name__ == '__main__':
    try:
        main()
    except BaseException:
        # Neither source text nor filesystem/credential details leave the fixed
        # process boundary. The service exposes a stable, localized error.
        print('PPT Master native compilation failed', file=sys.stderr)
        sys.exit(1)

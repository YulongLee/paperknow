#!/usr/bin/python3
"""Refresh a private DOCX copy in memory and export PDF through local UNO.

Only the server-owned executable and private workspace are accepted. The input
DOCX is never saved; Node remains responsible for strict OOXML preflight, the
process-group deadline and final removal of the private workspace.
"""
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid


def apply_resource_limits():
    """Bound this helper and inherited converter processes, not the Node API."""
    if not sys.platform.startswith("linux"):
        return
    import resource
    limits = (
        (resource.RLIMIT_AS, 2 * 1024 * 1024 * 1024, 2 * 1024 * 1024 * 1024),
        (resource.RLIMIT_FSIZE, 25 * 1024 * 1024, 25 * 1024 * 1024),
        (resource.RLIMIT_NOFILE, 256, 256),
        (resource.RLIMIT_CPU, 90, 95),
    )
    for kind, requested_soft, requested_hard in limits:
        current_soft, current_hard = resource.getrlimit(kind)
        hard = requested_hard if current_hard == resource.RLIM_INFINITY else min(requested_hard, current_hard)
        soft = min(requested_soft, hard)
        if current_soft != resource.RLIM_INFINITY:
            soft = min(soft, current_soft)
        resource.setrlimit(kind, (soft, hard))


def require_paths(command, directory):
    executable = Path(command)
    workspace = Path(directory)
    if not executable.is_absolute() or not executable.is_file() or not os.access(executable, os.X_OK):
        raise ValueError("converter unavailable")
    if not workspace.is_absolute() or workspace.is_symlink() or not workspace.is_dir():
        raise ValueError("invalid workspace")
    workspace = workspace.resolve(strict=True)
    if not workspace.name.startswith("paperknow-docx-pdf-"):
        raise ValueError("invalid workspace")
    for name in ("profile", "output"):
        part = workspace / name
        if part.is_symlink() or not part.is_dir():
            raise ValueError("invalid workspace")
    source = workspace / "document.docx"
    if source.is_symlink() or not source.is_file() or not 0 < source.stat().st_size <= 2 * 1024 * 1024:
        raise ValueError("invalid source")
    target = workspace / "output" / "document.pdf"
    if target.exists() or target.is_symlink():
        raise ValueError("output already exists")
    return executable, workspace, source, target


def force_pagination(document):
    """Lay out the whole Writer model before reading page-dependent fields."""
    document.refresh()
    try:
        controller = document.getCurrentController()
        cursor = controller.getViewCursor() if controller is not None else None
    except TimeoutError:
        raise
    except Exception:
        # Some headless Writer builds expose only XRefreshable, not a view
        # cursor. The model refresh still runs; do not alter page styles.
        cursor = None
    if cursor is not None:
        cursor.jumpToLastPage()
        cursor.jumpToFirstPage()
    document.refresh()


def refresh_and_export(document, property_value, target_url):
    """Lay out before/after index changes, then refresh final page counts."""
    indexes = document.getDocumentIndexes()
    count = indexes.getCount()
    if count > 200:
        raise ValueError("too many indexes")
    force_pagination(document)
    for _ in range(2):
        document.getTextFields().refresh()
        for index in range(count):
            indexes.getByIndex(index).update()
        force_pagination(document)
        document.getTextFields().refresh()
    force_pagination(document)
    document.getTextFields().refresh()
    document.storeToURL(target_url, (
        property_value("FilterName", "writer_pdf_Export"),
        property_value("Overwrite", False),
        # Preserve physical pages implied by source page styles/restarts.
        # Otherwise Writer NUMPAGES includes automatic blanks which the PDF
        # filter can silently remove, producing an inconsistent page total.
        property_value("FilterData", (property_value("IsSkipEmptyPages", False),)),
    ))
    return count


def stop_process(process):
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=2)


def convert(command, directory, timeout):
    executable, workspace, source, target = require_paths(command, directory)
    timeout = min(120.0, max(1.0, float(timeout)))
    # Set limits before importing UNO or starting any office process. Failure
    # is fatal: an unbounded converter must never be used as a fallback.
    apply_resource_limits()
    import uno
    import unohelper
    from com.sun.star.task import XInteractionHandler

    class RejectInteraction(unohelper.Base, XInteractionHandler):
        def handle(self, request):
            raise RuntimeError("interactive document request denied")

    def prop(name, value):
        result = uno.createUnoStruct("com.sun.star.beans.PropertyValue")
        result.Name = name
        result.Value = uno.Any("[]com.sun.star.beans.PropertyValue", value) if name == "FilterData" else value
        return result

    def expired(_signal, _frame):
        raise TimeoutError("conversion deadline exceeded")

    before = hashlib.sha256(source.read_bytes()).hexdigest()
    pipe = "paperknow_" + uuid.uuid4().hex
    connection = "pipe,name=" + pipe + ";urp;StarOffice.ComponentContext"
    args = [str(executable), "-env:UserInstallation=" + (workspace / "profile").as_uri(),
            "--headless", "--invisible", "--nologo", "--nodefault", "--norestore",
            "--nolockcheck", "--nofirststartwizard", "--accept=" + connection]
    process = None
    document = None
    desktop = None
    old_alarm = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, timeout)
    try:
        # Remain in Node's process group so its cancellation kills both Python
        # and LibreOffice. Do not start a new session or a public TCP listener.
        process = subprocess.Popen(args, cwd=str(workspace), stdin=subprocess.DEVNULL,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   close_fds=True)
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
        deadline = time.monotonic() + min(timeout, 30.0)
        context = None
        while context is None:
            if process.poll() is not None:
                raise RuntimeError("office exited before connection")
            try:
                context = resolver.resolve("uno:" + connection)
            except Exception:
                if time.monotonic() >= deadline:
                    raise TimeoutError("office connection timed out")
                time.sleep(0.1)
        desktop = context.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", context)
        document = desktop.loadComponentFromURL(uno.systemPathToFileUrl(str(source)), "_blank", 0, (
            prop("Hidden", True), prop("ReadOnly", True), prop("Silent", True),
            prop("MacroExecutionMode", 0),  # MacroExecMode.NEVER_EXECUTE
            prop("UpdateDocMode", 0),       # UpdateDocMode.NO_UPDATE
            prop("InteractionHandler", RejectInteraction()),
        ))
        if document is None or not document.supportsService("com.sun.star.text.TextDocument"):
            raise RuntimeError("not a Writer document")
        index_count = refresh_and_export(document, prop, uno.systemPathToFileUrl(str(target)))
        if not target.is_file() or target.is_symlink() or target.stat().st_size > 20 * 1024 * 1024:
            raise RuntimeError("invalid PDF output")
        if hashlib.sha256(source.read_bytes()).hexdigest() != before:
            raise RuntimeError("source changed during conversion")
        report = {"version": 1, "textFieldsRefreshed": True, "indexesUpdated": index_count,
                  "paginationForced": True, "automaticBlankPagesPreserved": True,
                  "sourceUnchanged": True, "sourceSha256": before}
        (workspace / "conversion-report.json").write_text(json.dumps(report), encoding="utf-8")
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, old_alarm)
        # Never store()/storeAsURL(): closing a read-only in-memory document
        # discards index/field changes while keeping the uploaded DOCX intact.
        if document is not None:
            try:
                document.setModified(False)
                document.close(True)
            except Exception:
                try:
                    document.dispose()
                except Exception:
                    pass
        if desktop is not None:
            try:
                desktop.terminate()
            except Exception:
                pass
        stop_process(process)


def main():
    if len(sys.argv) != 4:
        return 2
    try:
        convert(sys.argv[1], sys.argv[2], sys.argv[3])
        return 0
    except TimeoutError:
        print("Document conversion timed out", file=sys.stderr)
        return 124
    except Exception:
        # Never return document paths, UNO descriptions or manuscript text.
        print("Document conversion failed", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

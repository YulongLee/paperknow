import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.parse import unquote, urlparse

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("converter", Path(__file__).resolve().parent.parent / "backend" / "thesis-document-convert.py")
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)


class HelperTests(unittest.TestCase):
    def test_linux_limits_and_tighter_inherited_caps(self):
        import resource
        calls = []
        with patch.object(converter.sys, "platform", "linux"), patch.object(resource, "getrlimit", lambda _: (resource.RLIM_INFINITY, resource.RLIM_INFINITY)), patch.object(resource, "setrlimit", lambda *args: calls.append(args)):
            converter.apply_resource_limits()
        self.assertEqual(calls, [
            (resource.RLIMIT_AS, (2147483648, 2147483648)),
            (resource.RLIMIT_FSIZE, (26214400, 26214400)),
            (resource.RLIMIT_NOFILE, (256, 256)),
            (resource.RLIMIT_CPU, (90, 95)),
        ])
        calls.clear()
        with patch.object(converter.sys, "platform", "linux"), patch.object(resource, "getrlimit", lambda _: (10, 20)), patch.object(resource, "setrlimit", lambda *args: calls.append(args)):
            converter.apply_resource_limits()
        self.assertTrue(all(value == (10, 20) for _, value in calls))

    def test_limit_setup_failure_never_starts_office(self):
        with tempfile.TemporaryDirectory(prefix="paperknow-docx-pdf-") as directory:
            workspace = Path(directory)
            (workspace / "profile").mkdir()
            (workspace / "output").mkdir()
            source = workspace / "document.docx"
            source.write_bytes(b"PK synthetic original")
            with patch.object(converter, "apply_resource_limits", side_effect=PermissionError("limit denied")), patch.object(converter.subprocess, "Popen") as start:
                with self.assertRaises(PermissionError):
                    converter.convert(sys.executable, directory, 5)
                start.assert_not_called()
            self.assertEqual(source.read_bytes(), b"PK synthetic original")
            self.assertFalse((workspace / "conversion-report.json").exists())

    def test_refresh_order_and_export_only(self):
        calls = []
        fields = SimpleNamespace(refresh=lambda: calls.append("fields"))
        indexes = SimpleNamespace(getCount=lambda: 1, getByIndex=lambda _: SimpleNamespace(update=lambda: calls.append("index")))
        cursor = SimpleNamespace(jumpToLastPage=lambda: calls.append("last-page"), jumpToFirstPage=lambda: calls.append("first-page"))
        document = SimpleNamespace(refresh=lambda: calls.append("layout"), getCurrentController=lambda: SimpleNamespace(getViewCursor=lambda: cursor), getTextFields=lambda: fields, getDocumentIndexes=lambda: indexes, storeToURL=lambda target, props: calls.append((target, props)))
        self.assertEqual(converter.refresh_and_export(document, lambda name, value: (name, value), "file:///private/output.pdf"), 1)
        self.assertEqual(calls[:4], ["layout", "last-page", "first-page", "layout"])
        self.assertEqual(calls.count("index"), 2)
        self.assertEqual(calls[-6:-1], ["layout", "last-page", "first-page", "layout", "fields"])
        self.assertEqual(calls[-1], ("file:///private/output.pdf", (("FilterName", "writer_pdf_Export"), ("Overwrite", False), ("FilterData", (("IsSkipEmptyPages", False),)))))

    def test_page_count_is_refreshed_after_index_changes_layout(self):
        state = {"layout_ready": False, "pages": 10, "cached_total": 15, "exported_total": None}
        def layout(): state["layout_ready"] = True
        def fields():
            if state["layout_ready"]: state["cached_total"] = state["pages"]
        def index():
            state["pages"] = 11
            state["layout_ready"] = False
        document = SimpleNamespace(refresh=layout, getCurrentController=lambda: None,
            getTextFields=lambda: SimpleNamespace(refresh=fields),
            getDocumentIndexes=lambda: SimpleNamespace(getCount=lambda: 1, getByIndex=lambda _: SimpleNamespace(update=index)),
            storeToURL=lambda *_: state.update(exported_total=state["cached_total"]))
        converter.refresh_and_export(document, lambda name, value: (name, value), "file:///private/output.pdf")
        self.assertEqual(state["exported_total"], 11)

    def test_optional_view_cursor_cannot_swallow_deadline(self):
        document = SimpleNamespace(refresh=lambda: None, getCurrentController=lambda: (_ for _ in ()).throw(TimeoutError("deadline")))
        with self.assertRaises(TimeoutError): converter.force_pagination(document)

    def test_subprocess_timeout_is_killed_and_reaped(self):
        calls = []
        def wait(timeout):
            calls.append(("wait", timeout))
            if len([row for row in calls if isinstance(row, tuple)]) == 1:
                raise subprocess.TimeoutExpired("fixed", timeout)
        process = SimpleNamespace(poll=lambda: None, terminate=lambda: calls.append("terminate"), wait=wait, kill=lambda: calls.append("kill"))
        converter.stop_process(process)
        self.assertEqual(calls, ["terminate", ("wait", 2), "kill", ("wait", 2)])

    def test_private_paths_reject_symlink_source(self):
        with tempfile.TemporaryDirectory(prefix="paperknow-docx-pdf-") as directory:
            workspace = Path(directory)
            (workspace / "profile").mkdir()
            (workspace / "output").mkdir()
            (workspace / "real.docx").write_bytes(b"PK synthetic")
            (workspace / "document.docx").symlink_to(workspace / "real.docx")
            with self.assertRaises(ValueError):
                converter.require_paths(sys.executable, directory)

    def test_readonly_load_no_update_macros_disabled_and_original_never_saved(self):
        with tempfile.TemporaryDirectory(prefix="paperknow-docx-pdf-") as directory:
            workspace = Path(directory)
            (workspace / "profile").mkdir()
            (workspace / "output").mkdir()
            source = workspace / "document.docx"
            original = b"PK synthetic original unchanged"
            source.write_bytes(original)
            calls, load_properties = [], {}
            class Document:
                def refresh(self): calls.append("layout")
                def getCurrentController(self): return None
                def supportsService(self, value): return value == "com.sun.star.text.TextDocument"
                def getTextFields(self): return SimpleNamespace(refresh=lambda: calls.append("fields"))
                def getDocumentIndexes(self): return SimpleNamespace(getCount=lambda: 1, getByIndex=lambda _: SimpleNamespace(update=lambda: calls.append("index")))
                def storeToURL(self, target, props):
                    calls.append("pdf-only")
                    Path(unquote(urlparse(target).path)).write_bytes(b"%PDF-1.7 synthetic")
                def setModified(self, value): self.modified = value
                def close(self, value): calls.append("close")
                def store(self): raise AssertionError("must not save DOCX")
                def storeAsURL(self, *_): raise AssertionError("must not overwrite DOCX")
            document = Document()
            def load(url, target, flags, properties):
                self.assertEqual(url, source.resolve().as_uri())
                load_properties.update({prop.Name: prop.Value for prop in properties})
                return document
            desktop = SimpleNamespace(loadComponentFromURL=load, terminate=lambda: calls.append("terminate-desktop"))
            context = SimpleNamespace(ServiceManager=SimpleNamespace(createInstanceWithContext=lambda *_: desktop))
            resolver = SimpleNamespace(resolve=lambda url: (self.assertIn("pipe,name=paperknow_", url), context)[1])
            local = SimpleNamespace(ServiceManager=SimpleNamespace(createInstanceWithContext=lambda *_: resolver))
            uno = ModuleType("uno")
            uno.getComponentContext = lambda: local
            uno.createUnoStruct = lambda _: SimpleNamespace()
            uno.Any = lambda _type, value: value
            uno.systemPathToFileUrl = lambda value: Path(value).as_uri()
            unohelper = ModuleType("unohelper")
            unohelper.Base = type("UnoBase", (), {})
            task = ModuleType("com.sun.star.task")
            task.XInteractionHandler = type("InteractionHandler", (), {})
            process = SimpleNamespace(poll=lambda: None, terminate=lambda: calls.append("terminate-process"), wait=lambda timeout: calls.append("wait-process"), kill=lambda: calls.append("kill-process"))
            def start(args, **kwargs):
                self.assertTrue(any(arg.startswith("--accept=pipe,name=paperknow_") for arg in args))
                self.assertFalse(any("socket," in arg for arg in args))
                self.assertNotIn("start_new_session", kwargs)
                return process
            with patch.dict(sys.modules, {"uno": uno, "unohelper": unohelper, "com.sun.star.task": task}), patch.object(converter, "apply_resource_limits", lambda: calls.append("limits-before-start")), patch.object(converter.subprocess, "Popen", start), patch.object(converter.signal, "signal", lambda *_: None), patch.object(converter.signal, "setitimer", lambda *_: None):
                converter.convert(sys.executable, directory, 5)
            self.assertEqual(calls[0], "limits-before-start")
            self.assertEqual(load_properties["Hidden"], True)
            self.assertEqual(load_properties["ReadOnly"], True)
            self.assertEqual(load_properties["MacroExecutionMode"], 0)
            self.assertEqual(load_properties["UpdateDocMode"], 0)
            with self.assertRaises(RuntimeError):
                load_properties["InteractionHandler"].handle(None)
            self.assertEqual(source.read_bytes(), original)
            report = json.loads((workspace / "conversion-report.json").read_text())
            self.assertTrue(report["sourceUnchanged"])
            self.assertTrue(report["textFieldsRefreshed"])
            self.assertEqual(report["indexesUpdated"], 1)
            self.assertTrue(report["paginationForced"])
            self.assertTrue(report["automaticBlankPagesPreserved"])
            self.assertEqual(report["sourceSha256"], hashlib.sha256(original).hexdigest())
            self.assertIn("close", calls)
            self.assertIn("terminate-process", calls)


if __name__ == "__main__":
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(HelperTests))
    if result.wasSuccessful():
        print("helper-tests-passed")
    sys.exit(0 if result.wasSuccessful() else 1)

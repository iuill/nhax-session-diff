import hashlib
from pathlib import Path
import tempfile
import unittest
import zipfile

from tools.inspect_export import inspect_export


class InspectionTests(unittest.TestCase):
    def test_unknown_payload_is_not_treated_as_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.nhax"
            payload = b"\x00\xffopaque fitting data"
            path.write_bytes(payload)
            result = inspect_export(path)
            self.assertEqual(result["container"], "unknown")
            self.assertFalse(result["settings_decoded"])
            self.assertEqual(result["sha256"], hashlib.sha256(payload).hexdigest())
            self.assertEqual(path.read_bytes(), payload)

    def test_zip_members_are_listed_without_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.nhax"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("../outside.xml", "<synthetic/>")
            result = inspect_export(path)
            self.assertEqual(result["container"], "zip")
            self.assertEqual(result["members"][0]["name"], "../outside.xml")
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_xml_root_with_utf16_encoding(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.nhax"
            path.write_bytes('<?xml version="1.0" encoding="UTF-16"?><synthetic/>'.encode("utf-16"))
            result = inspect_export(path)
            self.assertEqual(result["container"], "xml-root-detected")
            self.assertEqual(result["xml_root"], "synthetic")

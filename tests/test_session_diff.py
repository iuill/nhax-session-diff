import base64
import bz2
from pathlib import Path
import struct
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zlib

from tools.session_diff import compare, private_xml, read_patients


def export(patient):
    raw = ET.tostring(patient, encoding="utf-8")
    compressed = zlib.compress(raw)
    record = struct.pack("<III", 12 + len(compressed), 0x80000005, len(raw)) + compressed
    return struct.pack("<II", 40, 1) + bytes.fromhex("889900ddccbbaa00") + bytes(24) + record


def action(root):
    compressed = bz2.compress(ET.tostring(root, encoding="utf-16"))
    payload = f"<compression zip_size='{len(compressed)}' />".encode() + compressed + b"<compressionend/>"
    result = ET.Element("Action")
    ET.SubElement(result, "PrivateData").text = base64.b64encode(payload).decode()
    return result


class SessionDiffTests(unittest.TestCase):
    def test_multiple_patient_records_and_truncation(self):
        first = export(ET.Element("Patient", PatientNo="synthetic-a"))
        second = export(ET.Element("Patient", PatientNo="synthetic-b"))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "synthetic.nhax"
            path.write_bytes(first + second[40:])
            patients = read_patients(path)
            self.assertEqual([p.get("PatientNo") for _, p in patients], ["synthetic-a", "synthetic-b"])
            path.write_bytes(path.read_bytes()[:-1])
            with self.assertRaises(ValueError):
                read_patients(path)

    def test_private_utf16_and_invalid_wrapper(self):
        root = ET.fromstring("<FittingData><Side>Left</Side><Value>2</Value></FittingData>")
        item = action(root)
        self.assertEqual(private_xml(item).findtext("Value"), "2")
        item.find("PrivateData").text = base64.b64encode(b"unknown format").decode()
        with self.assertRaises(ValueError):
            private_xml(item)

    def test_named_entries_survive_reordering_and_preserve_arrays(self):
        before = ET.fromstring('<FittingData><Side>Left</Side><Entry><Key>a</Key><Value>1</Value></Entry><Entry><Key>b</Key><Value><double>2</double><double>3</double></Value></Entry></FittingData>')
        after = ET.fromstring('<FittingData><Side>Left</Side><Entry><Key>b</Key><Value><double>2</double><double>4</double></Value></Entry><Entry><Key>a</Key><Value>1</Value></Entry></FittingData>')
        differences = compare(before, after)
        self.assertEqual(len(differences), 1)
        self.assertEqual(differences[0]["before"], "3")
        self.assertEqual(differences[0]["after"], "4")

    def test_additions_deletions_and_side_mismatch(self):
        before = ET.fromstring('<FittingData><Side>Left</Side><Old>1</Old></FittingData>')
        after = ET.fromstring('<FittingData><Side>Left</Side><New>2</New></FittingData>')
        self.assertEqual({d["change"] for d in compare(before, after)}, {"added", "removed"})
        after.find("Side").text = "Right"
        with self.assertRaises(ValueError):
            compare(before, after)

    def test_dtd_is_rejected(self):
        from tools.session_diff import xml
        with self.assertRaises(ValueError):
            xml(b'<!DOCTYPE a [<!ENTITY b "value">]><a>&b;</a>')

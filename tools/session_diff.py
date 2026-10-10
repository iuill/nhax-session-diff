"""List NHAX actions and compare decoded XML fields (observed format only)."""

import argparse
import base64
import bz2
from collections import Counter
import hashlib
import json
from pathlib import Path
import struct
import sys
import xml.etree.ElementTree as ET
import zlib

LIMIT = 32 * 1024 * 1024


def xml(data):
    if len(data) > LIMIT:
        raise ValueError("XML exceeds size limit")
    # XML may be UTF-16LE without a BOM in private data.
    if b"<!DOCTYPE" in data.replace(b"\x00", b"").upper():
        raise ValueError("DTD is unsupported")
    return ET.fromstring(data)


def read_patients(path):
    data = path.read_bytes()
    if len(data) < 40 or len(data) > LIMIT:
        raise ValueError("Unsupported NHAX size")
    header_size, version = struct.unpack_from("<II", data)
    if (header_size, version) != (40, 1) or data[8:16] != bytes.fromhex("889900ddccbbaa00"):
        raise ValueError("Unsupported NHAX header; only the observed variant is supported")
    patients = []
    offset = header_size
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError("Truncated record header")
        size, kind = struct.unpack_from("<II", data, offset)
        if size < 8 or offset + size > len(data):
            raise ValueError("Invalid record size")
        payload = data[offset + 8:offset + size]
        if kind == 0x80000005:
            if len(payload) < 4:
                raise ValueError("Truncated compressed patient record")
            expected = struct.unpack_from("<I", payload)[0]
            decoder = zlib.decompressobj()
            decoded = decoder.decompress(payload[4:], LIMIT + 1)
            if len(decoded) > LIMIT or not decoder.eof or decoder.unused_data or len(decoded) != expected:
                raise ValueError("Invalid or oversized compressed patient record")
            root = xml(decoded)
            if root.tag != "Patient":
                raise ValueError("Expected Patient XML")
            patients.append((offset, root))
        elif kind not in (2, 3):
            raise ValueError(f"Unsupported record type {kind:#x}")
        offset += size
    if not patients:
        raise ValueError("No patient records found")
    return patients


def private_xml(action):
    encoded = action.findtext("PrivateData")
    if not encoded:
        raise ValueError("Action has no private data")
    data = base64.b64decode("".join(encoded.split()), validate=True)
    end = data.find(b"/>")
    if end < 0 or not data.startswith(b"<compression "):
        raise ValueError("Unsupported private data wrapper")
    wrapper = xml(data[:end + 2])
    size = int(wrapper.get("zip_size", "-1"))
    compressed = data[end + 2:end + 2 + size]
    if size < 0 or data[end + 2 + size:] != b"<compressionend/>" or not compressed.startswith(b"BZh"):
        raise ValueError("Invalid or unsupported private compression")
    decoder = bz2.BZ2Decompressor()
    decoded = decoder.decompress(compressed, max_length=LIMIT + 1)
    if len(decoded) > LIMIT or not decoder.eof or decoder.unused_data:
        raise ValueError("Invalid or oversized private XML")
    return xml(decoded)


def fields(root):
    """Preserve XML names and raw values; use explicit keys when available."""
    result = {}

    def visit(node, path):
        for key, value in node.attrib.items():
            result[path + "/@" + key] = value
        if node.text and node.text.strip():
            result[path + "/#text"] = node.text.strip()
        children = list(node)
        labels = []
        for child in children:
            identity = next((child.findtext(k) for k in ("Path", "Key", "Name") if child.findtext(k)), None)
            labels.append(child.tag + ("[" + json.dumps(identity, ensure_ascii=False) + "]" if identity else ""))
        totals, seen = Counter(labels), Counter()
        for child, label in zip(children, labels):
            index = seen[label]
            seen[label] += 1
            if totals[label] > 1:
                label += f"[{index}]"
            visit(child, path + "/" + label)

    visit(root, root.tag)
    return result


def actions(patients):
    return {
        f"p{pi}/s{si}/a{ai}": action
        for pi, (_, patient) in enumerate(patients)
        for si, session in enumerate(patient.findall("./Sessions/Session"))
        for ai, action in enumerate(session.findall("Action"))
    }


def inventory(patients):
    result = []
    for pi, (offset, patient) in enumerate(patients):
        sessions = []
        for si, session in enumerate(patient.findall("./Sessions/Session")):
            entries = []
            for ai, action in enumerate(session.findall("Action")):
                entry = {"selector": f"p{pi}/s{si}/a{ai}", **action.attrib}
                if action.find("PrivateData") is not None:
                    try:
                        root = private_xml(action)
                        entry["private_xml_root"] = root.tag
                        entry["xml_field_count"] = len(fields(root))
                        entry["side"] = root.findtext("Side")
                    except (ValueError, OSError, EOFError, ET.ParseError) as error:
                        entry["decode_error"] = str(error)
                entries.append(entry)
            sessions.append({"attributes": session.attrib, "actions": entries})
        result.append({"index": pi, "record_offset": offset, "attributes": patient.attrib, "sessions": sessions})
    return result


def compare(left, right):
    if left.tag != right.tag or left.findtext("Side") != right.findtext("Side"):
        raise ValueError("Select matching XML data types and sides")
    before, after = fields(left), fields(right)
    return [
        {"path": key, "change": "added" if key not in before else "removed" if key not in after else "changed",
         "before": before.get(key), "after": after.get(key)}
        for key in sorted(before.keys() | after.keys())
        if before.get(key) != after.get(key)
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path)
    parser.add_argument("--compare", nargs=2, metavar=("BEFORE", "AFTER"))
    parser.add_argument("--after-file", type=Path, help="Comparison target export; defaults to file")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        patients = read_patients(args.file)
        report = {"source": args.file.name, "source_sha256": hashlib.sha256(args.file.read_bytes()).hexdigest()}
        if args.compare:
            before, after = args.compare
            target = read_patients(args.after_file) if args.after_file else patients
            report.update({"before": before, "after": after,
                           "after_source": (args.after_file or args.file).name,
                           "after_source_sha256": hashlib.sha256((args.after_file or args.file).read_bytes()).hexdigest(),
                           "comparison": "raw XML fields; UI meanings and units unverified",
                           "differences": compare(private_xml(actions(patients)[before]), private_xml(actions(target)[after]))})
        else:
            if args.after_file:
                raise ValueError("--after-file requires --compare")
            report["patients"] = inventory(patients)
        rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
        if args.output:
            with args.output.open("x", encoding="utf-8") as output:
                output.write(rendered)
        else:
            print(rendered, end="")
    except (ValueError, OSError, EOFError, zlib.error, ET.ParseError, KeyError) as error:
        print(f"Analysis failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

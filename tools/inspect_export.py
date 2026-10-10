"""Read-only container inspection; does not decode fitting settings."""

import argparse
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
import zipfile


def inspect_export(path: Path) -> dict:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        prefix = source.read(16)
        digest.update(prefix)
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    report = {
        "file": path.name,
        "size_bytes": path.stat().st_size,
        "sha256": digest.hexdigest(),
        "prefix_hex": prefix.hex(),
        "container": "unknown",
        "settings_decoded": False,
    }
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            report["container"] = "zip"
            report["members"] = [
                {
                    "name": entry.filename,
                    "size_bytes": entry.file_size,
                    "compressed_bytes": entry.compress_size,
                    "encrypted": bool(entry.flag_bits & 1),
                }
                for entry in archive.infolist()
            ]
    else:
        # Only look for the root; do not load payloads or infer a schema.
        try:
            with path.open("rb") as source:
                for _, element in ET.iterparse(source, events=("start",)):
                    report["container"] = "xml-root-detected"
                    report["xml_root"] = element.tag
                    break
        except ET.ParseError:
            pass
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        if args.output and args.output.resolve() == args.file.resolve():
            raise ValueError("Output must differ from the input file")
        report = inspect_export(args.file)
        rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
        if args.output:
            # Refuse to overwrite any existing file, including linked inputs.
            with args.output.open("x", encoding="utf-8") as output:
                output.write(rendered)
        else:
            print(rendered, end="")
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"Inspection failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

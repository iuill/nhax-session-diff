"""Generate synthetic export bytes for browser tests; no real patient data."""
import base64
import bz2
import struct
import sys
import xml.etree.ElementTree as ET
import zlib

data = bytearray(struct.pack('<II', 40, 1) + bytes.fromhex('889900ddccbbaa00') + bytes(24))
variant = int(sys.argv[1]) if len(sys.argv) > 1 else 0
for pi, label in enumerate(['Synthetic baseline', 'Synthetic update']):
    patient = ET.Element('Patient', FirstName=label, PatientNo=str(pi))
    sessions = ET.SubElement(patient, 'Sessions')
    session = ET.SubElement(sessions, 'Session', CreateDate='2000-01-01')
    for ai, side in enumerate(['Left', 'Right']):
        action = ET.SubElement(session, 'Action', UniqueId=str(ai), CreateDate=f'2000-01-01T0{pi}:00:00', ActionGroup=f'2000-01-01T0{pi}:00:00', Description='Synthetic fitting')
        root = ET.Element('FittingData')
        ET.SubElement(root, 'Side').text = side
        ET.SubElement(root, 'FittingId').text = f'synthetic-{pi}-{side}'
        entry = ET.SubElement(root, 'Entry')
        ET.SubElement(entry, 'Key').text = 'synthetic_gain'
        ET.SubElement(entry, 'Value').text = str(pi + (ai * 10) + variant)
        compressed = bz2.compress(ET.tostring(root, encoding='utf-16'))
        wrapper = f"<compression zip_size='{len(compressed)}' />".encode() + compressed + b'<compressionend/>'
        ET.SubElement(action, 'PrivateData').text = base64.b64encode(wrapper).decode()
    for ai, kind in enumerate(['ClientProfile', 'SelectionData', 'InstrumentLoggingData'], start=2):
        action = ET.SubElement(session, 'Action', UniqueId=str(ai), ActionGroup=f'2000-01-01T0{pi}:00:00')
        root = ET.Element(kind)
        ET.SubElement(root, 'SyntheticValue').text = str(pi)
        compressed = bz2.compress(ET.tostring(root, encoding='utf-16'))
        wrapper = f"<compression zip_size='{len(compressed)}' />".encode() + compressed + b'<compressionend/>'
        ET.SubElement(action, 'PrivateData').text = base64.b64encode(wrapper).decode()
    if '--history' in sys.argv:
        for ai, side in enumerate(['Left', 'Right'], start=5):
            action = ET.SubElement(session, 'Action', UniqueId=str(ai), ActionGroup=f'2000-01-01T0{pi+2}:00:00')
            root = ET.Element('FittingData')
            ET.SubElement(root, 'Side').text = side
            ET.SubElement(root, 'FittingId').text = f'synthetic-later-{pi}-{side}'
            entry = ET.SubElement(root, 'Entry')
            ET.SubElement(entry, 'Key').text = 'synthetic_gain'
            ET.SubElement(entry, 'Value').text = str(pi + ((ai-5) * 10) + variant + 2)
            compressed = bz2.compress(ET.tostring(root, encoding='utf-16'))
            wrapper = f"<compression zip_size='{len(compressed)}' />".encode() + compressed + b'<compressionend/>'
            ET.SubElement(action, 'PrivateData').text = base64.b64encode(wrapper).decode()
    raw = ET.tostring(patient, encoding='utf-8')
    compressed = zlib.compress(raw)
    data.extend(struct.pack('<III', 12 + len(compressed), 0x80000005, len(raw)) + compressed)
sys.stdout.buffer.write(data)

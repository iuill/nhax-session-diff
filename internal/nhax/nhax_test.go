package nhax

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"strings"
	"testing"
)

func syntheticExport(t *testing.T, patient string) []byte {
	t.Helper()
	var compressed bytes.Buffer
	w := zlib.NewWriter(&compressed)
	if _, err := w.Write([]byte(patient)); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	data := make([]byte, 52)
	binary.LittleEndian.PutUint32(data, 40)
	binary.LittleEndian.PutUint32(data[4:], 1)
	copy(data[8:], []byte{0x88, 0x99, 0, 0xdd, 0xcc, 0xbb, 0xaa, 0})
	binary.LittleEndian.PutUint32(data[40:], uint32(12+compressed.Len()))
	binary.LittleEndian.PutUint32(data[44:], 0x80000005)
	binary.LittleEndian.PutUint32(data[48:], uint32(len(patient)))
	return append(data, compressed.Bytes()...)
}

func TestPatientRecordsAndCorruption(t *testing.T) {
	a := syntheticExport(t, `<Patient PatientNo="synthetic-a"><Sessions><Session CreateDate="2000-01-01"><Action UniqueId="1"/></Session></Sessions></Patient>`)
	b := syntheticExport(t, `<Patient PatientNo="synthetic-b"/>`)
	data := append(a, b[40:]...)
	export, err := Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(export.Patients) != 2 || export.Patients[1].Attributes["PatientNo"] != "synthetic-b" {
		t.Fatal("patient separation lost")
	}
	if _, err := export.Select("p0/s0/a0"); err != nil {
		t.Fatal(err)
	}
	if _, err := export.Select("p1/s0/a0"); err == nil {
		t.Fatal("nonexistent action accepted")
	}
	if _, err := Parse(data[:len(data)-1]); err == nil {
		t.Fatal("truncated record accepted")
	}
	corrupt := append([]byte{}, a...)
	corrupt[len(corrupt)-1] ^= 1
	if _, err := Parse(corrupt); err == nil {
		t.Fatal("invalid checksum accepted")
	}
}

func TestPrivateBzipUTF16(t *testing.T) {
	// Synthetic XML only; no real export or patient information.
	const encoded = "PGNvbXByZXNzaW9uIHppcF9zaXplPScxMDYnIC8+QlpoOTFBWSZTWf/BxsMAADNfgEAAAACQBQcMCQAnpRYgIABQoNGjQZAaCU0poaNNGjajTJiTX90yYsYVnSdXN9kktHcUyXZwQYIL3K2KwWqQOUaCR7IcmZnxgoYGGY/F3JFOFCQ/8HGwwDxjb21wcmVzc2lvbmVuZC8+"
	root, err := decodePrivate(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if root.Name != "FittingData" || root.text("Side") != "Left" {
		t.Fatal("UTF-16 private XML not decoded")
	}
	if _, err := decodePrivate("bad base64"); err == nil {
		t.Fatal("invalid base64 accepted")
	}
}

func TestKeyedReorderingAndArrayChange(t *testing.T) {
	left, err := parseXML([]byte(`<FittingData><Side>Left</Side><Entry><Key>a</Key><Value>1</Value></Entry><Entry><Key>b</Key><Value><double>2</double><double>3</double></Value></Entry></FittingData>`))
	if err != nil {
		t.Fatal(err)
	}
	right, err := parseXML([]byte(`<FittingData><Side>Left</Side><Entry><Key>b</Key><Value><double>2</double><double>4</double></Value></Entry><Entry><Key>a</Key><Value>1</Value></Entry></FittingData>`))
	if err != nil {
		t.Fatal(err)
	}
	a, b := &Action{Root: left.Name, Side: left.text("Side"), Fields: fields(left)}, &Action{Root: right.Name, Side: right.text("Side"), Fields: fields(right)}
	diff, err := Compare(a, b)
	if err != nil {
		t.Fatal(err)
	}
	if len(diff) != 1 || *diff[0].Before != "3" || *diff[0].After != "4" {
		t.Fatalf("unexpected diff: %+v", diff)
	}
	b.Side = "Right"
	if _, err := Compare(a, b); err == nil {
		t.Fatal("side mismatch accepted")
	}
}

func TestUnsupportedAndUndecodedData(t *testing.T) {
	if _, err := Parse([]byte("unknown")); err == nil {
		t.Fatal("unknown file accepted")
	}
	for _, text := range []string{`<!DOCTYPE a [<!ENTITY b "value">]><a>&b;</a>`, `<a/><b/>`, `<a>`, `<a>` + strings.Repeat(`<b>`, 129)} {
		if _, err := parseXML([]byte(text)); err == nil {
			t.Fatalf("invalid XML accepted: %.30s", text)
		}
	}
	if _, err := Compare(&Action{}, &Action{}); err == nil {
		t.Fatal("undecoded data compared")
	}
}

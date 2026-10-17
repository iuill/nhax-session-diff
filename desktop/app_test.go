package main

import (
	"encoding/base64"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/iuill/nhax-session-diff/internal/nhax"
)

func TestNativeComparisonMatchesCore(t *testing.T) {
	python, err := exec.LookPath("python3")
	if err != nil {
		python, err = exec.LookPath("python")
	}
	if err != nil {
		t.Fatal("Python is required to generate synthetic test data")
	}
	data, err := exec.Command(python, "../tests/browser/synthetic.py", "0", "--arrays").Output()
	if err != nil {
		t.Fatal(err)
	}
	encoded := base64.StdEncoding.EncodeToString(data)
	app := &App{}
	parsed, err := app.Parse(encoded)
	if err != nil {
		t.Fatal(err)
	}
	before, err := parsed.Select("p0/s0/a0")
	if err != nil {
		t.Fatal(err)
	}
	after, err := parsed.Select("p1/s0/a0")
	if err != nil {
		t.Fatal(err)
	}
	want, err := nhax.Compare(before, after)
	if err != nil {
		t.Fatal(err)
	}
	got, err := app.Compare(encoded, "p0/s0/a0", encoded, "p1/s0/a0")
	if err != nil || !reflect.DeepEqual(got, want) || len(got) != 8 {
		t.Fatalf("comparison: %v, %v", got, err)
	}
	if _, err := app.Compare(encoded, "invalid", encoded, "p1/s0/a0"); err == nil {
		t.Fatal("invalid selector accepted")
	}
	if _, err := app.Parse("invalid base64"); err == nil {
		t.Fatal("invalid encoding accepted")
	}
}

func TestReadSelectedDoesNotModifySource(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "example.nhax")
	data := []byte("synthetic source")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	file := readSelected(path)
	if file.Error != "" || string(file.Data) != string(data) || file.Name != "example.nhax" {
		t.Fatalf("%+v", file)
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != string(data) {
		t.Fatal("source changed")
	}
	if readSelected(filepath.Join(dir, "other.txt")).Error == "" {
		t.Fatal("non-NHAX accepted")
	}
}

func TestJournalPersistsIntentAndObservation(t *testing.T) {
	dir := t.TempDir()
	app := &App{historyDir: dir}
	refs := []SnapshotRef{{File: "synthetic.nhax", SHA256: "synthetic-hash", Patient: "Synthetic", Time: "2026-01-01", Kind: "FittingData", Selectors: []string{"p0/s0/a0"}}}
	first, err := app.SaveEntry(JournalDraft{Kind: "intent", Text: "  音量を調整した理由\n詳細  ", Snapshots: refs})
	if err != nil {
		t.Fatal(err)
	}
	second, err := app.SaveEntry(JournalDraft{Kind: "observation", Text: "電車の中では聞き取りづらかった"})
	if err != nil {
		t.Fatal(err)
	}
	// A separate instance simulates reopening the application against the same folder.
	reopened := &App{historyDir: dir}
	journal, err := reopened.GetJournal()
	if err != nil {
		t.Fatal(err)
	}
	if len(journal.Entries) != 2 || journal.Entries[0].ID != second.ID || journal.Entries[1].ID != first.ID {
		t.Fatalf("%+v", journal)
	}
	if journal.Entries[1].Text != "音量を調整した理由\n詳細" || !reflect.DeepEqual(journal.Entries[1].Snapshots, refs) {
		t.Fatal("record contents changed")
	}
	for _, bad := range []JournalDraft{{Kind: "intent", Text: " "}, {Kind: "other", Text: "x"}} {
		if _, err := app.SaveEntry(bad); err == nil {
			t.Fatal("invalid record saved")
		}
	}
	if _, err := (&App{}).SaveEntry(JournalDraft{Kind: "intent", Text: "x"}); err == nil {
		t.Fatal("missing folder accepted")
	}
	files, err := os.ReadDir(filepath.Join(dir, "journal"))
	if err != nil || len(files) != 2 {
		t.Fatal("unexpected partial or invalid record")
	}
}

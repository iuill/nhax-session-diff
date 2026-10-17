package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type SnapshotRef struct {
	File      string   `json:"file"`
	SHA256    string   `json:"sha256"`
	Patient   string   `json:"patient"`
	Time      string   `json:"time"`
	Kind      string   `json:"kind"`
	Selectors []string `json:"selectors"`
}
type JournalDraft struct {
	Kind      string        `json:"kind"`
	Text      string        `json:"text"`
	Snapshots []SnapshotRef `json:"snapshots,omitempty"`
}
type JournalEntry struct {
	ID        string `json:"id"`
	CreatedAt string `json:"created_at"`
	JournalDraft
}
type Journal struct {
	Folder  string         `json:"folder"`
	Entries []JournalEntry `json:"entries"`
}

func preferencesPath() (string, error) {
	dir, err := os.UserConfigDir()
	return filepath.Join(dir, "nhax-session-diff", "preferences.json"), err
}

func (a *App) ChooseHistoryFolder() (*Journal, error) {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "記録を保存する履歴フォルダーを選択"})
	if err != nil {
		return nil, err
	}
	if dir == "" {
		return a.GetJournal()
	}
	// Remember only the folder location, not NHAX contents or observations.
	path, err := preferencesPath()
	if err != nil {
		return nil, err
	}
	data, err := json.Marshal(map[string]string{"history_dir": dir})
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	if err = os.WriteFile(path, data, 0600); err != nil {
		return nil, err
	}
	a.mu.Lock()
	a.historyDir = dir
	a.mu.Unlock()
	return a.GetJournal()
}

func (a *App) GetJournal() (*Journal, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return loadJournal(a.historyDir)
}

func loadJournal(dir string) (*Journal, error) {
	journal := &Journal{Folder: dir, Entries: []JournalEntry{}}
	if dir == "" {
		return journal, nil
	}
	entries, err := os.ReadDir(filepath.Join(dir, "journal"))
	if os.IsNotExist(err) {
		return journal, nil
	}
	if err != nil {
		return nil, err
	}
	for _, file := range entries {
		if file.IsDir() || filepath.Ext(file.Name()) != ".json" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, "journal", file.Name()))
		if err != nil {
			return nil, err
		}
		var entry JournalEntry
		if err = json.Unmarshal(data, &entry); err != nil {
			return nil, fmt.Errorf("%s: %w", file.Name(), err)
		}
		journal.Entries = append(journal.Entries, entry)
	}
	sort.Slice(journal.Entries, func(i, j int) bool { return journal.Entries[i].CreatedAt > journal.Entries[j].CreatedAt })
	return journal, nil
}

func (a *App) SaveEntry(draft JournalDraft) (*JournalEntry, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.historyDir == "" {
		return nil, fmt.Errorf("記録の保存先フォルダーを選択してください。")
	}
	if draft.Kind != "intent" && draft.Kind != "observation" {
		return nil, fmt.Errorf("invalid entry kind")
	}
	draft.Text = strings.TrimSpace(draft.Text)
	if draft.Text == "" || len(draft.Text) > 65536 {
		return nil, fmt.Errorf("記録は1〜65536バイトで入力してください。")
	}
	if len(draft.Snapshots) > 2 {
		return nil, fmt.Errorf("too many snapshot references")
	}
	encoded, err := json.Marshal(draft.Snapshots)
	if err != nil || len(encoded) > 65536 {
		return nil, fmt.Errorf("snapshot references exceed size limit")
	}
	now := time.Now().UTC()
	suffix := make([]byte, 8)
	if _, err := rand.Read(suffix); err != nil {
		return nil, err
	}
	entry := &JournalEntry{ID: now.Format("20060102T150405.000000000Z") + "-" + hex.EncodeToString(suffix), CreatedAt: now.Format(time.RFC3339Nano), JournalDraft: draft}
	data, err := json.MarshalIndent(entry, "", "  ")
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(a.historyDir, "journal")
	if err = os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	// Stage then rename so readers and Git never see a partially written JSON entry.
	tmp, err := os.CreateTemp(dir, ".entry-*")
	if err != nil {
		return nil, err
	}
	defer os.Remove(tmp.Name())
	if _, err = tmp.Write(append(data, '\n')); err != nil {
		tmp.Close()
		return nil, err
	}
	if err = tmp.Close(); err != nil {
		return nil, err
	}
	if err = os.Rename(tmp.Name(), filepath.Join(dir, entry.ID+".json")); err != nil {
		return nil, err
	}
	return entry, nil
}

package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/iuill/nhax-session-diff/internal/nhax"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx        context.Context
	mu         sync.Mutex
	historyDir string
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if path, err := preferencesPath(); err == nil {
		var pref struct {
			HistoryDir string `json:"history_dir"`
		}
		if data, err := os.ReadFile(path); err == nil && json.Unmarshal(data, &pref) == nil {
			a.historyDir = pref.HistoryDir
		}
	}
}

func decode(encoded string) ([]byte, error) {
	if len(encoded) > base64.StdEncoding.EncodedLen(nhax.Limit) {
		return nil, fmt.Errorf("NHAX exceeds size limit")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, err
	}
	if len(data) > nhax.Limit {
		return nil, fmt.Errorf("NHAX exceeds size limit")
	}
	return data, nil
}

func (a *App) Parse(encoded string) (*nhax.Export, error) {
	data, err := decode(encoded)
	if err != nil {
		return nil, err
	}
	return nhax.Parse(data)
}

func (a *App) Compare(before, beforeSelector, after, afterSelector string) ([]nhax.Difference, error) {
	left, err := a.Parse(before)
	if err != nil {
		return nil, err
	}
	right, err := a.Parse(after)
	if err != nil {
		return nil, err
	}
	x, err := left.Select(beforeSelector)
	if err != nil {
		return nil, err
	}
	y, err := right.Select(afterSelector)
	if err != nil {
		return nil, err
	}
	return nhax.Compare(x, y)
}

type SelectedFile struct {
	Name  string `json:"name"`
	Data  []byte `json:"data"`
	Error string `json:"error,omitempty"`
}

// Only paths chosen in the native dialog are read; arbitrary paths are not exposed to JS.
func readSelected(path string) SelectedFile {
	result := SelectedFile{Name: filepath.Base(path)}
	if !strings.EqualFold(filepath.Ext(path), ".nhax") {
		result.Error = "NHAXファイルを選択してください。"
		return result
	}
	f, err := os.Open(path)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, nhax.Limit+1))
	if err != nil {
		result.Error = err.Error()
		return result
	}
	if len(data) > nhax.Limit {
		result.Error = "ファイルサイズが32 MiBを超えています。"
		return result
	}
	result.Data = data
	return result
}

func (a *App) OpenFiles() ([]SelectedFile, error) {
	paths, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "比較するNHAXを選択", Filters: []runtime.FileFilter{{DisplayName: "NHAX", Pattern: "*.nhax"}},
	})
	if err != nil {
		return nil, err
	}
	files := make([]SelectedFile, 0, len(paths))
	for _, path := range paths {
		files = append(files, readSelected(path))
	}
	return files, nil
}

func (a *App) SaveReport(report string) (bool, error) {
	if !json.Valid([]byte(report)) {
		return false, fmt.Errorf("invalid JSON report")
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title: "比較結果を保存", DefaultFilename: "nhax-comparison.json",
		Filters: []runtime.FileFilter{{DisplayName: "JSON", Pattern: "*.json"}},
	})
	if err != nil || path == "" {
		return false, err
	}
	if !strings.EqualFold(filepath.Ext(path), ".json") {
		return false, fmt.Errorf("保存先の拡張子は.jsonにしてください。")
	}
	return true, os.WriteFile(path, []byte(report), 0600)
}

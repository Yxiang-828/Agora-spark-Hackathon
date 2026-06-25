package main

import (
	"archive/zip"
	"bytes"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// GET /connector/bundle?code=...&agents=claude,codex&workdir=claude%3DC:\proj
// Returns a zip of the connector + per-OS double-click launchers with the pairing code,
// room URL, agent picks and workspaces BAKED IN — so a teammate downloads one file,
// unzips, and double-clicks. No git clone, no terminal typing.
func (p *Plugin) handleConnectorBundle(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "code required", http.StatusBadRequest)
		return
	}
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	roomURL := scheme + "://" + r.Host

	// Reuse the same args pair.py accepts (cross-OS — no env/shell differences).
	args := ""
	if a := r.URL.Query().Get("agents"); a != "" {
		args += " --agents " + a
	}
	for _, wd := range r.URL.Query()["workdir"] {
		if strings.Contains(wd, "=") {
			args += " --workdir \"" + wd + "\""
		}
	}

	srcDir := ""
	if bp, err := p.API.GetBundlePath(); err == nil {
		srcDir = filepath.Join(bp, "assets", "connector")
	}
	if srcDir == "" {
		http.Error(w, "connector not available", http.StatusInternalServerError)
		return
	}
	if _, err := os.Stat(srcDir); err != nil {
		http.Error(w, "connector not bundled (run scripts/sync-connector.sh before build)", http.StatusInternalServerError)
		return
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	add := func(name, content string) {
		if fw, err := zw.Create("agora-connector/" + name); err == nil {
			_, _ = fw.Write([]byte(content))
		}
	}
	// connector source
	_ = filepath.Walk(srcDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		rel := filepath.ToSlash(strings.TrimPrefix(path, srcDir+string(os.PathSeparator)))
		if strings.Contains(rel, "__pycache__") {
			return nil
		}
		if data, e := os.ReadFile(path); e == nil {
			add(rel, string(data))
		}
		return nil
	})
	// per-OS double-click launchers (the only thing the user touches)
	add("start-windows.bat",
		"@echo off\r\ncd /d \"%~dp0\"\r\necho Connecting your AI to Agora...\r\npython pair.py "+code+" "+roomURL+args+"\r\necho.\r\necho Keep this window open. Close it to disconnect.\r\npause\r\n")
	unix := "#!/usr/bin/env bash\ncd \"$(dirname \"$0\")\"\necho 'Connecting your AI to Agora...'\npython3 pair.py " + code + " " + roomURL + args + "\n"
	add("start-macos.command", unix)
	add("start-linux.sh", unix)
	add("README.txt",
		"Agora connector\n\n"+
			"1. Make sure Python 3 and your AI CLI (claude / codex / gemini) are installed and logged in.\n"+
			"2. Double-click the launcher for your OS:\n"+
			"     Windows : start-windows.bat\n"+
			"     macOS   : start-macos.command\n"+
			"     Linux   : start-linux.sh   (or: bash start-linux.sh)\n\n"+
			"Your AI joins the room. Keep the window open; close it to disconnect.\n"+
			"Room: "+roomURL+"\n")
	if err := zw.Close(); err != nil {
		http.Error(w, "zip failed", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename=agora-connector.zip")
	_, _ = w.Write(buf.Bytes())
}

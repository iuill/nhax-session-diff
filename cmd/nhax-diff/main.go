package main

import (
	"crypto/sha256"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/iuill/nhax-session-diff/internal/nhax"
)

func load(path string) (*nhax.Export, string, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, "", err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, nhax.Limit+1))
	if err != nil {
		return nil, "", err
	}
	export, err := nhax.Parse(data)
	return export, fmt.Sprintf("%x", sha256.Sum256(data)), err
}

func run(args []string, out io.Writer) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: nhax-diff list FILE | diff --before SELECTOR --after SELECTOR [--format json|text] FILE [AFTER_FILE]")
	}
	flags := flag.NewFlagSet(args[0], flag.ContinueOnError)
	flags.SetOutput(out)
	before := flags.String("before", "", "Comparison source selector")
	after := flags.String("after", "", "Comparison target selector")
	format := flags.String("format", "json", "Output format: json or text")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	files := flags.Args()
	if *format != "json" && *format != "text" {
		return fmt.Errorf("unsupported format %q", *format)
	}
	if args[0] != "list" && args[0] != "diff" {
		return fmt.Errorf("unknown command %q", args[0])
	}
	if len(files) < 1 || len(files) > 2 || (args[0] == "list" && len(files) != 1) {
		return fmt.Errorf("provide one source export and optionally a comparison target export")
	}
	first, hash, err := load(files[0])
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(out)
	encoder.SetIndent("", "  ")
	encoder.SetEscapeHTML(false)
	if args[0] == "list" {
		if *before != "" || *after != "" {
			return fmt.Errorf("selectors require diff")
		}
		if *format == "json" {
			return encoder.Encode(map[string]any{"source": files[0], "source_sha256": hash, "patients": first.Patients})
		}
		for _, p := range first.Patients {
			fmt.Fprintf(out, "Patient p%d: %s %s\n", p.Index, p.Attributes["FirstName"], p.Attributes["LastName"])
			for _, s := range p.Sessions {
				for _, a := range s.Actions {
					fmt.Fprintf(out, "  %s  %s  %s  %s %s", a.Selector, a.Attributes["CreateDate"], a.Attributes["Description"], a.Root, a.Side)
					if a.DecodeError != "" {
						fmt.Fprintf(out, "  [decode error: %s]", a.DecodeError)
					}
					fmt.Fprintln(out)
				}
			}
		}
		return nil
	}
	if *before == "" || *after == "" {
		return fmt.Errorf("diff requires --before and --after; use list to find selectors")
	}
	second, targetHash, targetFile := first, hash, files[0]
	if len(files) == 2 {
		targetFile = files[1]
		second, targetHash, err = load(targetFile)
		if err != nil {
			return err
		}
	}
	left, err := first.Select(*before)
	if err != nil {
		return err
	}
	right, err := second.Select(*after)
	if err != nil {
		return err
	}
	differences, err := nhax.Compare(left, right)
	if err != nil {
		return err
	}
	if *format == "json" {
		return encoder.Encode(map[string]any{
			"source": files[0], "source_sha256": hash, "after_source": targetFile, "after_source_sha256": targetHash,
			"before": *before, "after": *after, "comparison": "raw XML fields; UI meanings and units unverified", "differences": differences,
		})
	}
	fmt.Fprintf(out, "%s %s -> %s %s\n", files[0], *before, targetFile, *after)
	fmt.Fprintf(out, "XML field differences: %d (UI meanings and units unverified)\n", len(differences))
	for _, d := range differences {
		old, next := "<absent>", "<absent>"
		if d.Before != nil {
			old = *d.Before
		}
		if d.After != nil {
			next = *d.After
		}
		fmt.Fprintf(out, "- %s: %s -> %s\n", d.Path, old, next)
	}
	return nil
}

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "Analysis failed:", err)
		os.Exit(1)
	}
}

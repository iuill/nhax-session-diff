// Package nhax provides read-only NHAX parsing and raw XML comparison.
package nhax

import core "github.com/iuill/nhax-session-diff/internal/nhax"

const Limit = core.Limit

type Export = core.Export
type Action = core.Action
type Difference = core.Difference

func Parse(data []byte) (*Export, error)                  { return core.Parse(data) }
func Compare(before, after *Action) ([]Difference, error) { return core.Compare(before, after) }

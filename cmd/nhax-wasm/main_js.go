//go:build js && wasm

package main

import (
	"encoding/json"
	"fmt"
	"syscall/js"

	"github.com/iuill/nhax-session-diff/internal/nhax"
)

func input(value js.Value) ([]byte, error) {
	if !value.InstanceOf(js.Global().Get("Uint8Array")) {
		return nil, fmt.Errorf("expected Uint8Array")
	}
	if value.Length() > nhax.Limit {
		return nil, fmt.Errorf("NHAX exceeds size limit")
	}
	data := make([]byte, value.Length())
	js.CopyBytesToGo(data, value)
	return data, nil
}

func response(result any, err error) string {
	var envelope any = map[string]any{"result": result}
	if err != nil {
		envelope = map[string]any{"error": err.Error()}
	}
	encoded, _ := json.Marshal(envelope)
	return string(encoded)
}

func main() {
	parse := js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) != 1 {
			return response(nil, fmt.Errorf("expected one NHAX byte array"))
		}
		data, err := input(args[0])
		if err != nil {
			return response(nil, err)
		}
		export, err := nhax.Parse(data)
		return response(export, err)
	})
	compare := js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) != 4 || args[1].Type() != js.TypeString || args[3].Type() != js.TypeString {
			return response(nil, fmt.Errorf("expected bytes, selector, bytes, selector"))
		}
		beforeBytes, err := input(args[0])
		if err != nil {
			return response(nil, err)
		}
		afterBytes, err := input(args[2])
		if err != nil {
			return response(nil, err)
		}
		before, err := nhax.Parse(beforeBytes)
		if err != nil {
			return response(nil, err)
		}
		after, err := nhax.Parse(afterBytes)
		if err != nil {
			return response(nil, err)
		}
		left, err := before.Select(args[1].String())
		if err != nil {
			return response(nil, err)
		}
		right, err := after.Select(args[3].String())
		if err != nil {
			return response(nil, err)
		}
		diff, err := nhax.Compare(left, right)
		return response(diff, err)
	})
	js.Global().Set("nhaxParse", parse)
	js.Global().Set("nhaxCompare", compare)
	select {}
}

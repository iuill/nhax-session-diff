// Package nhax reads the NHAX variant observed in fitting software exports.
// It compares raw XML fields and does not infer UI labels or units.
package nhax

import (
	"bytes"
	"compress/bzip2"
	"compress/zlib"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
)

const Limit = 32 * 1024 * 1024

type Node struct {
	Name     string
	Attrs    map[string]string
	Text     string
	Children []*Node
}

func (n *Node) children(name string) []*Node {
	var out []*Node
	for _, c := range n.Children {
		if c.Name == name {
			out = append(out, c)
		}
	}
	return out
}

func (n *Node) child(name string) *Node {
	for _, c := range n.Children {
		if c.Name == name {
			return c
		}
	}
	return nil
}

func (n *Node) text(name string) string {
	if c := n.child(name); c != nil {
		return strings.TrimSpace(c.Text)
	}
	return ""
}

func expanded(name xml.Name) string {
	if name.Space != "" {
		return "{" + name.Space + "}" + name.Local
	}
	return name.Local
}

func parseXML(data []byte) (*Node, error) {
	if len(data) > Limit {
		return nil, fmt.Errorf("XML exceeds size limit")
	}
	if len(data) >= 2 && (bytes.HasPrefix(data, []byte{0xff, 0xfe}) || data[1] == 0) {
		if bytes.HasPrefix(data, []byte{0xff, 0xfe}) {
			data = data[2:]
		}
		if len(data)%2 != 0 {
			return nil, fmt.Errorf("invalid UTF-16LE XML")
		}
		units := make([]uint16, len(data)/2)
		for i := range units {
			units[i] = binary.LittleEndian.Uint16(data[i*2:])
		}
		data = []byte(string(utf16.Decode(units)))
	}
	data = bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf})
	decoder := xml.NewDecoder(bytes.NewReader(data))
	// The input is already converted to UTF-8 above.
	decoder.CharsetReader = func(label string, input io.Reader) (io.Reader, error) {
		if strings.EqualFold(label, "utf-16") || strings.EqualFold(label, "utf-16le") {
			return input, nil
		}
		return nil, fmt.Errorf("unsupported XML charset %q", label)
	}
	var root *Node
	var stack []*Node
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		switch t := token.(type) {
		case xml.Directive:
			return nil, fmt.Errorf("XML directives are unsupported")
		case xml.StartElement:
			if len(stack) >= 128 {
				return nil, fmt.Errorf("XML nesting exceeds limit")
			}
			n := &Node{Name: expanded(t.Name), Attrs: map[string]string{}}
			for _, a := range t.Attr {
				if a.Name.Space == "xmlns" || a.Name.Local == "xmlns" {
					continue
				}
				n.Attrs[expanded(a.Name)] = a.Value
			}
			if len(stack) == 0 {
				if root != nil {
					return nil, fmt.Errorf("multiple XML roots")
				}
				root = n
			} else {
				parent := stack[len(stack)-1]
				parent.Children = append(parent.Children, n)
			}
			stack = append(stack, n)
		case xml.CharData:
			if len(stack) > 0 {
				stack[len(stack)-1].Text += string(t)
			} else if strings.TrimSpace(string(t)) != "" {
				return nil, fmt.Errorf("text outside XML root")
			}
		case xml.EndElement:
			stack = stack[:len(stack)-1]
		}
	}
	if root == nil || len(stack) != 0 {
		return nil, fmt.Errorf("incomplete XML")
	}
	return root, nil
}

func limitedRead(reader io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, Limit+1))
	if err != nil {
		return nil, err
	}
	if len(data) > Limit {
		return nil, fmt.Errorf("decompressed data exceeds size limit")
	}
	return data, nil
}

type Export struct {
	Patients []Patient `json:"patients"`
}

type Patient struct {
	Index      int               `json:"index"`
	Offset     int               `json:"record_offset"`
	Attributes map[string]string `json:"attributes"`
	Sessions   []Session         `json:"sessions"`
}

type Session struct {
	Attributes map[string]string `json:"attributes"`
	Actions    []Action          `json:"actions"`
}

type Action struct {
	Selector    string            `json:"selector"`
	Attributes  map[string]string `json:"attributes"`
	Root        string            `json:"private_xml_root,omitempty"`
	Side        string            `json:"side,omitempty"`
	FieldCount  int               `json:"xml_field_count,omitempty"`
	DecodeError string            `json:"decode_error,omitempty"`
	Fields      map[string]string `json:"-"`
}

func Parse(data []byte) (*Export, error) {
	if len(data) < 40 || len(data) > Limit {
		return nil, fmt.Errorf("unsupported NHAX size")
	}
	if binary.LittleEndian.Uint32(data) != 40 || binary.LittleEndian.Uint32(data[4:]) != 1 ||
		!bytes.Equal(data[8:16], []byte{0x88, 0x99, 0, 0xdd, 0xcc, 0xbb, 0xaa, 0}) {
		return nil, fmt.Errorf("unsupported NHAX header")
	}
	result := &Export{Patients: []Patient{}}
	for offset := 40; offset < len(data); {
		if len(data)-offset < 8 {
			return nil, fmt.Errorf("truncated record header")
		}
		size := int(binary.LittleEndian.Uint32(data[offset:]))
		kind := binary.LittleEndian.Uint32(data[offset+4:])
		if size < 8 || size > len(data)-offset {
			return nil, fmt.Errorf("invalid record size")
		}
		payload := data[offset+8 : offset+size]
		switch kind {
		case 0x80000005:
			if len(payload) < 4 {
				return nil, fmt.Errorf("truncated patient record")
			}
			expected := int(binary.LittleEndian.Uint32(payload))
			if expected > Limit {
				return nil, fmt.Errorf("patient XML exceeds limit")
			}
			source := bytes.NewReader(payload[4:])
			reader, err := zlib.NewReader(source)
			if err != nil {
				return nil, err
			}
			decoded, err := limitedRead(reader)
			reader.Close()
			if err != nil {
				return nil, err
			}
			if len(decoded) != expected || source.Len() != 0 {
				return nil, fmt.Errorf("invalid patient compression length")
			}
			root, err := parseXML(decoded)
			if err != nil {
				return nil, err
			}
			if root.Name != "Patient" {
				return nil, fmt.Errorf("expected Patient XML")
			}
			patient := Patient{Index: len(result.Patients), Offset: offset, Attributes: root.Attrs, Sessions: []Session{}}
			if sessions := root.child("Sessions"); sessions != nil {
				for si, s := range sessions.children("Session") {
					session := Session{Attributes: s.Attrs, Actions: []Action{}}
					for ai, a := range s.children("Action") {
						item := Action{Selector: fmt.Sprintf("p%d/s%d/a%d", patient.Index, si, ai), Attributes: a.Attrs}
						if a.child("PrivateData") != nil {
							private, err := decodePrivate(a.text("PrivateData"))
							if err != nil {
								item.DecodeError = err.Error()
							} else {
								item.Root, item.Side = private.Name, private.text("Side")
								item.Fields = fields(private)
								item.FieldCount = len(item.Fields)
							}
						}
						session.Actions = append(session.Actions, item)
					}
					patient.Sessions = append(patient.Sessions, session)
				}
			}
			result.Patients = append(result.Patients, patient)
		case 2, 3:
			// Patient index and operator list are not used to select fitting actions.
		default:
			return nil, fmt.Errorf("unsupported record type %#x", kind)
		}
		offset += size
	}
	if len(result.Patients) == 0 {
		return nil, fmt.Errorf("no patient records")
	}
	return result, nil
}

func decodePrivate(encoded string) (*Node, error) {
	data, err := base64.StdEncoding.Strict().DecodeString(strings.Join(strings.Fields(encoded), ""))
	if err != nil {
		return nil, err
	}
	end := bytes.Index(data, []byte("/>"))
	if end < 0 || !bytes.HasPrefix(data, []byte("<compression ")) {
		return nil, fmt.Errorf("unsupported private wrapper")
	}
	wrapper, err := parseXML(data[:end+2])
	if err != nil {
		return nil, err
	}
	size, err := strconv.Atoi(wrapper.Attrs["zip_size"])
	if err != nil || size < 0 || size > len(data)-end-2 {
		return nil, fmt.Errorf("invalid private compression size")
	}
	compressed := data[end+2 : end+2+size]
	if !bytes.Equal(data[end+2+size:], []byte("<compressionend/>")) || !bytes.HasPrefix(compressed, []byte("BZh")) {
		return nil, fmt.Errorf("unsupported private compression")
	}
	decoded, err := limitedRead(bzip2.NewReader(bytes.NewReader(compressed)))
	if err != nil {
		return nil, err
	}
	return parseXML(decoded)
}

func fields(root *Node) map[string]string {
	result := map[string]string{}
	var visit func(*Node, string)
	visit = func(n *Node, path string) {
		for key, value := range n.Attrs {
			result[path+"/@"+key] = value
		}
		if value := strings.TrimSpace(n.Text); value != "" {
			result[path+"/#text"] = value
		}
		labels := make([]string, len(n.Children))
		totals, seen := map[string]int{}, map[string]int{}
		for i, c := range n.Children {
			label := c.Name
			for _, key := range []string{"Path", "Key", "Name"} {
				if identity := c.text(key); identity != "" {
					value, _ := json.Marshal(identity)
					label += "[" + string(value) + "]"
					break
				}
			}
			labels[i] = label
			totals[label]++
		}
		for i, c := range n.Children {
			label := labels[i]
			index := seen[label]
			seen[label]++
			if totals[label] > 1 {
				label += fmt.Sprintf("[%d]", index)
			}
			visit(c, path+"/"+label)
		}
	}
	visit(root, root.Name)
	return result
}

func (e *Export) Select(selector string) (*Action, error) {
	for _, p := range e.Patients {
		for _, s := range p.Sessions {
			for _, a := range s.Actions {
				if a.Selector == selector {
					return &a, nil
				}
			}
		}
	}
	return nil, fmt.Errorf("unknown action selector %q", selector)
}

type Difference struct {
	Path   string  `json:"path"`
	Change string  `json:"change"`
	Before *string `json:"before"`
	After  *string `json:"after"`
}

func Compare(before, after *Action) ([]Difference, error) {
	if before.DecodeError != "" || after.DecodeError != "" {
		return nil, fmt.Errorf("private data could not be decoded: %s %s", before.DecodeError, after.DecodeError)
	}
	if before.Fields == nil || after.Fields == nil {
		return nil, fmt.Errorf("action has no decoded private XML")
	}
	if before.Root != after.Root || before.Side != after.Side {
		return nil, fmt.Errorf("select matching XML types and sides")
	}
	keys := map[string]bool{}
	for k := range before.Fields {
		keys[k] = true
	}
	for k := range after.Fields {
		keys[k] = true
	}
	ordered := make([]string, 0, len(keys))
	for k := range keys {
		ordered = append(ordered, k)
	}
	sort.Strings(ordered)
	out := []Difference{}
	for _, k := range ordered {
		old, oldExists := before.Fields[k]
		next, nextExists := after.Fields[k]
		if oldExists == nextExists && old == next {
			continue
		}
		d := Difference{Path: k, Change: "changed"}
		if oldExists {
			d.Before = &old
		} else {
			d.Change = "added"
		}
		if nextExists {
			d.After = &next
		} else {
			d.Change = "removed"
		}
		out = append(out, d)
	}
	return out, nil
}

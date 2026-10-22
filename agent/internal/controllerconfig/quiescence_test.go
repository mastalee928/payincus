package controllerconfig

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestQuiescenceGroupedIncusData(t *testing.T) {
	op := map[string]any{"id": "11111111-1111-4111-8111-111111111111", "status": "Running", "status_code": 103, "metadata": map[string]any{"command": "ignored"}}
	wrap := func(metadata any) []byte {
		b, _ := json.Marshal(map[string]any{"type": "sync", "status_code": 200, "metadata": metadata})
		return b
	}
	result, err := ParseIncusQuiescence(wrap(map[string]any{"running": []any{op}}))
	if err != nil || len(result.ActiveOperationIDs) != 1 {
		t.Fatalf("running: %v", err)
	}
	for _, pair := range []struct {
		Status string
		Code   int
	}{{"Success", 200}, {"Failure", 400}, {"Cancelled", 401}} {
		b := map[string]any{"id": op["id"], "status": pair.Status, "status_code": pair.Code}
		group := map[string]string{"Success": "success", "Failure": "failure", "Cancelled": "cancelled"}[pair.Status]
		result, err = ParseIncusQuiescence(wrap(map[string]any{group: []any{b}}))
		if err != nil || len(result.ActiveOperationIDs) != 0 {
			t.Fatalf("final: %v", err)
		}
	}
	for _, metadata := range []any{nil, []any{}, map[string]any{"running": nil}, map[string]any{"unknown": []any{}}, map[string]any{"running": []any{op, op}}, map[string]any{"success": []any{op}}, map[string]any{"running": []any{"/1.0/operations/id"}}} {
		if _, err := ParseIncusQuiescence(wrap(metadata)); err == nil {
			t.Fatal("accepted malformed operation state")
		}
	}
	raw := []byte(`{"type":"sync","status_code":200,"metadata":{},"metadata":{}}`)
	if _, err := ParseIncusQuiescence(raw); err == nil {
		t.Fatal("accepted duplicate key")
	}
	raw = []byte(`{"type":"error","status_code":200,"metadata":{}}`)
	if _, err := ParseIncusQuiescence(raw); err == nil {
		t.Fatal("accepted API error")
	}
	if _, err := ParseIncusQuiescence([]byte(strings.Repeat("[", 40) + "0" + strings.Repeat("]", 40))); err == nil {
		t.Fatal("unbounded nesting")
	}
}

package controllerconfig

import "testing"

func TestHostOperationRejectsArbitraryIncusProxyAndDestructiveActions(t *testing.T) {
	for _, raw := range []string{`{"schemaVersion":1,"operation":"shell","command":"whoami"}`, `{"schemaVersion":1,"operation":"instance-power","instance":"a","action":"delete"}`, `{"schemaVersion":1,"operation":"instance-power","instance":"../other","action":"stop"}`, `{"schemaVersion":1,"operation":"instance-power","instance":"a","action":"stop","force":true}`, `{"schemaVersion":1,"operation":"inspect-operations","instance":"a"}`, `{"schemaVersion":1,"schemaVersion":1,"operation":"inspect-operations"}`} {
		if _, _, err := parseHostOperation([]byte(raw)); err == nil {
			t.Fatal("unsafe operation accepted")
		}
	}
	for _, raw := range []string{`{"schemaVersion":1,"operation":"inspect-operations"}`, `{"schemaVersion":1,"operation":"instance-power","instance":"instance-1","action":"restart"}`} {
		if _, _, err := parseHostOperation([]byte(raw)); err != nil {
			t.Fatal(err)
		}
	}
}

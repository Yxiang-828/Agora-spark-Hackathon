package main

import (
	"encoding/json"
	"strings"
	"testing"
)

// Mirrors connector/laws/stress_test.py — server-side enforcement must reach the
// same verdicts so the room is authoritative, not the client.

const validManifest = `{
  "name":"ssh-access","version":"1.0.0",
  "description":{"what":"run remote cmd","when_to_use":"reach a host","not_for":"local"},
  "inputs":[{"name":"host","type":"string","required":true}],
  "outputs":[{"name":"stdout","type":"string"}],
  "errors":[{"code":"NO_TRANSPORT","when":"no ssh"}],
  "workflow":{"preconditions":["x"],"steps":["exec"],"postconditions":["typed"]},
  "os_support":{"linux":{"resolve":"ssh"},"macos":{"resolve":"ssh"},"windows":{"resolve":"plink"}},
  "failure":{"idempotent":false,"blast_radius":"host"},
  "credentials":[{"ref":"ssh/host"}]
}`

func hasClause(v skillVerdict, clause string) bool {
	for _, r := range v.Reasons {
		if r.Clause == clause {
			return true
		}
	}
	return false
}

func mutate(t *testing.T, edit func(map[string]interface{})) json.RawMessage {
	t.Helper()
	var m map[string]interface{}
	if err := json.Unmarshal([]byte(validManifest), &m); err != nil {
		t.Fatal(err)
	}
	edit(m)
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestGate_ValidAdmits(t *testing.T) {
	v := gateSkillManifest(json.RawMessage(validManifest))
	if v.Verdict != "ADMIT" {
		t.Fatalf("expected ADMIT, got %s reasons=%v", v.Verdict, v.Reasons)
	}
	if v.Compat["windows"].Status != "ok" {
		t.Fatalf("expected windows ok, got %v", v.Compat["windows"])
	}
}

func TestGate_Rejections(t *testing.T) {
	cases := []struct {
		name   string
		edit   func(map[string]interface{})
		clause string
	}{
		{"missing-name", func(m map[string]interface{}) { delete(m, "name") }, "NAME"},
		{"missing-version", func(m map[string]interface{}) { delete(m, "version") }, "VERSION"},
		{"empty-when_to_use", func(m map[string]interface{}) {
			m["description"] = map[string]interface{}{"what": "x", "when_to_use": "", "not_for": "y"}
		}, "DESCRIPTION_INCOMPLETE"},
		{"bad-input-type", func(m map[string]interface{}) {
			m["inputs"] = []interface{}{map[string]interface{}{"name": "h", "type": "str", "required": true}}
		}, "INPUT_TYPE"},
		{"required-not-bool", func(m map[string]interface{}) {
			m["inputs"] = []interface{}{map[string]interface{}{"name": "h", "type": "string", "required": "yes"}}
		}, "INPUT_SHAPE"},
		{"errors-empty", func(m map[string]interface{}) { m["errors"] = []interface{}{} }, "NO_ERROR_CONTRACT"},
		{"workflow-no-steps", func(m map[string]interface{}) {
			m["workflow"] = map[string]interface{}{"preconditions": []interface{}{}, "steps": []interface{}{}, "postconditions": []interface{}{}}
		}, "WORKFLOW"},
		{"failure-no-blast", func(m map[string]interface{}) {
			m["failure"] = map[string]interface{}{"idempotent": false}
		}, "FAILURE"},
		{"creds-password", func(m map[string]interface{}) {
			m["credentials"] = []interface{}{map[string]interface{}{"ref": "x", "password": "p"}}
		}, "CREDS_IN_MANIFEST"},
		{"creds-no-ref", func(m map[string]interface{}) {
			m["credentials"] = []interface{}{map[string]interface{}{"foo": "bar"}}
		}, "CREDENTIALS"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			v := gateSkillManifest(mutate(t, c.edit))
			if v.Verdict != "REJECT" {
				t.Fatalf("expected REJECT, got ADMIT")
			}
			if !hasClause(v, c.clause) {
				t.Fatalf("expected clause %s, got %v", c.clause, v.Reasons)
			}
		})
	}
}

func TestGate_GracefulOS(t *testing.T) {
	raw := mutate(t, func(m map[string]interface{}) {
		m["os_support"] = map[string]interface{}{
			"linux": map[string]interface{}{"resolve": "ssh"},
			"macos": map[string]interface{}{"resolve": "ssh"},
			"windows": map[string]interface{}{}, // no resolve, no graceful
		}
	})
	v := gateSkillManifest(raw)
	if v.Verdict != "ADMIT" {
		t.Fatalf("missing-OS must ADMIT gracefully, got REJECT %v", v.Reasons)
	}
	if v.Compat["windows"].Status != "incompatible" {
		t.Fatalf("expected windows incompatible, got %v", v.Compat["windows"])
	}
}

func TestGate_NotObject(t *testing.T) {
	v := gateSkillManifest(json.RawMessage(`["not","an","object"]`))
	if v.Verdict != "REJECT" || !hasClause(v, "SCHEMA") {
		t.Fatalf("expected REJECT/SCHEMA, got %s %v", v.Verdict, v.Reasons)
	}
}

func TestGate_BadJSON(t *testing.T) {
	v := gateSkillManifest(json.RawMessage(`{bad json`))
	if v.Verdict != "REJECT" || !hasClause(v, "PARSE_ERROR") {
		t.Fatalf("expected REJECT/PARSE_ERROR, got %s %v", v.Verdict, v.Reasons)
	}
}

func TestSanitizeManifest_StripsSecrets(t *testing.T) {
	raw := json.RawMessage(`{"name":"x","version":"1","credentials":[{"ref":"a","password":"hunter2"}],"selfcheck":{"cmd":["sh","-c","echo"]},"description":{"what":"y"}}`)
	out := string(sanitizeManifest(raw))
	for _, leak := range []string{"hunter2", "credentials", "selfcheck", "password"} {
		if strings.Contains(out, leak) {
			t.Fatalf("sanitized manifest still contains %q: %s", leak, out)
		}
	}
	if !strings.Contains(out, `"name":"x"`) || !strings.Contains(out, `"what":"y"`) {
		t.Fatalf("sanitize dropped safe fields: %s", out)
	}
}

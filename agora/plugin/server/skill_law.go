package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

// skill_law, enforced SERVER-SIDE (authoritative). Mirrors the static checks of
// connector/laws/skill_law.py. The server NEVER runs a client-supplied selfcheck
// (no executing client code on the server) — the owner's connector runs selfcheck
// on its own host; the room enforces structure/contract/credentials/compat.
// See docs/laws/skill_law.md and docs/QUALITY-BAR.md §1 (never trust the client).

var skillInputTypes = map[string]bool{
	"string": true, "int": true, "float": true, "bool": true, "list": true, "object": true,
}
var skillSecretKeys = map[string]bool{
	"value": true, "secret": true, "password": true, "pass": true,
	"token": true, "key": true, "apikey": true, "api_key": true,
}
var skillOSes = []string{"windows", "macos", "linux"}

type skillReason struct {
	Clause string `json:"clause"`
	OS     string `json:"os,omitempty"`
	Detail string `json:"detail"`
}

type skillCompat struct {
	Status string `json:"status"`
	Detail string `json:"detail"`
}

type skillVerdict struct {
	Skill   string                 `json:"skill"`
	Verdict string                 `json:"verdict"`
	Reasons []skillReason          `json:"reasons"`
	Compat  map[string]skillCompat `json:"compat"`
}

func (v *skillVerdict) fail(clause, onOS, detail string) {
	v.Reasons = append(v.Reasons, skillReason{Clause: clause, OS: onOS, Detail: detail})
}

func nonEmptyStr(v interface{}) bool {
	s, ok := v.(string)
	return ok && strings.TrimSpace(s) != ""
}

func strOf(v interface{}) string { s, _ := v.(string); return s }

// gateSkillManifest validates one raw manifest and returns the authoritative verdict.
func gateSkillManifest(raw json.RawMessage) skillVerdict {
	v := skillVerdict{Skill: "<unnamed>", Verdict: "REJECT", Reasons: []skillReason{}, Compat: map[string]skillCompat{}}

	var any interface{}
	if err := json.Unmarshal(raw, &any); err != nil {
		v.Skill = "<unparseable>"
		v.fail("PARSE_ERROR", "", "invalid JSON: "+err.Error())
		return v
	}
	m, ok := any.(map[string]interface{})
	if !ok {
		v.fail("SCHEMA", "", "manifest is not an object")
		return v
	}

	if nonEmptyStr(m["name"]) {
		v.Skill = m["name"].(string)
	} else {
		v.fail("NAME", "", "missing or empty 'name'")
	}
	if !nonEmptyStr(m["version"]) {
		v.fail("VERSION", "", "missing or empty 'version'")
	}

	// description
	if desc, ok := m["description"].(map[string]interface{}); !ok {
		v.fail("DESCRIPTION", "", "missing 'description' object")
	} else {
		for _, f := range []string{"what", "when_to_use", "not_for"} {
			if !nonEmptyStr(desc[f]) {
				v.fail("DESCRIPTION_INCOMPLETE", "", "description."+f+" missing/empty")
			}
		}
	}

	// inputs (typed)
	if inputs, ok := m["inputs"].([]interface{}); !ok {
		v.fail("INPUTS", "", "missing 'inputs' list")
	} else {
		for i, ri := range inputs {
			inp, ok := ri.(map[string]interface{})
			if !ok {
				v.fail("INPUT_SHAPE", "", fmt.Sprintf("inputs[%d] not an object", i))
				continue
			}
			if !nonEmptyStr(inp["name"]) {
				v.fail("INPUT_SHAPE", "", fmt.Sprintf("inputs[%d] missing name", i))
			}
			if !skillInputTypes[strOf(inp["type"])] {
				v.fail("INPUT_TYPE", "", fmt.Sprintf("inputs[%d] type %q invalid", i, strOf(inp["type"])))
			}
			if r, present := inp["required"]; present {
				if _, isBool := r.(bool); !isBool {
					v.fail("INPUT_SHAPE", "", fmt.Sprintf("inputs[%d].required must be bool", i))
				}
			}
		}
	}

	// outputs (typed)
	if outputs, ok := m["outputs"].([]interface{}); !ok {
		v.fail("OUTPUTS", "", "missing 'outputs' list")
	} else {
		for i, ro := range outputs {
			out, ok := ro.(map[string]interface{})
			if !ok || !nonEmptyStr(out["name"]) || !skillInputTypes[strOf(out["type"])] {
				v.fail("OUTPUT_SHAPE", "", fmt.Sprintf("outputs[%d] needs name + valid type", i))
			}
		}
	}

	// errors (enumerated; no silent failure)
	if errs, ok := m["errors"].([]interface{}); !ok || len(errs) == 0 {
		v.fail("NO_ERROR_CONTRACT", "", "must enumerate >=1 typed error (no silent failure)")
	} else {
		for i, re := range errs {
			e, ok := re.(map[string]interface{})
			if !ok || !nonEmptyStr(e["code"]) || !nonEmptyStr(e["when"]) {
				v.fail("ERROR_SHAPE", "", fmt.Sprintf("errors[%d] needs code + when", i))
			}
		}
	}

	// workflow (end-to-end)
	if wf, ok := m["workflow"].(map[string]interface{}); !ok {
		v.fail("WORKFLOW", "", "missing 'workflow' object")
	} else {
		if steps, ok := wf["steps"].([]interface{}); !ok || len(steps) == 0 {
			v.fail("WORKFLOW", "", "workflow.steps must be a non-empty list")
		}
		for _, f := range []string{"preconditions", "postconditions"} {
			if _, ok := wf[f].([]interface{}); !ok {
				v.fail("WORKFLOW", "", "workflow."+f+" must be a list")
			}
		}
	}

	// failure semantics
	if fl, ok := m["failure"].(map[string]interface{}); !ok {
		v.fail("FAILURE", "", "missing 'failure' object")
	} else {
		if fl["blast_radius"] == nil || strings.TrimSpace(fmt.Sprintf("%v", fl["blast_radius"])) == "" {
			v.fail("FAILURE", "", "failure.blast_radius required (Art. IV)")
		}
		if idem, present := fl["idempotent"]; present {
			if _, isBool := idem.(bool); !isBool {
				v.fail("FAILURE", "", "failure.idempotent must be bool")
			}
		}
	}

	// credentials: ids only, never values (Art. II)
	if credsRaw, present := m["credentials"]; present {
		creds, ok := credsRaw.([]interface{})
		if !ok {
			v.fail("CREDENTIALS", "", "'credentials' must be a list")
		} else {
			for i, rc := range creds {
				c, ok := rc.(map[string]interface{})
				if !ok {
					continue
				}
				for k := range c {
					if skillSecretKeys[strings.ToLower(k)] {
						v.fail("CREDS_IN_MANIFEST", "", fmt.Sprintf("credentials[%d] embeds %q; use a ref", i, k))
					}
				}
				if !nonEmptyStr(c["ref"]) {
					v.fail("CREDENTIALS", "", fmt.Sprintf("credentials[%d] must carry a 'ref'", i))
				}
			}
		}
	}

	// compatibility: per-OS status (never rejects; missing OS = graceful incompat)
	osSupport, _ := m["os_support"].(map[string]interface{})
	for _, o := range skillOSes {
		spec, _ := osSupport[o].(map[string]interface{})
		switch {
		case spec != nil && nonEmptyStr(spec["resolve"]):
			v.Compat[o] = skillCompat{Status: "ok", Detail: strOf(spec["resolve"])}
		case spec != nil && nonEmptyStr(spec["graceful"]):
			v.Compat[o] = skillCompat{Status: "graceful", Detail: strOf(spec["graceful"])}
		default:
			v.Compat[o] = skillCompat{Status: "incompatible",
				Detail: fmt.Sprintf("incompatible on %s - install support or declare a 'resolve' to enable", o)}
		}
	}

	if len(v.Reasons) == 0 {
		v.Verdict = "ADMIT"
	}
	return v
}

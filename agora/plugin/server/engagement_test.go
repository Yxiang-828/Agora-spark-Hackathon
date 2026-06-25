package main

import "testing"

func TestEngagementState(t *testing.T) {
	cases := []struct {
		name       string
		chanVal    string
		muteVal    string
		wantChanOn bool
		wantMuted  bool
	}{
		{"defaults: nothing set", "", "", true, false},
		{"channel off", "off", "", false, false},
		{"user muted", "", "1", true, true},
		{"both", "off", "1", false, true},
		{"unknown channel value = on", "weird", "", true, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			on, muted := engagementState([]byte(c.chanVal), []byte(c.muteVal))
			if on != c.wantChanOn || muted != c.wantMuted {
				t.Fatalf("got on=%v muted=%v, want on=%v muted=%v", on, muted, c.wantChanOn, c.wantMuted)
			}
		})
	}
}

package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestRolesAreApprover(t *testing.T) {
	// Only sysadmins may write durable memory (for now).
	assert.True(t, rolesAreApprover("system_user system_admin"))
	assert.True(t, rolesAreApprover("system_admin"))
	assert.False(t, rolesAreApprover("system_user"))
	assert.False(t, rolesAreApprover(""))
	assert.False(t, rolesAreApprover("system_user system_post_all"))
}

func TestApproveProposal(t *testing.T) {
	pr := proposal{ID: "p1", Issue: "charger pulses", RootCause: "CV top-off", Fix: "no action", Status: "pending"}
	e := approveProposal(pr, "admin-id", 1234)

	assert.Equal(t, "approved", e.Status)
	assert.Equal(t, "admin-id", e.ApprovedBy)
	assert.Equal(t, int64(1234), e.ApprovedAt)
	// carries the proposal content forward
	assert.Equal(t, "p1", e.ID)
	assert.Equal(t, "charger pulses", e.Issue)
	assert.Equal(t, "no action", e.Fix)
}

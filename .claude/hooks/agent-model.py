#!/usr/bin/env python3
"""A PreToolUse hook for the Agent tool: refuses a launch that names no model.

Why: a lead session runs on Fable. On Nov 20 two helpers whose type is set to Opus were sending to Fable and the
account's Fable limit was reached. A launch that names its model cannot inherit the lead's. Exit 2 refuses the
call and shows the words below to the session; a fork is let through, since a fork always runs on its parent.
"""
import json
import sys

call = json.load(sys.stdin)
given = call.get("tool_input", {})
if given.get("subagent_type") == "fork" or given.get("model"):
    sys.exit(0)
print('Name the model in this launch: model "opus" for design, a machine, the room or the save; '
      'model "sonnet" for mechanical work; "fable" only when the owner asks for it '
      "(docs/agent-handoff/START-HERE.md, rule 4a).", file=sys.stderr)
sys.exit(2)

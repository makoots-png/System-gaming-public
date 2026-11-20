#!/usr/bin/env python3
"""A PreToolUse hook for create_session: refuses a new lead session that is not started on Fable 5.2.

Why: the owner, Nov 20: "the lead should ALWAYS start on fable 5.2". A lead started on Nov 20 ran on Opus because
the hand-over rule then said "Opus while the Fable limit holds". Exit 2 refuses the call and shows the words below.
"""
import json
import sys

LEAD = "claude-fable-5-2"
given = json.load(sys.stdin).get("tool_input", {})
if given.get("model") == LEAD:
    sys.exit(0)
print(f'Start the next lead on Fable 5.2: pass model "{LEAD}" to create_session '
      "(the owner, Nov 20; docs/agent-handoff/START-HERE.md, rule 5).", file=sys.stderr)
sys.exit(2)

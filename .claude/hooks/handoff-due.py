#!/usr/bin/env python3
"""Holds a lead session to its hand-off (START-HERE.md, "How a session spends its usage", rule 1).

Why: three times a lead that was due to hand over kept going (Nov 19 twice, Nov 20), and a long lead session is the
dearest thing in a run: every turn sends all of it again. A written rule did not stop it, so this does.

It counts the turns of this session from its transcript: every message that reaches the lead as a user turn
(the owner's words, a helper's report, a hook's reminder, a wake), since each one sends the whole session again.

  SOFT turns and after: each new turn is told the session is due, and what to do.
  HARD turns and after: a launch of a new helper is refused. Work that has reported can still be landed, and the
  hand-off itself (create_session, the trigger tools, git) is never refused.
  After a compaction: the first turn is told to hand over now, whatever the count.

Run by .claude/settings.json on UserPromptSubmit, SessionStart and PreToolUse (Agent). A subagent's own transcript
is short, so a helper is never held by this.
"""
import json
import sys

SOFT = 40
HARD = 80
HOW = ("Hand over as docs/agent-handoff/START-HERE.md says: land what has reported, make handoff.md's Now block and "
       "sections 2 and 4 true, push, start the next lead with its hourly wake (rule 5), delete this session's wake, stop.")


def turns(path: str) -> int:
    """User turns in the transcript that carry words (a tool's result is not a turn)."""
    n = 0
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if row.get("type") != "user" or row.get("isSidechain"):
                    continue
                content = row.get("message", {}).get("content")
                if isinstance(content, str):
                    n += 1
                elif isinstance(content, list) and any(p.get("type") == "text" for p in content if isinstance(p, dict)):
                    n += 1
    except OSError:
        return 0
    return n


def main() -> int:
    call = json.load(sys.stdin)
    event = call.get("hook_event_name", "")
    n = turns(call.get("transcript_path", ""))
    if event == "SessionStart":
        if call.get("source") == "compact":
            print(f"This session was just compacted ({n} turns). The rule is to hand over after a compaction. {HOW}")
        return 0
    if event == "PreToolUse":
        if n >= HARD and call.get("tool_input", {}).get("subagent_type") != "fork":
            print(f"This lead session is at {n} turns, past its limit of {HARD}: a new helper belongs to the next lead. "
                  f"{HOW}", file=sys.stderr)
            return 2
        return 0
    if n >= SOFT:
        left = max(0, HARD - n)
        print(f"Hand-off due: this lead session is at {n} turns (due at {SOFT}; new helpers are refused at {HARD}, "
              f"{left} turns from now). Hand over at the end of the unit you are landing. {HOW}")
    return 0


sys.exit(main())

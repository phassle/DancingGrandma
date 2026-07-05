#!/usr/bin/env python3
"""PreToolUse guardrail: block `az` CLI commands that target a resource group
outside the set allowed for this project.

The allowed set is a regex, kept OUT of this committed file (public repo). It is
read from, in order:
  1. env var  AZ_ALLOWED_RG_PATTERN
  2. file     $CLAUDE_PROJECT_DIR/.claude/az-rg-allow.local  (gitignored; first
              non-empty, non-comment line is the regex)
If neither is set, the guard fails CLOSED: any command that names a resource
group is blocked until you configure the pattern.

It scans each command segment for resource-group references via:
  - `-g` / `--resource-group` flags
  - `/resourceGroups/<name>` inside resource IDs (e.g. `--ids`)
  - `-n` / `--name` on `az group` subcommands
Read-only or subscription-scoped commands that name no RG (e.g. `az account
show`, `az group list`, `az login`) always pass through.
"""
import os
import re
import sys
import json

# --resource-group / -g  VALUE   (space- or =-separated, optionally quoted)
RG_FLAG = re.compile(
    r"""(?:--resource-group|-g)(?:\s+|=)("([^"]*)"|'([^']*)'|([^\s]+))"""
)
# /resourceGroups/<name>  inside a resource ID
RG_ID = re.compile(r"/resourceGroups/([^/\s\"'\\]+)", re.IGNORECASE)
# -n / --name VALUE  (only meaningful on `az group` segments)
NAME_FLAG = re.compile(
    r"""(?:--name|-n)(?:\s+|=)("([^"]*)"|'([^']*)'|([^\s]+))"""
)
SEGMENTS = re.compile(r"&&|\|\||;|\|")


def flag_value(match):
    return match.group(2) or match.group(3) or match.group(4)


def load_pattern():
    """Return (regex_or_None, error_message_or_None)."""
    raw = os.environ.get("AZ_ALLOWED_RG_PATTERN")
    if not raw:
        root = os.environ.get("CLAUDE_PROJECT_DIR") or "."
        path = os.path.join(root, ".claude", "az-rg-allow.local")
        try:
            with open(path, encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        raw = line
                        break
        except OSError:
            pass
    if not raw:
        return None, None
    try:
        return re.compile(raw, re.IGNORECASE), None
    except re.error as exc:
        return None, f"invalid AZ_ALLOWED_RG_PATTERN regex: {exc}"


def deny(reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # unparseable payload: fail open, don't block unrelated work

    command = (payload.get("tool_input") or {}).get("command", "")
    if not command or not re.search(r"(^|[\s;&|(])az\b", command):
        sys.exit(0)

    candidates = []
    for segment in SEGMENTS.split(command):
        if not re.search(r"\baz\b", segment):
            continue
        candidates += [flag_value(m) for m in RG_FLAG.finditer(segment)]
        candidates += RG_ID.findall(segment)
        if re.search(r"\baz\s+group\b", segment):
            candidates += [flag_value(m) for m in NAME_FLAG.finditer(segment)]

    candidates = sorted({c for c in candidates if c})
    if not candidates:
        sys.exit(0)  # no resource group named — always allowed

    allowed, err = load_pattern()
    if err:
        deny(f"Project guardrail misconfigured: {err}. Fix "
             ".claude/az-rg-allow.local or AZ_ALLOWED_RG_PATTERN.")
    if allowed is None:
        deny("Project guardrail is not configured, so az commands that target a "
             "resource group are blocked. Set AZ_ALLOWED_RG_PATTERN or create "
             ".claude/az-rg-allow.local (see .example) with the allowed-RG regex.")

    bad = [c for c in candidates if not allowed.match(c)]
    if bad:
        deny("Project guardrail: this project may only operate on the allowed "
             "resource-group set. This command references: " + ", ".join(bad)
             + ". Re-scope it, or ask the user to update .claude/az-rg-allow.local.")


if __name__ == "__main__":
    main()

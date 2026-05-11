Pauses loop mode for a specified duration, then the harness re-invokes the agent.

<instruction>
- Use when there is transiently no work but new work is expected to appear later (e.g., waiting for a human PR merge, waiting for a timer-based trigger).
- `duration` is a human-readable string like "5min", "30s", "2h", or "1h30m".
- Optionally provide a `reason` so future invocations understand why the agent slept.
- Do not use this when all work is definitively complete — use `exit_loop_mode` instead.
</instruction>

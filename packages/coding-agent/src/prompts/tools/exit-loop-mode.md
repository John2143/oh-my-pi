Signals the harness to permanently exit loop mode because all work is definitively complete.

<instruction>
- Use only when all possible work is done and no new work is expected.
- Provide a brief `summary` of what was accomplished.
- Do not use this if external events could create new work — use `sleep` instead.
- This stops the harness from invoking the agent again.
</instruction>

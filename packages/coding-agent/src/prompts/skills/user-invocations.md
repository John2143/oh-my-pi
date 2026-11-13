[IMPORTANT: User invoked {{count}} skills in this request; follow all of their instructions. Full skills below.]

{{#each skills}}
## /skill:{{name}}

{{body}}

---

[Skill directory: {{baseDir}}]
{{/each}}

Resolve relative paths in each skill against that skill's own absolute directory; read referenced assets and templates; run scripts with the terminal tool when skill instructions call for it.
{{#if userArgs}}
User: {{userArgs}}
{{/if}}

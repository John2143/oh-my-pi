<system-notice id="hint-tokens">
User hint tokens in this turn:
{{#each agents}}
- `{{name}}`{{#if readOnly}} (read-only, no edits){{/if}}{{#if blocking}} (BLOCKING; inline result){{/if}}{{#if structured}} (STRUCTURED; schema result){{/if}}: {{description}} — call `task` with `agent: "{{callAgent}}"`{{#if pinnedModel}} (runs `{{name}}` on `{{pinnedModel}}`{{#if effort}}, effort pinned to `{{effort}}`{{/if}}; omit `model`{{#if effort}} and `effort`{{/if}}){{/if}}.
{{/each}}
{{#each models}}
- Model `{{name}}` (`{{selector}}`): call `task` with `agent: "{{agent}}"`{{#if baseAgent}} (runs `{{baseAgent}}` on `{{selector}}`){{else}} (general-purpose `task` agent pinned to `{{selector}}`){{/if}}{{#if effort}}; effort is pinned to `{{effort}}`, omit `effort`{{/if}}.
{{/each}}
</system-notice>

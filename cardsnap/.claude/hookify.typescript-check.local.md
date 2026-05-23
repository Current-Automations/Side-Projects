---
name: typescript-check
enabled: true
event: stop
pattern: .*
action: warn
---

Before stopping: have you run `tsc --noEmit` to verify there are no TypeScript errors?

If you haven't, run it now and fix any errors before considering the task complete.

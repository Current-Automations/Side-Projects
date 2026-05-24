# 02 · Dev test page source still ships in the production bundle

Status: ready-for-agent

## Problem

`app/test-scan/page.tsx` guards against production use with a runtime redirect:

```ts
if (process.env.NODE_ENV === 'production') redirect('/');
```

This is safe (the redirect fires and no scan UI is usable), but it is not a
build-time exclusion:

- `/test-scan` is still a registered route in the production build manifest —
  it is discoverable, it just redirects.
- `TestScanClient` source still ships to production clients.

The page is dev-only and ideally should not exist at all in a production build.

## Fix (pick one)

- Move the page under a dev-only route group and exclude it from production
  builds, or gate the route registration on an env check; **or**
- Accept the runtime redirect but keep the in-file comment honest (it must not
  claim the page "never ships").

The in-file comment in `page.tsx` references this issue.

## Acceptance criteria

- [ ] Either `/test-scan` is absent from the production build, or the code
      comment accurately states that the source ships and only redirects
- [ ] No regression to the dev experience (page still works under `next dev`)

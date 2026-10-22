# Fonts

Self-hosted web fonts, so the build never depends on a font CDN being
reachable.

## InterVariable.woff2

The `latin` subset of **Inter** (variable, weight 100–900), the build
Google Fonts publishes for `Inter:wght@100..900`.

- Family name in the font's name table: `Inter Variable` — overridden
  explicitly in `src/app/layout.tsx` via `next/font/local`'s
  `declarations`, because `next/font` otherwise hashes the family to
  an internal `__Inter_xxxx` name.
- Coverage: the `latin` unicode-range declared in the same
  `declarations` block. Characters outside it (Korean, Cyrillic) fall
  through to the next family in the stack.
- 48 KB, against the ~40 KB `next/font/google` served for
  `subsets: ["latin"]`.

This is the same file `next/font/google` was already serving, so
switching to a local copy changes the build, not the rendering.

To update it, re-download the `latin` block from the Google Fonts CSS
API and replace the file:

```sh
curl -s -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  "https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap"
```

## OFL.txt

Inter is licensed under the SIL Open Font License 1.1 — the licence
travels with the font, so it is kept next to it.

Upstream: <https://github.com/rsms/inter>

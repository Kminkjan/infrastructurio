# Fonts

Self-hosted place-name font (art direction "Typography and labels", ADR 0013 §9). No font
is loaded from a CDN at runtime.

| File | Font | Subset (unicode-range) | SHA-256 |
|---|---|---|---|
| `eb-garamond-latin-500-normal.woff2` | EB Garamond Medium (500), normal | latin: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD | `d2bb3f624516d0233ef8a03bd7b2be47489c36809a02e83ac1bc859e85f4874a` |
| `eb-garamond-latin-ext-500-normal.woff2` | EB Garamond Medium (500), normal | latin-ext: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF | `539096f6832b876728fe18c9312f4aae17adec0dbd1f37804d37ffa760c4ac9a` |

- **Coverage.** Together the two subsets cover Basic Latin, Latin-1 and Latin Extended-A, so
  Latvian, Lithuanian and period German spellings render (ā č ē ģ ī ķ ļ ņ š ū ž ą ę ė į ų ä ö ü ß).
- **Source.** The Fontsource package `@fontsource/eb-garamond` 5.2.7, files downloaded on
  2026-09-26 from `https://cdn.jsdelivr.net/npm/@fontsource/eb-garamond@5.2.7/files/`.
  Upstream: <https://github.com/octaviopardo/EBGaramond12>.
- **Licence.** SIL Open Font License 1.1, copyright 2017 The EB Garamond Project Authors;
  full text in [`OFL.txt`](OFL.txt) (from `google/fonts`, `ofl/ebgaramond/OFL.txt`; one
  trailing space stripped for the repo's whitespace check, wording unchanged). The font files
  are unmodified, so the Reserved Font Name clause does not apply.
- **Wiring.** `@font-face` rules in [`index.html`](../../index.html) name the family
  `EB Garamond` with these unicode ranges; the label layer uses it for place names only.

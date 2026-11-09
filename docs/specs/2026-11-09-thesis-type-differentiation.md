# Thesis type differentiation (diplomas vs masters)

Status: approved
Date: 2026-11-09
Scope: `services-scraper`

## Problem

`DiplomasStrategy` and `MastersStrategy` render an identical Components V2 layout,
so a posted entry cannot be told apart from the other document type inside Discord.
Only the webhook `username` differs, which is easy to miss — especially once a
message is forwarded or screenshotted.

## Design

### Config

Add an optional, validated `accentColor` to each scraper entry
(`ScraperConfigSchema`):

```json
"diplomas": { "accentColor": "#2a93d1", ... },
"masters":  { "accentColor": "#313183", ... }
```

The schema accepts only `#rrggbb` (case-insensitive) and transforms it to the
integer expected by `ContainerBuilder.setAccentColor`.

### Plumbing

- `StrategyContext` gains `accentColor?: number`.
- `Scraper` passes `this.scraperConfig.accentColor` when building the context.
- `HtmlStrategy` forwards it to `getPostData($element, accentColor?)`; the new
  parameter is optional, so existing strategies are unaffected.

### Rendering

When `accentColor` is defined, the container is created with
`setAccentColor(accentColor)`. The first TextDisplay becomes:

```
-# Дипломски труд
**<index> - <student>**
```

(`-# Магистерски труд` for masters). The label is document knowledge and stays
in the strategy, not in config.

The entry keeps 10 components, so delivery batching remains 4 posts per message
(40-component cap).

## Acceptance criteria

- [x] Config accepts `#rrggbb` and rejects malformed values.
- [x] Diplomas posts carry `accent_color` `0x2a93d1`; masters posts `0x313183`
      when configured.
- [x] First line shows the type label while keeping `<index> - <student>` bold
      and in the original order.
- [x] No change to component count, batching, username, or role mention.
- [x] `npm run check`, `npm run lint`, `npm test`, `npm run build` pass.

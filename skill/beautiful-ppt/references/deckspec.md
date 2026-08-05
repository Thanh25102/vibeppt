# DeckSpec v1

`deck.json` is the editable source of truth. Paths are relative to that file.

```json
{
  "version": 1,
  "meta": {
    "title": "Product narrative",
    "language": "vi-VN",
    "audience": "Commercial and technical leaders",
    "purpose": "Agree on a pilot",
    "durationMinutes": 30,
    "author": "Name",
    "company": "Company"
  },
  "brandProfile": "./brands/default/brand.json",
  "templateProfile": "./template/template.json",
  "theme": "dark",
  "outputMode": "hybrid",
  "sections": [
    {
      "id": "opening",
      "title": "Opening",
      "slides": [
        {
          "id": "opening",
          "kind": "hero",
          "eyebrow": "Operational clarity",
          "title": "See the signal.\nAct with context.",
          "body": "One concise support line.",
          "tags": ["Observe", "Verify", "Act"],
          "notes": "How to present this slide.",
          "sourceRefs": ["sources/brief.docx, section 2"]
        }
      ]
    }
  ]
}
```

## Slide kinds

- `hero`, `section`, `statement`, `closing`: opening, chapter breaks, strong points, and close.
- `feature`, `screenshot`: product evidence with an optional `visual`.
- `card-grid`, `comparison`, `matrix`, `metrics`: structured items.
- `process`, `timeline`, `architecture`: `items` for a simple sequence or `diagram` for explicit nodes and edges.
- `chart`: editable `chart` data.
- `table`: editable `table` data.
- `use-case`, `case-study`: concrete event or customer flow.

Every slide requires `id`, `kind`, and `title`. Common optional fields are `eyebrow`, `subtitle`, `body`, `tags`, `items`, `visual`, `notes`, and `sourceRefs`.

When the selected template declares `layouts`, a slide may set `layout` to one of those ids. Its `kind` must match the layout declaration:

```json
{ "id": "opening", "kind": "hero", "layout": "cover", "title": "One clear decision" }
```

## Visuals

```json
"visual": {
  "src": "./assets/product-desktop.png",
  "alt": "Desktop operations workspace",
  "fit": "contain",
  "position": "center",
  "caption": "Optional caption"
}
```

Use local files only. Remote URLs fail lint so the final deck stays reproducible.

## Template profile

`templateProfile` is optional for legacy decks. Studio-created projects point it to a copied template pack containing `template.json`, `template.css`, `recipe.md`, previews, and the original sample deck. The renderer applies the pack CSS after its safe base layout; the source bundle copies the pack so later builds remain reproducible. Keep template references local and do not add scripts or remote CSS imports.

## Charts

```json
"chart": {
  "type": "line",
  "categories": ["W1", "W2", "W3"],
  "series": [
    {"name": "Open", "values": [42, 31, 20]},
    {"name": "Resolved", "values": [16, 25, 34]}
  ],
  "valueSuffix": "%"
}
```

Supported types are `bar`, `column`, `line`, and `donut`.

## Tables

```json
"table": {
  "headers": ["Phase", "Evidence", "Decision"],
  "rows": [["Connect", "Coverage", "Proceed"], ["Operate", "Time", "Tune"]]
}
```

Keep rows the same width as the headers. Split tables wider than eight columns.

## Diagrams

```json
"diagram": {
  "layout": "horizontal",
  "nodes": [
    {"id": "source", "label": "Sources", "detail": "Systems and people", "tone": "blue"},
    {"id": "decision", "label": "Decision", "detail": "Context and action", "tone": "accent"}
  ],
  "edges": [{"from": "source", "to": "decision"}]
}
```

Layouts are `horizontal`, `vertical`, and `grid`. Tones are `accent`, `blue`, `green`, `amber`, and `neutral`.

## Brand profile

A brand folder contains `brand.json` and optional local logo assets. Both light and dark themes are required. Start from a bundled preset, change the colors and fonts, then add it with:

```powershell
vibeppt brand add customer --from .\customer-brand --project .
```

Use installed Windows font family names. The `imagePromptPrefix` is guidance for the agent's image-generation tool; the CLI never stores or requests an API key.

Use `logos.light` for a mark intended for a light slide and `logos.dark` for a mark intended for a dark slide. Legacy `logo` remains a fallback:

```json
"logos": { "light": "logo-color.svg", "dark": "logo-white.svg" }
```

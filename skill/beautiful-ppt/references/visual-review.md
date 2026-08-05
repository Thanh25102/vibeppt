# Reviewing your own deck

A deck that lints clean can still be wrong. Two real renderer defects — every native text 1.5x
too large, and accent runs painted into the background bitmap and then drawn again on top —
both passed `vibeppt lint` and reported `PASS` in `qa.json`. They were found by looking at the
picture. Treat this file as a required stage, not advice.

## 1. Read the contact sheet

After every build, open `output/<theme>/contact-sheet.png` and check each slide:

- A title that wrapped into an orphan line, or overflowed into the body.
- A visual that letterboxed, leaving callouts floating on empty background.
- Callouts covering the thing they annotate, or colliding with each other.
- Cards with wildly uneven text lengths in the same row.
- Two consecutive slides with the same shape — vary the composition.
- Decorative pseudo-elements left behind by a frame the template CSS disabled
  (`.vp-visual::before` is the window-dot marker; drop it whenever you drop the frame).
- Placeholder numbers that survived into a slide claiming evidence.

Fix in `deck.json` or the template CSS, rebuild, look again. Two or three rounds is normal.

## 2. Run the PowerPoint gate

Windows with desktop PowerPoint is the acceptance gate, not the browser:

```powershell
vibeppt qa .\output\dark\<deck>.pptx --powerpoint
```

This reads back the geometry PowerPoint actually laid out and fails the build on:

| Finding | Meaning |
|---|---|
| *text overflows its box* | PowerPoint wrapped the text further than Chromium did, so it spills out of its shape. Shorten the copy or give the layout room. |
| *extends past the slide edge* | An object is off-slide. |
| *text is wider than its box* (warning) | Usually harmless wrapping; check it if the slide looks tight. |
| *boxes overlap* (warning) | Two text boxes collide. Almost always too much copy for the layout. |

Any string that exactly fills its line in the browser is at risk, because PowerPoint's metrics
differ slightly. Leave headroom rather than tuning text to the pixel.

Then read `output/<theme>/powerpoint-render/slide-*.png`. That is what PowerPoint draws, and it
is the only place font substitution and paint bugs become visible.

## 3. Regression

`npm run test:visual` builds the golden decks and requires zero errors. Run it after any change
to `src/pptx.ts`, `src/html.ts` or a template stylesheet.

## What is not automated

Whole-slide and tiled pixel comparison between the HTML render and the PowerPoint render were
both tried and **rejected on measurement**: Chromium and PowerPoint rasterise glyphs differently,
so baseline noise on a perfect deck reached 5.7% of pixels while a real defect scored 4.6%. The
signal sits below the noise, and the tiled variant inverted the ranking. Do not reintroduce a
pixel-diff gate without first proving on a known-bad build that it separates.

Nothing automated judges taste. Composition, rhythm and whether the story lands are still yours.

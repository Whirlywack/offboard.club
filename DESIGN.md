---
name: Offboard
description: Free Sunday chess for people in tech in Vilnius, told in studio photographs of chess pieces.
colors:
  ground: "#d0cfcb"
  ink: "#141310"
  muted: "#4a4742"
  line: "rgb(20 19 16 / 0.2)"
  line-strong: "#6e6a62"
  error: "#8f1d17"
  button-hover: "#2c2a26"
  black: "#0d0b07"
  paper: "#edeae4"
  paper-muted: "#a39e95"
  paper-line: "rgb(237 234 228 / 0.28)"
  paper-hover: "#d6d2ca"
typography:
  display:
    fontFamily: "Bodoni Moda, Bodoni 72, Didot, serif"
    fontWeight: 500
    lineHeight: 0.86
    letterSpacing: "-0.025em"
  wordmark:
    fontFamily: "Bodoni Moda, Bodoni 72, Didot, serif"
    fontSize: "27px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.01em"
  link-row:
    fontFamily: "Bodoni Moda, Bodoni 72, Didot, serif"
    fontSize: "25px"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.5
  small:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.16em"
rounded:
  none: "0"
spacing:
  gutter: "16px"
  gutter-desktop: "clamp(40px, 3.9vw, 64px)"
  strip: "44px"
  head: "60px"
  head-desktop: "76px"
  tap: "44px"
components:
  button:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    padding: "0 28px"
    height: "54px"
  button-hover:
    backgroundColor: "{colors.button-hover}"
  button-on-black:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.black}"
    rounded: "{rounded.none}"
  button-in-header:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    padding: "0 20px"
    height: "44px"
  strip:
    backgroundColor: "{colors.black}"
    textColor: "{colors.paper}"
    padding: "0 {spacing.gutter}"
    height: "{spacing.strip}"
  footer:
    backgroundColor: "{colors.black}"
    textColor: "{colors.paper-muted}"
---

# Design System: Offboard

## Overview

**Creative North Star: "The pieces tell the story"**

Offboard looks like a set of studio photographs of chess pieces, printed on a warm grey with film grain. Each section of a page is a plate, grey or black, and each plate has one photograph chosen for what that section says. On the home page a queen stands for the Club, a lone pawn with a long shadow for "busy gets lonely", sixteen pawns for the sixteen Members Season 1 waits for, a white king on black for the chess, two knights facing each other for meeting people, and a queen over a fallen king for the Leaderboards. A page built in this look starts by asking which picture says what its section says.

Over the photographs sits a very large, high-contrast display serif, and under it a plain grotesque for everything read or used. There is no colour besides the grey, the near-black and two lights; no rounded corners, no shadows, no cards. Depth comes from the photographs' own shadows and from the grain.

The home page (`app/page.tsx`, `app/home.module.css`) is the reference: it is the approved mock-up of 26 November 2026 carried into the site, and anything this file leaves open is answered by how it does it.

**Key characteristics:**
- Grey plates and black plates, alternating down the page.
- Film grain over the grey, so the page and its photographs share one film.
- One photograph per plate, for what the plate says, never larger than its pixels.
- A display serif that fills its plate, its first word in italic.
- Square corners everywhere; 1px rules; ink blocks for buttons.
- The phone composed on its own terms, not a shrunken desktop.

## Colors

Monochrome: a warm grey and a warm near-black, each sampled from a photograph's backdrop, with an ink for the grey and a paper for the black.

### Neutral
- **Ground** (`--ground`): the grey every page stands on, sampled from the queen photograph's backdrop, so a photograph and the page meet without an edge.
- **Ink** (`--ink`): text, rules at full strength, buttons and the focus ring on the grey (11.9:1).
- **Muted** (`--muted`): secondary text on the grey, such as the note beside a button (5.9:1).
- **Line** (`--line`): rules and dividers on the grey. **Line strong** (`--line-strong`): the border of a form field (3.4:1).
- **Black** (`--black`): the black plates, the strip and the footer, sampled from the white king photograph's backdrop.
- **Paper** (`--paper`): text on the black (16.4:1). **Paper muted** (`--paper-muted`): secondary text on the black (7.4:1). **Paper line** (`--paper-line`): rules on the black.
- **Error** (`--error`): a deep red for what went wrong, on the grey only (5.7:1).

### Named Rules
**The Turned-Over Rule.** A black plate takes `ui.black`, which sets the black background and turns the tokens over: inside it `--ink` is paper, `--muted` paper muted, `--line` paper line, `--ground` black, and buttons become paper blocks with black text. Write components against `--ink`, `--muted` and `--line` and they read on either plate with nothing of their own. A token derived from another at `:root` (as `--button` is) does not follow by itself; `ui.black` lists each one it turns.

**The No-Accent Rule.** There is no accent colour. Emphasis is size, italic, weight, or a black plate.

**The Greyscale Rule.** A person's photograph (a Member's LinkedIn photo) is shown in greyscale, `filter: grayscale(1)`, so that nothing on a page is in colour.

## Typography

**Display Font:** Bodoni Moda (with Bodoni 72, Didot, serif), always drawn at optical size 26 (`--font-display-opsz`). Left to follow the type's size, its hairlines grow so fine at headline sizes that they drop out on a phone and on a monitor alike; at 26 they hold, and the letters are under 1% wider. `globals.css` sets it on every element, with `!important`, because the `font` shorthand resets `font-variation-settings`.
**Body Font:** Hanken Grotesk (with system-ui, sans-serif).

Both are self-hosted by `next/font` in `app/layout.tsx` (`--font-bodoni`, `--font-hanken`; the tokens to use are `--font-display` and `--font-text`). Only the Latin files are preloaded; Latin Extended, for ą, č, ė, š and ž in Members' names, is fetched when a page has one.

**Character:** a fashion-magazine Didone, very large and very thin in its hairlines, over a quiet, even grotesque. The serif speaks; the grotesque informs.

### Hierarchy
- **Display** (500, line-height 0.82 to 1, `ui.display`): a plate's heading, sized to fill the plate. On the home page: the headline at `clamp(50px, 16vw, 76px)` on a phone and `min(9.4vw, 160px)` on a desktop; "The chess" at `clamp(96px, 30vw, 128px)` and `min(17.2vw, 260px)`; "Meeting people" at `clamp(64px, 22vw, 96px)` and `min(9.6vw, 150px)`; "Leaderboards and Recaps" at `clamp(52px, 15.4vw, 72px)` and `min(7.6vw, 132px)`. A heading is sized in `vw` with a `px` floor and ceiling, never by the window's height.
- **Display line** (500, 1.06): a sentence set in the serif, such as "Working in tech keeps you busy, and busy gets lonely.": 30px on a phone, `min(5.6vw, 88px)` on a desktop. The Season count is the same voice at `clamp(30px, 8.9vw, 40px)` and `min(5.8vw, 100px)`.
- **Link row** (400, 25px; `min(2.7vw, 40px)` on a desktop): the serif in a ruled list of places to go.
- **Body** (400, 17px, 1.5): everything read. A plate's lead paragraph is 18px on a desktop. Keep a paragraph to about 30 to 34em.
- **Small** (400, 15px, 1.45; 14px in the strip and the footer; 13.5px for the note beside a button).
- **Label** (600, 11px, 0.16em, capitals, `ui.caps`): a short name above a figure ("Season 1") or a credit ("Free chess Club · Vilnius").

### Named Rules
**The First-Word Rule.** A display heading opens with its first word in italic: *Sunday* chess for people in tech, *The* chess, *Meeting* people, *Leaderboards* and Recaps.

**The Hairline Rule.** The display serif is only ever large. Below about 25px it loses its hairlines; use the grotesque.

## Layout

One breakpoint, at **900px**: below it the phone's layout, at and above it the desktop's. CSS custom properties cannot be read in a media query, so each module writes `@media (min-width: 900px)`.

Plates run the full width of the window. Content sits at the gutter, `--gutter`: 16px on a phone and `clamp(40px, 3.9vw, 64px)` on a desktop, which the strip, the header, the footer and every plate share, so their left edges line up. The header is `--head` tall (60px, 76px on a desktop), the strip `--strip` (44px).

The phone is composed on its own terms: words and photograph stacked or overlapping in a narrow column, photographs at their own size and clipped by their plate rather than scaled down to fit. The desktop composes words and photograph across the width: the headline left of the queen, the two words of "Meeting people" either side of the knights. Nothing scrolls sideways: a photograph wider than the screen is clipped by its plate (`overflow: hidden` or `overflow-x: clip`).

Everything that sizes a photograph is in `px` or `vw`, so that the image component's `sizes` can say how wide it is. The home page's first screen is sized by the page's width: at 390 wide it is the mock-up's 390 x 844 phone, at 1440 its 1440 x 900 desktop.

Generous space between plates (56 to 150px of padding on a desktop); tight space inside a group (10 to 16px between a label, its figure and its note).

## Elevation & Depth

Flat. There are no box shadows and no raised surfaces. Depth comes from two things: the photographs' own shadows, which fall on the page's grey because the cut-outs are multiplied onto it, and the film grain (`ui.grain`), a 240px tile overlaid at 55% over the grey.

### Named Rules
**The Same-Film Rule.** A grey plate that holds a photograph carries the grain, so the flat page and the grainy photograph look printed on one stock.

## Shapes

Square. Every corner is 0: buttons, fields, photographs, panels. Rules are 1px. The one mark is a 7px solid square, the strip's, which says "this is happening now".

## Components

The pieces several pages share, and where they live:

- `app/globals.css`: every token, and the base look of headings, links, buttons, fields, the focus ring, selection and the skip link.
- `app/ui.module.css`: `black`, `grain`, `display`, `caps`, `ruled`, `button`, `quiet`, `actions`, `alert`, `muted` and `small`, and the old look's `page`, `intro`, `eyebrow` and `lede` (Kept from the old look, below).
- `app/site.tsx` with `app/site.module.css`: `Masthead` (the header) and `Strip`. The footer is in `app/layout.tsx`.
- `app/ruled-links.tsx`: `RuledLinks`.
- `app/photos/`: every photograph and cut-out the site shows; `design/photographs/`: the Organiser's originals they are made from.

### Header
- **Style:** the wordmark "Offboard" in the display serif (27px, 32px on a desktop) on the left; Season, All-time and Recaps on the right in the grotesque (15px, 500), each a 44px target, underlined under the pointer.
- **Every page** gets it from the root layout. The home page draws its own (`Masthead` with a `strip` and a sign-in button after the links), and the layout leaves its own out there (`app/not-on-home.tsx`).
- The second sign-in button shows on a desktop only, and only on the home page: the note about what signing in stores must be on the same page.

### Strip
- **Style:** a black line across the top, 44px, at the gutter: the square mark, a label in capitals, a line of text in 14px, an arrow. The whole strip is one link.
- **Use:** it repeats, in its own words, what a part further down the page says, and leads there (`Strip href="#season"` on the home page). A page with nothing to repeat has no strip.
- **Two lines:** a text too long to share a phone's line with its label takes `stacked`: under 480px wide the label and the mark go on the first line, the text under the label, the arrow beside both.

### Footer
- **Style:** black, 14px; the two sentences in paper muted, the two links in paper, underlined, each a 44px target. Three columns on a desktop, stacked on a phone.

### Buttons
- **Shape:** square (0).
- **Primary:** an ink block with paper text, 600 16px, 54px tall, 28px either side (`<button>` as it is; a link that does a button's job takes `ui.button`, which is the same size and type, so a link and a button side by side match). Full width on a phone where it is the plate's one action.
- **Quiet:** the choice beside it, `ui.quiet` on a `<button>` or a link: the same size, no fill, a 1px outline in `--line-strong`; under the pointer a faint wash of ink and the outline in ink.
- **Hover / Focus / Active:** a lighter ink (`--button-hover`) under the pointer; the focus ring is 2px of ink, 3px out; pressed, it drops 1px (not with reduced motion). The `<button>` rule's hover is no more specific than `button` itself, so a button with a class of its own (`ui.quiet`, a text button) keeps its own background under the pointer.
- **On black:** a paper block with black text, by the Turned-Over Rule; a quiet one keeps paper text on black.
- **In the header:** 44px tall, 20px either side, 14px.

### Alert
- **Style:** `ui.alert`, what went wrong, on the ground itself: 600 15px in `--error`, after a 7px square of the same red on the middle of its first line, as the strip's square marks what is happening now. No panel, no tint, no stripe. 5.7:1 on the grey; on the grey only, as the red does not read on black.
- **Use:** beside the field or the button it is about, or in place of a part of a page that cannot be shown (the database down). With `role="alert"` where it arrives after the page.

### Ruled link list
- **Style:** places to go, one to a row between 1px rules (`--line`), each in the display serif at 25px (`min(2.7vw, 40px)` on a desktop), at least 68px tall (92px), with a 22px arrow at the end that leans 5px forward under the pointer. `RuledLinks` takes `[href, label]` pairs and a `className` to place it.

### Label
- **Style:** `ui.caps`, 600 11px, 0.16em, capitals, in the colour of its text. Short: a name or a credit, never a sentence.

### Photographs
How a photograph meets the page is most of this look.

- **Choosing one.** One per plate, for what the plate says. The six photographs are the queen, the white king on black, a lone pawn, two knights facing each other, a queen over a fallen king, and a row of six pieces tallest to shortest. What the home page and the two pages with nothing to show use them for:
  - the queen: the Club, at the top of the home page;
  - the lone pawn and its long shadow: "busy gets lonely";
  - sixteen pawns, standing or in outline: the Members Season 1 has and waits for;
  - the row of six pieces: a Season's six Matchdays, once Season 1 has begun, whether the next is coming up or under way (the label says which);
  - the white king on black: the chess;
  - the two knights: meeting people;
  - the queen over the fallen king: Leaderboards and their champion, and a page that failed;
  - the outline of a pawn alone (`pawn-outline.webp`, traced again from the pawn's cut-out at twice the grid's outline, with an even stroke): a place nobody holds, the page that is not there.
- **In the code.** Always the framework's image component with a static import, which gives it its width and height and a hashed address: `import king from "./photos/king.webp"`, then `<Image src={king} alt="" sizes="(min-width: 900px) 72vw, 512px" className={styles.king} />`. `sizes` says how wide it is shown at each width, in `px` or `vw`, and is left out only for a file smaller than any screen asks for (the pawns). Only the first screen's photograph takes `preload`. The browser is sent WebP at the width it needs, at quality 75; a photograph on a black backdrop takes `quality={90}`, as at 75 its grain breaks into blocks (`next.config.ts` allows those two).
- **Never larger than it can hold.** A photograph's CSS width never passes its file's width: the 730px pawn is shown at 292px on a phone and at most 730px on a desktop; the 1800px queen at most about 1480px. On a phone, keep it within half its pixels where the composition allows, so it stays sharp on a 2x screen. Give a photograph `max-width: none` when it is positioned wider than its box, as the base `img` rule caps it at its box.
- **Only what is in sight.** Where a phone shows a part of a photograph, that part is its own file, cut at the same scale and given to phones through `<picture>`: the queen's third on a phone is `queen-phone.webp`.
- **A full photograph** (the queen, the king) sits in its plate with its edges feathered by a mask: two linear gradients on the queen, a radial one on the king. Its backdrop is the plate's own colour, so no edge shows.
- **A cut-out** (the long-shadowed pawn, the knights, the fallen king) is the piece and its shadow with the backdrop divided out to white, and takes `mix-blend-mode: multiply`, so the white vanishes and the shadow lands on the grey, grain and all. Nothing between it and the grain may make a stacking context (`z-index`, `isolation`, `transform`, `opacity`), or it multiplies onto nothing.
- **An alpha cut-out** (`pawn.webp`, and the outline `pawn-empty.webp` for a place not yet taken) sits as it is.
- **A black cut-out** (`row.webp`) is the piece in black with the photograph's darkness as its alpha. On the grey it lands exactly as a multiplied cut-out would, and it needs no blend mode, so it can sit inside a stacking context, as the home page's Season block is. It was made from `design/photographs/row.jpeg`: the backdrop estimated by closing and blurring a small copy and divided out, the edges faded to white, then `-colorspace Gray -negate -background black -alpha shape`.
- **People's photographs** are in greyscale (the Greyscale Rule).
- **Alt text.** A photograph has `alt=""`: the words beside it say what it means. A photograph that showed something the words did not would need its own alt text.
- **A new one** is made from `design/photographs/` with ImageMagick, cropped to what it shows, at the largest size it will be shown, and saved as WebP into `app/photos/`. A cut-out for multiplying must come out opaque with a pure white backdrop; check it on the grey before using it. It keeps no metadata (`-strip`): a picture in the repository carries no text chunk, EXIF or XMP (`app/photos.test.ts`).

### Grain
- `ui.grain` on a positioned element lays the grain over it. What inside it is positioned paints over the grain; the cut-outs multiply onto it.

### A page with nothing to show
- The not-found page and the error page (`app/fallback.module.css`): one grey plate with the grain, the heading in the display serif with its first word in italic, a line in muted text, the way on (a ruled link list, or the button to try again beside a quiet one), and the photograph that says what happened, beside the words on a desktop and under them on a phone.

### Icons
- The browser's icons (`app/icon.png`, `app/apple-icon.png`) are the black pawn cut-out on the ground colour.

### Motion
**The Chess Rule.** Things move the way chess moves: one piece at a time, a deliberate move in the way that piece moves, then stillness. Nothing floats, loops, bounces, overshoots, fades in on scroll or follows the cursor, and a change of state is a cut, not a fade. Reduced motion drops the movement and shows where it ends.

- **In answer to the pointer:** a colour change on a button, an arrow that leans forward, an underline. 200 to 250ms, `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- **A new Member's pawn** (`app/set-down.tsx`, `.arriving` in `app/home.module.css`): once, as they come from the Profile step to the pawn row. The row shows as it was; at 600ms their pawn is set down one square behind the first empty outline; at 1000ms it steps one square straight forward, up the row, in 600ms, `cubic-bezier(0.65, 0, 0.35, 1)`; as it lands, the count is cut to its new number.

## Do's and Don'ts

### Do:
- **Do** alternate grey and black plates, and give each the one photograph that says what it says.
- **Do** set a plate's heading in the display serif at a size that fills the plate, its first word in italic.
- **Do** write components against `--ink`, `--muted` and `--line`, so a black plate (`ui.black`) turns them over.
- **Do** size photographs and headings in `px` and `vw`, and state each photograph's width in `sizes`.
- **Do** keep every target at least 44px (`--tap`), and every text at 4.5:1 or better on its plate.
- **Do** compose the phone first, on its own terms, then the desktop at 900px.

### Don't:
- **Don't** round a corner, add a box shadow, or put content in a card.
- **Don't** add a colour: no accent, no gradient fill, no tinted panel.
- **Don't** show a photograph wider than its pixels, or size one by the window's height.
- **Don't** set the display serif small, or the grotesque large.
- **Don't** put a blend mode on text unless it crosses a photograph on purpose: "The chess" is set by difference so that it turns dark where it crosses the white king; nothing else is.
- **Don't** show a sign-in button on a page without the note about what signing in stores.

## Kept from the old look

`app/global-error.tsx`, the last-resort page that replaces the whole document when the root layout fails, is the one page not yet redesigned, and the only one that reads `page`, `intro`, `eyebrow` and `lede` in `ui.module.css`. `--raised`, `--sunken`, `--image-outline`, `--error-wash` (which `ui.alert` no longer reads), the `--radius-*` tokens (now 0) and the `--text-*` scale are the old look's too, given values that read in this one. A redesigned page uses the pieces above instead, and the last page to stop using one removes it.

## Privacy and terms: a long text

`app/privacy/page.tsx` and `privacy.module.css`: a long text to be read and found a way around, the quietest page. It has no photograph: none of the six says what it says, and a photograph that meant something else on the home page would mean two things.

- **Title.** "*Privacy* / and terms" in the display serif, `clamp(60px, 20vw, 88px)` on a phone and `min(8.4vw, 140px)` on a desktop, line-height 0.9 (0.88 on a desktop), the same shape as "*Leaderboards* / and Recaps". A test holds the heading's markup word for word, so the First-Word Rule is drawn without an `<em>`: the heading is 4.7em wide, narrower than "Privacy and" and wider than "and terms", and its `::first-line` is italic. Under it the date it last changed, 15px (16px) in `--muted`.
- **List of headings.** Every section heading, in order, each a link to its section: one to a row between 1px rules (`--line`), the grotesque at 500, 16px on a phone (15px on a desktop), each row at least 44px. On a phone it follows the title and fills the first screen, so the whole page is in view before any of it is read, and each row ends in the strip's down arrow (14px), as every section is below it. On a desktop it stands in a column of its own (3fr beside the text's 9fr, 4vw between) and stays in view as the text scrolls (`position: sticky`, 24px from the top, in a window at least 600px tall); there it has no arrows, as the section a row leads to may be above. It uses the headings' own words and adds none.
- **Section.** A 1px rule (`--line`) that runs to the right gutter, 22px, then the heading in the display serif, roman, at 34px on a phone and `min(3.7vw, 52px)` on a desktop, large enough to keep its hairlines; the italic first word is for a page's or a plate's title, not for each of twelve sections. 64px between sections on a phone, 88px on a desktop. On a desktop the first section's rule lines up with the list's; on a phone the first section has none, as the list ends in one.
- **Reading column.** 17px on a phone, 18px on a desktop, line-height 1.55, at most 36em (about 70 characters); 14px between paragraphs and lists, 10px between list items. A list item hangs from an en dash in `--muted`; a numbered list's figures are `--muted` too. A run-in lead ("**Anyone:**") is 600.
- **A link in the text** keeps its line height and is a 44px target: 12px of padding above and below, which moves nothing. The padding goes while the link has keyboard focus (`:focus-visible`), or its ring would be 56px tall and cross the lines above and below; a tap does not match `:focus-visible`, so the target stays.
- **Code** (the cookies' names): `ui-monospace, Menlo, Consolas, monospace` at 0.86em, broken anywhere rather than pushing the page sideways. It is the only monospace on the site, and only for names a reader may need to find in their browser.
- **Home** at the foot of the text is `RuledLinks` with one row.
## Profiles, and the pages for a task

What a Member's Profile, Edit your Profile, Leave the Club and the page after leaving brought (`app/profiles/[id]/profile.module.css`, `app/profile/profile.module.css`).

- **A person's plate.** A Profile opens on a black plate: the Member's photograph, then their name across the plate in the display serif, the first name in italic (`clamp(44px, 12.8vw, 60px)`, `min(8.4vw, 140px)` on a desktop); under the name, the position on the left and the facts on the right, from the same line. Their record follows on the grey. The person takes the black because emphasis here is a black plate.
- **A Member's photograph** is shown in greyscale, at 100px square on a Profile: the size LinkedIn gives it, so never larger than its pixels. It is under the grain (`.portrait::after`), so it looks printed with the page. A Member without one has their initials in the serif's italic, in an empty 1px frame of `--line` (`.large` in `app/avatar.module.css`).
- **A heading that wraps where its words fall** (a name, or a heading not set line by line) takes line-height 1.04. The serif's descenders reach 0.26em below the line and its ascenders 0.76em above, so any tighter and a descender can meet the ascender under it, as the y of "your" met the fi of "Profile" at 0.96.
- **Facts.** One ruled row each (`--line`), the label in capitals (600 11px, 0.16em, `--muted`) at the left, 7.5rem wide (10rem on a desktop), the value beside it. A line to start a conversation with ("Open to") goes first, in the serif at 26px (`clamp(26px, 2.8vw, 44px)` on a desktop), with no rule above it. A record's numbers (Blitz rating, Matchdays played, Streak) stand three to a row under one rule, each in the serif under its label, never split over two lines: `min(42px, 11.2vw)`, so four digits fit a third of a 320 phone, and `clamp(42px, 4.4vw, 68px)` on a desktop.
- **A ledger.** Games grouped by evening: each evening opens on a full `--ink` rule with its date in the serif at 25px (`clamp(25px, 2.2vw, 32px)`) and the ruled list's arrow, leading to its Recap; its Games follow, one to a row on `--line` rules, the result in words and the Game's link at the right.
- **A page for a task** (Edit your Profile, Leave the Club). Its heading across the page on one line, in the serif (`min(12vw, 60px)`, which holds "Edit your Profile" on one line from 232 wide, and `min(7.8vw, 128px)`); under it, on a desktop, the words on the left and the work on the right, from the same line, in the columns a Profile uses (5fr and 7fr, 6vw apart); on a phone one column. No photograph: a task needs none, and leaving least of all.
- **A sentence in the serif** under a heading says the one thing a person must not miss: "This can't be undone." 30px, `clamp(30px, 2.8vw, 44px)` on a desktop.
- **A form.** Each field: its label (600), its hint (15px, `--muted`), then the box: 54px tall, the height of a button, square, 1px `--line-strong`, no fill. A refusal is said between the hint and the box, in `ui.alert`, and the box's border turns `--error`. An answer longer than a line (Open to) is a box four lines tall, enough for its 140 characters on a phone, and Enter in it saves the form as in a one-line field (`enterkeyhint="go"`). The buttons stack at full width on a phone, the first choice first. Below the form, each further part opens on a `--line` rule with its heading in the serif at 34px (44px on a desktop).
- **A choice that cannot be undone.** What goes, one item to a ruled row; then keeping, the ink block, first; then deleting, the button's shape outlined in `--error` and never filled. What stops for the Organiser is said in `ui.alert`.
- **A page with a few words** (`.plain`: after leaving): the heading, a sentence in the serif under it, then the words and the way on, on the left, with the space of the plate around them. No Profile at this address is the site's not-found page (A page with nothing to show), in its own words.

## Signing up

The three steps after signing in (agree, connect Lichess, the optional Profile) and deleting an account part-way: `app/welcome/`, styled in `app/welcome/welcome.module.css`, and deleting part-way in `app/profile/profile.module.css`. Three short steps on a phone, straight after the home page, so they are the same place, quieter.

- **The plate.** One grey plate under the header, with the grain where the steps' pawn stands. On a phone: the steps, the heading, then what there is to do, all at the gutter. On a desktop (`.page`, a grid of `5fr` and `6fr`, `6vw` apart): the steps over the heading on the left, and what there is to do on the right, at most 600px wide against the right gutter, its top level with the heading's.
- **The heading.** The display serif at `clamp(44px, 13.4vw, 60px)` on a phone and `min(6.4vw, 108px)` on a desktop, line-height 0.92 and 0.9, its first word in italic. A line under it in the body size (18px on a desktop), in ink.
- **The steps** (`SignUpSteps` in `app/welcome/steps.tsx`): three squares of a rank, side by side, each under a 1px rule: its number in the display serif (32px, 44px on a desktop) over its name in the grotesque (14px, 15px). The squares behind the person and theirs are ruled in ink; the ones ahead in `--line`, their numbers in outline (`-webkit-text-stroke: 0.8px`). The person's pawn stands on the rule of their square, so it moves one square a step: `pawn-empty.webp`, the outline of a place not yet taken as on the home page, until they are a Member, and `pawn.webp` on the third step. It is 30px wide on a phone and 40px on a desktop.
- **An agreement** (the first step): a fieldset under a 1px rule in ink, its legend in the serif at 30px (34px on a desktop), then what it says, then its box. 40px between the two.
- **The box that accepts** (`.check`): the whole row is the label, inside a 1px rule in ink with 16px of padding, its words at 600. The box is a 28px square with a 1.5px ink border, filled with ink and a paper tick when ticked, its border 2.5px under the pointer. Refused, the row and the box take `--error`, and the refusal (`ui.alert`) follows it. In forced colours the browser draws its own box.
- **The action** is a full-width button on a phone and its own width on a desktop. A note beside it is 15px in `--muted`; a link in a line of text has 12px of padding above and below, a 44px target that moves no line. Leaving instead ("Rather not join?") comes last, under a rule in `--line`.
- **Joining the Telegram group** (the third step, when the invite link is set) is its own part above the Profile form, closed by a rule in `--line`: a line saying what the group is for, then "Join the Telegram group" in `ui.quiet` at its own width. Quiet, so that the form's "Save and continue" stays the step's one ink block. On the home page a Member's "Telegram group" is `ui.quiet` too, under their two buttons: the panel's width on a phone, its own on a desktop.
- **Deleting part-way** (`app/welcome/leave`) is a page for a task, laid out and chosen as Leave the Club is (above): its heading, "This can't be undone." in the serif, then what is deleted and the choice, with no picture and no grain.
## Leaderboards

The Season Leaderboard (`app/seasons/`), the all-time Leaderboard (`app/all-time/`), and the table a Recap shares with them. Built from the approved mock-up of the Season Leaderboard.

### Leaderboard table
- **Where:** `app/leaderboard.tsx` (`MemberCell`, `CompanyName`, `ScoreCell`) with `board.table` in `app/leaderboards.module.css`; a Recap's table uses the same class.
- **Style:** no lines but rules: 1px of ink under the column heads, a 1px `--line` under each row. Heads in capitals, 600 11px, 0.1em, muted, the numbers' heads on the right. Rank 15px muted in a 42px column (64px on a desktop); the name 17px 500 (18px), not underlined until the pointer is on it, its whole cell the link's target; the Company 13.5px muted under the name on a phone, after it on its line on a desktop (14px), its domain kept whole. The figure a Leaderboard is ranked by (`board.score`) 19px 600 (21px) in a 60px column (120px); a secondary count (`board.number`) 15px muted (16px) in 58px (110px). A whole score keeps 0.74em on its right, the width of ".5", so scores line up on the point (`ScoreCell`).
- **On a phone** the table fits as it stands: Rank, the name with its Company, and two numbers, in 358px. The tables take their columns from their heads (`table-layout: fixed`, on `board.board`), so a name breaks between words, and inside one only when the word is longer than its column.
- **Empty:** a muted line between the head's ink rule and a row's rule.

### Leaderboard plate
- `board.board`: on a phone the heading (display, 44px), the table, the notes in 15px muted, then the links. On a desktop two columns, 3fr and 9fr with 4vw between: the heading (`min(3.7vw, 60px)`), the notes and the links on the left, the table on the right, its top level with the heading.
- **Links at the foot** (`MoreLinks`): 16px 500 with a 16px arrow that leans 4px forward under the pointer, each a 44px target; in a row on a phone, a column on a desktop.

### Season heading plate
- A grey plate with grain: "*Season*" and its number in the display serif, the number at `clamp(190px, 58vw, 260px)` beside the word on a phone (under it when it does not fit) and `min(30vw, 420px)` under it on a desktop. Under them on a phone, and to their right on a desktop, the six pieces tallest to shortest (`app/photos/row.webp`, the black cut-out, the pieces 1120 of its 1300px), as wide as the gutters allow on a phone and running to the right gutter on a desktop, never wider than its pixels. The number stands on the pieces' floor.
- Where the Season stands is a label and a 19px line, under the pieces on a phone and above the short pieces at the right on a desktop. Once the Season is over, its champion follows: a label, the names in the serif (`clamp(30px, 8.9vw, 40px)`, `min(3.3vw, 48px)`), the points in 15px muted; on a desktop on a line of its own under a rule, the names under the pieces.
- The all-time Leaderboard's heading is the same without the number and the pieces: "*All-time* Leaderboard" over its line, which sits at the right on a desktop.
- A Season too far off to have dates is a page with nothing to show (`app/fallback.module.css`), its label under the heading, with the pawn in outline.

### The six Matchdays
- A black plate after the Leaderboard, its heading on the left on a desktop. Six cells between `--line` rules, three to a row on a phone, six on a desktop: "Matchday" as a label over its number in the serif (58px, `min(7vw, 104px)`), the date at the foot. A Matchday with a Recap is a link to it, in paper, with an arrow; one to come, or that went by without results ("Not played"), is muted, its number drawn in a 1px outline. Under them the other Seasons, the one shown underlined 2px. A rule closes the plate above the footer.

## Recaps

The list of Recaps, a Recap and the page for a Sunday with none (`app/recaps/`). What they bring that another page may want:

- **A Recap is three plates.** Its date over the queen standing above the fallen king (grey, grain): the night's result. Its Awards (black): the event of the page, so they come before the Leaderboard. Its Leaderboard on the Leaderboard plate (grey, flat), with the links at its foot (`MoreLinks`).
- **The date as a headline** (`recaps.module.css`, `.title`): "*Recap* of", then the date on lines of its own, broken after the day. "September 2026", the longest month and year, is 7.26em, which sets the size on a phone (`clamp(36px, 12vw, 60px)`, on one line from 300 wide; narrower, the year takes a line of its own) and the measure at every width (`max-width: 8em`; `min(7.4vw, 124px)` on a desktop), so the date always breaks after the day and never runs into the photograph.
- **The queen over the fallen king at the head of a plate**: at 0.5 on a phone (360 x 215), under the words, the pieces to the right; on a desktop at the foot of the plate's right side, `min(720px, 55vw)` wide so that below about 1300 wide it shrinks rather than come near the date, its pieces' right edge on the gutter and its long shadow running back towards the words.
- **An Award** (`awards.module.css`): a ruled row on black. What it was for in the serif with its first word in italic (46px; `min(4.2vw, 68px)` on a desktop), who won it in the serif at 30px (`min(2.8vw, 42px)`), not underlined but for the pointer, what they did in the grotesque in muted with its number in ink, 600. On a desktop the name of the Award and the rest sit side by side, 4 to 5.
- **A disclosure that does a button's job** (`<summary>`, "Replay the Game"): the primary block, 54px, a chevron that turns a quarter when it is open. What it opens fills its column, with a 1px rule (`--line`) round it.
- **The Awards' plate** has the Leaderboard plate's columns on a desktop, 3 to 9 with a 4vw gap: its name and line on the left, the Awards on the right.
- **A line instead of an empty list** ("No Recaps yet."): the serif at 30px on a phone (`min(3.6vw, 56px)` on a desktop), where the list would start. A Recap nobody is on has the Leaderboard table's empty line.
- **The list of Recaps**: the ruled list (`ui.ruled`) with each date in a `<time>`; on a desktop the page's name stays in view (`position: sticky`) while the dates go by on the right.
- **A night's Leaderboard** is the Leaderboard table with a Company column (`recaps.module.css`, `.companies`). On a phone there is no room for it: the column is left out and the Company sits under the name, as on the other Leaderboards, so from 320 wide nothing scrolls sideways and a name breaks only between words. From 900 wide the Company has its column, sharing the room with the name.
- **A Sunday with no Recap** is the not-found page's plate (`app/fallback.module.css`), with the pawn in outline.
## The Organiser's pages

The Organiser page and Remove a Member (`app/organiser/`, styled by `app/organiser/organiser.module.css`) are a control panel read by one person: the same world with nothing for show. No photograph, as no picture says what a list of jobs says; no cards; the display serif for the page's heading and each section's heading, the grotesque for everything else.

### A working section
- **Style:** a 1px ink rule across the page, then the section: 28px above and 44px below on a phone, 40px and 64px on a desktop. Its heading (`h2`) in the display serif, 500, at 34px on a phone and `min(3.3vw, 50px)` on a desktop.
- **Desktop:** two columns, 4 to 8, 4vw apart: the heading on the left, what the section holds on the right. The page's opening takes the same columns: the heading and the line under it left, the next Matchday right, a label over its date at 22px (20px on a phone), as on the Season Leaderboard's mock-up.
- **A part** inside a section (a scheduled job, a Sunday's tournament to cancel, a form) sits under a 1px `--line` rule, 24px below it. Its heading (`h3`) is the grotesque, 600, 17px. On a desktop the heading stands to the left of the rest, 1 to 3.
- **Facts:** a label in `ui.caps`, muted, and its value. On a phone each fact is a row between `--line` rules, the labels in a column at least 5.5rem wide; on a desktop the facts stand side by side, each label over its value, each at least 8rem wide so that they line up from part to part, onto a second line where there is no room, and no rules.
- **Rows:** a list of Sundays or Matchdays is a row each between `--line` rules; a Sunday's button stays at the end of its row, the day over what it holds on a phone.

### State, at a glance
Three states, told by form and never by colour alone:

- **Fine:** unmarked.
- **Needs you:** the square (`--ink`, 9px) before the words, which are ink at 500. A message to act on (`role="alert"`, or not when it is how things stand, such as "Not connected"), and a row of a list that wants a hand.
- **Failed:** the same square and words turned over, on a black band: paper on `--black`, 12px above and below. On a phone the band reaches the screen's edges, its square and words in line with the others'; on a desktop it is the width of its column. A fact that is wrong where it stands, such as a failed outcome or a last run too long ago, is turned over in place (`.flag`): paper on black, 600.
- **A section's heading** takes the mark of the worst thing in it: the square before it when anything needs the Organiser, and the heading itself turned over, on a black band from the screen's edge, when anything failed. A list of things to do by hand needs the Organiser by being there at all (`.byHand`). The heading's words wrap on their own edge, never under the square; on a desktop the square hangs in the gutter, so that every heading's words start on one edge.
- **Nothing heavy where all is well:** a button that can always be pressed but is needed only when something is wrong (Connect Lichess again) is `ui.quiet` while things work, and the ink block only when they do not.
- Contrast: ink on the ground 11.9:1, paper on the black 16.4:1.
- **Forced colours** repaint every ground, so there the squares are drawn in `CanvasText` and what failed (the band, the flag, the heading) takes a 2px `CanvasText` border.
- A heading or a paragraph that can print a Lichess account or a Member's name breaks a word where it must (`overflow-wrap: anywhere`), so a 30-character account never runs into what stands beside it or off a phone.

### Forms
- A field's label above it, the grotesque at 600; the field as `globals.css` draws it, at most 28rem wide.
- Two or three choices are radio buttons, a 44px row each, not a list to open: a closed list cuts long choices off on a phone.
- A form's own action is a primary button, the full width of a phone. The quieter actions beside a row (Skip, Undo, Done) are `ui.quiet`.
- **Removing someone:** keeping them first, the ink block; removing outlined in `--error`, never filled, 54px tall like the other. Stacked at full width on a phone.

## Adding to this file

When a page brings a piece another page will want (a table, a form, a plate of its own), add it under Components: what it looks like, in words and values, and the file it lives in. A new token goes into `app/globals.css` and into the frontmatter above in the same commit; `globals.css` is the one the site reads. Write what is built, not what is planned, and keep each rule to the page that proved it.

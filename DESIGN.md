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

## Typography

**Display Font:** Bodoni Moda (with Bodoni 72, Didot, serif), its optical-size axis kept, so the hairlines thin as the type grows.
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
- `app/ui.module.css`: `black`, `grain`, `display`, `caps`, `ruled`, and the older pieces (`page`, `intro`, `lede`, `prose`, `panel`, `button`, `quiet`, `actions`, `alert`, `backLinks`, `arrive`).
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

### Footer
- **Style:** black, 14px; the two sentences in paper muted, the two links in paper, underlined, each a 44px target. Three columns on a desktop, stacked on a phone.

### Buttons
- **Shape:** square (0).
- **Primary:** an ink block with paper text, 600 16px, 54px tall, 28px either side (`<button>` as it is; a link that does a button's job takes `ui.button`). Full width on a phone where it is the plate's one action.
- **Hover / Focus / Active:** a lighter ink (`--button-hover`) under the pointer; the focus ring is 2px of ink, 3px out; pressed, it drops 1px.
- **On black:** a paper block with black text, by the Turned-Over Rule.
- **In the header:** 44px tall, 20px either side, 14px.

### Ruled link list
- **Style:** places to go, one to a row between 1px rules (`--line`), each in the display serif at 25px (`min(2.7vw, 40px)` on a desktop), at least 68px tall (92px), with a 22px arrow at the end that leans 5px forward under the pointer. `RuledLinks` takes `[href, label]` pairs and a `className` to place it.

### Label
- **Style:** `ui.caps`, 600 11px, 0.16em, capitals, in the colour of its text. Short: a name or a credit, never a sentence.

### Photographs
How a photograph meets the page is most of this look.

- **Choosing one.** One per plate, for what the plate says. The six photographs are the queen, the white king on black, a lone pawn, two knights facing each other, a queen over a fallen king, and a row of six pieces tallest to shortest.
- **In the code.** Always the framework's image component with a static import, which gives it its width and height and a hashed address: `import king from "./photos/king.webp"`, then `<Image src={king} alt="" sizes="(min-width: 900px) 72vw, 512px" className={styles.king} />`. `sizes` says how wide it is shown at each width, in `px` or `vw`, and is left out only for a file smaller than any screen asks for (the pawns). Only the first screen's photograph takes `preload`. The browser is sent WebP at the width it needs, at quality 75; a photograph on a black backdrop takes `quality={90}`, as at 75 its grain breaks into blocks (`next.config.ts` allows those two).
- **Never larger than it can hold.** A photograph's CSS width never passes its file's width: the 730px pawn is shown at 292px on a phone and at most 730px on a desktop; the 1800px queen at most about 1480px. On a phone, keep it within half its pixels where the composition allows, so it stays sharp on a 2x screen. Give a photograph `max-width: none` when it is positioned wider than its box, as the base `img` rule caps it at its box.
- **A full photograph** (the queen, the king) sits in its plate with its edges feathered by a mask: two linear gradients on the queen, a radial one on the king. Its backdrop is the plate's own colour, so no edge shows.
- **A cut-out** (the long-shadowed pawn, the knights, the fallen king) is the piece and its shadow with the backdrop divided out to white, and takes `mix-blend-mode: multiply`, so the white vanishes and the shadow lands on the grey, grain and all. Nothing between it and the grain may make a stacking context (`z-index`, `isolation`, `transform`, `opacity`), or it multiplies onto nothing.
- **An alpha cut-out** (`pawn.webp`, and the outline `pawn-empty.webp` for a place not yet taken) sits as it is.
- **Alt text.** A photograph has `alt=""`: the words beside it say what it means. A photograph that showed something the words did not would need its own alt text.
- **A new one** is made from `design/photographs/` with ImageMagick, cropped to what it shows, at the largest size it will be shown, and saved as WebP into `app/photos/`. A cut-out for multiplying must come out opaque with a pure white backdrop; check it on the grey before using it.

### Grain
- `ui.grain` on a positioned element lays the grain over it. What inside it is positioned paints over the grain; the cut-outs multiply onto it.

### Motion
- Only in answer to the pointer: a colour change on a button, an arrow that leans forward, an underline. 200 to 250ms, `cubic-bezier(0.2, 0.8, 0.2, 1)`. Nothing moves by itself, and reduced motion drops the movement.

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

## Kept for the pages not yet redesigned

`--raised`, `--sunken`, `--accent`, `--on-accent`, `--image-outline`, `--shadow-raised`, the `--radius-*` tokens (now 0), the `--text-*` scale, and in `ui.module.css` `panel`, `eyebrow`, `marker` and `arrive` are the old look's, given values that read in this one. A redesigned page uses the pieces above instead, and the last page to stop using one removes it.

## Adding to this file

When a page brings a piece another page will want (a table, a form, a plate of its own), add it under Components: what it looks like, in words and values, and the file it lives in. A new token goes into `app/globals.css` and into the frontmatter above in the same commit; `globals.css` is the one the site reads. Write what is built, not what is planned, and keep each rule to the page that proved it.

## Profiles, and the pages for a task

What a Member's Profile, Edit your Profile, Leave the Club and the page after leaving brought (`app/profiles/[id]/profile.module.css`, `app/profile/profile.module.css`).

- **A person's plate.** A Profile opens on a black plate: the Member's photograph, then their name across the plate in the display serif, the first name in italic (`clamp(44px, 12.8vw, 60px)`, `min(8.4vw, 140px)` on a desktop); under the name, the position on the left and the facts on the right, from the same line. Their record follows on the grey. The person takes the black because emphasis here is a black plate.
- **A Member's photograph** is shown in greyscale, at 100px square on a Profile: the size LinkedIn gives it, so never larger than its pixels. It is under the grain (`.portrait::after`), so it looks printed with the page. A Member without one has their initials in the serif's italic, in an empty 1px frame of `--line` (`.large` in `app/avatar.module.css`).
- **A heading that wraps where its words fall** (a name, or a heading not set line by line) takes line-height 1.04. The serif's descenders reach 0.26em below the line and its ascenders 0.76em above, so any tighter and a descender can meet the ascender under it, as the y of "your" met the fi of "Profile" at 0.96.
- **Facts.** One ruled row each (`--line`), the label in capitals (600 11px, 0.16em, `--muted`) at the left, 7.5rem wide (10rem on a desktop), the value beside it. A line to start a conversation with ("Open to") goes first, in the serif at 26px (`clamp(26px, 2.8vw, 44px)` on a desktop), with no rule above it. A record's numbers (Blitz rating, Matchdays played, Streak) stand three to a row under one rule, each in the serif at 42px (`clamp(42px, 4.4vw, 68px)`) under its label.
- **A ledger.** Games grouped by evening: each evening opens on a full `--ink` rule with its date in the serif at 25px (`clamp(25px, 2.2vw, 32px)`) and the ruled list's arrow, leading to its Recap; its Games follow, one to a row on `--line` rules, the result in words and the Game's link at the right.
- **A page for a task** (Edit your Profile, Leave the Club). Its heading across the page on one line, in the serif (`clamp(44px, 12vw, 60px)`, `min(7.8vw, 128px)`); under it, on a desktop, the words on the left and the work on the right, from the same line, in the columns a Profile uses (5fr and 7fr, 6vw apart); on a phone one column. No photograph: a task needs none, and leaving least of all.
- **A sentence in the serif** under a heading says the one thing a person must not miss: "This can't be undone." 30px, `clamp(30px, 2.8vw, 44px)` on a desktop.
- **A form.** Each field: its label (600), its hint (15px, `--muted`), then the box: 54px tall, the height of a button, square, 1px `--line-strong`, no fill. A refusal is said between the hint and the box, in `--error`, 600 15px, with nothing round it, and the box's border turns `--error`. An answer longer than a line (Open to) is a box four lines tall, enough for its 140 characters on a phone. The buttons stack at full width on a phone, the first choice first; a link beside a button is a button's size. Below the form, each further part opens on a `--line` rule with its heading in the serif at 34px (44px on a desktop).
- **A choice that cannot be undone.** What goes, one item to a ruled row; then keeping, the ink block, first; then deleting, the button's shape outlined in `--error` and never filled. What stops for the Organiser is said in `--error`, 600.
- **A page with a few words** (`.plain`: after leaving, no Profile at this address): the heading, a sentence in the serif under it, then the words and the links, on the left, with the space of the plate around them.

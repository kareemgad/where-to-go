# Intent and Refinement | Specification

How a person says what they want, how that becomes a typed query, and what the
engine is allowed to do with it. Companion to `02_PRD.md` (journeys),
`13_UX_AND_JOURNEYS.md` (the ranking contract) and `10_GLOBAL_MARKET_ARCHITECTURE.md`
(taxonomies and market configuration).

## The shape of a search

One screen. A chat input, chips showing what was understood, a collapsible
refine panel, then results. Chat and refine edit the same object and **that
object is the URL**.

Nothing is held in a session. A search is entirely described by its query
string, which is what makes it shareable, reloadable, back-buttonable and
testable without a browser. It is also why the no-JavaScript path is not a
fallback: the chat input is a form that posts to a server action which parses,
patches and redirects, so "cheaper" works with scripting off.

```
/{market}/discover
  ?when=weekend          tonight | tomorrow | weekend | nextN | 2026-11-13 | 2026-11-13..2026-11-16
  &band=evening          brunch | afternoon | evening | late_night
  &party=4               optional; absent means group fit is not scored
  &budget=300            optional, whole units; absent means price is shown and never filtered
  &tags=jazz,rooftop     vocabulary keys
  &must=live_performance,halal
  &kinds=restaurant
  &who=kids              age bands; never stored
  &noise=quiet
```

Three display-only parameters survive a chat turn so the page can report it
without state: `said` (the utterance), `ask` (a pending question) and `missed`
(words the parser could not place). None reaches the matcher.

## When

A window, not a date. Up to **14 days**, evaluated per day, each venue
returned once on its best day with the other matching days listed.

Best day means best verdict, then highest score, then earliest date. Scoring
before choosing matters: across fourteen days the first matching night is
rarely the best one.

The cap is applied by truncation and **reported**: the response carries the
number of days asked for, and the page says so. A search that quietly answers
a narrower question than the one asked is worse than one that admits it.

Relative phrases resolve in the market's own timezone from the request clock.
Two things are market configuration rather than constants, and neither would be
caught by the market-literal guard:

- **Weekend days.** Saturday–Sunday in the UAE, Friday–Saturday in Egypt.
- **Band hours.** Evening is not the same hours everywhere.

Days are added as calendar days in the market zone. Dividing a millisecond
difference drops or repeats a date on the two daylight-saving transitions a
year.

## Experiences

A controlled vocabulary replaces free-text genres: 22 global terms across four
facets (music, setting, occasion, activity), extensible per market. Free-text
matching compared a string a user typed against a string a venue wrote, which
matches on spelling rather than on meaning and gave the parser nothing to aim
at.

An alias table maps phrases onto keys and serves two callers:

- the parser, resolving what someone typed;
- the repository, resolving an occurrence's `genre_tags`.

Both arrive at the same key for the same word, which two separate mappings
could not guarantee. `genre_tags` stay exactly as the source wrote them —
display and audit, not matching.

**Match strength** is overlap between requested keys and stored ones, each hit
weighted by the evidence behind it. A tag asserted about tonight's programme
counts ahead of the same tag asserted about the venue in general: "they do jazz
sometimes" is a weaker answer to "jazz tonight" than "tonight is the jazz
night".

It is shown as the named tags that matched, never as a percentage and **never
labelled confidence**. It is arithmetic over stored claims, not a model's
opinion, and a venue scores low either because it does not match or because
nobody has told us it does — which is why information completeness is reported
beside it rather than folded in.

## Must-haves

Ten tri-state hard filters (ADR-011): live performance confirmed, outdoor
seating, indoor seating, step-free access, kids welcome, licensed,
alcohol-free, halal, takes reservations, open past midnight.

Each shows how many candidates it **cannot decide either way**, before it is
switched on, so a filter that would move half the catalogue into the collapsed
section says so first.

Unknown is never a pass. `live_performance` is the only one that can fail on
absence, because "no confirmed performance on this date" is a fact about our
evidence rather than a gap in it.

## Age

Bands about companions — kids, teens, adults only, seniors — gating on a
venue's minimum admission age and nothing else. Never the user's own age, and
never stored: the selection lives in the URL for the life of one search.

A caveat worth stating: query strings reach server access logs, so "URL only"
is not quite "nowhere".

An unknown door policy resolves to `needs_confirmation`, not a pass. Turning up
with a thirteen-year-old and being refused is the outcome worth refusing to
risk. A minimum age of **zero** is the verified claim that there is no minimum,
which is different from not knowing.

## Noise

Four bands — quiet, moderate, lively, loud — as a **soft** preference over the
stored noise band and conversation score.

Deliberately no longer a hard constraint. "Quiet enough to talk" excluded
venues on a stored conversation score, so one uncalibrated number could remove
a place entirely. A venue with no noise evidence is now ranked without that
signal rather than hidden behind a confirmation prompt.

## Outing type

A global taxonomy of 12 kinds, extensible per market. A venue may hold several
with at most one primary: a restaurant that hosts bands is both, and forcing a
single kind would misclassify exactly the hybrid venues this product is for.

Activity providers are venues whose sessions are occurrences. No new entity.

## The parser

`IntentParser` port, mock adapter only. Deterministic, offline, English and
Arabic, no provider, no SDK, no key.

ADR-004 gives a model two jobs and this is the first: turn an utterance into a
validated filter object. It never decides eligibility, never ranks, never
publishes a claim.

Three properties the mock keeps that a model would have to be constrained into:

- **It never invents a term.** Tags come from the alias table or not at all.
- **It is reproducible.** The same sentence gives the same patch every time,
  which is what makes a search shareable as a URL.
- **It says what it ignored.** Unplaced words are reported rather than quietly
  dropped; a parser that silently swallows half a sentence teaches people to
  distrust all of it.

Output is **validated, not trusted**. A tag outside the vocabulary is dropped;
a malformed date, an unknown field or an out-of-range value fails the whole
turn closed and leaves the query untouched (doc 07).

### Turns are patches

"Cheaper", "outdoor instead" and "Saturday then" are edits to something that
already exists. Additive by default, replacing only on an explicit marker,
because "and some jazz" and "jazz instead" are different sentences.

### Normalisation

Both sides of every comparison are folded — the typed phrase and the stored
alias. Normalising one side is the classic way to build a matcher that works in
English and silently fails in Arabic.

Folded: Arabic-Indic digits, harakat, tatweel, alef variants. **Not** folded:
teh marbuta, because merging words that differ by it produces a confident chip
for something nobody asked for, and a wrong match is worse than a missing one.

### One question, at most

Asked only when a hard filter hangs on the answer. Today that is exactly one
case: a group phrase like "the family" that does not say whether under-18s are
coming, where minimum admission age is at stake.

A question that does not change which venues are eligible costs a turn and buys
nothing.

### Venue questions

A question about a venue is answered from stored claims through the existing
deterministic explanations, or with "we don't know that yet". It is not a
filter and must not become one.

## What stays deterministic

Everything that decides anything:

- eligibility and the tri-state verdict;
- ranking, weights and tie-breaks;
- explanations, which cite stored claims and are assembled from typed grounds.

An LLM may one day rephrase an explanation. It may never be the source of one.

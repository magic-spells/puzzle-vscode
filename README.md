# Puzzle for Visual Studio Code

Language support for Puzzle single-file components (`.pzl`). The extension is
kept in sync with the current Puzzle compiler grammar rather than legacy
aliases.

## Features

- HTML highlighting in `<puzzle-view>` and `<puzzle-skeleton>`
- JavaScript in `<script>` and TypeScript in `<script lang="ts">`
- CSS in `<style>` and `<style scoped>`
- CSS plus Puzzle expressions inside inline `style="..."` attributes
- Template expressions in interpolations, directives, and dynamic attributes,
  highlighted with the JavaScript grammar
- Distinct component, event/action, modifier, library-function, and range
  scopes
- Snippets and lightweight completions for current Puzzle constructs,
  including the function library as call snippets
- `Puzzle: Insert Component Template` command

HTML comments suppress Puzzle expressions, so documentation such as
`<!-- {#if example} -->` remains a comment.

## Supported Puzzle syntax

```html
<puzzle-view class="album {#if selected}is-selected{/if}">
  {#if album}
    <AlbumCard
      album={ album }
      style="background:{ album.artwork }"
      @play:once={ play(album) } />
  {:else if loading}
    <p>Loading…</p>
  {:else}
    <p>Album not found.</p>
  {/if}

  {#for track in tracks, index}
    <TrackRow track={ track } position={ index + 1 } />
  {/for}

  {#for 1...4, n}<span>{ n }</span>{/for}
  <p>{ capitalize(title.trim()) } · { currency(album.price) }</p>
</puzzle-view>

<puzzle-skeleton min-duration="250">
  <div class="skeleton"></div>
</puzzle-skeleton>

<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';

export default class AlbumView extends PuzzleView {
  data() {
    return { album: null, loading: true, selected: false, tracks: [] };
  }

  events = {
    play: (album) => album
  };
}
</script>

<style scoped>
.album {
  display: grid;
}
</style>
```

The grammar tracks the **Puzzle 0.8.0** template grammar and recognizes:

- Template expressions as JavaScript expressions (D176): paths, literals,
  operators, `??` and `?.`, template literals, object and array literals,
  methods (`{ name.trim().toUpperCase() }`, `{#if items.length}`) and arrow
  functions as call arguments (`{#for t in todos.filter(t => !t.done)}`),
  highlighted with the JavaScript grammar
- The Puzzle function library, called bare (`{ currency(price) }`,
  `{ truncate(post.body, 120) }`, `{ date(d, 'short') }`,
  `{ t('cart.count', { count: n }) }`): `round`, `currency`, `percentage`,
  `number_with_delimiter`, `compact_number`, `pluralize`, `capitalize`,
  `truncate`, `strip_html`, `strip_newlines`, `escape`, `raw`,
  `newline_to_br`, `json`, `date`, `time`, `datetime`, `in_timezone`, `t`,
  `link` and `timeago` carry `support.function.library.puzzle`. A method with
  the same name (`x.date()`) does not
- No `|` in a template expression: there is no pipe and no bitwise OR, so a
  single `|` anywhere in an interpolation, attribute value, prop, marker
  argument, block header or `@event` handler is marked invalid. `||` is
  logical OR, and a `|` inside a string or template-literal text is text
- No `this` in a template expression, handlers included: every value comes
  through `data()`. A member named `this` (`x.this`) and an object key are
  ordinary names
- `raw(html)` and `newline_to_br(text)` only as the whole (outermost call) of
  a text interpolation (`{ raw(post.bodyHtml) }`). Nested in another call, or
  anywhere in an attribute value, component prop, marker argument, `key=`,
  `flip=` or handler, the name is marked invalid
- The other expression rules (the method table, the excluded operators such
  as `**`, `new` and `typeof`, the global namespaces) are the compiler's; the
  grammar does not flag them
- `{#if}`, `{:else if}`, `{:else}`, `{/if}`
- `{#unless}` and `{/unless}`
- `{#for item in items, index}` and `{#for from...to, value}` (the two forms
  don't mix — `{#for i in 1...5}` is a compile error steering to
  `{#for 1...5, i}`)
- `\{` and `\}` — the literal-brace escape, in template text and in attribute
  values (`pattern="[0-9]\{5\}"`). It is deliberately inert inside `{#raw}`,
  where no backslash handling happens at all.
- `{#case}`, `{:when}`, `{:else}`, and `{/case}`
- `{#svg 'path/to/icon.svg'}` (void — it takes no closer)
- `{#comment}` blocks and `{## inline notes }`
- `{#raw}…{/raw}`, where braces are literal bytes — no interpolation, block
  tags, or event bindings — while HTML stays structural.
  Content after the keyword is ignored (`{#raw json}`) and the closer tolerates
  whitespace (`{/ raw }`).
- `@event={ expression }` and colon modifiers such as
  `@keydown:enter:prevent={ submit(event) }`, including `@click:outside`
- The directive attributes `key`, `island`, `ref`, and `flip`
- The composition markers `<Children>`, `<Slot>`, `<Portal>` and `<Snippet>`,
  distinct from ordinary capitalized component tags. `<Snippet>` (D166) is
  0.7.0's fourth marker: `fits` is its only valued attribute and every other
  attribute is a bare parameter declaration (`<Snippet fits="row" user group>`)
- Marker arguments (D166): a brace-valued attribute on `<Children>` or `<Slot>`
  other than `name` is a per-stamp argument, and highlights as embedded
  JavaScript — `<Slot name="row" user={ user }>fallback</Slot>`
- Capitalized component tags and ordinary HTML tags, including dotted
  component-family member paths such as `<Frame.Wrapper>` (D167)

Legacy `{#each}`, `{:elsif}`, dotted event modifiers such as `@click.prevent`,
and lowercase markers such as `<slot>` or `<children>` are intentionally marked
invalid because the Puzzle compiler does not accept them. `{#raw}` inside an
attribute value is flagged for the same reason.

## Development

```sh
npm install
npm test
```

`npm test` compiles the extension, runs the grammar tests (including every
valid case of Puzzle's `expressions-parse.json` conformance table, copied to
`test/fixtures/`, which must tokenize with no invalid scope) and the
completion tests. Set `PUZZLE_CONFORMANCE` to test against another copy of the
table.

Press `F5` from VS Code to launch an Extension Development Host. The grammar
test uses VS Code's own HTML, JavaScript, TypeScript, and CSS grammars; set
`VSCODE_APP_ROOT` to the editor's `resources/app` directory when it is not in a
standard installation location.

## Scope reference

| Construct | TextMate scope |
| --- | --- |
| Puzzle section | `entity.name.tag.section.puzzle` |
| Component tag | `entity.name.tag.component.puzzle` |
| Composition marker | `entity.name.tag.marker.puzzle` |
| Directive attribute | `keyword.control.directive.puzzle` |
| Raw block keyword | `keyword.control.raw.puzzle` |
| Raw block body | `meta.raw.puzzle` |
| Event/action sigil (`@`) | `keyword.operator.event.puzzle` |
| Event/action name | `support.function.event.puzzle` |
| Event modifier | `storage.modifier.event.puzzle` |
| Library function call | `support.function.library.puzzle` |
| Template expression | `meta.embedded.expression.puzzle` |
| Range operator | `keyword.operator.range.puzzle` |
| `\|` in an expression | `invalid.illegal.pipe.puzzle` |
| `this` in an expression | `invalid.illegal.this.puzzle` |
| Misplaced `raw` / `newline_to_br` | `invalid.illegal.markup-function.puzzle` |
| Invalid legacy syntax | `invalid.illegal.*.puzzle` |

## Intentional limits

This extension provides syntax highlighting, snippets, completions, and a
template insertion command. It does not currently provide a formatter,
compiler-backed diagnostics, cross-file component IntelliSense, or an LSP. The
Puzzle compiler remains the source of truth for semantic rules such as whether
a key modifier belongs on a keyboard event.

## License

MIT

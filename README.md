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
- Distinct component, event/action, modifier, formatter, and range scopes
- Snippets and lightweight completions for current Puzzle constructs
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
  <p>{ title | trim | capitalize }</p>
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

- Template values as a data language (D176): paths, literals and operators,
  with `.size` for the count of a list or string
  (`{#if todos.size > 0}`, `{ items[items.size - 1] }`) and `??` for a
  fallback. The data-language rules (no calls on values, no `.length`, no
  arrow functions, template literals or bitwise operators) are left to the
  compiler; the grammar highlights the expression with the JavaScript grammar
- `{ expression }` and formatter chains (`| formatter(args)`) in every value
  position (0.8.0): text, quoted and brace-only attribute values
  (`title={ price | currency }`), component props and marker arguments. Only a
  top-level single `|` is a pipe; `||` stays logical OR. A pipe not followed by
  a formatter name (`| 0`, `|=`, `| bit-1`, `| fmt.eur`) is marked invalid. A
  formatter name is an identifier, optionally kebab-case (`| my-format`). A
  `|` nested in parentheses, brackets or braces is a compile error the grammar
  leaves to the compiler
- `@event` handler bodies are JavaScript, but a single `|` there is marked
  invalid: it is neither a formatter nor a bitwise OR. `||` and `|=` stay
  JavaScript operators
- The markup formatters `raw` and `newline_to_br` (D174) render only as the
  last formatter of a text interpolation (`{ post.bodyHtml | raw }`). One
  followed by another formatter, given arguments, or used in an attribute
  value, component prop, marker argument or `key=` is marked invalid
- Condition headers take no formatter chain (D173 V1): a top-level `|` in an
  `{#if}`, `{:else if}`, `{#unless}` or `{#case}` header, inline attribute
  `{#if}`s included, is marked invalid, as is any pipe in a `{#for}` header or
  a `{:when}` value. The compiler rejects them; compute the value in `data()`
  and test that field (`{#if hasTags}`), and write `||` for a logical OR
- Object literals as call and formatter arguments (0.8.0) —
  `{ 'greeting' | t({ name: user.name }) }`, `@click={ save({ id: todo.id }) }`
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
  tags, formatter pipes, or event bindings — while HTML stays structural.
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
| Formatter | `variable.function.formatter.puzzle` |
| Formatter pipe | `keyword.operator.formatter.puzzle` |
| Range operator | `keyword.operator.range.puzzle` |
| Invalid legacy syntax | `invalid.illegal.*.puzzle` |

## Intentional limits

This extension provides syntax highlighting, snippets, completions, and a
template insertion command. It does not currently provide a formatter,
compiler-backed diagnostics, cross-file component IntelliSense, or an LSP. The
Puzzle compiler remains the source of truth for semantic rules such as whether
a key modifier belongs on a keyboard event.

## License

MIT

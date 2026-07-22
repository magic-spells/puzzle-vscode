# Puzzle for Visual Studio Code

Language support for Puzzle single-file components (`.pzl`). The extension is
kept in sync with the current Puzzle compiler grammar rather than older
Svelte-style aliases.

## Features

- HTML highlighting in `<puzzle-view>` and `<puzzle-skeleton>`
- JavaScript in `<scripts>` and TypeScript in `<scripts lang="ts">`
- CSS in `<styles>` and `<styles scoped>`
- CSS plus Puzzle expressions inside inline `style="..."` attributes
- JavaScript expressions in interpolations, directives, and dynamic attributes
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

<scripts lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';

export default class AlbumView extends PuzzleView {
  data() {
    return { album: null, loading: true, selected: false, tracks: [] };
  }

  events = {
    play: (album) => album
  };
}
</scripts>

<styles scoped>
.album {
  display: grid;
}
</styles>
```

The grammar recognizes:

- `{ expression }` and formatter chains (`| formatter(args)`)
- `{#if}`, `{:else if}`, `{:else}`, `{/if}`
- `{#unless}` and `{/unless}`
- `{#for item in items, index}` and `{#for from...to, value}`
- `{#case}`, `{:when}`, `{:else}`, and `{/case}`
- `{#svg 'path/to/icon.svg'}`
- `@event={ expression }` and colon modifiers such as
  `@keydown:enter:prevent={ submit(event) }`
- Capitalized component tags and ordinary HTML tags

Legacy `{#each}`, `{:elsif}`, and dotted event modifiers such as
`@click.prevent` are intentionally marked invalid because the Puzzle compiler
does not accept them.

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
| Event/action sigil (`@`) | `keyword.operator.event.puzzle` |
| Event/action name | `support.function.event.puzzle` |
| Event modifier | `storage.modifier.event.puzzle` |
| Formatter | `variable.function.formatter.puzzle` |
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

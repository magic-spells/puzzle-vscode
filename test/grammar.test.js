'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const textmate = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

const projectRoot = path.resolve(__dirname, '..');

function findVSCodeAppRoot() {
    const candidates = [
        process.env.VSCODE_APP_ROOT,
        '/Applications/Visual Studio Code.app/Contents/Resources/app',
        '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app',
        path.resolve(path.dirname(process.execPath), '..', 'resources', 'app'),
        path.resolve(path.dirname(process.execPath), '..', 'Resources', 'app')
    ].filter(Boolean);

    const root = candidates.find(candidate =>
        fs.existsSync(path.join(candidate, 'extensions', 'html', 'syntaxes', 'html.tmLanguage.json'))
    );

    if (!root) {
        throw new Error('Unable to find VS Code resources. Set VSCODE_APP_ROOT to its resources/app directory.');
    }

    return root;
}

async function loadPuzzleGrammar() {
    const vscodeRoot = findVSCodeAppRoot();
    const wasmPath = require.resolve('vscode-oniguruma/release/onig.wasm');
    await oniguruma.loadWASM(fs.readFileSync(wasmPath).buffer);

    const grammarPaths = {
        'text.html.puzzle': path.join(projectRoot, 'syntaxes', 'puzzle.tmLanguage.json'),
        'text.html.basic': path.join(vscodeRoot, 'extensions', 'html', 'syntaxes', 'html.tmLanguage.json'),
        'source.js': path.join(vscodeRoot, 'extensions', 'javascript', 'syntaxes', 'JavaScript.tmLanguage.json'),
        'source.ts': path.join(vscodeRoot, 'extensions', 'typescript-basics', 'syntaxes', 'TypeScript.tmLanguage.json'),
        'source.css': path.join(vscodeRoot, 'extensions', 'css', 'syntaxes', 'css.tmLanguage.json')
    };

    const registry = new textmate.Registry({
        onigLib: Promise.resolve({
            createOnigScanner: patterns => new oniguruma.OnigScanner(patterns),
            createOnigString: value => new oniguruma.OnigString(value)
        }),
        loadGrammar: async scopeName => {
            const grammarPath = grammarPaths[scopeName];
            if (!grammarPath) return null;
            return textmate.parseRawGrammar(fs.readFileSync(grammarPath, 'utf8'), grammarPath);
        }
    });

    return registry.loadGrammar('text.html.puzzle');
}

function tokenize(grammar, source) {
    let ruleStack = textmate.INITIAL;
    return source.split(/\r?\n/).map(line => {
        const result = grammar.tokenizeLine(line, ruleStack);
        ruleStack = result.ruleStack;
        return { line, tokens: result.tokens };
    });
}

function lineWith(tokenized, text, occurrence = 0) {
    const matches = tokenized.filter(entry => entry.line.includes(text));
    assert(matches[occurrence], `Could not find line occurrence ${occurrence} containing ${JSON.stringify(text)}`);
    return matches[occurrence];
}

function scopesAt(entry, needle, offset = 0, occurrence = 0) {
    let from = 0;
    let index = -1;
    for (let i = 0; i <= occurrence; i += 1) {
        index = entry.line.indexOf(needle, from);
        assert(index >= 0, `Could not find occurrence ${occurrence} of ${JSON.stringify(needle)} in ${JSON.stringify(entry.line)}`);
        from = index + needle.length;
    }
    const column = index + offset;
    const token = entry.tokens.find(candidate => candidate.startIndex <= column && column < candidate.endIndex);
    assert(token, `No token at column ${column} in ${JSON.stringify(entry.line)}`);
    return token.scopes;
}

function assertScope(entry, needle, expected, offset = 0, occurrence = 0) {
    const scopes = scopesAt(entry, needle, offset, occurrence);
    assert(scopes.includes(expected), `${JSON.stringify(needle)} missing ${expected}\nScopes: ${scopes.join(' ')}`);
}

function assertNoScope(entry, needle, unwanted, offset = 0, occurrence = 0) {
    const scopes = scopesAt(entry, needle, offset, occurrence);
    assert(!scopes.includes(unwanted), `${JSON.stringify(needle)} unexpectedly has ${unwanted}\nScopes: ${scopes.join(' ')}`);
}

async function main() {
    for (const relativePath of [
        'package.json',
        'language-configuration.json',
        'snippets/puzzle.json',
        'syntaxes/puzzle.tmLanguage.json'
    ]) {
        JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
    }

    const grammar = await loadPuzzleGrammar();
    assert(grammar, 'Puzzle grammar did not load');

    const fixture = fs.readFileSync(path.join(projectRoot, 'test-files', 'TestComponent.pzl'), 'utf8');
    const tokens = tokenize(grammar, fixture);

    assertScope(lineWith(tokens, '<puzzle-view'), 'puzzle-view', 'entity.name.tag.section.puzzle');
    assertScope(lineWith(tokens, 'expressions in comments'), 'ignored', 'comment.block.html');
    assertNoScope(lineWith(tokens, 'expressions in comments'), 'ignored', 'source.js.embedded.puzzle');
    assertScope(lineWith(tokens, 'background:'), 'background', 'support.type.property-name.css');
    assertScope(lineWith(tokens, 'background:'), 'headerColor', 'source.js.embedded.puzzle');
    assertScope(lineWith(tokens, 'capitalize(title.trim())'), 'capitalize', 'support.function.library.puzzle');
    assertScope(lineWith(tokens, 'capitalize(title.trim())'), 'trim', 'entity.name.function.js');
    assertScope(lineWith(tokens, '<ItemCard'), 'ItemCard', 'entity.name.tag.component.puzzle');
    assertScope(lineWith(tokens, '@play:once'), '@', 'keyword.operator.event.puzzle');
    assertScope(lineWith(tokens, '@play:once'), 'play', 'support.function.event.puzzle');
    assertScope(lineWith(tokens, '@play:once'), ':once', 'storage.modifier.event.puzzle');
    assertScope(lineWith(tokens, '@keydown:enter:prevent'), ':enter:prevent', 'storage.modifier.event.puzzle');
    assertScope(lineWith(tokens, '<puzzle-skeleton'), 'puzzle-skeleton', 'entity.name.tag.section.puzzle');
    assertScope(lineWith(tokens, '1...4'), '1', 'constant.numeric.decimal.js');
    assertScope(lineWith(tokens, '1...4'), '...', 'keyword.operator.range.puzzle');
    assertScope(lineWith(tokens, '1...4'), '4', 'constant.numeric.decimal.js');
    assertScope(lineWith(tokens, 'interface Item'), 'interface', 'storage.type.interface.ts');
    assertScope(lineWith(tokens, 'color: rebeccapurple'), 'color', 'support.type.property-name.css');
    assertScope(lineWith(tokens, 'color: rebeccapurple'), 'rebeccapurple', 'support.constant.color.w3c-extended-color-name.css');

    // Template comments (D70) — inline {## ... }
    assertScope(lineWith(tokens, "apostrophe won't break"), 'apostrophe', 'comment.block.template.puzzle');
    assertNoScope(lineWith(tokens, "apostrophe won't break"), 'apostrophe', 'source.js.embedded.puzzle');
    assertScope(lineWith(tokens, 'outer { user.name } tail'), 'user.name', 'comment.block.template.puzzle');
    assertNoScope(lineWith(tokens, 'outer { user.name } tail'), 'user.name', 'source.js.embedded.puzzle');
    // text after a balanced inner {...} stays inside the same comment
    assertScope(lineWith(tokens, 'outer { user.name } tail'), 'tail', 'comment.block.template.puzzle');
    // an escaped \} does not terminate the inline comment
    assertScope(lineWith(tokens, 'escaped brace'), 'still inside', 'comment.block.template.puzzle');
    assertScope(lineWith(tokens, 'escaped brace'), '\\}', 'constant.character.escape.puzzle');

    // Template comments (D70) — block {#comment} ... {/comment}
    assertScope(lineWith(tokens, 'Raw body:'), 'interpolation', 'comment.block.puzzle');
    assertNoScope(lineWith(tokens, 'Raw body:'), 'interpolation', 'source.js.embedded.puzzle');
    assertScope(lineWith(tokens, 'Raw body:'), 'branch', 'comment.block.puzzle');
    assertNoScope(lineWith(tokens, 'Raw body:'), '{#if', 'keyword.control.conditional.puzzle');
    assertScope(lineWith(tokens, 'Raw body:'), 'html -->', 'comment.block.puzzle');
    assertNoScope(lineWith(tokens, 'Raw body:'), '<!-- html', 'comment.block.html');
    // nested {#comment} openers are balanced — outer stays open past the inner close
    assertScope(lineWith(tokens, 'nested opener'), 'nested opener', 'comment.block.puzzle');
    assertScope(lineWith(tokens, 'still commented after'), 'still commented after', 'comment.block.puzzle');
    // {#comment note text} opener trailing note is comment
    assertScope(lineWith(tokens, '{#comment note text}'), 'note text', 'comment.block.puzzle');
    assertScope(lineWith(tokens, '{#comment note text}'), 'shorthand', 'comment.block.puzzle');
    // spaced closer {/ comment } terminates the block
    assertScope(lineWith(tokens, 'spaced closer'), 'spaced closer', 'comment.block.puzzle');
    // {#commentary} is NOT a comment opener — still an invalid directive
    assertScope(lineWith(tokens, '{#commentary}'), 'commentary', 'invalid.illegal.directive.puzzle');

    // Paired composition markers (D141) — <Slot name="x">…</Slot>,
    // <Children>…</Children>, <Slot>…</Slot>, <Portal>…</Portal>. The grammar
    // resolves the four markers ahead of ordinary capitalized component tags
    // and gives them their own scope; fallback bodies stay live template
    // content.
    const namedSlot = lineWith(tokens, '<Slot name="header">');
    assertScope(namedSlot, 'Slot', 'entity.name.tag.marker.puzzle');
    // …and the paired close tag on the same line (occurrence 1 of "Slot").
    assertScope(namedSlot, 'Slot', 'entity.name.tag.marker.puzzle', 0, 1);
    // Fallback body is live template content, not inert text.
    assertScope(namedSlot, 'title', 'source.js.embedded.puzzle');
    assertScope(namedSlot, 'capitalize', 'support.function.library.puzzle');

    assertScope(lineWith(tokens, '<Children>'), 'Children', 'entity.name.tag.marker.puzzle');
    assertScope(lineWith(tokens, '</Children>'), 'Children', 'entity.name.tag.marker.puzzle');
    // Ordinary capitalized tags keep the component scope.
    assertScope(lineWith(tokens, '<Card>'), 'Card', 'entity.name.tag.component.puzzle');
    const slotFallbackIf = lineWith(tokens, 'Fallback body');
    assertScope(slotFallbackIf, 'if', 'keyword.control.conditional.puzzle');
    assertScope(slotFallbackIf, 'items.length', 'source.js.embedded.puzzle');
    assertScope(slotFallbackIf, 'ItemCard', 'entity.name.tag.component.puzzle');
    assertScope(slotFallbackIf, 'items[0]', 'source.js.embedded.puzzle');
    assertNoScope(slotFallbackIf, 'Fallback body', 'source.js.embedded.puzzle');

    const bareSlot = lineWith(tokens, '<Slot>');
    assertScope(bareSlot, 'Slot', 'entity.name.tag.marker.puzzle');
    assertScope(bareSlot, 'Slot', 'entity.name.tag.marker.puzzle', 0, 1);
    assertScope(bareSlot, 'offset', 'source.js.embedded.puzzle');
    assertScope(bareSlot, 'compact_number', 'support.function.library.puzzle');
    assertScope(bareSlot, 'svg', 'support.function.inline-svg.puzzle');
    assertNoScope(bareSlot, 'remaining', 'source.js.embedded.puzzle');

    // The self-closing forms still highlight identically.
    assertScope(lineWith(tokens, '<Children/>'), 'Children', 'entity.name.tag.marker.puzzle');
    assertScope(lineWith(tokens, '<Slot name="footer"/>'), 'Slot', 'entity.name.tag.marker.puzzle');

    // <Portal> (D144) is a marker too, and is paired-only.
    const portal = lineWith(tokens, '<Portal><p>');
    assertScope(portal, 'Portal', 'entity.name.tag.marker.puzzle');
    assertScope(portal, 'Portal', 'entity.name.tag.marker.puzzle', 0, 1);
    assertScope(portal, 'title', 'source.js.embedded.puzzle');

    // <Snippet> (D166) is the fourth marker: caller-side, paired-only, with
    // `fits` routing it to a named position and every other attribute a bare
    // parameter declaration.
    const snippet = lineWith(tokens, '<Snippet fits="row"');
    assertScope(snippet, 'Snippet', 'entity.name.tag.marker.puzzle');
    assertScope(snippet, 'Snippet', 'entity.name.tag.marker.puzzle', 0, 1);
    assertNoScope(snippet, 'Snippet', 'entity.name.tag.component.puzzle');
    assertScope(snippet, 'fits', 'entity.other.attribute-name.html');
    assertScope(snippet, 'group', 'entity.other.attribute-name.html');
    assertScope(snippet, 'user.name', 'source.js.embedded.puzzle');
    assertScope(lineWith(tokens, '<UserList users'), 'UserList', 'entity.name.tag.component.puzzle');
    // `fits` is the only valued attribute; the bare-parameter-only form is the
    // common one, and the body reads the parameter it declares.
    const bareParamSnippet = lineWith(tokens, '<Snippet tag>');
    assertScope(bareParamSnippet, 'Snippet', 'entity.name.tag.marker.puzzle');
    assertScope(bareParamSnippet, 'Snippet', 'entity.name.tag.marker.puzzle', 0, 1);
    assertScope(bareParamSnippet, 'tag', 'entity.other.attribute-name.html');
    assertScope(bareParamSnippet, 'tag.label', 'source.js.embedded.puzzle');
    // A marker hands values out per stamp: on <Slot>/<Children> a valued
    // attribute is an argument, and the paired body stays a D141 fallback.
    const argSlot = lineWith(tokens, '<Slot name="row"');
    assertScope(argSlot, 'Slot', 'entity.name.tag.marker.puzzle');
    assertScope(argSlot, 'user', 'entity.other.attribute-name.html');
    assertScope(argSlot, 'items[0]', 'source.js.embedded.puzzle');
    assertNoScope(argSlot, 'no rows', 'source.js.embedded.puzzle');
    // …the same on <Children>: every brace-valued attribute is embedded JS.
    const argChildren = lineWith(tokens, '<Children user=');
    assertScope(argChildren, 'Children', 'entity.name.tag.marker.puzzle');
    assertScope(argChildren, 'Children', 'entity.name.tag.marker.puzzle', 0, 1);
    assertScope(argChildren, 'user', 'entity.other.attribute-name.html');
    assertScope(argChildren, 'items[0]', 'source.js.embedded.puzzle');
    assertScope(argChildren, 'group', 'entity.other.attribute-name.html');
    assertScope(argChildren, 'items', 'source.js.embedded.puzzle', 0, 1);
    assertNoScope(argChildren, 'no children', 'source.js.embedded.puzzle');
    // …and a capitalized name that merely starts with a marker word is a
    // component.
    assertScope(lineWith(tokens, '<SnippetHost/>'), 'SnippetHost', 'entity.name.tag.component.puzzle');
    assertNoScope(lineWith(tokens, '<SnippetHost/>'), 'SnippetHost', 'entity.name.tag.marker.puzzle');

    // Dotted component tags — component families (D167). The whole member
    // path carries the component scope, in open, close and self-closing form.
    assertScope(lineWith(tokens, '<Frame.Wrapper class'), 'Frame.Wrapper', 'entity.name.tag.component.puzzle');
    assertScope(lineWith(tokens, '<Frame.Wrapper class'), 'Frame.Wrapper', 'entity.name.tag.component.puzzle', 12);
    assertScope(lineWith(tokens, '</Frame.Wrapper>'), 'Frame.Wrapper', 'entity.name.tag.component.puzzle');
    assertScope(lineWith(tokens, '</Frame.Wrapper>'), 'Frame.Wrapper', 'entity.name.tag.component.puzzle', 12);
    const dottedPair = lineWith(tokens, '<Frame.Content>');
    assertScope(dottedPair, 'Frame.Content', 'entity.name.tag.component.puzzle');
    assertScope(dottedPair, 'Frame.Content', 'entity.name.tag.component.puzzle', 0, 1);
    assertScope(dottedPair, 'title', 'source.js.embedded.puzzle');
    // More than one dot is a legal member path too.
    assertScope(lineWith(tokens, '<Frame.Inner.Deep/>'), 'Frame.Inner.Deep', 'entity.name.tag.component.puzzle');
    assertScope(lineWith(tokens, '<Frame.Inner.Deep/>'), 'Frame.Inner.Deep', 'entity.name.tag.component.puzzle', 15);
    // A dotted name rooted at a marker word is a component tag, not a marker:
    // markers are exact-match, so <Slot.Custom/> falls through (D167).
    assertScope(lineWith(tokens, '<Slot.Custom/>'), 'Slot.Custom', 'entity.name.tag.component.puzzle');
    assertNoScope(lineWith(tokens, '<Slot.Custom/>'), 'Slot.Custom', 'entity.name.tag.marker.puzzle');

    // Lowercase markers are compile errors (D134).
    assertScope(lineWith(tokens, '<slot name="nope">'), 'slot', 'invalid.illegal.marker.puzzle');
    assertScope(lineWith(tokens, '<children>'), 'children', 'invalid.illegal.marker.puzzle');
    assertScope(lineWith(tokens, '<children>'), 'children', 'invalid.illegal.marker.puzzle', 0, 1);
    assertScope(lineWith(tokens, '<portal>'), 'portal', 'invalid.illegal.marker.puzzle');
    // …but a tag that merely starts with a marker name is ordinary HTML.
    assertScope(lineWith(tokens, '<slot-machine'), 'slot-machine', 'entity.name.tag.html');
    assertNoScope(lineWith(tokens, '<slot-machine'), 'slot-machine', 'invalid.illegal.marker.puzzle');

    // The \{ / \} brace escape. In text and in attribute values a backslashed
    // brace is a literal character, so it must NOT open an interpolation or a
    // directive — and the live constructs around it stay live.
    const textEscape = lineWith(tokens, 'literally, then');
    assertScope(textEscape, '\\{', 'constant.character.escape.puzzle');
    assertScope(textEscape, '\\}', 'constant.character.escape.puzzle');
    assertNoScope(textEscape, 'braces', 'source.js.embedded.puzzle');
    assertNoScope(textEscape, '\\{', 'punctuation.section.embedded.begin.puzzle');
    assertScope(textEscape, 'title', 'source.js.embedded.puzzle');

    const attrEscape = lineWith(tokens, 'pattern="[0-9]');
    assertScope(attrEscape, '\\{', 'constant.character.escape.puzzle');
    assertScope(attrEscape, '\\}', 'constant.character.escape.puzzle');
    assertScope(attrEscape, '[0-9]', 'string.quoted.double.html');
    assertNoScope(attrEscape, 'inertInAttr', 'source.js.embedded.puzzle');

    // An escaped brace beats the directive rule too.
    const escapedDirective = lineWith(tokens, 'notADirective');
    assertScope(escapedDirective, '\\{', 'constant.character.escape.puzzle');
    assertNoScope(escapedDirective, 'notADirective', 'keyword.control.conditional.puzzle');
    assertNoScope(escapedDirective, 'notADirective', 'invalid.illegal.directive.puzzle');
    assertNoScope(escapedDirective, 'notAnInterpolation', 'source.js.embedded.puzzle');

    // {#for} range forms: `{#for 1...5}` is the sanctioned spelling and
    // `{#for i in 1...5}` is a 0.7.0 compile error steering to it. Neither may
    // derail the grammar — the `...` stays the range operator either way.
    const rangeOnly = lineWith(tokens, 'range only');
    assertScope(rangeOnly, 'for', 'keyword.control.loop.puzzle');
    assertScope(rangeOnly, '...', 'keyword.operator.range.puzzle');
    assertScope(rangeOnly, '1', 'constant.numeric.decimal.js');
    assertScope(rangeOnly, 'b', 'entity.name.tag.html');
    assertNoScope(rangeOnly, 'range only', 'source.js.embedded.puzzle');

    const steeredRange = lineWith(tokens, 'steered range');
    assertScope(steeredRange, 'for', 'keyword.control.loop.puzzle');
    assertScope(steeredRange, '...', 'keyword.operator.range.puzzle');
    assertScope(steeredRange, '1', 'constant.numeric.decimal.js');
    assertScope(steeredRange, 'b', 'entity.name.tag.html');
    assertNoScope(steeredRange, 'steered range', 'source.js.embedded.puzzle');

    // Directive attributes: key, island, ref, flip.
    const directiveAttrs = lineWith(tokens, 'listRoot');
    assertScope(directiveAttrs, 'ref', 'keyword.control.directive.puzzle');
    assertScope(directiveAttrs, 'listRoot', 'variable.other.ref.puzzle');
    assertScope(directiveAttrs, 'island', 'keyword.control.directive.puzzle');
    assertScope(directiveAttrs, 'key', 'keyword.control.directive.puzzle');
    assertScope(directiveAttrs, 'items[0]', 'source.js.embedded.puzzle');
    assertScope(directiveAttrs, 'flip', 'keyword.control.directive.puzzle');

    const directiveAttrs2 = lineWith(tokens, 'not-a-directive');
    assertScope(directiveAttrs2, 'flip', 'keyword.control.directive.puzzle');
    assertScope(directiveAttrs2, 'offset', 'source.js.embedded.puzzle');
    assertScope(directiveAttrs2, 'key', 'keyword.control.directive.puzzle');
    // The interpolated key= form stays live.
    assertScope(directiveAttrs2, 'offset', 'source.js.embedded.puzzle', 0, 1);
    // data-island is a plain attribute, not the island directive.
    assertNoScope(directiveAttrs2, 'data-island', 'keyword.control.directive.puzzle');
    assertNoScope(directiveAttrs2, 'island', 'keyword.control.directive.puzzle');

    // The `outside` event modifier (D86).
    assertScope(lineWith(tokens, '@click:outside'), ':outside', 'storage.modifier.event.puzzle');
    assertNoScope(lineWith(tokens, '@click:outside'), ':outside', 'invalid.illegal.event-modifier.puzzle');

    // {#raw} … {/raw} (D150): braces are inert, HTML stays structural.
    const rawOpen = lineWith(tokens, '{#raw}');
    assertScope(rawOpen, 'raw', 'keyword.control.raw.puzzle');
    assertNoScope(rawOpen, 'raw', 'invalid.illegal.directive.puzzle');

    const rawText = lineWith(tokens, 'Inert braces');
    assertScope(rawText, 'notInterpolated', 'meta.raw.puzzle');
    assertNoScope(rawText, 'notInterpolated', 'source.js.embedded.puzzle');
    assertNoScope(rawText, 'branchless', 'source.js.embedded.puzzle');
    assertNoScope(rawText, 'never', 'keyword.control.conditional.puzzle');
    assertNoScope(rawText, 'notAFunction', 'support.function.library.puzzle');
    assertNoScope(rawText, 'notAFunction', 'source.js.embedded.puzzle');
    assertNoScope(rawText, '|', 'invalid.illegal.pipe.puzzle');

    const rawHtml = lineWith(tokens, 'structural html');
    assertScope(rawHtml, 'b', 'entity.name.tag.html');
    assertScope(rawHtml, 'class', 'entity.other.attribute-name.html');
    // Markers inside a raw body are plain elements, not markers.
    assertScope(rawHtml, 'Slot', 'entity.name.tag.html');
    assertNoScope(rawHtml, 'Slot', 'entity.name.tag.marker.puzzle');
    assertScope(rawHtml, 'Portal', 'entity.name.tag.html');
    assertNoScope(rawHtml, 'Portal', 'entity.name.tag.marker.puzzle');

    const rawDirectives = lineWith(tokens, 'literalRef');
    assertScope(rawDirectives, 'Card', 'entity.name.tag.html');
    assertScope(rawDirectives, 'ref', 'entity.other.attribute-name.html');
    assertNoScope(rawDirectives, 'ref', 'keyword.control.directive.puzzle');
    assertNoScope(rawDirectives, 'island', 'keyword.control.directive.puzzle');
    assertNoScope(rawDirectives, 'flip', 'keyword.control.directive.puzzle');

    const rawEvent = lineWith(tokens, 'inert binding');
    assertScope(rawEvent, '@click', 'entity.other.attribute-name.html');
    assertNoScope(rawEvent, '@', 'keyword.operator.event.puzzle');
    assertScope(rawEvent, 'notAnEvent', 'string.unquoted.html');
    assertNoScope(rawEvent, 'notAnEvent', 'source.js.embedded.puzzle');

    // The brace escape must NOT leak into a raw body: lexRawText does no
    // backslash handling, so \{ there is a backslash plus a literal brace.
    const rawBackslash = lineWith(tokens, 'noEscapeHere');
    assertScope(rawBackslash, '\\{', 'meta.raw.puzzle');
    assertNoScope(rawBackslash, '\\{', 'constant.character.escape.puzzle');
    assertNoScope(rawBackslash, '\\}', 'constant.character.escape.puzzle');
    assertNoScope(rawBackslash, 'noEscapeHere', 'source.js.embedded.puzzle');

    // {#raw json}: content after the keyword is legal and ignored, and the
    // closer tolerates whitespace ({/ raw }).
    const rawHint = lineWith(tokens, '{#raw json}');
    assertScope(rawHint, 'json', 'comment.block.raw-hint.puzzle');
    assertNoScope(rawHint, 'json', 'source.js.embedded.puzzle');
    assertNoScope(rawHint, 'hint', 'source.js.embedded.puzzle');
    assertScope(rawHint, 'raw', 'keyword.control.raw.puzzle', 0, 1);

    // Puzzle grammar RESUMES after the closer. A greedy raw rule swallows the
    // rest of the line and silently kills every construct after it, so assert
    // both halves: inert inside, live outside.
    const rawResume = lineWith(tokens, 'liveAgain');
    assertScope(rawResume, 'inertAfterHint', 'meta.raw.puzzle');
    assertNoScope(rawResume, 'inertAfterHint', 'source.js.embedded.puzzle');
    assertScope(rawResume, 'liveAgain', 'source.js.embedded.puzzle');
    assertNoScope(rawResume, 'liveAgain', 'meta.raw.puzzle');

    // Raw blocks do NOT nest: the first closer wins, so the inner {#raw} is
    // body text and " liveTail" is ordinary template text, not raw.
    const rawNonNesting = lineWith(tokens, 'nonNesting');
    assertScope(rawNonNesting, 'outer', 'meta.raw.puzzle');
    assertScope(rawNonNesting, 'nonNesting', 'meta.raw.puzzle');
    assertNoScope(rawNonNesting, 'liveTail', 'meta.raw.puzzle');

    // {#raw} is a compile error inside an attribute value.
    const rawInAttr = lineWith(tokens, 'illegal in attribute');
    assertScope(rawInAttr, 'raw', 'invalid.illegal.raw-in-attribute.puzzle');
    assertScope(rawInAttr, 'raw', 'invalid.illegal.raw-in-attribute.puzzle', 0, 1);
    assertScope(rawInAttr, 'illegal in attribute', 'string.quoted.double.html');

    const edgeCases = tokenize(grammar, `<puzzle-view>
  <button @click.prevent={ go } @click:bogus={ go }></button>
  {:elsif stale}
  { count || fallback }
  {#unless done}spaced closer{/ unless }
  {#rawish}
</puzzle-view>
<script>
const fakeClose = "</script>";
const stillJavaScript = true;
</script>`);

    assertScope(lineWith(edgeCases, '@click.prevent'), '.prevent', 'invalid.illegal.event-modifier.puzzle');
    assertScope(lineWith(edgeCases, '@click:bogus'), ':bogus', 'invalid.illegal.event-modifier.puzzle');
    assertScope(lineWith(edgeCases, '{:elsif'), 'elsif', 'invalid.illegal.directive.puzzle');
    assertScope(lineWith(edgeCases, 'count || fallback'), '||', 'keyword.operator.logical.js');
    assertScope(lineWith(edgeCases, 'stillJavaScript'), 'stillJavaScript', 'source.js.embedded.puzzle');
    // Closers tolerate whitespace.
    assertScope(lineWith(edgeCases, '{/ unless }'), 'unless', 'keyword.control.end.puzzle', 0, 1);
    // A keyword that merely starts with `raw` is not the raw block.
    assertScope(lineWith(edgeCases, '{#rawish}'), 'rawish', 'invalid.illegal.directive.puzzle');

    // ---------------------------------------------------------------------
    // The Puzzle 0.8.0 expression language (D176). Template expressions are
    // JavaScript-shaped and highlight with the JavaScript grammar; the grammar
    // adds four rules on top and leaves everything else (method-table
    // membership, the excluded operators, `.size`) to the compiler.
    // ---------------------------------------------------------------------
    const PIPE = 'invalid.illegal.pipe.puzzle';
    const THIS = 'invalid.illegal.this.puzzle';
    const MARKUP = 'invalid.illegal.markup-function.puzzle';
    const LIBRARY = 'support.function.library.puzzle';

    // Rule 1: JavaScript expressions. Library calls, methods, arrow functions
    // as arguments, template literals, object and array literals, `??`, `?.`.
    const jsShaped = tokenize(grammar, `<puzzle-view>
  <p>{ currency(price) } { truncate(post.body, 120) } { capitalize(name.trim()) } nestedTail</p>
  <p>{ t('cart.count', { count: cart.items.length }) } { pluralize(n, 'item') } tTail</p>
  <p>{ date(d, 'short') } { time(in_timezone(d, zone)) } { datetime(d) } { timeago(d) } dateTail</p>
  {#for t in todos.filter(t => !t.done)}<i>{ t.title }</i>{/for}
  {#if items.length}<b>{ items.at(-1).name.toUpperCase() }</b>{/if}
  <p>{ \`\${first} \${last}\` } { [a, b].join(', ') } { subtitle ?? 'Untitled' } { user?.name } litTail</p>
  <a href={ link('/posts/' + post.id) } title={ round(ratio, 2) }>{ json(data) }</a>
  <p>{ x.date() } { currencyish(price) } { my_currency(price) } { $date(x) } { date } notLibrary</p>
  <p>{ Math.round(x / 2) } { Object.keys(o).length } { Number(x).toFixed(2) } globalsTail</p>
</puzzle-view>`);

    const nestedCalls = lineWith(jsShaped, 'nestedTail');
    assertScope(nestedCalls, 'currency', LIBRARY);
    assertScope(nestedCalls, 'truncate', LIBRARY);
    assertScope(nestedCalls, 'capitalize', LIBRARY);
    assertScope(nestedCalls, 'trim', 'entity.name.function.js');
    assertNoScope(nestedCalls, 'trim', LIBRARY);
    assertScope(nestedCalls, '120', 'constant.numeric.decimal.js');
    assertNoScope(nestedCalls, 'nestedTail', 'source.js.embedded.puzzle');

    const tCall = lineWith(jsShaped, 'tTail');
    assertScope(tCall, 't(', LIBRARY);
    assertScope(tCall, "'cart.count'", 'string.quoted.single.js');
    assertScope(tCall, 'count:', 'meta.object-literal.key.js');
    assertScope(tCall, 'pluralize', LIBRARY);
    // The object literal closes before the interpolation does.
    assertNoScope(tCall, 'tTail', 'source.js.embedded.puzzle');

    const dates = lineWith(jsShaped, 'dateTail');
    for (const name of ['date', 'time', 'in_timezone', 'datetime', 'timeago']) {
        assertScope(dates, `${name}(`, LIBRARY);
    }
    assertScope(dates, "'short'", 'string.quoted.single.js');

    const forArrow = lineWith(jsShaped, 'todos.filter');
    assertScope(forArrow, 'filter', 'entity.name.function.js');
    assertScope(forArrow, '=>', 'storage.type.function.arrow.js');
    assertScope(forArrow, 't.title', 'source.js.embedded.puzzle');
    const methods = lineWith(jsShaped, 'items.at(-1)');
    assertScope(methods, 'length', 'support.variable.property.js');
    assertScope(methods, 'toUpperCase', 'entity.name.function.js');

    const literals = lineWith(jsShaped, 'litTail');
    assertScope(literals, '`', 'string.template.js');
    assertScope(literals, 'first', 'meta.template.expression.js');
    assertScope(literals, '[a, b]', 'meta.array.literal.js');
    assertScope(literals, '??', 'keyword.operator.logical.js');
    assertScope(literals, '?.', 'punctuation.accessor.optional.js');
    assertNoScope(literals, 'litTail', 'source.js.embedded.puzzle');

    const attrLibrary = lineWith(jsShaped, "link('/posts/'");
    assertScope(attrLibrary, 'link', LIBRARY);
    assertScope(attrLibrary, 'round', LIBRARY);
    assertScope(attrLibrary, 'json', LIBRARY);

    // Only a bare call to an exact library name is a library call.
    const notLibrary = lineWith(jsShaped, 'notLibrary');
    for (const needle of ['date()', 'currencyish', 'my_currency', '$date', 'date }']) {
        assertNoScope(notLibrary, needle, LIBRARY);
    }
    const globals = lineWith(jsShaped, 'globalsTail');
    assertScope(globals, 'Math', 'source.js.embedded.puzzle');
    assertNoScope(globals, 'round', LIBRARY);
    assertScope(globals, 'toFixed', 'entity.name.function.js');

    // Rule 2: there is no `|` in a template expression — no pipe and no
    // bitwise OR — in any position. `||` and a `|` inside a string or
    // template-literal text are not flagged.
    const pipes = tokenize(grammar, `<puzzle-view>
  <p>{ price | currency } { f(a | b) } { [a | b] } { ({ k: a | b }).k } textPipes</p>
  <p>{ items.map(x => x | 1) } { \`\${a | b}\` } substitutionPipe</p>
  <a title={ a | b } data-x="{ c | d }" style="width:{ w | 0 }px">attrPipes</a>
  <Card total={ n | currency } /><Slot name="row" item={ a | b }>markerPipe</Slot>
  <li key={ id | x } flip={ f | g }>keyPipes</li>
  {#if a | b}x{:else if c | d}y{/if}{#unless e | f}z{/unless}{#case g | h}{:when i | j}w{/case}headerPipes
  {#for item in items | sort}{/for}<b class="{#if tags | size}t{/if}">forPipe</b>
  <button @click={ save(a | b) } @input={ flags |= 1 }>handlerPipes</button>
  { total &&
    ready | done } multiLinePipe
  <p>{ a || b } { a ||= b } { 'a | b' } { "c|d" } { \`e | f\` } { \`\${'g|h'}\` } notPipes</p>
</puzzle-view>
<script>
const mask = a | b;
</script>
<style>
.a { content: "|"; }
</style>`);

    const textPipes = lineWith(pipes, 'textPipes');
    for (let i = 0; i < 4; i += 1) assertScope(textPipes, '|', PIPE, 0, i);
    assertNoScope(textPipes, 'currency', LIBRARY);
    const substitutionPipe = lineWith(pipes, 'substitutionPipe');
    assertScope(substitutionPipe, '|', PIPE);
    assertScope(substitutionPipe, '|', PIPE, 0, 1);
    const attrPipes = lineWith(pipes, 'attrPipes');
    for (let i = 0; i < 3; i += 1) assertScope(attrPipes, '|', PIPE, 0, i);
    const markerPipe = lineWith(pipes, 'markerPipe');
    assertScope(markerPipe, '|', PIPE);
    assertScope(markerPipe, '|', PIPE, 0, 1);
    const keyPipes = lineWith(pipes, 'keyPipes');
    assertScope(keyPipes, '|', PIPE);
    assertScope(keyPipes, '|', PIPE, 0, 1);
    const headerPipes = lineWith(pipes, 'headerPipes');
    for (let i = 0; i < 5; i += 1) assertScope(headerPipes, '|', PIPE, 0, i);
    const forPipe = lineWith(pipes, 'forPipe');
    assertScope(forPipe, '|', PIPE);
    assertScope(forPipe, '|', PIPE, 0, 1);
    assertNoScope(forPipe, 'forPipe', 'source.js.embedded.puzzle');
    const handlerPipes = lineWith(pipes, 'handlerPipes');
    assertScope(handlerPipes, '|', PIPE);
    assertScope(handlerPipes, '|', PIPE, 0, 1);
    assertScope(lineWith(pipes, 'ready | done'), '|', PIPE);
    const notPipes = lineWith(pipes, 'notPipes');
    assertScope(notPipes, '||', 'keyword.operator.logical.js');
    assertNoScope(notPipes, '||', PIPE);
    assertNoScope(notPipes, '||', PIPE, 0, 1);
    for (const needle of ["'a | b'", '"c|d"', '`e | f`', "'g|h'"]) {
        assertNoScope(notPipes, needle, PIPE, needle.indexOf('|'));
    }
    // <script> and <style> are untouched.
    assertNoScope(lineWith(pipes, 'const mask'), '|', PIPE);
    assertNoScope(lineWith(pipes, 'content:'), '|', PIPE);
    // Plain template text is not an expression.
    const plainText = tokenize(grammar, '<puzzle-view><p>Home | About</p></puzzle-view>');
    assertNoScope(plainText[0], '|', PIPE);

    // Rule 3: `this` is not a template identifier, handlers included. A
    // member named `this` and an object key are ordinary names.
    const thisTokens = tokenize(grammar, `<puzzle-view>
  <p>{ this } { this.x } { f(this) } { user.name + this?.y } { (this) } { this[k] } textThis</p>
  <p class={ this.cls } data-x="{ this.x }">attrThis</p>
  {#if this.ready}r{/if}{#for i in this.items}{/for}headerThis
  <button @click={ this.save() } @input={ save(this) }>handlerThis</button>
  <p>{ a ? this : b } ternaryThis</p>
  <p>{ a.this } { a?.this } { ({ this: 1 }).this } { thisValue } { $this } { _this } okThis</p>
</puzzle-view>
<script>
this.ready = true;
</script>`);
    const textThis = lineWith(thisTokens, 'textThis');
    for (let i = 0; i < 6; i += 1) assertScope(textThis, 'this', THIS, 0, i);
    const attrThis = lineWith(thisTokens, 'attrThis');
    assertScope(attrThis, 'this', THIS);
    assertScope(attrThis, 'this', THIS, 0, 1);
    const headerThis = lineWith(thisTokens, 'headerThis');
    assertScope(headerThis, 'this', THIS);
    assertScope(headerThis, 'this', THIS, 0, 1);
    const handlerThis = lineWith(thisTokens, 'handlerThis');
    assertScope(handlerThis, 'this', THIS);
    assertScope(handlerThis, 'this', THIS, 0, 1);
    assertScope(lineWith(thisTokens, 'ternaryThis'), 'this', THIS);
    const okThis = lineWith(thisTokens, 'okThis');
    for (let i = 0; i < 4; i += 1) assertNoScope(okThis, 'this', THIS, 0, i);
    for (const needle of ['thisValue', '$this', '_this']) assertNoScope(okThis, needle, THIS, needle.indexOf('this'));
    assertNoScope(lineWith(thisTokens, 'this.ready = true'), 'this', THIS);

    // Rule 4: `raw(…)` and `newline_to_br(…)` only as the whole (outermost
    // call) of a text interpolation.
    const markup = tokenize(grammar, `<puzzle-view>
  <article>{ raw(post.bodyHtml) }</article><p>{newline_to_br(note)} {  raw ( html ) } legalMarkup</p>
  <p>{ raw(
    post.bodyHtml) } multiLineRaw</p>
  <p>{ truncate(raw(html), 20) } { raw(raw(html)) } { strip_html(newline_to_br(note)) } nestedMarkup</p>
  <a title={ raw(html) } href="{ newline_to_br(x) }" style="color:{ raw(tone) }">attrMarkup</a>
  <Card body={ raw(html) } /><Slot name="row" item={ newline_to_br(note) }>{ raw(html) } markerMarkup</Slot>
  <li key={ raw(id) } flip={ newline_to_br(f) }>keyMarkup</li>
  <button @click={ raw(x) }>handlerMarkup</button>
  <p>{ draft || raw } { x.raw(y) } { rawish(y) } { raw_text(y) } { 'raw(x)' } notMarkup</p>
</puzzle-view>`);

    const legalMarkup = lineWith(markup, 'legalMarkup');
    assertScope(legalMarkup, 'raw', LIBRARY);
    assertNoScope(legalMarkup, 'raw', MARKUP);
    assertScope(legalMarkup, 'raw', 'source.js.embedded.puzzle');
    assertScope(legalMarkup, 'bodyHtml', 'source.js.embedded.puzzle');
    assertScope(legalMarkup, 'newline_to_br', LIBRARY);
    assertScope(legalMarkup, 'raw', LIBRARY, 0, 1);
    assertNoScope(legalMarkup, 'legalMarkup', 'source.js.embedded.puzzle');
    assertScope(lineWith(markup, '{ raw('), 'raw', LIBRARY);
    assertScope(lineWith(markup, 'multiLineRaw'), 'bodyHtml', 'source.js.embedded.puzzle');
    assertNoScope(lineWith(markup, 'multiLineRaw'), 'multiLineRaw', 'source.js.embedded.puzzle');

    const nestedMarkup = lineWith(markup, 'nestedMarkup');
    assertScope(nestedMarkup, 'truncate', LIBRARY);
    assertScope(nestedMarkup, 'raw', MARKUP);
    assertScope(nestedMarkup, 'raw', LIBRARY, 0, 1);
    assertScope(nestedMarkup, 'raw', MARKUP, 0, 2);
    assertScope(nestedMarkup, 'newline_to_br', MARKUP);

    for (const [needle, count] of [
        ['attrMarkup', 3],
        ['markerMarkup', 2],
        ['keyMarkup', 2],
        ['handlerMarkup', 1]
    ]) {
        const line = lineWith(markup, needle);
        const names = [...line.line.matchAll(/\b(?:raw|newline_to_br)(?=\()/g)];
        assert(names.length >= count, `expected ${count} markup calls in ${needle}`);
        for (let i = 0; i < count; i += 1) {
            const column = names[i].index;
            const token = line.tokens.find(t => t.startIndex <= column && column < t.endIndex);
            assert(token.scopes.includes(MARKUP), `${needle}: call ${i} missing ${MARKUP}\nScopes: ${token.scopes.join(' ')}`);
        }
    }
    // The marker's fallback body is text again, where a whole `raw(…)` is legal.
    const markerMarkup = lineWith(markup, 'markerMarkup');
    assertScope(markerMarkup, 'raw', LIBRARY, 0, 1);
    assertNoScope(markerMarkup, 'raw', MARKUP, 0, 1);

    const notMarkup = lineWith(markup, 'notMarkup');
    for (const needle of ['raw }', 'raw(y)', 'rawish', 'raw_text', "raw(x)'"]) {
        assertNoScope(notMarkup, needle, MARKUP);
    }

    // Everything else is the compiler's: method-table membership, excluded
    // operators and `.size` highlight as plain JavaScript.
    const compilerRules = tokenize(grammar, `<puzzle-view>
  <p>{ items.size } { a.foo() } { a ** 2 } { new Date() } { typeof x } { a & b } { count++ } { a = 1 } compilerTail</p>
</puzzle-view>`);
    const compilerLine = lineWith(compilerRules, 'compilerTail');
    assert(
        !compilerLine.tokens.some(token => token.scopes.some(scope => scope.startsWith('invalid.'))),
        'compiler-only rules must not be flagged by the grammar'
    );

    // ---------------------------------------------------------------------
    // Conformance: every VALID case of puzzle-lang's expressions-parse.json
    // tokenizes with no invalid scope, in text, in a brace-only attribute and
    // (for handler cases) in an @event value; and the interpolation closes
    // where it should. The invalid cases for rules 2 and 3 are flagged.
    // test/fixtures/expressions-parse.json is a copy of
    // packages/puzzle-lang/conformance/expressions-parse.json;
    // PUZZLE_CONFORMANCE points the test at another copy.
    // ---------------------------------------------------------------------
    const conformancePath = process.env.PUZZLE_CONFORMANCE || path.join(__dirname, 'fixtures', 'expressions-parse.json');
    const conformance = JSON.parse(fs.readFileSync(conformancePath, 'utf8')).cases;

    function wrapCase(testCase, position) {
        const source = testCase.argument ? `f(${testCase.src})` : testCase.src;
        if (testCase.handler) return `<button @click={ ${source} }>ENDMARK</button>`;
        if (position === 'attribute') return `<b title={ ${source} }>ENDMARK</b>`;
        return `<p>{ ${source} }ENDMARK</p>`;
    }

    function tokenizeCase(testCase, position) {
        const entries = tokenize(grammar, `<puzzle-view>\n${wrapCase(testCase, position)}\n</puzzle-view>`);
        return entries.slice(1, -1);
    }

    let validCount = 0;
    for (const testCase of conformance.filter(c => c.ok)) {
        for (const position of testCase.handler ? ['handler'] : ['text', 'attribute']) {
            const entries = tokenizeCase(testCase, position);
            for (const entry of entries) {
                for (const token of entry.tokens) {
                    const bad = token.scopes.find(scope => scope.startsWith('invalid.'));
                    assert(!bad, `conformance "${testCase.name}" (${position}): ${JSON.stringify(entry.line.slice(token.startIndex, token.endIndex))} has ${bad}`);
                }
            }
            const last = entries[entries.length - 1];
            assertNoScope(last, 'ENDMARK', 'source.js.embedded.puzzle');
        }
        validCount += 1;
    }
    assert(validCount > 150, `expected the valid conformance cases, found ${validCount}`);

    function flagged(testCase, needle, scope, occurrence = 0) {
        for (const position of ['text', 'attribute']) {
            const entries = tokenizeCase(testCase, position);
            const entry = entries.find(e => e.line.includes(needle)) || entries[0];
            assertScope(entry, needle, scope, 0, occurrence);
        }
    }
    const invalidCases = conformance.filter(c => !c.ok);
    const bySrc = src => {
        const found = invalidCases.find(c => c.src === src);
        assert(found, `conformance case ${JSON.stringify(src)} not found`);
        return found;
    };
    flagged(bySrc('a | b'), '|', PIPE);
    flagged(bySrc('f(a | b)'), '|', PIPE);
    flagged(bySrc('a &&\n    b | c'), '|', PIPE);
    flagged(bySrc('this'), 'this', THIS);
    flagged(bySrc('user.name + this.x'), 'this', THIS);
    flagged(bySrc('f(this)'), 'this', THIS);
    flagged(bySrc('{ this }'), 'this', THIS);
    flagged(bySrc('items.map(this => 1)'), 'this', THIS);
    // Every invalid case whose error is about `|` or `this` is flagged.
    for (const testCase of invalidCases) {
        const pipeError = /the `\|` operator/.test(testCase.error);
        const thisError = /^`this` is not available/.test(testCase.error);
        if (!pipeError && !thisError) continue;
        const entries = tokenizeCase(testCase, 'text');
        const scope = pipeError ? PIPE : THIS;
        assert(
            entries.some(entry => entry.tokens.some(token => token.scopes.includes(scope))),
            `conformance "${testCase.name}" should carry ${scope}`
        );
    }

    console.log('Puzzle TextMate grammar tests passed');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

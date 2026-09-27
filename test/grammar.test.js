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
    assertScope(lineWith(tokens, '| trim'), 'trim', 'variable.function.formatter.puzzle');
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
    assertScope(namedSlot, 'capitalize', 'variable.function.formatter.puzzle');

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
    assertScope(bareSlot, 'number', 'variable.function.formatter.puzzle');
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
    assertNoScope(rawText, 'notAFormatter', 'variable.function.formatter.puzzle');
    assertNoScope(rawText, '|', 'keyword.operator.formatter.puzzle');

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
  {#if flags | mask}<span>bitwise</span>{/if}
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
    assertNoScope(lineWith(edgeCases, 'count || fallback'), '||', 'keyword.operator.formatter.puzzle');
    // 0.8.0 (D173 V1): condition headers take no formatter chain, so a
    // top-level `|` in an {#if} header is a compile error — neither a pipe
    // nor a bitwise OR.
    assertScope(lineWith(edgeCases, 'flags | mask'), '|', 'invalid.illegal.formatter-pipe.puzzle');
    assertNoScope(lineWith(edgeCases, 'flags | mask'), '|', 'keyword.operator.formatter.puzzle');
    assertNoScope(lineWith(edgeCases, 'flags | mask'), 'mask', 'variable.function.formatter.puzzle');
    assertScope(lineWith(edgeCases, 'stillJavaScript'), 'stillJavaScript', 'source.js.embedded.puzzle');
    // Closers tolerate whitespace.
    assertScope(lineWith(edgeCases, '{/ unless }'), 'unless', 'keyword.control.end.puzzle', 0, 1);
    // A keyword that merely starts with `raw` is not the raw block.
    assertScope(lineWith(edgeCases, '{#rawish}'), 'rawish', 'invalid.illegal.directive.puzzle');

    // 0.8.0 (D173 V1): a formatter chain is legal in every value position —
    // text, brace-only attributes, component props and marker arguments. The
    // {#if}/{:else if}/{#unless}/{#case} condition headers, inline attribute
    // ifs included, take no formatter chain: a top-level `|` there is a compile
    // error, exactly like a pipe in a {#for} header or a {:when} value.
    // `@event` handler bodies are JavaScript, so a pipe there stays bitwise.
    const valuePipes = tokenize(grammar, `<puzzle-view>
  <a title={ price | currency } data-or={ a || b }>link</a>
  <Card total={ n | currency('$', 0) } />
  <Frame.Wrapper label={ name | truncate(20) } />
  <Children user={ user | upcase }>{ user.name }</Children>
  <input key={ id | downcase } value={ name | upcase } />
  {#if post.tags | size}tagged{:else if draft | blank-ish}draft{/if}
  {#unless items | size}empty{/unless}
  {#case status | downcase}{:when 'paid', 'shipped'}ok{/case}
  <b class="btn {#if tags | size}has-tags{/if}">b</b>
  {#if a || b}either{:else if c || d}other{/if}
  {#unless x || y}neither{/unless}
  {#case a || b}{:when 1}one{/case}
  <i class="{#if a || b}on{/if}">i</i>
  {#if (bits | flag)}masked{:else if [a | b][0]}indexed{/if}
  {#if ready |
    size}wrapped{/if}
  <button @click={ a | b } @keyup={ save({ id: todo.id }) }>go</button>
  { 'greeting' | t({ name: user.name }) } afterText
  { photo | resize({ height: 480 }) } tailText
  { fn({ a: 1 }) } plainTail
  { (flags | mask) } { count || fallback }
  { w / 2 | 0 } { a |= 2 }
  {#for item in items | sort}{/for}
  {#case kind}{:when 'a' | x}bad{/case}
  { total |
    currency }
  <pre>
    keep   { spaced | trim }   exactly
  </pre>
  <textarea>
  { draft }
  </textarea>
</puzzle-view>`);

    const attrPipe = lineWith(valuePipes, 'title={ price');
    assertScope(attrPipe, '|', 'keyword.operator.formatter.puzzle');
    assertScope(attrPipe, 'currency', 'variable.function.formatter.puzzle');
    assertScope(attrPipe, '||', 'keyword.operator.logical.js');
    assertNoScope(attrPipe, '||', 'keyword.operator.formatter.puzzle');
    assertNoScope(attrPipe, '||', 'invalid.illegal.formatter-pipe.puzzle');

    const propPipe = lineWith(valuePipes, '<Card total');
    assertScope(propPipe, '|', 'keyword.operator.formatter.puzzle');
    assertScope(propPipe, 'currency', 'variable.function.formatter.puzzle');
    assertScope(propPipe, "'$'", 'string.quoted.single.js');
    assertScope(lineWith(valuePipes, '<Frame.Wrapper'), 'truncate', 'variable.function.formatter.puzzle');
    const markerArgPipe = lineWith(valuePipes, '<Children user');
    assertScope(markerArgPipe, 'Children', 'entity.name.tag.marker.puzzle');
    assertScope(markerArgPipe, 'upcase', 'variable.function.formatter.puzzle');
    const directivePipe = lineWith(valuePipes, '<input key');
    assertScope(directivePipe, 'key', 'keyword.control.directive.puzzle');
    assertScope(directivePipe, 'downcase', 'variable.function.formatter.puzzle');
    assertScope(directivePipe, 'upcase', 'variable.function.formatter.puzzle');

    // Condition headers: the `|` is illegal and what follows is not a
    // formatter name — the {#if}, {:else if}, {#unless} and {#case} forms.
    const ifPipe = lineWith(valuePipes, '{#if post.tags');
    assertScope(ifPipe, '|', 'invalid.illegal.formatter-pipe.puzzle');
    assertNoScope(ifPipe, '|', 'keyword.operator.formatter.puzzle');
    assertNoScope(ifPipe, 'size', 'variable.function.formatter.puzzle');
    assertScope(ifPipe, 'else', 'keyword.control.conditional.else.puzzle');
    assertScope(ifPipe, '|', 'invalid.illegal.formatter-pipe.puzzle', 0, 1);
    assertNoScope(ifPipe, 'blank-ish', 'variable.function.formatter.puzzle');
    // The header still closes at its brace: the branch body is template text.
    assertNoScope(ifPipe, '}draft{', 'source.js.embedded.puzzle', 1);
    const unlessPipe = lineWith(valuePipes, '{#unless items');
    assertScope(unlessPipe, '|', 'invalid.illegal.formatter-pipe.puzzle');
    assertNoScope(unlessPipe, 'size', 'variable.function.formatter.puzzle');
    const casePipe = lineWith(valuePipes, '{#case status');
    assertScope(casePipe, '|', 'invalid.illegal.formatter-pipe.puzzle');
    assertNoScope(casePipe, 'downcase', 'variable.function.formatter.puzzle');
    assertNoScope(casePipe, 'shipped', 'invalid.illegal.formatter-pipe.puzzle');

    // …and the inline {#if} inside a quoted attribute value.
    const inlineIfPipe = lineWith(valuePipes, 'has-tags');
    assertScope(inlineIfPipe, '|', 'invalid.illegal.formatter-pipe.puzzle');
    assertNoScope(inlineIfPipe, 'size', 'variable.function.formatter.puzzle');
    assertScope(inlineIfPipe, 'size', 'string.quoted.double.html');
    assertNoScope(inlineIfPipe, 'has-tags', 'source.js.embedded.puzzle');

    // `||` in a condition header is logical OR: never a pipe, never illegal.
    for (const [needle, occurrences] of [
        ['{#if a || b}either', 2],
        ['{#unless x || y}', 1],
        ['{#case a || b}', 1],
        ['<i class="{#if a || b}', 1]
    ]) {
        const line = lineWith(valuePipes, needle);
        for (let i = 0; i < occurrences; i += 1) {
            assertScope(line, '||', 'keyword.operator.logical.js', 0, i);
            assertNoScope(line, '||', 'keyword.operator.formatter.puzzle', 0, i);
            assertNoScope(line, '||', 'invalid.illegal.formatter-pipe.puzzle', 0, i);
        }
    }
    // A `|` nested in parentheses or brackets in a header is plain JavaScript.
    const nestedHeader = lineWith(valuePipes, '{#if (bits | flag)}');
    assertScope(nestedHeader, '|', 'keyword.operator.bitwise.js');
    assertNoScope(nestedHeader, '|', 'invalid.illegal.formatter-pipe.puzzle');
    assertScope(nestedHeader, '|', 'keyword.operator.bitwise.js', 0, 1);
    assertNoScope(nestedHeader, '|', 'invalid.illegal.formatter-pipe.puzzle', 0, 1);
    // A pipe that ends a condition-header line is not a continued chain.
    const eolHeaderPipe = lineWith(valuePipes, '{#if ready |');
    assertScope(eolHeaderPipe, '|', 'invalid.illegal.formatter-pipe.puzzle');
    assertNoScope(eolHeaderPipe, '|', 'keyword.operator.formatter.puzzle');
    assertNoScope(lineWith(valuePipes, 'size}wrapped'), 'size', 'variable.function.formatter.puzzle');

    const handlerPipe = lineWith(valuePipes, '@click={ a | b }');
    assertScope(handlerPipe, '|', 'keyword.operator.bitwise.js');
    assertNoScope(handlerPipe, '|', 'keyword.operator.formatter.puzzle');
    assertNoScope(handlerPipe, '|', 'invalid.illegal.formatter-pipe.puzzle');

    // 0.8.0 (D173 V8): an object literal is legal in argument position. It is
    // a JavaScript object, not a nested interpolation, and the outer
    // interpolation still closes at the right brace.
    for (const needle of ['afterText', 'tailText', 'plainTail']) {
        const line = lineWith(valuePipes, needle);
        assertScope(line, '{', 'meta.objectliteral.js', 0, 1);
        assertNoScope(line, needle, 'source.js.embedded.puzzle');
    }
    const tArgs = lineWith(valuePipes, 'afterText');
    assertScope(tArgs, 't(', 'variable.function.formatter.puzzle');
    assertScope(tArgs, 'name:', 'meta.object-literal.key.js');
    assertScope(tArgs, 'user.name', 'meta.objectliteral.js');
    assertScope(lineWith(valuePipes, 'tailText'), 'resize', 'variable.function.formatter.puzzle');
    const handlerObject = lineWith(valuePipes, 'save({');
    assertScope(handlerObject, 'id:', 'meta.object-literal.key.js');
    assertScope(handlerObject, 'go', 'text.html.puzzle');
    assertNoScope(handlerObject, 'go', 'source.js.embedded.puzzle');

    // Only a top-level single `|` is a pipe: parenthesized it is bitwise OR.
    const nested = lineWith(valuePipes, '(flags | mask)');
    assertScope(nested, '|', 'keyword.operator.bitwise.js');
    assertNoScope(nested, '|', 'invalid.illegal.formatter-pipe.puzzle');
    assertScope(nested, '||', 'keyword.operator.logical.js');

    // What follows a pipe must be a formatter name: `| 0` and `|=` are
    // compile errors, and so is any pipe in a {#for} header or a {:when} value
    // (and, above, in any condition header).
    const notAName = lineWith(valuePipes, 'w / 2 | 0');
    assertScope(notAName, '|', 'invalid.illegal.formatter-pipe.puzzle');
    assertScope(notAName, '|', 'invalid.illegal.formatter-pipe.puzzle', 0, 1);
    const forPipe = lineWith(valuePipes, '{#for item in items | sort}');
    assertScope(forPipe, '|', 'invalid.illegal.formatter-pipe.puzzle');
    assertNoScope(forPipe, 'sort', 'variable.function.formatter.puzzle');
    const whenPipe = lineWith(valuePipes, "{:when 'a' | x}");
    assertScope(whenPipe, '|', 'invalid.illegal.formatter-pipe.puzzle');
    assertNoScope(whenPipe, 'x}', 'variable.function.formatter.puzzle');

    // A chain may continue on the next line.
    const eolPipe = lineWith(valuePipes, '{ total |');
    assertScope(eolPipe, '|', 'keyword.operator.formatter.puzzle');
    assertNoScope(eolPipe, '|', 'invalid.illegal.formatter-pipe.puzzle');

    // <pre>/<textarea> bodies keep their whitespace (D173 V10); the grammar
    // does not collapse or special-case them, and interpolations stay live.
    const preBody = lineWith(valuePipes, 'keep   {');
    assertScope(preBody, 'trim', 'variable.function.formatter.puzzle');
    assertNoScope(preBody, 'exactly', 'source.js.embedded.puzzle');
    assertScope(lineWith(valuePipes, '{ draft }'), 'draft', 'source.js.embedded.puzzle');

    console.log('Puzzle TextMate grammar tests passed');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

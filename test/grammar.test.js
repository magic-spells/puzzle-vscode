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

    const edgeCases = tokenize(grammar, `<puzzle-view>
  <button @click.prevent={ go } @click:bogus={ go }></button>
  {:elsif stale}
  { count || fallback }
  {#if flags | mask}<span>bitwise</span>{/if}
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
    assertScope(lineWith(edgeCases, 'flags | mask'), '|', 'keyword.operator.bitwise.js');
    assertNoScope(lineWith(edgeCases, 'flags | mask'), '|', 'keyword.operator.formatter.puzzle');
    assertScope(lineWith(edgeCases, 'stillJavaScript'), 'stillJavaScript', 'source.js.embedded.puzzle');

    console.log('Puzzle TextMate grammar tests passed');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

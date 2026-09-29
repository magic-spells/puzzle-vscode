"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = void 0;
const vscode = require("vscode");
const library_1 = require("./library");
const EVENTS = [
    'click',
    'input',
    'change',
    'submit',
    'keydown',
    'keyup',
    'pointerdown',
    'mousedown',
    'mouseenter'
];
const EVENT_MODIFIERS = [
    'prevent',
    'stop',
    'once',
    'outside',
    'enter',
    'escape',
    'tab',
    'space',
    'up',
    'down',
    'left',
    'right',
    'backspace',
    'delete'
];
function activate(context) {
    context.subscriptions.push(vscode.commands.registerCommand('puzzle.createComponent', insertComponentTemplate), vscode.languages.registerHoverProvider('puzzle', { provideHover }), vscode.languages.registerCompletionItemProvider('puzzle', { provideCompletionItems }, '#', ':', '@'));
}
exports.activate = activate;
async function insertComponentTemplate() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'puzzle') {
        void vscode.window.showInformationMessage('Open a Puzzle (.pzl) file before inserting a component template.');
        return;
    }
    const name = await vscode.window.showInputBox({
        prompt: 'Component class name',
        placeHolder: 'AlbumCard',
        validateInput(value) {
            return /^[A-Z][A-Za-z0-9_]*$/.test(value)
                ? null
                : 'Use a capitalized JavaScript identifier, for example AlbumCard.';
        }
    });
    if (!name)
        return;
    await editor.edit(edit => {
        edit.insert(editor.selection.active, componentTemplate(name));
    });
}
function provideHover(document, position) {
    const wordRange = document.getWordRangeAtPosition(position);
    if (wordRange && document.getText(wordRange) === 'PuzzleView') {
        return new vscode.Hover('Base class for Puzzle views and components. Define reactive state in `data()` and event callbacks in `events = { ... }`.');
    }
    const line = document.lineAt(position.line).text;
    const directivePattern = /\{(?:#(?:if|unless|for|case|svg|comment|raw)|:(?:else(?:\s+if)?|when)|\/\s*(?:if|unless|for|case|comment|raw))\b[^}]*\}/g;
    for (const match of line.matchAll(directivePattern)) {
        const start = match.index ?? -1;
        const end = start + match[0].length;
        if (start <= position.character && position.character <= end) {
            return new vscode.Hover('Puzzle template directive. Supported blocks are `if`, `unless`, `for`, `case`, `comment`, and `raw`; `svg` is a void compile-time inline directive.');
        }
    }
    return null;
}
function provideCompletionItems(document, position) {
    const prefix = document.lineAt(position).text.slice(0, position.character);
    if (/\{#$/.test(prefix)) {
        return [
            snippet('if', 'if ${1:condition}}\n\t${2:content}\n{/if}', 'Insert an if block'),
            snippet('unless', 'unless ${1:condition}}\n\t${2:content}\n{/unless}', 'Insert an unless block'),
            snippet('for', 'for ${1:item} in ${2:items}, ${3:index}}\n\t${4:content}\n{/for}', 'Insert a collection loop'),
            snippet('case', "case ${1:value}}\n\t{:when ${2:'match'}}\n\t\t${3:content}\n\t{:else}\n\t\t${4:fallback}\n{/case}", 'Insert a case block'),
            snippet('svg', "svg '${1:icons/name.svg'}}", 'Inline an SVG file at compile time'),
            snippet('comment', 'comment}\n\t${1:notes}\n{/comment}', 'Insert a template comment block'),
            snippet('raw', 'raw}\n\t${1:literal text — braces are inert}\n{/raw}', 'Insert a raw block: no interpolation, directives, or event bindings')
        ];
    }
    if (/\{:$/.test(prefix)) {
        return [
            snippet('else', 'else}', 'Insert an else branch'),
            snippet('else if', 'else if ${1:condition}}', 'Insert an else-if branch'),
            snippet('when', "when ${1:'value'}}", 'Insert a case branch')
        ];
    }
    if (/@[$A-Za-z_][$\w.-]*:$/.test(prefix)) {
        return EVENT_MODIFIERS.map(modifier => completion(modifier, vscode.CompletionItemKind.EnumMember, 'Puzzle event modifier'));
    }
    if (/@$/.test(prefix)) {
        return EVENTS.map(event => snippet(event, `${event}={ \${1:handler} }`, `Bind the ${event} event`));
    }
    // A bare name inside a template expression can be a library call. A name
    // after `.` is a member or a method, never a library function.
    const upToCursor = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    if (!/\.\s*[$\w]*$/.test(prefix) && (0, library_1.insideTemplateExpression)(upToCursor)) {
        return library_1.LIBRARY.map(libraryCompletion);
    }
    return [];
}
function libraryCompletion(fn) {
    const item = new vscode.CompletionItem(fn.name, vscode.CompletionItemKind.Function);
    item.detail = fn.signature;
    item.documentation = new vscode.MarkdownString(fn.documentation);
    item.insertText = new vscode.SnippetString(fn.insert);
    return item;
}
function completion(label, kind, documentation) {
    const item = new vscode.CompletionItem(label, kind);
    item.documentation = new vscode.MarkdownString(documentation);
    return item;
}
function snippet(label, value, documentation) {
    const item = completion(label, vscode.CompletionItemKind.Snippet, documentation);
    item.insertText = new vscode.SnippetString(value);
    return item;
}
function componentTemplate(name) {
    const cssName = name
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/_/g, '-')
        .toLowerCase();
    return `<puzzle-view class="${cssName}">
\t<!-- ${name} template -->
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';

export default class ${name} extends PuzzleView {
\tdata(params, props) {
\t\treturn {};
\t}

\tevents = {};
}
</script>

<style scoped>
.${cssName} {
\t/* component styles */
}
</style>
`;
}
//# sourceMappingURL=extension.js.map
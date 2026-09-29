'use strict';

// The completion data and the expression-context scan behind the library
// completions (src/library.ts, compiled to out/library.js by `npm test`).

const assert = require('assert');
const { LIBRARY, insideTemplateExpression } = require('../out/library.js');

// The Puzzle function library (D176 §4): 19 standard functions plus
// PuzzleKit's `link` and `timeago`.
const EXPECTED = [
    'round', 'currency', 'percentage', 'number_with_delimiter', 'compact_number',
    'pluralize', 'capitalize', 'truncate', 'strip_html', 'strip_newlines', 'escape',
    'raw', 'newline_to_br', 'json', 'date', 'time', 'datetime', 'in_timezone', 't',
    'link', 'timeago'
];
const names = LIBRARY.map(fn => fn.name);
assert.deepStrictEqual([...names].sort(), [...EXPECTED].sort());

// Names that no longer exist are never offered.
for (const gone of ['upcase', 'downcase', 'trim', 'strip', 'replace', 'join', 'abs', 'ceil', 'floor', 'size', 'default']) {
    assert(!names.includes(gone), `${gone} must not be offered`);
}

// Every entry is a call snippet with its signature.
for (const fn of LIBRARY) {
    assert(fn.insert.startsWith(`${fn.name}(`) && fn.insert.endsWith(')'), `${fn.name}: insert ${fn.insert}`);
    assert(fn.signature.startsWith(`${fn.name}(`), `${fn.name}: signature ${fn.signature}`);
    assert(!fn.insert.includes('|') || /\$\{\d+\|[^}]*\|\}/.test(fn.insert), `${fn.name}: a pipe in ${fn.insert}`);
}
for (const name of ['date', 'time', 'datetime']) {
    const fn = LIBRARY.find(entry => entry.name === name);
    assert.strictEqual(fn.insert, `${name}($1, '\${2|short,medium,long,iso|}')`);
    assert.strictEqual(fn.signature, `${name}(value, preset?, locale?)`);
}
assert.strictEqual(LIBRARY.find(fn => fn.name === 'currency').insert, 'currency($1)');

// insideTemplateExpression: the text is the document up to the cursor.
const view = '<puzzle-view>\n';
const yes = [
    `${view}<p>{ cur`,
    `${view}<p>{ truncate(post.body, `,
    `${view}<a title={ cur`,
    `${view}<a class="x { cur`,
    `${view}{#if items.length > 0 && cur`,
    `${view}<button @click={ save(cur`,
    `${view}<p>{ t('key', { count: cur`,
    `${view}<p>{ a }</p>\n<p>{ '}' + cur`,
    `${view}<p>It's { cur`,
    '<puzzle-skeleton>\n<p>{ cur'
];
const no = [
    `${view}<p>cur`,
    `${view}<p>{ a } cur`,
    `${view}<p>{ 'cur`,
    `${view}{#raw}{ cur`,
    `${view}{#comment}{ cur`,
    `${view}<!-- { cur`,
    `${view}{## note { cur`,
    `${view}{#svg 'icons/cur`,
    `${view}\\{ cur`,
    `${view}</puzzle-view>\n<script>\nconst x = { cur`,
    '<script>\nconst x = { cur'
];
for (const text of yes) assert(insideTemplateExpression(text), `expected an expression: ${JSON.stringify(text)}`);
for (const text of no) assert(!insideTemplateExpression(text), `expected no expression: ${JSON.stringify(text)}`);
// A closed {#raw} or {#comment} block does not swallow what follows.
assert(insideTemplateExpression(`${view}{#raw}{ inert }{/raw}<p>{ cur`));
assert(insideTemplateExpression(`${view}{#comment}{ inert }{/comment}<p>{ cur`));
assert(insideTemplateExpression(`${view}<!-- { -->\n<p>{ cur`));

console.log('Puzzle library completion tests passed');

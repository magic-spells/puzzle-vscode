// The Puzzle function library (D176 §4): the 19 standard functions plus
// PuzzleKit's `link` and `timeago`, with the signatures the runtime takes
// (types/index.d.ts `LibraryFunctions`). A template calls them bare, like
// `{ currency(price) }`. Completion hints only: apps register their own
// functions through the `formatters` config map.
export interface LibraryFunction {
    name: string;
    signature: string;
    insert: string;
    documentation: string;
}

const DATE_PRESET = "'${2|short,medium,long,iso|}'";

export const LIBRARY: LibraryFunction[] = [
    // numbers
    { name: 'round', signature: 'round(value, places?)', insert: 'round($1)', documentation: 'Half away from zero on the decimal value; negative places round to tens.' },
    { name: 'currency', signature: 'currency(value, symbol?, places?)', insert: 'currency($1)', documentation: '`$1,234.50`: thousands grouped, the sign before the symbol.' },
    { name: 'percentage', signature: 'percentage(value, places?)', insert: 'percentage($1)', documentation: '`12.5%`: the number as written, not a ratio.' },
    { name: 'number_with_delimiter', signature: 'number_with_delimiter(value, delimiter?)', insert: 'number_with_delimiter($1)', documentation: "The whole part grouped: the locale's way, or by an explicit delimiter." },
    { name: 'compact_number', signature: 'compact_number(value)', insert: 'compact_number($1)', documentation: '`1.2K`, `3.4M` in the locale.' },
    // text
    { name: 'pluralize', signature: 'pluralize(count, singular, plural?)', insert: "pluralize($1, '${2:item}')", documentation: 'The count and the word: `1 comment`, `3 comments`.' },
    { name: 'capitalize', signature: 'capitalize(value)', insert: 'capitalize($1)', documentation: 'The first character upper-cased, the rest left alone.' },
    { name: 'truncate', signature: 'truncate(value, length?, ellipsis?)', insert: 'truncate($1, ${2:100})', documentation: 'At most `length` code points, the ellipsis included (default 100, `…`).' },
    { name: 'strip_html', signature: 'strip_html(value)', insert: 'strip_html($1)', documentation: 'The text with its HTML tags removed.' },
    { name: 'strip_newlines', signature: 'strip_newlines(value)', insert: 'strip_newlines($1)', documentation: 'The text with its line breaks removed.' },
    { name: 'escape', signature: 'escape(value)', insert: 'escape($1)', documentation: 'The value as text (a text interpolation is already escaped).' },
    // markup: only as the whole (outermost call) of a text interpolation
    { name: 'raw', signature: 'raw(html)', insert: 'raw($1)', documentation: 'Sanitized markup. Only as the whole of a text interpolation: `{ raw(post.bodyHtml) }`.' },
    { name: 'newline_to_br', signature: 'newline_to_br(value)', insert: 'newline_to_br($1)', documentation: 'The escaped text with a `<br>` per line break. Only as the whole of a text interpolation.' },
    // values
    { name: 'json', signature: 'json(value)', insert: 'json($1)', documentation: 'JSON with object keys sorted by code point.' },
    // dates
    { name: 'date', signature: 'date(value, preset?, locale?)', insert: `date($1, ${DATE_PRESET})`, documentation: 'Default `medium`: `Sep 24, 2026`. Presets: `short`, `medium`, `long`, `iso`.' },
    { name: 'time', signature: 'time(value, preset?, locale?)', insert: `time($1, ${DATE_PRESET})`, documentation: 'Default `short`: `3:04 PM`. Presets: `short`, `medium`, `long`, `iso`.' },
    { name: 'datetime', signature: 'datetime(value, preset?, locale?)', insert: `datetime($1, ${DATE_PRESET})`, documentation: 'Default: the medium date with the short time, `Sep 24, 2026, 3:04 PM`.' },
    { name: 'in_timezone', signature: 'in_timezone(value, timeZone?)', insert: "in_timezone($1, '${2:America/New_York}')", documentation: 'The instant as the wall clock in an IANA zone, to pass on: `{ time(in_timezone(d, zone)) }`.' },
    // translations: registered by the i18n service (D175)
    { name: 't', signature: 't(key, vars?)', insert: "t('${1:key}')", documentation: 'The translation for `key` in the active locale; `vars` fill `{name}` placeholders and a `count` picks the plural form.' },
    // PuzzleKit only
    { name: 'link', signature: 'link(path)', insert: "link('${1:/path}')", documentation: 'The URL for an app path in the active routing mode.' },
    { name: 'timeago', signature: 'timeago(value)', insert: 'timeago($1)', documentation: '`2 hours ago`, `in 3 days`, in the locale.' }
];

// Whether the end of `text` (a document up to the cursor) sits inside an
// open `{ … }` of a <puzzle-view> or <puzzle-skeleton> section: an
// interpolation, a brace attribute value, an @event handler, or a block
// header. HTML comments, {#comment} and {#raw} bodies, {## notes} and {#svg}
// paths are not expressions. A light scan, not a parser.
export function insideTemplateExpression(text: string): boolean {
    const sectionStart = Math.max(text.lastIndexOf('<puzzle-view'), text.lastIndexOf('<puzzle-skeleton'));
    const sectionEnd = Math.max(text.lastIndexOf('</puzzle-view>'), text.lastIndexOf('</puzzle-skeleton>'));
    if (sectionStart < 0 || sectionEnd > sectionStart) return false;

    const body = text.slice(sectionStart);
    const openers: number[] = [];
    let quote = '';
    let skipTo: RegExp | null = null;
    for (let i = 0; i < body.length; i += 1) {
        const ch = body[i];
        if (skipTo) {
            skipTo.lastIndex = i;
            const close = skipTo.exec(body);
            if (!close) return false;
            skipTo = null;
            i = close.index + close[0].length - 1;
            continue;
        }
        if (quote) {
            if (ch === '\\') i += 1;
            else if (ch === quote) quote = '';
            continue;
        }
        if (ch === '\\' && (body[i + 1] === '{' || body[i + 1] === '}')) {
            i += 1;
        } else if (openers.length && (ch === "'" || ch === '"' || ch === '`')) {
            quote = ch;
        } else if (!openers.length && body.startsWith('<!--', i)) {
            skipTo = /-->/g;
        } else if (ch === '{') {
            const block = openers.length ? null : /^\{#(raw|comment)\b[^}]*\}/.exec(body.slice(i, i + 200));
            if (block) {
                skipTo = new RegExp(`\\{/\\s*${block[1]}\\s*\\}`, 'g');
                i += block[0].length - 1;
                continue;
            }
            openers.push(i);
        } else if (ch === '}' && openers.length) {
            openers.pop();
        }
    }
    if (skipTo || quote || !openers.length) return false;
    return !/^\{(?:##|#svg|\/)/.test(body.slice(openers[0], openers[0] + 5));
}

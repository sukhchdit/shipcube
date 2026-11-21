/**
 * Token lint analysis (US-101, tokens.md §1 rule 1 and §5; TASK-038). Pure functions over one CSS declaration; the
 * Stylelint rule `platform/token-lint` (tools/stylelint-rules/token-lint.mjs) walks the stylesheets and reports what
 * these return, so `npm run lint` fails with file and line:
 *  - a hard-coded colour: `#hex`, `rgb()`, `rgba()`, `hsl()`, `hsla()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`,
 *    and a named colour (`red`) in a colour-bearing property;
 *  - off-grid spacing: a px/rem/em length in a margin, padding, gap or inset property that is not on the `space.*` scale
 *    (0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96 px);
 *  - an unknown token: `var(--x)` where `--x` is neither a platform token variable, nor declared in the same stylesheet,
 *    nor a Tailwind (`--tw-*`) or Radix (`--radix-*`) runtime variable.
 * Raw values are allowed only in the generated theme (stylelint.config.mjs switches the rule off for that one file).
 */

/** CSS named colours (CSS Color 4), without `transparent` and `currentcolor`, which carry no hue. */
const NAMED_COLOURS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue ' +
    'chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey ' +
    'darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray ' +
    'darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen ' +
    'fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen ' +
    'lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime ' +
    'limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue ' +
    'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive ' +
    'olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver ' +
    'skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white ' +
    'whitesmoke yellow yellowgreen'
  ).split(' '),
);

const SIDES = '(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?';
/** Properties whose value is a colour (named colours are only recognised here: `grey` elsewhere may be anything). */
const COLOUR_PROPERTY = new RegExp(
  `^(?:color|background(?:-color)?|border${SIDES}(?:-color)?|outline(?:-color)?|fill|stroke|box-shadow|text-shadow|` +
    'text-decoration(?:-color)?|text-emphasis(?:-color)?|caret-color|accent-color|column-rule(?:-color)?|stop-color|flood-color|lighting-color)$',
  'iu',
);
const SPACING_PROPERTY = new RegExp(
  `^(?:(?:margin|padding|scroll-margin|scroll-padding)${SIDES}|inset(?:-(?:block|inline)(?:-(?:start|end))?)?|gap|row-gap|column-gap|grid-gap|grid-row-gap|grid-column-gap|top|right|bottom|left)$`,
  'iu',
);

const HEX_COLOUR = /#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{3,4})(?![\w-])/giu;
const COLOUR_FUNCTION = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/giu;
const WORD = /(?<![\w#-])[a-z]+(?![\w(-])/giu;
const LENGTH = /(?<![\w.])-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em)(?![\w%])/giu;
const VAR_REFERENCE = /var\(\s*(--[\w-]+)/giu;

/**
 * Drops quoted strings and `url(...)`, whose content is data rather than style.
 * @param {string} value
 * @returns {string}
 */
function stripData(value) {
  return value.replace(/(["'])(?:\\.|(?!\1).)*\1/gu, '""').replace(/url\([^)]*\)/giu, 'url()');
}

/**
 * Drops `var(...)` references (balanced, innermost first) so their names and fallbacks are not read as literals.
 * @param {string} value
 * @returns {string}
 */
function stripVariables(value) {
  let text = value;
  for (let previous = ''; previous !== text;) {
    previous = text;
    text = text.replace(/var\([^()]*\)/giu, '');
  }
  return text;
}

/**
 * Hard-coded colours in one declaration.
 * @param {string} prop
 * @param {string} value
 * @returns {string[]} the offending literals, in order
 */
export function findColourLiterals(prop, value) {
  const text = stripData(value);
  /** @type {string[]} */
  const found = [...(text.match(HEX_COLOUR) ?? []), ...(text.match(COLOUR_FUNCTION) ?? []).map((fn) => `${fn})`)];
  if (COLOUR_PROPERTY.test(prop)) {
    for (const word of stripVariables(text).match(WORD) ?? []) {
      if (NAMED_COLOURS.has(word.toLowerCase())) found.push(word);
    }
  }
  return found;
}

/** The properties the off-grid check applies to (exported for the unit test). */
export const isSpacingProperty = (/** @type {string} */ prop) => SPACING_PROPERTY.test(prop);

/**
 * Lengths of a spacing property that are not on the 4/8 grid scale.
 * @param {string} prop
 * @param {string} value
 * @param {readonly number[]} scalePx the `space.*` values in px
 * @returns {string[]}
 */
export function findOffGridSpacing(prop, value, scalePx) {
  if (!SPACING_PROPERTY.test(prop)) return [];
  const text = stripVariables(stripData(value));
  return (text.match(LENGTH) ?? []).filter((length) => {
    const amount = Math.abs(Number.parseFloat(length));
    const px = length.endsWith('px') ? amount : amount * 16;
    return !scalePx.some((step) => Math.abs(step - px) < 1e-6);
  });
}

/**
 * `var(--x)` references that name no known token.
 * @param {string} value
 * @param {(name: string) => boolean} isKnown
 * @returns {string[]}
 */
export function findUnknownVariables(value, isKnown) {
  const names = [...stripData(value).matchAll(VAR_REFERENCE)].map((match) => /** @type {string} */ (match[1]));
  return names.filter((name) => !isKnown(name));
}

/** Runtime variables set by Tailwind and Radix, never by this repository's tokens. */
export const isRuntimeVariable = (/** @type {string} */ name) => name.startsWith('--tw-') || name.startsWith('--radix-');

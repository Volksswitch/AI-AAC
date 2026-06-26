/* AAC Conversation Assistant — on-screen keyboard layouts (June 2026)
 *
 * The twenty alphabetical layouts from `Keyboard-Layout-Options.docx`, encoded
 * as data so the keyboard renderer can switch between them and so a layout is a
 * user Setting (Settings → Speech & Input). Ten side-dock layouts (S1–S10) for
 * the About Me / Settings screens; ten bottom-dock layouts (B1–B10) for the
 * conversation composer.
 *
 * Cell shapes (all carry a `span` = flex weight within the row):
 *   { kind:'char',  char, label }    — inserts the character (letters, digits, , .)
 *   { kind:'space', action:'space' } — space
 *   { kind:'action', action, label } — 'shift' | 'backspace' | 'enter' | 'page'
 *   { kind:'blank' }                 — inert spacer (grid filler / split gap)
 *   { kind:'pred' }                  — inert word-prediction slot (future)
 *
 * Span lets one cell occupy the width of several (e.g. a 3-wide space). Rows in
 * a layout all sum to the same total, so flex preserves the intended geometry.
 */

// --- cell builders ----------------------------------------------------------
const C  = (ch, span = 1) => ({ kind: 'char', char: ch, label: ch, span });
const SP = (span = 1) => ({ kind: 'space', action: 'space', label: 'space', span });
const SH = (span = 1) => ({ kind: 'action', action: 'shift', label: '⇧', span });
const BK = (span = 1) => ({ kind: 'action', action: 'backspace', label: '⌫', span });
const EN = (span = 1) => ({ kind: 'action', action: 'enter', label: '↵', span });
const PG = (label = '123', span = 1) => ({ kind: 'action', action: 'page', label, span });
const BL = (span = 1) => ({ kind: 'blank', label: '', span });
const PR = (span = 1) => ({ kind: 'pred', label: '', span });
const r  = (str) => str.split(' ').filter(Boolean).map((c) => C(c)); // a row of chars

// --- side-dock layouts (S1–S10) --------------------------------------------
const S = {
  S1: { name: 'Five-wide alphabetical (square keys)', dock: 'side', rows: [
    r('a b c d e'), r('f g h i j'), r('k l m n o'), r('p q r s t'), r('u v w x y'),
    [C('z'), C(','), C('.'), BK(), SH()],
    [PG(), SP(3), EN()],
  ]},
  S2: { name: 'Four-wide alphabetical (extra-large)', dock: 'side', rows: [
    r('a b c d'), r('e f g h'), r('i j k l'), r('m n o p'), r('q r s t'), r('u v w x'),
    [C('y'), C('z'), C(','), C('.')],
    [SH(), PG(), BK(), EN()],
    [SP(4)],
  ]},
  S3: { name: 'Six-wide compact', dock: 'side', rows: [
    r('a b c d e f'), r('g h i j k l'), r('m n o p q r'), r('s t u v w x'),
    [C('y'), C('z'), C(','), C('.'), BK(), SH()],
    [PG(), SP(4), EN()],
  ]},
  S4: { name: 'Letters + right action rail', dock: 'side', rows: [
    [C('a'), C('b'), C('c'), C('d'), C('e'), BK()],
    [C('f'), C('g'), C('h'), C('i'), C('j'), SH()],
    [C('k'), C('l'), C('m'), C('n'), C('o'), EN()],
    [C('p'), C('q'), C('r'), C('s'), C('t'), PG()],
    [C('u'), C('v'), C('w'), C('x'), C('y'), C(',')],
    [C('z'), SP(4), C('.')],
  ]},
  S5: { name: 'Square space (no bar)', dock: 'side', rows: [
    r('a b c d e'), r('f g h i j'), r('k l m n o'), r('p q r s t'), r('u v w x y'),
    [C('z'), C(','), C('.'), BK(), SH()],
    [PG(), SP(2), EN(), BL(1)],
  ]},
  S6: { name: 'Three-wide big-key', dock: 'side', rows: [
    r('a b c'), r('d e f'), r('g h i'), r('j k l'), r('m n o'), r('p q r'), r('s t u'), r('v w x'),
    [C('y'), C('z'), BK()],
    [SH(), PG(), EN()],
    [C(','), SP(1), C('.')],
  ]},
  S7: { name: 'Column-major alphabetical (read down)', dock: 'side', rows: [
    [C('a'), C('g'), C('m'), C('s'), C('y')],
    [C('b'), C('h'), C('n'), C('t'), C('z')],
    [C('c'), C('i'), C('o'), C('u'), BK()],
    [C('d'), C('j'), C('p'), C('v'), SH()],
    [C('e'), C('k'), C('q'), C('w'), PG()],
    [C('f'), C('l'), C('r'), C('x'), EN()],
    [C(','), SP(3), C('.')],
  ]},
  S8: { name: 'Letters grid + dedicated control bar', dock: 'side', rows: [
    r('a b c d e'), r('f g h i j'), r('k l m n o'), r('p q r s t'), r('u v w x y'),
    [C('z'), C(',', 2), C('.', 2)],
    [SH(), PG(), BK(), EN(2)],
    [SP(5)],
  ]},
  S9: { name: 'Frequency-emphasized controls', dock: 'side', rows: [
    r('a b c d e'), r('f g h i j'), r('k l m n o'), r('p q r s t'), r('u v w x y'),
    [C('z'), C(','), C('.'), SH(), PG()],
    [BK(2), SP(2), EN()],
  ]},
  S10: { name: 'Letters + permanent number block', dock: 'side', rows: [
    r('a b c d e'), r('f g h i j'), r('k l m n o'), r('p q r s t'), r('u v w x y'),
    [C('z'), C(','), C('.'), BK(), SH()],
    r('1 2 3 4 5'), r('6 7 8 9 0'),
    [SP(4), EN()],
  ]},
};

// --- bottom-dock layouts (B1–B10) ------------------------------------------
const B = {
  B1: { name: 'Nine-wide alphabetical (refined)', dock: 'bottom', rows: [
    r('a b c d e f g h i'), r('j k l m n o p q r'),
    [C('s'), C('t'), C('u'), C('v'), C('w'), C('x'), C('y'), C('z'), BK()],
    [SH(), PG(), C(','), SP(4), C('.'), EN()],
  ]},
  B2: { name: 'Ten-wide (phone-like)', dock: 'bottom', rows: [
    r('a b c d e f g h i j'), r('k l m n o p q r s t'),
    [C('u'), C('v'), C('w'), C('x'), C('y'), C('z'), C(','), C('.'), BK(), SH()],
    [PG(), SP(8), EN()],
  ]},
  B3: { name: 'Thirteen-wide, two rows (shortest)', dock: 'bottom', rows: [
    r('a b c d e f g h i j k l m'), r('n o p q r s t u v w x y z'),
    [SH(), PG(), C(','), SP(7), C('.'), BK(), EN()],
  ]},
  B4: { name: 'Seven-wide (taller keys)', dock: 'bottom', rows: [
    r('a b c d e f g'), r('h i j k l m n'), r('o p q r s t u'),
    [C('v'), C('w'), C('x'), C('y'), C('z'), C(','), C('.')],
    [SH(), PG(), BK(), SP(3), EN()],
  ]},
  B5: { name: 'Square space, reserved slots', dock: 'bottom', rows: [
    r('a b c d e f g h i'), r('j k l m n o p q r'),
    [C('s'), C('t'), C('u'), C('v'), C('w'), C('x'), C('y'), C('z'), BK()],
    [SH(), PG(), C(','), C('.'), SP(2), EN(), BL(1), BL(1)],
  ]},
  B6: { name: 'Centered space, symmetric controls', dock: 'bottom', rows: [
    r('a b c d e f g h i'), r('j k l m n o p q r'),
    [C('s'), C('t'), C('u'), C('v'), C('w'), C('x'), C('y'), C('z'), BK()],
    [SH(), PG(), C(','), SP(3), C('.'), BK(), EN()],
  ]},
  B7: { name: 'Letters + right-corner action cluster', dock: 'bottom', rows: [
    [C('a'), C('b'), C('c'), C('d'), C('e'), C('f'), C('g'), C('h'), BK(), SH()],
    [C('i'), C('j'), C('k'), C('l'), C('m'), C('n'), C('o'), C('p'), EN(), PG()],
    [C('q'), C('r'), C('s'), C('t'), C('u'), C('v'), C('w'), C('x'), C(','), C('.')],
    [C('y'), C('z'), SP(8)],
  ]},
  B8: { name: 'Split / ergonomic (center gap)', dock: 'bottom', rows: [
    [C('a'), C('b'), C('c'), C('d'), BL(1), C('n'), C('o'), C('p'), C('q')],
    [C('e'), C('f'), C('g'), C('h'), BL(1), C('r'), C('s'), C('t'), C('u')],
    [C('i'), C('j'), C('k'), C('l'), BL(1), C('v'), C('w'), C('x'), C('y')],
    [C('m'), C(','), C('.'), BK(), BL(1), C('z'), SH(), PG(), EN()],
    [SP(4), BL(1), SP(4)],
  ]},
  B9: { name: 'Permanent number row on top', dock: 'bottom', rows: [
    r('1 2 3 4 5 6 7 8 9 0'),
    r('a b c d e f g h i j'), r('k l m n o p q r s t'),
    [C('u'), C('v'), C('w'), C('x'), C('y'), C('z'), C(','), C('.'), BK(), SH()],
    [PG(), SP(8), EN()],
  ]},
  B10: { name: 'Prediction strip + alphabetical', dock: 'bottom', rows: [
    [PR(3), PR(3), PR(3)],
    r('a b c d e f g h i'), r('j k l m n o p q r'),
    [C('s'), C('t'), C('u'), C('v'), C('w'), C('x'), C('y'), C('z'), BK()],
    [SH(), PG(), C(','), SP(4), C('.'), EN()],
  ]},
  // QWERTY for users with touch-typing skills (Ken). Three letter rows in the
  // standard QWERTY ORDER, aligned in a clean grid (q/a/z share column 1, etc.)
  // so the letters are easy to find and never shift between rows; space is on the
  // bottom row. Each row sums to 12 units so the columns line up. Infrequent
  // special characters live on the shared symbols page (the 123 key).
  B11: { name: 'QWERTY (touch-typist, 3-row)', dock: 'bottom', rows: [
    [C('q'), C('w'), C('e'), C('r'), C('t'), C('y'), C('u'), C('i'), C('o'), C('p'), BK(2)],
    [C('a'), C('s'), C('d'), C('f'), C('g'), C('h'), C('j'), C('k'), C('l'), SH(), EN(2)],
    [C('z'), C('x'), C('c'), C('v'), C('b'), C('n'), C('m'), PG(), SP(2), C(','), C('.')],
  ]},
};

export const LAYOUTS = { ...S, ...B };

// Symbols/numbers page (reached with the 123 key). One per dock so the page
// suits the dock's shape; the ABC key returns to the active letters layout.
export const SYMBOLS = {
  side: [
    r('1 2 3 4 5'), r('6 7 8 9 0'),
    [C('@'), C('#'), C('$'), C('%'), C('&')],
    [C('*'), C('('), C(')'), C('-'), C('+')],
    [C('!'), C('?'), C("'"), C('"'), C(':')],
    [C(';'), C('/'), C('='), C('_'), C('~')],
    [PG('ABC'), SP(2), BK(), EN()],
  ],
  bottom: [
    r('1 2 3 4 5 6 7 8 9 0'),
    [C('@'), C('#'), C('$'), C('%'), C('&'), C('*'), C('('), C(')'), C('-'), C('+')],
    [C('!'), C('?'), C("'"), C('"'), C(':'), C(';'), C('/'), C('='), C('_'), C('~')],
    [PG('ABC'), SP(5), C(','), C('.'), BK(), EN()],
  ],
};

// Ordered lists for the Settings select menus.
export const SIDE_LAYOUTS = Object.keys(S).map((id) => ({ id, name: S[id].name }));
export const BOTTOM_LAYOUTS = Object.keys(B).map((id) => ({ id, name: B[id].name }));

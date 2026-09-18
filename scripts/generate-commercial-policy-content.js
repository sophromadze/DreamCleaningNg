#!/usr/bin/env node
/**
 * Regenerates the frontend's copy of the published commercial policies from the canonical
 * backend source.
 *
 *   node scripts/generate-commercial-policy-content.js
 *
 * WHY A GENERATOR AND NOT A SECOND HAND-MAINTAINED FILE. The policy text is the same content in
 * two runtimes: the backend renders it into the two downloadable PDFs and quotes its version in
 * Section 36 of every new contract, and the Angular page renders it as HTML. A page and a PDF
 * that state different cancellation windows is the exact failure the whole arrangement exists to
 * prevent, and "remember to change both" is not a mechanism. So:
 *
 *   Helpers/Commercial/CommercialPolicyDocument.cs  ->  this script  ->  the .json beside it
 *
 * and CommercialPolicyContentTests (backend) asserts the .json still deep-equals the C#, so a
 * forgotten regeneration fails the suite rather than reaching a client.
 *
 * HOW IT WORKS. The C# content is a set of object and array initializers over three tiny
 * factories, which is close enough to JavaScript that the file can be evaluated rather than
 * parsed: the extracted regions are rewritten (`new[] { ... }` to `[ ... ]`, `Name = value` to
 * `name: value`) and run against shims for PolicyBlock, Section and the three shared clause
 * methods. Deliberately narrow - it understands exactly the shapes that file uses, and throws
 * loudly rather than guessing if it is given anything else.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = path.join(
  REPO_ROOT, 'DreamCleaningBackend', 'DreamCleaningBackend',
  'Helpers', 'Commercial', 'CommercialPolicyDocument.cs');
const TARGET = path.join(
  __dirname, '..', 'src', 'app', 'shared', 'commercial-policies',
  'commercial-policy.content.ts');

const source = fs.readFileSync(SOURCE, 'utf8');

/** Index of the `}` matching the `{` at `open`, skipping over string literals. */
function matchBrace(text, open) {
  if (text[open] !== '{') throw new Error(`expected { at ${open}, found ${text[open]}`);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  throw new Error('unbalanced braces');
}

/** The initializer body of `=> new() { ... }` for the named factory method. */
function objectInitializer(methodName) {
  const marker = `public static PolicyDocument ${methodName}() => new()`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`${methodName} not found in ${SOURCE}`);
  const open = source.indexOf('{', start + marker.length);
  return source.slice(open, matchBrace(source, open) + 1);
}

/** The `new[] { ... }` array returned by one of the shared clause methods. */
function clauseArray(methodName) {
  const marker = `private static PolicyBlock[] ${methodName}() => new[]`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`${methodName} not found in ${SOURCE}`);
  const open = source.indexOf('{', start + marker.length);
  // Sliced from `new[]`, not from the brace: toJs recognises a collection by that token, and a
  // bare `{` would be read as an object initializer.
  return source.slice(start + marker.indexOf('new[]'), matchBrace(source, open) + 1);
}

/** `public const string NAME = "..." [+ "..."];` */
function constant(name) {
  const marker = new RegExp(`public const string ${name} =\\s*([\\s\\S]*?);\\n`, 'm');
  const found = source.match(marker);
  if (!found) throw new Error(`const ${name} not found in ${SOURCE}`);
  // eslint-disable-next-line no-eval
  return eval(found[1].replace(/\s*\+\s*/g, ' + '));
}

/**
 * C# initializer syntax to the equivalent JavaScript expression.
 *
 * The one thing it has to get right is which braces are ARRAYS. `new[] { ... }` and
 * `new List<T> { ... }` are collections and become `[ ... ]`; the outer `new() { ... }` is an
 * object and stays `{ ... }`. Converting every brace the same way turns the document itself into
 * an array of labelled nothing, so the collection braces are located by their `new` token first
 * and only those are swapped. Braces inside string literals are never touched.
 */
function toJs(csharp) {
  const collectionOpener = /new(?:\[\]|\s+List<[^>]+>)\s*/g;
  const arrayBraces = new Set();

  for (let m; (m = collectionOpener.exec(csharp)) !== null; ) {
    const open = m.index + m[0].length;
    if (csharp[open] !== '{') continue;        // not an initializer - leave it alone
    arrayBraces.add(open);
    arrayBraces.add(matchBrace(csharp, open));
  }

  let out = '';
  for (let i = 0; i < csharp.length; i++) {
    const ch = csharp[i];
    if (ch === '"') {                           // copy string literals verbatim
      const start = i++;
      while (i < csharp.length && csharp[i] !== '"') i += csharp[i] === '\\' ? 2 : 1;
      out += csharp.slice(start, i + 1);
      continue;
    }
    if (ch === '{') out += arrayBraces.has(i) ? '[' : '{';
    else if (ch === '}') out += arrayBraces.has(i) ? ']' : '}';
    else out += ch;
  }

  return out
    .replace(collectionOpener, '')
    // Object-initializer properties: `Key = value,` -> `key: value,`
    .replace(/^(\s*)([A-Z]\w*) = /gm, (_, indent, name) =>
      `${indent}${name[0].toLowerCase()}${name.slice(1)}: `);
}

const shims = {
  LegalIdentity: constant('LegalIdentity'),
  ContactEmail: constant('ContactEmail'),
  ContactPhone: constant('ContactPhone'),
  Website: constant('Website'),
  PrecedenceNote: constant('PrecedenceNote'),
  Version: constant('Version'),
  EffectiveDate: constant('EffectiveDate'),
  CompleteKey: constant('CompleteKey'),
  CancellationKey: constant('CancellationKey'),
  CompletePdfFileName: constant('CompletePdfFileName'),
  CancellationPdfFileName: constant('CancellationPdfFileName'),
  PolicyBlock: {
    P: text => ({ kind: 'Paragraph', text }),
    B: text => ({ kind: 'Bullet', text }),
    N: text => ({ kind: 'Note', text })
  },
  Section: (number, title, anchor, blocks) => ({ number, title, anchor, blocks })
};

// The three shared clause methods, evaluated once and reused - which is precisely the property
// the generated file has to preserve: the standalone document's sections ARE the complete
// document's sections 4, 5 and 7, not copies of them.
for (const name of ['CancellationClauses', 'TerminationClauses', 'PrepaidAndRefundClauses']) {
  shims[name] = () => evaluate(toJs(clauseArray(name)));
}

function evaluate(js) {
  const names = Object.keys(shims);
  // eslint-disable-next-line no-new-func
  const fn = new Function(...names, `"use strict"; return (${js});`);
  return fn(...names.map(n => shims[n]));
}

const documents = {
  complete: evaluate(toJs(objectInitializer('BuildComplete'))),
  cancellation: evaluate(toJs(objectInitializer('BuildCancellationAndTermination')))
};

// A guard rather than a hope: if the rewrite above ever silently drops a block, this is what says
// so, at generation time, instead of a policy page missing a paragraph nobody reads closely.
for (const [key, doc] of Object.entries(documents)) {
  if (!doc.sections?.length || !doc.intro?.length || !doc.version) {
    throw new Error(`generated ${key} document looks empty - the C# shape has changed`);
  }
  for (const section of doc.sections) {
    if (!section.number || !section.title || !section.anchor || !section.blocks?.length) {
      throw new Error(`generated ${key} document has an incomplete section: ${section.title}`);
    }
    for (const block of section.blocks) {
      if (!block.text || !['Paragraph', 'Bullet', 'Note'].includes(block.kind)) {
        throw new Error(`generated ${key} document has a malformed block in ${section.title}`);
      }
    }
  }
}

// Emitted as a .ts module whose body is valid JSON. A .ts rather than a .json because importing
// JSON would mean turning on resolveJsonModule for the whole app to carry one file; valid JSON
// inside it because the backend's mirror test then reads the object with a plain deserializer
// instead of having to understand TypeScript.
const banner = `// GENERATED FILE - DO NOT EDIT.
//
// The published commercial policies, generated from the canonical backend source by
//   node scripts/generate-commercial-policy-content.js
// Canonical source:
//   DreamCleaningBackend/DreamCleaningBackend/Helpers/Commercial/CommercialPolicyDocument.cs
//
// The same content renders the two downloadable PDFs on the backend, so editing this file by hand
// makes the page disagree with the documents a client downloads. Change the C# and regenerate;
// CommercialPolicyContentTests fails the build if the two drift apart.

import { CommercialPolicyContent } from './commercial-policy.types';

export const COMMERCIAL_POLICY_CONTENT: CommercialPolicyContent = `;

fs.mkdirSync(path.dirname(TARGET), { recursive: true });
fs.writeFileSync(TARGET, banner + JSON.stringify(documents, null, 2) + ';\n', 'utf8');
fs.rmSync(TARGET.replace(/\.ts$/, '.json'), { force: true });

const count = Object.values(documents)
  .reduce((n, d) => n + d.sections.reduce((m, s) => m + s.blocks.length, 0), 0);
console.log(`Wrote ${path.relative(process.cwd(), TARGET)} - 2 documents, ${count} blocks.`);

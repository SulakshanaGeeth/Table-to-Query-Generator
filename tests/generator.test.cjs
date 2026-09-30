#!/usr/bin/env node
'use strict';

// From the project directory, run: node tests/generator.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(sourcePath, 'utf8');
const coreScript = html.match(/<script\b(?=[^>]*\bid=["']query-core["'])[^>]*>([\s\S]*?)<\/script>/i);
assert.ok(coreScript, 'index.html must contain a script with id="query-core"');

const { generateStatements, parseTsv, nextColumnName } = new vm.Script(
  `${coreScript[1]}\n;({ generateStatements, parseTsv, nextColumnName });`,
  { filename: 'index.html#query-core' },
).runInNewContext(Object.create(null), { timeout: 1000 });

// Convert VM values to this realm before comparing their array prototypes.
const plain = value => JSON.parse(JSON.stringify(value));
const equal = (actual, expected) => assert.deepEqual(plain(actual), expected);
const fails = callback => assert.throws(callback, error =>
  typeof error?.message === 'string' && error.message.trim().length > 0,
  'Invalid input must throw an Error with a readable message',
);

const columns = ['columnA', 'columnB'];
const fruitRows = [['Apple', '100'], ['Bannana', '200']];
const template = 'Update fruit SET {{columnB}} where {{columnA}}';
const cases = [
  ['exact Apple/Bannana example', () => {
    assert.equal(generateStatements(columns, fruitRows, template).join('\n'),
      'Update fruit SET 100 where Apple\nUpdate fruit SET 200 where Bannana');
  }],
  ['repeated references and whitespace inside placeholders', () => {
    equal(generateStatements(columns, [['Apple', '100']],
      '{{ columnA }} / {{columnA}} / {{\tcolumnB\t}}'), ['Apple / Apple / 100']);
  }],
  ['case-sensitive references', () => {
    fails(() => generateStatements(columns, fruitRows, '{{ColumnA}}'));
    equal(generateStatements(['A', 'a'], [['upper', 'lower']], '{{A}} {{a}}'), ['upper lower']);
  }],
  ['empty and whitespace-only templates are rejected', () => {
    for (const value of ['', ' \n\t']) fails(() => generateStatements(columns, fruitRows, value));
  }],
  ['empty column names are rejected', () => {
    for (const value of ['', '   ']) fails(() => generateStatements([value, 'columnB'], fruitRows, template));
  }],
  ['duplicate column names after trimming are rejected', () => {
    fails(() => generateStatements(['columnA', ' columnA '], fruitRows, '{{columnA}}'));
  }],
  ['braces in column names are rejected', () => {
    for (const value of ['column{A', 'columnA}', '{{columnA}}']) {
      fails(() => generateStatements([value, 'columnB'], fruitRows, '{{columnB}}'));
    }
  }],
  ['unknown references are rejected', () => {
    fails(() => generateStatements(columns, fruitRows, '{{missingColumn}}'));
  }],
  ['no populated rows are rejected', () => {
    fails(() => generateStatements(columns, [], template));
    fails(() => generateStatements(columns, [['', ''], ['', '']], template));
  }],
  ['blank rows are skipped and partial rows retain empty cells', () => {
    equal(generateStatements(columns,
      [['', ''], ['Apple', '100'], ['', ''], ['Banana', ''], ['', '200']],
      '{{columnA}}:{{columnB}}'), ['Apple:100', 'Banana:', ':200']);
  }],
  ['cell whitespace is preserved', () => {
    equal(generateStatements(columns, [['  Apple  ', ' 100 ']], '{{columnA}}|{{columnB}}'),
      ['  Apple  | 100 ']);
  }],
  ['whitespace-only rows are skipped', () => {
    equal(generateStatements(columns, [[' \t', '\n '], ['Apple', '100'], [' ', '']], template),
      ['Update fruit SET 100 where Apple']);
  }],
  ['inserted values are literal and are not substituted twice', () => {
    const literal = '{{columnB}} $& $1 $` $\' "quoted" <img src=x onerror=alert(1)>';
    equal(generateStatements(columns, [[literal, '100']], '{{columnA}} / {{columnB}}'),
      [`${literal} / 100`]);
  }],
  ['multiline templates retain their line breaks', () => {
    equal(generateStatements(columns, fruitRows, 'UPDATE fruit\nSET {{columnB}}\nWHERE {{columnA}};'),
      ['UPDATE fruit\nSET 100\nWHERE Apple;', 'UPDATE fruit\nSET 200\nWHERE Bannana;']);
  }],
  ['templates without references repeat for each populated row', () => {
    equal(generateStatements(columns, fruitRows, 'SELECT 1;'), ['SELECT 1;', 'SELECT 1;']);
  }],
  ['columns with spaces can be referenced', () => {
    equal(generateStatements(['Fruit name', 'Price'], [['Apple', '100']],
      '{{ Fruit name }}: {{Price}}'), ['Apple: 100']);
  }],
  ['CRLF spreadsheet paste retains rectangular empty cells', () => {
    equal(parseTsv('Apple\t100\t\r\nBannana\t\t200\r\n'),
      [['Apple', '100', ''], ['Bannana', '', '200']]);
  }],
  ['a single trailing line break does not add an extra row', () => {
    for (const newline of ['\n', '\r\n']) {
      equal(parseTsv(`Apple\t100${newline}`), [['Apple', '100']]);
    }
  }],
  ['quoted spreadsheet fields preserve tabs, newlines and escaped quotes', () => {
    equal(parseTsv('"Apple\tpear"\t"line 1\nline 2"\t"He said ""hello"""\r\n'),
      [['Apple\tpear', 'line 1\nline 2', 'He said "hello"']]);
  }],
  ['quoted empty cells remain empty', () => {
    equal(parseTsv('""\t100\nBannana\t""'), [['', '100'], ['Bannana', '']]);
  }],
  ['unclosed quoted spreadsheet fields are rejected', () => {
    fails(() => parseTsv('"Apple\t100\r\nBannana\t200'));
  }],
  ['column naming starts at A and fills unused names', () => {
    assert.equal(nextColumnName([]), 'columnA');
    assert.equal(nextColumnName(['columnA', 'columnC']), 'columnB');
  }],
  ['column naming considers trimmed collisions occupied', () => {
    assert.equal(nextColumnName([' columnA ', 'columnB', 'unrelated']), 'columnC');
  }],
  ['column naming continues beyond Z', () => {
    const alphabet = Array.from({ length: 26 }, (_, index) => `column${String.fromCharCode(65 + index)}`);
    assert.equal(nextColumnName(alphabet), 'columnAA');
    assert.equal(nextColumnName([...alphabet, 'columnAA']), 'columnAB');
  }],
];

let failed = 0;
for (const [name, run] of cases) {
  try {
    run();
  } catch (error) {
    failed += 1;
    console.error(`FAIL: ${name}\n${error.stack || error}`);
  }
}
console.log(`${cases.length - failed}/${cases.length} generator checks passed.`);
if (failed) process.exitCode = 1;

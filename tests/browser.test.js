// Browser smoke checks. The verification runner appends this to a copy of index.html.
window.addEventListener('pageshow', async () => {
  const results = [];
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const equal = (actual, expected) => assert(actual === expected, `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  const fill = (selector, value) => {
    const input = $(selector);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const cell = (row, column) => `.cell[data-row="${row}"][data-column="${column}"]`;
  const click = selector => $(selector).click();
  const reset = () => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  const paste = (selector, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    $(selector).dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  };
  const test = async (name, run) => {
    try { await run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  };

  if (location.hash === '#refresh-check') {
    results.push(...JSON.parse(sessionStorage.getItem('rowcraft-test-results') || '[]'));
    await test('real page refresh clears table, template and output', () => {
      equal($$('.cell').length, 4);
      assert($$('.cell').every(input => input.value === ''), 'Cells must be empty after reload');
      equal($('#template').value, 'Update fruit SET {{columnB}} where {{columnA}}');
      equal($('#output').value, '');
    });
    sessionStorage.removeItem('rowcraft-test-results');
    const report = document.createElement('pre');
    report.id = 'browser-test-results';
    report.textContent = JSON.stringify({ total: results.length, passed: results.filter(result => result.passed).length, results }, null, 2);
    document.body.append(report);
    document.title = `Browser tests: ${results.filter(result => result.passed).length}/${results.length}`;
    return;
  }

  await test('initial table and template', () => {
    equal($$('.cell').length, 4);
    equal($('.column-name').value, 'columnA');
    assert($$('.cell').every(input => input.value === ''), 'Initial data must be empty');
    equal($('#statement-count').textContent, '0 statements');
    assert($('#copy-output').disabled, 'Copy must start disabled');
  });
  await test('example generates exact expected output', () => {
    click('#load-example');
    equal($('#output').value, 'Update fruit SET 100 where Apple\nUpdate fruit SET 200 where Bannana');
    equal($('#statement-count').textContent, '2 statements');
    assert(!$('#copy-output').disabled, 'Copy must be enabled');
  });
  await test('edits clear stale output', () => {
    fill(cell(0, 1), '150');
    equal($('#output').value, '');
    assert($('#copy-output').disabled, 'Stale results must not be copyable');
    click('#generate');
    assert($('#output').value.startsWith('Update fruit SET 150 where Apple'), 'Generation must use the edit');
  });
  await test('add, rename and remove columns', () => {
    click('#add-column');
    equal($$('.column-name').length, 3);
    equal($('.column-name[data-column="2"]').value, 'columnC');
    fill('.column-name[data-column="2"]', 'quantity');
    assert($$('.reference').some(button => button.textContent === '{{quantity}}'), 'Reference must update after rename');
    fill(cell(0, 2), '5');
    fill('#template', '{{quantity}}');
    click('#generate');
    equal($('#output').value, '5\n');
    click('button[data-action="column"][data-index="2"]');
    click('#generate');
    assert($('#status').classList.contains('error') && $('#status').textContent.includes('quantity'), 'Removed references must produce an error');
    equal($$('.column-name').length, 2);
  });
  await test('empty, duplicate and braced column names are visibly invalid', () => {
    reset();
    for (const name of ['', ' columnA ', 'bad{column']) {
      fill('.column-name[data-column="1"]', name);
      click('#generate');
      equal($('.column-name[data-column="1"]').getAttribute('aria-invalid'), 'true');
      assert($('#status').classList.contains('error'), 'Invalid names must show an error');
    }
  });
  await test('spreadsheet paste expands from the selected cell', () => {
    reset();
    fill(cell(0, 0), 'Keep me');
    paste(cell(1, 1), 'Apple\t100\t\r\nBannana\t200\t3\r\n');
    equal($$('.column-name').length, 4);
    equal($$('#data-table tbody tr').length, 3);
    equal($(cell(0, 0)).value, 'Keep me');
    equal($(cell(1, 1)).value, 'Apple');
    equal($(cell(1, 3)).value, '');
    equal($(cell(2, 2)).value, '200');
    equal($(cell(2, 3)).value, '3');
  });
  await test('quoted multiline paste is retained', () => {
    reset();
    paste(cell(0, 0), '"Apple\npear"\t"He said ""hello"""\r\n');
    equal($(cell(0, 0)).value, 'Apple\npear');
    equal($(cell(0, 1)).value, 'He said "hello"');
  });
  await test('malformed paste preserves existing data', () => {
    const before = $$('.cell').map(input => input.value).join('|');
    paste(cell(0, 0), '"Apple\t100\r\nBannana\t200');
    equal($$('.cell').map(input => input.value).join('|'), before);
    assert($('#status').textContent.includes('unfinished quoted cell'), 'Malformed paste must be explained');
  });
  await test('reference buttons insert at the saved caret', () => {
    reset();
    fill('#template', 'Before After');
    $('#template').focus();
    $('#template').setSelectionRange(7, 7);
    $('#template').dispatchEvent(new Event('select'));
    click('.reference');
    equal($('#template').value, 'Before {{columnA}}After');
  });
  await test('literal values never become markup or second-pass substitutions', () => {
    reset();
    fill(cell(0, 0), '<img src=x onerror=alert(1)> {{columnB}} $&');
    fill(cell(0, 1), '100');
    fill('#template', '{{columnA}}:{{columnB}}');
    click('#generate');
    equal($('#output').value, '<img src=x onerror=alert(1)> {{columnB}} $&:100');
    equal($$('img').length, 0);
  });
  await test('copy success handler uses the current full output', async () => {
    let copied;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text; } } });
    click('#copy-output');
    await Promise.resolve();
    equal(copied, $('#output').value);
    equal($('#status').textContent, 'Copied to clipboard.');
  });
  await test('copy rejection selects output for manual copying', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Unavailable'); } } });
    click('#copy-output');
    await Promise.resolve();
    equal(document.activeElement, $('#output'));
    equal($('#output').selectionStart, 0);
    equal($('#output').selectionEnd, $('#output').value.length);
    assert($('#status').textContent.includes('output is selected'), 'Copy fallback must be explained');
    delete navigator.clipboard;
  });
  await test('keyboard generation and multiline templates', () => {
    reset();
    fill(cell(0, 0), 'Apple');
    fill(cell(0, 1), '100');
    fill('#template', 'UPDATE fruit\nSET {{columnB}}\nWHERE {{columnA}};');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    equal($('#output').value, 'UPDATE fruit\nSET 100\nWHERE Apple;');
  });
  await test('blank rows are skipped and empty cells retained', () => {
    reset();
    fill(cell(0, 0), 'Apple');
    fill(cell(1, 0), '   ');
    fill('#template', '{{columnA}}:{{columnB}}');
    click('#generate');
    equal($('#output').value, 'Apple:');
    equal($('#statement-count').textContent, '1 statement');
  });
  await test('add and remove rows including an empty table', () => {
    reset();
    click('#add-row');
    equal($$('#data-table tbody tr').length, 3);
    for (let index = 0; index < 3; index++) click('button[data-action="row"][data-index="0"]');
    equal($$('#data-table tbody tr').length, 0);
    click('#generate');
    assert($('#status').textContent.includes('at least one row'), 'Empty table must show a readable error');
    click('#add-row');
    equal($$('.cell').length, 2);
  });
  await test('wide tables scroll within the page', () => {
    reset();
    for (let index = 0; index < 8; index++) click('#add-column');
    const scroll = $('.table-scroll');
    assert(scroll.scrollWidth > scroll.clientWidth, 'Wide table must overflow its scroll container');
    assert(document.documentElement.scrollWidth <= innerWidth, 'The page itself must not overflow horizontally');
  });

  // Only the test runner stores its result log, so checks survive a real reload.
  sessionStorage.setItem('rowcraft-test-results', JSON.stringify(results));
  location.hash = '#refresh-check';
  location.reload();
}, { once: true });

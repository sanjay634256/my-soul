'use strict';

/**
 * Wiring test — static consistency between the modules, the markup and the
 * static server.
 *
 * A 3D game has a lot of strings that only fail at runtime in a browser we
 * cannot run here: a named import that does not exist is a link-time error
 * that kills the whole page, and a mistyped getElementById returns null and
 * throws on first use. These checks catch both without a browser.
 */

const test = await import('node:test').then((m) => m.default);
const assert = await import('node:assert/strict');
const fs = await import('node:fs');
const path = await import('node:path');

const ROOT = path.join(import.meta.dirname, '..');
const JS = path.join(ROOT, 'js');

const read = (p) => fs.readFileSync(p, 'utf8');
const modules = fs.readdirSync(JS).filter((f) => f.endsWith('.mjs'));

/* ------------------------- export/import matching ----------------------- */

/** Names a module exports, read from its source. */
function exportsOf(src) {
  const out = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_$]+)/gm)) {
    out.add(m[1]);
  }
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) out.add(name);
    }
  }
  if (/^export\s+default/m.test(src)) out.add('default');
  return out;
}

/** Import clauses of the form `import { a, b as c } from './x.mjs'`. */
function importsOf(src) {
  const out = [];
  const re = /import\s+([^;'"]+?)\s+from\s+['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) {
    const clause = m[1].trim();
    const spec = m[2];
    const brace = clause.match(/\{([^}]*)\}/);
    const names = brace
      ? brace[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)
      : [];
    const def = clause.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
    if (def && !def.startsWith('*')) names.push('default');
    const star = clause.match(/\*\s+as\s+([A-Za-z0-9_$]+)/);
    out.push({ spec, names, namespace: star ? star[1] : null });
  }
  return out;
}

test('every module is a non-empty ES module', () => {
  assert.ok(modules.length >= 7, `expected the full module set, found ${modules.join(', ')}`);
  for (const f of modules) {
    const src = read(path.join(JS, f));
    assert.ok(src.length > 500, `${f} is suspiciously small`);
    assert.ok(/^(import|export)/m.test(src), `${f} has no imports or exports`);
  }
});

test('every relative import points at a file that exists', () => {
  for (const f of modules) {
    const src = read(path.join(JS, f));
    for (const imp of importsOf(src)) {
      if (!imp.spec.startsWith('.')) continue;
      const target = path.resolve(JS, imp.spec);
      assert.ok(fs.existsSync(target), `${f} imports missing file "${imp.spec}"`);
    }
  }
});

test('every named import actually exists in its target module', () => {
  // A named import of a non-existent export is a link-time SyntaxError that
  // stops the entire page from loading — the single most expensive typo.
  const cache = new Map();
  const loadExports = (file) => {
    if (!cache.has(file)) cache.set(file, exportsOf(read(file)));
    return cache.get(file);
  };

  // three.js is vendored; check it really is a module with a big surface.
  const vendor = path.join(ROOT, 'vendor', 'three.module.min.js');
  assert.ok(fs.existsSync(vendor), 'vendored three.js is missing');

  let checked = 0;
  for (const f of modules) {
    const src = read(path.join(JS, f));
    for (const imp of importsOf(src)) {
      if (!imp.spec.startsWith('.')) continue;
      const target = path.resolve(JS, imp.spec);
      if (imp.namespace) { checked++; continue; } // namespace imports always resolve
      const have = loadExports(target);
      for (const name of imp.names) {
        assert.ok(have.has(name),
          `${f} imports "${name}" from ${imp.spec}, which does not export it ` +
          `(exports: ${[...have].join(', ')})`);
        checked++;
      }
    }
  }
  assert.ok(checked > 20, `only verified ${checked} imports`);
});

test('the pure modules really are importable in Node (no DOM at load time)', async () => {
  const sim = await import('../js/sim.mjs');
  const layout = await import('../js/layout.mjs');
  assert.ok(sim.CFG && sim.CFG.MAX_SPEED > 0);
  assert.ok(typeof layout.generateCity === 'function');
});

/* ----------------------------- DOM wiring ------------------------------- */

const html = read(path.join(ROOT, 'index.html'));
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const htmlBtns = new Set([...html.matchAll(/data-btn="([^"]+)"/g)].map((m) => m[1]));

test('index.html declares every id the scripts look up', () => {
  let checked = 0;
  for (const f of modules) {
    const src = read(path.join(JS, f));
    for (const m of src.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      assert.ok(htmlIds.has(m[1]),
        `${f} calls getElementById('${m[1]}') but index.html has no such id`);
      checked++;
    }
  }
  assert.ok(checked >= 10, `only checked ${checked} getElementById calls`);
});

test('every touch button in the markup is consumed by the input layer', () => {
  const input = read(path.join(JS, 'input.mjs'));
  assert.ok(htmlBtns.size >= 5, `expected a real touch layout, found ${[...htmlBtns]}`);
  for (const name of htmlBtns) {
    // A control counts as consumed if input.mjs reads it through the button
    // map or grabs the element directly by id (the drive stick does that).
    const referenced = new RegExp(`btns\\.${name}\\b`).test(input) ||
      new RegExp(`['"]${name}['"]`).test(input) ||
      input.includes(`getElementById('touch-${name}')`);
    assert.ok(referenced, `data-btn="${name}" is dead UI — input.mjs never reads it`);
  }
});

test('the input layer never reads a button that does not exist', () => {
  const input = read(path.join(JS, 'input.mjs'));
  for (const m of input.matchAll(/btns\.([A-Za-z0-9_$]+)/g)) {
    const name = m[1];
    if (name === 'down') continue; // property access, not a button name
    assert.ok(htmlBtns.has(name),
      `input.mjs reads btns.${name} but no data-btn="${name}" exists in index.html`);
  }
});

test('index.html links only files that exist on disk', () => {
  const refs = [
    ...[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]),
  ].filter((r) => !r.startsWith('data:') && !r.startsWith('http'));
  assert.ok(refs.length >= 2, 'expected at least a stylesheet and the entry script');
  for (const r of refs) {
    assert.ok(fs.existsSync(path.join(ROOT, r)), `index.html references missing file "${r}"`);
  }
});

test('the entry point is loaded as an ES module', () => {
  assert.match(html, /<script[^>]+type="module"[^>]+src="js\/main\.mjs"/,
    'main.mjs must be loaded with type="module" or its imports will not resolve');
});

/* --------------------------- static server ------------------------------ */

test('the static server has a MIME type for every file it could serve', () => {
  const server = read(path.join(ROOT, 'server.js'));
  const types = new Set(
    [...server.matchAll(/'(\.[a-z0-9]+)':\s*'/g)].map((m) => m[1]),
  );
  const served = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else served.add(path.extname(e.name).toLowerCase());
    }
  };
  walk(ROOT);
  served.delete('');
  for (const ext of served) {
    assert.ok(types.has(ext), `server.js has no MIME type for "${ext}" files`);
  }
  // The critical one: without a JS mime type browsers refuse to run modules.
  assert.match(server, /'\.mjs':\s*'text\/javascript/,
    '.mjs must be served as text/javascript or module imports are blocked');
});

test('the vendored three.js is a real build, not a stub', () => {
  const src = read(path.join(ROOT, 'vendor', 'three.module.min.js'));
  assert.ok(src.length > 500_000, `three.js is only ${src.length} bytes`);
  assert.match(src, /Copyright.*Three\.js Authors/s);
  assert.ok(/WebGLRenderer/.test(src), 'does not look like a full three.js build');
});

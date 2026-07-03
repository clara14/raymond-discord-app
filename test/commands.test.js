// ============================================================
// commands.test.js — The loader smoke test.
//
// Not a behavior test: it simply imports EVERY file under
// src/commands/ through the same loader the bot uses at startup
// and checks the contract each command must honor. This catches
// the whole class of "the bot won't even boot" mistakes — a
// syntax error, a broken import path, a missing export, two
// commands claiming the same name — without needing Discord,
// Postgres, or any API key. If this file passes, startup's
// command-loading phase will too.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCommandModules } from '../src/handlers/commandHandler.js';

// Load once, assert many times. A file that fails to import throws right
// here — node:test reports it as this suite failing, with the real
// import error as the cause, which is exactly the signal we want.
const modules = await loadCommandModules();

test('the loader finds command files at all', () => {
  // Guards against the failure mode where a path/glob change makes the
  // loader silently find NOTHING — every shape check below would
  // vacuously pass over an empty list.
  assert.ok(modules.length > 0, 'no command files were discovered');
});

test('every command file exports data + execute in the required shape', () => {
  for (const { category, file, module } of modules) {
    const where = `${category}/${file}`;

    // The two exports the router depends on. `in` matches the loader's
    // own guard — a file missing either would be skipped at startup
    // (a warning humans can miss); here it's a hard failure.
    assert.ok('data' in module, `${where}: missing "data" export`);
    assert.ok('execute' in module, `${where}: missing "execute" export`);
    assert.equal(typeof module.execute, 'function', `${where}: execute must be a function`);

    // data must behave like a SlashCommandBuilder: a non-empty name (the
    // client.commands key) and a toJSON() (what npm run deploy sends to
    // Discord). Checking the shape rather than instanceof keeps the test
    // decoupled from discord.js internals.
    assert.equal(typeof module.data?.name, 'string', `${where}: data.name must be a string`);
    assert.ok(module.data.name.length > 0, `${where}: data.name is empty`);
    assert.equal(typeof module.data.toJSON, 'function', `${where}: data.toJSON missing — deploy would fail`);

    // Discord rejects registration for names outside its rules
    // (1-32 chars, lowercase letters/digits/underscore/dash). Catching
    // it here beats a cryptic 400 from npm run deploy.
    assert.match(
      module.data.name,
      /^[a-z0-9_-]{1,32}$/,
      `${where}: "${module.data.name}" violates Discord's command-name rules`,
    );

    // Optional interaction handlers, when present, must be functions —
    // the interactionCreate router calls them without further checks.
    for (const handler of ['handleButton', 'handleModal']) {
      if (handler in module) {
        assert.equal(typeof module[handler], 'function', `${where}: ${handler} must be a function`);
      }
    }
  }
});

test('command names are unique across all categories', () => {
  // client.commands is a Map keyed by name — a duplicate wouldn't error at
  // startup, it would silently REPLACE the earlier command. This makes the
  // collision loud instead.
  const seen = new Map(); // name → where it was first defined
  for (const { category, file, module } of modules) {
    const name = module.data?.name;
    if (!name) continue; // shape problems are the previous test's job
    assert.ok(
      !seen.has(name),
      `duplicate command name "${name}": ${seen.get(name)} and ${category}/${file}`,
    );
    seen.set(name, `${category}/${file}`);
  }
});

test('every command serializes for deployment without throwing', () => {
  // npm run deploy calls toJSON() on every command; a builder left in an
  // invalid state (e.g. an option added with a too-long description)
  // throws only at that moment. Serializing here moves the explosion
  // from deploy time to test time.
  for (const { category, file, module } of modules) {
    if (typeof module.data?.toJSON !== 'function') continue;
    const json = module.data.toJSON();
    assert.equal(typeof json, 'object', `${category}/${file}: toJSON returned a non-object`);
    assert.equal(json.name, module.data.name, `${category}/${file}: serialized name mismatch`);
  }
});

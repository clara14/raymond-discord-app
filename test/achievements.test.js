// ============================================================
// achievements.test.js — Contract tests for the achievement
// catalog (mirroring commands.test.js: the catalog is config
// that must honor a shape, and a typo'd tier or trigger would
// otherwise fail silently — the achievement just never fires).
// Plus behavior tests for the getting-started checks and the
// pure announcement embed builder.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACHIEVEMENTS, TIERS, TRIGGERS } from '../src/data/achievements.js';
import { achievementEmbed } from '../src/lib/achievements.js';

test('the catalog is non-empty', () => {
  // Same vacuous-pass guard as the loader smoke test: every shape check
  // below iterates the catalog, so an accidentally-empty export must be
  // its own loud failure.
  assert.ok(ACHIEVEMENTS.length > 0, 'the achievement catalog is empty');
});

test('every definition honors the catalog contract', () => {
  for (const def of ACHIEVEMENTS) {
    const where = `achievement "${def.id ?? '<no id>'}"`;

    // id is the database key — stable snake_case, no surprises.
    assert.equal(typeof def.id, 'string', `${where}: id must be a string`);
    assert.match(def.id, /^[a-z0-9_]+$/, `${where}: id must be snake_case`);

    // Display identity: all three strings, all non-empty.
    for (const field of ['name', 'emoji', 'description']) {
      assert.equal(typeof def[field], 'string', `${where}: ${field} must be a string`);
      assert.ok(def[field].length > 0, `${where}: ${field} is empty`);
    }

    // tier must be a real key of TIERS — a typo here would crash the
    // announcement embed at runtime, so it fails at test time instead.
    assert.ok(def.tier in TIERS, `${where}: unknown tier "${def.tier}"`);

    // secret is used in boolean logic; enforce the type, not truthiness.
    assert.equal(typeof def.secret, 'boolean', `${where}: secret must be a boolean`);

    // Every subscribed trigger must be one the wiring actually fires —
    // an unknown trigger means the check can never run.
    assert.ok(Array.isArray(def.triggers) && def.triggers.length > 0,
      `${where}: triggers must be a non-empty array`);
    for (const t of def.triggers) {
      assert.ok(TRIGGERS.has(t), `${where}: unknown trigger "${t}"`);
    }

    assert.equal(typeof def.check, 'function', `${where}: check must be a function`);
  }
});

test('achievement ids are unique', () => {
  // The awards table keys on id; a duplicate wouldn't error — the two
  // definitions would silently share one award. Loud beats silent.
  const seen = new Set();
  for (const def of ACHIEVEMENTS) {
    assert.ok(!seen.has(def.id), `duplicate achievement id "${def.id}"`);
    seen.add(def.id);
  }
});

test('tier metadata is complete and ranks are distinct', () => {
  const ranks = new Set();
  for (const [key, tier] of Object.entries(TIERS)) {
    assert.equal(typeof tier.rank, 'number', `tier ${key}: rank must be a number`);
    assert.equal(typeof tier.color, 'number', `tier ${key}: color must be a number (embed int)`);
    assert.ok(tier.label.length > 0, `tier ${key}: label is empty`);
    assert.ok(tier.marker.length > 0, `tier ${key}: marker is empty`);
    // Ranks order announcements (fanciest wins); ties would make that
    // ordering nondeterministic.
    assert.ok(!ranks.has(tier.rank), `tier ${key}: duplicate rank ${tier.rank}`);
    ranks.add(tier.rank);
  }
});

test('the getting-started checks qualify on their bare trigger event', async () => {
  // Phase 1 checks are event-only "first time" awards: the trigger firing
  // IS the qualification (the table's composite PK supplies the "first").
  // Every one must return truthy with an arbitrary event and no queries.
  for (const def of ACHIEVEMENTS.filter((d) => d.tier === 'common')) {
    const qualifies = await def.check({ event: {}, queries: {} });
    assert.ok(qualifies, `${def.id}: check should qualify when its trigger fires`);
  }
});

test('achievementEmbed uses the fanciest tier color in a batch', () => {
  const common = ACHIEVEMENTS[0];
  // A synthetic legendary keeps this test independent of which tiers the
  // shipped catalog happens to contain.
  const legendary = { ...common, id: 'test_legendary', name: 'Test Trophy', tier: 'legendary' };

  const embed = achievementEmbed('Cesar', [common, legendary]);
  assert.equal(embed.data.color, TIERS.legendary.color);
});

test('achievementEmbed names every earned achievement', () => {
  const batch = ACHIEVEMENTS.slice(0, 3);
  const embed = achievementEmbed('Cesar', batch);
  for (const def of batch) {
    assert.ok(
      embed.data.description.includes(def.name),
      `announcement is missing "${def.name}"`,
    );
  }
  // Singular/plural phrasing: three trophies should say "3 achievements".
  assert.ok(embed.data.description.includes('3 achievements'));
});

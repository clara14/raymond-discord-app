// ============================================================
// achievements.js (command) — The trophy case. Earned badges
// grouped by tier with dates and server rarity, or the locked
// list with descriptions as goals (secrets stay hidden).
// Ephemeral by design: the flex is the announcement when you
// EARN one; browsing is private.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getEarned, getRarity } from '../../database/achievements.js';
import { ACHIEVEMENTS, TIERS } from '../../data/achievements.js';

export const data = new SlashCommandBuilder()
  .setName('achievements')
  .setDescription('Browse the trophy case — yours, someone else\'s, or what\'s still locked.')
  .addUserOption((o) =>
    o.setName('user').setDescription('Whose trophies (default: you)').setRequired(false),
  )
  .addStringOption((o) =>
    o
      .setName('view')
      .setDescription('Earned trophies (default) or the still-locked goals')
      .setRequired(false)
      .addChoices(
        { name: 'Earned', value: 'earned' },
        { name: 'Locked', value: 'locked' },
      ),
  );

// Tier keys ordered fanciest-first, derived from the ranks so a new tier
// in the catalog automatically sorts correctly here.
const TIER_ORDER = Object.keys(TIERS).sort((a, b) => TIERS[b].rank - TIERS[a].rank);

// Groups a list of definitions into embed fields, one per (non-empty)
// tier, with a caller-supplied line renderer. Shared by both views.
function tierFields(defs, renderLine) {
  const fields = [];
  for (const tier of TIER_ORDER) {
    const inTier = defs.filter((d) => d.tier === tier);
    if (inTier.length === 0) continue;
    fields.push({
      name: `${TIERS[tier].marker} ${TIERS[tier].label} (${inTier.length})`,
      value: inTier.map(renderLine).join('\n'),
    });
  }
  return fields;
}

export async function execute(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const view = interaction.options.getString('view') ?? 'earned';

  const earnedRows = await getEarned(interaction.guildId, target.id);
  // earned_at per id, for the date annotations in the trophy case.
  const earnedAt = new Map(earnedRows.map((r) => [r.achievement_id, r.earned_at]));

  if (view === 'locked') {
    // The unearned list is a goal sheet — descriptions tell you HOW.
    // Secrets show only a placeholder until earned (that's the fun).
    const locked = ACHIEVEMENTS.filter((d) => !earnedAt.has(d.id));
    if (locked.length === 0) {
      await interaction.reply({
        content: '👑 Nothing left to earn. You have them all.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(0x95a5a6)
      .setTitle(`🔒 Locked achievements — ${locked.length} to go`)
      .addFields(
        tierFields(locked, (d) =>
          d.secret
            ? '❓ **???** — *secret achievement*'
            : `${d.emoji} **${d.name}** — ${d.description}`,
        ),
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // --- Earned view (the trophy case) ---
  // Ignore ids no longer in the catalog (a definition was retired) so a
  // stale award can't crash the display.
  const earned = ACHIEVEMENTS.filter((d) => earnedAt.has(d.id));

  if (earned.length === 0) {
    await interaction.reply({
      content:
        target.id === interaction.user.id
          ? 'No trophies yet — `/daily` is the easiest first one. See the goals with `/achievements view:Locked`.'
          : `${target.username} has no trophies yet.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Server rarity ("held by 2/9 members") in one GROUP BY; the
  // denominator is the guild's member count (bots included — close
  // enough for bragging rights).
  const rarity = await getRarity(interaction.guildId);
  const members = interaction.guild?.memberCount ?? 0;

  const lines = (d) => {
    const when = Math.floor(new Date(earnedAt.get(d.id)).getTime() / 1000);
    const holders = rarity.get(d.id) ?? 1;
    return `${d.emoji} **${d.name}** · <t:${when}:d> · ${holders}/${members} members`;
  };

  // The case takes the color of the user's fanciest earned tier.
  const fanciest = earned.reduce((best, d) =>
    TIERS[d.tier].rank > TIERS[best.tier].rank ? d : best,
  );

  const embed = new EmbedBuilder()
    .setColor(TIERS[fanciest.tier].color)
    .setAuthor({ name: target.tag, iconURL: target.displayAvatarURL() })
    .setTitle(`🏆 Trophy case — ${earned.length}/${ACHIEVEMENTS.length}`)
    .addFields(tierFields(earned, lines));

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

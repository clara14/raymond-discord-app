// ============================================================
// birthday.js (command) — Register, remove, and browse
// birthdays. Self-declared ONLY: there is deliberately no way
// to set someone else's (the bot never stores third-party
// personal data). The daily task does the actual celebrating.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import {
  setBirthday,
  removeBirthday,
  listBirthdays,
  getDbToday,
} from '../../database/birthdays.js';
import { isValidBirthday, daysUntilBirthday } from '../../lib/birthdays.js';
import { checkAchievements } from '../../database/achievements.js';
import { announceAchievements } from '../../lib/achievements.js';
import { BIRTHDAY, formatCurrency } from '../../config.js';

// Month names for the choice option — friendlier than typing numbers,
// and it makes invalid months unrepresentable.
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const data = new SlashCommandBuilder()
  .setName('birthday')
  .setDescription('Birthdays: the bot celebrates with an announcement and a monies gift.')
  .addSubcommand((sc) =>
    sc
      .setName('set')
      .setDescription('Set YOUR birthday (self-declared only).')
      .addStringOption((o) =>
        o
          .setName('month')
          .setDescription('Birthday month')
          .setRequired(true)
          .addChoices(...MONTHS.map((name, i) => ({ name, value: String(i + 1) }))),
      )
      .addIntegerOption((o) =>
        o
          .setName('day')
          .setDescription('Birthday day')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(31),
      )
      .addIntegerOption((o) =>
        o
          .setName('year')
          .setDescription('Birth year — ONLY if you want your age shown in announcements')
          .setRequired(false)
          .setMinValue(1900)
          .setMaxValue(2100),
      ),
  )
  .addSubcommand((sc) =>
    sc.setName('remove').setDescription('Remove your birthday (deletes the record).'),
  )
  .addSubcommand((sc) =>
    sc.setName('next').setDescription('The next few upcoming birthdays in this server.'),
  )
  .addSubcommand((sc) =>
    sc.setName('list').setDescription('All registered birthdays, ordered by upcoming.'),
  );

export async function execute(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'Birthdays only work in a server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const sub = interaction.options.getSubcommand();
  if (sub === 'set') return handleSet(interaction);
  if (sub === 'remove') return handleRemove(interaction);
  if (sub === 'next') return handleUpcoming(interaction, 3);
  if (sub === 'list') return handleUpcoming(interaction, Infinity);
}

// --- /birthday set ---
async function handleSet(interaction) {
  const month = Number(interaction.options.getString('month'));
  const day = interaction.options.getInteger('day');
  const year = interaction.options.getInteger('year');

  // Discord bounded day to 1–31; the real calendar is stricter (no
  // Apr 31, no Feb 30 — Feb 29 is a legitimate leapling birthday).
  if (!isValidBirthday(month, day)) {
    await interaction.reply({
      content: `${MONTHS[month - 1]} ${day} isn't a real date. Nice try.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await setBirthday(interaction.guildId, interaction.user.id, month, day, year);

  const feb29Note =
    month === 2 && day === 29
      ? ' (in non-leap years you celebrate on March 1)'
      : '';
  await interaction.reply({
    content:
      `🎂 Saved: **${MONTHS[month - 1]} ${day}**${year ? ` (age will be shown)` : ''}.` +
      ` You'll be celebrated at midnight server time${feb29Note} — ` +
      `with ${formatCurrency(BIRTHDAY.gift)} on the house. ` +
      'Remove it anytime with `/birthday remove`.',
    flags: MessageFlags.Ephemeral,
  });

  // Achievement check after the row landed.
  const earned = await checkAchievements(interaction.guildId, interaction.user.id, 'birthday_set', {
    month, day,
  });
  await announceAchievements(interaction, earned);
}

// --- /birthday remove ---
async function handleRemove(interaction) {
  const removed = await removeBirthday(interaction.guildId, interaction.user.id);
  await interaction.reply({
    content: removed
      ? '🗑️ Birthday removed. The bot has forgotten it entirely.'
      : 'You don\'t have a birthday registered.',
    flags: MessageFlags.Ephemeral,
  });
}

// --- /birthday next & list (same sort, different length) ---
async function handleUpcoming(interaction, limit) {
  const rows = await listBirthdays(interaction.guildId);
  if (rows.length === 0) {
    await interaction.reply({
      content: 'No birthdays registered yet. Be the first: `/birthday set`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Sort by days-until using the DB's calendar date — the pure helper
  // handles the year wrap and the Feb 29 rule.
  const today = await getDbToday();
  const sorted = rows
    .map((r) => ({ ...r, inDays: daysUntilBirthday(r.month, r.day, today) }))
    .sort((a, b) => a.inDays - b.inDays)
    .slice(0, limit === Infinity ? rows.length : limit);

  const lines = sorted.map((r) => {
    // A Discord timestamp renders "in 3 days" in each viewer's locale.
    // Anchored to UTC noon of the celebration day so no viewer's
    // timezone shifts it across a date boundary.
    const target = new Date(Date.UTC(today.year, today.month - 1, today.day, 12) + r.inDays * 86_400_000);
    const label =
      r.inDays === 0 ? '**today!** 🎉' : `<t:${Math.floor(target.getTime() / 1000)}:R>`;
    return `${MONTHS[r.month - 1]} ${r.day} — <@${r.user_id}> (${label})`;
  });

  const embed = new EmbedBuilder()
    .setColor(0xe91e63)
    .setTitle(limit === Infinity ? '🎂 All registered birthdays' : '🎂 Upcoming birthdays')
    .setDescription(lines.join('\n').slice(0, 4000));

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// ============================================================
// remindme.js (command) — Set, list, and cancel reminders.
// Durations only ("in 2h"), no absolute times: <t:...:F>
// timestamps render in each READER's timezone, so the bot never
// has to know anyone's clock. Delivery is the scheduler's job.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { createReminder, listPending, cancelReminder } from '../../database/reminders.js';
import { parseDuration } from '../../lib/duration.js';
import { checkAchievements } from '../../database/achievements.js';
import { announceAchievements } from '../../lib/achievements.js';
import { REMINDERS, formatDuration } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('remindme')
  .setDescription('The bot pings you with your message after a delay.')
  .addSubcommand((sc) =>
    sc
      .setName('in')
      .setDescription('Set a reminder, e.g. "10m", "1h30m", "2d".')
      .addStringOption((o) =>
        o
          .setName('duration')
          .setDescription('How long from now — e.g. 45m, 1h30m, 2d, 1w')
          .setRequired(true)
          .setMaxLength(50),
      )
      .addStringOption((o) =>
        o
          .setName('message')
          .setDescription('What to remind you about')
          .setRequired(true)
          .setMaxLength(500),
      ),
  )
  .addSubcommand((sc) =>
    sc.setName('list').setDescription('Your pending reminders here.'),
  )
  .addSubcommand((sc) =>
    sc
      .setName('cancel')
      .setDescription('Cancel one of your pending reminders by id.')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('The reminder id from /remindme list').setRequired(true),
      ),
  );

export async function execute(interaction) {
  // Reminders deliver to the channel they were set in — a guild feature.
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'Reminders only work in a server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const sub = interaction.options.getSubcommand();
  if (sub === 'in') return handleSet(interaction);
  if (sub === 'list') return handleList(interaction);
  if (sub === 'cancel') return handleCancel(interaction);
}

// --- /remindme in ---
async function handleSet(interaction) {
  const rawDuration = interaction.options.getString('duration');
  const message = interaction.options.getString('message');

  // Parse first (pure), then policy-check the bounds — two distinct
  // failure messages beat one vague "invalid".
  const seconds = parseDuration(rawDuration);
  if (seconds === null) {
    await interaction.reply({
      content:
        `I can't read "${rawDuration}" as a duration. ` +
        'Try things like `45m`, `1h30m`, `2d`, or `1w`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (seconds < REMINDERS.minSec || seconds > REMINDERS.maxSec) {
    await interaction.reply({
      content:
        seconds < REMINDERS.minSec
          ? `That's too soon — minimum is ${formatDuration(REMINDERS.minSec)}.`
          : 'That\'s too far out — maximum is one year.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const result = await createReminder(
    interaction.guildId,
    interaction.channelId,
    interaction.user.id,
    message,
    seconds,
  );

  if (!result.ok) {
    await interaction.reply({
      content:
        `You already have ${REMINDERS.maxPending} pending reminders. ` +
        'Cancel one first (`/remindme list`).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // <t:...:F> renders the absolute time in the reader's own timezone —
  // the whole reason this feature never needs timezone math.
  await interaction.reply({
    content:
      `⏰ Reminder **#${result.id}** set — I'll ping you here ` +
      `<t:${result.remindEpoch}:F> (<t:${result.remindEpoch}:R>).`,
    flags: MessageFlags.Ephemeral,
  });

  // Achievement pass after the row landed. The duration rides along for
  // the long-haul check.
  const earned = await checkAchievements(interaction.guildId, interaction.user.id, 'reminder', {
    durationSec: seconds,
  });
  await announceAchievements(interaction, earned);
}

// --- /remindme list ---
async function handleList(interaction) {
  const pending = await listPending(interaction.guildId, interaction.user.id);
  if (pending.length === 0) {
    await interaction.reply({
      content: 'No pending reminders. Your memory must be great.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // One compact line per reminder; long messages get elided — the full
  // text arrives when it fires.
  const lines = pending.map((r) => {
    const preview = r.message.length > 60 ? `${r.message.slice(0, 57)}…` : r.message;
    return `**#${r.id}** — <t:${r.remindEpoch}:R> — ${preview}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x0a96aa)
    .setTitle(`⏰ Your pending reminders (${pending.length}/${REMINDERS.maxPending})`)
    .setDescription(lines.join('\n').slice(0, 4000));

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// --- /remindme cancel ---
async function handleCancel(interaction) {
  const id = interaction.options.getInteger('id');
  const cancelled = await cancelReminder(id, interaction.user.id);
  await interaction.reply({
    content: cancelled
      ? `🗑️ Reminder **#${id}** cancelled.`
      : 'No such pending reminder — or it isn\'t yours.',
    flags: MessageFlags.Ephemeral,
  });
}

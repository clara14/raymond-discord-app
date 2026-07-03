// ============================================================
// interactionCreate.js — Fires on every interaction. Routes:
//  - slash commands -> the matching command file
//  - buttons & modals -> by customId prefix, first to a command
//    of that name, else to the client.components registry
//    (for UI owned by background tasks, like LoL betting)
// ============================================================

import { Events, MessageFlags } from 'discord.js';

export const name = Events.InteractionCreate;

export async function execute(interaction, client) {
  // --- Slash commands ---
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) {
      console.warn(`No command matching "${interaction.commandName}" was found.`);
      return;
    }
    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`Error executing "${interaction.commandName}":`, error);
      await respondWithError(interaction);
    }
    return;
  }

  // --- Buttons and modals ---
  // customId convention: "<prefix>:<action>:<data>". The prefix resolves to
  // a handler: a slash command exporting handleButton/handleModal, or an
  // entry in client.components (for features without a command, like the
  // match poller's betting UI).
  const isButton = interaction.isButton();
  const isModal = interaction.isModalSubmit();
  if (!isButton && !isModal) return;

  const prefix = interaction.customId.split(':')[0];
  const handler = client.commands.get(prefix) ?? client.components.get(prefix);
  const fn = isButton ? handler?.handleButton : handler?.handleModal;
  if (!fn) return;

  try {
    await fn(interaction);
  } catch (error) {
    console.error(`Error handling ${isButton ? 'button' : 'modal'} "${interaction.customId}":`, error);
    await respondWithError(interaction);
  }
}

// Uniform ephemeral error, coping with already-replied/deferred states.
async function respondWithError(interaction) {
  const reply = { content: 'Something went wrong.', flags: MessageFlags.Ephemeral };
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(reply).catch(() => {});
  } else {
    await interaction.reply(reply).catch(() => {});
  }
}

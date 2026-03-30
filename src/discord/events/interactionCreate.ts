import { Client, Events, Interaction, InteractionType, MessageFlags } from "discord.js";

import { DiscordManager } from "../../managers/DiscordManager.js";
import { Logger } from "../../managers/index.js";

export default (client: Client) => {
	client.on(Events.InteractionCreate, async (interaction: Interaction) => {
		try {
			// Handle Slash Commands & Context Menus
			if (interaction.isChatInputCommand() || interaction.isContextMenuCommand()) {
				const command = DiscordManager.commands.get(interaction.commandName);

				if (!command) {
					return interaction.reply({
						content: "❌ This command no longer exists.",
						flags: [MessageFlags.Ephemeral],
					});
				}

				await command.execute(interaction);
			}

			// Handle Buttons (Supports Prefix Matching)
			else if (interaction.isButton()) {
				const button = DiscordManager.buttons.find((btn) => interaction.customId.startsWith(btn.customId));

				if (button) {
					await button.execute(interaction);
				}
			}

			// Handle Modal Submissions (Supports Prefix Matching)
			else if (interaction.isModalSubmit()) {
				const modal =
					DiscordManager.modals.get(interaction.customId) || DiscordManager.modals.find((m) => interaction.customId.startsWith(m.customId));

				if (modal) {
					await modal.execute(interaction);
				} else {
					Logger.error("DISCORD_INTERACTION", `No modal handler found for ID: ${interaction.customId}`);
				}
			}

			// Handle Select Menus (Supports Prefix Matching)
			else if (interaction.isAnySelectMenu()) {
				const menu = DiscordManager.menus.find((m) => interaction.customId.startsWith(m.customId));

				if (menu) {
					await menu.execute(interaction);
				}
			}

			// Handle Autocomplete
			else if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
				const command = DiscordManager.commands.get(interaction.commandName);
				if (command && command.autocomplete) {
					await command.autocomplete(interaction);
				}
			}
		} catch (error) {
			Logger.error("DISCORD_INTERACTION", `Error handling interaction: ${interaction.id}`, error);

			// Generic error handler to prevent the interaction from "hanging"
			const errorMsg = "There was an error while executing this interaction!";

			if (interaction.isRepliable()) {
				if (interaction.deferred || interaction.replied) {
					await interaction.followUp({ content: errorMsg, flags: [MessageFlags.Ephemeral] });
				} else {
					await interaction.reply({ content: errorMsg, flags: [MessageFlags.Ephemeral] });
				}
			}
		}
	});
};

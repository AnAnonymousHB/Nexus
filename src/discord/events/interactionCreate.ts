import {
	Client, Events, Interaction, InteractionType, MessageFlags, RepliableInteraction
} from "discord.js";

import { DiscordManager } from "../../managers/DiscordManager.js";
import { Logger } from "../../managers/index.js";
import { BaseInteraction } from "../../types/index.js";
import { DISCORD_BOT_DEVS } from "../../utils/Constants.js";

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

				if (!(await checkPermissions(interaction, command))) return;

				await command.execute(interaction);
			}

			// Handle Buttons (Supports Prefix Matching)
			else if (interaction.isButton()) {
				const button = DiscordManager.buttons.find((btn) => interaction.customId.startsWith(btn.customId));

				if (button) {
					if (!(await checkPermissions(interaction, button))) return;
					await button.execute(interaction);
				}
			}

			// Handle Modal Submissions (Supports Prefix Matching)
			else if (interaction.isModalSubmit()) {
				const modal =
					DiscordManager.modals.get(interaction.customId) || DiscordManager.modals.find((m) => interaction.customId.startsWith(m.customId));

				if (modal) {
					if (!(await checkPermissions(interaction, modal))) return;
					await modal.execute(interaction);
				} else {
					Logger.error("DISCORD_INTERACTION", `No modal handler found for ID: ${interaction.customId}`);
				}
			}

			// Handle Select Menus (Supports Prefix Matching)
			else if (interaction.isAnySelectMenu()) {
				const menu = DiscordManager.menus.find((m) => interaction.customId.startsWith(m.customId));

				if (menu) {
					if (!(await checkPermissions(interaction, menu))) return;
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

const checkPermissions = async (interaction: RepliableInteraction, item: BaseInteraction): Promise<boolean> => {
	// Dev Only Check
	if (item.devOnly && !DISCORD_BOT_DEVS.includes(interaction.user.id)) {
		await interaction.reply({
			content: "❌ This action is restricted to bot developers only.",
			flags: [MessageFlags.Ephemeral],
		});
		return false;
	}

	// Bot Permissions Check (Guild only)
	if (item.botPermissions && interaction.appPermissions) {
		const missing = interaction.appPermissions.missing(item.botPermissions);
		if (missing.length > 0) {
			await interaction.reply({
				content: `❌ I am missing the following permissions: ${missing.map((p) => `\`${p}\``).join(", ")}`,
				flags: [MessageFlags.Ephemeral],
			});
			return false;
		}
	}

	// User Permissions Check (Guild only)
	if (item.userPermissions && interaction.memberPermissions) {
		const missing = interaction.memberPermissions.missing(item.userPermissions);
		if (missing.length > 0) {
			await interaction.reply({
				content: `❌ You need the following permissions to do this: ${missing.map((p) => `\`${p}\``).join(", ")}`,
				flags: [MessageFlags.Ephemeral],
			});
			return false;
		}
	}

	return true; // All checks passed
};

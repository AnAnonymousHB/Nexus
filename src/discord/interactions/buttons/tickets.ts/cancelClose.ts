import { ButtonInteraction, MessageFlags } from "discord.js";

import { DiscordButton } from "../../../../types/index.js";

const cancelClose: DiscordButton = {
	customId: "cancel_close",
	execute: async (interaction: ButtonInteraction) => {
		const [, originalCloserId] = interaction.customId.split(":");
		if (interaction.user.id !== originalCloserId) {
			return void (await interaction.reply({
				content: "❌ Only the person who initiated the closure can cancel it.",
				flags: [MessageFlags.Ephemeral],
			}));
		}

		// Simply delete the confirmation message the bot just sent
		// This returns the channel to its original state
		try {
			await interaction.message.delete();
		} catch (error) {
			// If the message was already deleted, we just ignore the error
		}
	},
};

export default cancelClose;

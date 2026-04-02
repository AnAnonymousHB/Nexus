import { ActionRowBuilder, bold, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder } from "discord.js";

import { DiscordButton } from "../../../../types/index.js";

const closeTicket: DiscordButton = {
	customId: "close_ticket",
	execute: async (interaction: ButtonInteraction) => {
		const closerId = interaction.user.id;

		// Create the confirmation embed
		const confirmEmbed = new EmbedBuilder()
			.setTitle("🔒 Close Ticket Confirmation")
			.setDescription(`Are you sure you want to close this ticket?\nThis will ${bold("permanently delete")} the channel and all its history.`)
			.setColor("#ed4245");

		// Create the Confirm/Cancel buttons
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`confirm_close:${closerId}`).setLabel("Yes, Close Ticket").setStyle(ButtonStyle.Danger),
			new ButtonBuilder().setCustomId(`cancel_close:${closerId}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
		);

		await interaction.reply({
			embeds: [confirmEmbed],
			components: [row],
		});
	},
};

export default closeTicket;

import {
	ButtonInteraction,
	ChannelType,
	FileUploadBuilder,
	LabelBuilder,
	MessageFlags,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";

import { DiscordButton } from "../../../../types/index.js";

const openTicket: DiscordButton = {
	customId: "open_ticket",
	execute: async (interaction: ButtonInteraction) => {
		const { guild, user } = interaction;
		if (!guild) return;

		const channelName = `ticket-${user.username.toLowerCase()}`;
		const existingTicket = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === channelName);

		if (existingTicket) {
			// Since we haven't shown a modal or deferred yet, we can reply normally
			await interaction.reply({
				content: `❌ You already have an open ticket here: ${existingTicket}`,
				flags: [MessageFlags.Ephemeral],
			});
			return;
		}

		const modal = new ModalBuilder().setCustomId("ticket_modal").setTitle("Open a Support Ticket");

		const reasonInput = new TextInputBuilder()
			.setCustomId("ticket_reason")
			.setStyle(TextInputStyle.Paragraph)
			.setPlaceholder("Describe your issue...")
			.setRequired(true)
			.setMaxLength(1000);

		const reasonInputLabel = new LabelBuilder()
			.setLabel("Reason")
			.setDescription("Please describe in detail on why you are opening this ticket.")
			.setTextInputComponent(reasonInput);

		const attachment = new FileUploadBuilder().setCustomId("ticket_attachment").setRequired(false).setMaxValues(5);
		const attachmentLabel = new LabelBuilder()
			.setLabel("Attachments")
			.setDescription("Upload any attachments/screenshots")
			.setFileUploadComponent(attachment);

		modal.addLabelComponents(reasonInputLabel, attachmentLabel);

		// Show the modal to the user
		await interaction.showModal(modal);
	},
};

export default openTicket;

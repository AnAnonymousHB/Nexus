import {
	ChatInputCommandInteraction, ContextMenuCommandInteraction, LabelBuilder, ModalBuilder,
	SlashCommandBuilder, TextInputBuilder, TextInputStyle
} from "discord.js";

import { DiscordCommand } from "../../../types/index.js";

const evalCommand: DiscordCommand = {
	data: new SlashCommandBuilder().setName("eval").setDescription("👨‍💻 Execute raw JavaScript code (Bot Owner Only)"),
	devOnly: true,
	testGuildOnly: true,
	async execute(interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction) {
		if (!interaction.isChatInputCommand()) return;

		const modal = new ModalBuilder().setCustomId("eval_modal").setTitle("Execute Code");

		const codeInput = new TextInputBuilder()
			.setCustomId("eval_code")
			.setPlaceholder("await interaction.channel.send('Hello World!');")
			.setStyle(TextInputStyle.Paragraph)
			.setRequired(true);

		const codeInputLabel = new LabelBuilder().setLabel("What code do you want to run?").setTextInputComponent(codeInput);

		modal.addLabelComponents(codeInputLabel);

		await interaction.showModal(modal);
	},
};

export default evalCommand;

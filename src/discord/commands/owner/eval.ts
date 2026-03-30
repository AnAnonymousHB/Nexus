import {
	ActionRowBuilder, ChatInputCommandInteraction, ContextMenuCommandInteraction, MessageFlags,
	ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle
} from "discord.js";

import { DiscordCommand } from "../../../types/index.js";

const evalCommand: DiscordCommand = {
	data: new SlashCommandBuilder().setName("eval").setDescription("👨‍💻 Execute raw JavaScript code (Bot Owner Only)"),
	devOnly: true,
	async execute(interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction) {
		if (!interaction.isChatInputCommand()) return;

		const codeInput = new TextInputBuilder({
			custom_id: "eval_code",
			label: "What code are we running?",
			style: TextInputStyle.Paragraph,
			placeholder: "await interaction.reply('Hello World!');",
			required: true,
		});

		const row = new ActionRowBuilder<TextInputBuilder>().addComponents(codeInput);

		const modal = new ModalBuilder({
			custom_id: "eval_modal",
			title: "Execute Code",
			components: [row.toJSON()],
		});

		await interaction.showModal(modal);
	},
};

export default evalCommand;

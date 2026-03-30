import {
	ActionRowBuilder, ButtonInteraction, ModalBuilder, TextInputBuilder, TextInputStyle
} from "discord.js";

import { DiscordButton } from "../../../types/index.js";
import { evalCache } from "../../../utils/index.js";

const evalRerunButton: DiscordButton = {
	customId: "eval_rerun",
	async execute(interaction: ButtonInteraction) {
		// Retrieve the code from our in-memory cache
		const previousCode = evalCache.get(interaction.user.id) || "";

		const codeInput = new TextInputBuilder({
			custom_id: "eval_code",
			label: "Edit & Re-run Code",
			style: TextInputStyle.Paragraph,
			value: previousCode,
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

export default evalRerunButton;

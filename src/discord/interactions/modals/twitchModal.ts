import { bold, channelMention, hideLinkEmbed, hyperlink, MessageFlags, ModalSubmitInteraction, roleMention } from "discord.js";

import { DiscordGuildManager, Logger } from "../../../managers/index.js";
import { DiscordModal } from "../../../types/index.js";

const twitchModal: DiscordModal = {
	customId: "twitch_modal",
	async execute(interaction: ModalSubmitInteraction) {
		const { guildId, customId, fields } = interaction;
		if (!guildId) return;

		const [, action, twitchId, twitchName, channelId, roleId] = customId.split(":");
		const liveMessage = fields.getTextInputValue("twitch_message");

		await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
		try {
			const pingRole = roleId === "none" ? null : roleId;

			const updated = await DiscordGuildManager.updateTwitchNotification(
				guildId,
				{ id: twitchId, name: twitchName },
				{
					discordChannelId: channelId,
					liveMessage: liveMessage,
					pingRoleId: roleId === "none" ? null : roleId,
				},
			);

			if (!updated) throw new Error("Database update failed");

			const actionText = action === "setup" ? "added" : "updated";
			const role = pingRole ? ` (Pinging ${roleMention(pingRole)})` : "";
			const url = hideLinkEmbed(`https://www.twitch.tv/${twitchName}`);

			await interaction.editReply({
				content:
					`✅ ${bold(`Twitch Notification ${actionText.toUpperCase()}!`)}\n` +
					`I am now monitoring ${bold(hyperlink(twitchName, url))} in ${channelMention(channelId)}${role}.`,
			});
		} catch (error) {
			Logger.error("DISCORD_TWITCH_MODAL_SUBMIT", `Failed for guild ${interaction.guild?.name}`, error);
			await interaction.editReply({
				content: "❌ An error occurred while saving the notification settings.",
			});
		}
	},
};

export default twitchModal;

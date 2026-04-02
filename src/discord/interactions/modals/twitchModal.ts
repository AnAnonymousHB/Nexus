import {
	bold,
	channelMention,
	hideLinkEmbed,
	hyperlink,
	MessageFlags,
	ModalSubmitInteraction,
	PermissionFlagsBits,
	roleMention,
	TextChannel,
} from "discord.js";

import { DiscordGuildManager, Logger } from "../../../managers/index.js";
import { DiscordModal } from "../../../types/index.js";

const twitchModal: DiscordModal = {
	customId: "twitch_modal",
	async execute(interaction: ModalSubmitInteraction) {
		const { guildId, customId, fields, guild } = interaction;
		if (!guildId || !guild) return;

		const [, action, twitchId, twitchName, channelId, roleId] = customId.split(":");
		const liveMessage = fields.getTextInputValue("twitch_message");
		const autoPublish = fields.getCheckbox("twitch_auto_publish");

		await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

		try {
			// --- PERMISSION CHECK START ---
			const targetChannel = await guild.channels.fetch(channelId).catch(() => null);

			if (!targetChannel || !(targetChannel instanceof TextChannel)) {
				return void (await interaction.editReply({
					content: `❌ I couldn't find the channel ${channelMention(channelId)}. Please try again.`,
				}));
			}

			const botMember = await guild.members.fetch(guild.client.user!.id);
			const botPermissions = targetChannel.permissionsFor(botMember);

			if (!botPermissions) return;

			const requiredPermissions = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];

			// Add MentionEveryone permission if a role ping is enabled
			if (roleId !== "none") {
				requiredPermissions.push(PermissionFlagsBits.MentionEveryone);
			}

			const missingPermissions = requiredPermissions.filter((perm) => !botPermissions.has(perm));

			if (missingPermissions.length > 0) {
				const missingNames = missingPermissions
					.map((p) => Object.entries(PermissionFlagsBits).find(([, value]) => value === p)?.[0])
					.filter(Boolean);

				return void (await interaction.editReply({
					content: `❌ I don't have enough permissions in ${channelMention(channelId)} to send notifications.\n**Missing:** ${missingNames.join(", ")}`,
				}));
			}

			const pingRole = roleId === "none" ? null : roleId;

			const updated = await DiscordGuildManager.updateTwitchNotification(
				guildId,
				{ id: twitchId, name: twitchName },
				{
					discordChannelId: channelId,
					liveMessage: liveMessage,
					autoPublish: autoPublish,
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

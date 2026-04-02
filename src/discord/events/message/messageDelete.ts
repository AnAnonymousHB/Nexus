import {
	AuditLogEvent, channelMention, Client, EmbedBuilder, Events, hyperlink, userMention
} from "discord.js";

import { DiscordGuildManager, DiscordModerationManager } from "../../../managers/index.js";
import { Timestamp } from "../../../utils/index.js";

export default (client: Client) => {
	client.on(Events.MessageDelete, async (message) => {
		if (!message.guild || message.partial) return;
		if (message.author?.bot) return;

        if (!(await DiscordGuildManager.isEventEnabled(message.guild.id, "messageDelete"))) return;

		const { author, channel, attachments, stickers, content } = message;
		const sentAt = new Timestamp(message.createdTimestamp);

		const embed = new EmbedBuilder()
			.setTitle("🗑️ Message Deleted")
			.setColor("#ed4245")
			.setAuthor({
				name: `${author?.tag} (${author?.id})`,
				iconURL: author?.displayAvatarURL(),
			})
			.addFields(
				{ name: "Channel", value: channelMention(channel.id), inline: true },
				{ name: "Sent At", value: sentAt.getShortDateTime(), inline: true },
			)
			.setFooter({ text: `Message ID: ${message.id}` })
			.setTimestamp();

		if (attachments.size > 0) {
			const attachmentList = attachments
				.map((a) => {
					// We check if it's an image to give it a specific emoji
					const isImage = a.contentType?.startsWith("image/");
					const emoji = isImage ? "🖼️" : "📁";
					return `${emoji} ${hyperlink(a.name, a.url)} (${(a.size / 1024).toFixed(1)} KB)`;
				})
				.join("\n");

			embed.addFields({
				name: `Attachments (${attachments.size})`,
				value: attachmentList.length > 1024 ? attachmentList.substring(0, 1021) + "..." : attachmentList,
			});

			// Set the first image as the embed image so mods can see a preview
			// Note: This link will expire eventually, but usually stays active for a few hours.
			const firstImg = attachments.find((a) => a.contentType?.startsWith("image/"));
			if (firstImg) embed.setImage(firstImg.proxyURL || firstImg.url);
		}

		if (content) {
			const cleanContent = content.length > 1024 ? content.substring(0, 1021) + "..." : content;
			embed.setDescription(`**Content:**\n${cleanContent}`);
		} else if (attachments.size > 0 && !content) {
			embed.setDescription("*Message contained only attachments.*");
		}

		if (stickers.size > 0) {
			embed.addFields({ name: "Stickers", value: stickers.map((s) => s.name).join(", ") });
		}

		try {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			const fetchedLogs = await message.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MessageDelete });
			const logEntry = fetchedLogs.entries.first();

			const isTarget = logEntry && logEntry.targetId === author.id;
			const isMatch = logEntry && logEntry.extra.channel.id === channel.id;
			const isRecent = logEntry && Date.now() - logEntry.createdTimestamp < 5000;

			if (isTarget && isMatch && isRecent) {
				embed.addFields({ name: "Deleted By", value: `${userMention(logEntry.executorId!)}`, inline: true });
			} else {
				embed.addFields({ name: "Deleted By", value: `${author}`, inline: true });
			}
		} catch (err) {
			embed.addFields({ name: "Deleted By", value: "Unknown", inline: true });
		}

		await DiscordModerationManager.logEvent(client, message.guild.id, embed);
	});
};

import {
	AttachmentBuilder,
	bold,
	ButtonInteraction,
	EmbedBuilder,
	Message,
	MessageFlags,
	PermissionFlagsBits,
	TextChannel,
	userMention,
} from "discord.js";

import { DiscordModerationManager, Logger } from "../../../../managers/index.js";
import { DiscordButton } from "../../../../types/index.js";
import { Timestamp } from "../../../../utils/Timestamp.js";

const confirmClose: DiscordButton = {
	customId: "confirm_close",
	execute: async (interaction: ButtonInteraction) => {
		const { guild, channel, user, customId, client } = interaction;
		if (!guild || !(channel instanceof TextChannel)) return;

		// Validation: Only allow the original closer (or someone with Manage Messages)
		const [, originalCloserId] = customId.split(":");
		const isStaff = interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);

		if (user.id !== originalCloserId && !isStaff) {
			await interaction.reply({
				content: "❌ Only the person who initiated the closure or a moderator can confirm it.",
				flags: [MessageFlags.Ephemeral],
			});
			return;
		}

		const deleteAt = new Timestamp(Date.now() + 5_000);

		await interaction.update({
			content: `🔒 ${bold("Ticket Closing:")} This channel will be deleted ${deleteAt.getRelativeTime()}. Transcript is being saved...`,
			embeds: [],
			components: [],
		});

		try {
			const topic = channel.topic || "";
			const reasonMatch = topic.match(/Reason: (.*?) \| User ID:/);
			const reason = reasonMatch ? reasonMatch[1] : "No reason provided";
			const ticketCreatorId = topic.match(/User ID: (\d+)/)?.[1];

			// --- FETCH MESSAGES ---
			const allMessages: Message[] = [];
			let lastId: string | undefined;
			const FETCH_LIMIT = 1000;

			while (allMessages.length < FETCH_LIMIT) {
				const fetched = await channel.messages.fetch({ limit: 100, before: lastId });
				if (fetched.size === 0) break;

				allMessages.push(...fetched.values());
				lastId = fetched.last()?.id;
				if (fetched.size < 100) break;
			}

			const reversedMessages = allMessages.reverse();

			// --- STAFF DETECTION ---
			// Find the first message from someone who isn't a bot and isn't the ticket creator
			const firstResponder = reversedMessages.find((m) => !m.author.bot && m.author.id !== ticketCreatorId && m.content.length > 0);

			// --- BUILD TRANSCRIPT STRING ---
			const collectedAttachments: string[] = [];

			let transcript = `==================================================\n`;
			transcript += `TICKET TRANSCRIPT: ${channel.name}\n`;
			transcript += `==================================================\n`;
			transcript += `Opened By   : ${ticketCreatorId ? ticketCreatorId : "Unknown ID"}\n`;
			transcript += `Reason      : ${reason}\n`;
			transcript += `--------------------------------------------------\n`;
			transcript += `Closed By   : ${user.tag} (${user.id})\n`;
			transcript += `Handled By  : ${firstResponder ? firstResponder.author.tag : "No staff response"}\n`;
			transcript += `Total Msgs  : ${reversedMessages.length}\n`;
			transcript += `Date (UTC)  : ${new Date().toUTCString()}\n`;
			transcript += `==================================================\n\n`;

			for (const msg of reversedMessages) {
				// Skip bot control messages (buttons/embeds) but keep content
				if (msg.author.id === client.user?.id && msg.components.length > 0) continue;

				const timestamp = msg.createdAt.toISOString().replace(/T/, " ").split(".")[0];
				const author = msg.author.tag;
				const hasAttachments = msg.attachments.size > 0;
				const content = msg.content || (hasAttachments ? "[Attachment]" : "[No Content]");

				transcript += `[${timestamp}] ${author}: ${content}\n`;

				if (hasAttachments) {
					msg.attachments.forEach((att) => {
						transcript += `   > File: ${att.name} | URL: ${att.url}\n`;
						collectedAttachments.push(att.url);
					});
				}
			}

			const transcriptFile = new AttachmentBuilder(Buffer.from(transcript, "utf-8"), {
				name: `transcript-${channel.name}.txt`,
			});

			const logEmbed = new EmbedBuilder()
				.setTitle("📝 Ticket Transcript")
				.setColor("#2f3136")
				.addFields(
					{ name: "Ticket", value: `\`${channel.name}\``, inline: true },
					{ name: "Opened By", value: ticketCreatorId ? userMention(ticketCreatorId) : "Unknown", inline: true },
					{ name: "Closed By", value: `${user}`, inline: true },
					{ name: "Handled By", value: firstResponder ? `${firstResponder.author}` : "None", inline: true },
					{ name: "Reason", value: reason, inline: false },
				)
				.setFooter({ text: `Total Messages: ${allMessages.length}` })
				.setTimestamp();

			const finalLogFiles: (AttachmentBuilder | string)[] = [transcriptFile, ...collectedAttachments.slice(0, 5)];

			await DiscordModerationManager.logEvent(client, guild.id, {
				embeds: [logEmbed],
				files: finalLogFiles,
			});
		} catch (error) {
			Logger.error("DISCORD_TICKET_CONFIRM", "Failed to generate transcript", error);
		}

		setTimeout(async () => {
			if (channel.deletable) {
				await channel
					.delete()
					.catch((e) => Logger.error("DISCORD_TICKET_CHANNEL_DELETE_FAIL", "An error occurred while deleting ticket channel", e));
			}
		}, 5000);
	},
};

export default confirmClose;

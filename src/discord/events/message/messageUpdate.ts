import { ActionRowBuilder, ButtonBuilder, ButtonStyle, channelMention, Client, EmbedBuilder, Events, hyperlink } from "discord.js";

import { DiscordGuildManager, DiscordModerationManager } from "../../../managers/index.js";

export default (client: Client) => {
	client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
		if (!newMessage.guild || newMessage.author?.bot) return;

		if (!(await DiscordGuildManager.isEventEnabled(newMessage.guild.id, "messageUpdate"))) return;

		if (oldMessage.partial) return;

		// Check if content is the same AND every old attachment still exists in the new message
		const attachmentsIdentical =
			oldMessage.attachments.size === newMessage.attachments.size && oldMessage.attachments.every((a) => newMessage.attachments.has(a.id));

		if (oldMessage.content === newMessage.content && attachmentsIdentical) return;

		let changes = false;

		const embed = new EmbedBuilder()
			.setTitle("📝 Message Edited")
			.setColor("#3498db")
			.setAuthor({
				name: `${newMessage.author?.tag} (${newMessage.author?.id})`,
				iconURL: newMessage.author?.displayAvatarURL(),
			})
			.addFields({ name: "Channel", value: channelMention(newMessage.channel.id), inline: true })
			.setFooter({ text: `ID: ${newMessage.id}` })
			.setTimestamp();

		const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setLabel("Jump to Message").setStyle(ButtonStyle.Link).setURL(newMessage.url),
		);

		// Handle Text Content Changes
		if (oldMessage.content !== newMessage.content) {
			const oldContent = oldMessage.content || "*(No text)*";
			const newContent = newMessage.content || "*(No text)*";

			embed.addFields(
				{ name: "Before", value: oldContent.length > 1024 ? oldContent.substring(0, 1021) + "..." : oldContent },
				{ name: "After", value: newContent.length > 1024 ? newContent.substring(0, 1021) + "..." : newContent },
			);
			changes = true;
		}

		// Handle Attachment Changes (Detects Adds, Removes, and Swaps)
		const oldAttachments = oldMessage.attachments;
		const newAttachments = newMessage.attachments;

		if (!attachmentsIdentical) {
			changes = true;

			// Check for removals
			const removed = oldAttachments.filter((a) => !newAttachments.has(a.id));
			if (removed.size > 0) {
				const removedLinks = removed.map((a) => `❌ ${hyperlink(a.name, a.url)}`).join("\n");
				embed.addFields({
					name: `Removed Attachments (${removed.size})`,
					value: removedLinks.length > 1024 ? removedLinks.substring(0, 1021) + "..." : removedLinks,
				});

				// Show a preview of the FIRST removed image
				const firstRemovedImg = removed.find((a) => a.contentType?.startsWith("image/"));
				if (firstRemovedImg) {
					embed.setImage(firstRemovedImg.proxyURL || firstRemovedImg.url);
				}
			}

			// Check for additions
			const added = newAttachments.filter((a) => !oldAttachments.has(a.id));
			if (added.size > 0) {
				const addedLinks = added.map((a) => `✅ [${a.name}](${a.url})`).join("\n");
				embed.addFields({
					name: `Added Attachments (${added.size})`,
					value: addedLinks.length > 1024 ? addedLinks.substring(0, 1021) + "..." : addedLinks,
				});

				// If no image was removed (so no preview is set yet), preview the added one
				if (!embed.data.image) {
					const firstAddedImg = added.find((a) => a.contentType?.startsWith("image/"));
					if (firstAddedImg) embed.setImage(firstAddedImg.proxyURL || firstAddedImg.url);
				}
			}
		}

		if (!changes) return;

		await DiscordModerationManager.logEvent(client, newMessage.guild.id, {
			embeds: [embed],
			components: [buttonRow],
		});
	});
};

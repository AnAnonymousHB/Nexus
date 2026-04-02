import {
	ActionRowBuilder, AttachmentBuilder, AttachmentPayload, bold, ButtonBuilder, ButtonStyle,
	ChannelType, EmbedBuilder, hyperlink, inlineCode, MessageFlags, MessageType,
	ModalSubmitInteraction, OverwriteResolvable, PermissionFlagsBits, roleMention
} from "discord.js";

import { DiscordGuildManager, Logger } from "../../../managers/index.js";
import { DiscordModal } from "../../../types/index.js";

const ticketModal: DiscordModal = {
	customId: "ticket_modal",
	async execute(interaction: ModalSubmitInteraction) {
		const { guild, user, client } = interaction;
		if (!guild) return;

		const reason = interaction.fields.getTextInputValue("ticket_reason");
		const uploadedFiles = interaction.fields.getUploadedFiles("ticket_attachment");

		await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

		try {
			const botMember = guild.members.me ?? (await guild.members.fetch(client.user.id));
			if (!botMember.permissions.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ViewChannel])) {
				return void (await interaction.editReply({
					content: "❌ I do not have the **Manage Channels** permission required to create tickets. Please notify a server administrator.",
				}));
			}

			const settings = await DiscordGuildManager.getSettings(guild.id);

			const overwrites: OverwriteResolvable[] = [
				{
					id: guild.id, // @everyone
					deny: [PermissionFlagsBits.ViewChannel],
				},
				{
					id: client.user.id, // The Bot
					allow: [
						PermissionFlagsBits.ViewChannel,
						PermissionFlagsBits.ManageChannels,
						PermissionFlagsBits.SendMessages,
						PermissionFlagsBits.PinMessages,
						PermissionFlagsBits.ReadMessageHistory,
					],
				},
				{
					id: user.id, // The Ticket Creator
					allow: [
						PermissionFlagsBits.ViewChannel,
						PermissionFlagsBits.SendMessages,
						PermissionFlagsBits.AttachFiles,
						PermissionFlagsBits.ReadMessageHistory,
					],
				},
			];

			const modRoleIds = settings.roles.mod || [];
			const adminRoleIds = settings.roles.admin || [];
			const staffRoles = [...modRoleIds, ...adminRoleIds];
			const staffMention = staffRoles.map((id) => roleMention(id)).join(" ");

			staffRoles.forEach((roleId: string) => {
				overwrites.push({
					id: roleId,
					allow: [
						PermissionFlagsBits.ViewChannel,
						PermissionFlagsBits.SendMessages,
						PermissionFlagsBits.ReadMessageHistory,
						PermissionFlagsBits.ManageMessages,
					],
				});
			});

			// Find or Create the "tickets" category
			let category = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === "tickets");

			if (!category) {
				category = await guild.channels.create({
					name: "tickets",
					type: ChannelType.GuildCategory,
					permissionOverwrites: [
						{
							id: guild.id,
							deny: [PermissionFlagsBits.ViewChannel],
						},
					],
				});
			}

			const channelName = `ticket-${user.username.toLowerCase()}`;

			// Create the private channel
			const ticketChannel = await guild.channels.create({
				name: channelName,
				type: ChannelType.GuildText,
				parent: category.id,
				topic: `Reason: ${reason} | User ID: ${user.id}`,
				permissionOverwrites: overwrites,
			});

			// Build the welcome interface
			const welcomeEmbed = new EmbedBuilder()
				.setTitle("Ticket Support")
				.setDescription(`Hello ${user}, welcome to your private support channel.`)
				.addFields({ name: "Provided Reason", value: reason })
				.setColor("#5865F2")
				.setTimestamp();

			const filesToUpload: (string | AttachmentBuilder | AttachmentPayload)[] = [];
			let attachmentList = "";

			if (uploadedFiles && uploadedFiles.size > 0) {
				uploadedFiles.forEach((file) => {
					// Add to the upload queue for the channel.send() call
					filesToUpload.push({
						attachment: file.url,
						name: file.name,
					});

					// Logic for the Embed Visuals
					const isImage = file.contentType?.startsWith("image/");

					// Build the text manifest
					const icon = isImage ? "🖼️" : "📁";
					attachmentList += `* ${icon} ${bold(hyperlink(file.name, file.url))}\n`;

					if (isImage && !welcomeEmbed.data.image) {
						welcomeEmbed.setImage(file.url);
					}
				});

				// Add the manifest to the embed
				welcomeEmbed.addFields({
					name: "Attached Files",
					value: attachmentList.length > 1024 ? attachmentList.slice(0, 1021) + "..." : attachmentList,
					inline: false,
				});
			}

			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder({
					custom_id: "close_ticket",
					label: "Close Ticket",
					style: ButtonStyle.Danger,
					emoji: "🔒",
				}),
			);

			const initialMessage = await ticketChannel.send({
				content: `Your ticket has been created, ${user}.\n\nStaff ${staffMention} will be with you shortly.`,
				embeds: [welcomeEmbed],
				components: [row],
				files: filesToUpload,
				allowedMentions: { parse: ["users", "roles"] },
			});

			// Handle Pinning
			try {
				await initialMessage.pin();
				// Clean up system pin message
				setTimeout(async () => {
					const messages = await ticketChannel.messages.fetch({ limit: 5 });
					const systemMessage = messages.find((m) => m.type === MessageType.ChannelPinnedMessage);
					if (systemMessage) await systemMessage.delete().catch(() => null);
				}, 1500);
			} catch (err) {
				Logger.error("DISCORD_TICKET_MODAL", "Failed to pin message", err);
			}

			// Confirm to User
			await interaction.editReply({
				content: `Your ticket has been created: ${ticketChannel}`,
			});
		} catch (error: any) {
			Logger.error("DISCORD_TICKET_MODAL", `Failed to create ticket for ${user.tag}`, error);

			let errorMessage = "There was an error creating your ticket. Please contact an administrator.";
			if (error.code === 50013) {
				// Discord API error code for "Missing Permissions"
				errorMessage = `❌ I have insufficient permissions to create or configure the ticket channel. Please ensure I have ${inlineCode("Manage Channels")} and ${inlineCode("View Channels")}  higher up in the hierarchy.`;
			}

			await interaction.editReply({ content: errorMessage });
		}
	},
};

export default ticketModal;

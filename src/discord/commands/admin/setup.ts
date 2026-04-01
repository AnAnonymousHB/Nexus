import {
	ActionRowBuilder, APIRole, bold, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder,
	ChannelType, ChatInputCommandInteraction, Collection, ContextMenuCommandInteraction,
	EmbedBuilder, inlineCode, italic, Message, MessageComponentInteraction, MessageFlags,
	OverwriteResolvable, OverwriteType, PermissionFlagsBits, Role, RoleSelectMenuBuilder,
	SlashCommandBuilder, TextChannel
} from "discord.js";

import { DiscordGuildManager, Logger } from "../../../managers/index.js";
import { DiscordCommand } from "../../../types/index.js";

const setup: DiscordCommand = {
	userPermissions: [PermissionFlagsBits.ManageGuild],
	data: new SlashCommandBuilder()
		.setName("setup")
		.setDescription("Setup moderation settings for the server using the interactive setup menu.")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
	async execute(interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction) {
		if (!interaction.isChatInputCommand()) return;

		if (!interaction.guild || !interaction.guildId) return;

		const embed = new EmbedBuilder()
			.setColor("#00dcff")
			.setThumbnail(interaction.client.user.defaultAvatarURL)
			.setTimestamp()
			.setTitle(`Welcome to ${interaction.client.user.displayName}`)
			.setDescription(
				`This is the setup wizard for ${interaction.client.user.displayName}.\n\nThis will guide you through the process of setting up ${interaction.client.user.displayName} for ${interaction.guild.name}.`,
			);

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("start_setup").setLabel("Let's get started").setStyle(ButtonStyle.Primary),
		);

		const response = await interaction.reply({ embeds: [embed], components: [row], withResponse: true });

		const msg_id = response.interaction.responseMessageId;
		if (!msg_id) return;

		let msg = (await interaction.channel?.messages.fetch(msg_id)) as Message<boolean>;
		if (!msg) return;

		const collector = msg.createMessageComponentCollector({ time: 60_000 * 3 });

		let modRoles: Collection<string, Role | APIRole>;
		let adminRoles: Collection<string, Role | APIRole>;
		let modLogChannel: TextChannel | undefined;

		collector.on("collect", async (i) => {
			if (i.user.id !== interaction.user.id) {
				return void (await i.followUp({
					content: "This isn't for you.",
					flags: MessageFlags.Ephemeral,
				}));
			}

			switch (i.customId) {
				case "start_setup":
					collector.resetTimer();
					await step1(i, msg);
					break;

				case "mod_roles":
					collector.resetTimer();

					if (!i.isRoleSelectMenu()) break;
					modRoles = i.roles;

					msg = await step2(i, msg);
					break;

				case "admin_roles":
					collector.resetTimer();

					if (!i.isRoleSelectMenu()) break;
					adminRoles = i.roles;

					if (adminRoles.some((r) => modRoles.has(r.id))) {
						await i.reply({
							content: `Moderation roles and Administration roles cannot be the same!`,
							flags: MessageFlags.Ephemeral,
						});
						break;
					}
					msg = await step3(i, msg);
					break;

				case "retry_modlog":
					collector.resetTimer();
					modLogChannel = undefined;
					msg = await step3(i, msg);
					break;

				case "modlog_channel":
					if (!i.isChannelSelectMenu()) break;
					modLogChannel = i.channels.first() as TextChannel;
				case "confirm_modlog":
					const edit = await modLogChannel!
						.edit({
							permissionOverwrites: permissions(
								!modLogChannel!.permissionsFor(interaction.guild!.roles.everyone).has(PermissionFlagsBits.ViewChannel),
							),
						})
						.catch(async (err) => {
							Logger.error("DISCORD_SETUP_CONFIRM_MOD_LOG", "Error in Discord setup", err);
							i.channel &&
								i.channel.isSendable() &&
								(await i.followUp({
									content: `I am unable to edit permissions of ${modLogChannel}. Please grant me admin permission or click on "Make a new modlog"`,
									flags: MessageFlags.Ephemeral,
								}));
							return null;
						});
					if (edit) {
						collector.stop("Complete");
					} else {
						collector.resetTimer();
						modLogChannel = undefined;
						msg = await step3(i, msg);
					}
					break;

				case "make_modlog":
					if (!interaction.guild!.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
						await i.followUp({
							content: `I don't have the permissions to create channels!\nPlease give me the ${inlineCode("Manage Channels")} permission!`,
							flags: MessageFlags.Ephemeral,
						});
						return;
					}

					collector.resetTimer();
					modLogChannel = undefined;

					msg = await step4(i, msg);
					break;

				case "public_modlog":
				case "private_modlog":
					modLogChannel = await makeModLog(i.customId === "private_modlog")
						.then((c) => {
							collector.stop("Complete");
							return c;
						})
						.catch(async (err) => {
							Logger.error("DISCORD_SETUP_PRIVATE_MOD_LOG", "Error in Discord setup", err);

							if (!i.replied) await i.deferUpdate();
							await i.followUp({
								content:
									`I couldn't create the modlog channel due to insufficient permissions!\nPlease try again after granting ` +
									`${inlineCode("Manage Channels")} [Creation of Channel], ${inlineCode("Manage Roles")} [To configure channel permissions], ${inlineCode("Embed Links and Send Messages")} [To send modlogs] permissions to me!\n` +
									`**Note:** I need a role other than @everyone with the mentioned permissions!\n>`,
								flags: MessageFlags.Ephemeral,
							});
							return undefined;
						});
					break;
			}
		});

		collector.on("end", async (c, r) => {
			if (r === "Complete") {
				const data = await DiscordGuildManager.updateSettings(interaction.guildId!, {
					logChannelId: modLogChannel?.id ?? "",
					roles: { admin: adminRoles.map((a) => a.id), mod: modRoles.map((m) => m.id) },
				});

				const finalEmbed = new EmbedBuilder()
					.setColor("#00dcff")
					.setDescription("Here is a quick overview of your setup!")
					.addFields(
						{
							name: "Moderator Roles",
							value: modRoles.map((r) => r).join(", "),
							inline: true,
						},
						{
							name: "Admin Roles",
							value: adminRoles.map((r) => r).join(", ") || "None",
							inline: true,
						},
						{
							name: "Moderation Logs Channel",
							value: modLogChannel ? `${modLogChannel}` : "None",
						},
					)
					.setTimestamp()
					.setAuthor({
						name: interaction.user.globalName ?? interaction.user.username,
						iconURL: interaction.user.displayAvatarURL({ forceStatic: false }),
					})
					.setFooter({ text: `${data ? "Saved Successfully" : "Created Successfully"}` });

				await msg.edit({
					content: `Setup completed!`,
					embeds: [finalEmbed],
					components: [],
				});
				return;
			}
		});

		async function makeModLog(isPrivate: boolean) {
			const modlog = await interaction.guild?.channels.create({
				name: "mod-log",
				type: ChannelType.GuildText,
				topic: `Moderation log for ${interaction.guild?.name}`,
				permissionOverwrites: permissions(isPrivate),
			});
			return modlog;
		}

		function permissions(isPrivate: boolean) {
			let permissionOverwrites: OverwriteResolvable[] = [];

			if (isPrivate) {
				permissionOverwrites = [
					{
						id: interaction.guild!.id,
						deny: [PermissionFlagsBits.ViewChannel],
						type: OverwriteType.Role,
					},
					{
						id: interaction.client.user.id,
						allow: [
							PermissionFlagsBits.ViewChannel,
							PermissionFlagsBits.SendMessages,
							PermissionFlagsBits.EmbedLinks,
							PermissionFlagsBits.ManageChannels,
							PermissionFlagsBits.AttachFiles,
						],
						type: OverwriteType.Member,
					},
				];

				const permissions = (id: string, mod: boolean): OverwriteResolvable => {
					return {
						id,
						allow: [PermissionFlagsBits.ViewChannel],
						deny: mod ? [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] : [],
						type: OverwriteType.Role,
					};
				};

				for (const mod of modRoles.keys()) {
					permissionOverwrites.push(permissions(mod, true));
				}

				for (const admin of adminRoles.keys()) {
					permissionOverwrites.push(permissions(admin, false));
				}
			} else {
				permissionOverwrites = [
					{
						id: interaction.guild!.id,
						allow: [PermissionFlagsBits.ViewChannel],
						deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
						type: OverwriteType.Role,
					},
					{
						id: interaction.client.user.id,
						allow: [
							PermissionFlagsBits.SendMessages,
							PermissionFlagsBits.ManageChannels,
							PermissionFlagsBits.EmbedLinks,
							PermissionFlagsBits.AttachFiles,
						],
						type: OverwriteType.Member,
					},
				];
			}

			return permissionOverwrites;
		}
	},
};

async function step1(interaction: MessageComponentInteraction, prevMsg: Message) {
	const embed = new EmbedBuilder(prevMsg.embeds[0].data).addFields({
		name: `What are the Moderator roles for ${interaction.guild?.name}? [Min: 1, Max: 3]`,
		value: `Only the ${bold("selected")} roles below will be considered as moderators.`,
	});

	const rolesMenu = new RoleSelectMenuBuilder().setCustomId("mod_roles").setPlaceholder("Select moderator roles").setMinValues(1).setMaxValues(3);

	const interactionResponse = await interaction.update({
		embeds: [embed],
		components: [new ActionRowBuilder<RoleSelectMenuBuilder>().setComponents([rolesMenu])],
		withResponse: true,
	});

	return (interaction.channel?.messages.cache.get(interactionResponse.interaction.responseMessageId!) ||
		(await interaction.channel?.messages.fetch(interactionResponse.interaction.responseMessageId!))) as Message<boolean>;
}

async function step2(interaction: MessageComponentInteraction, prevMsg: Message) {
	const embed = new EmbedBuilder(prevMsg.embeds[0].data).addFields({
		name: `What are the Admin roles for ${interaction.guild?.name}? [Max: 2]`,
		value:
			`Only the ${bold("selected")} roles below will be considered as admins\n\n` +
			`${bold("Note")}: ${italic("Moderation roles and Admin roles cannot be the same")}`,
	});

	const rolesMenu = new RoleSelectMenuBuilder().setCustomId("admin_roles").setPlaceholder("Select admin roles").setMinValues(0).setMaxValues(2);

	const interactionResponse = await interaction.update({
		embeds: [embed],
		components: [new ActionRowBuilder<RoleSelectMenuBuilder>().setComponents([rolesMenu])],
		withResponse: true,
	});

	return (interaction.channel?.messages.cache.get(interactionResponse.interaction.responseMessageId!) ||
		(await interaction.channel?.messages.fetch(interactionResponse.interaction.responseMessageId!))) as Message<boolean>;
}

async function step3(interaction: MessageComponentInteraction, prevMsg: Message) {
	const embed = new EmbedBuilder(prevMsg.embeds[0].data).addFields({
		name: `Where should moderation logs be sent?`,
		value:
			`If you ${bold("don't have")} any channel, you can tell me to create one!\n` +
			`If you ${bold("don't wamt")} to have a mod log channel, press confirm!`,
	});

	const channelMenu = new ChannelSelectMenuBuilder()
		.setCustomId("modlog_channel")
		.setPlaceholder("Select modlogs channel")
		.setMinValues(0)
		.setMaxValues(1)
		.setChannelTypes(ChannelType.GuildText);

	const interactionResponse = await interaction.update({
		embeds: [embed],
		components: [
			new ActionRowBuilder<ChannelSelectMenuBuilder>().setComponents([channelMenu]),
			new ActionRowBuilder<ButtonBuilder>().setComponents([
				new ButtonBuilder().setCustomId("retry_modlog").setLabel("Retry").setStyle(ButtonStyle.Secondary),
				new ButtonBuilder().setCustomId("make_modlog").setLabel("Make a new modlog").setStyle(ButtonStyle.Primary),
				new ButtonBuilder().setCustomId("confirm_modlog").setLabel("Confirm").setStyle(ButtonStyle.Success),
			]),
		],
		withResponse: true,
	});

	return (interaction.channel?.messages.cache.get(interactionResponse.interaction.responseMessageId!) ||
		(await interaction.channel?.messages.fetch(interactionResponse.interaction.responseMessageId!))) as Message<boolean>;
}

async function step4(interaction: MessageComponentInteraction, prevMsg: Message) {
	const embed = new EmbedBuilder(prevMsg.embeds[0].data).addFields({
		name: `What should be the visibility be of the modlog?`,
		value:
			`If the modlog is ${italic("private")}, only the moderators will be able to see it.\n` +
			`If the modlog is ${italic("public")}, everyone will be able to see it.\n` +
			`Please press the appropriate button\n` +
			`* Note: I need ${inlineCode("Manage Channels")} and ${inlineCode("Manage Roles")} permissions to configure permissions ` +
			`of the modlog channel on @everyone role!\n` +
			`* It is compulsory that I should have a role other than @everyone!\n` +
			`* Once created successfully, feel free to tune permissions of the modlog channel`,
	});

	const interactionResponse = await interaction.update({
		embeds: [embed],
		components: [
			new ActionRowBuilder<ButtonBuilder>().setComponents([
				new ButtonBuilder().setCustomId("private_modlog").setLabel("Private").setStyle(ButtonStyle.Primary),
				new ButtonBuilder().setCustomId("public_modlog").setLabel("Public").setStyle(ButtonStyle.Primary),
			]),
		],
		withResponse: true,
	});

	return (interaction.channel?.messages.cache.get(interactionResponse.interaction.responseMessageId!) ||
		(await interaction.channel?.messages.fetch(interactionResponse.interaction.responseMessageId!))) as Message<boolean>;
}
export default setup;

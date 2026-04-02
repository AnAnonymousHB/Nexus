import {
	ActionRowBuilder, bold, ButtonBuilder, ButtonStyle, channelMention, ChannelSelectMenuBuilder,
	ChannelType, ChatInputCommandInteraction, ContextMenuCommandInteraction, EmbedBuilder,
	inlineCode, italic, Message, MessageComponentInteraction, MessageFlags, OverwriteResolvable,
	PermissionFlagsBits, roleMention, RoleSelectMenuBuilder, SlashCommandBuilder, TextChannel
} from "discord.js";

import { DiscordGuildManager, Logger } from "../../../managers/index.js";
import { DiscordCommand } from "../../../types/index.js";

interface SetupState {
	currentStep: number;
	modRoles: string[];
	adminRoles: string[];
	modLogChannel?: TextChannel;
	enableTickets?: boolean;
}

const LOG_CHANNEL_REQUIRED_PERMS = [
	PermissionFlagsBits.ViewChannel,
	PermissionFlagsBits.SendMessages,
	PermissionFlagsBits.EmbedLinks,
	PermissionFlagsBits.AttachFiles,
	PermissionFlagsBits.ManageRoles,
];

const setup: DiscordCommand = {
	userPermissions: [PermissionFlagsBits.ManageGuild],
	data: new SlashCommandBuilder()
		.setName("setup")
		.setDescription("Setup moderation settings for the server using the interactive setup menu.")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
	async execute(interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction) {
		if (!interaction.isChatInputCommand()) return;

		if (!interaction.guild || !interaction.guildId) return;

		const state: SetupState = {
			currentStep: 0,
			modRoles: [],
			adminRoles: [],
			enableTickets: false,
		};

		const welcomeEmbed = new EmbedBuilder()
			.setColor("#00dcff")
			.setTitle(`Welcome to ${interaction.client.user.displayName}`)
			.setDescription(`This wizard will guide you through setting up moderation for ${bold(interaction.guild.name)}.`)
			.setTimestamp();

		const startRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("start_setup").setLabel("Let's get started").setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId("cancel_setup").setLabel("Cancel").setStyle(ButtonStyle.Danger),
		);

		const initialMessage = await interaction.reply({
			embeds: [welcomeEmbed],
			components: [startRow],
			withResponse: true,
		});

		const msg_id = initialMessage.interaction.responseMessageId;
		if (!msg_id) return;

		let msg = (await interaction.channel?.messages.fetch(msg_id)) as Message<boolean>;
		if (!msg) return;

		const collector = msg.createMessageComponentCollector({
			filter: (i) => i.user.id === interaction.user.id,
			time: 60_000 * 3,
		});

		const globalCollector = msg.createMessageComponentCollector({
			filter: (i) => i.user.id !== interaction.user.id,
			time: 60_000 * 3,
		});

		globalCollector.on("collect", async (i) => {
			await i.reply({
				content: "❌ This setup wizard is not for you. Please run your own `/setup` command.",
				flags: [MessageFlags.Ephemeral],
			});
		});

		collector.on("collect", async (i) => {
			try {
				if (i.customId === "go_back") {
					state.currentStep--;
					await updateDisplay(i, state, interaction);
					return;
				}

				if (i.customId === "cancel_setup") return collector.stop("Cancelled");

				switch (i.customId) {
					case "start_setup":
						state.currentStep = 1;
						await i.update(getStep1(interaction.guild!.name));
						break;

					case "mod_roles":
						if (!i.isRoleSelectMenu()) return;

						state.modRoles = i.values;
						state.currentStep = 2;
						await i.update(getStep2(interaction.guild!.name));
						break;

					case "admin_roles":
						if (!i.isRoleSelectMenu()) return;

						if (i.values.some((id) => state.modRoles.includes(id))) {
							return void (await i.reply({
								content: "Admin and Mod roles cannot overlap!",
								flags: [MessageFlags.Ephemeral],
							}));
						}

						state.adminRoles = i.values;
						state.currentStep = 3;
						await i.update(getStep3());
						break;

					case "modlog_channel":
						if (!i.isChannelSelectMenu()) return;

						const selectedChannel = i.channels.first() as TextChannel;
						const botPermissions = selectedChannel.permissionsFor(interaction.client.user!);

						const missing = LOG_CHANNEL_REQUIRED_PERMS.filter((perm) => !botPermissions?.has(perm));
						if (missing.length > 0) {
							return void (await i.reply({
								content: `❌ I cannot use ${channelMention(selectedChannel.id)} because I am missing the following permissions: ${missing.map((p) => inlineCode(p.toString())).join(", ")}.`,
								flags: [MessageFlags.Ephemeral],
							}));
						}

						state.modLogChannel = selectedChannel;
						await applyChannelPermissions(state.modLogChannel, interaction, state, true);
						state.currentStep = 5; // Move to tickets
						await i.update(getStep5());
						break;

					case "confirm_modlog":
						state.currentStep = 5;
						await i.update(getStep5());
						break;

					case "make_modlog":
						// Check if bot can actually create channels in this guild
						if (!interaction.guild?.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
							return void (await i.reply({
								content: `❌ I am missing the ${bold("Manage Channels")} permission required to create a new channel.`,
								flags: [MessageFlags.Ephemeral],
							}));
						}

						state.currentStep = 4;
						await i.update(getStep4());
						break;

					case "private_modlog":
					case "public_modlog":
						const isPrivate = i.customId === "private_modlog";
                        state.modLogChannel = await createModLog(interaction, state, isPrivate);
                        
                        state.currentStep = 5;
                        await i.update(getStep5());
                        break;

					case "cancel_setup":
						collector.stop("Cancelled");
						break;

					case "enable_tickets":
						const botPerms = interaction.guild?.members.me?.permissions;
						if (!botPerms?.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles])) {
							return void (await i.reply({
								content: `❌ I need both ${inlineCode("Manage Channels")} and ${inlineCode("Manage Roles")} permissions to set up the ticketing system.`,
								flags: [MessageFlags.Ephemeral],
							}));
						}

						state.enableTickets = true;
						collector.stop("Complete");
						break;

					case "skip_tickets":
						// Check if the category already exists before marking as disabled
						const existingCategory = interaction.guild?.channels.cache.find(
							(c) => c.name === "Tickets" && c.type === ChannelType.GuildCategory,
						);

						// If it exists, we keep it enabled in the final report
						state.enableTickets = !!existingCategory;
						collector.stop("Complete");
						break;
				}
			} catch (err) {
				Logger.error("DISCORD_SETUP_WIZARD", "Interaction Error", err);
			}
		});

		collector.on("end", async (_, reason) => {
			if (reason === "Complete") {
				await DiscordGuildManager.updateSettings(interaction.guildId!, {
					logChannelId: state.modLogChannel?.id ?? "",
					roles: { admin: state.adminRoles, mod: state.modRoles },
				});

				if (state.enableTickets) {
					const success = await handleTicketSetup(interaction, state);
					state.enableTickets = success;
				}

				const existingCategory = interaction.guild?.channels.cache.find((c) => c.name === "Tickets" && c.type === ChannelType.GuildCategory);

				const ticketValue =
					existingCategory ? "✅ Already Setup"
					: state.enableTickets ? "✅ Newly Enabled"
					: "❌ Disabled";

				const finalEmbed = new EmbedBuilder()
					.setAuthor({
						name: interaction.user.globalName ?? interaction.user.username,
						iconURL: interaction.user.displayAvatarURL({ forceStatic: false }),
					})
					.setColor("#2ecc71")
					.setTitle("✅ Setup Complete")
					.setThumbnail(interaction.guild?.iconURL() ?? null)
					.setDescription("Here is a quick overview of your setup.")
					.addFields(
						{ name: "Moderator Roles", value: state.modRoles.map((id) => roleMention(id)).join(", ") || "None", inline: true },
						{ name: "Admin Roles", value: state.adminRoles.map((id) => roleMention(id)).join(", ") || "None", inline: true },
						{
							name: "Moderation Logs Channel",
							value: state.modLogChannel ? channelMention(state.modLogChannel.id) : "None",
							inline: false,
						},
						{ name: "Tickets", value: ticketValue, inline: true },
					)
					.setTimestamp()
					.setFooter({ text: "Saved Successfully" });

				await interaction.editReply({
					content: state.enableTickets ? "Settings saved!" : "Settings saved (with errors).",
					embeds: [finalEmbed],
					components: [],
				});
			} else {
				const content = reason === "Cancelled" ? "Setup cancelled." : "Setup timed out.";
				await interaction.editReply({ content, embeds: [], components: [] });
			}
		});
	},
};

async function handleTicketSetup(interaction: ChatInputCommandInteraction, state: SetupState) {
	const { guild } = interaction;
	const botMember = guild?.members.me;

	if (!guild || !botMember) return false;

	const existing = guild.channels.cache.find((c) => c.name === "Tickets" && c.type === ChannelType.GuildCategory);
	if (existing) {
		Logger.info("TICKET_SETUP", `Category already exists for ${guild.name} (${guild.id}), skipping creation.`);
		return true;
	}

	try {
		const baseOverwrites: OverwriteResolvable[] = [
			{
				id: guild.id, // @everyone
				deny: [PermissionFlagsBits.ViewChannel],
			},
			{
				id: botMember.id,
				allow: [
					PermissionFlagsBits.ViewChannel,
					PermissionFlagsBits.SendMessages,
					PermissionFlagsBits.EmbedLinks,
					PermissionFlagsBits.ManageChannels,
					PermissionFlagsBits.ManageRoles,
				],
			},
		];

		[...state.modRoles, ...state.adminRoles].forEach((id) => {
			baseOverwrites.push({
				id,
				allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
			});
		});

		const category = await guild.channels.create({
			name: "Tickets",
			type: ChannelType.GuildCategory,
			permissionOverwrites: baseOverwrites,
		});

		const supportChannel = await guild.channels.create({
			name: "open-a-ticket",
			type: ChannelType.GuildText,
			parent: category.id,
			permissionOverwrites: [
				...baseOverwrites,
				{
					id: guild.id, // Allow everyone to SEE this specific channel to click the button
					allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
					deny: [PermissionFlagsBits.SendMessages],
				},
			],
		});

		const ticketEmbed = new EmbedBuilder()
			.setTitle("🎫 Support Ticket System")
			.setDescription(
				"Need assistance? Our team is here to help.\n\n" +
					"**How it works:**\n" +
					"* Click on the button below.\n" +
					"* You will then be prompted to provide a reason for opening the ticket.\n" +
					"* A new private channel will be created for you.\n" +
					"* You will be able to type and share additional details in that channel.\n\n" +
					"**Rules:**\n" +
					"* You can only create **one ticket** at a time.\n" +
					"* Do not abuse this feature. Only create tickets if needed.",
			)
			.setColor("#5865F2")
			.setFooter({ text: "Official Support System" });

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("open_ticket").setLabel("Open Ticket").setStyle(ButtonStyle.Primary).setEmoji("📩"),
		);

		await supportChannel.send({ embeds: [ticketEmbed], components: [row] });
		return true;
	} catch (err) {
		Logger.error("TICKET_SETUP", "Failed to auto-create ticket system", err);
		await interaction.followUp({
			content:
				"⚠️ I failed to create the ticket category. Ensure I have the **Administrator** or **Manage Channels** and **Manage Roles** permissions globally.",
			flags: [MessageFlags.Ephemeral],
		});
		return false;
	}
}

async function updateDisplay(i: MessageComponentInteraction, state: SetupState, interaction: ChatInputCommandInteraction) {
	const guildName = interaction.guild!.name;

	if (state.currentStep === 1) await i.update(getStep1(guildName));
	else if (state.currentStep === 2) await i.update(getStep2(guildName));
	else if (state.currentStep === 3) await i.update(getStep3());
	else if (state.currentStep === 4) await i.update(getStep4());
}

function getProgressBar(current: number, total: number): string {
	const size = 10;
	const progress = Math.round((size * current) / total);
	const emptyProgress = size - progress;

	const progressText = "▰".repeat(progress);
	const emptyProgressText = "▱".repeat(emptyProgress);

	return `Step ${current} of ${total} [${progressText}${emptyProgressText}]`;
}

function getNavigationRow(showBack: boolean = true) {
	const row = new ActionRowBuilder<ButtonBuilder>();
	if (showBack) {
		row.addComponents(new ButtonBuilder().setCustomId("go_back").setLabel("Back").setStyle(ButtonStyle.Secondary));
	}
	row.addComponents(new ButtonBuilder().setCustomId("cancel_setup").setLabel("Cancel").setStyle(ButtonStyle.Danger));
	return row;
}

function getStep1(guildName: string) {
	return {
		embeds: [
			new EmbedBuilder()
				.setTitle("Step 1: Moderators")
				.setDescription(`Select up to 3 moderator roles for ${bold(guildName)}.`)
				.setFooter({ text: getProgressBar(1, 5) }),
		],
		components: [
			new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
				new RoleSelectMenuBuilder().setCustomId("mod_roles").setMinValues(1).setMaxValues(3),
			),
			getNavigationRow(false),
		],
	};
}

function getStep2(guildName: string) {
	return {
		embeds: [
			new EmbedBuilder()
				.setTitle("Step 2: Admins")
				.setDescription(`Select up to 2 admin roles for ${bold(guildName)}. Roles cannot overlap with moderators.`)
				.setFooter({ text: getProgressBar(2, 5) }),
		],
		components: [
			new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
				new RoleSelectMenuBuilder().setCustomId("admin_roles").setMinValues(0).setMaxValues(2),
			),
			getNavigationRow(),
		],
	};
}

function getStep3() {
	return {
		embeds: [
			new EmbedBuilder()
				.setTitle("Step 3: Logging")
				.setDescription("Select a channel for moderation logs or let me create one.")
				.setFooter({ text: getProgressBar(3, 5) }),
		],
		components: [
			new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
				new ChannelSelectMenuBuilder().setCustomId("modlog_channel").setChannelTypes(ChannelType.GuildText),
			),
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId("make_modlog").setLabel("Create New Channel").setStyle(ButtonStyle.Primary),
				new ButtonBuilder().setCustomId("confirm_modlog").setLabel("Skip/Finish").setStyle(ButtonStyle.Success),
			),
			getNavigationRow(),
		],
	};
}

function getStep4() {
	const description =
		`Should the new log channel be private (mods only) or public?\n\n` +
		`If the modlog is ${italic("private")}, only the moderators will be able to see it.\n` +
		`If the modlog is ${italic("public")}, everyone will be able to see it.\n` +
		`Please press the appropriate button\n\n` +
		`* Note: I need ${inlineCode("Manage Channels")} and ${inlineCode("Manage Roles")} permissions to configure permissions ` +
		`of the modlog channel on @everyone role!\n` +
		`* It is compulsory that I should have a role other than @everyone!\n` +
		`* Once created successfully, feel free to tune permissions of the modlog channel`;

	return {
		embeds: [
			new EmbedBuilder()
				.setTitle("Step 4: Visibility")
				.setDescription(description)
				.setFooter({ text: getProgressBar(4, 5) }),
		],
		components: [
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId("private_modlog").setLabel("Private").setStyle(ButtonStyle.Primary),
				new ButtonBuilder().setCustomId("public_modlog").setLabel("Public").setStyle(ButtonStyle.Secondary),
			),
			getNavigationRow(),
		],
	};
}

function getStep5() {
	return {
		embeds: [
			new EmbedBuilder()
				.setTitle("Step 5: Ticketing System")
				.setDescription(
					"Would you like to enable a support ticketing system?\n\n" +
						"If enabled, I will create a **Tickets** category and a support channel where users can open private tickets.",
				)
				.setFooter({ text: getProgressBar(5, 5) }), // Updated total to 5
		],
		components: [
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId("enable_tickets").setLabel("Yes, Setup Tickets").setStyle(ButtonStyle.Success),
				new ButtonBuilder().setCustomId("skip_tickets").setLabel("No, Skip").setStyle(ButtonStyle.Secondary),
			),
			getNavigationRow(),
		],
	};
}

async function createModLog(interaction: ChatInputCommandInteraction, state: SetupState, isPrivate: boolean) {
	const channel = await interaction.guild?.channels.create({
		name: "mod-log",
		type: ChannelType.GuildText,
		permissionOverwrites: getPermissions(interaction, state, isPrivate),
	});
	return channel as TextChannel;
}

async function applyChannelPermissions(channel: TextChannel, interaction: ChatInputCommandInteraction, state: SetupState, isPrivate: boolean) {
	const botMember = interaction.guild!.members.me || (await interaction.guild!.members.fetch(interaction.client.user.id));

	if (!channel.permissionsFor(botMember).has(PermissionFlagsBits.ManageRoles)) {
		await interaction.followUp({
			content: `⚠️ I don't have the ${bold("Manage Roles")} permission in ${channelMention(channel.id)}. I need this to restrict the channel to your Mod/Admin roles.`,
			flags: [MessageFlags.Ephemeral],
		});
		return false;
	}

	try {
		await channel.edit({
			permissionOverwrites: getPermissions(interaction, state, isPrivate),
		});
		return true;
	} catch (e) {
		Logger.error("DISCORD_SETUP_WIZARD", "Failed to edit channel permissions", e);
		await interaction.followUp({
			content: "An unexpected error occurred while updating channel permissions. Check if my role is high enough in the hierarchy.",
			flags: [MessageFlags.Ephemeral],
		});
		return false;
	}
}

function getPermissions(interaction: ChatInputCommandInteraction, state: SetupState, isPrivate: boolean): OverwriteResolvable[] {
	const overwrites: OverwriteResolvable[] = [
		{
			id: interaction.client.user.id,
			allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
		},
	];

	if (isPrivate) {
		overwrites.push({ id: interaction.guild!.id, deny: [PermissionFlagsBits.ViewChannel] });
		state.modRoles.forEach((id) => overwrites.push({ id, allow: [PermissionFlagsBits.ViewChannel] }));
		state.adminRoles.forEach((id) => overwrites.push({ id, allow: [PermissionFlagsBits.ViewChannel] }));
	} else {
		overwrites.push({ id: interaction.guild!.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] });
	}

	return overwrites;
}

export default setup;

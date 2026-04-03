import {
	ActionRowBuilder,
	AutocompleteInteraction,
	bold,
	ButtonBuilder,
	ButtonStyle,
	channelMention,
	ChannelType,
	ChatInputCommandInteraction,
	CheckboxBuilder,
	ComponentType,
	ContextMenuCommandInteraction,
	EmbedBuilder,
	hideLinkEmbed,
	hyperlink,
	inlineCode,
	LabelBuilder,
	MessageFlags,
	ModalBuilder,
	PermissionFlagsBits,
	SlashCommandBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";

import { HelixStream } from "@twurple/api";

import { DiscordGuildManager, Logger, TwitchManager } from "../../../managers/index.js";
import { DiscordCommand } from "../../../types/index.js";

type SubcommandHandler = {
	execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
	autocomplete: (interaction: AutocompleteInteraction) => Promise<void>;
};

const subcommands: Record<string, SubcommandHandler> = {
	add: {
		execute: handleAdd,
		autocomplete: handleAddAutocomplete,
	},
	edit: {
		execute: handleEdit,
		autocomplete: handleLocalAutocomplete,
	},
	remove: {
		execute: handleRemove,
		autocomplete: handleLocalAutocomplete,
	},
	list: {
		execute: handleList,
		autocomplete: async (i) => await i.respond([]),
	},
};

const twitch: DiscordCommand = {
	userPermissions: [PermissionFlagsBits.ManageGuild],
	data: new SlashCommandBuilder()
		.setName("twitch")
		.setDescription("Configure Twitch live notifications for the server")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.addSubcommand((sub) =>
			sub
				.setName("add")
				.setDescription("Add a new streamer to track")
				.addStringOption((opt) => opt.setName("username").setDescription("Twitch username").setAutocomplete(true).setRequired(true))
				.addChannelOption((opt) =>
					opt
						.setName("channel")
						.setDescription("Where to send alerts")
						.addChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement])
						.setRequired(true),
				)
				.addRoleOption((opt) => opt.setName("role").setDescription("Role to ping when live")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("edit")
				.setDescription("Edit an existing notification")
				.addStringOption((opt) => opt.setName("streamer").setDescription("Streamer to edit").setAutocomplete(true).setRequired(true))
				.addChannelOption((opt) =>
					opt
						.setName("channel")
						.setDescription("New Discord channel")
						.addChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement]),
				)
				.addRoleOption((opt) => opt.setName("role").setDescription("Role to ping when live")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("remove")
				.setDescription("Stop tracking a streamer")
				.addStringOption((opt) => opt.setName("streamer").setDescription("Streamer to remove").setAutocomplete(true).setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("list").setDescription("List all Twitch streamers currently tracked in this server")),
	async autocomplete(interaction: AutocompleteInteraction) {
		const subName = interaction.options.getSubcommand();
		const handler = subcommands[subName];

		if (handler) {
			await handler.autocomplete(interaction);
		}
	},
	async execute(interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction) {
		if (!interaction.isChatInputCommand()) return;

		const subName = interaction.options.getSubcommand();
		const handler = subcommands[subName];

		if (handler) {
			await handler.execute(interaction);
		} else {
			await interaction.reply({ content: "Unknown subcommand.", flags: [MessageFlags.Ephemeral] });
		}
	},
};

async function handleAdd(interaction: ChatInputCommandInteraction) {
	const twitchUser = interaction.options.getString("username", true).trim();
	const channelId = interaction.options.getChannel("channel", true).id;
	const roleId = interaction.options.getRole("role")?.id || "none";

	try {
		const twitchData = await TwitchManager.verifyUser(twitchUser);
		if (!twitchData) {
			return void (await interaction.reply({
				content: `❌ Twitch user ${bold(twitchUser)} does not exist.`,
				flags: [MessageFlags.Ephemeral],
			}));
		}

		const url = hideLinkEmbed(`https://www.twitch.tv/${twitchData.displayName}`);

		const existing = await TwitchManager.getNotification(interaction.guildId!, twitchData.id);
		if (existing) {
			return void (await interaction.reply({
				content: `❌ ${bold(hyperlink(twitchData.displayName, url))} is already being tracked in ${channelMention(existing.discordChannelId)}.\nUse \`/twitch edit\` if you want to change the settings.`,
				flags: [MessageFlags.Ephemeral],
			}));
		}

		const modal = new ModalBuilder()
			.setCustomId(`twitch_modal:setup:${twitchData.id}:${twitchData.displayName}:${channelId}:${roleId}`)
			.setTitle(`Setup: ${twitchData.displayName}`);

		const twitchInput = new TextInputBuilder()
			.setCustomId("twitch_message")
			.setValue("🔴 {user} is now live playing {game}! {url}\n\nToday's stream: {title}")
			.setStyle(TextInputStyle.Paragraph)
			.setRequired(true)
			.setMaxLength(1000);

		const twitchInputLabel = new LabelBuilder()
			.setLabel("Live notification message")
			.setDescription("You can use the following tags: {user}, {url}, {game}, {title}")
			.setTextInputComponent(twitchInput);

		const autoPublish = new CheckboxBuilder().setCustomId("twitch_auto_publish").setDefault(false);
		const autoPublishLabel = new LabelBuilder()
			.setLabel("Auto Publish?")
			.setDescription("Share with all servers following your announcement channel")
			.setCheckboxComponent(autoPublish);

		const targetChannel = await interaction.guild!.channels.fetch(channelId);
		if (!targetChannel) return;

		if (targetChannel.type === ChannelType.GuildAnnouncement) {
			modal.addLabelComponents(twitchInputLabel, autoPublishLabel);
		} else {
			modal.addLabelComponents(twitchInputLabel);
		}

		await interaction.showModal(modal);
	} catch (err) {
		Logger.error("DISCORD_TWITCH_ADD", "An error has happened in Twitch add", err);
		await interaction.reply({ content: "An error has occurred. Please try again.", flags: MessageFlags.Ephemeral });
	}
}

async function handleEdit(interaction: ChatInputCommandInteraction) {
	const streamer = interaction.options.getString("streamer", true);
	const newChannel = interaction.options.getChannel("channel");
	const newRole = interaction.options.getRole("role");

	try {
		const twitchData = await TwitchManager.verifyUser(streamer);
		if (!twitchData) {
			return void (await interaction.reply({
				content: `❌ Twitch user ${bold(streamer)} does not exist.`,
				flags: [MessageFlags.Ephemeral],
			}));
		}

		// Pulls from cache via TwitchManager
		const notify = await TwitchManager.getNotification(interaction.guildId!, twitchData.id);
		if (!notify) {
			return void (await interaction.reply({ content: "❌ I am currently not tracking that streamer.", flags: [MessageFlags.Ephemeral] }));
		}

		const finalChannelId = newChannel?.id || notify.discordChannelId;
		const finalRoleId = newRole?.id || notify.pingRoleId || "none";

		const modal = new ModalBuilder()
			.setCustomId(`twitch_modal:edit:${twitchData.id}:${twitchData.displayName}:${finalChannelId}:${finalRoleId}`)
			.setTitle(`Editing: ${twitchData.displayName}`);

		const twitchInput = new TextInputBuilder()
			.setCustomId("twitch_message")
			.setValue(notify.liveMessage)
			.setStyle(TextInputStyle.Paragraph)
			.setRequired(true)
			.setMaxLength(1000);

		const twitchInputLabel = new LabelBuilder()
			.setLabel("Edit live notification message")
			.setDescription("You can use the following tags: {user}, {url}, {game}, {title}")
			.setTextInputComponent(twitchInput);

		const autoPublish = new CheckboxBuilder().setCustomId("twitch_auto_publish").setDefault(notify.autoPublish ?? false);
		const autoPublishLabel = new LabelBuilder()
			.setLabel("Auto Publish?")
			.setDescription("Share with all servers following your announcement channel")
			.setCheckboxComponent(autoPublish);

		const targetChannel = await interaction.guild!.channels.fetch(finalChannelId);
		if (!targetChannel) return;

		if (targetChannel.type === ChannelType.GuildAnnouncement) {
			modal.addLabelComponents(twitchInputLabel, autoPublishLabel);
		} else {
			modal.addLabelComponents(twitchInputLabel);
		}

		await interaction.showModal(modal);
	} catch (err) {
		Logger.error("DISCORD_TWITCH_EDIT", "An error has happened in Twitch edit", err);
		await interaction.reply({ content: "An error has occurred. Please try again.", flags: MessageFlags.Ephemeral });
	}
}

async function handleRemove(interaction: ChatInputCommandInteraction) {
	const streamer = interaction.options.getString("streamer", true);
	await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

	const success = await DiscordGuildManager.removeTwitchNotification(interaction.guildId!, streamer);
	await interaction.editReply(success ? `✅ Successfully removed ${bold(streamer)}.` : "❌ Streamer not found.");
}

async function handleAddAutocomplete(interaction: AutocompleteInteraction) {
	const focusedValue = interaction.options.getFocused();
	if (!focusedValue) return interaction.respond([]);

	try {
		const trackedNames = await TwitchManager.getTrackedStreamers(interaction.guildId!);
		const lowerTrackedNames = trackedNames.map((name) => name.toLowerCase());

		const searchResults = await TwitchManager.api.search.searchChannels(focusedValue);
		const choices = searchResults.data
			.map((channel) => ({
				name: channel.displayName,
				value: channel.displayName,
			}))
			// Filter out streamers whose 'value' (login name) is already in the tracked list
			.filter((choice) => !lowerTrackedNames.includes(choice.value.toLowerCase()))
			.slice(0, 25);

		await interaction.respond(choices);
	} catch (err) {
		Logger.error("DISCORD_TWITCH_SETUP_AUTOCOMPLETE", "Twitch API error", err);
		await interaction.respond([]);
	}
}

async function handleLocalAutocomplete(interaction: AutocompleteInteraction) {
	const focusedValue = interaction.options.getFocused().toLowerCase();

	// Efficiently pulls from GuildManager's memory-cache
	const trackedNames = await TwitchManager.getTrackedStreamers(interaction.guildId!);

	const choices = trackedNames
		.filter((name) => name.toLowerCase().includes(focusedValue))
		.map((name) => ({ name, value: name }))
		.slice(0, 25);

	await interaction.respond(choices);
}

async function handleList(interaction: ChatInputCommandInteraction) {
	// Initial Data Fetch
	const { guildId } = interaction;
	if (!guildId) return;

	const settings = await DiscordGuildManager.getSettings(guildId);
	// Sort by whomever is List first
	const allNotifications = [...(settings.twitchNotifications || [])].sort((a, b) => Number(b.isLive) - Number(a.isLive));
	const totalCount = allNotifications.length;

	if (totalCount === 0) {
		return void (await interaction.reply({
			content: "❌ This server is currently not tracking any Twitch streamers.",
			flags: [MessageFlags.Ephemeral],
		}));
	}

	await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

	let currentPage = 0;
	const limit = 5;
	const totalPages = Math.ceil(allNotifications.length / limit);

	// Helper to generate the Embed and Buttons
	const generateMessageOptions = async (page: number) => {
		const skip = page * limit;
		const items = allNotifications.slice(skip, skip + limit);

		const liveIds = items.filter((n) => n.isLive).map((n) => n.twitchUserId);
		let liveStreams: HelixStream[] = [];

		if (liveIds.length > 0) {
			try {
				liveStreams = await TwitchManager.api.streams.getStreamsByUserIds(liveIds);
			} catch (err) {
				Logger.error("DISCORD_TWITCH_LIST", "Failed to fetch live metadata", err);
			}
		}

		const embed = new EmbedBuilder()
			.setAuthor({ name: `Twitch Management: ${totalCount} Channel${totalCount === 1 ? "" : "s"} Tracked` })
			.setTitle("📺 Tracked Twitch Streamers")
			.setColor("#9146FF")
			.setFooter({ text: `Page ${page + 1} of ${totalPages}` })
			.setTimestamp();

		const listString = items
			.map((n) => {
				const status = n.isLive ? `🟢 ${bold("LIVE")}` : "⚪ Offline";
				const streamInfo = liveStreams.find((s) => s.userId === n.twitchUserId);
				const url = `https://www.twitch.tv/${n.twitchChannelName.trim()}`;

				let entry = `${bold(n.isLive ? hyperlink(n.twitchChannelName.trim(), url) : n.twitchChannelName)}\n`;
				entry += `└ Channel: ${channelMention(n.discordChannelId)}\n`;
				entry += `└ Status: ${status}`;

				if (n.isLive && streamInfo?.gameName) {
					entry += `\n└ Playing: ${inlineCode(streamInfo.gameName)}`;
				}

				return entry;
			})
			.join("\n\n");

		embed.setDescription(`Showing ${skip + 1}-${Math.min(skip + limit, totalCount)} of ${totalCount}\n\n${listString}`);

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId("prev")
				.setLabel("Previous")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(page === 0),
			new ButtonBuilder()
				.setCustomId("next")
				.setLabel("Next")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(page === totalPages - 1),
		);

		return { embeds: [embed], components: [row] };
	};

	const response = await interaction.editReply(await generateMessageOptions(currentPage));

	const collector = response.createMessageComponentCollector({
		componentType: ComponentType.Button,
		time: 60000, // 1 minute timeout
	});

	collector.on("collect", async (i) => {
		// Validation: Only the person who ran the command can flip pages
		if (i.user.id !== interaction.user.id) {
			return void (await i.reply({ content: "This menu is not for you.", flags: [MessageFlags.Ephemeral] }));
		}

		if (i.customId === "prev") currentPage--;
		if (i.customId === "next") currentPage++;

		await i.update(await generateMessageOptions(currentPage));
	});

	collector.on("end", async () => {
		// Disable buttons after timeout to prevent "Interaction Failed"
		const finalOptions = await generateMessageOptions(currentPage);

		finalOptions.components.forEach((row) => {
			row.components.forEach((component) => {
				// Check if setDisabled exists (it does for Buttons and Select Menus)
				if ("setDisabled" in component) {
					component.setDisabled(true);
				}
			});
		});

		await interaction.editReply(finalOptions).catch(() => null);
	});
}

export default twitch;

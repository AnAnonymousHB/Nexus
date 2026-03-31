import {
	ActionRowBuilder, AutocompleteInteraction, bold, ButtonBuilder, ButtonStyle, channelMention,
	ChannelType, ChatInputCommandInteraction, ComponentType, ContextMenuCommandInteraction,
	EmbedBuilder, hyperlink, MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder,
	TextInputBuilder, TextInputStyle
} from "discord.js";

import { DiscordGuildManager, Logger, TwitchManager } from "../../../managers/index.js";
import { DiscordCommand } from "../../../types/index.js";

type SubcommandHandler = {
	execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
	autocomplete: (interaction: AutocompleteInteraction) => Promise<void>;
};

const subcommands: Record<string, SubcommandHandler> = {
	setup: {
		execute: handleSetup,
		autocomplete: handleSetupAutocomplete,
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
					opt.setName("channel").setDescription("Where to send alerts").addChannelTypes(ChannelType.GuildText).setRequired(true),
				)
				.addRoleOption((opt) => opt.setName("role").setDescription("Role to ping when live")),
		)
		.addSubcommand((sub) =>
			sub
				.setName("edit")
				.setDescription("Edit an existing notification")
				.addStringOption((opt) => opt.setName("streamer").setDescription("Streamer to edit").setAutocomplete(true).setRequired(true))
				.addChannelOption((opt) => opt.setName("channel").setDescription("New Discord channel"))
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

async function handleSetup(interaction: ChatInputCommandInteraction) {
	const twitchUser = interaction.options.getString("username", true);
	const channelId = interaction.options.getChannel("channel", true).id;
	const roleId = interaction.options.getRole("role")?.id || "none";

	const twitchData = await TwitchManager.verifyUser(twitchUser);
	if (!twitchData) {
		return void (await interaction.reply({
			content: `❌ Twitch user ${bold(twitchUser)} does not exist.`,
			flags: [MessageFlags.Ephemeral],
		}));
	}

	const url = `https://www.twitch.tv/${twitchData.displayName}`;

	const existing = await TwitchManager.getNotification(interaction.guildId!, twitchData.id);
	if (existing) {
		return void (await interaction.reply({
			content: `❌ ${bold(hyperlink(twitchData.displayName, url))} is already being tracked in ${channelMention(existing.discordChannelId)}.\nUse \`/twitch edit\` if you want to change the settings.`,
			flags: [MessageFlags.Ephemeral],
		}));
	}

	const modal = new ModalBuilder({
		custom_id: `twitch_modal:setup:${twitchData.id}:${twitchData.displayName}:${channelId}:${roleId}`,
		title: `Setup: ${twitchData.displayName}`,
		components: [
			new ActionRowBuilder<TextInputBuilder>()
				.addComponents(
					new TextInputBuilder({
						custom_id: "twitch_message",
						label: "Message Tags ({user}, {url}, {game}, {title})",
						value: "🔴 {user} is now live playing {game}! {url}\n\nToday's stream: {title}",
						style: TextInputStyle.Paragraph,
						required: true,
						maxLength: 1000,
					}),
				)
				.toJSON(),
		],
	});

	await interaction.showModal(modal);
}

async function handleEdit(interaction: ChatInputCommandInteraction) {
	const streamer = interaction.options.getString("streamer", true);
	const newChannel = interaction.options.getChannel("channel");
	const newRole = interaction.options.getRole("role");

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

	const modal = new ModalBuilder({
		custom_id: `twitch_modal:edit:${twitchData.id}:${twitchData.displayName}:${finalChannelId}:${finalRoleId}`,
		title: `Editing: ${twitchData.displayName}`,
		components: [
			new ActionRowBuilder<TextInputBuilder>()
				.addComponents(
					new TextInputBuilder({
						custom_id: "twitch_message",
						label: "Edit Message",
						value: notify.liveMessage,
						style: TextInputStyle.Paragraph,
						required: true,
						maxLength: 1000,
					}),
				)
				.toJSON(),
		],
	});

	await interaction.showModal(modal);
}

async function handleRemove(interaction: ChatInputCommandInteraction) {
	const streamer = interaction.options.getString("streamer", true);
	await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

	const success = await DiscordGuildManager.removeTwitchNotification(interaction.guildId!, streamer);
	await interaction.editReply(success ? `✅ Successfully removed ${bold(streamer)}.` : "❌ Streamer not found.");
}

async function handleSetupAutocomplete(interaction: AutocompleteInteraction) {
	const focusedValue = interaction.options.getFocused();
	if (!focusedValue) return interaction.respond([]);

	try {
		const searchResults = await TwitchManager.api.search.searchChannels(focusedValue);
		const choices = searchResults.data
			.map((channel) => ({
				name: channel.displayName,
				value: channel.name,
			}))
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
	const allNotifications = settings.twitchNotifications || [];
	const totalCount = allNotifications.length;

	if (totalCount === 0) {
		return void (await interaction.reply({
			content: "❌ This server is currently not tracking any Twitch streamers.",
			flags: [MessageFlags.Ephemeral],
		}));
	}

	await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

	let currentPage = 0;
	const limit = 10;
	const totalPages = Math.ceil(allNotifications.length / limit);

	// Helper to generate the Embed and Buttons
	const generateMessageOptions = (page: number) => {
		const skip = page * limit;
		const items = allNotifications.slice(skip, skip + limit);

		const embed = new EmbedBuilder()
			.setAuthor({ name: `Twitch Management: ${totalCount} Channel${totalCount === 1 ? "" : "s"} Tracked` })
			.setTitle("📺 Tracked Twitch Streamers")
			.setColor("#9146FF")
			.setFooter({ text: `Page ${page + 1} of ${totalPages}` })
			.setTimestamp();

		const listString = items
			.map((n) => {
				const status = n.isLive ? `${bold("🟢 LIVE")}` : "⚪ Offline";
				return `${bold(n.twitchChannelName)}\n└ Channel: ${channelMention(n.discordChannelId)}\n└ Status: ${status}`;
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

	const response = await interaction.editReply(generateMessageOptions(currentPage));

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

		await i.update(generateMessageOptions(currentPage));
	});

	collector.on("end", async () => {
		// Disable buttons after timeout to prevent "Interaction Failed"
		const finalOptions = generateMessageOptions(currentPage);
		finalOptions.components[0].components.forEach((btn) => btn.setDisabled(true));

		await interaction.editReply(finalOptions).catch(() => null);
	});
}

export default twitch;

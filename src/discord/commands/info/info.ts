import {
	ActivityType, ApplicationCommandType, bold, ButtonStyle, ChatInputCommandInteraction,
	ContainerBuilder, ContextMenuCommandBuilder, ContextMenuCommandInteraction, EmbedBuilder, Guild,
	GuildMember, heading, HeadingLevel, inlineCode, MessageFlags, PermissionFlagsBits,
	PermissionsBitField, PresenceStatus, Role, SlashCommandBuilder, subtext, User, UserFlagsString
} from "discord.js";

import { discordUserManager } from "../../../managers/index.js";
import { DiscordCommand } from "../../../types/index.js";
import { Timestamp } from "../../../utils/index.js";

const UserFlags: Partial<Record<UserFlagsString, string>> = {
	VerifiedBot: "<:verified_app:1486098471713902692>",
	BugHunterLevel1: "<:BadgeBugHunter:1488261880425218202>",
	BugHunterLevel2: "<:BadgeBugHunterLvl2:1488261943033593933>",
	CertifiedModerator: "<:BadgeCertifiedMod:1488262002592973010>",
	Staff: "<:BadgeStaff:1488262066392531095>",
	PremiumEarlySupporter: "<:BadgeEarlySupporter:1488262114844868688>",
	VerifiedDeveloper: "<:BadgeEarlyVerifiedBotDeveloper:1488262173623976096>",
	HypeSquadOnlineHouse1: "<:BadgeBalance:1488262222118391980>",
	HypeSquadOnlineHouse2: "<:BadgeBravery:1488262267220004994>",
	HypeSquadOnlineHouse3: "<:BadgeBrilliance:1488262312820346920>",
	Hypesquad: "<:BadgeHypeSquadEvents:1488262367509872711>",
	Partner: "<:BadgePartner:1488262414184087754>",
	ActiveDeveloper: "<:activedev:1488262457276498071>",
};

const keyPermissions = [
	{ flag: PermissionFlagsBits.Administrator, label: "Administrator" },
	{ flag: PermissionFlagsBits.ManageGuild, label: "Manage Server" },
	{ flag: PermissionFlagsBits.ManageRoles, label: "Manage Roles" },
	{ flag: PermissionFlagsBits.ManageChannels, label: "Manage Channels" },
	{ flag: PermissionFlagsBits.ManageMessages, label: "Manage Messages" },
	{ flag: PermissionFlagsBits.ModerateMembers, label: "Timeout Members" },
	{ flag: PermissionFlagsBits.KickMembers, label: "Kick" },
	{ flag: PermissionFlagsBits.BanMembers, label: "Ban" },
	{ flag: PermissionFlagsBits.MentionEveryone, label: "Mention Everyone" },
];

const info: DiscordCommand = {
	data: new SlashCommandBuilder()
		.setName("info")
		.setDescription("Get information about a user, role, or server.")
		.addSubcommand((sub) =>
			sub
				.setName("user")
				.setDescription("View detailed info about a member.")
				.addUserOption((opt) => opt.setName("target").setDescription("The user to lookup").setRequired(false)),
		)
		.addSubcommand((sub) =>
			sub
				.setName("role")
				.setDescription("View detailed info about a role")
				.addRoleOption((opt) => opt.setName("target").setDescription("The role to lookup").setRequired(true)),
		)
		.addSubcommand((sub) => sub.setName("server").setDescription("View detailed info about this server")),
	contextData: new ContextMenuCommandBuilder().setName("User Info").setType(ApplicationCommandType.User),
	botPermissions: [PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.SendMessages],
	async execute(interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction) {
		if (interaction.isUserContextMenuCommand()) {
			const user = interaction.targetUser;
			const member = interaction.targetMember as GuildMember | null;

			const container = await createUserComponent(user || member!.user, member);
			await interaction.reply({
				components: [container],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		if (!interaction.isChatInputCommand()) return;

		const sub = interaction.options.getSubcommand();

		switch (sub) {
			case "user":
				await user(interaction);
				break;
		}
	},
};

const user = async (interaction: ChatInputCommandInteraction) => {
	await interaction.deferReply();

	const targetOption = interaction.options.get("target");
	let member = interaction.options.getMember("target") as GuildMember | null;
	let user = interaction.options.getUser("target");

	if (!member && targetOption?.value) {
		try {
			user = await interaction.client.users.fetch(targetOption.value as string);
		} catch {
			await interaction.reply({
				content: "❌ Could not find a Discord user with that ID.",
				flags: [MessageFlags.Ephemeral],
			});
			return;
		}
	} else if (!member && !user) {
		member = interaction.member as GuildMember;
		user = interaction.user;
	}

	const container = await createUserComponent(user || member!.user, member);
	await interaction.editReply({
		components: [container],
		flags: MessageFlags.IsComponentsV2,
	});
	return;
};

const createUserComponent = async (user: User, member: GuildMember | null = null) => {
	const fullUser = await user.fetch(true);
	const fullMember = await member?.fetch(true);

	const userDoc = await discordUserManager.fetch(user.id);
	const globalMessages = userDoc ? discordUserManager.getTotalGlobalMessages(userDoc) : 0;

	const banner = fullUser.bannerURL({ size: 2048 });
	const pfp = fullMember?.displayAvatarURL({ forceStatic: false, size: 4096 }) ?? fullUser.displayAvatarURL({ forceStatic: false, size: 4096 });
	const createdAt = new Timestamp(fullUser.createdTimestamp);
	const guildJoinDate = fullMember?.joinedTimestamp ? new Timestamp(fullMember.joinedTimestamp) : null;

	const statusMap: Record<PresenceStatus | "offline", string> = {
		online: "<:online:1485636911409139828> Online",
		idle: "<:away:1485637201571352708> Idle",
		dnd: "<:dnd:1485637132205686894> Do Not Disturb",
		offline: "<:offline:1485637318852218911> Offline",
		invisible: "<:offline:1485637318852218911> Offline",
	};
	const basicStatus = fullMember?.presence ? statusMap[fullMember.presence.status] : "<:offline:1485637318852218911> Offline/Invisible";

	const userBadges = (fullUser.flags?.toArray() ?? []).map((flag) => UserFlags[flag]).filter(Boolean);
	if (fullMember?.premiumSince) userBadges.push(UserFlags.PremiumEarlySupporter);

	let activityText = "None";
	if (fullMember?.presence?.activities.length) {
		const custom = fullMember.presence.activities.find((a) => a.type === ActivityType.Custom);
		if (custom) activityText = `${custom.emoji ?? ""} ${custom.state ?? ""}`;
		else activityText = fullMember.presence.activities[0].name;
	}

	let basicInfo = [
		heading("Basic Info", HeadingLevel.Two),
		`- ${bold("Global Name")}: ${fullUser.globalName ?? "None"}`,
		`- ${bold("Global Messages")}: 🌎 ${globalMessages.toLocaleString()}`,
		`- ${bold("ID")}: \`${fullUser.id}\``,
		`- ${bold("Status")}: ${basicStatus}`,
		`- ${bold("Created At")}: ${createdAt.getShortDateTime()} (${createdAt.getRelativeTime()})`,
	];

	const container = new ContainerBuilder().addSectionComponents((section) =>
		section
			.setThumbnailAccessory((thumbnail) => thumbnail.setURL(pfp).setDescription(`${fullUser.username}'s Avatar`))
			.addTextDisplayComponents((textDisplay) => textDisplay.setContent(heading(inlineCode(fullUser.username)) + "\n" + userBadges.join(" ")))
			.addTextDisplayComponents((textDisplay) => textDisplay.setContent(basicInfo.join("\n"))),
	);

	if (fullUser.accentColor) container.setAccentColor(fullUser.accentColor);

	if (fullMember) {
		const guildActivity = await discordUserManager.getGuildData(user.id, fullMember.guild.id);
		const lastMessage = guildActivity ? new Timestamp(guildActivity.lastMessageTimestamp) : null;

		const localMessages = guildActivity?.messageCount || 0;
		const lastSeen = guildActivity ? `${lastMessage?.getRelativeTime()} in <#${guildActivity.lastChannelId}>` : "No recorded activity";

		const keyPermissions = [
			{ flag: PermissionFlagsBits.Administrator, label: "Administrator" },
			{ flag: PermissionFlagsBits.ManageGuild, label: "Manage Server" },
			{ flag: PermissionFlagsBits.ManageRoles, label: "Manage Roles" },
			{ flag: PermissionFlagsBits.ManageChannels, label: "Manage Channels" },
			{ flag: PermissionFlagsBits.ManageMessages, label: "Manage Messages" },
			{ flag: PermissionFlagsBits.ModerateMembers, label: "Timeout Members" },
			{ flag: PermissionFlagsBits.KickMembers, label: "Kick" },
			{ flag: PermissionFlagsBits.BanMembers, label: "Ban" },
			{ flag: PermissionFlagsBits.MentionEveryone, label: "Mention Everyone" },
		];

		const hasPermissions =
			keyPermissions
				.filter((p) => fullMember.permissions.has(p.flag))
				.map((p) => p.label)
				.join(", ") || "None";

		const premiumSince = new Timestamp(fullMember.premiumSinceTimestamp!);
		let serverInfo = [
			heading("Server Info", HeadingLevel.Two),
			`- ${bold("Nickname")}: ${fullMember.nickname ?? "None"}`,
			`- ${bold("Roles")}: **${fullMember.roles.cache.size - 1}** Role(s)`,
			`- ${bold("Joined At")}: ${guildJoinDate?.getShortDateTime()} (${guildJoinDate?.getRelativeTime()})`,
			`- ${bold("Server Booster")}: ${fullMember.premiumSinceTimestamp ? `${premiumSince.getShortDate()} (${premiumSince.getRelativeTime()})` : "Not boosting"}`,
			`- ${bold("Server Messages")}: 💬 ${localMessages.toLocaleString()}`,
			`- ${bold("Last Seen")}: ${lastSeen}`,
			`- ${bold("Activity")}: ${activityText}`,
			`- ${bold("Key Permissions")}: \`\`\`${hasPermissions}\`\`\``,
		];

		container
			.addSeparatorComponents((s) => s)
			.addSectionComponents((section) =>
				section
					.addTextDisplayComponents((textDisplay) => textDisplay.setContent(serverInfo.join("\n")))
					.setButtonAccessory((button) =>
						button.setLabel("View Roles").setStyle(ButtonStyle.Secondary).setCustomId(`user_roles_${user.id}`).setEmoji({ name: "🏷️" }),
					),
			);

		if (banner) {
			container.addMediaGalleryComponents((gallery) =>
				gallery.addItems((item) => item.setURL(banner).setDescription(`${fullUser.username}'s Banner`)),
			);
		}
	}

	return container;
};

export default info;

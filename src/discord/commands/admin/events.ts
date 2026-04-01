import {
	bold,
	ChatInputCommandInteraction,
	ContextMenuCommandInteraction,
	EmbedBuilder,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";

import { DiscordGuildManager } from "../../../managers/index.js";
import { DiscordCommand } from "../../../types/index.js";

const TOGGLEABLE_EVENTS = [
	{ name: "Channel Create", value: "channelCreate" },
	{ name: "Channel Delete", value: "channelDelete" },
	{ name: "Channel Update", value: "channelUpdate" },
	{ name: "Ban Add", value: "guildBanAdd" },
	{ name: "Ban Remove", value: "guildBanRemove" },
	{ name: "Member Join", value: "guildMemberAdd" },
	{ name: "Member Leave", value: "guildMemberRemove" },
	{ name: "Member Update", value: "guildMemberUpdate" },
	{ name: "Message Bulk Delete", value: "messageBulkDelete" },
	{ name: "Message Delete", value: "messageDelete" },
	{ name: "Message Update", value: "messageUpdate" },
	{ name: "Role Create", value: "guildRoleCreate" },
	{ name: "Role Delete", value: "guildRoleDelete" },
	{ name: "Role Update", value: "guildRoleUpdate" },
];

type SubcommandHandler = {
	execute: (interaction: ChatInputCommandInteraction, disabledEvents: string[]) => Promise<void>;
};

const subcommands: Record<string, SubcommandHandler> = {
	toggle: {
		execute: handleToggle,
	},

	status: {
		execute: handleStatus,
	},
};

const eventToggle: DiscordCommand = {
	userPermissions: [PermissionFlagsBits.ManageGuild],
	data: new SlashCommandBuilder()
		.setName("events")
		.setDescription("Manage enabled/disabled discord events for this server")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.addSubcommand((sub) =>
			sub
				.setName("toggle")
				.setDescription("Enable or disable a specific event")
				.addStringOption((opt) =>
					opt
						.setName("event")
						.setDescription("The event to toggle")
						.setRequired(true)
						.addChoices(...TOGGLEABLE_EVENTS),
				),
		)
		.addSubcommand((sub) => sub.setName("status").setDescription("View the current status of all events")),
	async execute(interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction) {
		if (!interaction.isChatInputCommand()) return;

		if (!interaction.guild) return;

		const settings = await DiscordGuildManager.getSettings(interaction.guildId!);
		const { disabledEvents } = settings;

		const subName = interaction.options.getSubcommand();
		const handler = subcommands[subName];

		if (handler) {
			await handler.execute(interaction, disabledEvents);
		} else {
			await interaction.reply({ content: "Unknown subcommand.", flags: [MessageFlags.Ephemeral] });
		}
	},
};

async function handleToggle(interaction: ChatInputCommandInteraction, disabledEvents: string[]) {
	const eventName = interaction.options.getString("event", true);
	let newDisabledList: string[];

	const isCurrentlyDisabled = disabledEvents.includes(eventName);

	if (isCurrentlyDisabled) {
		// Enable it by removing from disabled list
		newDisabledList = disabledEvents.filter((e) => e !== eventName);
	} else {
		// Disable it by adding to disabled list
		newDisabledList = [...disabledEvents, eventName];
	}

	await DiscordGuildManager.updateSettings(interaction.guildId!, {
		disabledEvents: newDisabledList,
	});

	const statusLabel = isCurrentlyDisabled ? "ENABLED" : "DISABLED";
	const emoji = isCurrentlyDisabled ? "✅" : "❌";

	return void (await interaction.reply({
		content: `${emoji} Event ${bold(eventName)} is now ${bold(statusLabel)} for this guild.`,
		flags: MessageFlags.Ephemeral,
	}));
}

async function handleStatus(interaction: ChatInputCommandInteraction, disabledEvents: string[]) {
	const embed = new EmbedBuilder()
		.setTitle("📡 Server Event Status")
		.setColor("#5865F2")
		.setDescription(
			TOGGLEABLE_EVENTS.map((event) => {
				const isDisabled = disabledEvents.includes(event.value);
				return `${isDisabled ? "❌" : "✅"} **${event.name}**: ${isDisabled ? "Disabled" : "Enabled"}`;
			}).join("\n"),
		);

	return void (await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }));
}

export default eventToggle;

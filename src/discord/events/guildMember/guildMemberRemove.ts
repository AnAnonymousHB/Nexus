import { AuditLogEvent, Client, ColorResolvable, EmbedBuilder, Events } from "discord.js";

import { DiscordGuildManager, DiscordModerationManager, Logger } from "../../../managers/index.js";

export default (client: Client) => {
	client.on(Events.GuildMemberRemove, async (member) => {
		const { guild, user } = member;

		if (!(await DiscordGuildManager.isEventEnabled(guild.id, "guildMemberRemove"))) return;

		const leaveTimestamp = Math.floor(Date.now() / 1000);

		const embed = new EmbedBuilder()
			.setThumbnail(user.displayAvatarURL())
			.setAuthor({ name: `${user.tag}`, iconURL: user.displayAvatarURL() })
			.addFields(
				{ name: "User ID", value: `\`${user.id}\``, inline: true },
				{ name: "Member Count", value: `${guild.memberCount.toLocaleString()}`, inline: true },
			)
			.setTimestamp();

		// --- Kick Detection Logic ---
		let leftType = "Member Left";
		let embedColor = "#ed4245"; // Default Red

		try {
			// Small delay to let the Audit Log catch up
			await new Promise((resolve) => setTimeout(resolve, 1000));

			const fetchedLogs = await guild.fetchAuditLogs({
				limit: 1,
				type: AuditLogEvent.MemberKick,
			});

			const kickLog = fetchedLogs.entries.first();

			// Check if the log matches this user and happened in the last 5 seconds
			if (kickLog && kickLog.targetId === user.id && Date.now() - kickLog.createdTimestamp < 5000) {
				leftType = "Member Kicked";
				embedColor = "#e67e22"; // Orange for kicks
				embed.addFields({ name: "Kicked By", value: `<@${kickLog.executorId}>`, inline: true });
				if (kickLog.reason) {
					embed.addFields({ name: "Reason", value: kickLog.reason, inline: false });
				}
			}
		} catch (error) {
			// If audit logs fail (perms), we proceed with "Member Left"
			Logger.error("DISCORD_GUILD_MEMBER_REMOVE", "Error in guildMemberRemove", error);
		}

		embed
			.setTitle(`📤 ${leftType}`)
			.setColor(embedColor as ColorResolvable)
			.addFields(
				{
					name: "Joined At",
					value:
						member.joinedTimestamp ?
							`<t:${Math.floor(member.joinedTimestamp / 1000)}:f> (<t:${Math.floor(member.joinedTimestamp / 1000)}:R>)`
						:	"Unknown",
					inline: false,
				},
				{
					name: "Left At",
					value: `<t:${leaveTimestamp}:f> (<t:${leaveTimestamp}:R>)`,
					inline: false,
				},
				{
					name: "Roles",
					value:
						member.roles.cache
							.filter((r) => r.name !== "@everyone")
							.map((r) => `<@&${r.id}>`)
							.join(" ") || "None",
					inline: false,
				},
			);

		await DiscordModerationManager.logEvent(client, guild.id, embed);
	});
};

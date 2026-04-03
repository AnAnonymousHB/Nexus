import { AuditLogEvent, Client, EmbedBuilder, Events } from "discord.js";

import { DiscordModerationManager, Logger } from "../../../managers/index.js";

export default (client: Client) => {
	client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
		const { guild, user } = newMember;

		const embed = new EmbedBuilder()
			.setAuthor({ name: `${user.tag}`, iconURL: user.displayAvatarURL() })
			.setThumbnail(user.displayAvatarURL())
			.setFooter({ text: `User ID: ${user.id}` })
			.setTimestamp();

		let changes = false;

		// HANDLE TIMEOUTS (Manual)
		const oldTimeout = oldMember.communicationDisabledUntilTimestamp;
		const newTimeout = newMember.communicationDisabledUntilTimestamp;

		if (oldTimeout !== newTimeout) {
			await new Promise((resolve) => setTimeout(resolve, 1500)); // Wait 1.5s for Audit Log sync

			const isTimedOut = newTimeout && newTimeout > Date.now();
			embed.setTitle(isTimedOut ? "⏳ Member Timed Out" : "✅ Timeout Removed").setColor(isTimedOut ? "#e67e22" : "#2ecc71");

			// Fetch Audit Logs specifically for Member Update
			const fetchedLogs = await guild.fetchAuditLogs({
				limit: 1,
				type: AuditLogEvent.MemberUpdate,
			});

			const logEntry = fetchedLogs.entries.first();
			const isTarget = logEntry && logEntry.targetId === user.id;
			const isRecent = logEntry && Date.now() - logEntry.createdTimestamp < 5000;

			const moderatorId = isTarget && isRecent ? logEntry.executorId : client.user!.id;
			const logReason = isTarget && isRecent && logEntry.reason ? logEntry.reason : null;
			const finalReason = logReason ?? "Manual Action (No reason provided)";

			if (isTimedOut) {
				// Calculate duration in milliseconds
				const durationMs = newTimeout - Date.now();
				const durationMinutes = Math.round(durationMs / 60000);

				embed.addFields(
					{ name: "Duration", value: `${durationMinutes} minutes`, inline: true },
					{ name: "Reason", value: finalReason, inline: true },
					{ name: "Moderator", value: `<@${moderatorId}>`, inline: false },
				);

				// CREATE DATABASE CASE
				await DiscordModerationManager.createCase(client, guild.id, user.id, moderatorId!, "TIMEOUT", finalReason, durationMs).catch((err) =>
					Logger.error("DISCORD_DB_CASE_CREATE", "Failed to save manual timeout", err),
				);
			} else {
				embed.setDescription("The communication timeout was removed early.");

				await DiscordModerationManager.createCase(client, guild.id, user.id, moderatorId!, "UNTIMEOUT", finalReason).catch((err) =>
					Logger.error("DISCORD_DB_CASE_CREATE", "Failed to save manual untimeout", err),
				);
			}

			changes = true;
		}

		// Handle Nickname Changes
		if (oldMember.nickname !== newMember.nickname) {
			embed
				.setTitle("👤 Nickname Updated")
				.setColor("#3498db") // Blue
				.addFields(
					{ name: "Old Nickname", value: `\`${oldMember.nickname ?? "None"}\``, inline: true },
					{ name: "New Nickname", value: `\`${newMember.nickname ?? "None"}\``, inline: true },
				);
			changes = true;
		}

		// Handle Role Changes
		const oldRoles = oldMember.roles.cache;
		const newRoles = newMember.roles.cache;

		if (oldRoles.size !== newRoles.size) {
			const addedRoles = newRoles.filter((role) => !oldRoles.has(role.id));
			const removedRoles = oldRoles.filter((role) => !newRoles.has(role.id));

			if (addedRoles.size > 0 || removedRoles.size > 0) {
				embed.setTitle("🛡️ Roles Updated").setColor("#9b59b6"); // Purple

				if (addedRoles.size > 0) {
					embed.addFields({
						name: "✅ Added Roles",
						value: addedRoles.map((r) => `<@&${r.id}>`).join(", "),
					});
				}
				if (removedRoles.size > 0) {
					embed.addFields({
						name: "❌ Removed Roles",
						value: removedRoles.map((r) => `<@&${r.id}>`).join(", "),
					});
				}
				changes = true;
			}
		}

		// Only log if one of our tracked properties changed
		if (!changes) return;

		// Define the likely log type based on what changed
		const logType = oldRoles.size !== newRoles.size ? AuditLogEvent.MemberRoleUpdate : AuditLogEvent.MemberUpdate;

		// Fetch Audit Logs to see WHO changed it
		try {
			const fetchedLogs = await guild.fetchAuditLogs({
				limit: 1,
				type: logType,
			});

			const logEntry = fetchedLogs.entries.first();

			// Validate: Is the log entry recent and for the correct person?
			if (logEntry && logEntry.targetId === user.id && Date.now() - logEntry.createdTimestamp < 5000) {
				embed.addFields({ name: "Updated By", value: `<@${logEntry.executorId}>`, inline: false });
			} else if (oldMember.nickname !== newMember.nickname) {
				// If it's a nickname change and no log entry was found, they likely did it themselves
				embed.addFields({ name: "Updated By", value: "User (Self)", inline: false });
			}
		} catch (err) {
			// Audit logs might fail; log anyway without executor
			Logger.error("DISCORD_GUILD_MEMBER_UPDATE", "Error in guildMemberUpdate", err);
		}

		await DiscordModerationManager.logEvent(client, guild.id, embed);
	});
};

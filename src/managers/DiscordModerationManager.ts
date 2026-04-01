import {
	Client, EmbedBuilder, Guild, GuildMember, MessageCreateOptions, PermissionFlagsBits,
	TextChannel, User, userMention
} from "discord.js";

import { DiscordCaseModel, DiscordModUserModel, ICase } from "../models/index.js";
import { Timestamp } from "../utils/index.js";
import { DiscordGuildManager, Logger } from "./index.js";

export interface CaseUpdate {
	reason?: string;
	duration?: number;
}

export class DiscordModerationManager {
	// In-memory cache for recent cases (GuildID -> Map<CaseID, CaseData>)
	private static _caseCache = new Map<string, Map<number, ICase>>();

	static async createCase(
		client: Client,
		guildId: string,
		userId: string,
		modId: string,
		type: string,
		reason: string,
		duration?: number,
		evidence?: string,
	) {
		// Fetch the user's tag for historical records
		const user = await client.users.fetch(userId).catch(() => null);
		const userTag = user ? user.tag : "Unknown#0000";

		const counterDoc = await DiscordModUserModel.findOneAndUpdate(
			{ guildId, userId: "GUILD_COUNTER" },
			{ $inc: { warns: 1 } },
			{ upsert: true, returnDocument: "after" },
		);

		const newId = counterDoc.warns;

		// Create the actual case
		const newCase = await DiscordCaseModel.create({
			guildId,
			userId,
			userTag,
			moderatorId: modId,
			type,
			reason,
			duration,
			evidence,
			caseId: newId, // This will always be unique and increasing
			timestamp: new Date(),
		});

		// Update Cache
		if (!this._caseCache.has(guildId)) this._caseCache.set(guildId, new Map());
		this._caseCache.get(guildId)!.set(newCase.caseId, newCase);

		// Update User Stats: Increment warns ONLY if type is WARN
		await DiscordModUserModel.findOneAndUpdate(
			{ guildId, userId },
			{
				$inc: { warns: type === "WARN" ? 1 : 0 },
				$set: { lastModAction: new Date() },
			},
			{ upsert: true },
		);

		// Trigger Log
		await this.logAction(client, guildId, newCase);

		return newCase;
	}

	/**
	 * Internal helper to send DMs to users before/during moderation actions
	 */
	private static async sendModDm(target: User | GuildMember, guild: Guild, type: string, reason: string, durationMs?: number) {
		try {
			const user = target instanceof GuildMember ? target.user : target;
			const actionVerb = type === "TIMEOUT" ? "timed out" : `${type.toLowerCase()}ed`;

			const dmEmbed = new EmbedBuilder()
				.setTitle(`Notification: ${type}`)
				.setColor(this.getSeverityColor(type))
				.setThumbnail(guild.iconURL())
				.setDescription(`You have been **${actionVerb}** in **${guild.name}**.`)
				.addFields({ name: "Reason", value: reason })
				.setTimestamp()
				.setFooter({ text: `Server: ${guild.name}`, iconURL: guild.iconURL() ?? undefined });

			// Logic for Timeout Expiration
			if (type === "TIMEOUT" && durationMs) {
				const expirationTimestamp = new Timestamp(Date.now() + durationMs);

				dmEmbed.addFields({
					name: "Expires",
					value: `${expirationTimestamp.getShortDateTime()} (${expirationTimestamp.getRelativeTime()})`,
					inline: true,
				});
			}

			await user.send({ embeds: [dmEmbed] });
		} catch (err) {
			// Log a warning but don't crash the main moderation action
			Logger.error("DISCORD_MOD", `Could not DM user ${target.id} about their ${type}.`, err);
		}
	}

	/**
	 * Retrieve a case from cache or database
	 */
	static async getCase(guildId: string, caseId: number) {
		// Try cache first
		const cached = this._caseCache.get(guildId)?.get(caseId);
		if (cached) return cached;

		// Fallback to Database
		const dbCase = await DiscordCaseModel.findOne({ guildId, caseId });
		if (dbCase) {
			if (!this._caseCache.has(guildId)) this._caseCache.set(guildId, new Map());
			this._caseCache.get(guildId)!.set(caseId, dbCase);
		}
		return dbCase;
	}

	static async warn(client: Client, member: GuildMember, moderator: User, reason: string, shouldDm = true, evidence?: string) {
		const caseData = await this.createCase(client, member.guild.id, member.id, moderator.id, "WARN", reason, undefined, evidence);

		if (shouldDm) {
			await this.sendModDm(member, member.guild, "WARN", reason);
		}

		return caseData;
	}

	static async timeout(client: Client, member: GuildMember, moderator: User, durationMs: number, reason: string, shouldDm = true) {
		const MAX_TIMEOUT = 2419200000; // 28 days
		const finalDuration = Math.min(durationMs, MAX_TIMEOUT);

		if (shouldDm) {
			await this.sendModDm(member, member.guild, "TIMEOUT", reason, finalDuration);
		}

		await member.timeout(finalDuration, reason);
		return await this.createCase(client, member.guild.id, member.id, moderator.id, "TIMEOUT", reason, finalDuration);
	}

	static async kick(client: Client, member: GuildMember, moderator: User, reason: string, shouldDm = true, evidence?: string) {
		if (shouldDm) {
			await this.sendModDm(member, member.guild, "KICK", reason);
		}

		await member.kick(reason);
		return await this.createCase(client, member.guild.id, member.id, moderator.id, "KICK", reason, undefined, evidence);
	}

	/**
	 * Ban supports both active members and IDs (User objects)
	 */
	static async ban(
		client: Client,
		guild: Guild,
		target: User | GuildMember,
		moderator: User,
		reason: string,
		daysOfMessages = 0,
		shouldDm = true,
		evidence?: string,
	) {
		if (shouldDm) await this.sendModDm(target, guild, "BAN", reason);
		await guild.bans.create(target.id, {
			reason,
			deleteMessageSeconds: daysOfMessages * 86400,
		});
		return await this.createCase(client, guild.id, target.id, moderator.id, "BAN", reason, undefined, evidence);
	}

	static async softban(client: Client, member: GuildMember, moderator: User, reason: string, shouldDm = true) {
		if (shouldDm) {
			await this.sendModDm(member, member.guild, "SOFTBAN", reason);
		}

		// Ban and delete last 7 days of messages, then immediately unban
		await member.ban({ reason: `Softban: ${reason}`, deleteMessageSeconds: 604800 });
		await member.guild.members.unban(member.id, "Softban completion");

		return await this.createCase(client, member.guild.id, member.id, moderator.id, "SOFTBAN", reason);
	}

	/**
	 * Unban a user and log it to the database
	 */
	static async unban(client: Client, guild: Guild, target: User, moderator: User, reason: string) {
		await guild.members.unban(target.id, reason);

		return await this.createCase(client, guild.id, target.id, moderator.id, "UNBAN", reason);
	}

	/**
	 * Update an existing case in both the Database and the Cache
	 */
	static async updateCase(client: Client, guildId: string, caseId: number, updates: CaseUpdate): Promise<ICase | null> {
		// Update the Database
		// { new: true } returns the document AFTER the update is applied
		const updatedCase = await DiscordCaseModel.findOneAndUpdate({ guildId, caseId }, { $set: updates }, { returnDocument: "after" });

		if (!updatedCase) {
			Logger.warn("DISCORD_MOD", `Failed to find case #${caseId} in guild ${guildId} for update.`);
			return null;
		}

		// Update the Cache
		const guildCache = this._caseCache.get(guildId);
		if (guildCache && guildCache.has(caseId)) {
			guildCache.set(caseId, updatedCase);
		}

		// Log the modification so there is an audit trail of the change
		await this.logAction(client, guildId, updatedCase);

		return updatedCase;
	}

	/**
	 * Delete a case and decrement warn counts if applicable
	 */
	static async deleteCase(client: Client, guildId: string, caseId: number): Promise<boolean> {
		const caseData = await this.getCase(guildId, caseId);
		if (!caseData) return false;

		// If it was a warning, decrement the user's warn count
		if (caseData.type === "WARN") {
			await DiscordModUserModel.updateOne({ guildId, userId: caseData.userId }, { $inc: { warns: -1 } });
		}

		// Remove from Database
		await DiscordCaseModel.deleteOne({ guildId, caseId });

		// Remove from Cache
		this._caseCache.get(guildId)?.delete(caseId);

		try {
			const settings = await DiscordGuildManager.getSettings(guildId);
			if (settings.logChannelId) {
				const guild = await client.guilds.fetch(guildId).catch(() => null);
				const channel = await guild?.channels.fetch(settings.logChannelId).catch(() => null);

				if (channel instanceof TextChannel) {
					const deleteEmbed = new EmbedBuilder()
						.setTitle(`Case Deleted | #${caseId}`)
						.setColor("#2f3136") // Neutral Dark Gray
						.setDescription(`The ${caseData.type} case for ${userMention(caseData.userId)} has been removed from the database.`)
						.addFields(
							{ name: "Original Reason", value: caseData.reason, inline: true },
							{ name: "Original Mod", value: `${userMention(caseData.moderatorId)}`, inline: true },
						)
						.setTimestamp();

					await channel.send({ embeds: [deleteEmbed] });
				}
			}
		} catch (error) {
			Logger.error("DISCORD_MOD_DELETE_LOG", `Failed to log deletion of Case #${caseId}`, error);
		}

		return true;
	}

	static async getUserHistory(guildId: string, userId: string, page: number, limit: number) {
		const skip = page * limit;
		const [cases, total] = await Promise.all([
			DiscordCaseModel.find({ guildId, userId }).sort({ timestamp: -1 }).skip(skip).limit(limit),
			DiscordCaseModel.countDocuments({ guildId, userId }),
		]);
		return { cases, total };
	}

	private static getSeverityColor(type: string) {
		switch (type.toUpperCase()) {
			case "BAN":
				return "#ff0000"; // Red
			case "SOFTBAN":
				return "#ff5555"; // Light Red
			case "KICK":
				return "#ffa500"; // Orange
			case "TIMEOUT":
				return "#ffff00"; // Yellow
			case "WARN":
				return "#5865f2"; // Blurple
			case "UNBAN":
				return "#00ff00"; // Green
			case "UNTIMEOUT":
				return "#2ecc71"; // Success Green
			default:
				return "#2f3136"; // Dark Gray
		}
	}

	/**
	 * Sends a formatted log to the designated logging channel
	 */
	private static async logAction(client: Client, guildId: string, caseData: ICase) {
		try {
			const settings = await DiscordGuildManager.getSettings(guildId);
			if (!settings.logChannelId) return;

			// Resolve the guild and channel from the client cache
			const guild = await client.guilds.fetch(guildId).catch(() => null);
			if (!guild) return;

			const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);
			if (!channel || !(channel instanceof TextChannel)) return;

			const targetUser = await client.users.fetch(caseData.userId).catch(() => null);
			const logEmbed = new EmbedBuilder()
				.setTitle(`${caseData.type} | Case #${caseData.caseId}`)
				.setColor(this.getSeverityColor(caseData.type))
				.setThumbnail(targetUser?.displayAvatarURL() ?? null)
				.addFields(
					{
						name: "User",
						value: targetUser ? `${targetUser.tag} (\`${targetUser.id}\`)` : `${caseData.userTag} (\`${caseData.userId}\`)`,
						inline: true,
					},
					{ name: "Moderator", value: `${userMention(caseData.moderatorId)}`, inline: true },
					{ name: "Reason", value: caseData.reason },
				)
				.setFooter({ text: `User ID: ${caseData.userId}` })
				.setTimestamp(caseData.timestamp);

			if (caseData.duration) {
                const expirationTimestamp = new Timestamp(caseData.timestamp.getTime() + caseData.duration);

				logEmbed.addFields(
					{ name: "Duration", value: `${Math.round(caseData.duration / 60000)} minutes`, inline: true },
					{ name: "Expires", value: `${expirationTimestamp.getShortDateTime()} (${expirationTimestamp.getRelativeTime()})`, inline: true },
				);
			}

			if (caseData.evidence) logEmbed.setImage(caseData.evidence);

			const me = guild.members.me ?? (await guild.members.fetch(client.user!.id));
			const canManageWebhooks = me.permissionsIn(channel).has(PermissionFlagsBits.ManageWebhooks);

			if (canManageWebhooks) {
				const webhooks = await channel.fetchWebhooks();
				let webhook = webhooks.find((wh) => wh.name === client.user?.username);

				if (!webhook) {
					webhook = await channel.createWebhook({
						name: client.user?.username ?? "Moderation Logs",
						avatar: client.user?.displayAvatarURL(),
						reason: "Automated moderation logging setup",
					});
				}

				await webhook.send({
					embeds: [logEmbed],
					username: client.user?.username,
					avatarURL: client.user?.displayAvatarURL(),
				});
			} else {
				// Fallback: Send as a regular bot message if Manage Webhooks is missing
				await channel.send({ embeds: [logEmbed] });
			}
		} catch (error) {
			Logger.error("DISCORD_MOD_LOG", `Failed to log Case #${caseData.caseId} for Guild ${guildId}`, error);
		}
	}

	/**
	 * Generic event logger for channel/server changes
	 */
	static async logEvent(client: Client, guildId: string, options: EmbedBuilder | MessageCreateOptions) {
		try {
			const settings = await DiscordGuildManager.getSettings(guildId);
			if (!settings.logChannelId) return;

			const guild = await client.guilds.fetch(guildId).catch(() => null);
			const channel = await guild?.channels.fetch(settings.logChannelId).catch(() => null);
			if (!(channel instanceof TextChannel)) return;

			// Normalize the input: if they just passed an embed, wrap it in an object
			const payload: MessageCreateOptions = options instanceof EmbedBuilder ? { embeds: [options] } : options;

			const me = guild!.members.me ?? (await guild!.members.fetch(client.user!.id));

			if (me.permissionsIn(channel).has(PermissionFlagsBits.ManageWebhooks)) {
				const webhooks = await channel.fetchWebhooks();
				let webhook = webhooks.find((wh) => wh.name === client.user?.username);

				if (!webhook) {
					webhook = await channel.createWebhook({
						name: client.user?.username ?? "System Logs",
						avatar: client.user?.displayAvatarURL(),
					});
				}

				await webhook.send({
					...payload,
					username: client.user?.username,
					avatarURL: client.user?.displayAvatarURL(),
				});
			} else {
				await channel.send(payload);
			}
		} catch (error) {
			Logger.error("DISCORD_EVENT_LOG", `Failed to log event for Guild ${guildId}`, error);
		}
	}
}

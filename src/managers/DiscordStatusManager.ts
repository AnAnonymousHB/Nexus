import { bold, EmbedBuilder } from "discord.js";

import { DiscordStatusModel } from "../models/index.js";
import { Timestamp } from "../utils/index.js";
import { Logger } from "./index.js";

const STATUS_URL = "https://srhpyqt94yxb.statuspage.io/api/v2/incidents.json";

interface IncidentUpdate {
	id: string;
	status: string;
	body: string;
	incident_id: string;
	created_at: string;
	updated_at: string;
	display_at: string;
}

interface Incident {
	id: string;
	name: string;
	status: "resolved" | "monitoring" | "investigating" | "critical" | string;
	created_at: string;
	updated_at: string;
	monitoring_at: string | null;
	resolved_at: string | null;
	impact: string;
	shortlink: string;
	incident_updates: IncidentUpdate[];
}

interface StatusPageResponse {
	incidents: Incident[];
}

export class DiscordStatusManager {
	private lastIncidentId: string | null = null;
	private lastUpdatedAt: number | null = null;
	private lastMessageId: string | null = null;

	async fetchUpdate() {
		try {
			const response = await fetch(STATUS_URL);
			if (!response.ok) throw new Error(`StatusPage API error: ${response.status}`);

			const data = await response.json();
			const latest = data?.incidents?.[0];

			if (!latest) return null;

			const updateTime = Date.parse(latest.updated_at);

			if (this.lastIncidentId === latest.id && this.lastUpdatedAt === updateTime) {
				return null;
			}

			const cache = await DiscordStatusModel.findOne({ key: "discord_status" });
			const cachedId = cache?.lastIncidentId ?? null;
			const cachedTime = cache?.lastUpdatedAt ?? null;
			const cachedMsgId = cache?.lastMessageId ?? null;

			if (cache && latest.id === cache.lastIncidentId && updateTime <= cache.lastUpdatedAt!) {
				// Sync local cache with DB to prevent future DB hits for this incident
				this.lastIncidentId = cachedId;
				this.lastUpdatedAt = cachedTime;
				this.lastMessageId = cachedMsgId;
				return null;
			}

			const isNewIncident = latest.id !== (this.lastIncidentId ?? cachedId);
			const targetMessageId = isNewIncident ? null : (this.lastMessageId ?? cachedMsgId);

			const embed = this.buildStatusEmbed(latest);

			await DiscordStatusModel.findOneAndUpdate(
				{ key: "discord_status" },
				{ lastIncidentId: latest.id, lastUpdatedAt: updateTime },
				{ upsert: true },
			);

			this.lastIncidentId = latest.id;
			this.lastUpdatedAt = updateTime;
			this.lastMessageId = targetMessageId;

			return { embed, messageId: targetMessageId };
		} catch (error) {
			Logger.error("DISCORD_STATUS_MANAGER", "Failed to fetch Discord status", error);
			return null;
		}
	}

	async saveMessageId(messageId: string) {
		this.lastMessageId = messageId;
		await DiscordStatusModel.findOneAndUpdate({ key: "discord_status" }, { lastMessageId: messageId });
	}

	private buildStatusEmbed(incident: Incident) {
		const colors: Record<string, number> = {
			critical: 0xe74c3c, // Red
			major: 0xe67e22, // Orange
			minor: 0xf1c40f, // Yellow
			none: 0x3498db, // Blue
		};

		const isResolved = incident.status === "resolved" || incident.status === "postmortem";
		const embedColor = isResolved ? 0x2ecc71 : colors[incident.impact] || colors.none;

		const embed = new EmbedBuilder()
			.setTitle(incident.name)
			.setURL(incident.shortlink)
			.setColor(embedColor)
			.setDescription(`* Impact: ${bold(incident.impact || "None")}`)
			.setTimestamp(new Date(incident.updated_at))
			.setFooter({ text: incident.id });

		incident.incident_updates.forEach((update: IncidentUpdate) => {
			const createdAt = new Timestamp(Date.parse(update.created_at));
			const statusLabel = update.status.charAt(0).toUpperCase() + update.status.slice(1);
			const relTime = createdAt.getRelativeTime();

			embed.addFields({
				name: `${bold(statusLabel)} (${relTime})`,
				value: update.body.length > 1024 ? update.body.substring(0, 1021) + "..." : update.body,
			});
		});

		return embed;
	}
}

export const discordStatusManager = new DiscordStatusManager();

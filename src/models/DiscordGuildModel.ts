import { Document, model, Schema } from "mongoose";

export interface ITwitchNotification {
	twitchUserId: string;
	twitchChannelName: string;
	discordChannelId: string;
	liveMessage: string;
	pingRoleId?: string | null;
	isLive: boolean;
	lastMessageId?: string | null;
	autoPublish?: boolean; // Crosspost message
}

export interface IGuild extends Document {
	guildId: string;
	prefix: string;
	logChannelId: string | null;
	caseLogChannelId: string | null;
	roles: {
		admin: string[];
		mod: string[];
	};
	twitchNotifications: ITwitchNotification[];
	disabledEvents: string[];
}

const GuildSchema = new Schema<IGuild>({
	guildId: { type: String, required: true, unique: true },
	prefix: { type: String, default: "!" },
	logChannelId: { type: String, default: null },
	caseLogChannelId: { type: String, default: null },
	roles: {
		admin: { type: [String], default: [] },
		mod: { type: [String], default: [] },
	},
	// We use an array so one Discord server can follow multiple Twitch channels
	twitchNotifications: {
		type: [
			{
				twitchUserId: { type: String, required: true },
				twitchChannelName: { type: String, required: true },
				discordChannelId: { type: String, required: true },
				liveMessage: { type: String, default: "🔴 **{user}** is now live on Twitch!" },
				pingRoleId: { type: String, default: null },
				isLive: { type: Boolean, default: false },
				lastMessageId: { type: String, default: null },
				autoPublish: { type: Boolean, default: true },
			},
		],
		default: [],
	},
	disabledEvents: {
		type: [String],
		default: [],
	},
});

export const GuildModel = model<IGuild>("Discord_Guild", GuildSchema);

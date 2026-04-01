import { Document, model, Schema } from "mongoose";

export interface ICase extends Document {
	guildId: string;
	userId: string;
	userTag: string;
	moderatorId: string;
	type: "WARN" | "KICK" | "BAN" | "SOFTBAN" | "TIMEOUT" | "UNBAN" | "UNTIMEOUT";
	reason: string;
	timestamp: Date;
	duration?: number; // For timeouts (in ms)
	caseId: number;
	evidence?: string; // URL to an image or a link to a message
}

const CaseSchema = new Schema<ICase>({
	guildId: { type: String, required: true, index: true },
	userId: { type: String, required: true, index: true },
	userTag: { type: String, required: true, index: true },
	moderatorId: { type: String, required: true },
	type: {
		type: String,
		required: true,
		enum: ["WARN", "KICK", "BAN", "SOFTBAN", "TIMEOUT", "UNBAN", "UNTIMEOUT"],
	},
	reason: { type: String, default: "No reason provided." },
	timestamp: { type: Date, default: Date.now },
	duration: { type: Number },
	caseId: { type: Number, required: true },
	evidence: { type: String, required: false },
});

// Optimization: Speed up lookups for specific case IDs within a guild
CaseSchema.index({ guildId: 1, caseId: 1 }, { unique: true });

export interface IModUser extends Document {
	guildId: string;
	userId: string;
	warns: number;
	lastModAction: Date;
}

const ModUserSchema = new Schema<IModUser>({
	guildId: { type: String, required: true },
	userId: { type: String, required: true },
	warns: { type: Number, default: 0 },
	lastModAction: { type: Date, default: Date.now },
});

ModUserSchema.index({ guildId: 1, userId: 1 }, { unique: true });

export const DiscordCaseModel = model<ICase>("Discord_Case", CaseSchema);
export const DiscordModUserModel = model<IModUser>("Discord_ModUser", ModUserSchema);

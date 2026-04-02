import mongoose from "mongoose";

const DiscordStatusSchema = new mongoose.Schema({
	key: { type: String, required: true, unique: true },
	lastIncidentId: String,
	lastUpdatedAt: Number,
	lastMessageId: String,
});

export const DiscordStatusModel = mongoose.model("Discord_Status", DiscordStatusSchema);

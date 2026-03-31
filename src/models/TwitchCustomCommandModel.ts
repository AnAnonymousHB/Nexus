import mongoose, { Document, Schema } from "mongoose";

export interface ICustomCommand extends Document {
	channelId: string;
	commandName: string;
	response: string;
	cooldown: number; // Global cooldown in seconds
	userCooldown: number; // User cooldown in seconds
}

const CustomCommandSchema = new Schema<ICustomCommand>({
	channelId: { type: String, required: true },
	commandName: { type: String, required: true },
	response: { type: String, required: true },
	cooldown: { type: Number, default: 10 }, // Default 10s
	userCooldown: { type: Number, default: 10 }, // Default 10s
});

// Unique index so a channel can't have duplicate command names
CustomCommandSchema.index({ channelId: 1, commandName: 1 }, { unique: true });

export const TwitchCustomCommandModel = mongoose.model<ICustomCommand>("Twitch_CustomCommand", CustomCommandSchema);

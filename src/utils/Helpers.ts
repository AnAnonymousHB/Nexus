import { intervalToDuration } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { ChannelType } from "discord.js";

export const formatDuration = (start: Date): string => {
	const duration = intervalToDuration({
		start,
		end: new Date(),
	});

	const { years = 0, months = 0, days = 0, hours = 0, minutes = 0, seconds = 0 } = duration;

	// Convert extra days into weeks
	const weeks = Math.floor(days / 7);
	const remainingDays = days % 7;

	const parts: string[] = [];

	if (years) parts.push(`${years} year${years !== 1 ? "s" : ""}`);
	if (months) parts.push(`${months} month${months !== 1 ? "s" : ""}`);
	if (weeks) parts.push(`${weeks} week${weeks !== 1 ? "s" : ""}`);
	if (remainingDays) parts.push(`${remainingDays} day${remainingDays !== 1 ? "s" : ""}`);
	if (hours) parts.push(`${hours} hour${hours !== 1 ? "s" : ""}`);
	if (minutes) parts.push(`${minutes} minute${minutes !== 1 ? "s" : ""}`);
	if (seconds) parts.push(`${seconds} second${seconds !== 1 ? "s" : ""}`);

	return parts.join(", ");
};

export const formatDate = (date: Date, timeZone = "UTC", formatStr = "MMM do, yyyy 'at' HH:mm:ss z") => formatInTimeZone(date, timeZone, formatStr);

/**
 * Returns a random index based on a number,
 * or a random element from an array.
 */
export function random(input: number): number;
export function random<T>(input: T[]): T;
export function random<T>(input: T[] | number): T | number {
	if (Array.isArray(input)) {
		const index = Math.floor(Math.random() * input.length);
		return input[index];
	}

	return Math.floor(Math.random() * input);
}

export function toTitleCase(str: string): string {
	return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
}

export const getChannelTypeName = (type: ChannelType): string => {
	switch (type) {
		case ChannelType.GuildText:
			return "Text Channel";
		case ChannelType.GuildVoice:
			return "Voice Channel";
		case ChannelType.GuildCategory:
			return "Category";
		case ChannelType.GuildAnnouncement:
			return "Announcement Channel";
		case ChannelType.GuildStageVoice:
			return "Stage Channel";
		case ChannelType.GuildForum:
			return "Forum Channel";
		default:
			return "Unknown Type";
	}
};

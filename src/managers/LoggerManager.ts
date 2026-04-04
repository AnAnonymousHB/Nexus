import chalk from "chalk";
import { formatInTimeZone } from "date-fns-tz";
import {
	AttachmentBuilder, BaseMessageOptions, Client, EmbedBuilder, TextChannel
} from "discord.js";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

import { ChatUser } from "@twurple/chat";

import { DEFAULT_TIMEZONE, DISCORD_ERROR_CHANNEL_ID } from "../utils/index.js";

export class Logger {
	private static discordClient: Client | null = null;
	private static _winston: winston.Logger;

	static {
		// Initialize Winston
		const isProd = process.env.MODE === "PROD";

		// Terminal Format: Keeps all the Chalk colors for console
		const terminalFormat = winston.format.combine(winston.format.printf(({ message }) => `${message}`));

		// File Format: Strips colors and ensures NO JSON wrapping
		const fileFormat = winston.format.combine(
			winston.format.uncolorize(),
			winston.format.printf(({ message }) => `${message}`),
		);

		const errorRotateTransport = new DailyRotateFile({
			filename: "logs/error-%DATE%.log",
			datePattern: "YYYY-MM-DD",
			zippedArchive: true,
			maxSize: "20m",
			maxFiles: "14d",
			level: "error",
			format: fileFormat, // Apply clean format
		});

		const combinedRotateTransport = new DailyRotateFile({
			filename: "logs/combined-%DATE%.log",
			datePattern: "YYYY-MM-DD",
			zippedArchive: true,
			maxSize: "50m",
			maxFiles: "30d",
			format: fileFormat, // Apply clean format
		});

		const twitchRotateTransport = new DailyRotateFile({
			filename: "logs/twitch-%DATE%.log",
			datePattern: "YYYY-MM-DD",
			zippedArchive: true,
			maxSize: "10m",
			maxFiles: "7d",
			format: winston.format.combine(
				winston.format((info) => {
					// Check if message exists and is a string before calling .includes()
					if (typeof info.message === "string" && info.message.includes("[TWITCH]")) {
						return info;
					}
					return false;
				})(),
				fileFormat,
			),
		});

		this._winston = winston.createLogger({
			level: isProd ? "info" : "debug",
			// Remove the global format: json() here to prevent it from forcing JSON
			transports: [
				new winston.transports.Console({
					format: terminalFormat,
				}),
			],
		});

		if (isProd) {
			this._winston.add(twitchRotateTransport);
			this._winston.add(errorRotateTransport);
			this._winston.add(combinedRotateTransport);
		}
	}

	static setDiscordClient(client: Client) {
		this.discordClient = client;
	}

	private static get timestamp(): string {
		const time = formatInTimeZone(new Date(), DEFAULT_TIMEZONE, "yyyy-MM-dd HH:mm:ss zzz");
		return chalk.gray(`[${time}]`);
	}

	static info(category: string, message: string) {
		const out = `${this.timestamp} - ${chalk.blue(`[${category}]`)} ${message}`;
		this._winston.info(out);
	}

	static success(category: string, message: string) {
		const out = `${this.timestamp} - ${chalk.green(`[${category}]`)} ${message}`;
		this._winston.info(out);
	}

	static warn(category: string, message: string) {
		const out = `${this.timestamp} - ${chalk.yellow(`[${category}]`)} ${message}`;
		this._winston.warn(out);
	}

	static error(category: string, message: string, error?: unknown) {
		const out = `${this.timestamp} - ${chalk.red(`[${category}]`)} ${message}`;
		this._winston.error(out);

		if (error) {
			const stack = error instanceof Error ? error.stack : String(error);
			// Logging the stack trace directly to Winston so it hits the file clean
			this._winston.error(`${this.timestamp} - [STACK_TRACE] ${stack}`);
		}

		this.sendErrorToDiscord(category, message, error);
	}

	static debug(category: string, message: string) {
		const out = `${this.timestamp} - ${chalk.magenta(`[DEBUG][${category}]`)} ${message}`;
		this._winston.debug(out);
	}

	static section(name: string) {
		const out = `\n${this.timestamp} - ${chalk.bold.magentaBright(`>>> ${name} <<<`)}`;
		this._winston.info(out);
	}

	static chat(channel: string, user: ChatUser, text: string, color?: string) {
		const chan = chalk.magenta(`[#${channel}]`);
		const userColor = color ? chalk.hex(color) : chalk.yellow;
		const consoleOut = `${this.timestamp} ${chan} ${userColor(user.displayName)} (${chalk.gray(user.userId)}): ${chalk.white(text)}`;

		this._winston.info(consoleOut);
	}

	static event(type: "RAID" | "SUB" | "BITS", channel: string, message: string) {
		const colors = { RAID: chalk.magenta, SUB: chalk.cyan, BITS: chalk.yellowBright };
		const color = colors[type] || chalk.white;
		const out = `${this.timestamp} ${color(`[${type}]`)} ${chalk.magentaBright(`[${channel}]`)} ${message}`;
		this._winston.info(out);
	}

	private static async sendErrorToDiscord(category: string, message: string, error?: unknown) {
		if (!this.discordClient) return;

		try {
			const channel = (await this.discordClient.channels.fetch(DISCORD_ERROR_CHANNEL_ID)) as TextChannel;
			if (!channel) return;

			const errorStack = error instanceof Error ? error.stack || String(error) : String(error ?? "");
			const embed = new EmbedBuilder()
				.setTitle("🚨 System Error Detected")
				.setColor(category.toUpperCase().includes("TWITCH") ? "#9146FF" : "#5865F2")
				.addFields({ name: "Source", value: `\`${category}\``, inline: true }, { name: "Summary", value: message.substring(0, 1024) })
				.setTimestamp();

			const payload: BaseMessageOptions = { embeds: [embed] };

			if (error) {
				if (errorStack.length < 1000) {
					embed.addFields({ name: "Details", value: `\`\`\`ts\n${errorStack}\n\`\`\`` });
				} else {
					const attachment = new AttachmentBuilder(Buffer.from(errorStack, "utf-8"), {
						name: `error-${Date.now()}.txt`,
					});
					embed.addFields({ name: "Details", value: "⚠️ Error log too long. See attached file." });
					payload.files = [attachment];
				}
			}

			await channel.send(payload);
		} catch (err) {
			console.error("Logger Critical Failure: Could not dispatch to Discord.", err);
		}
	}
}

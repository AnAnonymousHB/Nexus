import {
	AnySelectMenuInteraction,
	AutocompleteInteraction,
	Awaitable,
	ButtonInteraction,
	ChatInputCommandInteraction,
	ContextMenuCommandBuilder,
	ContextMenuCommandInteraction,
	ModalSubmitInteraction,
	SlashCommandBuilder,
	SlashCommandOptionsOnlyBuilder,
	SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

export interface DiscordButton {
	customId: string;
	execute: (interaction: ButtonInteraction) => Promise<void>;
}

export interface DiscordCommand {
	/** * The Slash Command data (e.g., /avatar)
	 */
	data?: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;

	/** * The Context Menu data (e.g., Right-click -> Apps -> View Avatar)
	 */
	contextData?: ContextMenuCommandBuilder;

	/** * The main execution logic for both Slash and Context interactions
	 */
	execute: (interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction) => Awaitable<void>;

	/** * Optional: Only needed if the command uses autocomplete
	 */
	autocomplete?: (interaction: AutocompleteInteraction) => Awaitable<void>;
}

export interface DiscordModal {
	customId: string;
	execute: (interaction: ModalSubmitInteraction) => Awaitable<void>;
}

export interface DiscordSelectMenu {
	customId: string;
	execute: (interaction: AnySelectMenuInteraction) => Awaitable<void>;
}

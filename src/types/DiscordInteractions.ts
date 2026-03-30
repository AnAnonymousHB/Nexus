import {
	AnySelectMenuInteraction,
	AutocompleteInteraction,
	Awaitable,
	ButtonInteraction,
	ChatInputCommandInteraction,
	ContextMenuCommandBuilder,
	ContextMenuCommandInteraction,
	ModalSubmitInteraction,
	PermissionFlagsBits,
	SlashCommandBuilder,
	SlashCommandOptionsOnlyBuilder,
	SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

type PermissionResolvable = (typeof PermissionFlagsBits)[keyof typeof PermissionFlagsBits];

export interface BaseInteraction {
	botPermissions?: PermissionResolvable[];
	userPermissions?: PermissionResolvable[];
	devOnly?: boolean;
}

export interface DiscordButton extends BaseInteraction {
	customId: string;

	execute: (interaction: ButtonInteraction) => Promise<void>;
}

export interface DiscordCommand extends BaseInteraction {
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

export interface DiscordModal extends BaseInteraction {
	customId: string;

	execute: (interaction: ModalSubmitInteraction) => Awaitable<void>;
}

export interface DiscordSelectMenu extends BaseInteraction {
	customId: string;

	execute: (interaction: AnySelectMenuInteraction) => Awaitable<void>;
}

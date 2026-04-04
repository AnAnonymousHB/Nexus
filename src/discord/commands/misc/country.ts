import {
	AutocompleteInteraction,
	ButtonStyle,
	ChatInputCommandInteraction,
	ContainerBuilder,
	ContextMenuCommandInteraction,
	MediaGalleryBuilder,
	MessageFlags,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	SlashCommandBuilder,
	TimestampStyles,
	time,
} from "discord.js";

import { CountryManager, Logger } from "../../../managers/index.js";
import { DiscordCommand } from "../../../types/index.js";

interface Country {
	name: {
		official: string;
		nativeName?: Record<string, { official: string; common: string }>;
	};
	population: number;
	region: string;
	subregion?: string;
	continents: string[];
	capital?: string[];
	demonyms?: {
		eng: { f: string; m: string };
	};
	area: number;
	cca3: string;
	languages?: Record<string, string>;
	flags: { png: string; svg: string; alt?: string };
	currencies?: Record<string, { name: string; symbol: string }>;
	maps?: { googleMaps?: string };
}

const country: DiscordCommand = {
	data: new SlashCommandBuilder()
		.setName("country")
		.setDescription("See information/stats about a country.")
		.addStringOption((option) => option.setName("country").setDescription("The country to lookup.").setRequired(true).setAutocomplete(true)),
	async autocomplete(interaction: AutocompleteInteraction) {
		const focusedValue = interaction.options.getFocused();
		const filtered = CountryManager.getSuggestions(focusedValue);
		await interaction.respond(filtered.map((name) => ({ name, value: name })));
	},
	async execute(interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction) {
		if (!interaction.isChatInputCommand()) return;

		await interaction.deferReply();

		try {
			const countryName = interaction.options.getString("country")!;

			const cachedData = CountryManager.getCache(countryName);
			if (cachedData) {
				const container = createCountryContainer(cachedData);
				return void (await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 }));
			}

			const response = await fetch(`https://restcountries.com/v3.1/name/${encodeURIComponent(countryName)}?fullText=true`);

			if (!response.ok) return void (await interaction.editReply(`No results were found for "${countryName}".`));

			const data = (await response.json()) as Country[];
			const country = data[0];

			if (!country) return void (await interaction.editReply(`No results were found for "${countryName}".`));

			const container = createCountryContainer(country);
			await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
		} catch (error) {
			Logger.error("DISCORD_COUNTRY", `Error in country command`, error);
			await interaction.editReply("An error has occurred.");
		}
	},
};

function createCountryContainer(country: Country): ContainerBuilder {
	const { name, population, region, subregion, continents, capital, demonyms, area, cca3, languages, flags, currencies, maps } = country;

	const nativeName = name.nativeName ? Object.values(name.nativeName).map((n: { official: string }) => n.official)[0] : name.official;

	const languagesList = languages ? Object.values(languages).join(", ") : "-";

	const currencyEntries = currencies ? Object.entries(currencies) : [];
	const currencyString = currencyEntries.length ? currencyEntries.map(([code, details]) => `${details.name} (${details.symbol} ${code})`).join(", ") : "-";

	const areaMiles = area ? Math.round(area * 0.386102).toLocaleString() : "-";
	const areaString = area ? `${area.toLocaleString()} km² (~${areaMiles} mi²)` : "-";
	const formattedDemonyms = demonyms?.eng
		? Object.entries(demonyms.eng)
				.map(([type, val]) => `${type.toUpperCase()}: ${val}`)
				.join(" / ")
		: "-";

	const mapsUrl = maps?.googleMaps ?? `https://www.google.com/maps/search/${encodeURIComponent(name.official)}`;

	// ── Header ───────────────────────────────────────────────────────────────
	const headerSection = new SectionBuilder()
		.addTextDisplayComponents(
			(text) => text.setContent(`# ${name.official}`),
			(text) => text.setContent(`**${cca3}** · ${continents?.join(", ") || "-"}`),
		)
		.setButtonAccessory((button) => button.setLabel("View on Google Maps").setURL(mapsUrl).setStyle(ButtonStyle.Link));

	// ── Flag ─────────────────────────────────────────────────────────────────
	const flagGallery = new MediaGalleryBuilder().addItems((item) => item.setURL(flags.png).setDescription(flags.alt ?? `Flag of ${name.official}`));

	return (
		new ContainerBuilder()
			.setAccentColor(0x0099ff)
			// Header
			.addSectionComponents(headerSection)
			.addSeparatorComponents((sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			// Flag
			.addMediaGalleryComponents(flagGallery)
			.addSeparatorComponents((sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			// Geography & People
			.addTextDisplayComponents((text) => text.setContent("### 📍 Geography & People"))
			.addTextDisplayComponents((text) =>
				text.setContent(
					`**Capital:** ${capital?.join(", ") || "-"}\n` +
						`**Region:** ${subregion || region}\n` +
						`**Area:** ${areaString}\n` +
						`**Population:** ${population.toLocaleString()}\n` +
						`**Demonym:** ${formattedDemonyms}`,
				),
			)
			.addSeparatorComponents((sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			// Language & Economy
			.addTextDisplayComponents((text) => text.setContent("### 🌐 Language & Economy"))
			.addTextDisplayComponents((text) =>
				text.setContent(`**Native Name:** ${String(nativeName)}\n` + `**Language${languagesList.split(",").length > 1 ? "s" : ""}:** ${languagesList}\n` + `**Currency:** ${currencyString}`),
			)
			.addSeparatorComponents((sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			// Footer
			.addTextDisplayComponents((text) => text.setContent(`-# Country data provided by restcountries.com · ${time(new Date(), TimestampStyles.ShortDateTime)}`))
	);
}

export default country;

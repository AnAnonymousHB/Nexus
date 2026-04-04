import {
	AutocompleteInteraction,
	ButtonStyle,
	ChatInputCommandInteraction,
	ContainerBuilder,
	ContextMenuCommandInteraction,
	MediaGalleryBuilder,
	MessageFlags,
	SectionBuilder,
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
	flags: { png: string; svg: string };
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

// Truncate to Discord's 80 char button label limit
const btn = (label: string) => (label.length > 80 ? label.slice(0, 77) + "..." : label);

// Disabled button helper
const disabledBtn = (id: string, label: string) => (button: any) => button.setLabel(btn(label)).setCustomId(id).setStyle(ButtonStyle.Secondary).setDisabled(true);

function createCountryContainer(country: Country): ContainerBuilder {
	const { name, population, region, subregion, continents, capital, demonyms, area, cca3, languages, flags, currencies, maps } = country;

	const nativeName = name.nativeName ? Object.values(name.nativeName).map((n: any) => n.official)[0] : name.official;

	const languagesList = languages ? Object.values(languages).join(", ") : "-";

	const currencyEntries = currencies ? Object.entries(currencies) : [];
	const currencyString = currencyEntries.length ? currencyEntries.map(([code, details]) => `${details.name} (${details.symbol} ${code})`).join(", ") : "-";

	const areaMiles = area ? Math.round(area * 0.386102).toLocaleString() : "-";
	const areaString = area ? `${area.toLocaleString()} km² (~${areaMiles} mi²)` : "-";
	const formattedDemonyms = demonyms?.eng
		? Object.entries(demonyms.eng)
				.map(([type, val]) => `${type.toUpperCase()}: ${val}`)
				.join("\n")
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
	const flagGallery = new MediaGalleryBuilder().addItems((item) => item.setURL(flags.png));

	// ── Geography & People ───────────────────────────────────────────────────
	const capitalSection = new SectionBuilder()
		.addTextDisplayComponents((text) => text.setContent("**Capital**"))
		.setButtonAccessory((button) =>
			button
				.setLabel(btn(capital?.join(", ") || "-"))
				.setURL(capital ? `https://www.google.com/maps/search/${encodeURIComponent(capital[0])}` : mapsUrl)
				.setStyle(ButtonStyle.Link),
		);

	const regionSection = new SectionBuilder().addTextDisplayComponents((text) => text.setContent("**Region**")).setButtonAccessory(disabledBtn("region_val", subregion || region));

	const areaSection = new SectionBuilder().addTextDisplayComponents((text) => text.setContent("**Area**")).setButtonAccessory(disabledBtn("area_val", areaString));

	const populationSection = new SectionBuilder().addTextDisplayComponents((text) => text.setContent("**Population**")).setButtonAccessory(disabledBtn("population_val", population.toLocaleString()));

	const demonymSection = new SectionBuilder().addTextDisplayComponents((text) => text.setContent("**Demonym**")).setButtonAccessory(disabledBtn("demonym_val", formattedDemonyms));

	// ── Language & Economy ───────────────────────────────────────────────────
	const nativeNameSection = new SectionBuilder().addTextDisplayComponents((text) => text.setContent("**Native Name**")).setButtonAccessory(disabledBtn("nativename_val", String(nativeName)));

	const languagesSection = new SectionBuilder()
		.addTextDisplayComponents((text) => text.setContent(`**Language${languagesList.split(",").length > 1 ? `s` : ""}**`))
		.setButtonAccessory(disabledBtn("languages_val", languagesList));

	const currencySection = new SectionBuilder().addTextDisplayComponents((text) => text.setContent("**Currency**")).setButtonAccessory(disabledBtn("currency_val", currencyString));

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
			.addSectionComponents(capitalSection)
			.addSectionComponents(regionSection)
			.addSectionComponents(areaSection)
			.addSectionComponents(populationSection)
			.addSectionComponents(demonymSection)
			.addSeparatorComponents((sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			// Language & Economy
			.addTextDisplayComponents((text) => text.setContent("### 🌐 Language & Economy"))
			.addSectionComponents(nativeNameSection)
			.addSectionComponents(languagesSection)
			.addSectionComponents(currencySection)
			.addSeparatorComponents((sep) => sep.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			// Footer
			.addTextDisplayComponents((text) => text.setContent(`-# Country data provided by restcountries.com · ${time(new Date(), TimestampStyles.ShortDateTime)}`))
	);
}

export default country;

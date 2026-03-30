import { AutocompleteInteraction, ChatInputCommandInteraction, ContextMenuCommandInteraction, EmbedBuilder, SlashCommandBuilder } from "discord.js";

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
}

const country: DiscordCommand = {
	data: new SlashCommandBuilder()
		.setName("country")
		.setDescription("See information/stats about a country.")
		.addStringOption((option) => option.setName("country").setDescription("The country to lookup.").setRequired(true).setAutocomplete(true)),
	async autocomplete(interaction: AutocompleteInteraction) {
		const focusedValue = interaction.options.getFocused();

		const filtered = CountryManager.getSuggestions(focusedValue);

		await interaction.respond(filtered.map((name) => ({ name: name, value: name })));
	},
	async execute(interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction) {
		if (!interaction.isChatInputCommand()) return;

		await interaction.deferReply();

		try {
			const countryName = interaction.options.getString("country")!;

			// Check Cache first
			const cachedData = CountryManager.getCache(countryName);
			if (cachedData) {
				const embed = createCountryEmbed(cachedData);
				return void (await interaction.editReply({ embeds: [embed] }));
			}

			// If not cached, fetch from API
			const response = await fetch(`https://restcountries.com/v3.1/name/${encodeURIComponent(countryName)}?fullText=true`);

			if (!response.ok) return void (await interaction.editReply(`No results were found for "${countryName}".`));

			const data = (await response.json()) as Country[];
			const country = data[0];

			if (!country) return void (await interaction.editReply(`No results were found for "${countryName}".`));

			const embed = createCountryEmbed(country);

			// Remove 'return' from the final call
			await interaction.editReply({ embeds: [embed] });
		} catch (error) {
			Logger.error("DISCORD_COUNTRY", `Error in country command`, error);
			await interaction.editReply("An error has occurred.");
		}
	},
};

function createCountryEmbed(country: Country): EmbedBuilder {
	const { name, population, region, subregion, continents, capital, demonyms, area, cca3, languages, flags, currencies } = country;

	const nativeName = name.nativeName ? Object.values(name.nativeName).map((n: any) => n.official)[0] : name.official;

	const formattedDemonyms =
		demonyms?.eng ?
			Object.entries(demonyms.eng)
				.map(([type, val]) => `${type.toUpperCase()}: ${val}`)
				.join("\n")
		:	"-";

	const languagesList = languages ? Object.values(languages).join(", ") : "-";

	// Currency parsing
	const currencyEntries = currencies ? Object.entries(currencies) : [];
	const currencyString =
		currencyEntries.length ? currencyEntries.map(([code, details]) => `${details.name} (${details.symbol} ${code})`).join(", ") : "-";

	// Area conversion (km to miles) using 0.386102 as the constant
	const areaMiles = area ? Math.round(area * 0.386102).toLocaleString() : "-";

	return new EmbedBuilder()
		.setColor("#0099ff")
		.setAuthor({ name: `Country Information - ${cca3}`, iconURL: flags.png })
		.setThumbnail(flags.png)
		.setTitle(name.official)
		.addFields(
			{ name: "📊 Population", value: population.toLocaleString(), inline: true },
			{ name: "🏙️ Capital", value: capital?.join(", ") || "-", inline: true },
			{ name: "💰 Currency", value: currencyString, inline: true },
			{ name: "🌍 Continent", value: continents?.join(", ") || "-", inline: true },
			{ name: "📍 Region", value: subregion || region, inline: true },
			{ name: "👥 Demonym", value: formattedDemonyms, inline: true },
			{ name: "🗣️ Native Name", value: String(nativeName), inline: true },
			{ name: "🌐 Languages", value: languagesList, inline: true },
			{ name: "📐 Area", value: area ? `${area.toLocaleString()} km² (~${areaMiles} mi²)` : "-", inline: true },
		)
		.setFooter({ text: "Country data provided by restcountries.com" })
		.setTimestamp();
}

export default country;

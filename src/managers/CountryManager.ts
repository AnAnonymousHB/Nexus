import { Logger } from "./index.js";

interface Country {
	name: {
		common: string;
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

export class CountryManager {
	private static countries: string[] = [];

	// Cache for full country data to avoid repeated API calls
	private static dataCache = new Map<string, { data: any; timestamp: number }>();
	private static readonly CACHE_TTL = 1000 * 60 * 60 * 24; // 24 Hours

	/**
	 * Initializes the cache on startup
	 */
	static async init() {
		try {
			const resp = await fetch("https://restcountries.com/v3.1/all?fields=name");
			const data = (await resp.json()) as Country[];

			this.countries = data.map((c) => c.name.common).sort((a: string, b: string) => a.localeCompare(b));

			Logger.success("DISCORD_COUNTRY", `🌍 Cached ${this.countries.length} countries.`);
		} catch (error) {
			Logger.error("DISCORD_COUNTRY", "Failed to fetch country list", error);
			this.countries = [];
		}
	}

	/**
	 * Filters the cache for autocomplete suggestions
	 */
	static getSuggestions(query: string): string[] {
		// If the user hasn't typed anything, return the first 25 countries
		if (!query) {
			return this.countries.slice(0, 25);
		}

		const lowerQuery = query.toLowerCase();
		return this.countries.filter((name) => name.toLowerCase().includes(lowerQuery)).slice(0, 25);
	}

	// Getter in case you need the raw list elsewhere
	static get allNames() {
		return this.countries;
	}

	static setCache(name: string, data: Country) {
		this.dataCache.set(name.toLowerCase(), {
			data,
			timestamp: Date.now(),
		});
	}

	static getCache(name: string): Country | null {
		const cached = this.dataCache.get(name.toLowerCase());
		if (!cached) return null;

		// If data is older than 24 hours, consider it stale
		if (Date.now() - cached.timestamp > this.CACHE_TTL) {
			this.dataCache.delete(name.toLowerCase());
			return null;
		}

		return cached.data;
	}
}

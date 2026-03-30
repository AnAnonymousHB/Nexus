import { ApiClient } from "@twurple/api";

export interface CronTask {
	name: string;
	schedule: string; // e.g., "0 0 * * *"
	run: (apiClient: ApiClient) => Promise<void>;
}

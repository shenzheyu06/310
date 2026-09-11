import fs from "fs/promises";

export class DataDirectory {
	private static instance: DataDirectory;
	private dataDirectory: string;

	private constructor(dataDir: string) {
		this.dataDirectory = dataDir;
	}

	public static getInstance(dataDir?: string): DataDirectory {
		if (!this.instance) {
			if (dataDir) {
				this.instance = new DataDirectory(dataDir);
			} else {
				this.instance = new DataDirectory("no_data_directory");
			}
		}

		return this.instance;
	}

	public getDataDirectory(): string {
		return this.dataDirectory;
	}

	public async makeDirectory(): Promise<void> {
		await fs.mkdir(this.dataDirectory, { recursive: true });
	}
}

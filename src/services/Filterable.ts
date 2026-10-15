export interface Filterable {
	getValue(key: string): string | number | undefined;
	getIdentity(): string;
}

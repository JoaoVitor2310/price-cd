export interface Price {
	id: number;
	originalPrice: number;
	merchant: number;
	edition: string;
	region: string;
	price: number;
	pricePaypal: number;
	feesPaypal: number;
	priceCard: number;
	feesCard: number;
	dispo: number;
	account: boolean;
	activationPlatform: string;
}

export interface Region {
	region_short_description: string;
	filter_name: string;
	region_name: string;
	region_long_description: string;
}

export interface Regions {
	[key: string]: Region;
}

export interface Merchant {
	name: string;
	logo: string;
	rating: {
		score: number;
		count: number;
		maximum: number;
	};
	official: boolean;
	paypal: boolean;
}

export interface Merchants {
	[key: string]: Merchant;
}

export interface GameData {
	prices: Price[];
	regions: Regions;
	merchants: Merchants;
}

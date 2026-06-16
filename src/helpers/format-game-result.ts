type GameResultLine = {
    name: string;
    price: string;
    popularity: number;
    region?: string | null;
};

export function formatGameResultLine({ name, price, popularity, region }: GameResultLine): string {
    const date = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
    return `\t${date}\t${price}\t\t\t\t\t${popularity}\t${region ?? ""}\t\t${name}`;
}

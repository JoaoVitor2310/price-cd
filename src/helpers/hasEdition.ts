
export const hasEdition = (str: string): Set<string> => {
    const regexList: RegExp[] = [
        /\bedition\b/gi,
        /\bdefinitive\b/gi,
        /\bstandard\b/gi,
        /\bgame of the year\b/gi,
        /\bgoty\b/gi,
        /\bg\.o\.t\.y\b/gi,
        /\bdeluxe\b/gi,
        /\bpremium\b/gi,
        /\bbundle\b/gi,
        /\bspecial\b/gi,
        /\bcomplete\b/gi,
    ];
    const foundKeywords = new Set<string>();

    for (const regex of regexList) {
        if (regex.test(str)) {
            foundKeywords.add(regex.source);
        }
    }

    return foundKeywords;
};

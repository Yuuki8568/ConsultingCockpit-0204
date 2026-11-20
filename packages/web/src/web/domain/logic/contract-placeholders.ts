/** Unresolved template tokens; a standalone circle/check-box is not a placeholder. */
export function unresolvedContractMarkers(text: string): string[] {
 return [...new Set(text.match(/\{\{[^}]+\}\}|\[(?:要入力|案件確認):[^\]]+\]|［[^］\n]+］|○+(?=[年月日時分回件円％%]|[,，]○)|(?:毎月|月|約|令和)○+|未確認（確認者が結果を記入してください）/g) ?? [])];
}

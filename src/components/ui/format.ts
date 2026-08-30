export const n1 = (v: number): string => (Math.round(v * 10) / 10).toFixed(1);

export const n0 = (v: number): string => Math.round(v).toString();

export const signed1 = (v: number): string => `${v > 0 ? "+" : ""}${n1(v)}`;

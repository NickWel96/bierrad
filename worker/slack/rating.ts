/** Fixed workspace emoji names; never accept names or image URLs from a client. */
export type RatingEmoji = { type: "emoji"; name: string };
const format = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Round once to tenths, so the five stars and the printed score always agree. */
export function slackRating(average: number) {
  const value = format.format(
    Number.isFinite(average) ? Math.min(5, Math.max(0, average)) : 0,
  );
  const tenths = Math.round(Number(value) * 10);
  const elements: RatingEmoji[] = Array.from({ length: 5 }, (_, index) => {
    const fill = Math.min(10, Math.max(0, tenths - index * 10));
    return {
      type: "emoji",
      name: fill === 10 ? "star" : fill === 0 ? "bierrad_star_empty" : `bierrad_star_${fill}`,
    };
  });
  return { value, elements, text: elements.map((e) => `:${e.name}:`).join("") };
}

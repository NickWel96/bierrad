import { useTheme } from "../Theme";
import type { Participant } from "../domain/models";
import { joinNames } from "../domain/presentation";
export function SpectatorResult({
  winners,
}: {
  winners: readonly Participant[];
}) {
  const theme = useTheme();
  // One wheel already shows its haler in the banner: one line is enough here.
  if (winners.length === 1)
    return (
      <section className="spectator-result">
        <p className="spectator-result-line">
          {theme.icon} Het rad heeft gesproken: <strong>{winners[0].name}</strong>{" "}
          {theme.resultOne}
        </p>
      </section>
    );
  return (
    <section className="spectator-result">
      <span className="eyebrow">
        {theme.icon} Het rad heeft gesproken!
      </span>
      <p className="spectator-result-names">
        {joinNames(winners.map((winner) => winner.name))}
      </p>
      <p>{theme.resultMany}</p>
    </section>
  );
}

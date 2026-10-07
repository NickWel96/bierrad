import { roundCopy } from "../../shared/channel";
import { reviewLabels } from "../../shared/reviews";
import { themes } from "../../shared/variant";

/** Made-up colleagues: the explainer never shows real people or channels. */
const names = ["Nick", "Alice", "Bob"] as const;
const winner = names[0];

/**
 * How a channel round goes, from slash command to review, as five static
 * pictures. Display only: no network, no draw and not the real wheel.
 */
export function RoundExplainer() {
  const theme = themes.coffee;
  const round = roundCopy("coffee").round;
  const title = `${theme.icon} ${round[0].toUpperCase()}${round.slice(1)} om 10:05`;
  const labels = reviewLabels.coffee;
  const colors = theme.wheelColors ?? [];
  return (
    <section className="round-explainer" aria-labelledby="round-explainer-title">
      <h2 id="round-explainer-title">Zo gaat een {round}</h2>
      <ol>
        <li>
          <h3>Aanvragen</h3>
          <p>
            Typ <code>/koffierad 5</code> in het kanaal: over vijf minuten draait
            het rad.
          </p>
          <div className="explainer-shot" aria-hidden="true">
            <div className="explainer-input">
              /koffierad 5<span className="explainer-caret" />
            </div>
          </div>
        </li>
        <li>
          <h3>Aanmelden</h3>
          <p>
            Het {theme.name} plaatst een oproep. Wie op {theme.icon} klikt, doet
            mee.
          </p>
          <div className="explainer-shot" aria-hidden="true">
            <div className="explainer-message">
              <strong>{title}</strong>
              <span>Klik op {theme.icon} hieronder om mee te doen.</span>
              <span className="explainer-link">Kijk live mee</span>
              <span className="explainer-reaction">{theme.icon} 3</span>
            </div>
          </div>
        </li>
        <li>
          <h3>Draaien</h3>
          <p>
            Na de wachttijd draait het rad vanzelf op het scherm van het kanaal.
          </p>
          <div className="explainer-shot" aria-hidden="true">
            <svg className="explainer-wheel" viewBox="0 0 120 120">
              {names.map((name, i) => {
                const a = (i * 2 * Math.PI) / names.length - Math.PI / 2;
                const b = ((i + 1) * 2 * Math.PI) / names.length - Math.PI / 2;
                const m = (a + b) / 2;
                return (
                  <g key={name}>
                    <path
                      d={`M60 60 L${60 + 52 * Math.cos(a)} ${60 + 52 * Math.sin(a)} A52 52 0 0 1 ${60 + 52 * Math.cos(b)} ${60 + 52 * Math.sin(b)} Z`}
                      fill={colors[i % colors.length]}
                    />
                    <text x={60 + 30 * Math.cos(m)} y={60 + 30 * Math.sin(m)}>
                      {name}
                    </text>
                  </g>
                );
              })}
              <circle className="explainer-rim" cx="60" cy="60" r="52" />
              <circle className="explainer-hub" cx="60" cy="60" r="7" />
              <path className="explainer-pointer" d="M53 2 H67 L60 15 Z" />
            </svg>
            <span className="explainer-count">nog 0:12</span>
          </div>
        </li>
        <li>
          <h3>Winnaar</h3>
          <p>
            De oproep wordt de uitslag. De winnaar krijgt een @vermelding in de
            thread.
          </p>
          <div className="explainer-shot" aria-hidden="true">
            <div className="explainer-message">
              <strong>{title}</strong>
              <span>
                🏆 <span className="explainer-mention">@{winner}</span> haalt{" "}
                {theme.drink}
              </span>
              <small>3 deden mee</small>
            </div>
          </div>
        </li>
        <li>
          <h3>Beoordelen</h3>
          <p>
            Wie meedeed, geeft de haler anoniem 1 tot 5 sterren, van{" "}
            <em>{labels[0]}</em> tot <em>{labels[4]}</em>.
          </p>
          <div className="explainer-shot" aria-hidden="true">
            <div className="explainer-ballot">
              <span className="explainer-stars">
                ★★★★<span>★</span>
              </span>
              <small>{labels[3]}</small>
              <span>
                🏆 {winner} haalde {theme.drink} · ⭐ 4.3
              </span>
            </div>
          </div>
        </li>
      </ol>
    </section>
  );
}

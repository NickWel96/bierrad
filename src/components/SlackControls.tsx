import { useTheme } from "../Theme";
import { useEffect, useRef, useState } from "react";
import { startSlackAutoRefresh } from "../utils/slackAutoRefresh";
import type { SlackHostStatus } from "../../shared/protocol";
import { SESSION_REVIEW_MINUTE_CHOICES } from "../../shared/reviews";
export function SlackControls({
  status,
  locked,
  onImport,
  onManual,
  onReviews,
  scheduledStartAt,
}: {
  status: SlackHostStatus;
  scheduledStartAt?: string;
  locked: boolean;
  onImport: (link?: string) => Promise<void>;
  onManual: () => Promise<void>;
  onReviews?: (enabled: boolean, minutes: number) => Promise<void>;
}) {
  const theme = useTheme();
  const [tab, setTab] = useState(status.source),
    [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const busy = locked || status.importing || requesting;
  const latest = useRef({ status, locked: busy, scheduledStartAt, onImport });
  latest.current = { status, locked: busy, scheduledStartAt, onImport };
  useEffect(() => {
    if (status.source !== "slack") setAutoRefresh(false);
  }, [status.source]);
  useEffect(() => {
    if (!autoRefresh) return;
    return startSlackAutoRefresh(
      () => latest.current,
      async () => {
        setRequesting(true);
        setError("");
        try {
          await latest.current.onImport();
        } finally {
          setRequesting(false);
        }
      },
      (e) =>
        setError(
          e instanceof Error
            ? e.message
            : "Automatisch ophalen is niet gelukt.",
        ),
    );
  }, [autoRefresh]);
  const run = async (action: () => Promise<void>) => {
    setError("");
    setRequesting(true);
    try {
      await action();
      setLink("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ophalen is niet gelukt.");
    } finally {
      setRequesting(false);
    }
  };
  return (
    <>
      <div className="source-tabs">
        <button
          aria-pressed={tab === "manual"}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if (status.source === "slack") await onManual();
              setTab("manual");
            })
          }
        >
          ✎ Handmatig
        </button>
        <button
          aria-pressed={tab === "slack"}
          disabled={busy || !status.enabled}
          onClick={() => setTab("slack")}
        >
          Slack {theme.icon}
        </button>
      </div>
      {!status.enabled && (
        <p className="storage-note">
          Slack-toegang is verlopen of nog niet ingesteld.
        </p>
      )}
      {tab === "slack" && (
        <div className="slack-import">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => onImport(link));
            }}
          >
            <label htmlFor="slack-link">Slack-bericht</label>
            <input
              id="slack-link"
              type="url"
              required
              maxLength={1024}
              value={link}
              onChange={(e) => setLink(e.target.value)}
              disabled={busy || !status.enabled}
              placeholder="Plak de Slack-berichtlink"
              autoComplete="off"
              spellCheck={false}
            />
            <p>
              We kijken naar {theme.icon} :{theme.reaction}: op het
              hoofdbericht.
            </p>
            <button
              className="primary"
              disabled={busy || !status.enabled || !link}
            >
              {status.importing
                ? "Deelnemers ophalen…"
                : `${theme.icon} Deelnemers ophalen`}
            </button>
          </form>
          {status.source === "slack" && (
            <>
              <p role="status">
                {status.count === 0
                  ? `Niemand heeft met ${theme.icon} gereageerd.`
                  : `✓ Slack gekoppeld · ${status.count ?? 0} deelnemers`}
                <br />
                <small>
                  Laatst opgehaald:{" "}
                  {status.syncedAt
                    ? new Date(status.syncedAt).toLocaleTimeString("nl", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "—"}
                </small>
              </p>
              <button
                disabled={busy || !status.enabled}
                onClick={() => void run(() => onImport())}
              >
                ↻ Opnieuw ophalen
              </button>
              <label className="auto-refresh-toggle">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  disabled={!status.enabled}
                  onChange={(event) => setAutoRefresh(event.target.checked)}
                />
                Automatisch verversen · elke 5 minuten
              </label>
              <p className="storage-note">
                Zolang dit hostscherm openstaat. Pauzeert tijdens de trekking en
                vanaf twee minuten vóór de geplande start.
              </p>
              <p className="storage-note">
                Verversen volgt de actuele reacties. Handmatig toegevoegde namen
                blijven. De officiële uitslag gaat automatisch naar deze thread.
              </p>
              {status.reviews && onReviews && (
                <div className="slack-reviews">
                  <label className="auto-refresh-toggle">
                    <input
                      type="checkbox"
                      checked={status.reviews.enabled}
                      disabled={busy || !status.enabled}
                      onChange={(event) =>
                        void run(() =>
                          onReviews(event.target.checked, status.reviews!.minutes),
                        )
                      }
                    />
                    ⭐ Reviews na de trekking
                  </label>
                  {status.reviews.enabled && (
                    <label>
                      Stemmen kan{" "}
                      <select
                        value={status.reviews.minutes}
                        disabled={busy || !status.enabled}
                        onChange={(event) =>
                          void run(() =>
                            onReviews(true, Number(event.target.value)),
                          )
                        }
                      >
                        {SESSION_REVIEW_MINUTE_CHOICES.map((m) => (
                          <option key={m} value={m}>
                            {m < 60 ? `${m} minuten` : `${m / 60} uur`}
                          </option>
                        ))}
                      </select>{" "}
                      vanaf een minuut na de trekking
                    </label>
                  )}
                  <p className="storage-note">
                    De deelnamelink komt in deze thread, bij de uitslag en in de
                    herinnering: iedereen die de thread leest kan meekijken.
                    Deelnemers loggen in met Slack en geven de halers anoniem
                    sterren, nooit zichzelf. Een nieuwe trekking stopt een
                    lopende stemronde.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
export function SlackResultStatus({
  status,
  disabled,
  onRetry,
}: {
  status: SlackHostStatus;
  disabled: boolean;
  onRetry: () => void;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (status.result?.status !== "failed") return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [status.result?.status]);
  const result = status.result;
  if (!result) return null;
  const labels = {
    pending: "De officiële uitslag gaat na de trekking naar Slack.",
    posting: "De uitslag wordt naar Slack verstuurd…",
    posted: "✓ De uitslag staat in de Slack-thread.",
    failed: "De uitslag is geldig, maar posten in Slack is niet gelukt.",
    uncertain:
      "De uitslag is geldig. Controleer de Slack-thread: de aflevering is onzeker. We sturen niet opnieuw om dubbele berichten te voorkomen.",
  };
  return (
    <div className="slack-result" role="status">
      <p>{labels[result.status]}</p>
      {result.status === "failed" && status.enabled && (
        <button
          disabled={disabled || Date.now() < (result.retryAt ?? Infinity)}
          onClick={onRetry}
        >
          Opnieuw plaatsen
          {Date.now() < (result.retryAt ?? Infinity) ? " · even wachten" : ""}
        </button>
      )}
    </div>
  );
}

# Rondereviews (koffie en water): security- en implementatiereview — 2026-10-06

Implementatiereview tegen [SECURITY.md](../SECURITY.md#round-reviews--reviewed-exception-2026-10-06). Dit is geen onafhankelijke audit. De tests gebruiken alleen synthetische deelnemers en Slack-antwoorden. Er is niet tegen een echte Slack-workspace of Cloudflare-productie getest.

## Nieuw oppervlak

| Oppervlak | Autorisatie | Opmerkingen |
| --- | --- | --- |
| `POST /auth/slack/member` | Een geldige kanaallink (beheer-, aanvraag- of persoonlijke link) in een formulierbody | De Origin moet op de allowlist staan. De body is `application/x-www-form-urlencoded`, hooguit 1 KiB, met precies één veld `capability` en zonder query. Er gaan hooguit 30 logins per kanaal per minuut. Daarna volgt Sign in with Slack met het doel `member-<locator>` in de logincookie. |
| `GET /auth/slack/callback` (doel member) | De bestaande OIDC-controles; alleen volwaardige leden van de workspace van de bot | Het gebruikerstoken wordt ingetrokken. De user-ID wordt alleen omgezet in een pseudoniem. De persoonlijke link komt alleen in het fragment terecht. Fouten komen uit op `#/koffie-login/<reden>`. |
| `/api/channel`, rol `member` | De SHA-256-hash van een geheim van 256 bits, timing-safe vergeleken, met een vervaldatum | Heeft de rechten van de aanvraaglink, plus `review` en `logout`. Een member mag nooit beheren (403). |
| `/api/channel` `setReviews` | Alleen de beheerder | Strikte vorm: `enabled` boolean, `minutes` ∈ {5, 10, 15, 30}. |
| `requestRound.reviews` | Aanvraag- of persoonlijke link | Optionele boolean, anders 400. |

## Gegevens

- **Kanaal:** een HMAC-sleutel per koppeling, en per persoonlijke link alleen `{hash, pseudoniem, verloopt}`. Verder de reviewinstelling en hooguit vijf sessielocators van rondes met reviews; een locator geeft zelf geen toegang. Er worden geen Slack-ID's, namen of ruwe persoonlijke links opgeslagen; de integratietest controleert dat.
- **Sessie:** tot het sluiten de sleutel, de kanaallink, de pseudoniemen van wie mag stemmen en van wie gestemd heeft, en per winnaar de som, het aantal en de teksten. Bij het sluiten worden de pseudoniemen, de sleutel en de link gewist. De teksten worden gewist zodra het threadbericht is afgehandeld. De rest verdwijnt met de sessie, één uur na de start.
- **DTO's:** toeschouwers zien alleen `{closesAt, voted, eligible}`; een persoonlijke link ziet alleen de eigen deelname en het eigen stembiljet.

## Standaard

Reviews staan standaard aan, met 15 minuten stemtijd, ook voor bestaande koppelingen zonder opgeslagen keuze (gevraagd door de eigenaar op 2026-10-06). Daardoor linkt een oproep standaard naar de kanaalpagina in plaats van naar de woordlink. Dat is dezelfde link die al in het koppelbericht staat, dus het publiek wordt niet groter. De beheerder kan reviews uitzetten, en per aanvraag kan het ook.

Stemmen opent een minuut na de finale (gevraagd door de eigenaar), en de stemtijd telt vanaf dat moment. Een persoonlijke pagina vraagt het stemformulier op dat moment op en vijf seconden later nog eens; daarnaast pollt hij elke 10 seconden.

## Gecontroleerde risico's

- **Winnaar uitlekken:** stembiljetten openen pas een minuut na de laatste onthulling, en de server weigert te vroege stemmen.
- **Dubbel stemmen:** één stem per pseudoniem, binnen het Durable Object, zonder await tussen controle en schrijven. Een nieuwe login geeft hetzelfde pseudoniem en dus geen nieuwe stem.
- **Op jezelf stemmen:** de winnaar staat niet op de lijst van wie mag stemmen (403), en een stembiljet bevat nooit jezelf.
- **Injectie in Slack:** de teksten staan in `rich_text_quote` als tekstelementen, met `parse: none` en een ge-escapete fallback. `<!channel>`, mentions en links blijven letterlijke tekst. De invoer wordt opgeschoond: geen stuurtekens en geen bidi-overrides.
- **Herleidbaarheid:** bij het posten worden de teksten geschud en blijven er geen stemmen per persoon over. Na ontkoppelen is de sleutel weg.
- **Linklekken:** de kanaallink staat nooit in een backend-URL. De CSP `form-action` staat alleen self, de backend en slack.com toe. De oproep linkt alleen bij rondes met reviews naar de kanaalpagina; die link stond al in het koppelbericht.

## Geaccepteerde beperkingen

- **Persoonlijke links zijn bearer-toegang.** Wie er een doorgestuurd krijgt, kan namens die persoon stemmen.
- **Anoniem is niet ondoorzichtig.** In kleine groepen valt de schrijver soms te raden. Teksten worden niet gemodereerd en zijn zichtbaar voor iedereen in het kanaal, ook Slack Connect-leden.
- **Een mislukte of onzekere threadpost wordt niet herhaald** (hooguit één retry na een duidelijke weigering). Ook na een mislukte post verdwijnen de teksten.
- **Een sleutel die pas tijdens de ronde wordt aangemaakt:** bestaande rondes gebruiken de sleutel die er bij hun start was. Opnieuw koppelen tijdens een open review maakt stemmen in die ronde onmogelijk.

## Bierrad-sessies (PR 3)

Bierrad-sessies die met Sign in with Slack zijn gestart, krijgen dezelfde reviews per trekking. Zie de laatste alinea van de review-sectie in SECURITY.md.

| Oppervlak | Autorisatie | Opmerkingen |
| --- | --- | --- |
| `GET/POST /api/join` | Deelnamelink of persoonlijke link (256 bits, alleen de hash opgeslagen) | De deelnamelink ziet alleen `{role, variant, minutes}`. Een persoonlijke link ziet daarnaast de eigen deelname en het eigen stembiljet, en kan `review` en `logout`. Commando's met de deelnamelink geven 403. |
| `POST /auth/slack/join` | Een geldige deelnamelink of persoonlijke link in een formulierbody | Gelijk aan de kanaallogin. Er gaan hooguit 30 logins per sessie per minuut, en alleen zolang reviews aanstaan. De logincookie bevat `join-<variant>-<locator>`, dus de login gebruikt de Slack-app van die sessie. |
| `/api/session`, socket | De deelnamelink en persoonlijke links werken als kijklink | Er wordt nooit een hostcommando geaccepteerd (403). |
| Hostcommando `setReviews` | Alleen de host van een Slack-loginsessie | `enabled` boolean, `minutes` ∈ {15, 30, 60, 120}. |

- **Bewust risico:** de deelnamelink staat in de thread, bij de uitslag en in de opt-in herinnering. Iedereen die de thread leest, ook Slack Connect-leden, kan daardoor tot het einde van de sessie meekijken. De host-UI zegt dat, en reviews uitzetten stopt het. De ruwe deelnamelink blijft tot het einde van de sessie op de server, in de bewaarde URL.
- **Gedrag:** een nieuwe trekking annuleert een open review zonder post. Het hoofdbericht wordt nooit bewerkt. Handmatige namen stemmen niet en krijgen geen sterren. Je beoordeelt alle andere Slack-halers.

## Verificatie

- **`worker/tests/reviews.test.ts`:**
  - openen pas na de onthulling, en wie mag stemmen (zonder de winnaar en zonder onbekenden);
  - strikte stembiljetten, één stem per persoon, sluiten bij de laatste stem en wissen;
  - geen post als niemand stemt;
  - een oproep zonder uitnodiging als niemand kan stemmen;
  - de tekst van de oproep met en zonder sterren, en hele sterren;
  - de threadpost met letterlijke quotes en zonder broadcast;
  - het opschonen van tekst;
  - de logincookie met het doel `member`.
- **`worker/tests/reviews-live.test.ts`** (echte Worker en SQLite, nep-Slack):
  - geweigerde login-starts (Origin, verkeerde link, extra veld, contenttype, GET);
  - persoonlijke logins via de aanvraag-, beheer- en persoonlijke link, waarbij een nieuwe login de oude link vervangt;
  - geen identiteit in de kanaalopslag, en geen beheerrechten voor members;
  - een oproep met "Open de ronde";
  - geen stembiljet tijdens het draaien, wel daarna; winnaar en niet-deelnemers krijgen geen stembiljet;
  - voortgang met alleen aantallen;
  - geweigerd: stemmen op jezelf, ongeldige score of tekst, dubbel stemmen;
  - sluiten na de laatste stem, met de threadpost met quote en de bijgewerkte oproep met sterren;
  - geen stemmen, teksten, pseudoniemen, sleutel of link meer in de sessie;
  - uitloggen, en roteren dat alle persoonlijke links beëindigt.
- **`src/tests/channel.test.ts`:** de routes `#/koffie-login/<reden>`, `#/meedoen/<link>` en `#/meedoen-login/<reden>`.
- **`worker/tests/reviews.test.ts` (bier):**
  - een uitnodiging alleen als er iemand iets te beoordelen heeft;
  - een nieuwe trekking annuleert een open review;
  - reviews uit betekent niets;
  - de herinnering met deelnamelink;
  - de logincookie met het doel `join`.
- **`worker/tests/beer-reviews-live.test.ts`** (echte Worker en SQLite):
  - de standaardinstelling en het aanpassen ervan door de host;
  - een import plus een handmatige naam, met twee halers;
  - een uitnodiging in de uitslag met de deelnamelink;
  - de rechten van de deelnamelink: kijken wel, commando's en stemmen niet;
  - geweigerde login-starts en vier persoonlijke logins;
  - stembiljetten per persoon zonder jezelf en zonder de handmatige naam;
  - voortgang, één stem per persoon en sluiten met een post in de thread;
  - geen enkele `chat.update`, en wissen;
  - annuleren bij opnieuw draaien;
  - reviews uit: geen uitnodiging en geen login;
  - uitloggen.
- **Visueel:** het stemformulier en de inlogkeuze, gecontroleerd in de ingebouwde browser op desktop en 375 px (koffie en water). Er is geen horizontale overloop, en verzenden zonder sterren geeft een foutmelding in de tekst.

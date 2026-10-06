# Sterren voor Slack-reviews

Upload de tien PNG-bestanden als custom emoji in iedere Slack-workspace waar de app reviews plaatst. Gebruik de bestandsnaam zonder `.png` als emojinaam. De volle ster gebruikt Slack's bestaande `:star:` en hoeft niet te worden geüpload.

| Bestand / emojinaam | Vulling |
| --- | --- |
| `bierrad_star_empty.png` / `:bierrad_star_empty:` | Leeg |
| `bierrad_star_1.png` / `:bierrad_star_1:` | 0,1 |
| `bierrad_star_2.png` / `:bierrad_star_2:` | 0,2 |
| `bierrad_star_3.png` / `:bierrad_star_3:` | 0,3 |
| `bierrad_star_4.png` / `:bierrad_star_4:` | 0,4 |
| `bierrad_star_5.png` / `:bierrad_star_5:` | 0,5 |
| `bierrad_star_6.png` / `:bierrad_star_6:` | 0,6 |
| `bierrad_star_7.png` / `:bierrad_star_7:` | 0,7 |
| `bierrad_star_8.png` / `:bierrad_star_8:` | 0,8 |
| `bierrad_star_9.png` / `:bierrad_star_9:` | 0,9 |

In Slack: open de emojikiezer bij een bericht → **Emoji toevoegen** → upload een PNG → voer bovenstaande naam in → opslaan. Herhaal dit voor alle tien. [Slack's uploadinstructies](https://slack.com/help/articles/206870177-Add-custom-emoji-and-aliases-to-your-workspace).

Elke PNG is 128×128, transparant en kleiner dan 128 KB. De ster vult van links naar rechts; het ongevulde deel blijft lichtgrijs met een grijze rand, zodat het ook op donkere achtergronden zichtbaar is. De afbeeldingen zijn originele geometrische tekeningen met een gele vulling, zachte punten en highlights, afgestemd op de aangeleverde Slack-ster. Opnieuw genereren, zonder extra dependencies: `node scripts/slack-rating-emoji.mjs`.

Zowel het reviewbericht in de thread als de bijgewerkte koffie-/wateroproep toont precies vijf steremoji's per beoordeelde haler. Het gemiddelde wordt eenmaal afgerond op één decimaal, met een punt in de Slack-score; dezelfde waarde bepaalt de vulling. Voorbeeld:

```text
:star::star::star::bierrad_star_7::bierrad_star_empty: 3.7
```

`4.25` wordt `4.3` (vier volle sterren en één 0,3-ster); `4.96` wordt `5.0` (vijf volle sterren). Zonder beoordelingen verschijnt geen score. Upload de emoji's voordat de backendwijziging wordt gepubliceerd: ontbrekende emoji's kunnen als naam worden weergegeven. De app uploadt niets en vraagt geen nieuwe Slack-rechten. De ingebouwde volle ster kan per Slack-client iets verschillen van deze custom afbeeldingen.

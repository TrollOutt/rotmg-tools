# Charte de localisation — Realm Tools

Ce dépôt applique la charte de localisation ROTMG fournie avec la migration i18n.

- Les entités canoniques de *Realm of the Mad God* restent en anglais : objets, classes, boss, ennemis, NPC, donjons, lieux officiels, skins, sets, Artifacts, Engravings et enchantements nommés.
- Les codes et acronymes restent universels : `HP`, `MP`, `ATT`, `DEF`, `SPD`, `DEX`, `VIT`, `WIS`, `UT`, `ST`, `SB`, `DPS`, `DMG`, `XP`, `BXP`, `O1`, `O2`, `O3`, `MBC`, `PPE`, `NPE`, `UPE`, `MotMG`, les tiers `T<number>` et les progressions `<nombre>/8`.
- L’interface, les concepts génériques, les propriétés, les descriptions, les aides, les erreurs et les textes d’accessibilité sont traduisibles.
- Un terme communautaire ou ROTMG important conserve toujours sa forme canonique accessible et recherchable.
- Les valeurs métier et les identifiants ne dépendent jamais de la langue.
- En cas de doute sur la nature d’une chaîne, conserver l’anglais plutôt que d’inventer une traduction d’entité.

Le catalogue anglais est la source et le fallback. Toute nouvelle clé doit respecter ces règles et passer `npm run i18n:check`.

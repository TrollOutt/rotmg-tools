# Audit de consolidation de l’Index

Date de l’audit : 10 septembre 2026.

## Périmètre et sources

L’audit a porté sur les 19 302 enregistrements de `data/Index/index.json` et sur
les XML réextraits du client RotMG installé localement : build
`15a3ce058fe946c792c23558bdb10e2c`, daté du 9 septembre 2026.

Les rattachements ennemi/donjon viennent de l’export RealmEye local du
8 septembre 2026. Ils sont séparés des déclarations du client dans
`data/Index/wiki.json`, avec le hash de snapshot
`a42b18d24d59e8d3365ab81feae738e31daa88dc5be6281d0d8ecaca8ee80bf5`.

## Problèmes relevés

### 1. Les doublons visibles ne suivaient que trois formes

Le générateur savait déjà réunir une quantité écrite dans le `DisplayId`, une
copie `(SB)` strictement équivalente et quelques suffixes alphabétiques. Cela
laissait 15 936 lignes en navigation normale, dont 1 204 groupes partageant
exactement le même nom affiché.

Les cas manqués comprenaient notamment :

- une quantité présente uniquement dans l’identifiant interne, comme les dix
  `Permafrost Snowflake` et les dix `Ivory Heart` ;
- plusieurs déclarations portant le même `DisplayId`, comme les six
  `Adult Basilisk`, les quatre `Shade of the King` et les variantes du `Lich` ;
- des séries numérotées identiques, comme `Broken Heart` 1 à 8 ;
- des contrôleurs techniques, comme `MV Regular Loot 0` à 4 et
  `2ArcherST1A` à `2ArcherST1E` ;
- des familles de progression, comme les onze `Voodoo Grave Unlocker` ;
- des éditions `New` / `Actual` et quelques différences de ponctuation ou de
  casse (`Mk II` / `Mk.II`, `SHamrock`).

### 2. Une fusion pouvait cacher une différence réelle

Deux déclarations extrêmement proches ne sont pas toujours identiques. Les
variantes du Lich n’ont pas toutes la même vie ; certains contrôleurs de
projectiles changent leurs dégâts. Une fiche commune qui ne montre que les
valeurs de son représentant peut donc induire en erreur.

### 3. `God` et `Boss` étaient proposés deux fois

Ces deux notions apparaissaient correctement dans la section `Enemies`, mais
étaient aussi répétées dans `Marks`. Elles décrivent une catégorie d’ennemi,
pas une marque transversale applicable à n’importe quel enregistrement.

### 4. Le graphe ne répondait pas à « dans quel donjon est cet ennemi ? »

Les liens communautaires couvraient les drops et les apparitions, mais pas les
populations de donjon. Les XML d’objets du client décrivent les ennemis sans
fournir une table globale fiable de leur emplacement.

## Solutions apportées

### Regroupement conservateur et réversible

Le générateur crée maintenant 1 723 fiches communes. Au total, 6 360
déclarations sont rattachées à une fiche commune :

| Règle | Déclarations rattachées |
|---|---:|
| Piles (`xN` dans le nom affiché ou l’identifiant client) | 3 456 |
| Même nom affiché | 2 328 |
| Variantes techniques numérotées ou lettrées | 166 |
| Progressions, notamment les pierres tombales | 140 |
| Copies soulbound/tradeables | 152 |
| Variantes numérotées dont tous les faits concordent | 75 |
| Éditions `New` / `Actual` | 29 |
| Variantes alphabétiques strictement identiques | 9 |
| Variantes de casse ou ponctuation | 5 |

Le regroupement fait passer le nombre de lignes de navigation normale de
**15 936 à 12 942**, soit **2 994 répétitions supplémentaires retirées**. Le
retrait ultérieur des quatre pseudo-zones porte le résultat final à **12 938**
fiches navigables et **19 298** enregistrements. Aucune déclaration du client
n’est supprimée : les quatre retraits étaient des emplacements construits par
l’Atlas à partir de libellés temporaires.

Chaque déclaration rattachée conserve :

- son identifiant client ;
- son fichier XML et son type hexadécimal ;
- sa fiche individuelle, retrouvable par une recherche exacte ;
- sur la fiche commune, les valeurs qui diffèrent (`life`, `armour`, labels,
  projectile, effets ou avertissements).

Les chaînes de regroupements sont aplaties : chaque variante pointe directement
vers la fiche commune finale. Il n’existe plus aucun doublon de nom affiché en
navigation normale.

### Résultat sur les exemples fournis

| Exemple | Résultat |
|---|---|
| `Adult Basilisk` | 6 déclarations → 1 fiche commune |
| `Avatar of the Forgotten King` | 2 éditions → 1 fiche commune |
| `Permafrost Snowflake` | 10 quantités → 1 fiche commune |
| `Ivory Heart` | 10 quantités → 1 fiche commune |
| `Forgotten Relics` | 30 quantités → 1 fiche commune, comportement existant conservé |
| `Voodoo Grave Unlocker` | 11 étapes → 1 fiche commune |
| `Broken Heart` | 8 variantes → 1 fiche commune ; `Broken Heart Arrow` reste distinct |
| `MV Regular Loot` | 5 contrôleurs → 1 fiche commune, vie différente indiquée |
| `Lich` | 3 déclarations → 1 fiche commune, valeurs historiques indiquées |
| `Shade of the King` | 4 clones → 1 fiche commune |
| `2ArcherST1` | 5 composants techniques → 1 fiche commune |

### Taxonomie

`God` et `Boss` ont été retirés de `Marks`. Ils restent disponibles dans
`Enemies`, à côté de `Minions`, `Minibosses`, `Encounters`, `Quest`, etc. Les
labels bruts `GOD` et `BOSS` restent visibles sur les fiches et dans les
données.

### Relations ennemi/donjon

Le nouvel enrichissement ne déduit pas un emplacement d’une simple ressemblance
de nom. Une relation est conservée seulement si les trois conditions suivantes
sont réunies :

1. la page source RealmEye est déjà reliée à un portail déclaré par le client ;
2. le lien apparaît dans une rubrique de population explicite (`Enemies`,
   `Boss`, `Minions`, `Treasure Room Boss`, etc.), hors historique, drops,
   trivia et guides ;
3. la page cible est déjà reliée à un enregistrement `enemy` du client.

Résultat : **1 121 relations entre pages**, couvrant **991 pages d’ennemis** et
**78 pages de donjons**, avec **1 126 preuves de rubrique**. Une fois les pages
ayant plusieurs variantes client développées, cela représente 2 507 relations
brutes, ou 1 119 relations entre les fiches communes visibles.

Les fiches d’ennemis affichent désormais `found in`, les fiches de donjons
`enemies found here`, et le filtre `Dungeon` inclut à la fois la population et
les objets listés comme drops. Exemples vérifiés : `The Forgotten King` →
`The Shatters`, `Stheno the Snake Queen` → `Snake Pit`.

## Cas proches volontairement laissés séparés

Un dernier balayage normalisé ne laisse que quatre groupes de noms proches
(13 enregistrements). Ils ne sont pas fusionnés car leur différence est
fonctionnelle :

- `Emblem of Quest 1` à `7` valident des quêtes successives différentes ;
- `Special Test Blueprint 1` et `2` ont des règles saisonnières opposées ;
- `SpecPen OA Shot 1` et `2` font respectivement 325–525 et 0 dégâts ;
- `Test Trap DE` et `Test Trap DEX 2` ne forment qu’un faux positif lexical.

Les pseudo-emplacements `Zone 12`, `Zone 30`, `Zone 36` et `Zone 37` ont été
supprimés. Il s’agissait d’anciens libellés techniques conservés dans la liste
des biomes après que l’Atlas avait correctement identifié leurs véritables
zones. La génération de l’Atlas élimine désormais tous les libellés `Zone N`
non résolus et l’Index applique la même protection lors de l’import.

## Vérifications

- 19 298 enregistrements conservés ;
- aucun doublon de nom affiché parmi les 12 938 fiches navigables ;
- aucune cible de regroupement manquante, intermédiaire ou cyclique ;
- chaque lien de donjon va d’une page reliée à un portail vers une page reliée
  à un ennemi ;
- les 196 tests du moteur passent ;
- les 6 projections reproduisent les fichiers livrés ;
- 3 134 enregistrements Index/Theory comparés, 0 désaccord ;
- construction autonome et syntaxe des scripts validées.

Le contrôle de non-régression est dans `tests/index-quality.test.js`. La commande
de rafraîchissement des liens est `npm run wiki-dungeons` ; en l’absence d’un
export local, elle conserve les relations déjà commitées.

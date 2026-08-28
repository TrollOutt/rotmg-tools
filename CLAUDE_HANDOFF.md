# Passation — calculateur d'enchantements RotMG

## But du projet

Ce dépôt contient une version web autonome du calculateur Qt de `brendanbrubacher/rotmg-enchant-calculator`. L'objectif utilisateur n'est pas seulement d'afficher les odds d'un enchantement : il veut préparer un objet réel, marquer ce qu'il possède déjà et verrouille, indiquer les enchantements qu'il veut ensuite, puis comparer les routes qui donnent les meilleures chances au moindre coût.

L'application doit donc être à la fois un calculateur et un outil de décision compréhensible : pools éligibles, incompatibilités, slots restants, odds, Dust et ordre conseillé doivent être explicables.

## Deux façons d'utiliser l'application

### 1. Le build autonome — c'est la version à distribuer

```powershell
npm install
npm run release       # npm test puis node tools/build-standalone.js
```

Produit `dist/RotMG-Enchant-Calculator.html` : **un seul fichier de 353 Ko** qui
contient tout (données originales, 159 sprites en `data:` URI, moteur, UI, CSS).
On le double-clique, il s'ouvre, il marche. Aucune installation, aucun serveur,
aucune requête réseau une fois téléchargé.

Raccourci bureau en « mode application » (fenêtre sans barre d'adresse ni
onglets) :

```powershell
npm run shortcut
```

Le build écrit aussi `docs/`, que GitHub Pages sert tel quel. Voir `HOSTING.md`
pour la mise en ligne (un push + une case à cocher) et les obligations GPL v3.

Rappel licence : le calculateur d'origine est sous **GPL v3**. Republier est
autorisé, à condition de garder `LICENSE`, de rester en GPL v3, de fournir les
sources et de signaler la modification. Le pied de page de l'application porte
cette mention — **ne pas la retirer**, elle voyage avec le fichier HTML seul.

### 2. Le mode développement — sources séparées

```powershell
npm run dev
```

Interface servie ici (noter le slash final) :

```text
http://127.0.0.1:5173/web/
```

`web/index.html` **ne fonctionne pas** en `file://` : il charge les données par
`fetch`, ce que le navigateur interdit sur le système de fichiers. C'est
exactement le problème que le build autonome règle. Ouvrir `web/index.html`
depuis le disque affiche un message qui renvoie vers le fichier unique.

### Vérifications

```powershell
node --check web/engine.js
node --check web/app.js
npm test
```

`npm test` exécute `tests/engine.test.js` : 93 contrôles sur les données, les règles Awoken, la direction des incompatibilités, les slots, le multiplicateur de Dust, le scénario de référence, la table de tiers, les routes de lock et le planificateur. Il tourne en Node pur, sans navigateur.

Le projet est un worktree non commité : `package.json`, `web/`, `tests/`, `.claude/` et `.gitignore` sont nouveaux/non suivis. Préserver les fichiers existants ; ne pas utiliser `git reset --hard` ni `git clean`.

## Fichiers

| Emplacement | Rôle |
| --- | --- |
| `web/index.html` | Structure de l'interface (3 étapes à gauche, résultats à droite, sélecteur modal). |
| `web/style.css` | Mise en page, thème sombre, états visuels des slots. |
| `web/engine.js` | **Tout le calcul.** Parsing, pool éligible, poids, probabilités exactes, coûts, routes, planificateur. Aucun accès au DOM. |
| `web/app.js` | Uniquement l'UI : chargement des fichiers, état de l'éditeur, rendu. |
| `web/items.js` | Catalogue objet → slot + dust. Extrait des tables de reroll du wiki RealmEye. |
| `tests/engine.test.js` | Suite de contrôles Node sur `engine.js` et `items.js`. |
| `tools/build-standalone.js` | Génère le fichier HTML unique autonome. |
| `tools/make-shortcut.ps1` | Raccourci bureau Windows en mode application. |
| `dist/RotMG-Enchant-Calculator.html` | **Le livrable.** Artefact de build, committé exprès pour la distribution. |
| `dist/README.md` | Notice utilisateur et options de partage GitHub. |
| `docs/` | Dossier publié par GitHub Pages (`index.html` + copie téléchargeable + `.nojekyll`). Généré par le build. |
| `.github/workflows/pages.yml` | CI : `npm ci` → `npm test` → build → déploiement Pages. |
| `HOSTING.md` | Mise en ligne pas à pas et obligations GPL v3. |
| `Qt Source Files (not zipped)/Classes+Functions.h` | Logique de référence du calculateur Qt. |
| `Qt Source Files (not zipped)/Enchantment documents/` | Données d'enchantements. |
| `Qt Source Files (not zipped)/Awakened Items/awakenedItems.txt` | Correspondance équipement Awoken → enchantement. |
| `Qt Source Files (not zipped)/GUI Files/` | Sprites réutilisés dans la version web. |

`engine.js` fonctionne à la fois comme script classique dans le navigateur (variable globale `EnchantEngine`) et comme module CommonJS dans Node. C'est ce qui rend les calculs testables sans navigateur — et réutilisables par le script de build.

## Le build autonome

`tools/build-standalone.js` remplace dans `web/index.html` la balise `<link>` et
les deux `<script src>` par leur contenu inliné, et injecte devant eux un
`window.ROTMG_BUNDLE` qui porte les textes de données et tous les sprites en
`data:` URI. Côté application, deux points seulement changent de comportement :

- `asset()` lit le bundle au lieu de construire un chemin relatif ;
- `readSources()` retourne le bundle au lieu d'appeler `fetch`.

Sans bundle, les deux retombent sur le comportement serveur. Il n'y a donc
qu'une seule base de code, pas de variante « standalone » à maintenir.

Garde-fous du build :

- il parse les données **avec le vrai moteur** pour établir la liste des sprites
  que l'interface peut demander (icône par nom Awoken/Unique, sinon par famille
  de Labels), et **échoue** s'il en manque un — vérifié en renommant un sprite :
  sortie en code 1, `dist/` laissé intact ;
- il échoue si `web/index.html` ne contient plus les balises qu'il remplace ;
- il échappe `<` dans le JSON et `</script` dans les sources inlinées, ainsi que
  U+2028/U+2029 qui sont légaux en JSON mais terminent une ligne en JavaScript.

Contrôles effectués sur `dist/RotMG-Enchant-Calculator.html` ouvert en `file://`
dans Chrome (headless, scénario complet piloté) :

```text
protocol=file:            status=25 artifacts calculated · all rows exact
Moon                      0.8391% | 119 | 47,670 | 11,918 | 119
build plan                22,177 dust / 107 rerolls / 172,808 en un seul reroll
conseil « ne verrouille pas »  affiché
audit                     pool pondéré présent
lock routes               6 effets distincts, 7 lignes
images cassées            0        requêtes externes  0
localStorage              fonctionne en file:// (vérifié séparément dans Chrome)
```

L'état de l'éditeur est mémorisé dans le `localStorage` du navigateur sous
`rotmg-enchant-calculator/v1` et restauré au chargement ; `refresh()` écarte
ensuite ce que la configuration restaurée ne permet plus. Le bouton « Reset
everything » efface la clé. Tous les accès sont sous `try/catch` : en navigation
privée ou si le stockage est bloqué, l'application marche, elle oublie
simplement. Le stockage étant par navigateur, ouvrir le fichier dans Chrome et
dans Opera donne deux réglages indépendants.

## Déduction à partir de l'objet

Nommer l'objet suffit à remplir le reste. Deux sources fusionnées dans
`resolveItem()` :

| Source | Ce qu'elle donne |
| --- | --- |
| `web/item-catalog.json` (généré par `tools/fetch-items.js`) | slot, tier, dust, sprite |
| `awakenedItems.txt` + les labels de l'enchantement Awoken | slot, base ALIEN/NEO_ALIEN, Awoken débloqué |

### Le catalogue

```powershell
node tools/fetch-items.js --sprites
```

Cinq pages du wiki RealmEye sont lues : les quatre index d'équipement
(`weapons`, `ability-items`, `armor`, `rings`) qui listent chaque objet avec son
sprite et son tier, plus `enchanting` pour les tables de reroll. Les sprites
sont ensuite téléchargés par lots de 6. Le script saute ce qui est déjà présent.

Résultat : **1 596 objets**, **1 616 sprites**, dont **1 568 avec un dust** (95,7 %).

Le dust est résolu dans cet ordre :

1. **la fiche de l'objet** (`tools/item-dust.txt`) — 1 524 objets ;
2. sinon les tables de reroll de la page Enchanting ;
3. sinon la bande de tier ;
4. sinon inconnu — **70 objets**, presque tous du **matériel T0 de départ, qui
   ne peut pas être enchanté**. La saisie manuelle reste disponible.

### Pourquoi `tools/item-dust.txt` est un fichier figé

Les fiches individuelles sont derrière un interstitiel qu'un client HTTP simple
ne franchit pas, alors que les index et la page Enchanting sont servis
directement. Ces valeurs ont donc été relevées **via une vraie session
navigateur**, à environ quatre requêtes par seconde, puis gelées dans ce
fichier pour que le build reste reproductible hors ligne. Les régénérer
nécessite à nouveau un navigateur. Aucune protection n'a été contournée.

### Deux bugs trouvés par recoupement

Le croisement des fiches avec les tables de reroll a révélé deux erreurs :

- **4 désaccords** entre les fiches et les tables de reroll (Staff of Esben,
  Cloak of the Deep, Token of Happiness, Token of Warmth). La fiche fait foi ;
  le script les signale à chaque exécution.
- **Un décalage d'un tier dans mon propre parseur.** Le libellé « Tier N » suit
  ses sprites dans le balisage au lieu de les précéder ; je l'avais lu comme un
  en-tête, ce qui décalait tous les objets tiered d'un cran et plaçait ceux des
  bornes dans la mauvaise bande de dust. Corrigé et vérifié contre les fiches
  (Darksteel Tachi T9, Bow of Fey Magic T10, Hippogriff Hide Armor T10,
  Cloak of Endless Twilight T5). **Désaccords tiered/bandes : 0.**

Limite connue : la page des rings place son libellé de tier *avant* le tableau,
à l'inverse des autres. Les rings ressortent donc **sans** tier plutôt qu'avec un
tier faux — vérifié : zéro tier erroné. Leur dust vient de leur fiche et reste
correct (Ring of Health → Green … Ring of Transcendent Health → Purple).

Filtres : les noms de classes (Rogue, Archer, Druid…) et les en-têtes de groupe
(« Health Rings », « Limited Rings ») apparaissent dans les mêmes tableaux sans
être des objets ; ils sont écartés, et des tests le vérifient.

**La rareté n'est pas déductible** et reste manuelle : elle est tirée à la chute
de l'objet (50 % / 37,5 % / 25 % / 12,5 %), donc deux exemplaires du même objet
n'ont pas le même nombre de slots. Le champ est vidé à chaque changement d'objet
plutôt que reporté.

### Poids

Les 1 616 sprites pèsent **1,1 Mo sur disque, 1,58 Mo une fois inlinés** en
base64. Le fichier autonome passe de 392 Ko à **2,04 Mo**. C'est le prix de la
reconnaissance visuelle ; pour revenir à un fichier léger il suffit de ne pas
lancer `--sprites` et de supprimer `web/assets/items/` : le build retombe sur
les icônes de slot et le fichier repasse sous 500 Ko.

## Direction artistique

La palette n'est pas inventée : elle est **échantillonnée dans les sprites du
jeu** livrés avec le projet.

| Source | Couleurs |
| --- | --- |
| Cadres de rareté | Uncommon `#5ac45a` · Rare `#168cc7` · Legendary `#ca7aff` · Divine `#ffd026` |
| Poussières | Green `#289443` · Red `#ff4542` · Purple `#8854f0` |
| Icône Enchanter | `#15151d` · `#3a334b` · `#754e41` · `#2e4f2c` — les gris UI |

Correspondances sémantiques : lock = or divin, wanted = vert uncommon, accent =
bleu rare, erreur = rouge de la poussière. Le champ de rareté prend la couleur
du palier choisi, comme le jeu colore la bordure d'un objet.

**Fond animé, en deux couches.** Sept « realms » (The Realm, Undead Lair, Ocean
Trench, Abyss of Demons, The Shatters, Lost Halls, The Nexus).

1. *La dispersion de sprites* : peinte une fois sur un `<canvas>` — dégradé de
   ciel, trois halos, sprites déjà embarqués éparpillés, vignettage. **Le flou
   est appliqué au moment du dessin** (`ctx.filter`, 5 px : les sprites se
   lisent comme des formes, pas comme du brouillard), donc le navigateur garde
   un bitmap fini et n'a plus rien à filtrer. Repaint mesuré à **0,5 ms**.
   Recomposée toutes les 100 s en fondu croisé, dérive sur 46 s.
2. *L'aurore* : un blob radial par couleur de realm, tous **en mouvement
   permanent** sur des orbites à trois points (aucun blob ne repasse par le même
   trajet) et des cycles désaccordés de 34 s à 88 s, en `mix-blend-mode: screen`.
   Comme les périodes ne sont pas multiples, la combinaison ne se répète jamais.

Changer de realm ne fait que **repondérer les opacités** des blobs (1 pour le
realm courant, 0,5 pour ses voisins, 0,18 au-delà) avec un fondu de 5 s, toutes
les 32 s. La couleur évolue donc en continu au lieu de sauter : elle est
toujours quelque part entre deux realms, mais le basculement se voit.

Coût mesuré après l'accélération : **médiane 7,0 ms, p95 7,0 ms, max 7,1 ms**,
zéro frame perdue. Ambiance coupée, la page retombe à zéro travail.

Les panneaux sont à ~76 % d'opacité avec `backdrop-filter: blur(12px)`, un cran
plus couvrant qu'avant pour payer un décor devenu plus net et plus saturé. Repli
en panneaux opaques via `@supports not` là où le flou d'arrière-plan manque.

Aucun asset nouveau : tout est construit à partir des sprites déjà présents. La
police *ChronoType* du dossier Qt a été **écartée volontairement** : elle est en
CC BY-NC-SA 3.0, incompatible avec la GPL-3.0, et sa notice impose de
redistribuer toute l'archive.

Un bouton « ◐ Realm » coupe l'ambiance, mémorisé dans le navigateur.
`prefers-reduced-motion` désactive dérive et fondus.

## Interface

Colonne de gauche, trois étapes numérotées :

1. **The item** — rareté (qui fixe le nombre de slots), type, dust, objet awakenable, base spéciale. Le statut Awoken indique explicitement quel enchantement l'objet débloque, ou qu'il n'en débloque aucun.
2. **The slots** — une carte par slot. Chaque carte porte un bouton segmenté à deux états sans ambiguïté :
   - **🎯 Wanted** (liseré et fond turquoise) : pas encore sur l'objet, à obtenir.
   - **🔒 On item** (liseré et fond ambre) : déjà présent et gardé ; retire des candidats, consomme un slot, double chaque reroll.
   Une carte vide est en pointillés. Chaque carte affiche aussi les *Labels* apportés (puces bleues) et les *Incompatible Labels* (puces rouges).
3. **Run it** — bouton de calcul, avec le motif exact du blocage quand il est désactivé.

Le choix d'un enchantement passe par un sélecteur modal recherchable qui montre le sprite, la description, les labels et le poids de base — et, en dessous, la liste des enchantements **retirés par les autres slots avec la raison** (« bloqué par le lock X », « aucun ordre de tirage ne fonctionne avec X »).

Quand un changement de configuration invalide un slot, il est retiré et un avertissement le nomme, au lieu de disparaître en silence.

Colonne de droite : résumé chiffré, table des 25 artefacts, plan de build, comparateur de routes, audit.

## Règles de jeu implémentées

### Direction des incompatibilités

Deux listes distinctes sur un enchantement :

- **Enchantment Labels** → `mod.tags` : ce qu'il apporte.
- **Incompatible Labels** → `mod.excludes` : ce qu'il refuse.

Règle appliquée, directionnelle :

```text
Labels(A déjà posé) ∩ IncompatibleLabels(B candidat) ≠ ∅  →  B est retiré
```

Elle est asymétrique : verrouiller `Attack Bonus` retire `Jester's Trick`, mais verrouiller `Jester's Trick` ne retire pas `Attack Bonus`. Les tests 3 du fichier de tests figent ce comportement dans les deux sens.

> **Divergence assumée avec la source Qt.** `Classes+Functions.h` (`cullMask`, `getLiteMutuals`, `initialLiteCull`) compare les *Incompatible Labels des deux côtés* : `excludes(A) ∩ excludes(B) ≠ ∅`. Les deux modèles concordent sur ~98,6 % des paires ordonnées (23 271 paires identiques, 206 propres au modèle labels, 129 propres au modèle Qt). Ils divergent surtout autour de `Jester's Trick`, des trade-offs dégâts/cadence et des mods Awoken. Le modèle labels (RealmEye) a été conservé sur demande explicite. Cette divergence est affichée dans l'audit de l'interface.

### Awoken

Un enchantement portant `AWAKENED` dans ses Incompatible Labels n'entre dans le pool que si l'objet awakenable sélectionné le liste explicitement. Sans objet sélectionné, aucun Awoken n'est disponible.

Ajout conservé après la snapshot source, dans `engine.js` :

```js
const EXTRA_AWAKENINGS = { 'Nightmatter Circlet': ["Night's Soul"] };
const ITEM_SPRITE_ALIAS = { 'Nightmatter Circlet': 'AoO Rings' };
```

L'alias de sprite réutilise l'illustration « AoO Rings » livrée avec le build Qt, ce qui évite une URL externe fragile. Les données sources listent bien `[AoO Rings,Night's Soul]`.

### Slots, locks et coût

- `rollsRemaining = slots − locks` (les locks virtuels du comparateur comptent aussi).
- Coût d'un reroll : `baseCosts[slots] × 2 ** locks`, avec `baseCosts = {1:50, 2:65, 3:80, 4:100}`.
- Dust attendu : `coût par reroll × 1 / p`. Les frais d'artefact sont facturés dans **la couleur de dust de l'artefact** : ils ne sont ajoutés au total affiché que si cette couleur est celle sélectionnée, sinon ils apparaissent dans la colonne « Artifact dust ».

### Probabilités

Le moteur énumère **exactement** tous les chemins pondérés sur les slots restants. À chaque tirage : le mod tiré ajoute ses Labels, ce qui retire tous les candidats qui les refusent, et il quitte lui-même le pool (les poids sont renormalisés).

## Correction majeure de performance : le collapse par classes

Deux candidats se comportent de façon identique pour tous les tirages futurs s'ils partagent (a) leurs Labels bloquants, (b) leurs Incompatible Labels, (c) leur poids sous l'artefact choisi. `buildClasses()` regroupe le pool sur ces trois critères ; les cibles restent des classes singleton.

Effet mesuré : un pool anneau de 203 candidats se réduit à **36 classes**. L'arbre à 4 slots libres, qui dépassait l'ancien budget de 200 000 nœuds et retombait sur un échantillonnage marqué `≈`, se résout maintenant **exactement** en ~110 000 nœuds et 7 ms.

Conséquence : **aucune configuration réaliste ne déclenche plus le mode approximatif**. Mesures navigateur, 25 artefacts par ligne :

| Configuration | Temps | Exact |
| --- | --- | --- |
| RING, 4 slots libres, Mermaid Magic | 224 ms | oui |
| WEAPON, 4 slots libres, Damage Bonus | 39 ms | oui |
| ARMOR, 4 slots libres, % Life Regeneration | 103 ms | oui |
| ABILITY, 4 slots libres, MP Cost Reduction | 28 ms | oui |
| RING, 4 slots libres, cible **Awoken** | 243 ms | oui |

Le repli déterministe (`sampledDistribution`) existe encore comme filet de sécurité et reste signalé par `≈`, mais il n'est plus atteint. L'ancien plafond spécifique de 2 000 nœuds pour les cibles Awoken a été supprimé : il n'a plus de raison d'être.

## Planificateur multi-objectifs : modèle refait

L'ancien plan comparait des permutations d'ordre en supposant qu'on verrouille chaque objectif dès qu'il apparaît. **Cette hypothèse est démontrablement sous-optimale** et coûtait un facteur 2 sur le cas testé.

Le nouveau `planGoals()` résout exactement l'optimum sur l'espace de politiques suivant :

- un reroll relance toujours tous les slots non verrouillés ;
- l'artefact peut changer entre deux rerolls ;
- après chaque reroll, on peut verrouiller **n'importe quel sous-ensemble** des enchantements voulus qui sont sortis — y compris aucun.

État = ensemble des objectifs actuellement verrouillés. Avec `V[S]` le dust restant espéré, `W(T)` le meilleur état atteignable en verrouillant une partie non vide de ce qui vient de sortir, et `c(S)` le coût d'un reroll :

```text
V[S] = min sur artefact de ( c(S) + Σ_T P(T) · min(V[S], W(T)) )
```

`min(V[S], …)` est l'option « ne rien verrouiller et relancer », qui se replie en attente géométrique. Accepter les *k* meilleurs résultats est optimal pour un certain *k*, donc le point fixe est trouvé en balayant tous les *k*. Les états sont résolus du plus complet vers le plus vide.

La distribution `P(T)` sur les sous-ensembles d'objectifs obtenus vient de `goalDistribution()`, qui utilise le même arbre exact.

**Résultat sur le cas Nightmatter Circlet + Mermaid Magic + Dust Bonus** (Divine, `Night's Soul` verrouillé) :

| Politique | Dust Red attendu |
| --- | --- |
| Optimum trouvé | **22 177** |
| Verrouiller systématiquement ce qui sort | 44 896 |
| Exiger les deux dans un même reroll | 172 808 |

Le plan explique pourquoi : chasser d'abord Mermaid Magic (rare, 0,84 %/reroll) avec 3 slots libres à 200 dust, puis prendre Dust Bonus avec la Wheel of Fortune (25,9 %/reroll). L'interface affiche explicitement le conseil contre-intuitif : *« Do not lock Dust Bonus (12,54 % of rerolls) if it comes up alone here — locking it would double every reroll of the harder hunt for less than it saves. »*

Ce qui n'est **pas** exploré : verrouiller un enchantement qu'on n'a pas demandé pour réduire le pool. C'est le rôle du comparateur de routes, et l'interface le dit.

## Comparateur de routes de lock

Cadrage explicite dans l'UI : c'est la décision prise **après** un reroll — « ça vient de sortir, est-ce que je le verrouille ? ». Le dust déjà dépensé est irrécupérable, donc les totaux ne couvrent que ce qu'il reste à dépenser.

- Les candidats sont regroupés par profil de Labels bloquants (même effet sur le pool). Chaque groupe est évalué avec **un membre réel**, donc le pool perd bien cet enchantement précis.
- Les lignes qui aboutissent exactement au même résultat sont fusionnées : le cas de référence passe de 25 lignes bruyantes à **6 effets distincts**.
- La colonne « Shows up » donne la probabilité que la question se pose (chance de tirer un membre du groupe pendant les slots restants).
- Un verdict en clair dit si une route bat le statu quo.

Sur le cas de référence, le verdict est négatif et le reste : aucun lock supplémentaire n'est rentable, exactement le compromis décrit plus bas.

## Cas de test de référence

### Nightmatter Circlet

| Champ | Valeur |
| --- | --- |
| Rareté | Divine, 4 slots |
| Type | Ring |
| Dust | Red |
| Objet | Nightmatter Circlet |
| Slot 1 | `Percentage Mana Regeneration`, **on item** |
| Slot 2 | `Night's Soul`, **on item** |
| Slot 3 | `Mermaid Magic`, **wanted** |
| Artefact | The Moon Tarot Card |

Valeurs reproduites, à l'identique de la version précédente :

```text
pool éligible          112 candidats   (204 avant les locks, 92 retirés)
poids total pondéré    5 575 000
poids Mermaid Magic    30 000          (base 2 000 × 15)
chance sur un slot     0,5381 %
chance exacte / reroll 0,8391 %        (exacte, 744 états)
Red dust attendu       47 670
```

### Effet d'un lock supplémentaire

`OnAbility Attack Boost` (Labels `ONABILITYSTAT`, `PROCATTACK`) :

```text
pool          112 → 105
poids total   5 575 000 → 4 925 000
Mermaid Magic 30 000 (inchangé)
chance / slot 0,5381 % → 0,6091 %
slots libres  2 → 1
chance totale 0,8391 % → 0,6091 %
Red dust      47 670 → 131 333
```

La chance par tirage monte, la chance totale baisse. C'est le compromis central que l'audit et le comparateur rendent visibles.

### Awoken

- `Night's Soul` accepté sur `Nightmatter Circlet` et sur `AoO Rings`.
- `Night's Soul` refusé sur `Corsair Ring` (qui débloque `The King's Treasure`) et sans objet sélectionné.
- Changer d'objet retire le slot devenu impossible et le signale.

### Aliens

Les enchantements à prérequis `ALIEN` / `NEO_ALIEN` n'apparaissent dans le pool que si la base spéciale correspondante est cochée **ou** si l'artefact ouvre ce pool (les quatre `* Technology`). Vérifié : 0 dans un pool arme nu, 7 avec `Malogia Technology`, 7 avec la base `ALIEN`.

## Autres corrections de calcul

| Sujet | Avant | Maintenant |
| --- | --- | --- |
| Colonne « Add. Cost » | affichait le coût brut d'un artefact par reroll (ex. 25) | colonne « Artifact dust » : **total attendu** dans la couleur de l'artefact (`valeur × 2^locks / p`), conforme à la colonne 3 du Qt |
| « Artifacts Used » | `ceil(0,5 / p)` du Qt, qui n'est ni la moyenne ni la médiane | nombre moyen de rerolls `1 / p` (un artefact par reroll ; 0 pour « No Artifact ») ; la médiane `ln 0,5 / ln(1−p)` est donnée dans l'audit |
| Rendement du calcul | `await new Promise(requestAnimationFrame)` | `setTimeout(…, 0)` — rAF ne se déclenche pas dans un onglet masqué et laissait le calcul bloqué sur « Calculating… » |
| Mode approximatif | fréquent (budget 200 k nœuds, 2 k pour les Awoken) | pratiquement jamais atteint grâce au collapse par classes |

Les fidélités au Qt vérifiées et **conservées** : les 4 branches du multiplicateur de tiers (`TIER1/2/3` et défaut), la sélection du multiplicateur d'artefact (plus haute règle correspondante, exclusion par Labels, troncature entière), les coûts de base par rareté, `2 ** locks`, la déduplication des mods par nom (les 31 doublons entre documents sont strictement identiques — vérifié par test).

## Explicabilité

Le bouton **« Explain these odds »** ouvre un audit en cinq étapes numérotées, toutes vérifiables à la main :

1. construction du pool (départ, Labels des locks, nombre retiré, liste dépliable des retirés) ;
2. pondération par l'artefact (poids total, poids de la cible avec le multiplicateur, candidats les plus lourds) ;
3. un slot : `poids cible ÷ poids total` ;
4. plusieurs slots : chance exacte, comparaison avec le naïf `1 − (1−p)^n` en disant s'il est trop optimiste ou trop pessimiste, et taille de l'arbre ;
5. conversion en dust, formule par formule, plus la médiane des rerolls.

Un bloc dépliable liste les règles appliquées et les divergences assumées avec la source Qt.

## Ce qui reste ouvert

1. **Le modèle d'incompatibilité.** Le modèle labels et le modèle Qt divergent sur ~1,4 % des paires. Une vérification en jeu sur un cas discriminant (`Jester's Trick` + `Attack Bonus` sur le même objet) trancherait définitivement. Si le jeu les refuse, l'incompatibilité est en réalité **symétrique** et il faudrait tester `Labels(A) ∩ Incompatible(B) ≠ ∅ **ou** Labels(B) ∩ Incompatible(A) ≠ ∅`.
2. **Le doublon dans un même tirage.** Ce port retire le mod tiré et renormalise ; le Qt le saute mais garde son poids au dénominateur. Le comportement réel du jeu n'est pas documenté.
3. **Politiques de lock non explorées.** Le planificateur ne verrouille que des enchantements voulus. Une politique mixte (verrouiller un mod non voulu pour réduire le pool pendant une chasse longue) serait calculable avec la même machinerie, au prix d'un espace d'états bien plus grand.
4. **Sprites manquants.** Certains objets awakenables ajoutés hors snapshot n'ont pas d'illustration ; le rendu retombe proprement sur un emplacement vide. N'ajouter des assets qu'avec une provenance fiable.
5. **Le port ne modélise pas** les enchantements « frozen »/uniques au-delà de ce que font les poids sources, ni les éventuelles règles d'événement temporaires.

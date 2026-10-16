# Réconciliation locale du 16 octobre 2026

Branche exclusivement concernée : `integration/upstream-merge`. Parents attendus du commit de fusion : `0a52a726280b70b01c427118d88e04f10f524655` et `89f5adb7ad4a48cc1f05bd3f6913ef7498ad6079`, base `f20d516`. Les références ont été vérifiées avant préparation, puis `origin/main` après le fetch : 28 commits propres au local et 31 au distant. Le SHA du résultat se lit avec `git log -1 --format='%H %P'` sur cette branche.

Aucun push, déploiement, changement de `main`, stash, reset, clean, suppression de worktree, scrape ni ré-extraction client. Les autres worktrees sont restés hors du périmètre d'écriture. Installation par `npm ci`, copie des fichiers ignorés manquants par robocopy (code 1), configuration `safe.directory` limitée aux processus et au worktree. Les autorisations ciblées ont permis les écritures Git et les sous-processus de validation refusés par le sandbox.

## Résolution des neuf conflits

- `package.json` : union des scripts et des chaînes de tests ; TypeScript, typecheck et benchmark conservés ; générateurs Events et gear-effects conservés sans les exécuter.
- `tests/test-gate.test.js` : union des classifications, 35 fichiers de tests enregistrés.
- `tests/theory-harness.js` : union des accès aux fabriques et des nouveaux calculs ; accès de test à la portée et aux effets portés ; invalidation du cache extrait conservée.
- `tools/build-standalone.js` : moteur extrait avant son interface, contours, forge, Events et effets conservés. Les fichiers annexes des fiches et de l'Index, leurs images et les fonds Style sont embarqués uniquement dans le téléchargement.
- `tools/lint.js` : analyse du moteur extrait et du script de contours.
- `web/engine.js` : règles distantes des gravures, variantes et labels conservées, avec contrats JSDoc stricts pour les nouveaux champs et fonctions.
- `web/index-browse.js` : Events et contours réunis avec la feuille CSS partagée. Les images et métadonnées annexes sont lues dans le bundle de la copie isolée.
- `web/theorycraft.js` : les dix fabriques locales restent extraites. Les règles distantes touchant les statistiques, le calcul d'arme, la composition des nombres et les enchantements ont été portées dans `theory-engine.js`. Les nouveaux calculs restés dans l'interface y restent, injectés explicitement dans la composition. Les métadonnées de tirs courbes sont lues à chaque appel. Les URL blob et le chargement différé sont conservés.
- `web/whats-new.js` : contours et contenu distant réunis avec la règle de feuille partagée locale.

La fusion textuelle de `fiches-c.js` ne suffisait pas : le distant a ajouté une seconde fermeture pour la mise en page. Les deux mises en page partagent maintenant l'accès paresseux à la forge. Les tests locaux instrumentent la bonne fermeture et contrôlent aussi la nouvelle. Les lecteurs de ressources des fiches, de l'Index et de Style acceptent les ressources embarquées ; les feuilles volumineuses gardent des URL partagées. Aucun dessin ni algorithme métier n'a été refondu.

Le cache des objectifs combinés tient maintenant compte de `range` et `damage`, introduits par `6f816f7` et `5a4233f`. Sans ces deux clés, changer ces sélecteurs pouvait conserver des idéaux calculés pour une autre question. Le test d'invalidation couvre ces deux champs.

Les données suivies et les images restent celles du distant. Seule exception sous `web/assets/` : la page Atlas générée conserve le garde local du compteur, identique à son source `tools/atlas-viewer.html`. Aucun catalogue n'a été reconstruit depuis le client ni depuis RealmEye. Les correctifs hors ligne, l'identité canonique de l'Index, les données RealmEye, Events, les donjons par classe, le Skin Viewer et les nouvelles règles du combat sont conservés. Aucune décision métier contradictoire n'a été nécessaire.

## Parité et benchmark

La référence locale a été enregistrée avant fusion sur le code et les données purs de `0a52a72`, avec `--reps 2 --warmup 0`. Une seconde référence a été produite depuis le TheoryCraft et l'EnchantEngine distants non extraits de `89f5adb`, dans un harnais temporaire extérieur au dépôt.

Le contrôle contre la référence locale retourne intentionnellement 1 : les règles et la sélection du distant diffèrent. Le contrôle contre la référence distante retourne 0, avec les mêmes candidats, scores et constructions pour les neuf recherches. Aucun seuil de temps n'est appliqué par `--check` ; ces mesures Node ne constituent pas un test de latence du navigateur.

| Recherche | Candidats locaux → fusion | Score/construction |
| --- | ---: | --- |
| Wizard / DPS | 4 858 → 3 436 | 20 197,166616 → 20 784,10752 ; gravure Aphrodite à la place de Flurry of Blows |
| Wizard / HP | 4 708 → 4 732 | inchangés |
| Wizard / DEX | 3 270 → 3 269 | inchangés |
| Archer / DPS | 3 445 → 3 442 | inchangés |
| Archer / HP | 3 314 → 3 312 | inchangés |
| Archer / DEX | 3 312 → 3 309 | inchangés |
| Warrior / DPS | 3 253 → 3 244 | inchangés |
| Warrior / HP | 4 497 → 4 484 | inchangés |
| Warrior / DEX | 3 134 → 3 126 | inchangés |

Pour chaque ligne, les variations du parcours sont expliquées par `74c748a` (gravures compatibles et exclusion de 23 objets qui sont des tirs techniques) et `59fdc85` (exclusion des quatre nuanciers de rareté). Les objets restant dans Theory n'ont changé que de coordonnées d'image entre les deux projections ; leurs champs mécaniques et les enchantements Theory sont inchangés. Une contre-épreuve du code distant avec son seul pool de jets ordinaires rétablit exactement le score DPS local du Wizard, démontrant l'origine du gain. Aucun résultat nouveau n'a été accepté sur la seule observation du code fusionné.

Six cas figés de l'optimiseur ont été réenregistrés depuis le code distant non extrait, avec les mêmes deux commits justificatifs, y compris les empreintes de chaque suspension, rapports et collecte ordonnée :

| Cas figé | Candidats locaux → distant/fusion | Score local → distant/fusion |
| --- | ---: | ---: |
| Wizard / DPS | 4 858 → 3 436 | 20 197,166616 → 20 784,10752 |
| Archer / Kill, exclusions | 4 903 → 4 898 | −17,95342580514521, inchangé |
| Warrior / HP, équipement | 2 061 → 2 046 | 1 215, inchangé |
| Ninja / DEX, enchantements verrouillés | 3 780 → 3 777 | 159,8, inchangé |
| Wizard / HP, progression personnelle | 1 937 → 1 938 | 1 270,6, inchangé |
| Priest / objectif inconnu | 1 490 → 1 488 | 7 639,704, inchangé |

Les quatre cas d'erreur figés n'ont pas changé. Les contrats de statistiques intègrent désormais `from.regen` (`bec9226`), la composition évalue séparément l'aptitude et les dégâts par pièce (`f21eeff`, `5a4233f`), et le pool figé inclut les gravures (`74c748a`). Le corps de comparaison de `numbersFor` vient du distant et conserve ses règles de combat, remises, gains, dégâts et portée (`bec9226`, `7f146ae`, `f21eeff`, `5a4233f`, `6f816f7`). La comparaison d'identité directe de `weaponRate` est remplacée par le contrôle de son adaptateur, qui doit maintenant injecter les tirs courbes (`768c0b5`).

Le corpus distant `tests/rules-corpus.json` n'a pas été modifié. Il se reproduit exactement : 19 classes, 333 enchantements, 10 objectifs, 1 209 objets exercés, 502 cas et 209 recherches. Une comparaison indépendante supplémentaire avec le code distant, métadonnées de combat et statuts chargés, donne **32 958 cas, zéro différence**, couvrant les 1 831 équipements, trois portées, trois choix de dégâts et deux défenses ; 1 494 cas exercent les gains/boosts et 336 les procs de dégâts.

## Validation

- `npm run typecheck` : code 0, strict conservé, aucune exclusion ajoutée.
- `npm test` : chaîne complète, code 0 ; tous les tests des deux branches restent enregistrés.
- `npm run lint` : code 0.
- `npm run build` et `tests/standalone.test.js` : code 0 ; compilation de chaque script embarqué et vérification des octets des ressources annexes.
- HTML servi : **4 670 236 → 4 889 120 octets**, inférieur à **5 256 587**.
- HTML autonome : **37 110 368 → 45 689 650 octets**. L'augmentation inclut les nouveaux développements distants et les ressources désormais nécessaires à une vraie copie isolée : métadonnées et animations des fiches, feuille de skins, icônes et fonds Style. Ces ressources ne gonflent pas le démarrage servi.
- `node tools/bench-theory.js --reps 2 --warmup 0 --check <référence distante>` : code 0, 9/9 réponses identiques. Les différences contre la référence locale sont détaillées ci-dessus.
- Chrome **155.0.8059.79**, DevTools, profil temporaire, ports libres, viewport final 1440×1000 : HTML servi en HTTP, téléchargement en HTTP, puis téléchargement copié seul hors du dépôt et ouvert en `file://`. Recherche Theory, chiffres par pièce, portée, animation/pause/reprise de The Fight, recherche Index, fiche Teratoma avec forge/enchantements, 11 cartes Events et navigation What's New : réussis. Skin Viewer monté en HTTP, canvas dans son Shadow DOM. **Zéro exception, erreur console ou chargement échoué sur les trois parcours finaux.** Fermeture par `Browser.close`, puis vérification/nettoyage ciblé des seuls processus du profil créé.
- Revue fraîche des différences des deux parents, `git diff --check`, absence de marqueurs et de chemins non fusionnés : vérifiés.

Deux avertissements déjà présents restent visibles sans échec : six descriptions de la page d'accueil seulement en anglais et la provenance ancienne de `data/Index/wiki.json` face au client du 14 octobre. Le join RealmEye courant du distant est conservé ; aucun crawl ni restamp artificiel n'a été lancé.

## Compatibilité et protection des modifications utilisateur

Le diff utilisateur de `web/style.css` et `web/whats-new.js`, lu dans le checkout principal, a été écrit uniquement dans un fichier temporaire extérieur au dépôt. `git apply --check` sur la version fusionnée retourne **0**, sans conflit ni application du patch. Les 126 fichiers locaux de `data/Updates/upcoming/` ne recoupent aucun chemin distant : `f20d516..origin/main` ne change aucun chemin sous `data/Updates/`.

Les empreintes SHA-256 finales des deux fichiers et des 126 fichiers upcoming sont identiques aux empreintes relevées pendant la préparation : **128 fichiers vérifiés, zéro modification**. `main` reste à `0a52a726280b70b01c427118d88e04f10f524655`. Le worktree de duel n'a pas été utilisé.

## Inventaire de modernisation, sans refonte

| Source | Lignes | Situation |
| --- | ---: | --- |
| `web/app.js` | 7 283 | DOM, routeur, état global et orchestration du calcul mêlés ; hors typecheck |
| `web/theorycraft.js` | 4 875 | dix fabriques extraites, mais statuts, aptitudes, procs, progression, rendu et combat encore dans la fermeture UI ; hors typecheck |
| `web/fiches-c.js` | 3 269 | deux mises en page, chargements, mesures DOM et animations ; hors typecheck |
| `web/index-page.js` | 2 993 | chargements, enrichissements, liens et rendu couplés ; hors typecheck |
| `web/skins/app.js` | 2 291 | état et événements du Viewer, Shadow DOM et WebGL ; hors typecheck |
| `web/theory-engine.js` | 1 602 | JSDoc strict, dépendances injectées, tests de parité |
| `web/index-browse.js` | 1 365 | catalogue, filtres, états de navigation et DOM ; hors typecheck |
| `web/whats-new.js` | 1 126 | modèle de pages, navigation et rendu ; hors typecheck |
| `web/skins/renderer.js` | 65 | WebGL et shaders compacts ; hors typecheck |
| `tools/atlas-viewer.html` | 7 930 | application intégrée et fortement liée au DOM ; hors typecheck |

Le typecheck inclut seulement les cinq modules JavaScript `engine`, `fame`, `items`, `progression`, `theory-engine` et la déclaration de progression. Environ 15 % des lignes JS de `web/` et `web/skins/` sont ainsi contrôlées. Les contrats et les calculs sont bien testés ; une suite fonctionnelle navigateur complète et permanente manque encore, notamment pour le responsive, les parcours croisés, le stockage privé, les interactions WebGL/Atlas et l'accessibilité.

**Le site est prêt pour commencer une phase complète de tests fonctionnels.** Cette fusion et ses contrôles ne constituent pas une couverture exhaustive de ces parcours et n'autorisent aucune publication.

## Tester cette branche

Utiliser le worktree existant `integration/upstream-merge`, sans changer le checkout principal :

```powershell
npm ci
npm run typecheck
npm test
npm run build
python -m http.server 8766 --bind 127.0.0.1 --directory docs
```

Ouvrir `http://127.0.0.1:8766/`, puis ouvrir directement `docs/Realm-Tools.html`. Pour contrôler une copie réellement autonome, copier seulement ce dernier fichier dans un autre dossier avant de l'ouvrir. Ne pas lancer `npm run scrape` sur cette machine.

Modèle employé : `gpt-6.1-sol`, raisonnement `high`, sans sous-agent. Début réel : 08:37 UTC le 16 octobre 2026 ; la durée complète est donnée dans le compte rendu final, après la validation du commit.

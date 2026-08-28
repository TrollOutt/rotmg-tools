# Prompt à copier dans Claude

Tu reprends une application web locale de calcul d'enchantements pour Realm of the Mad God. Lis d'abord intégralement `CLAUDE_HANDOFF.md` à la racine du projet : il contient l'architecture, les règles de jeu déjà implémentées, les scénarios de vérification et les limites connues.

Objectif : **améliorer l'interface et auditer/corriger, si nécessaire, les calculs de probabilités, de Dust et de routes d'enchantement**, sans réécrire inutilement l'application fonctionnelle existante.

Priorités demandées par l'utilisateur :

1. Rendre l'interface encore plus claire et agréable : différencier sans ambiguïté les enchantements déjà présents et verrouillés des enchantements désirés, rendre le flux de sélection compréhensible, garder les images/sprites utiles.
2. Vérifier rigoureusement les pools éligibles, les Awoken propres à l'équipement sélectionné, les incompatibilités par labels, le nombre réel de slots restants, les probabilités par tirage et sur plusieurs tirages, ainsi que le multiplicateur de Dust des locks.
3. Vérifier et améliorer le comparateur de routes : lorsqu'il reste plusieurs enchantements désirés, recommander et expliquer l'ordre le plus intéressant selon le Dust attendu et le nombre de rerolls attendu. Les locks intermédiaires peuvent réduire le pool mais augmentent aussi le coût et consomment un slot : ce compromis doit être calculé honnêtement.
4. Conserver une explication/audit lisible des calculs afin que l'utilisateur puisse les vérifier lui-même.

Contraintes importantes :

- Travaille dans le worktree existant, qui contient des fichiers non suivis ; ne lance pas de reset/clean destructif.
- Ne suppose jamais qu'un enchantement est disponible sur tous les objets. Respecte les règles Awoken et les incompatibilités décrites dans la passation.
- La direction correcte de l'incompatibilité est : un candidat B est retiré si `Labels(lock/prior A) ∩ Incompatible Labels(B)` est non vide.
- N'affirme pas qu'une route est optimale si le modèle est une approximation : affiche alors clairement l'hypothèse.
- Teste après chaque changement important, au minimum avec `node --check web/app.js` et les scénarios du document de passation.

Commence par faire un court diagnostic de ce qui est déjà présent, puis implémente les améliorations les plus utiles, avec vérifications concrètes.

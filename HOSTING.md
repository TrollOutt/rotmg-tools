# Mettre le calculateur en ligne

Objectif : une adresse à donner, les gens cliquent, la page s'ouvre et marche.
Aucun serveur à louer, à administrer ou à payer.

C'est possible parce que **tout le calcul se fait chez le visiteur**. Le serveur
n'a qu'un fichier statique à renvoyer, ce que GitHub Pages fait gratuitement.

---

## Étape 0 — il te faut ton propre dépôt

`origin` pointe actuellement sur `brendanbrubacher/rotmg-enchant-calculator`,
qui n'est pas à toi : tu ne peux pas y pousser.

Deux options, toutes les deux valables.

### Option A — forker le dépôt d'origine *(recommandée)*

Sur GitHub, bouton **Fork** sur `brendanbrubacher/rotmg-enchant-calculator`.
Puis, en local :

```powershell
git remote rename origin upstream
git remote add origin https://github.com/TON-PSEUDO/rotmg-enchant-calculator.git
```

La filiation avec le projet d'origine reste visible sur GitHub, ce qui est la
manière la plus propre de respecter la GPL. L'adresse finale sera :

```text
https://TON-PSEUDO.github.io/rotmg-enchant-calculator/
```

### Option B — un dépôt neuf

Plus léger : le dépôt actuel traîne ~65 Mo d'archives `.zip` et d'objets de
compilation Qt (`.o`, `.exe`) dont la version web n'a aucun besoin. Un dépôt
neuf ne contiendrait que `web/`, `tests/`, `tools/`, `.github/`, le dossier
`Qt Source Files (not zipped)/` réduit aux données et aux sprites, `LICENSE` et
les README — environ 1 Mo.

Dans ce cas, garde impérativement `LICENSE` et la mention d'origine (voir plus
bas), sinon la redistribution n'est pas conforme.

---

## Étape 1 — pousser

```powershell
git add -A
git commit -m "Web version: self-contained calculator + GitHub Pages"
git push -u origin HEAD
```

Le dépôt doit être **public** : GitHub Pages sur un dépôt privé demande un
compte payant.

## Étape 2 — activer Pages

Sur GitHub : **Settings → Pages → Build and deployment → Source : GitHub
Actions**. C'est tout, et c'est à faire une seule fois.

Le workflow `.github/workflows/pages.yml` prend le relais à chaque push :
il installe Node, **lance les 93 contrôles du moteur de calcul**, reconstruit la
page et la publie. Si un test échoue, rien n'est publié — le site en ligne ne
peut donc pas afficher des probabilités fausses à cause d'une modification
ratée.

Le premier déploiement prend une ou deux minutes. L'adresse apparaît ensuite
dans Settings → Pages, et dans l'onglet **Actions** à côté du job `deploy`.

## Étape 3 — partager

```text
https://TON-PSEUDO.github.io/rotmg-enchant-calculator/
```

Le visiteur clique, la page se charge, il s'en sert. Rien à installer.

Sur cette page servie, un lien **« Download this page »** apparaît en plus : il
donne le fichier unique à garder pour un usage hors ligne. Ce lien est
automatiquement masqué quand le fichier est déjà ouvert depuis le disque.

---

## Ce que ça coûte et ce que ça supporte

| | |
| --- | --- |
| Prix | 0 € |
| Trafic inclus | 100 Go/mois, 10 builds/heure (limites GitHub Pages) |
| Poids par visite | ~357 Ko, mis en cache ensuite |
| Charge serveur par calcul | aucune — tout tourne dans le navigateur du visiteur |
| Données collectées | aucune ; rien ne quitte le navigateur |

Avec 357 Ko par visite, le quota de 100 Go correspond à environ 280 000 visites
par mois. Tu ne l'atteindras pas.

---

## Obligations GPL v3, en clair

Le calculateur d'origine est sous GPL v3. Publier ta version est **explicitement
autorisé**, à quatre conditions, toutes déjà remplies par ce dépôt :

1. **Garder la licence** — `LICENSE` est à la racine, ne pas le supprimer.
2. **Publier sous la même licence** — ta version est donc GPL v3 elle aussi.
3. **Fournir les sources** — un dépôt GitHub public le fait par construction.
4. **Signaler les modifications** — le pied de page de l'application affiche
   « Web port of brendanbrubacher/rotmg-enchant-calculator, **modified**.
   Licensed under GPL-3.0 », avec les liens.

Cette mention compte aussi quand tu envoies le fichier HTML seul à quelqu'un :
elle est à l'intérieur du fichier, et elle indique où trouver les sources.

Deux réflexes à garder :

- ne pas retirer le pied de page d'attribution ;
- si le dépôt est un fork, ne pas le repasser en privé une fois publié.

---

## Alternatives, si un jour tu veux autre chose

Le fichier est un simple HTML statique, donc n'importe quel hébergeur statique
convient à l'identique — **Netlify**, **Cloudflare Pages**, **Vercel** — tous
avec un palier gratuit. GitHub Pages a l'avantage d'être déjà là où vit le code.

Un vrai serveur ne servirait à rien : il n'y a pas de base de données, pas de
compte utilisateur, pas de traitement côté serveur. Le calcul le plus lourd
prend 250 ms dans le navigateur du visiteur.

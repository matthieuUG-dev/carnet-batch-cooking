# Carnet de batch cooking — notes pour Claude

Application du foyer (2 personnes), publiée par GitHub Pages : https://matthieuug-dev.github.io/carnet-batch-cooking/
Tout tient dans `index.html`. La référence du contenu (règles, fiches, semaines) reste le document de projet `claude/carnet-batch-cooking.md` ; l'application en est la version cuisine/téléphone.

## Ce qu'il faut publier à chaque étape
Modifier uniquement le bloc `<script type="application/json" id="carnet-data">`, vérifier que le JSON est valide (et que `</` y est écrit `<\/`), puis commit + push sur `main`.

1. **Menu validé** : ajouter chaque nouveau plat dans `plats` avec sa **fiche** (champ `fiche`, voir plus bas), et la semaine dans `semaines` (`menu`, `nbRepas`, `etapes.menu = true`).
2. **Liste de courses** : `semaines[].courses` (rayons → articles avec un `id` unique), `etapes.courses = true`. Pas de rayon « Placard à vérifier » : le placard est suivi dans l'onglet Stock.
3. **Déroulé du dimanche** : `semaines[].deroule` (voir plus bas), `etapes.deroule = true`. Il s'affiche dans l'onglet **Cuisine**, étape par étape, à cocher à deux.

## Formats
- `plats[]` : `id`, `nom`, `type` (vege | viande), `cuisson`, `conservation` (tot | tient), `congelation` (oui | moyen | non), `congelationNote`, `saisons[]`, `ingredients[]` (ingrédients clés, pour la recherche), `faitLe[]` (dates des lundis), `statut` (fait | idee), `ordre`, `remarque`, `avis` (vide : les avis vivent dans Firestore), et
  `fiche` = `{ infos, ingredients: ["Nom : quantité", …], methode: ["…", …], retours? }` — recopiée de la fiche du carnet, 4 portions, mêmes quantités. `**texte**` est affiché en gras (temps et températures).
- **Banque de recettes** (`statut: "banque"` = à tester, affichées « À tester » dans Plats ; `fait` = déjà cuisiné) : en plus des champs ci-dessus, chaque recette porte
  `categorie` (soupe, gratin, poêlée, mijoté…), `equipement` = équipement principal (`four` | `poele` | `casserole`) pour équilibrer un menu (retour du 18/10 : ne pas cumuler les plats en casserole), `materiel[]` (four, poele, sauteuse, casserole, petite-casserole, mixeur), `feculent`, `proteinesPortion` (g), `duree { active, totale }` (min),
  `contient[]` pour les régimes et allergies (`porc`, `boeuf`, `volaille`, `poisson`, `oeuf`, `gluten`, `lactose-vache`, `soja`, `arachide`, `fruits-a-coque`, `alcool`), `motsCles[]` pour les envies (« soupe », « chorizo »…).
  Fiche : `variantes[]` = `{ titre, texte }` facultatif (ex. version 100 % viande).
  Fiche structurée : `ingredients[]` = `{ nom, qte, unite, rayon, note? }` (rayons : Fruits & légumes, Frais, Épicerie, Surgelés, Placard ; `qte` null = au goût), `methode[]` = `{ texte, min?, actif }` (`actif: false` = cuisson ou attente sans surveillance, pour assembler le déroulé). Les anciennes fiches en texte restent acceptées.
- `semaines[]` : `id` = `debut` = date du lundi (AAAA-MM-JJ), `batch` (date du dimanche), `choix`, `menu[]` = `{ jour, plat, platId }`, `nbRepas`, `courses[]` = `{ rayon, hint?, items: [{ id, nom, qte, note? }] }`, `retours[]`, `etapes { menu, courses, deroule }`, et
  `deroule` = `{ intro?, etapes: [{ id, titre, temps?, details: ["…"], plats: [platId] }] }` — une entrée par étape du déroulé, `id` court et stable (`d01`, `d02`…), `temps` = repère horaire (« 0:00 », « 0:25 ») ou durée, `details` = quantités et découpes de l'étape, exactement celles des fiches.
- `stockInitial[]` : articles créés dans le stock au tout premier lancement seulement.

## Données partagées (Firebase, projet `carnet-batch-cooking`)
Règles Firestore : seules les collections `listes`, `plannings`, `avis`, `reglages` sont autorisées.
- `listes/<lundi>` : `coche.<idArticle>`, `extras`, `deroule.<idÉtape>` (étapes cochées dans l'onglet Cuisine)
- `plannings/<lundi>` : `repas.<jour>.<midi|soir>` (false = dehors), `note` (= les envies de la semaine, reconnues via les `motsCles`), `propositions[]` = `{ plats: [idPlat], envies[] }` (les 3 menus proposés), `menu` = `{ plats: [idPlat], envies[], choisiLe }` (le menu choisi), `commentaires.<id>` = `{ texte, date, auteur }` (commentaires sur le menu / le batch de la semaine)
- `avis/<idPlat>` : `avis`, `commentaires.<id>` = `{ texte, date (ISO), auteur, semaine? }` (commentaires sur un plat)
- `reglages/foyer` (« Mon foyer ») : `personnes`, `portionsParPlat`, `four`, `feux`, `casseroles`, `poeles`, `microondes`, `mixeur`, `exclusions[]` (valeurs de `contient`), `viandeMax` ; `reglages/stock` : `items.<id>`

## Serveur (dossier `api/`)
Cloudflare Worker déployé automatiquement à chaque push (Workers Builds, dossier racine `api`). Il vérifie le jeton Google/Firebase, la liste d'invités (`ALLOWED_EMAILS`, réglée dans Cloudflare) et appelle l'API Claude avec la clé gardée côté serveur (`ANTHROPIC_API_KEY`, secret Cloudflare). Routes : `GET /health`, `POST /claude` (`{ system, messages, max_tokens, stream }`, modèle et plafond de tokens fixés côté serveur). Ne jamais mettre de clé ni d'adresse e-mail dans le dépôt : il est public.

## À ne pas casser
- Mise à jour automatique : la page compare le texte de ses `<script>` et `<style>` avec la version en ligne (à l'ouverture et au retour au premier plan) et se recharge si besoin. Aucun numéro de version à gérer, mais ne jamais créer ni modifier de `<script>`/`<style>` dynamiquement, sinon la page croirait toujours à une nouvelle version.
- Une seule page, aucun fichier annexe : l'utilisateur ne peut pas déposer de dossier sur GitHub.

## Relire les retours
Les commentaires (plats et menus) servent à améliorer la banque : pour les relire, ouvrir l'application dans le navigateur de l'ordinateur et lire `avis/*` et `plannings/*` (champ `commentaires`) avec le SDK Firebase de la page ; puis ajuster les fiches dans `carnet-data`.

## Générateur de menus (dans la page, sans Claude)
Onglet **Menus** : planning des repas → nombre de plats ; « Proposer 3 menus » tire des plats de la banque (saison, exclusions et équipement de Mon foyer, avis « plus jamais » écartés, plats des 3 dernières semaines pénalisés, féculents variés, plafonds four / casserole / poêle et viande), en couvrant les envies (menu 1 : toutes, menus 2 et 3 : une chacune). Le bouton ↻ change un plat. « Choisir ce menu » crée une **semaine générée** côté page : courses additionnées (× portions / 4, stock déduit, placard selon l'onglet Stock) et déroulé assemblé automatiquement à partir des `methode` (`min`, `actif`). Une semaine présente dans `carnet-data` reste prioritaire sur une semaine générée. Pour que le générateur marche bien, toute nouvelle recette doit avoir une fiche structurée et toutes ses étiquettes.

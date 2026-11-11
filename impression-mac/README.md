# Impression directe Mac (pages impaires)

Userscript Violentmonkey pour Safari (macOS) : sur `https://somenor.net/sos77/ALP/`, un PDF qui s'ouvre part
directement à l'imprimante choisie, **pages impaires uniquement** (réglable).

## Pourquoi un serveur local ?
Un script de navigateur ne peut pas choisir une imprimante ni imprimer sans fenêtre de dialogue. Un petit
serveur Python (`serveur/impression-serveur.py`), qui n'écoute que sur `127.0.0.1`, reçoit le PDF et le passe à
la commande `lp` de macOS. Un jeton secret empêche tout autre site d'y envoyer des impressions.

## Installation
1. Dans le Terminal : `curl -fsSL https://raw.githubusercontent.com/asayet44/test/main/impression-mac/serveur/install.sh | bash`
   (le jeton est affiché et copié dans le presse-papiers).
2. Installer Violentmonkey pour Safari (App Store), puis l'activer dans Safari > Réglages > Extensions.
3. Ouvrir <https://raw.githubusercontent.com/asayet44/test/main/impression-mac/impression-mac.user.js>
   et accepter l'installation du script dans Violentmonkey (mises à jour automatiques ensuite).
4. Sur la page ALP : cliquer sur ⚙, choisir l'imprimante, coller le jeton.

## Utilisation
- Un PDF s'ouvre sur ALP : il est imprimé directement (toast vert de confirmation).
- 🖨 Imprimer : réimprime le dernier PDF reçu depuis le chargement de la page.
- ⚙ : imprimante, case « Seulement les pages impaires », jeton.
- Si le serveur est injoignable, le PDF s'ouvre normalement dans un onglet.

## Désinstaller le serveur
`bash install.sh --desinstaller` (ou la même commande `curl … | bash -s -- --desinstaller`).
Journal : `~/.impression-pdf/serveur.log`.

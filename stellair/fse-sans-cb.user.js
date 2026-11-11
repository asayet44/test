// ==UserScript==
// @name         Stellair FSE sans CB (bêta)
// @namespace    saisie-rapide-sans-cb
// @version      0.4
// @description  Démarre tout seul à l'insertion de la carte Vitale (bouton ⚡ Auto), ALD auto, attend la cotation saisie à la main, puis pages suivantes et sécurisation ; affiche le reste à payer à saisir sur le SumUp
// @match        https://fse.stellair.fr/*
// @match        https://somenor.net/*
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://raw.githubusercontent.com/asayet44/test/main/stellair/fse-sans-cb.user.js
// @downloadURL  https://raw.githubusercontent.com/asayet44/test/main/stellair/fse-sans-cb.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- côté Somelog : on note le patient affiché, pour choisir le bon bénéficiaire de la carte ----------
  if (location.hostname === 'somenor.net') {
    // innerText sépare les blocs (nom / âge) ; textContent les colle (« SeryalF 26a »), d'où le \s* de la regex.
    const texte = (el) => (el.innerText || el.textContent || '').normalize('NFC').replace(/[↑↓]/g, ' ').replace(/\s+/g, ' ').trim();
    // En-tête : « SABOUH Seryal » puis « F 26a 9m (01/01/2000) » ; on garde le plus petit bloc qui contient les deux.
    const RE_ENTETE = /^(.*?[A-Za-zÀ-ÿ].*?)\s*[FM]\s+\d+\s*[amj]\b.*?\((\d\d\/\d\d\/\d{4})\)/;
    let dernier = '', ecrit = 0;
    setInterval(() => {
      const m = [...document.body.querySelectorAll('*')].filter((el) => /\(\d\d\/\d\d\/\d{4}\)/.test(el.textContent) && el.textContent.length < 200)
        .map(texte).filter((t) => t.length < 120)
        .map((t) => t.match(RE_ENTETE)).filter(Boolean).sort((a, b) => a[0].length - b[0].length)[0];
      if (!m) return;
      const cle = m[1] + m[2];
      if (cle === dernier && Date.now() - ecrit < 60000) return; // réécrit chaque minute pour rester « récent »
      dernier = cle;
      ecrit = Date.now();
      GM_setValue('somelog-patient', { nom: m[1], ddn: m[2], t: ecrit });
    }, 3000);
    return;
  }

  const ATTENTE_ALD_MS = 5000; // temps laissé aux droits en ligne (ADRi) pour afficher la bulle ALD
  const DUREE_MAX_MS = 3 * 60 * 1000; // lecture carte + choix du bénéficiaire compris
  const ATTENTE_COTATION_MS = 10 * 60 * 1000; // temps laissé au médecin pour saisir la cotation
  const STUCK_MS = 8000; // sans nouvelle étape pendant ce temps, le panneau recopie les boutons de la page
  const STABLE_MS = 2500; // le total des actes ne doit plus bouger pendant ce temps avant de passer à la suite
  const RE_VALIDER = /^(Sécuriser|Valider|Signer)\b/;

  // Clés propres à ce script, pour ne pas se marcher dessus avec « Stellair FSE rapide » s'il est encore installé.
  const CLE_FLUX = 'stellair-sc-flux';
  const CLE_CB = 'stellair-sc-cb';
  const CLE_RESUME = 'stellair-sc-resume';
  const CLE_REDUIT = 'stellair-sc-reduit';
  const CLE_AUTO = 'stellair-sc-auto';
  const AUTO_DELAI_MS = 1500; // délai avant le départ automatique, pendant lequel on peut annuler
  const AUTO_REARME_MS = 2000; // la page de la carte doit avoir disparu pendant ce temps avant d'accepter une nouvelle carte

  const norm = (s) => (s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  const visible = (el) => el.getClientRects().length > 0;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const eur = (n) => n.toFixed(2).replace('.', ',') + ' €';

  // Éléments visibles dont le texte correspond (le plus profond seulement), hors de notre panneau.
  function chercher(texte) {
    const ok = texte instanceof RegExp ? (t) => texte.test(t) : (t) => t === texte;
    return [...document.documentElement.querySelectorAll('*')].filter((el) =>
      !el.closest('#sfc-panneau') && ok(norm(el.textContent)) && visible(el) &&
      ![...el.children].some((c) => ok(norm(c.textContent))));
  }
  const present = (texte) => chercher(texte).length > 0;
  // ---------- patient Somelog → choix du bénéficiaire de la carte ----------
  const SOMELOG_RECENT_MS = 10 * 60 * 1000;
  const majuscules = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9/]+/g, ' ').trim();
  function patientSomelog() {
    const p = GM_getValue('somelog-patient', null);
    return p && Date.now() - p.t < SOMELOG_RECENT_MS ? p : null;
  }
  // Tous les mots du nom ET du prénom doivent y être (ordre libre, accents ignorés).
  const contientNom = (txt, p) => { const t = ` ${majuscules(txt)} `; return majuscules(p.nom).split(' ').every((m) => t.includes(` ${m} `)); };
  // Éléments de Stellair au nom du patient Somelog ; écartés si une date de naissance différente est affichée sur la même ligne.
  // exigerDate : la date de naissance de Somelog doit en plus être affichée sur la ligne (démarrage automatique : moins de faux positifs).
  function memePatient(p, exigerDate = false) {
    return [...document.body.querySelectorAll('*')].filter((el) => !el.closest('#sfc-panneau') && contientNom(el.textContent, p) &&
      visible(el) && ![...el.children].some((c) => contientNom(c.textContent, p))).filter((el) => {
      let ligne = el;
      while (ligne.parentElement && norm(ligne.parentElement.textContent).length < 150) ligne = ligne.parentElement;
      const dates = norm(ligne.textContent).match(/\d\d\/\d\d\/\d{4}/g);
      return dates ? dates.includes(p.ddn) : !exigerDate;
    });
  }
  // Journal du déroulé affiché dans le panneau : ce qui a été lu, cliqué, vérifié.
  let lignesJournal = [];
  function journal(ligne) { lignesJournal.push(ligne); dessiner(); }
  function blocJournal() {
    const d = document.createElement('div');
    d.textContent = lignesJournal.join('\n');
    d.style.cssText = 'font-size:11px;color:#555;white-space:pre-line;line-height:1.3';
    return d;
  }
  const cliquable = (el) => el.closest('button, a, [role="button"], label') || el;
  // Le bouton du bas de page est plus bas que le libellé identique de la frise d'étapes.
  const plusBas = (els) => els.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0];

  function cliquer(el, manuel = false) {
    if (!manuel) verifierPause();
    el.scrollIntoView({ block: 'center' });
    el.click();
  }

  // ---------- miroir : les boutons de la page recopiés dans le panneau (utile dans la fenêtre détachée) ----------
  // S'affiche tout seul quand le déroulé bloque (patient Somelog illisible, plusieurs bénéficiaires, erreur…), ou au bouton « Page ».
  let miroir = false, listeMiroir = [], sigMiroir = '', dernierMiroir = 0, activite = Date.now();
  const nbDates = (el) => (norm(el.textContent).match(/\d\d\/\d\d\/\d{4}/g) || []).length;
  function candidatsPage() {
    const res = [], vus = new Set();
    const ajouter = (t, el, perso) => { t = t.slice(0, 40); if (t && !vus.has(t)) { vus.add(t); res.push({ t, el, perso }); } };
    // Choix du bénéficiaire : les lignes de la page qui portent une date de naissance, en premier.
    if (flux && flux.faits.includes('carte') && !flux.faits.includes('fse') && !present('Feuille de soins électronique')) {
      for (const el of document.body.querySelectorAll('*')) {
        if (el.closest('#sfc-panneau') || !visible(el) || nbDates(el) !== 1 || [...el.children].some((c) => nbDates(c) === 1)) continue;
        let ligne = el;
        while (ligne.parentElement && nbDates(ligne.parentElement) === 1 && norm(ligne.parentElement.textContent).length < 120) ligne = ligne.parentElement;
        ajouter(norm(ligne.textContent), ligne, true);
      }
    }
    // Puis les boutons visibles à l'écran (dans la fenêtre modale s'il y en a une), les plus bas d'abord.
    const zone = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], .modal')].filter(visible).pop() || document.body;
    const boutons = [];
    for (const el of zone.querySelectorAll('button, [role="button"], a[href], input[type="button"], input[type="submit"]')) {
      if (el.closest('#sfc-panneau') || !visible(el) || el.disabled) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom >= 0 && r.top <= window.innerHeight) boutons.push({ el, top: r.top });
    }
    boutons.sort((a, b) => b.top - a.top);
    for (const { el } of boutons) ajouter(norm(el.value || el.textContent), el, false);
    return res.slice(0, 12);
  }
  function rafraichirMiroir(force) {
    dernierMiroir = Date.now();
    listeMiroir = candidatsPage();
    const sig = listeMiroir.map((x) => x.t).join('|');
    if (force || sig !== sigMiroir) { sigMiroir = sig; dessiner(); }
  }
  function montrerMiroir() {
    miroir = true;
    reduit = false; // sans l'enregistrer : on rouvre le panneau le temps du blocage
    rafraichirMiroir(true);
  }

  async function attendre(fn, ms) {
    const fin = Date.now() + ms;
    for (;;) {
      verifierPause();
      const r = fn();
      if (r || Date.now() > fin) return r;
      await pause(250);
    }
  }

  // Sur téléphone, Stellair met parfois du temps à recalculer : bouton grisé ou clic ignoré.
  // On attend qu'il soit cliquable, puis on vérifie que la page a bien changé, sinon on reclique.
  let etapeEnCours = null;
  // Page changée = le repère de l'étape a disparu, ou une étape suivante est déjà reconnue.
  const pageChangee = () => !etapeEnCours.detecte() ||
    ETAPES.some((e) => e !== etapeEnCours && !flux.faits.includes(e.nom) && e.detecte());
  async function suivant(re = /^Suivant/, verifier = true) {
    for (let essai = 0; essai < 4; essai++) {
      const bouton = await attendre(() => {
        const el = plusBas(chercher(re));
        const b = el && cliquable(el);
        return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' ? b : null;
      }, 8000);
      if (!bouton) stop('Bouton « Suivant » introuvable ou grisé');
      cliquer(bouton);
      if (!verifier || !etapeEnCours || await attendre(pageChangee, 5000)) return;
      afficher(`FSE : ${etapeEnCours.nom}, nouvel essai…`);
    }
    stop('La page ne passe pas à la suite : clique Suivant à la main');
  }

  // null = libellé absent (mise en page téléphone) ; sinon le montant lu, même séparé par d'autres mots.
  // Le « € » peut être absent du texte (dessiné en CSS ou coupé sur téléphone) : on lit le montant à 2 décimales.
  // Plusieurs « Total actes » possibles dans la page : on garde le plus grand.
  function totalActes(texte = document.body.innerText) {
    if (!/Total (des )?actes/i.test(texte)) return null;
    const montants = [...texte.matchAll(/Total (?:des )?actes[^\d]{0,40}?(\d[\d\s]*[.,]\d{2})/gi)]
      .map((m) => parseFloat(m[1].replace(/\s/g, '').replace(',', '.')));
    return Math.max(0, ...montants);
  }
  console.assert(totalActes('Total actes\t72.50\nTotal indemnités 0.00') === 72.5 && totalActes('Total actes 30.00 €') === 30 && totalActes('Total actes :\n30,00 €') === 30 &&
    totalActes('Total actes\n0.00 €') === 0 && totalActes('rien') === null);

  // ---------- reste à payer : montant à saisir sur le SumUp (rien n'est envoyé au terminal) ----------
  const montantPatient = (texte) => {
    const m = texte.match(/À payer par le patient\s*([\d.,]+)\s*€/);
    return m ? parseFloat(m[1].replace(',', '.')) : null;
  };
  console.assert(montantPatient('À payer par le patient\n9.00 €') === 9 && montantPatient('Part patient 9.00 €') === null);

  let cb = 0; // reste à payer mémorisé au passage sur le récapitulatif
  try { cb = parseFloat(sessionStorage.getItem(CLE_CB)) || 0; } catch (e) { /* rien */ }
  function fixerCb(m) {
    cb = m;
    try { sessionStorage.setItem(CLE_CB, String(m)); } catch (e) { /* stockage bloqué */ }
    dessiner();
  }
  // ---------- résumé de la dernière FSE ----------
  let resume = {};
  try { resume = JSON.parse(sessionStorage.getItem(CLE_RESUME)) || {}; } catch (e) { /* rien */ }
  function noter(champs, neuf = false) {
    resume = { ...(neuf ? {} : resume), ...champs };
    try { sessionStorage.setItem(CLE_RESUME, JSON.stringify(resume)); } catch (e) { /* stockage bloqué */ }
    dessiner();
  }
  const euros = (texte, libelle) => {
    const m = texte.match(new RegExp(libelle + '\\s*([\\d.,]+)\\s*€'));
    return m ? m[1].replace('.', ',') + ' €' : '?';
  };
  function lireRecap(texte) {
    return {
      mode: norm((texte.match(/Facturation - ([^\n]+)/) || [])[1]),
      total: euros(texte, 'Total facture'), amo: euros(texte, 'Part AMO'), amc: euros(texte, 'Part AMC'),
      patient: euros(texte, 'À payer par le patient'),
    };
  }
  console.assert(lireRecap('Facturation - Tiers payant AMO\nTotal facture\n30.00 €\nPart AMO\n21.00 €').amo === '21,00 €');

  let surRecap = false;
  function surveillerRecap() {
    const m = montantPatient(document.body.innerText);
    if (m !== null && !surRecap) { noter(lireRecap(document.body.innerText), !flux); fixerCb(m); } // une seule capture par passage, pour ne pas faire réapparaître un montant déjà effacé
    surRecap = m !== null;
  }

  // ---------- déroulé : chaque page n'est traitée qu'une fois ----------
  class Arret extends Error {}
  function stop(message) { throw new Arret(message); }
  // Pause : l'étape en cours s'interrompt au prochain clic ou à la prochaine attente (rien d'autre n'est fait tant que flux.pause).
  const PAUSE = 'pause';
  function verifierPause() { if (flux && flux.pause) throw new Arret(PAUSE); }

  let flux = null;
  try { flux = JSON.parse(sessionStorage.getItem(CLE_FLUX)); } catch (e) { /* rien */ }
  function sauver() {
    try {
      if (flux) sessionStorage.setItem(CLE_FLUX, JSON.stringify(flux));
      else sessionStorage.removeItem(CLE_FLUX);
    } catch (e) { /* stockage bloqué */ }
  }

  const ETAPES = [
    {
      nom: 'carte',
      detecte: () => present('Lire la carte Vitale'),
      action: async () => cliquer(cliquable(chercher('Lire la carte Vitale')[0])),
    },
    {
      nom: 'bénéficiaire',
      // Plusieurs bénéficiaires sur la carte : Stellair attend un choix entre la lecture et la feuille de soins.
      detecte: () => flux.faits.includes('carte') && !flux.faits.includes('fse') && !present('Feuille de soins électronique') &&
        !!flux.somelog && memePatient(flux.somelog).length > 0,
      action: async () => {
        const trouves = memePatient(flux.somelog);
        if (trouves.length > 1) return journal('⚠ Plusieurs bénéficiaires correspondent : choisis à la main');
        cliquer(cliquable(trouves[0]));
        journal(`👆 Bénéficiaire cliqué : ${norm(trouves[0].textContent)}`);
      },
    },
    {
      nom: 'fse',
      detecte: () => present('Feuille de soins électronique') && present('Créer'),
      action: async () => cliquer(cliquable(chercher('Créer')[0])),
    },
    {
      nom: 'prise en charge',
      detecte: () => present('Nature de prise en charge'),
      action: async () => {
        if (flux.somelog) {
          journal(memePatient(flux.somelog).length ? '✔ Patient Stellair = Somelog' : '⚠ Patient Stellair différent de Somelog : vérifie !');
        }
        afficher('Attente des droits (ALD)…');
        // La case s'appelle « ALD » (droits en ligne) ou « ALD sur attestation » ; avec la bulle ALD du patient
        // il y a donc 2 éléments, la case étant la plus basse. Sans ALD : la case seule.
        const options = () => [...chercher('ALD sur attestation'), ...chercher('ALD')];
        if (await attendre(() => options().length >= 2, ATTENTE_ALD_MS)) {
          const ald = plusBas(options());
          cliquer(ald.closest('label') || ald.parentElement.querySelector('input[type="radio"], [role="radio"]') || ald);
          afficher('ALD cochée');
          noter({ ald: true });
          await pause(300);
        }
        await suivant();
      },
    },
    {
      nom: 'parcours',
      detecte: () => present('Contexte du parcours de soins'),
      action: async () => { await pause(300); await suivant(); },
    },
    {
      // Le médecin saisit la cotation lui-même : on attend que le total des actes s'affiche et ne bouge plus.
      // S'il clique Suivant lui-même avant, on enchaîne aussitôt.
      nom: 'actes',
      detecte: () => present('Rechercher un favori'),
      action: async () => {
        afficher('Saisis la cotation…');
        let vu = null, depuis = 0;
        const pret = () => {
          if (!present('Rechercher un favori')) return true; // page déjà quittée à la main
          const t = totalActes();
          if (!(t > 0)) { vu = null; return false; }
          if (t !== vu) { vu = t; depuis = Date.now(); }
          return Date.now() - depuis >= STABLE_MS;
        };
        if (!await attendre(pret, ATTENTE_COTATION_MS)) stop('Cotation non saisie : saisis-la puis clique Suivant');
        flux.debut = Date.now(); // le temps de saisie ne compte pas dans la durée maximale
        sauver();
        if (present('Rechercher un favori')) await suivant();
      },
    },
    {
      nom: 'mutuelle',
      detecte: () => present('Informations de la mutuelle'),
      action: async () => { await pause(300); await suivant(); },
    },
    {
      nom: 'récapitulatif',
      detecte: () => present(/^Facturation - /),
      action: async () => {
        await pause(300);
        // Avertissement (ex. acte déjà facturé aujourd'hui) : c'est au médecin de décider.
        if (present('Tout cocher')) stop('Avertissement sur le récapitulatif : vérifie puis clique Sécurisation');
        if (lireRecap(document.body.innerText).total === '0,00 €') stop('Total facture à 0 € : aucune cotation');
        await suivant(/^Sécurisation/, false); // la page Sécurisation est vérifiée juste après
        // Selon l'écran, Stellair demande une validation ou sécurise directement (fenêtre « Feuille de soins terminée »).
        const valider = await attendre(() => finVisible() || plusBas(chercher(RE_VALIDER)), 45000); // téléphone : sécurisation lente
        if (!valider) stop('Page Sécurisation : bouton de validation non reconnu, valide à la main');
        if (valider !== true) cliquer(cliquable(valider));
        noter({ validee: true });
      },
    },
    {
      // Fenêtre « Feuille de soins terminée » : règlement s'il reste à payer, sinon OK (ALD, C2S…).
      nom: 'fin',
      detecte: () => finVisible(),
      action: async () => {
        await pause(300);
        if (cb > 0) {
          flux.attente = true; // le déroulé reprend au clic sur un mode de paiement (choisirMode)
          sauver();
          return afficher(`Reste ${eur(cb)} : mode de paiement ?`);
        }
        const ok = plusBas(chercher('OK'));
        if (!ok) stop('Bouton OK introuvable');
        cliquer(cliquable(ok));
        terminer('FSE validée ✔, rien à payer');
      },
    },
    {
      nom: 'règlement',
      detecte: () => flux.choix in MODES && present(/^Reste à payer patient/) && present('Enregistrer'),
      action: async () => {
        await pause(300);
        const mode = MODES[flux.choix];
        if (!choisirType(mode.re)) stop(`Choisis « ${mode.nom} » puis Enregistrer`);
        cliquer(cliquable(plusBas(chercher('Enregistrer'))));
        noter({ reglement: `Règlement ${mode.nom} enregistré dans Stellair` });
        // CB : le montant reste affiché dans le panneau, à saisir sur le SumUp. Autre mode : plus rien à encaisser.
        if (mode.sumup) terminer(`FSE validée ✔, saisis ${eur(cb)} sur le SumUp`);
        else { terminer(`FSE validée ✔, règlement ${mode.nom} enregistré`); fixerCb(0); }
      },
    },
  ];

  // Lu sur le texte affiché de toute la page (insensible à la casse et à la structure de la fenêtre).
  const finVisible = () => /Feuille de soins terminée|facture a été sécurisée/i
    .test(document.documentElement.innerText.normalize('NFC'));
  const MODES = {
    cb: { nom: 'Carte bancaire', bouton: '💳 CB (SumUp)', re: /^Carte bancaire/i, sumup: true },
    especes: { nom: 'Espèces', bouton: 'Espèces', re: /^Esp[eè]ces/i },
    cheque: { nom: 'Chèque', bouton: 'Chèque', re: /^Ch[eè]que/i },
  };

  // Clic du médecin sur un mode : on reprend le déroulé depuis la fenêtre « Feuille de soins terminée ».
  function choisirMode(choix) {
    flux.attente = false;
    flux.pause = false;
    flux.choix = choix;
    flux.debut = Date.now(); // le temps passé à demander au patient ne compte pas
    sauver();
    try {
      if (choix === 'plus tard') {
        cliquer(cliquable(plusBas(chercher('OK')) || stop('Bouton OK introuvable')));
        noter({ reglement: 'Règlement à saisir plus tard' });
        return terminer('FSE validée ✔, règlement plus tard');
      }
      cliquer(cliquable(plusBas(chercher(/^Ajouter un règlement/)) || stop('« Ajouter un règlement » introuvable')));
      afficher(`${MODES[choix].nom} : enregistrement…`);
    } catch (e) {
      terminer('⚠ ' + e.message);
    }
  }

  // Type de règlement : liste native (select), sinon on vérifie que Stellair l'affiche déjà.
  function choisirType(re) {
    for (const liste of document.querySelectorAll('select')) {
      const opt = [...liste.options].find((o) => re.test(norm(o.textContent)));
      if (!opt || !visible(liste)) continue;
      if (!opt.selected) {
        liste.value = opt.value;
        liste.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    }
    return present(re);
  }

  // Démarrer ou reprendre à la page affichée : jamais de relecture de la carte, et pas de retour sur les pages déjà passées.
  function sauterPages() {
    if (!flux.faits.includes('carte')) flux.faits.push('carte');
    if (ETAPES.slice(3).some((e) => e.detecte())) { // au moins « prise en charge » est dépassée ou affichée
      for (const n of ['bénéficiaire', 'fse']) if (!flux.faits.includes(n)) flux.faits.push(n);
    }
  }
  function mettreEnPause() {
    if (!flux) return;
    flux.pause = true;
    sauver();
    afficher('⏸ En pause : fais ce qu\'il faut, puis Reprendre');
  }
  function reprendre() {
    if (!flux) return;
    flux.pause = false;
    flux.debut = Date.now(); // le temps de pause ne compte pas
    activite = Date.now();
    miroir = false;
    sauterPages();
    sauver();
    afficher('FSE : reprise à la page affichée…');
  }

  function demarrer(ici = false) {
    flux = { debut: Date.now(), faits: [] };
    miroir = false;
    activite = Date.now();
    noter({}, true);
    fixerCb(0); // le montant de la FSE précédente n'a plus lieu d'être
    flux.somelog = patientSomelog();
    if (ici) sauterPages();
    lignesJournal = [];
    journal(flux.somelog ? `📋 Somelog : ${flux.somelog.nom} (${flux.somelog.ddn})` : '📋 Somelog : aucun patient ouvert');
    sauver();
    afficher('FSE : en cours…');
  }

  function terminer(message) {
    flux = null;
    sauver();
    if (/^(⚠|Erreur|Temps dépassé)/.test(message)) montrerMiroir(); // le déroulé s'arrête : à toi de cliquer
    afficher(message);
  }

  // ---------- démarrage automatique à l'insertion de la carte ----------
  // Stellair lit la carte tout seul et ouvre soit le choix du bénéficiaire, soit la page « Feuille de soins électronique ».
  // On part dès que l'une de ces pages apparaît, une seule fois par carte : il faut avoir quitté cette page (≥ 2 s) pour être de nouveau prêt.
  let auto = true;
  try { auto = localStorage.getItem(CLE_AUTO) !== '0'; } catch (e) { /* rien */ }
  function reglerAuto(oui) {
    auto = oui;
    departAuto = 0;
    try { localStorage.setItem(CLE_AUTO, oui ? '1' : '0'); } catch (e) { /* stockage bloqué */ }
    dessiner();
  }
  function pageCarteLue() {
    if (present('Feuille de soins électronique') && present('Créer')) return true;
    const p = patientSomelog();
    return !!p && !present('Feuille de soins électronique') && memePatient(p, true).length > 0; // choix du bénéficiaire
  }
  let armee = false, departAuto = 0, horsPageDepuis = 0; // armée = false au chargement : recharger la page ne relance rien
  function surveillerAuto() {
    if (!pageCarteLue()) {
      if (!horsPageDepuis) horsPageDepuis = Date.now();
      if (Date.now() - horsPageDepuis >= AUTO_REARME_MS) armee = true;
      if (departAuto) { departAuto = 0; dessiner(); } // la page a disparu pendant le délai
      return;
    }
    horsPageDepuis = 0;
    if (!armee || !auto) return;
    if (!departAuto) { departAuto = Date.now(); afficher('⚡ Carte lue : départ automatique…'); return; }
    if (Date.now() - departAuto < AUTO_DELAI_MS) return;
    armee = false;
    departAuto = 0;
    demarrer(true);
  }
  function annulerAuto() {
    armee = false; // pas de nouvel essai sur cette page
    departAuto = 0;
    afficher('Départ automatique annulé');
  }

  let occupe = false;
  setInterval(async () => {
    if (!panneau.isConnected) document.body.appendChild(panneau);
    surveillerRecap();
    if (!flux) surveillerAuto();
    if (miroir && Date.now() - dernierMiroir > 1500) rafraichirMiroir();
    if (!flux || occupe || flux.pause) return;
    if (!flux.attente && Date.now() - flux.debut > DUREE_MAX_MS) return terminer(resume.validee ? 'FSE validée ✔ (fin à faire à la main)' : 'Temps dépassé, arrêt');
    const etape = ETAPES.find((e) => !flux.faits.includes(e.nom) && e.detecte());
    if (!etape) {
      if (!miroir && !flux.attente && Date.now() - activite > STUCK_MS) montrerMiroir();
      return;
    }
    miroir = false;
    activite = Date.now();
    occupe = true;
    flux.faits.push(etape.nom);
    sauver();
    afficher(`FSE : ${etape.nom}…`);
    try {
      etapeEnCours = etape;
      await etape.action();
    } catch (e) {
      if (e instanceof Arret && e.message === PAUSE) {
        if (flux) { flux.faits = flux.faits.filter((n) => n !== etape.nom); sauver(); } // l'étape interrompue sera rejouée si sa page est encore affichée
      } else terminer(e instanceof Arret ? '⚠ ' + e.message : 'Erreur : ' + e.message);
    }
    activite = Date.now();
    occupe = false;
  }, 400);

  // ---------- panneau ----------
  const panneau = document.createElement('div');

  // Panneau détaché dans une petite fenêtre toujours au premier plan (Document Picture-in-Picture, Firefox 151+).
  let pip = null;
  async function detacher() {
    try {
      pip = await window.documentPictureInPicture.requestWindow({ width: 200, height: 520 });
    } catch (e) {
      return afficher('⚠ Détachement impossible : ' + e.message);
    }
    pip.document.title = 'Stellair';
    pip.document.body.style.margin = '0';
    Object.assign(panneau.style, { position: 'static', width: 'auto', maxHeight: '100vh' });
    pip.document.body.append(panneau);
    pip.addEventListener('pagehide', () => {
      pip = null;
      Object.assign(panneau.style, { position: 'fixed', width: '130px', maxHeight: '60vh' });
      document.body.append(panneau);
      dessiner();
    });
    dessiner();
  }
  panneau.id = 'sfc-panneau';
  Object.assign(panneau.style, {
    position: 'fixed', right: '8px', top: '35%', zIndex: 99999, width: '130px',
    display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px',
    background: '#fff', border: '1px solid #4287d0', borderRadius: '10px',
    boxShadow: '0 2px 8px rgba(0,0,0,.2)', font: '14px sans-serif', maxHeight: '60vh', overflowY: 'auto',
  });
  let message = '';
  function afficher(m) { message = m; dessiner(); }

  let reduit = false;
  try { reduit = localStorage.getItem(CLE_REDUIT) === '1'; } catch (e) { /* rien */ }
  function reduire(oui) {
    reduit = oui;
    try { localStorage.setItem(CLE_REDUIT, oui ? '1' : '0'); } catch (e) { /* stockage bloqué */ }
    dessiner();
  }
  const bouton = (texte, style, action) => {
    const b = document.createElement('button');
    b.textContent = texte;
    b.style.cssText = style;
    b.onclick = action;
    return b;
  };

  function dessiner() {
    panneau.replaceChildren();
    const attente = flux && flux.attente;
    panneau.style.width = reduit && !attente || pip ? 'auto' : '130px';
    // Réduit : une pastille (avec le montant SumUp s'il y en a un), sauf quand un choix de paiement est demandé.
    if (reduit && !attente) {
      panneau.append(bouton(cb > 0 ? `💳 ${eur(cb)}` : flux ? (flux.pause ? '⏸ FSE' : '⏳ FSE') : '◀ FSE',
        'padding:6px;border:0;border-radius:8px;background:#4287d0;color:#fff;font-weight:bold;cursor:pointer', () => reduire(false)));
      return;
    }
    if (attente) {
      const q = document.createElement('div');
      q.textContent = `Paiement ${eur(cb)} :`;
      q.style.cssText = 'font-weight:bold;color:#333';
      panneau.append(q);
      for (const [cle, m] of Object.entries(MODES)) {
        panneau.append(bouton(m.bouton, `padding:8px;border:0;border-radius:8px;color:#fff;font-weight:bold;cursor:pointer;background:${m.sumup ? '#2a9d5c' : '#4287d0'}`,
          () => choisirMode(cle)));
      }
      panneau.append(bouton('Plus tard', 'padding:4px;border:1px solid #999;border-radius:8px;background:#fff;color:#333;cursor:pointer',
        () => choisirMode('plus tard')));
    }
    const lancer = bouton('▶ FSE', 'padding:10px;border:0;border-radius:8px;background:#4287d0;color:#fff;font-weight:bold;cursor:pointer;opacity:' + (flux ? 0.5 : 1), () => demarrer(false));
    lancer.disabled = !!flux;
    const ici = bouton('▶ Ici', 'padding:5px;border:1px solid #4287d0;border-radius:8px;background:#fff;color:#4287d0;font-weight:bold;cursor:pointer;opacity:' + (flux ? 0.5 : 1), () => demarrer(true));
    ici.disabled = !!flux;
    ici.title = 'Démarre à la page affichée, sans relire la carte Vitale';
    panneau.append(lancer, ici);
    if (departAuto) {
      panneau.append(bouton('✖ Annuler le départ', 'padding:8px;border:0;border-radius:8px;background:#c33;color:#fff;font-weight:bold;cursor:pointer', annulerAuto));
    }
    panneau.append(bouton(auto ? '⚡ Auto : ON' : '⚡ Auto : OFF',
      `padding:3px;border:1px solid #4287d0;border-radius:8px;font-size:11px;font-weight:bold;cursor:pointer;background:${auto ? '#4287d0' : '#fff'};color:${auto ? '#fff' : '#4287d0'}`,
      () => reglerAuto(!auto)));
    if (flux) {
      panneau.append(flux.pause
        ? bouton('⏵ Reprendre', 'padding:8px;border:0;border-radius:8px;background:#2a9d5c;color:#fff;font-weight:bold;cursor:pointer', reprendre)
        : bouton('⏸ Pause', 'padding:8px;border:0;border-radius:8px;background:#e08a00;color:#fff;font-weight:bold;cursor:pointer', mettreEnPause));
    }
    if (cb > 0) {
      // Le montant à taper sur le SumUp, visible dès le récapitulatif.
      const sumup = document.createElement('div');
      sumup.textContent = `💳 SumUp : ${eur(cb)}`;
      sumup.style.cssText = 'padding:8px;border-radius:8px;background:#2a9d5c;color:#fff;font-weight:bold;text-align:center';
      panneau.append(sumup);
      if (!flux) panneau.append(bouton('Effacer', 'padding:2px;border:0;background:none;color:#666;font-size:11px;cursor:pointer', () => fixerCb(0)));
    }
    panneau.append(bouton(miroir ? '🖱 Masquer' : '🖱 Page', 'padding:2px;border:1px solid #4287d0;border-radius:8px;background:#fff;color:#4287d0;font-size:11px;cursor:pointer',
      () => { if (miroir) { miroir = false; dessiner(); } else montrerMiroir(); }));
    if (miroir) {
      const tete = document.createElement('div');
      tete.textContent = listeMiroir.length ? 'Boutons de la page :' : 'Aucun bouton visible';
      tete.style.cssText = 'font-size:11px;color:#555';
      panneau.append(tete);
      listeMiroir.forEach((c, i) => panneau.append(bouton((c.perso ? '👤 ' : '') + c.t,
        'padding:5px;border:1px solid #4287d0;border-radius:8px;background:#eef5fd;color:#1a4f8a;font-size:12px;cursor:pointer;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
        () => { cliquer(cliquable(listeMiroir[i].el), true); setTimeout(() => rafraichirMiroir(true), 600); })));
    }
    if (!pip && window.documentPictureInPicture) {
      const d = document.createElement('button');
      d.textContent = '📌 Détacher';
      d.title = 'Ouvrir le panneau dans une petite fenêtre au-dessus de tout';
      d.style.cssText = 'padding:2px;border:1px solid #4287d0;border-radius:8px;background:#fff;color:#4287d0;font-size:11px;cursor:pointer';
      d.onclick = detacher;
      panneau.append(d);
    }
    if (flux) {
      const arret = document.createElement('button');
      arret.textContent = '■ Stop';
      arret.style.cssText = 'padding:4px;border:1px solid #c33;border-radius:8px;background:#fff;color:#c33;cursor:pointer';
      arret.onclick = () => terminer('Arrêté');
      panneau.append(arret);
    }
    panneau.append(bouton('▶ Réduire', 'padding:2px;border:0;background:none;color:#4287d0;font-size:11px;cursor:pointer', () => reduire(true)));
    if (resume.total) {
      const r = document.createElement('div');
      r.style.cssText = 'font-size:11px;color:#333;border-top:1px solid #ddd;padding-top:4px;white-space:pre-line';
      r.textContent = ['Dernière FSE :', resume.ald && 'ALD', resume.mode,
        `Total ${resume.total} (AMO ${resume.amo}, AMC ${resume.amc})`, `Patient ${resume.patient}`,
        resume.validee ? '✔ validée' : 'non validée par le script', resume.reglement].filter(Boolean).join('\n');
      panneau.append(r);
    }
    if (lignesJournal.length) panneau.append(blocJournal());
    if (message) {
      const m = document.createElement('div');
      m.textContent = message;
      m.style.cssText = 'font-size:12px;color:#333';
      panneau.append(m);
    }
  }
  if (flux) message = 'FSE : reprise…';
  dessiner();
  document.body.appendChild(panneau);
})();

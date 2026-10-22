// ==UserScript==
// @name         Stellair FSE rapide (bêta)
// @namespace    saisie-rapide
// @version      0.17
// @description  Un bouton par cotation : lecture carte Vitale, ALD auto, ajout des favoris, pages suivantes, validation de la FSE ; reste à payer envoyé au SumUp Solo
// @match        https://fse.stellair.fr/*
// @match        https://somenor.net/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      api.sumup.com
// @updateURL    https://raw.githubusercontent.com/asayet44/test/main/stellair/fse-rapide.user.js
// @downloadURL  https://raw.githubusercontent.com/asayet44/test/main/stellair/fse-rapide.user.js
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

  // Une ligne = un bouton. "favoris" = nom exact du favori Stellair (ligne en gras de l'onglet Favoris).
  const COTATIONS = [
    { nom: 'G', favoris: ['Consult'] },
    { nom: 'G + SNP', favoris: ['Consult', 'SNP'], snp: true },
    { nom: 'G + ECG', favoris: ['Consult', /^ECG consult/i] }, // en visite ce sera « ECG visite » (VG + ECG)
  ];
  const SNP_MAX_SEMAINE = 15;
  const ATTENTE_ALD_MS = 5000; // temps laissé aux droits en ligne (ADRi) pour afficher la bulle ALD
  const DUREE_MAX_MS = 3 * 60 * 1000; // lecture carte + choix du bénéficiaire compris
  const RE_VALIDER = /^(Sécuriser|Valider|Signer)\b/;

  const CLE_FLUX = 'stellair-flux';
  const CLE_SNP = 'stellair-snp';

  const norm = (s) => (s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  const visible = (el) => el.getClientRects().length > 0;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  // Éléments visibles dont le texte correspond (le plus profond seulement), hors de notre panneau.
  function chercher(texte) {
    const ok = texte instanceof RegExp ? (t) => texte.test(t) : (t) => t === texte;
    return [...document.documentElement.querySelectorAll('*')].filter((el) =>
      !el.closest('#sfr-panneau') && ok(norm(el.textContent)) && visible(el) &&
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
  function memePatient(p) {
    return [...document.body.querySelectorAll('*')].filter((el) => !el.closest('#sfr-panneau') && contientNom(el.textContent, p) &&
      visible(el) && ![...el.children].some((c) => contientNom(c.textContent, p))).filter((el) => {
      let ligne = el;
      while (ligne.parentElement && norm(ligne.parentElement.textContent).length < 150) ligne = ligne.parentElement;
      const dates = norm(ligne.textContent).match(/\d\d\/\d\d\/\d{4}/g);
      return !dates || dates.includes(p.ddn);
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

  function cliquer(el) {
    el.scrollIntoView({ block: 'center' });
    el.click();
  }

  async function attendre(fn, ms) {
    const fin = Date.now() + ms;
    for (;;) {
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
      afficher(`${flux.cotation} : ${etapeEnCours.nom}, nouvel essai…`);
    }
    stop('La page ne passe pas à la suite : clique Suivant à la main');
  }

  // Le « + » est le dernier bouton situé avant le nom du favori, dans la même ligne.
  function boutonPlus(nom) {
    for (const libelle of chercher(nom)) {
      for (let ligne = libelle.parentElement; ligne && norm(ligne.textContent).length < 80; ligne = ligne.parentElement) {
        const avant = [...ligne.querySelectorAll('button, [role="button"], a')].filter((b) =>
          !b.contains(libelle) && b.compareDocumentPosition(libelle) & Node.DOCUMENT_POSITION_FOLLOWING);
        if (avant.length) return avant[avant.length - 1];
      }
    }
    return null;
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

  // ---------- paiement CB sur le SumUp Solo (Cloud API) ----------
  // Identifiants gardés dans le stockage Violentmonkey (onglet « Valeurs » du script pour les corriger), jamais sur GitHub.
  const CLE_CB = 'stellair-cb';
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
  const CLE_RESUME = 'stellair-resume';
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
    if (m !== null && !surRecap) { noter(lireRecap(document.body.innerText), !flux); fixerCb(m); } // une seule capture par passage, pour ne pas faire réapparaître un bouton déjà payé
    surRecap = m !== null;
  }

  function reglage(nom, question) {
    let v = GM_getValue(nom, '');
    if (!v) {
      v = norm(fen().prompt(question) || '');
      if (!v) throw new Error('réglage « ' + nom + ' » manquant');
      GM_setValue(nom, v);
    }
    return v;
  }

  function sumup(chemin, corps) {
    const cle = reglage('cleApi', 'Clé API SumUp (sup_sk_…) :');
    const marchand = reglage('codeMarchand', 'Code marchand SumUp (M…) :');
    return new Promise((ok, ko) => GM_xmlhttpRequest({
      method: corps ? 'POST' : 'GET',
      url: `https://api.sumup.com/v0.1/merchants/${marchand}${chemin}`,
      headers: { Authorization: 'Bearer ' + cle, 'Content-Type': 'application/json' },
      data: corps && JSON.stringify(corps),
      timeout: 15000,
      onload: (r) => r.status < 300 ? ok(JSON.parse(r.responseText || '{}'))
        : ko(new Error(`SumUp ${r.status} : ${(r.responseText || '').slice(0, 150)}`)),
      onerror: () => ko(new Error('SumUp injoignable')),
      ontimeout: () => ko(new Error('SumUp ne répond pas')),
    }));
  }

  let envoi = false;
  const connecte = () => !!GM_getValue('lecteur', '');

  // Bouton rouge du panneau : tous les réglages d'un coup, puis appairage du Solo.
  async function connecter() {
    if (envoi) return;
    envoi = true;
    dessiner();
    try {
      reglage('cleApi', 'Clé API SumUp (sup_sk_…) :');
      reglage('codeMarchand', 'Code marchand SumUp (M…) :');
      reglage('appId', 'Identifiant d\'application de la clé affiliée (ex. stellair-fse-rapide) :');
      reglage('cleAffiliee', 'Clé affiliée SumUp :');
      // Solo déjà appairé depuis un autre appareil (Mac / téléphone) : on le reprend, pas de nouveau code.
      const { items = [] } = await sumup('/readers');
      const deja = items.find((r) => r.status === 'paired');
      if (deja) {
        GM_setValue('lecteur', deja.id);
        afficher(`✔ Solo « ${deja.name} » retrouvé`);
      } else {
        const code = norm(fen().prompt('Sur le Solo : Connexions → API → Connecter, puis saisis le code affiché :') || '');
        if (!code) throw new Error('appairage annulé');
        GM_setValue('lecteur', (await sumup('/readers', { pairing_code: code, name: 'Cabinet' })).id);
        afficher('✔ Solo connecté');
      }
    } catch (e) {
      afficher('⚠ Connexion SumUp : ' + e.message);
    }
    envoi = false;
    dessiner();
  }

  async function encaisser() {
    if (envoi || !(cb > 0)) return;
    if (!connecte()) return afficher('⚠ Clique d\'abord sur « Connecter SumUp »');
    envoi = true;
    dessiner();
    try {
      await sumup(`/readers/${GM_getValue('lecteur')}/checkout`, {
        total_amount: { currency: 'EUR', minor_unit: 2, value: Math.round(cb * 100) },
        description: 'Consultation',
        affiliate: { app_id: GM_getValue('appId'), key: GM_getValue('cleAffiliee'), foreign_transaction_id: 'stellair-' + Date.now() },
      });
      const envoye = cb;
      noter({ paiement: `💳 CB ${envoye.toFixed(2).replace('.', ',')} € envoyé au Solo` });
      fixerCb(0);
      afficher(`💳 ${envoye.toFixed(2)} € envoyé au Solo`);
    } catch (e) {
      afficher('⚠ CB : ' + e.message);
    }
    envoi = false;
    dessiner();
  }

  // ---------- compteur SNP de la semaine (lundi → dimanche, sur ce navigateur) ----------
  function lundi() {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.toDateString();
  }
  function snp() {
    try {
      const c = JSON.parse(localStorage.getItem(CLE_SNP));
      return c && c.semaine === lundi() ? c.n : 0;
    } catch (e) { return 0; }
  }
  function fixerSnp(n) {
    try { localStorage.setItem(CLE_SNP, JSON.stringify({ semaine: lundi(), n })); } catch (e) { /* stockage bloqué */ }
    dessiner();
  }

  // ---------- déroulé : chaque page n'est traitée qu'une fois ----------
  class Arret extends Error {}
  function stop(message) { throw new Arret(message); }

  let flux = null;
  try { flux = JSON.parse(sessionStorage.getItem(CLE_FLUX)); } catch (e) { /* rien */ }
  function sauver() {
    try {
      if (flux) sessionStorage.setItem(CLE_FLUX, JSON.stringify(flux));
      else sessionStorage.removeItem(CLE_FLUX);
    } catch (e) { /* stockage bloqué */ }
  }
  const cotation = () => COTATIONS.find((c) => c.nom === flux.cotation);

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
      nom: 'actes',
      detecte: () => present('Rechercher un favori'),
      action: async () => {
        await pause(300);
        for (const nom of cotation().favoris) {
          const plus = boutonPlus(nom);
          if (!plus) stop(`Favori « ${nom} » introuvable`);
          cliquer(plus);
          await pause(600);
        }
        // Téléphone plus lent : on laisse 15 s. Si le total n'est pas affiché du tout, le récapitulatif fera le contrôle.
        await attendre(() => totalActes() !== 0, 15000);
        if (totalActes() === 0) stop('Total actes à 0 : cotation non ajoutée');
        await suivant();
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
        if (lireRecap(document.body.innerText).total === '0,00 €') stop('Total facture à 0 € : cotation non ajoutée');
        await suivant(/^Sécurisation/, false); // la page Sécurisation est vérifiée juste après
        // Selon l'écran, Stellair demande une validation ou sécurise directement (fenêtre « Feuille de soins terminée »).
        const valider = await attendre(() => finVisible() || plusBas(chercher(RE_VALIDER)), 45000); // téléphone : sécurisation lente
        if (!valider) stop('Page Sécurisation : bouton de validation non reconnu, valide à la main');
        if (valider !== true) cliquer(cliquable(valider));
        noter({ validee: true });
        if (cotation().snp) fixerSnp(snp() + 1);
      },
    },
    {
      // Fenêtre « Feuille de soins terminée » : règlement CB s'il reste à payer, sinon OK (ALD, C2S…).
      nom: 'fin',
      detecte: () => finVisible(),
      action: async () => {
        await pause(300);
        if (cb > 0) {
          flux.attente = true; // le déroulé reprend au clic sur un mode de paiement (choisirMode)
          sauver();
          return afficher(`Reste ${cb.toFixed(2).replace('.', ',')} € : mode de paiement ?`);
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
        terminer(`FSE validée ✔, règlement ${mode.nom} enregistré`);
        if (mode.solo) await encaisser(); // le Solo affiche le montant
        else fixerCb(0);
      },
    },
  ];

  // Lu sur le texte affiché de toute la page (insensible à la casse et à la structure de la fenêtre).
  const finVisible = () => /Feuille de soins terminée|facture a été sécurisée/i
    .test(document.documentElement.innerText.normalize('NFC'));
  const MODES = {
    cb: { nom: 'Carte bancaire', bouton: '💳 CB', re: /^Carte bancaire/i, solo: true },
    especes: { nom: 'Espèces', bouton: 'Espèces', re: /^Esp[eè]ces/i },
    cheque: { nom: 'Chèque', bouton: 'Chèque', re: /^Ch[eè]que/i },
  };

  // Clic du médecin sur un mode : on reprend le déroulé depuis la fenêtre « Feuille de soins terminée ».
  function choisirMode(choix) {
    flux.attente = false;
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

  function demarrer(c) {
    if (c.snp && snp() >= SNP_MAX_SEMAINE &&
        !fen().confirm(`Déjà ${snp()} SNP cette semaine (max ${SNP_MAX_SEMAINE}). Continuer quand même ?`)) return;
    flux = { cotation: c.nom, debut: Date.now(), faits: [] };
    noter({ cotation: c.nom }, true);
    flux.somelog = patientSomelog();
    lignesJournal = [];
    journal(flux.somelog ? `📋 Somelog : ${flux.somelog.nom} (${flux.somelog.ddn})` : '📋 Somelog : aucun patient ouvert');
    sauver();
    afficher(`${c.nom} : en cours…`);
  }

  function terminer(message) {
    flux = null;
    sauver();
    afficher(message);
  }

  let occupe = false;
  setInterval(async () => {
    if (!panneau.isConnected) document.body.appendChild(panneau);
    surveillerRecap();
    if (!flux || occupe) return;
    if (!flux.attente && Date.now() - flux.debut > DUREE_MAX_MS) return terminer(resume.validee ? 'FSE validée ✔ (fin à faire à la main)' : 'Temps dépassé, arrêt');
    const etape = ETAPES.find((e) => !flux.faits.includes(e.nom) && e.detecte());
    if (!etape) return;
    occupe = true;
    flux.faits.push(etape.nom);
    sauver();
    afficher(`${flux.cotation} : ${etape.nom}…`);
    try {
      etapeEnCours = etape;
      await etape.action();
    } catch (e) {
      terminer(e instanceof Arret ? '⚠ ' + e.message : 'Erreur : ' + e.message);
    }
    occupe = false;
  }, 400);

  // ---------- panneau ----------
  const panneau = document.createElement('div');
  const fen = () => panneau.ownerDocument.defaultView || window;

  // Panneau détaché dans une petite fenêtre toujours au premier plan (Document Picture-in-Picture, Firefox 151+).
  let pip = null;
  async function detacher() {
    try {
      pip = await window.documentPictureInPicture.requestWindow({ width: 190, height: 480 });
    } catch (e) {
      return afficher('⚠ Détachement impossible : ' + e.message);
    }
    pip.document.title = 'Stellair';
    pip.document.body.style.margin = '0';
    Object.assign(panneau.style, { position: 'static', width: 'auto' });
    pip.document.body.append(panneau);
    pip.addEventListener('pagehide', () => {
      pip = null;
      Object.assign(panneau.style, { position: 'fixed', width: '130px' });
      document.body.append(panneau);
      dessiner();
    });
    dessiner();
  }
  panneau.id = 'sfr-panneau';
  Object.assign(panneau.style, {
    position: 'fixed', right: '8px', top: '35%', zIndex: 99999, width: '130px',
    display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px',
    background: '#fff', border: '1px solid #4287d0', borderRadius: '10px',
    boxShadow: '0 2px 8px rgba(0,0,0,.2)', font: '14px sans-serif',
  });
  let message = '';
  function afficher(m) { message = m; dessiner(); }

  let reduit = false;
  try { reduit = localStorage.getItem('stellair-reduit') === '1'; } catch (e) { /* rien */ }
  function reduire(oui) {
    reduit = oui;
    try { localStorage.setItem('stellair-reduit', oui ? '1' : '0'); } catch (e) { /* stockage bloqué */ }
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
    // Réduit : une pastille, sauf quand un choix de paiement est demandé.
    if (reduit && !attente) {
      panneau.append(bouton(flux ? '⏳ FSE' : '◀ FSE', 'padding:6px;border:0;border-radius:8px;background:#4287d0;color:#fff;font-weight:bold;cursor:pointer',
        () => reduire(false)));
      return;
    }
    if (attente) {
      const q = document.createElement('div');
      q.textContent = `Paiement ${cb.toFixed(2).replace('.', ',')} € :`;
      q.style.cssText = 'font-weight:bold;color:#333';
      panneau.append(q);
      for (const [cle, m] of Object.entries(MODES)) {
        panneau.append(bouton(m.bouton, `padding:8px;border:0;border-radius:8px;color:#fff;font-weight:bold;cursor:pointer;background:${m.solo ? '#2a9d5c' : '#4287d0'}`,
          () => choisirMode(cle)));
      }
      panneau.append(bouton('Plus tard', 'padding:4px;border:1px solid #999;border-radius:8px;background:#fff;color:#333;cursor:pointer',
        () => choisirMode('plus tard')));
    }
    for (const c of COTATIONS) {
      const plein = c.snp && snp() >= SNP_MAX_SEMAINE;
      const b = document.createElement('button');
      b.textContent = c.nom;
      b.disabled = !!flux;
      Object.assign(b.style, {
        padding: '8px', border: 0, borderRadius: '8px', color: '#fff', fontWeight: 'bold',
        background: plein ? '#999' : '#4287d0', cursor: 'pointer', opacity: flux ? 0.5 : 1,
      });
      b.onclick = () => demarrer(c);
      panneau.append(b);
    }
    const compteur = document.createElement('div');
    compteur.textContent = `SNP semaine : ${snp()}/${SNP_MAX_SEMAINE}`;
    compteur.title = 'Cliquer pour corriger';
    compteur.style.cssText = 'font-size:12px;cursor:pointer;color:#333';
    compteur.onclick = () => {
      const n = parseInt(fen().prompt('Nombre de SNP cette semaine :', snp()), 10);
      if (n >= 0) fixerSnp(n);
    };
    panneau.append(compteur);
    if (!connecte()) {
      const lien = document.createElement('button');
      lien.textContent = envoi ? 'Connexion…' : 'Connecter SumUp';
      lien.disabled = envoi;
      lien.style.cssText = 'padding:6px;border:0;border-radius:8px;background:#c33;color:#fff;font-weight:bold;cursor:pointer';
      lien.onclick = connecter;
      panneau.append(lien);
    }
    if (cb > 0 && !flux) {
      const carte = document.createElement('button');
      carte.textContent = envoi ? '💳 Envoi…' : `💳 CB ${cb.toFixed(2).replace('.', ',')} €`;
      carte.disabled = envoi;
      carte.title = 'Envoyer le reste à payer au SumUp Solo';
      carte.style.cssText = 'padding:8px;border:0;border-radius:8px;background:#2a9d5c;color:#fff;font-weight:bold;cursor:pointer';
      carte.onclick = encaisser;
      const oubli = document.createElement('button');
      oubli.textContent = 'Pas de CB';
      oubli.style.cssText = 'padding:2px;border:0;background:none;color:#666;font-size:11px;cursor:pointer';
      oubli.onclick = () => { noter({ paiement: 'Pas de CB (autre mode)' }); fixerCb(0); };
      panneau.append(carte, oubli);
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
      r.textContent = ['Dernière FSE :', resume.cotation, resume.ald && 'ALD', resume.mode,
        `Total ${resume.total} (AMO ${resume.amo}, AMC ${resume.amc})`, `Patient ${resume.patient}`,
        resume.validee ? '✔ validée' : 'non validée par le script', resume.reglement, resume.paiement].filter(Boolean).join('\n');
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
  if (flux) message = `${flux.cotation} : reprise…`;
  dessiner();
  document.body.appendChild(panneau);
})();

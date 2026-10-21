// ==UserScript==
// @name         Stellair FSE rapide (bêta)
// @namespace    saisie-rapide
// @version      0.5
// @description  Un bouton par cotation : lecture carte Vitale, ALD auto, ajout des favoris, pages suivantes, validation de la FSE ; reste à payer envoyé au SumUp Solo
// @match        https://fse.stellair.fr/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      api.sumup.com
// @updateURL    https://raw.githubusercontent.com/asayet44/test/main/stellair/fse-rapide.user.js
// @downloadURL  https://raw.githubusercontent.com/asayet44/test/main/stellair/fse-rapide.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Une ligne = un bouton. "favoris" = nom exact du favori Stellair (ligne en gras de l'onglet Favoris).
  const COTATIONS = [
    { nom: 'G', favoris: ['Consult'] },
    { nom: 'G + SNP', favoris: ['Consult', 'SNP'], snp: true },
    { nom: 'G + ECG', favoris: ['Consult', /^(ECG|DEQP003)\b/] }, // favori nommé « ECG » ou par son code CCAM
  ];
  const SNP_MAX_SEMAINE = 15;
  const ATTENTE_ALD_MS = 5000; // temps laissé aux droits en ligne (ADRi) pour afficher la bulle ALD
  const DUREE_MAX_MS = 3 * 60 * 1000; // lecture carte + choix du bénéficiaire compris
  const RE_VALIDER = /^(Sécuriser|Valider|Signer)\b/;

  const CLE_FLUX = 'stellair-flux';
  const CLE_SNP = 'stellair-snp';

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => el.getClientRects().length > 0;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  // Éléments visibles dont le texte correspond (le plus profond seulement), hors de notre panneau.
  function chercher(texte) {
    const ok = texte instanceof RegExp ? (t) => texte.test(t) : (t) => t === texte;
    return [...document.body.querySelectorAll('*')].filter((el) =>
      !el.closest('#sfr-panneau') && ok(norm(el.textContent)) && visible(el) &&
      ![...el.children].some((c) => ok(norm(c.textContent))));
  }
  const present = (texte) => chercher(texte).length > 0;
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

  function suivant(re = /^Suivant/) {
    const el = plusBas(chercher(re));
    if (!el) stop('Bouton « Suivant » introuvable');
    cliquer(cliquable(el));
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

  function totalActes() {
    const m = document.body.innerText.match(/Total actes\s*([\d.,]+)\s*€/);
    return m ? parseFloat(m[1].replace(',', '.')) : 0;
  }

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
  let surRecap = false;
  function surveillerRecap() {
    const m = montantPatient(document.body.innerText);
    if (m !== null && !surRecap) fixerCb(m); // une seule capture par passage, pour ne pas faire réapparaître un bouton déjà payé
    surRecap = m !== null;
  }

  function reglage(nom, question) {
    let v = GM_getValue(nom, '');
    if (!v) {
      v = norm(prompt(question) || '');
      if (!v) throw new Error('réglage « ' + nom + ' » manquant');
      GM_setValue(nom, v);
    }
    return v;
  }

  function sumup(chemin, corps) {
    const cle = reglage('cleApi', 'Clé API SumUp (sup_sk_…) :');
    const marchand = reglage('codeMarchand', 'Code marchand SumUp (M…) :');
    return new Promise((ok, ko) => GM_xmlhttpRequest({
      method: 'POST',
      url: `https://api.sumup.com/v0.1/merchants/${marchand}${chemin}`,
      headers: { Authorization: 'Bearer ' + cle, 'Content-Type': 'application/json' },
      data: JSON.stringify(corps),
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
      const code = norm(prompt('Sur le Solo : Connexions → API → Connecter, puis saisis le code affiché :') || '');
      if (!code) throw new Error('appairage annulé');
      GM_setValue('lecteur', (await sumup('/readers', { pairing_code: code, name: 'Cabinet' })).id);
      afficher('✔ Solo connecté');
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
      nom: 'fse',
      detecte: () => present('Feuille de soins électronique') && present('Créer'),
      action: async () => cliquer(cliquable(chercher('Créer')[0])),
    },
    {
      nom: 'prise en charge',
      detecte: () => present('Nature de prise en charge'),
      action: async () => {
        afficher('Attente des droits (ALD)…');
        // La case s'appelle « ALD » (droits en ligne) ou « ALD sur attestation » ; avec la bulle ALD du patient
        // il y a donc 2 éléments, la case étant la plus basse. Sans ALD : la case seule.
        const options = () => [...chercher('ALD sur attestation'), ...chercher('ALD')];
        if (await attendre(() => options().length >= 2, ATTENTE_ALD_MS)) {
          const ald = plusBas(options());
          cliquer(ald.closest('label') || ald.parentElement.querySelector('input[type="radio"], [role="radio"]') || ald);
          afficher('ALD cochée');
          await pause(300);
        }
        suivant();
      },
    },
    {
      nom: 'parcours',
      detecte: () => present('Contexte du parcours de soins'),
      action: async () => { await pause(300); suivant(); },
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
        if (!(await attendre(() => totalActes() > 0, 5000))) stop('Total actes à 0 : cotation non ajoutée');
        suivant();
      },
    },
    {
      nom: 'mutuelle',
      detecte: () => present('Informations de la mutuelle'),
      action: async () => { await pause(300); suivant(); },
    },
    {
      nom: 'récapitulatif',
      detecte: () => present(/^Facturation - /),
      action: async () => {
        await pause(300);
        // Avertissement (ex. acte déjà facturé aujourd'hui) : c'est au médecin de décider.
        if (present('Tout cocher')) stop('Avertissement sur le récapitulatif : vérifie puis clique Sécurisation');
        suivant(/^Sécurisation/);
        const valider = await attendre(() => plusBas(chercher(RE_VALIDER)), 15000);
        if (!valider) stop('Page Sécurisation : bouton de validation non reconnu, valide à la main');
        cliquer(cliquable(valider));
        if (cotation().snp) fixerSnp(snp() + 1);
        terminer('FSE validée ✔');
      },
    },
  ];

  function demarrer(c) {
    if (c.snp && snp() >= SNP_MAX_SEMAINE &&
        !confirm(`Déjà ${snp()} SNP cette semaine (max ${SNP_MAX_SEMAINE}). Continuer quand même ?`)) return;
    flux = { cotation: c.nom, debut: Date.now(), faits: [] };
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
    if (!document.getElementById('sfr-panneau')) document.body.appendChild(panneau);
    surveillerRecap();
    if (!flux || occupe) return;
    if (Date.now() - flux.debut > DUREE_MAX_MS) return terminer('Temps dépassé, arrêt');
    const etape = ETAPES.find((e) => !flux.faits.includes(e.nom) && e.detecte());
    if (!etape) return;
    occupe = true;
    flux.faits.push(etape.nom);
    sauver();
    afficher(`${flux.cotation} : ${etape.nom}…`);
    try {
      await etape.action();
    } catch (e) {
      terminer(e instanceof Arret ? '⚠ ' + e.message : 'Erreur : ' + e.message);
    }
    occupe = false;
  }, 400);

  // ---------- panneau ----------
  const panneau = document.createElement('div');
  panneau.id = 'sfr-panneau';
  Object.assign(panneau.style, {
    position: 'fixed', right: '8px', top: '35%', zIndex: 99999, width: '130px',
    display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px',
    background: '#fff', border: '1px solid #4287d0', borderRadius: '10px',
    boxShadow: '0 2px 8px rgba(0,0,0,.2)', font: '14px sans-serif',
  });
  let message = '';
  function afficher(m) { message = m; dessiner(); }

  function dessiner() {
    panneau.replaceChildren();
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
      const n = parseInt(prompt('Nombre de SNP cette semaine :', snp()), 10);
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
    if (cb > 0) {
      const carte = document.createElement('button');
      carte.textContent = envoi ? '💳 Envoi…' : `💳 CB ${cb.toFixed(2).replace('.', ',')} €`;
      carte.disabled = envoi;
      carte.title = 'Envoyer le reste à payer au SumUp Solo';
      carte.style.cssText = 'padding:8px;border:0;border-radius:8px;background:#2a9d5c;color:#fff;font-weight:bold;cursor:pointer';
      carte.onclick = encaisser;
      const oubli = document.createElement('button');
      oubli.textContent = 'Pas de CB';
      oubli.style.cssText = 'padding:2px;border:0;background:none;color:#666;font-size:11px;cursor:pointer';
      oubli.onclick = () => fixerCb(0);
      panneau.append(carte, oubli);
    }
    if (flux) {
      const arret = document.createElement('button');
      arret.textContent = '■ Stop';
      arret.style.cssText = 'padding:4px;border:1px solid #c33;border-radius:8px;background:#fff;color:#c33;cursor:pointer';
      arret.onclick = () => terminer('Arrêté');
      panneau.append(arret);
    }
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

// ==UserScript==
// @name         Stellair FSE rapide (bêta)
// @namespace    saisie-rapide
// @version      0.1
// @description  Un bouton par cotation : lecture carte Vitale, ALD auto, ajout des favoris, pages suivantes, validation de la FSE
// @match        https://fse.stellair.fr/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/asayet44/test/main/stellair/fse-rapide.user.js
// @downloadURL  https://raw.githubusercontent.com/asayet44/test/main/stellair/fse-rapide.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Une ligne = un bouton. "favoris" = nom exact du favori Stellair (ligne en gras de l'onglet Favoris).
  const COTATIONS = [
    { nom: 'G', favoris: ['Consult'] },
    { nom: 'G + SNP', favoris: ['Consult', 'SNP'], snp: true },
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
        if (await attendre(() => present('ALD'), ATTENTE_ALD_MS)) {
          const ald = chercher('ALD sur attestation')[0];
          if (!ald) stop('Patient ALD mais case « ALD sur attestation » introuvable');
          cliquer(cliquable(ald));
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

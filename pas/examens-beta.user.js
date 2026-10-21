// ==UserScript==
// @name         Examens types (bêta)
// @namespace    saisie-rapide-beta
// @version      3.1
// @description  Bêta : examens découpés en morceaux cliquables, insérés à la suite dans le Commentaire d'EXAM
// @match        https://somenor.net/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/asayet44/test/main/pas/examens-beta.user.js
// @downloadURL  https://raw.githubusercontent.com/asayet44/test/main/pas/examens-beta.user.js
// ==/UserScript==

(function () {
  'use strict';

  /* =====================================================================
     EXAMENS TYPES — chaque morceau entre deux points ou deux virgules
     devient un bouton.
     Un morceau "Pas de X." a automatiquement un inverse "X." :
       1er appui = "Pas de X."  ·  2e = "X."  ·  3e = supprimé.
     Pour choisir l'inverse soi-même : ['texte par défaut.', 'texte inverse.']
     ===================================================================== */
  const EXAMENS = [
    { nom: 'Général', texte: 'Pas de signe de déshydratation. Bon état général.' },
    // onglet: 'CAT' -> écrit dans le Commentaire de l'onglet CAT (par défaut : EXAM)
    { nom: 'CAT', onglet: 'CAT', texte: 'Consigne d\'urgence donnée et comprise par le patient. Consigne de revoir son médecin traitant. Traitement symptomatique.' },
    { nom: 'Cardio', texte: 'BDC réguliers, pas de souffle, pas de douleur thoracique, pas de signe d\'IC.' },
    { nom: 'Pneumo', texte: 'MV bilatéral symétrique, pas de bruit surajouté.' },
    { nom: 'Abdo', texte: 'Ventre souple dépressible, pas de défense. Pas de signe fonctionnel urinaire, pas de douleur à l\'ébranlement lombaire.' },
    { nom: 'ORL', morceaux: ['Pas d\'OMA.', 'Pas d\'angine.', ['Pas d\'adénopathie cervicale.', 'Adénopathies cervicales.'], ['Streptatest -.', 'Streptatest +.'], 'Fièvre.', ['Alimentation conservée.', 'Difficulté à l\'alimentation.']] },
    { nom: 'Gastro', texte: 'Tableau évocateur d\'une gastro-entérite simple sans signe de gravité. Pas de signe de déshydratation. Bon état général. Ventre souple dépressible, pas de défense.' },
    { nom: 'Lumbago', texte: 'Lombalgie commune non déficitaire sans signe de gravité. Pas de syndrome de la queue de cheval. Pas de déficit moteur. Pas de déficit sensitif. Lasègue et Léri normaux. ROT L4 S1 normaux.' },
    { nom: 'Oeil', texte: 'Orgelet simple sans signe de gravité. Chalazion simple sans signe de gravité. Pas de BAV. Pas de lésion cornée. Pas de rougeur.' },
    // morceaux : liste donnée telle quelle, quand une virgule ne doit pas couper le bouton en deux
    { nom: 'Uro', morceaux: ['Cystite simple sans signe de gravité.', ['BU normale.', 'BU leucocytes, nitrite et sang +.'], 'Pas de douleur à l\'ébranlement lombaire.', ['Pas de SFU.', 'SFU +.']] },
  ];

  /* ===== ALL IN : un seul appui = constantes + examen + diagnostic (onglet EXAM)
     puis CAT + Hospitalisation NON + TP + CB (onglet CAT).
     diag : texte exact du bouton de diagnostic de PAS à cliquer ===== */
  const MACROS = [
    {
      nom: '⚡ Syndrome viral',
      diag: 'Rhino-pharyngite virale',
      examen: 'Syndrome viral sans signe de gravité. Bon état général. Pas de signe de surinfection. Pas de trouble de l\'alimentation. Pas de signe de déshydratation.',
      cat: 'Traitement symptomatique. Consigne d\'urgence donnée et comprise par le patient.',
    },
  ];

  const LIMITE = 1500;

  // "A, b. C" -> ["A.", "B.", "C."] : chaque morceau commence par une majuscule et finit par un point
  function decouper(texte) {
    return texte.split(/[.,]/)
      .map((m) => m.trim())
      .filter(Boolean)
      .map((m) => m[0].toUpperCase() + m.slice(1) + '.');
  }

  /* ===== Champ Commentaire de l'onglet EXAM ===== */
  function setValue(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function getCommentaire() {
    const champs = [...document.querySelectorAll('textarea, input')].filter(
      (el) => (el.placeholder || '').trim().startsWith('Commentaire')
    );
    return champs.find((el) => el.offsetWidth > 0 || el.offsetHeight > 0) || champs[0];
  }

  // Passe sur l'onglet voulu (EXAM ou CAT), puis agit une fois le bon Commentaire affiché
  // Élément de PAS dont le texte est exactement t (jamais nos propres boutons)
  const texteExact = (t) => [...document.querySelectorAll('body *')].find(
    (el) => el.children.length === 0 && el.textContent.trim() === t && !el.closest('#sr-beta')
  );

  function surOnglet(nom, action) {
    const onglet = texteExact(nom);
    if (!onglet) return action();
    onglet.click();
    setTimeout(action, 150);
  }

  // Ajoute à la suite, séparé d'un simple espace ; renvoie false si rien n'a été inséré
  function inserer(texte) {
    const champ = getCommentaire();
    if (!champ) { alert('Champ Commentaire introuvable.'); return false; }
    const actuel = champ.value.trim();
    const nouveau = actuel ? actuel + ' ' + texte : texte;
    if (nouveau.length > LIMITE) {
      alert(`Trop long : ${nouveau.length}/${LIMITE} caractères. Texte non inséré.`);
      return false;
    }
    setValue(champ, nouveau);
    return true;
  }

  // [défaut, inverse] : "Pas d'OMA." -> ["Pas d'OMA.", "OMA."] ; sans inverse -> [texte, null]
  function paire(m) {
    if (Array.isArray(m)) return m;
    const reste = m.match(/^Pas d(?:e |')(.+)$/);
    return [m, reste ? reste[1][0].toUpperCase() + reste[1].slice(1) : null];
  }

  // Position d'un morceau entier dans le texte : il doit commencer une phrase,
  // sinon "OMA." serait trouvé à l'intérieur de "Pas d'OMA."
  function trouver(v, t) {
    for (let i = v.lastIndexOf(t); i >= 0; i = i ? v.lastIndexOf(t, i - 1) : -1) {
      const avantOk = /(^|[.!?:\n])\s*$/.test(v.slice(0, i));
      const apresOk = i + t.length === v.length || /\s/.test(v[i + t.length]);
      if (avantOk && apresOk) return i;
    }
    return -1;
  }

  const estPresent = (texte) => trouver(getCommentaire()?.value || '', texte) >= 0;

  // Remplace un morceau par un autre, à la même place dans le texte
  function remplacer(ancien, nouveau) {
    const champ = getCommentaire();
    const i = champ ? trouver(champ.value, ancien) : -1;
    if (i < 0) return;
    setValue(champ, champ.value.slice(0, i) + nouveau + champ.value.slice(i + ancien.length));
  }

  // Supprime chaque morceau, avec l'espace qui le séparait du reste
  function retirer(textes) {
    const champ = getCommentaire();
    if (!champ) return;
    let v = champ.value;
    for (const t of textes) {
      let debut = trouver(v, t);
      if (debut < 0) continue;
      let fin = debut + t.length;
      if (v[debut - 1] === ' ') debut--;
      else if (v[fin] === ' ') fin++;
      v = v.slice(0, debut) + v.slice(fin);
    }
    setValue(champ, v);
  }

  /* ===== Constantes aléatoires (pour ALL IN) =====
     shortcut: copie de la génération du script « Constantes aléatoires », à modifier dans les deux */
  const entier = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  function remplirConstantes() {
    const parPh = (ph) => [...document.querySelectorAll('input')].filter((i) => (i.placeholder || '').trim() === ph);
    const mmhg = parPh('mmHg');
    const champs = [mmhg[0], mmhg[1], parPh('bpm')[0], parPh('%')[0], parPh('°C')[0]];
    const pas = entier(100, 140);
    const valeurs = [pas, entier(80, Math.min(100, pas - 20)), entier(50, 90), entier(96, 100),
      (entier(360, 375) / 10).toFixed(1).replace('.', ',')];
    // ne remplace jamais une valeur déjà saisie (une vraie mesure reste intacte)
    champs.forEach((c, i) => { if (c && !c.value) setValue(c, String(valeurs[i])); });
  }

  // Morceaux d'un texte pas encore présents dans le Commentaire (un 2e appui n'écrit rien en double)
  const manquants = (texte) => decouper(texte).filter((m) => !estPresent(m)).join(' ');

  // Bouton de diagnostic de PAS (ex. « Rhino-pharyngite virale »).
  // Marqué une fois cliqué : un 2e ALL IN ne le désélectionne pas.
  function cliquerDiag(nom) {
    const el = texteExact(nom);
    if (!el) return false;
    if (!el.dataset.srClique) { el.dataset.srClique = '1'; el.click(); }
    return true;
  }

  // Remonte depuis un libellé jusqu'au premier bloc qui contient le sélecteur voulu
  function pres(libelle, selecteur) {
    let el = texteExact(libelle);
    while (el && !el.querySelector(selecteur)) el = el.parentElement;
    return el ? el.querySelector(selecteur) && el : null;
  }

  function radioHospitNon() {
    const bloc = pres('Hospitalisation', 'input[type=radio]');
    if (!bloc) return null;
    const radios = [...bloc.querySelectorAll('input[type=radio]')];
    return radios.find((r) => /^non$/i.test(r.value))
      || radios.find((r) => /\bNON\b/.test(r.closest('label')?.textContent || ''))
      || radios[1]; // ordre affiché : OUI puis NON
  }

  // Comme un toucher dans la case : PAS calcule alors le montant (TP = part AMO, CB = reste)
  function toucher(el) {
    el.focus();
    el.click();
  }

  // Hospitalisation NON, puis toucher TP, puis CB. fin(ok) : ok = false si un élément manque
  function facturer(fin) {
    const non = radioHospitNon();
    if (non && !non.checked) non.click();
    const tp = pres('TP', 'input')?.querySelector('input');
    const cb = pres('CB', 'input')?.querySelector('input');
    if (!tp || !cb) console.warn('[Examens β] introuvable :', !non ? 'Hospitalisation' : '', !tp ? 'TP' : '', !cb ? 'CB' : '');
    setTimeout(() => {
      if (tp) toucher(tp);
      setTimeout(() => {
        if (cb) { toucher(cb); cb.blur(); }
        fin(!!(non && tp && cb));
      }, 250);
    }, 250);
  }

  // Vert si tout a été trouvé, rouge sinon (détail dans la console F12)
  function resultat(b, ok) {
    const c = ok ? 'fait' : 'retire';
    b.classList.add(c);
    setTimeout(() => b.classList.remove(c), 900);
  }

  function executerMacro(m, b) {
    surOnglet('EXAM', () => {
      remplirConstantes();
      const ex = manquants(m.examen);
      if (ex) inserer(ex);
      const diagOk = !m.diag || cliquerDiag(m.diag);
      if (!diagOk) console.warn('[Examens β] diagnostic introuvable :', m.diag);
      surOnglet('CAT', () => {
        const cat = manquants(m.cat);
        if (cat) inserer(cat);
        facturer((ok) => resultat(b, ok && diagOk));
      });
    });
  }

  /* ===== Style : discret au repos, réponse immédiate au toucher ===== */
  const css = document.createElement('style');
  css.textContent = `
    #sr-beta { position: fixed; right: 10px; bottom: 170px; z-index: 99999; pointer-events: none;
      display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
      font: 14px/1.25 system-ui, sans-serif; }
    #sr-beta button { pointer-events: auto; touch-action: manipulation; -webkit-tap-highlight-color: transparent;
      border: none; border-radius: 999px; padding: 8px 12px; font: inherit; color: #1d2a3a;
      background: #eef1f6; cursor: pointer;
      transition: transform .1s ease, background-color .15s ease, color .15s ease; }
    #sr-beta button:active { transform: scale(.94); }
    #sr-beta .principal { width: 46px; height: 46px; padding: 0; font-size: 22px; color: #fff;
      background: rgba(122, 79, 214, .5); box-shadow: 0 1px 4px rgba(0,0,0,.2); }
    #sr-beta .principal.ouvert { background: #7a4fd6; }
    #sr-beta .tout { background: #dfe6f3; font-weight: 600; }
    #sr-beta .fait { background: #2e9e5b; color: #fff; }
    #sr-beta .inverse { background: #e08a1e; color: #fff; }
    #sr-beta .retire { background: #d64545; color: #fff; }
    #sr-beta .panneau { pointer-events: auto; display: flex; flex-wrap: wrap; gap: 6px;
      width: min(86vw, 420px); max-height: 48vh; overflow-y: auto; overscroll-behavior: contain;
      padding: 10px; border-radius: 14px; background: rgba(255,255,255,.97);
      box-shadow: 0 6px 20px rgba(0,0,0,.18); transform-origin: bottom right; will-change: transform, opacity;
      transition: opacity .14s ease, transform .14s ease, visibility 0s; }
    /* fermé : invisible ET intouchable, pour ne jamais gêner PAS */
    #sr-beta .panneau.cache { opacity: 0; transform: translateY(6px) scale(.98); visibility: hidden;
      transition: opacity .14s ease, transform .14s ease, visibility 0s .14s; }
    #sr-beta .panneau.cache, #sr-beta .panneau.cache button { pointer-events: none; }
    #sr-beta .nav { display: flex; gap: 4px; flex: 0 0 100%; overflow-x: auto; scrollbar-width: none;
      padding-bottom: 8px; border-bottom: 1px solid #e3e6eb; }
    #sr-beta .nav button { flex: 0 0 auto; font-size: 13px; padding: 6px 10px; background: transparent; color: #556; }
    #sr-beta .nav .courant { background: #7a4fd6; color: #fff; }
    #sr-beta .nav .macro { background: #fff1cc; color: #7a5200; }
    #sr-beta .nav .macro.fait { background: #2e9e5b; color: #fff; }
    #sr-beta .nav .macro.retire { background: #d64545; color: #fff; }
    #sr-beta .action { background: #fff1cc; color: #7a5200; flex-basis: 100%; }
  `;

  function bouton(texte, classe, action) {
    const b = document.createElement('button');
    b.textContent = texte;
    if (classe) b.className = classe;
    b.addEventListener('click', action);
    return b;
  }

  /* ===== Interface : un seul écran = barre des groupes + morceaux du groupe ouvert ===== */
  function creerInterface() {
    document.head.appendChild(css);
    const racine = document.createElement('div');
    racine.id = 'sr-beta';
    const panneau = document.createElement('div');
    panneau.className = 'panneau cache';
    let courant = EXAMENS[0]; // le panneau se rouvre sur le dernier groupe utilisé

    // Rouge un instant pour montrer la suppression, puis retour à la couleur normale
    function flashRouge(boutons) {
      boutons.forEach((b) => b.classList.add('retire'));
      setTimeout(() => boutons.forEach((b) => b.classList.remove('retire')), 600);
    }

    //   gris = pas écrit · vert = texte par défaut écrit · orange = inverse écrit
    function afficherExamen(ex) {
      courant = ex;
      const surOngletExam = (action) => surOnglet(ex.onglet || 'EXAM', action);
      const paires = (ex.morceaux || decouper(ex.texte)).map(paire);
      const etat = ([def, inv]) => (estPresent(def) ? 'fait' : inv && estPresent(inv) ? 'inverse' : '');

      const morceaux = paires.map((p) => {
        const [def, inv] = p;
        const b = bouton(def, '', () => surOngletExam(() => {
          const e = etat(p);
          if (e === 'fait' && inv) remplacer(def, inv);
          else if (e === 'fait') { retirer([def]); flashRouge([b]); }
          else if (e === 'inverse') { retirer([inv]); flashRouge([b]); }
          else inserer(def);
          rafraichir();
        }));
        return b;
      });

      // Tout : écrit le texte par défaut de tous les morceaux pas encore écrits ;
      // si tout est déjà écrit, efface tout
      const tout = bouton('Tout', 'tout', () => surOngletExam(() => {
        const vides = paires.filter((p) => !etat(p));
        if (vides.length) inserer(vides.map((p) => p[0]).join(' '));
        else { retirer(paires.flat().filter(Boolean)); flashRouge([tout, ...morceaux]); }
        rafraichir();
      }));

      // Couleur et libellé suivent le texte réellement présent dans le Commentaire
      function rafraichir() {
        paires.forEach((p, i) => {
          const e = etat(p);
          morceaux[i].classList.toggle('fait', e === 'fait');
          morceaux[i].classList.toggle('inverse', e === 'inverse');
          morceaux[i].textContent = (e === 'inverse' ? p[1] : p[0]) + (p[1] ? ' ⇄' : '');
        });
        tout.classList.toggle('fait', paires.every((p) => etat(p)));
      }

      // Barre défilante : ALL IN d'abord, puis les groupes
      const nav = document.createElement('div');
      nav.className = 'nav';
      nav.append(
        ...MACROS.map((m) => { const b = bouton(m.nom, 'macro', () => executerMacro(m, b)); return b; }),
        ...EXAMENS.map((g) => bouton(g.nom, g === ex ? 'courant' : '', () => afficherExamen(g))),
      );

      // Dans CAT : facturation en un appui
      const actions = ex.onglet === 'CAT'
        ? [bouton('💳 Hospit. NON + TP + CB', 'action', (e) => surOngletExam(() => facturer((ok) => resultat(e.target, ok))))]
        : [];

      panneau.replaceChildren(nav, ...actions, tout, ...morceaux);
      const actif = nav.querySelector('.courant');
      nav.scrollLeft = actif.offsetLeft - 40; // garde le groupe ouvert visible dans la barre
      surOngletExam(rafraichir); // les couleurs se lisent dans le Commentaire du bon onglet
    }

    function fermer() {
      panneau.classList.add('cache');
      principal.classList.remove('ouvert');
    }

    const principal = bouton('🩺', 'principal', () => {
      if (!panneau.classList.contains('cache')) return fermer();
      panneau.classList.remove('cache');
      principal.classList.add('ouvert');
      afficherExamen(courant);
    });
    principal.setAttribute('aria-label', 'Examens types');

    // Un toucher ailleurs ferme le panneau (et atteint PAS normalement) ;
    // les clics simulés par le script sur les onglets (isTrusted = false) sont ignorés
    document.addEventListener('pointerdown', (e) => {
      if (e.isTrusted && racine.isConnected && !racine.contains(e.target) && !panneau.classList.contains('cache')) fermer();
    }, true);

    racine.append(panneau, principal);
    document.body.appendChild(racine);
  }

  // Apparition dès que la page change, sans attendre une vérification à la seconde
  function ensureButton() {
    const present = !!getCommentaire();
    const ui = document.getElementById('sr-beta');
    if (present && !ui) creerInterface();
    else if (!present && ui) ui.remove();
  }
  // Une seule vérification par image affichée, pas à chaque petite modification de la page
  let prevu = false;
  const planifier = () => {
    if (prevu) return;
    prevu = true;
    requestAnimationFrame(() => { prevu = false; ensureButton(); });
  };
  new MutationObserver(planifier).observe(document.documentElement, { childList: true, subtree: true });
  ensureButton();
})();

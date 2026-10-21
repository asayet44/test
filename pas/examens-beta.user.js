// ==UserScript==
// @name         Examens types (bêta)
// @namespace    saisie-rapide-beta
// @version      2.0
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
  function surOnglet(nom, action) {
    const onglet = [...document.querySelectorAll('body *')].find(
      (el) => el.children.length === 0 && el.textContent.trim() === nom
    );
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

  /* ===== Style : animations douces et réponse immédiate au toucher ===== */
  const css = document.createElement('style');
  css.textContent = `
    #sr-beta { position: fixed; right: 12px; bottom: 170px; z-index: 99999;
      display: flex; flex-direction: column; align-items: flex-end; gap: 8px; font-family: sans-serif; }
    #sr-beta button { touch-action: manipulation; -webkit-tap-highlight-color: transparent;
      border: none; border-radius: 20px; padding: 10px 14px; font-size: 15px; color: #fff;
      background: #6b8fd6; box-shadow: 0 2px 6px rgba(0,0,0,.25); cursor: pointer;
      transition: transform .12s ease, background-color .2s ease, opacity .2s ease; }
    #sr-beta button:active { transform: scale(.93); }
    #sr-beta .principal { background: #7a4fd6; font-size: 16px; padding: 12px 16px; }
    #sr-beta .retour { background: #888; }
    #sr-beta .tout { background: #2e5fb8; }
    #sr-beta .fait { background: #2e9e5b; }
    #sr-beta .retire { background: #d64545; }
    #sr-beta .inverse { background: #e08a1e; }
    #sr-beta .nav { display: flex; flex-wrap: wrap; gap: 4px; flex-basis: 100%;
      padding-bottom: 6px; border-bottom: 1px solid #ccc; }
    #sr-beta .nav button { font-size: 13px; padding: 6px 10px; background: #888; box-shadow: none; }
    #sr-beta .nav .courant { background: #7a4fd6; }
    #sr-beta .panneau { display: flex; flex-wrap: wrap; gap: 6px; max-width: 80vw; max-height: 50vh;
      overflow-y: auto; padding: 8px; border-radius: 16px; background: rgba(255,255,255,.92);
      box-shadow: 0 4px 14px rgba(0,0,0,.25);
      transition: opacity .18s ease, transform .18s ease; transform-origin: bottom right; }
    #sr-beta .panneau.cache { opacity: 0; transform: translateY(8px) scale(.97); }
    /* La zone invisible autour des boutons laisse passer les touchers vers PAS */
    #sr-beta { pointer-events: none; }
    #sr-beta button, #sr-beta .panneau { pointer-events: auto; }
    #sr-beta .panneau.cache, #sr-beta .panneau.cache button { pointer-events: none; }
  `;

  function bouton(texte, classe, action) {
    const b = document.createElement('button');
    b.textContent = texte;
    if (classe) b.className = classe;
    b.addEventListener('click', action);
    return b;
  }

  /* ===== Interface ===== */
  function creerInterface() {
    document.head.appendChild(css);
    const racine = document.createElement('div');
    racine.id = 'sr-beta';
    const panneau = document.createElement('div');
    panneau.className = 'panneau cache';

    // Écran 1 : la liste des examens
    function afficherListe() {
      panneau.replaceChildren(...EXAMENS.map((ex) => bouton(ex.nom, '', () => afficherExamen(ex))));
    }

    // Rouge un instant pour montrer la suppression, puis retour à la couleur normale
    function flashRouge(boutons) {
      boutons.forEach((b) => b.classList.add('retire'));
      setTimeout(() => boutons.forEach((b) => b.classList.remove('retire')), 600);
    }

    // Écran 2 : les morceaux d'un examen.
    //   gris = pas écrit · vert = texte par défaut écrit · orange = inverse écrit
    function afficherExamen(ex) {
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

      // Barre des groupes : on passe d'un groupe à l'autre sans revenir en arrière
      const nav = document.createElement('div');
      nav.className = 'nav';
      nav.append(...EXAMENS.map((g) => bouton(g.nom, g === ex ? 'courant' : '', () => afficherExamen(g))));

      panneau.replaceChildren(nav, tout, ...morceaux);
      surOngletExam(rafraichir); // les couleurs se lisent dans le Commentaire du bon onglet
    }

    const principal = bouton('🧪 Examen β', 'principal', () => {
      if (panneau.classList.toggle('cache')) return;
      afficherListe(); // on repart toujours de la liste à l'ouverture
    });

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

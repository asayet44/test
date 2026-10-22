// ==UserScript==
// @name         Examens types (bêta)
// @namespace    saisie-rapide-beta
// @version      4.0
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

  let ongletCourant = 'EXAM'; // onglet affiché par PAS (suivi pour colorer le bon groupe)

  function surOnglet(nom, action) {
    ongletCourant = nom;
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

  // Texte propre à un élément (sans celui de ses enfants) : « NON » dans <td>NON <img></td>
  const texteDirect = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
  const parTexteDirect = (racine, t) => [...racine.querySelectorAll('*')].filter(
    (e) => texteDirect(e) === t && !e.closest('#sr-beta, .cssALPAllergieTD') // pas les modèles de courrier ni la biologie
  );

  // Tuile de mode de paiement de PAS (TP, CB…) : celle qui porte le onclick SelModePaiement
  function tuilePaiement(lib) {
    const s = [...document.querySelectorAll('.cssModePaiement')].find((e) => e.textContent.trim() === lib);
    return s ? s.closest('[onclick]') || s : null;
  }

  // Hospitalisation NON : on part des tuiles de paiement et on remonte jusqu'au bloc qui contient
  // exactement un « OUI » et un « NON » ; sinon on ne clique rien (mieux vaut rien que le mauvais bouton)
  function hospitNon() {
    for (let zone = tuilePaiement('CB'); zone; zone = zone.parentElement) {
      if (!/Hospitalisation/.test(zone.textContent)) continue;
      const non = parTexteDirect(zone, 'NON');
      const oui = parTexteDirect(zone, 'OUI');
      if (non.length === 1 && oui.length === 1) {
        const n = non[0];
        return n.querySelector('input[type=radio], img, [onclick]') || n;
      }
      return null;
    }
    return null;
  }

  const elementsFacturation = () => ({ non: hospitNon(), tp: tuilePaiement('TP'), cb: tuilePaiement('CB') });

  function appliquerFacturation({ non, tp, cb }, fin) {
    if (non && !non.checked) non.click();
    if (!(non && tp && cb)) console.warn('[Examens β] introuvable :', !non ? 'Hospitalisation' : '', !tp ? 'TP' : '', !cb ? 'CB' : '');
    // TP d'abord (part AMO), puis CB (le reste) : même ordre qu'à la main
    setTimeout(() => {
      if (tp) tp.click();
      setTimeout(() => {
        if (cb) cb.click();
        fin(!!(non && tp && cb));
      }, 250);
    }, 250);
  }

  // Cherche dans l'onglet affiché, puis dans CAT, EXAM, ATCD
  function facturer(fin) {
    const essayer = (onglets) => {
      const f = elementsFacturation();
      if ((f.non && f.tp && f.cb) || !onglets.length) return appliquerFacturation(f, fin);
      surOnglet(onglets[0], () => essayer(onglets.slice(1)));
    };
    essayer(['CAT', 'EXAM', 'ATCD']);
  }

  /* ===== Rapport de structure pour mise au point =====
     shortcut: outil temporaire, à retirer une fois la facturation fiable sur PAS */
  function decrire(el) {
    if (!el) return 'introuvable';
    const attrs = [...el.attributes].filter((a) => a.name !== 'value' && a.name !== 'style').map((a) => `${a.name}="${a.value.slice(0, 80)}"`);
    return `<${el.tagName.toLowerCase()} ${attrs.join(' ')}>`;
  }
  function chaine(el, n = 5) {
    const out = [];
    for (let e = el; e && n--; e = e.parentElement) out.push(decrire(e));
    return out.join(' ⟵ ');
  }
  // Copie anonymisée : seuls les libellés connus restent lisibles, tout autre texte devient « … »
  function anonymiser(el, max) {
    if (!el) return 'introuvable';
    const copie = el.cloneNode(true);
    copie.querySelectorAll('#sr-beta, script, style, svg').forEach((e) => e.remove());
    const garder = /^(Hospitalisation|OUI|NON|Comptabilité|Remise|NGAP|CCAM|LOCAL|TP|CB|ESP|CHQ|VIR|AMO|AMC|Total.*|\d+%)$/;
    const w = document.createTreeWalker(copie, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent.trim() && !garder.test(n.textContent.trim())) n.textContent = '…';
    copie.querySelectorAll('[value]').forEach((e) => e.removeAttribute('value'));
    return copie.outerHTML.replace(/\s+/g, ' ').slice(0, max);
  }
  function rapportOnglet(nom) {
    const hospi = parTexteDirect(document, 'Hospitalisation');
    const lignes = [`=== Onglet ${nom} ===`,
      `Trouvé par le script : ${JSON.stringify(Object.fromEntries(Object.entries(elementsFacturation()).map(([k, v]) => [k, decrire(v)])))}`,
      `Tuiles paiement : ${[...document.querySelectorAll('.cssModePaiement')].map((e) => `${e.textContent.trim()} → ${decrire(e.closest('[onclick]'))}`).join(' | ')}`,
      `onclick contenant "hosp" : ${[...document.querySelectorAll('[onclick]')].filter((e) => /hosp/i.test(e.getAttribute('onclick')) && !e.closest('.cssALPAllergieTD')).slice(0, 6).map(decrire).join(' | ') || 'aucun'}`,
      `"Hospitalisation" (${hospi.length}) :`];
    hospi.slice(0, 3).forEach((h) => lignes.push(`  ${chaine(h, 4)}`, `  HTML : ${anonymiser(h.parentElement?.parentElement, 2500)}`));
    ['OUI', 'NON'].forEach((t) => parTexteDirect(document, t).slice(0, 4).forEach((e) => lignes.push(`"${t}" : ${anonymiser(e.parentElement, 400)}`)));
    return lignes.join('\n');
  }
  function rapport() {
    const parties = [];
    const suite = (onglets) => {
      if (!onglets.length) return copier(parties.join('\n\n'));
      surOnglet(onglets[0], () => { parties.push(rapportOnglet(onglets[0])); suite(onglets.slice(1)); });
    };
    suite(['CAT']);
  }
  function copier(texte) {
    const manuel = () => prompt('Copie ce rapport et colle-le à Claude :', texte);
    if (!navigator.clipboard) return manuel();
    navigator.clipboard.writeText(texte)
      .then(() => alert('Rapport copié : colle-le dans la conversation avec Claude.'))
      .catch(manuel);
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
    #sr-beta .macro { background: #fff1cc; color: #7a5200; }
    #sr-beta .macro.fait { background: #2e9e5b; color: #fff; }
    #sr-beta .macro.retire { background: #d64545; color: #fff; }
    /* Grand écran : tableau fixe à gauche de PAS */
    #sr-beta.tableau { left: 16px; right: auto; top: 90px; bottom: auto; align-items: stretch; }
    #sr-beta .feuille { pointer-events: auto; background: rgba(255,255,255,.97); border-radius: 14px;
      box-shadow: 0 6px 20px rgba(0,0,0,.12); padding: 10px 12px; max-height: calc(100vh - 110px);
      overflow-y: auto; overscroll-behavior: contain; }
    #sr-beta .entete { display: flex; justify-content: space-between; align-items: center; font-weight: 600; color: #7a4fd6; }
    #sr-beta .entete button { padding: 2px 10px; background: transparent; color: #556; font-size: 18px; }
    #sr-beta .macros { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 12px; }
    #sr-beta .grille { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
    #sr-beta .groupe h4 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #7a4fd6; }
    #sr-beta .groupe.cat h4 { color: #b26b00; }
    #sr-beta .groupe .boutons { display: flex; flex-wrap: wrap; gap: 5px; }
    #sr-beta .groupe button { padding: 6px 10px; font-size: 13px; }
    #sr-beta.replie .macros, #sr-beta.replie .grille { display: none; }
    #sr-beta .action { background: #fff1cc; color: #7a5200; flex-basis: 100%; }
  `;

  function bouton(texte, classe, action) {
    const b = document.createElement('button');
    b.textContent = texte;
    if (classe) b.className = classe;
    b.addEventListener('click', action);
    return b;
  }

  // Rouge un instant pour montrer la suppression, puis retour à la couleur normale
  function flashRouge(boutons) {
    boutons.forEach((b) => b.classList.add('retire'));
    setTimeout(() => boutons.forEach((b) => b.classList.remove('retire')), 600);
  }

  // Recolore ce qui est affiché après chaque action (un groupe dans la bulle, tout l'onglet dans le tableau)
  let rafraichirVisible = () => {};

  /* ===== Un groupe : bouton Tout + un bouton par morceau (+ actions de facturation pour CAT)
     gris = pas écrit · vert = texte par défaut écrit · orange = inverse écrit ===== */
  function construireGroupe(ex) {
    const onglet = ex.onglet || 'EXAM';
    const surLeBonOnglet = (action) => surOnglet(onglet, action);
    const paires = (ex.morceaux || decouper(ex.texte)).map(paire);
    const etat = ([def, inv]) => (estPresent(def) ? 'fait' : inv && estPresent(inv) ? 'inverse' : '');

    const morceaux = paires.map((p) => {
      const [def, inv] = p;
      const b = bouton(def, '', () => surLeBonOnglet(() => {
        const e = etat(p);
        if (e === 'fait' && inv) remplacer(def, inv);
        else if (e === 'fait') { retirer([def]); flashRouge([b]); }
        else if (e === 'inverse') { retirer([inv]); flashRouge([b]); }
        else inserer(def);
        rafraichirVisible();
      }));
      return b;
    });

    // Tout : écrit le texte par défaut des morceaux pas encore écrits ; si tout est écrit, efface tout
    const tout = bouton('Tout', 'tout', () => surLeBonOnglet(() => {
      const vides = paires.filter((p) => !etat(p));
      if (vides.length) inserer(vides.map((p) => p[0]).join(' '));
      else { retirer(paires.flat().filter(Boolean)); flashRouge([tout, ...morceaux]); }
      rafraichirVisible();
    }));

    function rafraichir() {
      paires.forEach((p, i) => {
        const e = etat(p);
        morceaux[i].classList.toggle('fait', e === 'fait');
        morceaux[i].classList.toggle('inverse', e === 'inverse');
        morceaux[i].textContent = (e === 'inverse' ? p[1] : p[0]) + (p[1] ? ' ⇄' : '');
      });
      tout.classList.toggle('fait', paires.every((p) => etat(p)));
    }

    const actions = onglet === 'CAT'
      ? [bouton('💳 Hospit. NON + TP + CB', 'action', (e) => surLeBonOnglet(() => facturer((ok) => resultat(e.target, ok)))),
        bouton('🔍 Rapport de mise au point', 'action', rapport)]
      : [];

    return { ex, onglet, rafraichir, elements: [...actions, tout, ...morceaux] };
  }

  const boutonsMacros = () => MACROS.map((m) => { const b = bouton(m.nom, 'macro', () => executerMacro(m, b)); return b; });

  /* ===== Petit écran (téléphone) : bulle 🩺 + panneau d'un groupe à la fois ===== */
  function creerBulle() {
    document.head.appendChild(css);
    const racine = document.createElement('div');
    racine.id = 'sr-beta';
    racine.dataset.mode = 'bulle';
    const panneau = document.createElement('div');
    panneau.className = 'panneau cache';
    let courant = EXAMENS[0]; // le panneau se rouvre sur le dernier groupe utilisé

    function afficherExamen(ex) {
      courant = ex;
      const g = construireGroupe(ex);
      rafraichirVisible = g.rafraichir;

      // Barre défilante : ALL IN d'abord, puis les groupes
      const nav = document.createElement('div');
      nav.className = 'nav';
      nav.append(...boutonsMacros(), ...EXAMENS.map((x) => bouton(x.nom, x === ex ? 'courant' : '', () => afficherExamen(x))));

      panneau.replaceChildren(nav, ...g.elements);
      nav.scrollLeft = nav.querySelector('.courant').offsetLeft - 40; // groupe ouvert visible dans la barre
      surOnglet(g.onglet, g.rafraichir); // les couleurs se lisent dans le Commentaire du bon onglet
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

  /* ===== Grand écran (Mac) : tableau fixe à gauche de PAS avec tous les groupes ===== */
  let replie = false;
  function creerTableau(largeur) {
    document.head.appendChild(css);
    const racine = document.createElement('div');
    racine.id = 'sr-beta';
    racine.dataset.mode = 'tableau';
    racine.className = 'tableau' + (replie ? ' replie' : '');
    racine.style.width = largeur + 'px';

    const groupes = EXAMENS.map(construireGroupe);
    // Le Commentaire affiché est celui d'un seul onglet : on ne recolore que les groupes de cet onglet,
    // les autres gardent leur dernière couleur connue
    rafraichirVisible = () => groupes.filter((g) => g.onglet === ongletCourant).forEach((g) => g.rafraichir());

    const plier = bouton(replie ? '+' : '–', '', () => {
      replie = racine.classList.toggle('replie');
      plier.textContent = replie ? '+' : '–';
    });
    plier.setAttribute('aria-label', 'Replier le tableau');
    const entete = document.createElement('div');
    entete.className = 'entete';
    entete.append('🩺 Examens types', plier);

    const macros = document.createElement('div');
    macros.className = 'macros';
    macros.append(...boutonsMacros());

    const grille = document.createElement('div');
    grille.className = 'grille';
    groupes.forEach((g) => {
      const bloc = document.createElement('div');
      bloc.className = 'groupe' + (g.onglet === 'CAT' ? ' cat' : '');
      const titre = document.createElement('h4');
      titre.textContent = g.ex.nom + (g.onglet === 'CAT' ? ' (onglet CAT)' : '');
      const boutons = document.createElement('div');
      boutons.className = 'boutons';
      boutons.append(...g.elements);
      bloc.append(titre, boutons);
      grille.appendChild(bloc);
    });

    const feuille = document.createElement('div');
    feuille.className = 'feuille';
    feuille.append(entete, macros, grille);
    racine.appendChild(feuille);
    document.body.appendChild(racine);
    rafraichirVisible();
  }

  // Clic à la main sur un onglet de PAS, ou frappe dans le Commentaire : on recolore
  let attente;
  const recolorerBientot = () => { clearTimeout(attente); attente = setTimeout(() => rafraichirVisible(), 250); };
  document.addEventListener('click', (e) => {
    if (!e.isTrusted || e.target.closest?.('#sr-beta')) return;
    const t = e.target.textContent?.trim();
    if (['ATCD', 'EXAM', 'CAT'].includes(t) && !e.target.children.length) { ongletCourant = t; recolorerBientot(); }
  }, true);
  document.addEventListener('input', (e) => { if (e.target === getCommentaire()) recolorerBientot(); }, true);

  // Tableau si la place à gauche de PAS suffit, sinon bulle
  function modeVoulu() {
    const c = getCommentaire();
    const place = (c ? c.getBoundingClientRect().left : 0) - 32;
    return place >= 300 ? { mode: 'tableau', largeur: Math.min(place, 900) } : { mode: 'bulle' };
  }

  // Apparition dès que la page change, sans attendre une vérification à la seconde
  function ensureButton() {
    const present = !!getCommentaire();
    const ui = document.getElementById('sr-beta');
    if (!present) { if (ui) ui.remove(); return; }
    if (ui) return;
    const m = modeVoulu();
    if (m.mode === 'tableau') creerTableau(m.largeur);
    else creerBulle();
  }
  // Une seule vérification par image affichée, pas à chaque petite modification de la page
  let prevu = false;
  const planifier = () => {
    if (prevu) return;
    prevu = true;
    requestAnimationFrame(() => { prevu = false; ensureButton(); });
  };
  new MutationObserver(planifier).observe(document.documentElement, { childList: true, subtree: true });
  // Fenêtre redimensionnée : on reconstruit (tableau ↔ bulle, nouvelle largeur)
  let redim;
  window.addEventListener('resize', () => {
    clearTimeout(redim);
    redim = setTimeout(() => { document.getElementById('sr-beta')?.remove(); planifier(); }, 200);
  });
  ensureButton();
})();

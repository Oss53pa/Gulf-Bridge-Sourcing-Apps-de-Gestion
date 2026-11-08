// Lecture des relevés bancaires dans le navigateur : ISO 20022 camt.053, SWIFT MT940, tableur.
// Le résultat n'est qu'une proposition : la base revalide chaque ligne, l'équilibre du relevé
// et refuse les doublons. Les montants sont calculés en centimes pour éviter les arrondis.

export interface LigneReleve { date_operation: string; date_valeur: string | null; montant: number; libelle: string; reference: string | null; contrepartie: string | null }
export interface Releve { format: 'camt053' | 'mt940' | 'tableur'; compte: string | null; devise: string | null; debut: string; fin: string;
  ouverture: number; cloture: number; lignes: LigneReleve[] }

export class ReleveIllisible extends Error {}
const illisible = (motif: string): never => { throw new ReleveIllisible(motif); };

const MAX_LIGNES = 5000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** « 1 234,56 », « 1234.56 », « -12 » → centimes ; refuse tout le reste. */
export function centimes(texte: string): number {
  const t = texte.replace(/[\s\u00a0\u202f']/g, '');
  const m = /^([+-]?)(\d{1,13})(?:[.,](\d{0,2}))?$/.exec(t);
  if (!m) illisible(`montant « ${texte.slice(0, 30)} »`);
  const c = Number(m![2]) * 100 + Number((m![3] ?? '').padEnd(2, '0'));
  return m![1] === '-' ? -c : c;
}
const montant = (c: number) => c / 100;
const propre = (s: string | null | undefined, max: number) => {
  const v = (s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, max) : null;
};

function verifier(r: Releve): Releve {
  if (r.lignes.length > MAX_LIGNES) illisible('plus de 5 000 opérations');
  if (!DATE.test(r.debut) || !DATE.test(r.fin) || r.fin < r.debut) illisible('période');
  for (const l of r.lignes) {
    if (!DATE.test(l.date_operation) || l.montant === 0 || !l.libelle) illisible('opération incomplète');
  }
  const somme = r.lignes.reduce((s, l) => s + Math.round(l.montant * 100), 0);
  if (Math.round(r.ouverture * 100) + somme !== Math.round(r.cloture * 100)) illisible('relevé déséquilibré');
  return r;
}

// ----------------------------------------------------------------- camt.053
const enfants = (n: Element, nom: string) => Array.from(n.children).filter((e) => e.localName === nom);
const enfant = (n: Element | null | undefined, ...chemin: string[]): Element | null => {
  let c: Element | null = n ?? null;
  for (const nom of chemin) { c = c ? enfants(c, nom)[0] ?? null : null; }
  return c;
};
const texte = (n: Element | null | undefined, ...chemin: string[]) => enfant(n, ...chemin)?.textContent?.trim() ?? null;
const jour = (n: Element | null) => {
  const v = texte(n, 'Dt') ?? texte(n, 'DtTm')?.slice(0, 10) ?? null;
  return v && DATE.test(v) ? v : null;
};
const signe = (n: Element) => (texte(n, 'CdtDbtInd') === 'DBIT' ? -1 : 1);

export function lireCamt053(xml: string): Releve {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) illisible('déclaration de type interdite');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) illisible('XML invalide');
  const stmts = Array.from(doc.getElementsByTagNameNS('*', 'Stmt'));
  if (stmts.length !== 1) illisible('un seul relevé par fichier est attendu');
  const st = stmts[0];
  const compte = texte(st, 'Acct', 'Id', 'IBAN') ?? texte(st, 'Acct', 'Id', 'Othr', 'Id');
  let devise = texte(st, 'Acct', 'Ccy');
  let ouverture: number | null = null; let cloture: number | null = null; const datesSoldes: string[] = [];
  for (const b of enfants(st, 'Bal')) {
    const code = texte(b, 'Tp', 'CdOrPrtry', 'Cd');
    const amt = enfant(b, 'Amt');
    if (!amt || !code) continue;
    const v = montant(signe(b) * centimes(amt.textContent ?? ''));
    devise = devise ?? amt.getAttribute('Ccy');
    if (code === 'OPBD' || code === 'PRCD') ouverture = v;
    if (code === 'CLBD') { cloture = v; }
    const d = jour(enfant(b, 'Dt')); if (d) datesSoldes.push(d);
  }
  if (ouverture === null || cloture === null) illisible('soldes d’ouverture et de clôture absents');
  const lignes: LigneReleve[] = [];
  for (const n of enfants(st, 'Ntry')) {
    const sts = texte(n, 'Sts') ?? texte(n, 'Sts', 'Cd');
    if (sts && sts !== 'BOOK') continue;   // seules les opérations comptabilisées comptent
    const amt = enfant(n, 'Amt');
    const ccy = amt?.getAttribute('Ccy');
    if (ccy && devise && ccy !== devise) illisible('opération dans une autre devise');
    const tx = enfant(n, 'NtryDtls', 'TxDtls');
    const nom = texte(tx, 'RltdPties', signe(n) > 0 ? 'Dbtr' : 'Cdtr', 'Nm') ?? texte(tx, 'RltdPties', signe(n) > 0 ? 'Dbtr' : 'Cdtr', 'Pty', 'Nm');
    const libelle = [texte(tx, 'RmtInf', 'Ustrd'), texte(n, 'AddtlNtryInf'), texte(tx, 'Refs', 'EndToEndId')].filter(Boolean).join(' · ');
    lignes.push({
      date_operation: jour(enfant(n, 'BookgDt')) ?? illisible('date d’opération'),
      date_valeur: jour(enfant(n, 'ValDt')),
      montant: montant(signe(n) * centimes(amt?.textContent ?? '')),
      libelle: propre(libelle || nom || 'Opération', 500)!,
      reference: propre(texte(n, 'AcctSvcrRef') ?? texte(tx, 'Refs', 'AcctSvcrRef'), 80),
      contrepartie: propre(nom, 200),
    });
  }
  const debut = texte(st, 'FrToDt', 'FrDtTm')?.slice(0, 10) ?? [...lignes.map((l) => l.date_operation), ...datesSoldes].sort()[0];
  const fin = texte(st, 'FrToDt', 'ToDtTm')?.slice(0, 10) ?? [...lignes.map((l) => l.date_operation), ...datesSoldes].sort().at(-1);
  return verifier({ format: 'camt053', compte: compte?.replace(/\s/g, '').toUpperCase() ?? null, devise, debut: debut ?? '', fin: fin ?? '',
    ouverture: ouverture!, cloture: cloture!, lignes });
}

// ----------------------------------------------------------------- MT940
const date6 = (s: string) => {
  const a = Number(s.slice(0, 2));
  return `${a >= 80 ? 1900 + a : 2000 + a}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
};
function solde(v: string) {
  const m = /^([CD])(\d{6})([A-Z]{3})([\d,]+)$/.exec(v.trim());
  if (!m) illisible('solde MT940');
  return { date: date6(m![2]), devise: m![3], montant: montant((m![1] === 'D' ? -1 : 1) * centimes(m![4])) };
}

export function lireMt940(brut: string): Releve {
  const txt = brut.replace(/\r\n?/g, '\n');
  const champs: { tag: string; val: string }[] = [];
  for (const ligne of txt.split('\n')) {
    const m = /^:(\d{2}[A-Z]?):(.*)$/.exec(ligne);
    if (m) champs.push({ tag: m[1], val: m[2] });
    else if (champs.length && ligne.trim() && !/^-\}?$|^\{/.test(ligne.trim())) champs[champs.length - 1].val += '\n' + ligne;
  }
  if (!champs.length) illisible('aucun champ MT940');
  let compte: string | null = null; let ouverture: ReturnType<typeof solde> | null = null; let cloture: ReturnType<typeof solde> | null = null;
  const lignes: LigneReleve[] = [];
  for (const c of champs) {
    if (c.tag === '25') compte = compte ?? c.val.split('\n')[0].replace(/\s/g, '').replace(/^.*\//, '').toUpperCase();
    else if (c.tag === '60F') ouverture = ouverture ?? solde(c.val);
    else if (c.tag === '62F') cloture = solde(c.val);
    else if (c.tag === '61') {
      const [tete, ...suite] = c.val.split('\n');
      const m = /^(\d{6})(\d{4})?(R?[CD])([A-Z])?([\d,]+)([A-Z][A-Z0-9]{3})([^/]*?)(?:\/\/(.*))?$/.exec(tete.trim());
      if (!m) illisible('opération MT940');
      const valeur = date6(m![1]);
      const op = m![2] ? `${valeur.slice(0, 4)}-${m![2].slice(0, 2)}-${m![2].slice(2, 4)}` : valeur;
      const debit = m![3] === 'D' || m![3] === 'RC';
      lignes.push({ date_operation: op, date_valeur: valeur, montant: montant((debit ? -1 : 1) * centimes(m![5])),
        libelle: propre(suite.join(' ') || m![7], 500) ?? 'Opération', reference: propre(m![8] ?? (m![7] !== 'NONREF' ? m![7] : null), 80), contrepartie: null });
    } else if (c.tag === '86' && lignes.length) {
      const l = lignes[lignes.length - 1];
      l.libelle = propre(c.val.replace(/\?\d{2}/g, ' '), 500) ?? l.libelle;
    }
  }
  if (!ouverture || !cloture) illisible('soldes :60F: et :62F: absents');
  const dates = lignes.map((l) => l.date_operation).sort();
  return verifier({ format: 'mt940', compte, devise: ouverture!.devise, debut: [ouverture!.date, ...dates].sort()[0], fin: [cloture!.date, ...dates].sort().at(-1)!,
    ouverture: ouverture!.montant, cloture: cloture!.montant, lignes });
}

// ----------------------------------------------------------------- Tableur (CSV)
function cellules(ligne: string, sep: string): string[] {
  const r: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < ligne.length; i++) {
    const ch = ligne[i];
    if (q) { if (ch === '"' && ligne[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === sep) { r.push(cur); cur = ''; } else cur += ch;
  }
  r.push(cur);
  return r.map((x) => x.trim());
}
const dateTableur = (s: string) => {
  if (DATE.test(s)) return s;
  const m = /^(\d{2})[/.-](\d{2})[/.-](\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : illisible(`date « ${s.slice(0, 20)} »`);
};

/** Colonnes attendues (en-tête) : date, libelle, montant, reference (facultative) ; soldes saisis à l'écran. */
export function lireTableur(brut: string, ouverture: number, cloture: number): Releve {
  const lignesTxt = brut.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  if (lignesTxt.length < 2) illisible('tableur vide');
  const sep = (lignesTxt[0].match(/;/g)?.length ?? 0) >= (lignesTxt[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const tete = cellules(lignesTxt[0], sep).map((h) => h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  const col = (n: string) => tete.indexOf(n);
  if (col('date') < 0 || col('libelle') < 0 || col('montant') < 0) illisible('colonnes date, libelle et montant attendues');
  const lignes = lignesTxt.slice(1).map((l) => {
    const c = cellules(l, sep);
    return { date_operation: dateTableur(c[col('date')] ?? ''), date_valeur: null, montant: montant(centimes(c[col('montant')] ?? '')),
      libelle: propre(c[col('libelle')], 500) ?? illisible('libellé vide'), reference: col('reference') >= 0 ? propre(c[col('reference')], 80) : null, contrepartie: null };
  });
  const dates = lignes.map((l) => l.date_operation).sort();
  return verifier({ format: 'tableur', compte: null, devise: null, debut: dates[0], fin: dates.at(-1)!, ouverture, cloture, lignes });
}

/** Détecte le format d'après le contenu (et non l'extension du fichier). */
export function formatReleve(contenu: string): Releve['format'] {
  const t = contenu.replace(/^\ufeff/, '').trimStart();
  if (t.startsWith('<')) return 'camt053';
  if (/^(\{1:|:20:)/m.test(t) && /:60F:/.test(t)) return 'mt940';
  return 'tableur';
}

// Fournisseurs : bénéficiaires effectifs et contrôle des sanctions à chaque revue annuelle (migration 77).
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, expectError, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

const auj = () => new Date().toISOString().slice(0, 10);
const jj = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const CONTROLE = { listes: ['onu', 'ue', 'ofac'], source: 'Listes consolidées', resultat: 'aucune_correspondance' };

async function candidat(db: Db, m: Monde) {
  await as(db, m.achats);
  const f = (await one(db, `insert into gbs.fournisseurs (raison_sociale_en, raison_sociale_zh, uscc, engagement_non_commission_le, categories)
    values ('Qingdao Polar', '青岛极地', '91370200MA3XXXXX2Y', current_date - 10, '{Froid}') returning id`)).id as string;
  const dd = (await one(db, `insert into gbs.due_diligences (fournisseur_id, grille, realisee_le)
    values ($1, '[{"critere":"Existence légale","poids":100,"note":4}]', current_date) returning id`, [f])).id as string;
  return { f, dd };
}
const controler = (db: Db, f: string, p: Record<string, unknown>) => one(db, `select gbs.enregistrer_controle_sanctions($1, $2) id`, [f, p]).then((x) => x.id as string);

describe('Sanctions et bénéficiaires effectifs des fournisseurs', () => {
  it('validation d’une due diligence refusée sans bénéficiaire ni contrôle récent', () => withTx(async (db) => {
    const m = await monde(db);
    const { f, dd } = await candidat(db, m);
    await as(db, m.admin);
    await expectError(db, 'GBS_BENEFICIAIRES_REQUIS', `select gbs.valider_due_diligence($1, 'validee')`, [dd]);
    await as(db, m.achats);
    await expectError(db, 'GBS_BENEFICIAIRES_REQUIS', `select gbs.enregistrer_controle_sanctions($1, $2)`, [f, { ...CONTROLE, realise_le: auj() }]);
    await db.query(`insert into gbs.beneficiaires_fournisseurs (fournisseur_id, nom, nom_zh, nationalite, pourcentage) values ($1, 'Wang Jianguo', '王建国', 'CN', 55)`, [f]);
    await as(db, m.admin);
    await expectError(db, 'GBS_SANCTIONS_REQUISES', `select gbs.valider_due_diligence($1, 'validee')`, [dd]);
    await as(db, m.achats);
    await controler(db, f, { ...CONTROLE, realise_le: jj(-40) });  // trop ancien
    await as(db, m.admin);
    await expectError(db, 'GBS_SANCTIONS_REQUISES', `select gbs.valider_due_diligence($1, 'validee')`, [dd]);
    await as(db, m.achats);
    const c = await controler(db, f, { ...CONTROLE, realise_le: auj() });
    expect(await rows(db, `select statut from gbs.controles_sanctions where fournisseur_id = $1 order by cree_le`, [f])).toEqual([{ statut: 'perime' }, { statut: 'valide' }]);
    expect((await one(db, `select beneficiaires from gbs.controles_sanctions where id = $1`, [c])).beneficiaires)
      .toEqual([{ nom: 'Wang Jianguo', nom_zh: '王建国', nationalite: 'CN', pourcentage: 55 }]);
    await as(db, m.admin);
    await db.query(`select gbs.valider_due_diligence($1, 'validee')`, [dd]);
    // Un refus reste possible sans contrôle.
    expect((await one(db, `select statut from gbs.due_diligences where id = $1`, [dd])).statut).toBe('validee');
  }));

  it('un changement d’actionnariat périme le contrôle ; parts limitées à 100 %', () => withTx(async (db) => {
    const m = await monde(db);
    const { f, dd } = await candidat(db, m);
    await as(db, m.achats);
    const b = (await one(db, `insert into gbs.beneficiaires_fournisseurs (fournisseur_id, nom, pourcentage) values ($1, 'Liu Hai', 60) returning id`, [f])).id;
    await controler(db, f, { ...CONTROLE, realise_le: auj() });
    await expectError(db, 'GBS_BENEFICIAIRES_DEPASSENT_100', `insert into gbs.beneficiaires_fournisseurs (fournisseur_id, nom, pourcentage) values ($1, 'Autre', 50)`, [f]);
    await db.query(`update gbs.beneficiaires_fournisseurs set pourcentage = 80 where id = $1`, [b]);
    expect((await one(db, `select statut from gbs.controles_sanctions where fournisseur_id = $1`, [f])).statut).toBe('perime');
    await as(db, m.admin);
    await expectError(db, 'GBS_SANCTIONS_REQUISES', `select gbs.valider_due_diligence($1, 'validee')`, [dd]);
    await expectError(db, '42501', `delete from gbs.beneficiaires_fournisseurs where id = $1`, [b]);
  }));

  it('correspondance confirmée : agrément suspendu et journalisé ; écartée : justification exigée', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.achats);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.enregistrer_controle_sanctions($1, $2)`,
      [m.fournisseur, { ...CONTROLE, realise_le: auj(), resultat: 'correspondance_ecartee' }]);
    await controler(db, m.fournisseur, { ...CONTROLE, realise_le: auj(), resultat: 'correspondance_ecartee', justification: 'Homonyme : date de naissance différente' });
    expect((await one(db, `select statut_agrement from gbs.fournisseurs where id = $1`, [m.fournisseur])).statut_agrement).toBe('agree');
    await controler(db, m.fournisseur, { ...CONTROLE, realise_le: auj(), resultat: 'correspondance_confirmee', justification: 'Actionnaire inscrit sur la liste OFAC' });
    expect((await one(db, `select statut_agrement from gbs.fournisseurs where id = $1`, [m.fournisseur])).statut_agrement).toBe('suspendu');
    await as(db, m.admin);
    expect((await one(db, `select count(*)::int n from gbs.journal_audit where action = 'fournisseur_suspendu_sanctions'`)).n).toBe(1);
  }));

  it('validation stricte, écriture directe interdite, droits réservés aux achats', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.achats);
    for (const p of [{ ...CONTROLE, realise_le: jj(1) }, { ...CONTROLE, realise_le: auj(), listes: ['interpol'] }, { ...CONTROLE, realise_le: auj(), listes: [] },
      { ...CONTROLE, realise_le: auj(), listes: ['onu', 'onu'] }, { ...CONTROLE, realise_le: auj(), x: 1 }, { ...CONTROLE, realise_le: auj(), preuve: '../x' },
      { ...CONTROLE, realise_le: 'hier' }]) {
      await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.enregistrer_controle_sanctions($1, $2)`, [m.fournisseur, p]);
    }
    await expectError(db, '42501', `insert into gbs.controles_sanctions (fournisseur_id, realise_le, listes, source, beneficiaires, resultat, realise_par)
      values ($1, current_date, '{onu}', 'x', '[]', 'aucune_correspondance', $2)`, [m.fournisseur, m.achats]);
    for (const u of [m.hub, m.agentGA, m.inspecteur]) {
      await as(db, u);
      await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.enregistrer_controle_sanctions($1, $2)`, [m.fournisseur, { ...CONTROLE, realise_le: auj() }]);
      expect(await rows(db, `select id from gbs.beneficiaires_fournisseurs`)).toEqual([]);
    }
    await asRoot(db);
  }));
});

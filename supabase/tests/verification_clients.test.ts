// Lot 1, M2 : vérification des clients (cinq contrôles, bénéficiaires effectifs, annuelle).
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, expectError, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

const controle = (resultat = 'conforme') => ({ resultat, source: 'Registre RCCM / liste ONU', verifie_le: '2026-11-02' });
const tousConformes = () => ({ identite: controle(), immatriculation: controle(), beneficiaires_effectifs: controle(),
  solvabilite: controle(), sanctions: controle() });

async function preparer(db: Db, m: Monde, controles: object = tousConformes(), avecBeneficiaire = true) {
  await as(db, m.agentGA);
  if (avecBeneficiaire) {
    await db.query(`insert into gbs.beneficiaires_effectifs (client_id, nom, nationalite, pourcentage, fonction)
      values ($1, 'Associé principal', 'GA', 60, 'Gérant')`, [m.clientGA]);
  }
  const v = (await one(db, `insert into gbs.verifications_clients (client_id, controles) values ($1, $2) returning id`,
    [m.clientGA, JSON.stringify(controles)])).id as string;
  return v;
}
const statutClient = async (db: Db, c: string) => {
  await asRoot(db);
  return (await one(db, `select verification_statut s from gbs.clients where id = $1`, [c])).s;
};

describe('Vérification des clients (M2)', () => {
  it('cinq contrôles conformes et un bénéficiaire : validée par l’administratrice, jamais posée à la main', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.admin);
    await expectError(db, 'GBS_VALIDATION_RPC', `update gbs.clients set verification_statut = 'verifie' where id = $1`, [m.clientGA]);
    const v = await preparer(db, m);
    expect(await statutClient(db, m.clientGA)).toBe('en_cours');
    await as(db, m.hub);
    await expectError(db, 'GBS_VALIDATION_ADMIN', `select gbs.statuer_verification_client($1, 'validee')`, [v]);
    await as(db, m.admin);
    const r = await one(db, `select statut, valide_jusqu_au::text j from gbs.statuer_verification_client($1, 'validee')`, [v]);
    expect(r.statut).toBe('validee');
    expect(r.j).toMatch(/^2027-/);
    expect(await statutClient(db, m.clientGA)).toBe('verifie');
    // Le dossier en négoce s'ouvre désormais.
    await as(db, m.admin);
    await db.query(`insert into gbs.dossiers (intitule, societe_id, client_id, modele) values ('Négoce GA', $1, $2, 'negoce')`, [m.cn, m.clientGA]);
  }));

  it('contrôle non conforme ou bénéficiaires manquants : pas de validation ; refus motivé', () => withTx(async (db) => {
    const m = await monde(db);
    const v = await preparer(db, m, { ...tousConformes(), sanctions: controle('non_conforme') });
    await as(db, m.admin);
    await expectError(db, 'GBS_CONTROLE_NON_CONFORME: sanctions', `select gbs.statuer_verification_client($1, 'validee')`, [v]);
    await expectError(db, 'GBS_MOTIF_OBLIGATOIRE', `select gbs.statuer_verification_client($1, 'refusee', '')`, [v]);
    await db.query(`select gbs.statuer_verification_client($1, 'refusee', 'Société dirigée par une personne sanctionnée')`, [v]);
    expect(await statutClient(db, m.clientGA)).toBe('refuse');
  }));

  it('sans bénéficiaire effectif enregistré, pas de validation', () => withTx(async (db) => {
    const m = await monde(db);
    const v = await preparer(db, m, tousConformes(), false);
    await as(db, m.admin);
    await expectError(db, 'GBS_BENEFICIAIRES_MANQUANTS', `select gbs.statuer_verification_client($1, 'validee')`, [v]);
  }));

  it('un changement d’actionnaire périme la vérification ; l’auteur ne statue pas', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.admin);
    await db.query(`insert into gbs.beneficiaires_effectifs (client_id, nom, nationalite, pourcentage) values ($1, 'Associé', 'GA', 60)`, [m.clientGA]);
    const v = (await one(db, `insert into gbs.verifications_clients (client_id, controles) values ($1, $2) returning id`,
      [m.clientGA, JSON.stringify(tousConformes())])).id;
    await expectError(db, 'GBS_QUATRE_YEUX', `select gbs.statuer_verification_client($1, 'validee')`, [v]);
    const v2 = await (async () => {
      await asRoot(db);
      await db.query(`update gbs.verifications_clients set statut = 'perimee' where id = $1`, [v]);
      return preparer(db, m, tousConformes(), false);
    })();
    await as(db, m.admin);
    await db.query(`select gbs.statuer_verification_client($1, 'validee')`, [v2]);
    expect(await statutClient(db, m.clientGA)).toBe('verifie');
    // Modifier la fonction d'un associé ne change rien ; un nouvel associé périme la vérification.
    await as(db, m.agentGA);
    await db.query(`update gbs.beneficiaires_effectifs set fonction = 'Président' where client_id = $1`, [m.clientGA]);
    expect(await statutClient(db, m.clientGA)).toBe('verifie');
    await as(db, m.agentGA);
    await db.query(`insert into gbs.beneficiaires_effectifs (client_id, nom, pourcentage) values ($1, 'Nouvel associé', 30)`, [m.clientGA]);
    expect(await statutClient(db, m.clientGA)).toBe('non_verifie');
    await asRoot(db);
    expect((await one(db, `select statut from gbs.verifications_clients where id = $1`, [v2])).statut).toBe('perimee');
  }));

  it('saisie contrôlée : clés inconnues, dates futures, parts au-delà de 100 % refusées ; données cloisonnées', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.agentGA);
    await expectError(db, 'GBS_CONTROLES_INVALIDES', `insert into gbs.verifications_clients (client_id, controles) values ($1, $2)`,
      [m.clientGA, JSON.stringify({ casier: controle() })]);
    await expectError(db, 'GBS_CONTROLES_INVALIDES', `insert into gbs.verifications_clients (client_id, controles) values ($1, $2)`,
      [m.clientGA, JSON.stringify({ identite: { ...controle(), verifie_le: '2099-01-01' } })]);
    await db.query(`insert into gbs.beneficiaires_effectifs (client_id, nom, pourcentage) values ($1, 'Associé A', 70)`, [m.clientGA]);
    await expectError(db, 'GBS_BENEFICIAIRES_DEPASSENT_100', `insert into gbs.beneficiaires_effectifs (client_id, nom, pourcentage) values ($1, 'Associé B', 40)`, [m.clientGA]);
    // L'agent du Cameroun et les achats ne voient pas les bénéficiaires d'un client gabonais.
    for (const u of [m.agentCM, m.achats]) {
      await as(db, u);
      expect(await rows(db, `select id from gbs.beneficiaires_effectifs`)).toEqual([]);
    }
  }));

  it('clients à revérifier : échéance annuelle et alerte 30 jours avant', () => withTx(async (db) => {
    const m = await monde(db);
    await asRoot(db);
    await db.query(`update gbs.clients set verification_statut = 'verifie', verification_date = current_date - 350 where id = $1`, [m.clientGA]);
    await as(db, m.admin);
    expect((await rows(db, `select client_id from gbs.clients_a_reverifier()`)).map((x) => x.client_id)).toContain(m.clientGA);
    expect((await rows(db, `select client_id from gbs.clients_a_reverifier()`)).map((x) => x.client_id)).not.toContain(m.clientCI);
  }));
});

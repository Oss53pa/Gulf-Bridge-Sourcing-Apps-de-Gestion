// Assurance transport et sinistres (migration 79).
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { as, closePool, dossier, expectError, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

const jj = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const POLICE = { assureur: "AXA Assurances Côte d'Ivoire", numero: 'POL-MAR-2026-0410', garantie: 'icc_a', devise: 'USD', valeur_cif: 100000, du: jj(-30), au: jj(60) };

async function preparer(db: Db) {
  const m = await monde(db);
  const d = await dossier(db, m);
  await as(db, m.admin);
  const e = (await one(db, `insert into gbs.expeditions (dossier_id, mode, pays_destination, port_arrivee) values ($1, 'conteneur_complet', 'CI', 'Abidjan') returning id`, [d])).id as string;
  return { m, d, e };
}
const police = (db: Db, e: string, p: unknown) => one(db, `select gbs.enregistrer_police($1, $2) id`, [e, p]).then((x) => x.id as string);
const sinistre = (db: Db, e: string, p: unknown) => one(db, `select gbs.declarer_sinistre($1, $2) id`, [e, p]).then((x) => x.id as string);
const SIN = { nature: 'avarie', description: 'Porte du module 7 rayée au déchargement', constate_le: jj(-1), montant_reclame: 3000 };
const AUTRE_DOSSIER = '11111111-1111-4111-8111-111111111111';
const fichier = (d: string, ext = 'pdf') => `${d}/${randomUUID()}.${ext}`;


describe('Assurance transport et sinistres', () => {
  it('valeur assurée et prime de référence calculées selon les paramètres ; prime réelle possible', () => withTx(async (db) => {
    const { m, e } = await preparer(db);
    await as(db, m.hub);
    await police(db, e, POLICE);
    expect(await one(db, `select valeur_assuree, prime, prime_reelle from gbs.polices_assurance where expedition_id = $1`, [e]))
      .toEqual({ valeur_assuree: '110000.00', prime: '385.00', prime_reelle: false });
    await police(db, e, { ...POLICE, prime: 420 });
    expect(await one(db, `select prime, prime_reelle from gbs.polices_assurance where expedition_id = $1`, [e])).toEqual({ prime: '420.00', prime_reelle: true });
    for (const p of [{ ...POLICE, garantie: 'tous_risques' }, { ...POLICE, valeur_cif: 0 }, { ...POLICE, au: jj(-40) }, { ...POLICE, x: 1 },
      { ...POLICE, numero: '<b>' }, { ...POLICE, attestation: '../secret.pdf' }, { ...POLICE, attestation: fichier(AUTRE_DOSSIER) }, { ...POLICE, du: 'hier' }]) {
      await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.enregistrer_police($1, $2)`, [e, p]);
    }
  }));

  it('sinistre : police exigée, constat dans la couverture, déclaration tardive signalée, montant plafonné', () => withTx(async (db) => {
    const { m, e } = await preparer(db);
    await as(db, m.achats);
    await expectError(db, 'GBS_POLICE_REQUISE', `select gbs.declarer_sinistre($1, $2)`, [e, SIN]);
    await police(db, e, POLICE);
    await expectError(db, 'GBS_HORS_COUVERTURE', `select gbs.declarer_sinistre($1, $2)`, [e, { ...SIN, constate_le: jj(-31) }]);
    await expectError(db, 'GBS_HORS_COUVERTURE', `select gbs.declarer_sinistre($1, $2)`, [e, { ...SIN, constate_le: jj(1) }]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.declarer_sinistre($1, $2)`, [e, { ...SIN, montant_reclame: 200000 }]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.declarer_sinistre($1, $2)`, [e, { ...SIN, nature: 'casse' }]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.declarer_sinistre($1, $2)`, [e, { ...SIN, preuves: ['../x.pdf'] }]);
    // Preuves : seulement des fichiers déposés dans le dossier de l'expédition (nom régénéré).
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.declarer_sinistre($1, $2)`, [e, { ...SIN, preuves: [fichier(AUTRE_DOSSIER)] }]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.declarer_sinistre($1, $2)`, [e, { ...SIN, preuves: ['dossiers/x/constat.pdf'] }]);
    const dE = (await one(db, `select dossier_id from gbs.expeditions where id = $1`, [e])).dossier_id;
    const s1 = await sinistre(db, e, { ...SIN, preuves: [fichier(dE, 'jpg')] });
    const s2 = await sinistre(db, e, { ...SIN, constate_le: jj(-10) });
    expect(await rows(db, `select reference like 'SIN-%-01' r1, tardif, devise from gbs.sinistres where id in ($1, $2) order by reference`, [s1, s2]))
      .toEqual([{ r1: true, tardif: false, devise: 'USD' }, { r1: false, tardif: true, devise: 'USD' }]);
    // Police verrouillée tant qu'un sinistre est en cours.
    await expectError(db, 'GBS_SINISTRE_EN_COURS', `select gbs.enregistrer_police($1, $2)`, [e, { ...POLICE, valeur_cif: 50000 }]);
  }));

  it('suite : expertise, puis indemnité plafonnée ou refus motivé ; dossier clos figé', () => withTx(async (db) => {
    const { m, e } = await preparer(db);
    await as(db, m.achats);
    await police(db, e, POLICE);
    const s = await sinistre(db, e, SIN);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.traiter_sinistre($1, 'indemniser', $2)`, [s, { indemnite: 2000, indemnise_le: jj(0) }]);
    await as(db, m.hub);
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.traiter_sinistre($1, 'expertise', '{"reference_assureur":"AXA-77"}')`, [s]);
    await as(db, m.achats);
    await db.query(`select gbs.traiter_sinistre($1, 'expertise', '{"reference_assureur":"AXA-77"}')`, [s]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.traiter_sinistre($1, 'indemniser', $2)`, [s, { indemnite: 120000, indemnise_le: jj(0) }]);
    await expectError(db, 'GBS_MOTIF_OBLIGATOIRE', `select gbs.traiter_sinistre($1, 'refuser', '{"motif":""}')`, [s]);
    await db.query(`select gbs.traiter_sinistre($1, 'indemniser', $2)`, [s, { indemnite: 2500, indemnise_le: jj(0) }]);
    await expectError(db, 'GBS_DEMANDE_TRAITEE', `select gbs.traiter_sinistre($1, 'refuser', '{"motif":"Exclusion de garantie"}')`, [s]);
    expect(await one(db, `select statut, indemnite from gbs.sinistres where id = $1`, [s])).toEqual({ statut: 'indemnise', indemnite: '2500.00' });
    // Le sinistre clos libère la police.
    await police(db, e, { ...POLICE, numero: 'POL-MAR-2026-0411' });
  }));

  it('droits : écriture directe interdite ; lecture selon le dossier ; comptable et agent d’un autre pays exclus', () => withTx(async (db) => {
    const { m, e } = await preparer(db);
    await as(db, m.achats);
    await police(db, e, POLICE);
    await expectError(db, '42501', `update gbs.polices_assurance set prime = 0 where expedition_id = $1`, [e]);
    for (const u of [m.comptable, m.agentGA, m.inspecteur]) {
      await as(db, u);
      await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.enregistrer_police($1, $2)`, [e, POLICE]);
    }
    await as(db, m.agentCM);
    expect(await rows(db, `select id from gbs.polices_assurance`)).toEqual([]);
    expect(m).toBeTruthy();
  }));
});

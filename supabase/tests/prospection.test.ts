// M1 : prospection et demandes du site web.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, expectError, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

const IP = 'a'.repeat(64);
async function service(db: Db) {
  await asRoot(db);
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
}
const demande = (extra: Record<string, unknown> = {}) => ({
  raison_sociale: 'Clinique Les Palmiers', contact_nom: 'Dr Koné', email: 'direction@palmiers.ci', telephone: '+225 07 00 00 00',
  pays: 'CI', specialite: 'equipement_site', message: 'Équipement de 12 chambres', page_origine: 'https://gbs.example/equipement-hotel',
  langue: 'fr', consentement: true, ...extra,
});
const recevoir = async (db: Db, d: object, ip = IP) => { await service(db); return (await one(db, `select gbs.recevoir_demande_site($1, $2) r`, [JSON.stringify(d), ip])).r; };
async function prospect(db: Db, m: Monde, u: string, pays = 'CI') {
  await as(db, u);
  return (await one(db, `insert into gbs.prospects (raison_sociale, contact_nom, email, pays, specialite, source)
    values ('Mine de Moanda', 'M. Ndong', 'achats@mine.ga', $1, 'approvisionnement_industriel', 'salon') returning id`, [pays])).id as string;
}

describe('Demandes du site web (M1, lot 1)', () => {
  it('crée un prospect avec source, spécialité, pays et page d’origine ; tâche de premier contact à 1 jour ouvré', () => withTx(async (db) => {
    const m = await monde(db);
    const r = await recevoir(db, demande());
    expect(r.doublon).toBe(false);
    await asRoot(db);
    const p = await one(db, `select source, specialite, pays, page_origine, responsable_id, consentement_le is not null c from gbs.prospects where id = $1`, [r.prospect_id]);
    expect(p).toEqual({ source: 'site_web', specialite: 'equipement_site', pays: 'CI', page_origine: 'https://gbs.example/equipement-hotel', responsable_id: m.hub, c: true });
    const t = await one(db, `select assigne_a, echeance > current_date e from gbs.taches where prospect_id = $1`, [r.prospect_id]);
    expect(t).toEqual({ assigne_a: m.hub, e: true });
    // Gabon : confié à l'agent du pays.
    const g = await recevoir(db, demande({ email: 'contact@mine.ga', pays: 'GA', raison_sociale: 'Mine de Moanda' }));
    await asRoot(db);
    expect((await one(db, `select responsable_id, agent_id from gbs.prospects where id = $1`, [g.prospect_id]))).toEqual({ responsable_id: m.agentGA, agent_id: m.agentGA });
  }));

  it('entrée stricte : champs inconnus, consentement absent, page non https refusés ; réservée au rôle de service', () => withTx(async (db) => {
    const m = await monde(db);
    for (const d of [{ ...demande(), statut: 'converti' }, { ...demande(), admin: true }, demande({ consentement: false }), demande({ page_origine: 'javascript:alert(1)' }),
                     demande({ pays: 'Côte' }), demande({ email: null, telephone: null }), demande({ message: 'x'.repeat(5000) })]) {
      await service(db);
      await expectError(db, 'GBS_DEMANDE_INVALIDE', `select gbs.recevoir_demande_site($1, $2)`, [JSON.stringify(d), IP]);
    }
    await as(db, m.admin);
    await expectError(db, '42501', `select gbs.recevoir_demande_site($1, $2)`, [JSON.stringify(demande()), IP]);
    await as(db, m.hub);
    await expectError(db, '42501', `insert into gbs.prospects (raison_sociale, email, pays, source) values ('Faux site', 'a@b.ci', 'CI', 'site_web')`);
  }));

  it('doublon du jour rattaché au prospect ; plafond par adresse et par heure', () => withTx(async (db) => {
    await monde(db);
    const a = await recevoir(db, demande());
    const b = await recevoir(db, demande({ message: 'Précision : 14 chambres' }));
    expect(b).toEqual({ prospect_id: a.prospect_id, doublon: true });
    for (let i = 0; i < 3; i++) await recevoir(db, demande({ email: `x${i}@palmiers.ci` }));
    await service(db);
    await expectError(db, 'GBS_TROP_DE_DEMANDES', `select gbs.recevoir_demande_site($1, $2)`, [JSON.stringify(demande({ email: 'y@palmiers.ci' })), IP]);
    await recevoir(db, demande({ email: 'y@palmiers.ci' }), 'b'.repeat(64));
  }));
});

describe('Prospection (M1)', () => {
  it('premier contact : la tâche se ferme ; qualification, conversion en client de la bonne société', () => withTx(async (db) => {
    const m = await monde(db);
    const p = await prospect(db, m, m.agentGA, 'GA');
    await as(db, m.agentGA);
    await expectError(db, 'GBS_PREMIER_CONTACT_REQUIS', `select gbs.changer_statut_prospect($1, 'qualifie')`, [p]);
    await expectError(db, '42501', `update gbs.prospects set statut = 'converti' where id = $1`, [p]);
    await db.query(`select gbs.enregistrer_action_prospect($1, 'appel', current_date, 'Besoin de 3 groupes électrogènes', current_date + 7)`, [p]);
    expect((await one(db, `select statut, prochaine_relance > current_date r from gbs.prospects where id = $1`, [p]))).toEqual({ statut: 'contacte', r: true });
    expect((await one(db, `select statut from gbs.taches where prospect_id = $1`, [p])).statut).toBe('faite');
    await db.query(`select gbs.changer_statut_prospect($1, 'qualifie')`, [p]);
    const c = await one(db, `select * from gbs.convertir_prospect($1)`, [p]);
    await asRoot(db);
    expect([c.pays, c.devise, c.origine, c.agent_id, c.societe_id]).toEqual(['GA', 'XAF', 'agent_pays', m.agentGA, m.cn]);
    expect((await one(db, `select statut, client_id from gbs.prospects where id = $1`, [p]))).toEqual({ statut: 'converti', client_id: c.id });
    await as(db, m.agentGA);
    await expectError(db, 'GBS_PROSPECT_CLOS', `select gbs.enregistrer_action_prospect($1, 'appel', current_date, 'Relance')`, [p]);
  }));

  it('perte motivée ; alerte des prospects sans premier contact ; cloisonnement par pays', () => withTx(async (db) => {
    const m = await monde(db);
    const p = await prospect(db, m, m.hub, 'CI');
    await as(db, m.hub);
    await expectError(db, 'GBS_MOTIF_OBLIGATOIRE', `select gbs.changer_statut_prospect($1, 'perdu')`, [p]);
    const q = await prospect(db, m, m.hub, 'SN');
    await asRoot(db);
    await db.query(`update gbs.taches set echeance = current_date - 1 where prospect_id = $1`, [q]);
    await as(db, m.hub);
    expect((await rows(db, `select prospect_id from gbs.prospects_sans_contact()`)).map((x) => x.prospect_id)).toEqual([q]);
    await db.query(`select gbs.changer_statut_prospect($1, 'perdu', 'Budget reporté à 2027')`, [p]);
    // Cloisonnement : l'agent du Gabon ne voit pas les prospects ivoiriens ; les achats rien.
    for (const u of [m.agentGA, m.achats, m.comptable]) {
      await as(db, u);
      expect(await rows(db, `select id from gbs.prospects where pays in ('CI','SN')`)).toEqual([]);
    }
    await as(db, m.agentGA);
    await expectError(db, 'GBS_ASSIGNE_INVALIDE', `insert into gbs.prospects (raison_sociale, email, pays, source) values ('Hors pays', 'a@b.cm', 'CM', 'salon')`);
    await as(db, m.hub);
    const e = await rows(db, `select statut, nombre from gbs.entonnoir_prospects()`);
    expect(e.find((x) => x.statut === 'perdu')!.nombre).toBe('1');
  }));
});
